-- loam 0.3 evidence pointers (D1 / SQLite). Applied automatically by the deploy
-- workflow (scripts/apply-d1-migrations.mjs emits only what the remote lacks);
-- this manual form still works for a one-off:
--   wrangler d1 execute loam --remote --file=./migrations/0003-fact-evidence.sql
--
-- Additive only, like 0002: old code ignores the column, so rolling the code
-- back does not require rolling the schema back. Back up first with `loam export`.
--
-- The column holds JSON `{paths,symbols,check,commit,at}`: pointers a reader can
-- follow, not prose about the claim. No index: the only query is a `%path%` LIKE,
-- which no index can serve, and per-project row counts stay under 20k.

ALTER TABLE facts ADD COLUMN evidence TEXT NOT NULL DEFAULT '';