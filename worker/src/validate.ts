import { ApiFailure } from './errors.ts';
import {
  DEFAULT_IMPORTANCE,
  DEFAULT_LIMIT,
  FACT_KINDS,
  MAX_IMPORTANCE,
  MAX_LIMIT,
  MAX_PROJECT_LEN,
  MAX_TAG_LEN,
  MAX_TAGS,
  MAX_TEXT_BYTES,
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
  };
}

export interface FactPatch {
  text?: string;
  kind?: FactKind;
  tags?: string[];
  pinned?: boolean;
  importance?: number;
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