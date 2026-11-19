import { ApiFailure } from './errors.ts';
import {
  DEFAULT_IMPORTANCE,
  DEFAULT_LIMIT,
  FACT_KINDS,
  MAX_CHECK_LEN,
  MAX_EVIDENCE_PATHS,
  MAX_EVIDENCE_SYMBOLS,
  MAX_IMPORTANCE,
  MAX_LIMIT,
  MAX_PATH_LEN,
  MAX_PROJECT_LEN,
  MAX_SYMBOL_LEN,
  MAX_TAG_LEN,
  MAX_TAGS,
  MAX_TEXT_BYTES,
  isPlainObject,
  type FactEvidence,
  type FactKind,
  type SortMode,
} from './model.ts';

const PROJECT_RE = /^[A-Za-z0-9._@:/-]+$/;
const TAG_RE = /^[^\s,]{1,32}$/u;
const HARNESS_RE = /^[a-z0-9._-]{1,32}$/;
const DEVICE_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

export function normalizeText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function asObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiFailure(400, 'invalid_body', 'body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

export function asString(value: unknown, field: string, max: number, required = true): string {
  if (value === undefined || value === null) {
    if (!required) return '';
    throw new ApiFailure(400, 'invalid_field', `${field} is required`);
  }
  if (typeof value !== 'string') throw new ApiFailure(400, 'invalid_field', `${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed && required) throw new ApiFailure(400, 'invalid_field', `${field} must not be empty`);
  if (trimmed.length > max) throw new ApiFailure(400, 'invalid_field', `${field} is too long (max ${max})`);
  return trimmed;
}

export function validateProject(value: unknown): string {
  const project = asString(value, 'project', MAX_PROJECT_LEN);
  if (!PROJECT_RE.test(project)) {
    throw new ApiFailure(400, 'invalid_field', 'project may only contain letters, digits, ._@:/-');
  }
  return project;
}

export function validateKind(value: unknown): FactKind {
  if (typeof value !== 'string' || !(FACT_KINDS as readonly string[]).includes(value)) {
    throw new ApiFailure(400, 'invalid_field', `kind must be one of ${FACT_KINDS.join('|')}`);
  }
  return value as FactKind;
}

export function validateTags(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') throw new ApiFailure(400, 'invalid_field', 'tags must be strings');
    const tag = item.trim().toLowerCase();
    if (!tag) continue;
    if (!TAG_RE.test(tag)) {
      throw new ApiFailure(400, 'invalid_field', `tag "${tag}" must be 1-${MAX_TAG_LEN} chars without spaces or commas`);
    }
    if (!out.includes(tag)) out.push(tag);
  }
  if (out.length > MAX_TAGS) throw new ApiFailure(400, 'invalid_field', `at most ${MAX_TAGS} tags`);
  return out;
}

export function validateHarness(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'unknown';
  const harness = asString(value, 'harness', 32).toLowerCase();
  if (!HARNESS_RE.test(harness)) throw new ApiFailure(400, 'invalid_field', 'harness must be lowercase [a-z0-9._-]');
  return harness;
}

export function validateImportance(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_IMPORTANCE;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_IMPORTANCE) {
    throw new ApiFailure(400, 'invalid_field', `importance must be an integer in 1..${MAX_IMPORTANCE}`);
  }
  return value;
}

export function validatePinned(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== 'boolean') throw new ApiFailure(400, 'invalid_field', 'pinned must be a boolean');
  return value;
}

const PATH_SEGMENT_RE = /^[A-Za-z0-9._@+-]+$/u;
const SYMBOL_RE = /^[A-Za-z_$][A-Za-z0-9_$.]{0,79}$/u;
const COMMIT_RE = /^[0-9a-f]{7,40}$/u;

/**
 * Evidence has to stay followable, so these are rejected on purpose: absolute
 * paths (dead on the next machine), Windows separators (not portable), and
 * `a.ts:12` line numbers. A line number is wrong after the first edit yet still
 * reads as verified, which is worse than no pointer at all.
 */
export function normalizeEvidencePath(value: unknown, field = 'path'): string {
  if (typeof value !== 'string') throw new ApiFailure(400, 'invalid_field', `${field} must be a string`);
  const raw = value.trim().replace(/^\.\//u, '');
  if (!raw) throw new ApiFailure(400, 'invalid_field', `${field} must not be empty`);
  if (raw.length > MAX_PATH_LEN) throw new ApiFailure(400, 'invalid_field', `${field} is too long (max ${MAX_PATH_LEN})`);
  if (raw.startsWith('/') || /^[A-Za-z]:/u.test(raw)) {
    throw new ApiFailure(400, 'invalid_field', `${field} must be repo-relative: ${raw}`);
  }
  if (raw.includes(':')) throw new ApiFailure(400, 'invalid_field', `${field} must not carry a line number: ${raw}`);
  const segments = raw.split('/');
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') {
      throw new ApiFailure(400, 'invalid_field', `${field} has an empty or relative segment: ${raw}`);
    }
    if (!PATH_SEGMENT_RE.test(segment)) {
      throw new ApiFailure(400, 'invalid_field', `${field} must use forward slashes without spaces or wildcards: ${raw}`);
    }
  }
  return segments.join('/');
}

export function validateEvidencePaths(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') throw new ApiFailure(400, 'invalid_field', 'paths must be strings');
    if (!item.trim()) continue;
    const path = normalizeEvidencePath(item, 'paths');
    if (!out.includes(path)) out.push(path);
  }
  if (out.length > MAX_EVIDENCE_PATHS) {
    throw new ApiFailure(400, 'invalid_field', `at most ${MAX_EVIDENCE_PATHS} paths`);
  }
  return out;
}

export function validateEvidenceSymbols(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') throw new ApiFailure(400, 'invalid_field', 'symbols must be strings');
    const symbol = item.trim();
    if (!symbol) continue;
    if (!SYMBOL_RE.test(symbol)) {
      throw new ApiFailure(400, 'invalid_field', `symbol "${symbol}" must be an identifier (Class.method allowed, no spaces, max ${MAX_SYMBOL_LEN})`);
    }
    if (!out.includes(symbol)) out.push(symbol);
  }
  if (out.length > MAX_EVIDENCE_SYMBOLS) {
    throw new ApiFailure(400, 'invalid_field', `at most ${MAX_EVIDENCE_SYMBOLS} symbols`);
  }
  return out;
}

/** Empty evidence normalizes to null: a fact either has followable pointers or none. */
export function validateEvidence(value: unknown): FactEvidence | null {
  if (value === undefined || value === null || value === '') return null;
  const obj = asObject(value);
  const paths = validateEvidencePaths(obj.paths);
  const symbols = validateEvidenceSymbols(obj.symbols);
  let check = '';
  if (obj.check !== undefined && obj.check !== null && obj.check !== '') {
    if (typeof obj.check !== 'string') throw new ApiFailure(400, 'invalid_field', 'check must be a string');
    check = normalizeText(obj.check);
    if (check.length > MAX_CHECK_LEN) {
      throw new ApiFailure(400, 'invalid_field', `check is too long (max ${MAX_CHECK_LEN})`);
    }
  }
  let commit = '';
  if (obj.commit !== undefined && obj.commit !== null && obj.commit !== '') {
    if (typeof obj.commit !== 'string') throw new ApiFailure(400, 'invalid_field', 'commit must be a string');
    const raw = obj.commit.trim().toLowerCase();
    if (!COMMIT_RE.test(raw)) throw new ApiFailure(400, 'invalid_field', 'commit must be 7-40 hex characters');
    commit = raw;
  }
  let dirty: boolean | undefined;
  if (obj.dirty !== undefined && obj.dirty !== null && obj.dirty !== '') {
    if (typeof obj.dirty !== 'boolean') throw new ApiFailure(400, 'invalid_field', 'dirty must be a boolean');
    dirty = obj.dirty;
  }
  let blobs: Record<string, string> | undefined;
  if (obj.blobs !== undefined && obj.blobs !== null) {
    if (!isPlainObject(obj.blobs)) throw new ApiFailure(400, 'invalid_field', 'blobs must be an object');
    const entries = Object.entries(obj.blobs);
    if (entries.length > MAX_EVIDENCE_PATHS) {
      throw new ApiFailure(400, 'invalid_field', `at most ${MAX_EVIDENCE_PATHS} blobs`);
    }
    // Same normalizer as `paths`: a `./` prefix is accepted there, so rejecting it
    // here would make one pointer valid in one field and invalid in the other.
    const kept = new Map<string, string>();
    for (const [rawPath, value] of entries) {
      const path = normalizeEvidencePath(rawPath, 'blobs');
      if (!paths.includes(path)) throw new ApiFailure(400, 'invalid_field', 'blobs must reference paths');
      const blob = typeof value === 'string' ? value.trim().toLowerCase() : '';
      if (!COMMIT_RE.test(blob)) throw new ApiFailure(400, 'invalid_field', 'blob must be 7-40 hex characters');
      kept.set(path, blob);
    }
    if (kept.size > 0) blobs = Object.fromEntries(kept);
  }
  let at = 0;
  if (obj.at !== undefined && obj.at !== null && obj.at !== '') {
    if (typeof obj.at !== 'number' || !Number.isFinite(obj.at) || obj.at < 0) {
      throw new ApiFailure(400, 'invalid_field', 'at must be a millisecond timestamp');
    }
    at = Math.floor(obj.at);
  }
  if (paths.length === 0 && symbols.length === 0 && !check && !commit) return null;
  const evidence: FactEvidence = { paths, symbols, check, commit, at };
  // A dirty flag without a commit points at nothing a reader can re-check.
  if (commit && dirty !== undefined) evidence.dirty = dirty;
  if (blobs) evidence.blobs = blobs;
  return evidence;
}

export function validateDeviceName(value: unknown): string {
  const name = asString(value, 'name', 64);
  if (!DEVICE_NAME_RE.test(name)) throw new ApiFailure(400, 'invalid_field', 'name may only contain letters, digits, ._-');
  return name;
}

export interface FactInput {
  project: string;
  kind: FactKind;
  text: string;
  tags: string[];
  harness: string;
  pinned: boolean;
  importance: number;
  evidence: FactEvidence | null;
}

export function validateFactInput(body: unknown): FactInput {
  const obj = asObject(body);
  if (typeof obj.text !== 'string') throw new ApiFailure(400, 'invalid_field', 'text must be a string');
  const text = normalizeText(obj.text);
  if (!text) throw new ApiFailure(400, 'invalid_field', 'text must not be empty');
  if (byteLength(text) > MAX_TEXT_BYTES) {
    throw new ApiFailure(413, 'too_large', `text exceeds ${MAX_TEXT_BYTES} bytes`);
  }
  return {
    project: validateProject(obj.project),
    kind: validateKind(obj.kind ?? 'fact'),
    text,
    tags: validateTags(obj.tags),
    harness: validateHarness(obj.harness),
    pinned: validatePinned(obj.pinned),
    importance: validateImportance(obj.importance),
    evidence: validateEvidence(obj.evidence),
  };
}

export interface FactPatch {
  text?: string;
  kind?: FactKind;
  tags?: string[];
  pinned?: boolean;
  importance?: number;
  evidence?: FactEvidence | null;
  supersededBy?: null;
}

export function validateFactPatch(body: unknown): FactPatch {
  const obj = asObject(body);
  const patch: FactPatch = {};
  if ('text' in obj) {
    if (typeof obj.text !== 'string') throw new ApiFailure(400, 'invalid_field', 'text must be a string');
    const text = normalizeText(obj.text);
    if (!text) throw new ApiFailure(400, 'invalid_field', 'text must not be empty');
    if (byteLength(text) > MAX_TEXT_BYTES) throw new ApiFailure(413, 'too_large', `text exceeds ${MAX_TEXT_BYTES} bytes`);
    patch.text = text;
  }
  if ('kind' in obj) patch.kind = validateKind(obj.kind);
  if ('tags' in obj) patch.tags = validateTags(obj.tags);
  if ('pinned' in obj) {
    if (typeof obj.pinned !== 'boolean') throw new ApiFailure(400, 'invalid_field', 'pinned must be a boolean');
    patch.pinned = obj.pinned;
  }
  if ('importance' in obj) {
    if (typeof obj.importance !== 'number' || !Number.isInteger(obj.importance) || obj.importance < 1 || obj.importance > MAX_IMPORTANCE) {
      throw new ApiFailure(400, 'invalid_field', `importance must be an integer in 1..${MAX_IMPORTANCE}`);
    }
    patch.importance = obj.importance;
  }
  if ('evidence' in obj) patch.evidence = validateEvidence(obj.evidence);
  if ('supersededBy' in obj) {
    if (obj.supersededBy !== null) {
      throw new ApiFailure(400, 'unsupported_supersede', 'a fact can only be un-superseded here; create a new fact with `supersedes`');
    }
    patch.supersededBy = null;
  }
  if (Object.keys(patch).length === 0) {
    throw new ApiFailure(400, 'invalid_body', 'nothing to update: provide text, kind, tags, pinned, importance or supersededBy');
  }
  return patch;
}

export interface SearchParams {
  project: string | null;
  kind: FactKind | null;
  tag: string | null;
  q: string | null;
  /** Reverse lookup: facts whose evidence names this path. */
  file: string | null;
  sort: SortMode;
  pinnedOnly: boolean;
  includeSuperseded: boolean;
  limit: number;
  cursor: string | null;
}

function parseLimit(raw: string | null, fallback: number, max: number): number {
  if (raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw new ApiFailure(400, 'invalid_field', `limit must be an integer in 1..${max}`);
  }
  return n;
}

function parseFlag(raw: string | null): boolean {
  return raw === '1' || raw === 'true';
}

export function parseSearchParams(params: URLSearchParams, opts: { defaultLimit?: number; maxLimit?: number } = {}): SearchParams {
  const all = parseFlag(params.get('all'));
  const projectRaw = params.get('project');
  if (!all && !projectRaw) throw new ApiFailure(400, 'invalid_field', 'project is required (or pass all=1)');
  const kindRaw = params.get('kind');
  const tagRaw = params.get('tag');
  const qRaw = params.get('q');
  const fileRaw = params.get('file');
  const sortRaw = params.get('sort');
  if (sortRaw && sortRaw !== 'recent' && sortRaw !== 'rank') {
    throw new ApiFailure(400, 'invalid_field', 'sort must be recent or rank');
  }
  const sort: SortMode = sortRaw === 'rank' ? 'rank' : 'recent';
  const cursor = params.get('cursor');
  if (sort === 'rank' && cursor) {
    throw new ApiFailure(400, 'invalid_cursor', 'cursor cannot be combined with sort=rank (rank is top-N only)');
  }
  if (tagRaw && !TAG_RE.test(tagRaw)) throw new ApiFailure(400, 'invalid_field', 'tag must be 1-32 chars without spaces or commas');
  if (qRaw && qRaw.trim().length > 100) throw new ApiFailure(400, 'invalid_field', 'q is too long (max 100)');
  return {
    project: all ? null : validateProject(projectRaw),
    kind: kindRaw ? validateKind(kindRaw) : null,
    tag: tagRaw ? tagRaw.trim().toLowerCase() : null,
    q: qRaw && qRaw.trim() ? qRaw.trim() : null,
    file: fileRaw ? normalizeEvidencePath(fileRaw, 'file') : null,
    sort,
    pinnedOnly: parseFlag(params.get('pinned')),
    includeSuperseded: parseFlag(params.get('include_superseded')),
    limit: parseLimit(params.get('limit'), opts.defaultLimit ?? DEFAULT_LIMIT, opts.maxLimit ?? MAX_LIMIT),
    cursor,
  };
}

/** `180d` / `12h` / `30` (days) -> whole days, at least 1. */
export function parseDurationDays(input: string): number {
  const match = /^(\d+)\s*([dhm]?)$/i.exec(input.trim());
  if (!match) throw new ApiFailure(400, 'invalid_field', 'older must look like 180d, 12h or 30');
  const value = Number(match[1]);
  const unit = (match[2] || 'd').toLowerCase();
  const hours = unit === 'h' ? value : unit === 'm' ? value / 60 : value * 24;
  return Math.max(1, Math.ceil(hours / 24));
}