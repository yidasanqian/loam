-- loam v1 schema (D1 / SQLite). Apply with:
--   wrangler d1 execute loam --file=./schema.sql --local
--   wrangler d1 execute loam --file=./schema.sql --remote
-- Facts are soft-deleted: row writes stay cheap and dedupe hashes stay unique.

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL DEFAULT 'read,write',
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER
);

CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('decision', 'pitfall', 'convention', 'fact')),
  text TEXT NOT NULL,
  hash TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  harness TEXT NOT NULL,
  device_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS facts_project_hash ON facts (project, hash);
CREATE INDEX IF NOT EXISTS facts_project_created ON facts (project, created_at DESC);
CREATE INDEX IF NOT EXISTS facts_created ON facts (created_at DESC);
CREATE INDEX IF NOT EXISTS devices_created ON devices (created_at DESC);