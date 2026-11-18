-- loam schema (D1 / SQLite). Apply with:
--   wrangler d1 execute loam --file=./schema.sql --local
--   wrangler d1 execute loam --file=./schema.sql --remote
-- Facts are soft-deleted: row writes stay cheap and dedupe hashes stay unique.
--
-- Upgrading an existing database: run migrations/0002-memory-shape.sql instead.
-- New columns carry no CHECK constraints (see that file for why); value ranges
-- are enforced in worker/src/validate.ts.

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
  pinned INTEGER NOT NULL DEFAULT 0,
  importance INTEGER NOT NULL DEFAULT 3,
  evidence TEXT NOT NULL DEFAULT '',
  superseded_by TEXT,
  superseded_at INTEGER,
  device_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS facts_project_hash ON facts (project, hash);
CREATE INDEX IF NOT EXISTS facts_project_created ON facts (project, created_at DESC);
CREATE INDEX IF NOT EXISTS facts_project_rank ON facts (project, pinned DESC, importance DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS facts_superseded ON facts (superseded_by);
CREATE INDEX IF NOT EXISTS facts_created ON facts (created_at DESC);
CREATE INDEX IF NOT EXISTS devices_created ON devices (created_at DESC);