import { ApiFailure } from './errors.ts';
import {
  DEFAULT_LIMIT,
  FACT_KINDS,
  MAX_LIMIT,
  MAX_PROJECT_LEN,
  MAX_TAG_LEN,
  MAX_TAGS,
  MAX_TEXT_BYTES,
  type FactKind,
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
  };
}

export interface FactPatch {
  text?: string;
  kind?: FactKind;
  tags?: string[];
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
  if (patch.text === undefined && patch.kind === undefined && patch.tags === undefined) {
    throw new ApiFailure(400, 'invalid_body', 'nothing to update: provide text, kind or tags');
  }
  return patch;
}

export interface SearchParams {
  project: string | null;
  kind: FactKind | null;
  tag: string | null;
  q: string | null;
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

export function parseSearchParams(params: URLSearchParams, opts: { defaultLimit?: number; maxLimit?: number } = {}): SearchParams {
  const all = params.get('all') === '1' || params.get('all') === 'true';
  const projectRaw = params.get('project');
  if (!all && !projectRaw) throw new ApiFailure(400, 'invalid_field', 'project is required (or pass all=1)');
  const kindRaw = params.get('kind');
  const tagRaw = params.get('tag');
  const qRaw = params.get('q');
  if (tagRaw && !TAG_RE.test(tagRaw)) throw new ApiFailure(400, 'invalid_field', 'tag must be 1-32 chars without spaces or commas');
  if (qRaw && qRaw.trim().length > 100) throw new ApiFailure(400, 'invalid_field', 'q is too long (max 100)');
  return {
    project: all ? null : validateProject(projectRaw),
    kind: kindRaw ? validateKind(kindRaw) : null,
    tag: tagRaw ? tagRaw.trim().toLowerCase() : null,
    q: qRaw && qRaw.trim() ? qRaw.trim() : null,
    limit: parseLimit(params.get('limit'), opts.defaultLimit ?? DEFAULT_LIMIT, opts.maxLimit ?? MAX_LIMIT),
    cursor: params.get('cursor'),
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