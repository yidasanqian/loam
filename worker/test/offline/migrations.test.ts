import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const readWorker = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const readFixture = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

function columns(db: DatabaseSync, table: string): string[] {
  const rows = db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as Array<{ name: string }>;
  return rows.map((row) => row.name).sort();
}

function indexes(db: DatabaseSync, table: string): string[] {
  const rows = db.prepare(`SELECT name FROM pragma_index_list('${table}')`).all() as Array<{ name: string }>;
  return rows.map((row) => row.name).sort();
}

/**
 * The deploy failure on 2026-11-18 came from running schema.sql against an old
 * database. This test pins the upgrade path instead: 0.1 + migrations must end
 * up with exactly the columns and indexes of a fresh schema.
 */
test('a 0.1 database upgraded by migrations matches a fresh schema', () => {
  const legacy = new DatabaseSync(':memory:');
  legacy.exec(readFixture('./fixtures/schema-0.1.sql'));
  legacy.exec(readWorker('migrations/0002-memory-shape.sql'));
  legacy.exec(readWorker('migrations/0003-fact-evidence.sql'));

  const fresh = new DatabaseSync(':memory:');
  fresh.exec(readWorker('schema.sql'));

  assert.deepEqual(columns(legacy, 'facts'), columns(fresh, 'facts'));
  assert.deepEqual(indexes(legacy, 'facts'), indexes(fresh, 'facts'));
  assert.deepEqual(columns(legacy, 'devices'), columns(fresh, 'devices'));

  const factsColumns = columns(fresh, 'facts');
  for (const column of ['pinned', 'importance', 'evidence', 'superseded_by', 'superseded_at']) {
    assert.ok(factsColumns.includes(column), `fresh schema is missing ${column}`);
  }
  assert.ok(indexes(fresh, 'facts').includes('facts_project_rank'));
  assert.ok(indexes(fresh, 'facts').includes('facts_superseded'));
});

const PLAN_SCRIPT = fileURLToPath(new URL('../../../scripts/apply-d1-migrations.mjs', import.meta.url));

/** The rows the deploy workflow pipes in: every column and every named object. */
function remoteRows(): Array<Record<string, string>> {
  const db = new DatabaseSync(':memory:');
  db.exec(readWorker('schema.sql'));
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
  const rows: Array<Record<string, string>> = [];
  for (const table of tables) {
    const columns = db.prepare(`SELECT name FROM pragma_table_info('${table.name}')`).all() as Array<{ name: string }>;
    for (const column of columns) rows.push({ kind: 'column', tbl: table.name, name: column.name });
  }
  const objects = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index','view','trigger')").all() as Array<{ name: string }>;
  for (const object of objects) rows.push({ kind: 'object', tbl: '', name: object.name });
  return rows;
}

function plan(rows: Array<Record<string, string>>, dir?: string) {
  const args = [PLAN_SCRIPT];
  if (dir) args.push('--dir', dir);
  const result = spawnSync(process.execPath, args, {
    input: JSON.stringify([{ results: rows, success: true }]),
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * The deploy job used to fail when the remote schema was behind, which forced a
 * human to run wrangler before the release could ship. The planner closes that
 * gap: it derives the outstanding DDL from the migration files themselves.
 */
test('the deploy planner emits only the statements the remote still lacks', () => {
  const applied = remoteRows().filter((row) => row.name !== 'evidence');
  const result = plan(applied);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "ALTER TABLE facts ADD COLUMN evidence TEXT NOT NULL DEFAULT '';");
});

test('the deploy planner is a no-op once every column and index exists', () => {
  const result = plan(remoteRows());
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '');
  assert.ok(result.stderr.includes('已是最新'));
});

test('the deploy planner refuses SQL it cannot replay safely', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'loam-migrations-'));
  try {
    writeFileSync(path.join(dir, '0001-destructive.sql'), 'DROP TABLE facts;\n');
    const result = plan([], dir);
    assert.equal(result.status, 1, 'a destructive migration must stop the deploy');
    assert.ok(result.stderr.includes('需要人工处理'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});