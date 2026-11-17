/**
 * The subset of the D1 API this worker uses.
 *
 * Declaring it locally keeps the runtime surface small and lets tests run the
 * same code against `node:sqlite` without pulling in worker type globals.
 */
export interface DbMeta {
  changes: number;
  last_row_id?: number;
  duration?: number;
}

export interface DbResult<T> {
  results: T[];
  success: boolean;
  meta: DbMeta;
}

export interface DbStatement {
  bind(...values: unknown[]): DbStatement;
  first<T = unknown>(column?: string): Promise<T | null>;
  all<T = unknown>(): Promise<DbResult<T>>;
  run(): Promise<{ success: boolean; meta: DbMeta }>;
}

export interface Db {
  prepare(sql: string): DbStatement;
  batch<T = unknown>(statements: DbStatement[]): Promise<DbResult<T>[]>;
  exec(sql: string): Promise<unknown>;
}