-- loam 0.3 memory shape (D1 / SQLite). Apply once per database:
--   wrangler d1 execute loam --local  --file=./migrations/0002-memory-shape.sql
--   wrangler d1 execute loam --remote --file=./migrations/0002-memory-shape.sql
--
-- Additive only: old code ignores these columns, so a rollback of the code does
-- not require a rollback of the schema. Back up first with `loam export`.
--
-- No CHECK constraints on the new columns: SQLite cannot add a CHECK to an
-- existing table, and writing one in schema.sql only would leave fresh and
-- migrated databases with different rules. Range checks live in validate.ts.

ALTER TABLE facts ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE facts ADD COLUMN importance INTEGER NOT NULL DEFAULT 3;
ALTER TABLE facts ADD COLUMN superseded_by TEXT;
ALTER TABLE facts ADD COLUMN superseded_at INTEGER;

CREATE INDEX IF NOT EXISTS facts_project_rank ON facts (project, pinned DESC, importance DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS facts_superseded ON facts (superseded_by);