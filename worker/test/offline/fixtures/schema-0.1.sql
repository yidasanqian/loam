-- loam 0.1 facts/devices schema, frozen as a fixture for the upgrade test.
-- Do not edit: it represents what an existing production database looks like
-- before worker/migrations/0002-memory-shape.sql runs.

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