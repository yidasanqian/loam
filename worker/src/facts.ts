import type { Db, DbStatement } from './db.ts';
import { sha256Hex } from './auth.ts';
import { ApiFailure } from './errors.ts';
import {
  IMPORT_BATCH,
  MAX_EVIDENCE_PATHS,
  MAX_EVIDENCE_SYMBOLS,
  MAX_PINNED_HINT,
  MAX_PROJECT_FACTS,
  parseEvidence,
  toFact,
  type Device,
  type Fact,
  type FactEvidence,
  type FactKind,
  type FactRow,
} from './model.ts';
import { asObject, normalizeText, validateFactInput, type FactInput, type FactPatch, type SearchParams } from './validate.ts';

const FACT_COLUMNS =
  'id, project, kind, text, hash, tags, harness, pinned, importance, evidence, superseded_by, superseded_at, device_id, device_name, created_at, deleted_at';

const INSERT_SQL = `INSERT INTO facts (id, project, kind, text, hash, tags, harness, pinned, importance, evidence, device_id, device_name, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project, hash) DO NOTHING`;

/** Evidence is JSON text in one column: it is a pointer set, never queryable prose. */
function evidenceColumn(evidence: FactEvidence | null): string {
  return evidence ? JSON.stringify(evidence) : '';
}

/**
 * The same claim recorded from a second place widens its scope (another file the
 * convention holds in) instead of being dropped as a duplicate. Caps are kept:
 * beyond 8 paths a fact is a global claim and should be reworded, not extended.
 */
function mergeEvidence(base: FactEvidence | null, extra: FactEvidence): FactEvidence {
  const paths = [...(base?.paths ?? [])];
  for (const path of extra.paths) {
    if (!paths.includes(path) && paths.length < MAX_EVIDENCE_PATHS) paths.push(path);
  }
  const symbols = [...(base?.symbols ?? [])];
  for (const symbol of extra.symbols) {
    if (!symbols.includes(symbol) && symbols.length < MAX_EVIDENCE_SYMBOLS) symbols.push(symbol);
  }
  return {
    paths,
    symbols,
    check: extra.check || base?.check || '',
    commit: extra.commit || base?.commit || '',
    at: Math.max(base?.at ?? 0, extra.at),
  };
}

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

