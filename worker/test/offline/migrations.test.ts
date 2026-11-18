import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

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

  const fresh = new DatabaseSync(':memory:');
  fresh.exec(readWorker('schema.sql'));

  assert.deepEqual(columns(legacy, 'facts'), columns(fresh, 'facts'));
  assert.deepEqual(indexes(legacy, 'facts'), indexes(fresh, 'facts'));
  assert.deepEqual(columns(legacy, 'devices'), columns(fresh, 'devices'));

  const factsColumns = columns(fresh, 'facts');
  for (const column of ['pinned', 'importance', 'superseded_by', 'superseded_at']) {
    assert.ok(factsColumns.includes(column), `fresh schema is missing ${column}`);
  }
  assert.ok(indexes(fresh, 'facts').includes('facts_project_rank'));
  assert.ok(indexes(fresh, 'facts').includes('facts_superseded'));
});