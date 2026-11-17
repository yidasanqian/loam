import { readFileSync } from 'node:fs';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { Db, DbResult, DbStatement } from '../../src/db.ts';

/**
 * D1-shaped adapter over `node:sqlite`, used by the offline test suite so the
 * real SQL (schema, dedupe, keyset pagination) runs without workerd.
 */
class ShimStatement implements DbStatement {
  private readonly statement: StatementSync;
  private readonly params: unknown[];

  constructor(statement: StatementSync, params: unknown[] = []) {
    this.statement = statement;
    this.params = params;
  }

  bind(...values: unknown[]): DbStatement {
    return new ShimStatement(this.statement, values);
  }

  async first<T = unknown>(column?: string): Promise<T | null> {
    const row = this.statement.get(...(this.params as never[])) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }

  async all<T = unknown>(): Promise<DbResult<T>> {
    const rows = this.statement.all(...(this.params as never[])) as T[];
    return { results: rows, success: true, meta: { changes: 0 } };
  }

  async run(): Promise<{ success: boolean; meta: { changes: number; last_row_id: number } }> {
    const result = this.statement.run(...(this.params as never[]));
    return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
}

export class SqliteDb implements Db {
  private readonly raw: DatabaseSync;

  constructor(raw: DatabaseSync = new DatabaseSync(':memory:')) {
    this.raw = raw;
  }

  prepare(sql: string): DbStatement {
    return new ShimStatement(this.raw.prepare(sql));
  }

  async batch<T = unknown>(statements: DbStatement[]): Promise<DbResult<T>[]> {
    const results: DbResult<T>[] = [];
    for (const statement of statements) {
      const result = await statement.run();
      results.push({ results: [], success: result.success, meta: result.meta });
    }
    return results;
  }

  async exec(sql: string): Promise<unknown> {
    this.raw.exec(sql);
    return undefined;
  }
}

export function createTestDb(): SqliteDb {
  const db = new SqliteDb();
  const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
  db.exec(schema);
  return db;
}