export async function countPinned(db: Db, project: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM facts WHERE project = ? AND deleted_at IS NULL AND pinned = 1 AND superseded_by IS NULL')
    .bind(project)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export interface KindCounts {
  decision: number;
  pitfall: number;
  convention: number;
  fact: number;
}

export interface ProjectStats {
  facts: number;
  byKind: KindCounts;
  /** Recallable counts: same as byKind minus superseded rows. */
  activeByKind: KindCounts;
  pinned: number;
  superseded: number;
}

/** One grouped query: kind counts plus pinned and superseded totals. */
export async function projectStats(db: Db, project: string): Promise<ProjectStats> {
  const rows = await db
    .prepare(
      `SELECT kind, COUNT(*) AS n,
              SUM(CASE WHEN superseded_by IS NULL THEN 1 ELSE 0 END) AS a,
              SUM(CASE WHEN pinned = 1 AND superseded_by IS NULL THEN 1 ELSE 0 END) AS p,
              SUM(CASE WHEN superseded_by IS NOT NULL THEN 1 ELSE 0 END) AS s
         FROM facts WHERE project = ? AND deleted_at IS NULL GROUP BY kind`,
    )
    .bind(project)
    .all<{ kind: FactKind; n: number; a: number | null; p: number | null; s: number | null }>();
  const byKind: KindCounts = { decision: 0, pitfall: 0, convention: 0, fact: 0 };
  const activeByKind: KindCounts = { decision: 0, pitfall: 0, convention: 0, fact: 0 };
  let facts = 0;
  let pinned = 0;
  let superseded = 0;
  for (const row of rows.results) {
    byKind[row.kind] = Number(row.n);
    activeByKind[row.kind] = Number(row.a ?? 0);
    facts += Number(row.n);
    pinned += Number(row.p ?? 0);
    superseded += Number(row.s ?? 0);
  }
  return { facts, byKind, activeByKind, pinned, superseded };
}

export interface CreateResult {
  fact: Fact;
  deduped: boolean;
  projectCount: number;
  warning: string | null;
  supersededTarget?: { id: string };
}

interface SupersedeTarget {
  id: string;
  project: string;
  superseded_by: string | null;
}

async function resolveSupersedeTarget(db: Db, idOrPrefix: string, project: string): Promise<SupersedeTarget> {
  if (idOrPrefix.length < 6) throw new ApiFailure(400, 'invalid_supersedes', 'supersede target id must be at least 6 characters');
  const row =
    idOrPrefix.length >= 32
      ? await db
          .prepare('SELECT id, project, superseded_by FROM facts WHERE id = ? AND deleted_at IS NULL')
          .bind(idOrPrefix)
          .first<SupersedeTarget>()
      : await db
          .prepare(
            "SELECT id, project, superseded_by FROM facts WHERE id LIKE ? ESCAPE '\\' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",
          )
          .bind(`${escapeLike(idOrPrefix)}%`)
          .first<SupersedeTarget>();
  if (!row) throw new ApiFailure(400, 'invalid_supersedes', 'supersede target not found');
  if (row.project !== project) throw new ApiFailure(400, 'invalid_supersedes', 'supersede target belongs to another project');
  if (row.superseded_by) throw new ApiFailure(400, 'invalid_supersedes', 'supersede target is already superseded');
  return row;
}

export async function createFact(
  db: Db,
  device: Device,
  input: FactInput,
  now: number,
  supersedes: string | null = null,
): Promise<CreateResult> {
  const hash = await factHash(input.project, input.kind, input.text);
  const target = supersedes ? await resolveSupersedeTarget(db, supersedes, input.project) : null;
  const existing = await db
    .prepare('SELECT id, deleted_at, evidence FROM facts WHERE project = ? AND hash = ?')
    .bind(input.project, hash)
    .first<{ id: string; deleted_at: number | null; evidence: string }>();
  const id = existing?.id ?? crypto.randomUUID();
  const statements: DbStatement[] = [];
  if (!existing) {
    statements.push(
      db
        .prepare(INSERT_SQL)
        .bind(
          id,
          input.project,
          input.kind,
          input.text,
          hash,
          input.tags.join(','),
          input.harness,
          input.pinned ? 1 : 0,
          input.importance,
          evidenceColumn(input.evidence),
          device.id,
          device.name,
          now,
        ),
    );
  } else if (existing.deleted_at !== null) {
    // Same text was pruned earlier: revive it instead of hiding it behind the unique index.
    statements.push(db.prepare('UPDATE facts SET deleted_at = NULL WHERE id = ?').bind(id));
  } else if (input.evidence) {
    const base = parseEvidence(existing.evidence);
    const merged = mergeEvidence(base, input.evidence);
    if (JSON.stringify(merged) !== JSON.stringify(base)) {
      statements.push(db.prepare('UPDATE facts SET evidence = ? WHERE id = ?').bind(evidenceColumn(merged), id));
    }
  }
  if (target) {
    // A retired fact must not stay "core memory": clear its pin in the same batch.
    statements.push(
      db
        .prepare('UPDATE facts SET superseded_by = ?, superseded_at = ?, pinned = 0 WHERE id = ? AND superseded_by IS NULL')
        .bind(id, now, target.id),
    );
  }
  if (statements.length > 0) {
    // One batch: a new fact and the superseded pointer land together or not at all.
    await db.batch(statements);
  }
  let row = await db.prepare(`SELECT ${FACT_COLUMNS} FROM facts WHERE id = ?`).bind(id).first<FactRow>();
  if (!row) {
    row = await db.prepare(`SELECT ${FACT_COLUMNS} FROM facts WHERE project = ? AND hash = ?`).bind(input.project, hash).first<FactRow>();
  }
  if (!row) throw new ApiFailure(500, 'internal', 'fact was not persisted');

  const projectCount = await countProject(db, input.project);
  const warnings: string[] = [];
  if (projectCount > MAX_PROJECT_FACTS) {
    warnings.push(`project "${input.project}" holds ${projectCount} facts, above the ${MAX_PROJECT_FACTS} limit; run loam prune`);
  }
  if (input.pinned) {
    const pinnedCount = await countPinned(db, input.project);
    if (pinnedCount > MAX_PINNED_HINT) {
      warnings.push(`project "${input.project}" pins ${pinnedCount} facts; keep pinned to the few that must always be injected`);
    }
  }
  return {
    fact: toFact(row),
    deduped: Boolean(existing),
    projectCount,
    warning: warnings.length > 0 ? warnings.join('; ') : null,
    ...(target ? { supersededTarget: { id: target.id } } : {}),
  };
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
  if (query.file) {
    // instr() instead of LIKE: paths contain `_` and `%` often enough to matter.
    clauses.push('instr(evidence, ?) > 0');
    args.push(`"${query.file}"`);
  }
  if (!query.includeSuperseded) clauses.push('superseded_by IS NULL');
  if (query.pinnedOnly) clauses.push('pinned = 1');
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
  if (query.sort === 'rank') {
    // Top-N only: rank order is not compatible with the (created_at, id) keyset.
    const ranked = await db
      .prepare(
        `SELECT ${FACT_COLUMNS} FROM facts WHERE ${where} ORDER BY pinned DESC, importance DESC, created_at DESC, id DESC LIMIT ?`,
      )
      .bind(...args, query.limit)
      .all<FactRow>();
    return { facts: ranked.results.map(toFact), next: null };
  }
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
    .prepare(
      `SELECT ${FACT_COLUMNS} FROM facts WHERE id LIKE ? ESCAPE '\\' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(`${escapeLike(idOrPrefix)}%`)
    .first<FactRow>();
  return row ? toFact(row) : null;
}

export async function deleteFact(db: Db, id: string, now: number): Promise<boolean> {
  const exists = await db
    .prepare('SELECT id FROM facts WHERE id = ? AND deleted_at IS NULL')
    .bind(id)
    .first<{ id: string }>();
  if (!exists) return false;
  await db.batch([
    // A deleted fact must not keep other rows hidden from recall.
    db.prepare('UPDATE facts SET superseded_by = NULL, superseded_at = NULL WHERE superseded_by = ?').bind(id),
    db.prepare('UPDATE facts SET deleted_at = ? WHERE id = ?').bind(now, id),
  ]);
  return true;
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
  const pinned = patch.pinned ?? row.pinned === 1;
  const importance = patch.importance ?? row.importance;
  const evidence = 'evidence' in patch ? evidenceColumn(patch.evidence ?? null) : row.evidence;
  const clearingSupersede = 'supersededBy' in patch;
  const supersededBy = clearingSupersede ? null : row.superseded_by;
  const supersededAt = clearingSupersede ? null : row.superseded_at;
  const hash = await factHash(row.project, kind, text);
  if (hash !== row.hash) {
    const conflict = await db
      .prepare('SELECT id FROM facts WHERE project = ? AND hash = ? AND id <> ?')
      .bind(row.project, hash, id)
      .first<{ id: string }>();
    if (conflict) throw new ApiFailure(409, 'conflict', 'another fact already has this project/kind/text');
  }
  await db
    .prepare(
      'UPDATE facts SET text = ?, kind = ?, tags = ?, hash = ?, pinned = ?, importance = ?, evidence = ?, superseded_by = ?, superseded_at = ? WHERE id = ?',
    )
    .bind(text, kind, tags.join(','), hash, pinned ? 1 : 0, importance, evidence, supersededBy, supersededAt, id)
    .run();
  return toFact({
    ...row,
    text,
    kind,
    tags: tags.join(','),
    hash,
    pinned: pinned ? 1 : 0,
    importance,
    evidence,
    superseded_by: supersededBy,
    superseded_at: supersededAt,
  });
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
        .prepare('UPDATE facts SET deleted_at = ? WHERE project = ? AND created_at < ? AND deleted_at IS NULL AND pinned = 0')
        .bind(now, opts.project, cutoff)
    : db
        .prepare('UPDATE facts SET deleted_at = ? WHERE created_at < ? AND deleted_at IS NULL AND pinned = 0')
        .bind(now, cutoff);
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
      .prepare(INSERT_SQL)
      .bind(
        item.id,
        item.input.project,
        item.input.kind,
        item.input.text,
        item.hash,
        item.input.tags.join(','),
        item.input.harness,
        item.input.pinned ? 1 : 0,
        item.input.importance,
        evidenceColumn(item.input.evidence),
        device.id,
        device.name,
        item.createdAt,
      ),
  );
  const results = await db.batch(statements);
  const inserted = results.filter((r) => r.meta.changes > 0).length;
  return { inserted, deduped: results.length - inserted };
}