#!/usr/bin/env node
/**
 * Fails when the deployed D1 schema is behind the migration files.
 *
 *   wrangler d1 execute loam --remote --json \
 *     --command "SELECT name FROM pragma_table_info('facts')" \
 *     | node scripts/check-d1-schema.mjs
 *
 * Checks every `ADD COLUMN` declared by worker/migrations/*.sql. That keeps the
 * guard in sync with future migrations instead of hardcoding today's four
 * columns. It does not inspect new tables or triggers; the offline migration
 * test covers the schema/migration convergence, and the deploy smoke covers
 * the runtime.
 */

import fs from 'node:fs';
import path from 'node:path';

const raw = fs.readFileSync(0, 'utf8');
const start = raw.indexOf('[');
if (start < 0) {
  console.error('无法解析 wrangler 输出：缺少 JSON 数组');
  process.exit(1);
}

let entries;
try {
  entries = JSON.parse(raw.slice(start));
} catch {
  console.error('无法解析 wrangler JSON');
  process.exit(1);
}

const columns = new Set(
  entries.flatMap((entry) => entry.results ?? []).map((row) => String(row.name)),
);
if (columns.size === 0) {
  console.error('线上 facts 表不存在：全新库请先执行 worker/schema.sql --remote');
  process.exit(1);
}

const base = ['id', 'project', 'kind', 'text', 'hash', 'tags', 'harness', 'device_id', 'device_name', 'created_at', 'deleted_at'];
const missing = base.filter((column) => !columns.has(column));

const migrationDir = path.join(import.meta.dirname, '..', 'worker', 'migrations');
const files = fs
  .readdirSync(migrationDir)
  .filter((file) => file.endsWith('.sql'))
  .sort();
for (const file of files) {
  const sql = fs.readFileSync(path.join(migrationDir, file), 'utf8');
  for (const match of sql.matchAll(/ADD COLUMN\s+([A-Za-z_]\w*)/g)) {
    if (!columns.has(match[1])) missing.push(`${match[1]} (${file})`);
  }
}

if (missing.length > 0) {
  console.error(`D1 schema 缺列：${missing.join(', ')}`);
  console.error('先执行对应的 worker/migrations/*.sql --remote，再部署。');
  process.exit(1);
}
console.log(`✓ D1 schema：${columns.size} 列，迁移声明的列全部存在`);