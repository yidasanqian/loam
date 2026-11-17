import type { Db } from './db.ts';
import { sha256Hex } from './auth.ts';
import { ApiFailure } from './errors.ts';
import {
  IMPORT_BATCH,
  MAX_PROJECT_FACTS,
  toFact,
  type Device,
  type Fact,
  type FactKind,
  type FactRow,
} from './model.ts';
import { asObject, normalizeText, validateFactInput, type FactInput, type FactPatch, type SearchParams } from './validate.ts';

const FACT_COLUMNS = 'id, project, kind, text, hash, tags, harness, device_id, device_name, created_at, deleted_at';

export function factHash(project: string, kind: FactKind, text: string): Promise<string> {
  return sha256Hex(`${project}\u0000${kind}\u0000${normalizeText(text)}`);
}

export async function countProject(db: Db, project: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM facts WHERE project = ? AND deleted_at IS NULL')
    .bind(project)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export interface CreateResult {
  fact: Fact;
  deduped: boolean;
  projectCount: number;
  warning: string | null;
}

export async function createFact(db: Db, device: Device, input: FactInput, now: number): Promise<CreateResult> {
  const hash = await factHash(input.project, input.kind, input.text);
  const id = crypto.randomUUID();
  const inserted = await db
    .prepare(
      `INSERT INTO facts (${FACT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL) ON CONFLICT(project, hash) DO NOTHING`,
    )
    .bind(id, input.project, input.kind, input.text, hash, input.tags.join(','), input.harness, device.id, device.name, now);
  const result = await inserted.run();
  if (result.meta.changes === 0) {
    // Same text was pruned earlier: revive it instead of hiding it behind the unique index.
    await db
      .prepare('UPDATE facts SET deleted_at = NULL WHERE project = ? AND hash = ? AND deleted_at IS NOT NULL')
      .bind(input.project, hash)
      .run();
  }
  const row =
    result.meta.changes > 0
      ? await db.prepare(`SELECT ${FACT_COLUMNS} FROM facts WHERE id = ?`).bind(id).first<FactRow>()
      : await db
          .prepare(`SELECT ${FACT_COLUMNS} FROM facts WHERE project = ? AND hash = ?`)
          .bind(input.project, hash)
          .first<FactRow>();
  if (!row) throw new ApiFailure(500, 'internal', 'fact was not persisted');
  const projectCount = await countProject(db, input.project);
  const warning =
    projectCount > MAX_PROJECT_FACTS
      ? `project "${input.project}" holds ${projectCount} facts, above the ${MAX_PROJECT_FACTS} v1 limit; run loam prune`
      : null;
  return { fact: toFact(row), deduped: result.meta.changes === 0, projectCount, warning };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export function encodeCursor(row: { created_at: number; id: string }): string {
  return `${row.created_at}_${row.id}`;
}

export function decodeCursor(cursor: string): { createdAt: number; id: string } {
  const at = cursor.indexOf('_');
  const createdAt = Number(cursor.slice(0, at));
  const id = cursor.slice(at + 1);
  if (at < 1 || !Number.isFinite(createdAt) || !id) throw new ApiFailure(400, 'invalid_cursor', 'malformed cursor');
  return { createdAt, id };
}

function buildFilter(query: SearchParams): { where: string; args: unknown[] } {
  const clauses = ['deleted_at IS NULL'];
  const args: unknown[] = [];
  if (query.project) {
    clauses.push('project = ?');
    args.push(query.project);
  }
  if (query.kind) {
    clauses.push('kind = ?');
    args.push(query.kind);
  }
  if (query.tag) {
    clauses.push("(',' || tags || ',') LIKE ? ESCAPE '\\'");
    args.push(`%,${escapeLike(query.tag)},%`);
  }
  if (query.q) {
    const terms = query.q.split(/\s+/u).filter(Boolean).slice(0, 5);
    for (const term of terms) {
      clauses.push("text LIKE ? ESCAPE '\\'");
      args.push(`%${escapeLike(term)}%`);
    }
  }
  if (query.cursor) {
    const { createdAt, id } = decodeCursor(query.cursor);
    clauses.push('(created_at < ? OR (created_at = ? AND id < ?))');
    args.push(createdAt, createdAt, id);
  }
  return { where: clauses.join(' AND '), args };
}

export interface SearchResult {
  facts: Fact[];
  next: string | null;
}

export async function searchFacts(db: Db, query: SearchParams): Promise<SearchResult> {
  const { where, args } = buildFilter(query);
  const rows = await db
    .prepare(`SELECT ${FACT_COLUMNS} FROM facts WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ?`)
    .bind(...args, query.limit + 1)
    .all<FactRow>();
  const page = rows.results.slice(0, query.limit);
  const last = page[page.length - 1];
  const next = rows.results.length > query.limit && last ? encodeCursor(last) : null;
  return { facts: page.map(toFact), next };
}

export async function getFact(db: Db, idOrPrefix: string): Promise<Fact | null> {
  if (idOrPrefix.length >= 32) {
    const row = await db
      .prepare(`SELECT ${FACT_COLUMNS} FROM facts WHERE id = ? AND deleted_at IS NULL`)
      .bind(idOrPrefix)
      .first<FactRow>();
    return row ? toFact(row) : null;
  }
  if (idOrPrefix.length < 6) throw new ApiFailure(400, 'invalid_id', 'id prefix must be at least 6 characters');
  const row = await db
    .prepare(`SELECT ${FACT_COLUMNS} FROM facts WHERE id LIKE ? ESCAPE '\\' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`)
    .bind(`${escapeLike(idOrPrefix)}%`)
    .first<FactRow>();
  return row ? toFact(row) : null;
}

export async function deleteFact(db: Db, id: string, now: number): Promise<boolean> {
  const result = await db.prepare('UPDATE facts SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').bind(now, id).run();
  return result.meta.changes > 0;
}

export async function updateFact(db: Db, id: string, patch: FactPatch): Promise<Fact> {
  const row = await db
    .prepare(`SELECT ${FACT_COLUMNS} FROM facts WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first<FactRow>();
  if (!row) throw new ApiFailure(404, 'not_found', 'fact not found');
  const text = patch.text ?? row.text;
  const kind = patch.kind ?? row.kind;
  const tags = patch.tags ?? (row.tags ? row.tags.split(',') : []);
  const hash = await factHash(row.project, kind, text);
  const conflict = await db
    .prepare('SELECT id FROM facts WHERE project = ? AND hash = ? AND id <> ?')
    .bind(row.project, hash, id)
    .first<{ id: string }>();
  if (conflict) throw new ApiFailure(409, 'conflict', 'another fact already has this project/kind/text');
  await db
    .prepare('UPDATE facts SET text = ?, kind = ?, tags = ?, hash = ? WHERE id = ?')
    .bind(text, kind, tags.join(','), hash, id)
    .run();
  return toFact({ ...row, text, kind, tags: tags.join(','), hash });
}

export interface ProjectSummary {
  project: string;
  facts: number;
}

export async function listProjects(db: Db): Promise<ProjectSummary[]> {
  const result = await db
    .prepare(
      'SELECT project, COUNT(*) AS facts FROM facts WHERE deleted_at IS NULL GROUP BY project ORDER BY facts DESC, project ASC',
    )
    .all<ProjectSummary>();
  return result.results.map((row) => ({ project: row.project, facts: Number(row.facts) }));
}

export async function pruneFacts(
  db: Db,
  opts: { project: string | null; olderThanDays: number; now?: number },
): Promise<number> {
  const now = opts.now ?? Date.now();
  const cutoff = now - opts.olderThanDays * 86_400_000;
  const statement = opts.project
    ? db
        .prepare('UPDATE facts SET deleted_at = ? WHERE project = ? AND created_at < ? AND deleted_at IS NULL')
        .bind(now, opts.project, cutoff)
    : db.prepare('UPDATE facts SET deleted_at = ? WHERE created_at < ? AND deleted_at IS NULL').bind(now, cutoff);
  return (await statement.run()).meta.changes;
}

export interface ImportResult {
  inserted: number;
  deduped: number;
}

export async function importFacts(db: Db, device: Device, items: unknown[], now: number): Promise<ImportResult> {
  if (items.length > IMPORT_BATCH) {
    throw new ApiFailure(413, 'too_large', `import at most ${IMPORT_BATCH} facts per request`);
  }
  if (items.length === 0) return { inserted: 0, deduped: 0 };
  const prepared = await Promise.all(
    items.map(async (raw) => {
      const obj = asObject(raw);
      const input = validateFactInput(obj);
      const createdAt =
        typeof obj.created_at === 'number' && Number.isFinite(obj.created_at) ? Math.floor(obj.created_at) : now;
      return { input, createdAt, hash: await factHash(input.project, input.kind, input.text), id: crypto.randomUUID() };
    }),
  );
  const statements = prepared.map((item) =>
    db
      .prepare(
        `INSERT INTO facts (${FACT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL) ON CONFLICT(project, hash) DO NOTHING`,
      )
      .bind(
        item.id,
        item.input.project,
        item.input.kind,
        item.input.text,
        item.hash,
        item.input.tags.join(','),
        item.input.harness,
        device.id,
        device.name,
        item.createdAt,
      ),
  );
  const results = await db.batch(statements);
  const inserted = results.filter((r) => r.meta.changes > 0).length;
  return { inserted, deduped: results.length - inserted };
}