export const FACT_KINDS = ['decision', 'pitfall', 'convention', 'fact'] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export const SCOPES = ['read', 'write'] as const;
export type Scope = (typeof SCOPES)[number];

export const SORT_MODES = ['recent', 'rank'] as const;
export type SortMode = (typeof SORT_MODES)[number];

export const VERSION = '0.1.3';

/** Hard limits, asserted in code (SCOPE §量化边界). */
export const MAX_TEXT_BYTES = 4096;
export const MAX_PROJECT_LEN = 128;
export const MAX_TAGS = 8;
export const MAX_TAG_LEN = 32;
export const MAX_PROJECT_FACTS = 20_000;
export const DEFAULT_LIMIT = 5;
export const MAX_LIMIT = 50;
export const EXPORT_LIMIT = 200;
export const IMPORT_BATCH = 200;
export const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;
export const RATE_AUTH_PER_MIN = 10;
export const RATE_API_PER_MIN = 60;

/** Memory shape: importance 1..5, pinned is a soft cap per project. */
export const DEFAULT_IMPORTANCE = 3;
export const MAX_IMPORTANCE = 5;
export const MAX_PINNED_HINT = 8;

export interface Device {
  id: string;
  name: string;
  scopes: Scope[];
}

export interface DeviceRow {
  id: string;
  name: string;
  token_hash: string;
  scopes: string;
  created_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
}

export interface FactRow {
  id: string;
  project: string;
  kind: FactKind;
  text: string;
  hash: string;
  tags: string;
  harness: string;
  pinned: number;
  importance: number;
  superseded_by: string | null;
  superseded_at: number | null;
  device_id: string;
  device_name: string;
  created_at: number;
  deleted_at: number | null;
}

export interface Fact {
  id: string;
  project: string;
  kind: FactKind;
  text: string;
  tags: string[];
  harness: string;
  pinned: boolean;
  importance: number;
  supersededBy: string | null;
  supersededAt: number | null;
  deviceId: string;
  deviceName: string;
  createdAt: number;
}

export function toFact(row: FactRow): Fact {
  return {
    id: row.id,
    project: row.project,
    kind: row.kind,
    text: row.text,
    tags: row.tags ? row.tags.split(',') : [],
    harness: row.harness,
    pinned: row.pinned === 1,
    importance: row.importance ?? DEFAULT_IMPORTANCE,
    supersededBy: row.superseded_by ?? null,
    supersededAt: row.superseded_at ?? null,
    deviceId: row.device_id,
    deviceName: row.device_name,
    createdAt: row.created_at,
  };
}

export function parseScopes(raw: string): Scope[] {
  const wanted = new Set(raw.split(',').map((s) => s.trim()));
  return SCOPES.filter((s) => wanted.has(s));
}