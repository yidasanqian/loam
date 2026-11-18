#!/usr/bin/env node
/**
 * Applies worker/migrations to a D1 database by emitting only the statements the
 * target is still missing, so the deploy job and a local deploy share one path
 * and neither needs a human to run wrangler by hand.
 *
 *   node scripts/apply-d1-migrations.mjs --remote   # deployed D1 (deploy job, `pnpm deploy`)
 *   node scripts/apply-d1-migrations.mjs --local    # local .wrangler state
 *   ... | node scripts/apply-d1-migrations.mjs      # stdin: state rows -> SQL on stdout
 *
 * Only replayable statements are emitted: `ADD COLUMN` for a column the target
 * still lacks, and `CREATE ... IF NOT EXISTS` for an object that is not there
 * yet. Anything else (DROP, plain INSERT/UPDATE, CREATE without IF NOT EXISTS)
 * exits 1 on purpose: non-repeatable or destructive SQL needs a human, and the
 * deploy must stop before it ships code that expects the new shape.
 *
 * Idempotent by construction, so it is safe on every deploy and needs no
 * migration tracker next to the files. A fresh database is created first by
 * `wrangler d1 execute loam --file=schema.sql`, which is what `db:init*` does.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const HERE = import.meta.dirname;
const WORKER_DIR = path.join(HERE, '..', 'worker');

/** One round trip: every column of every table plus every named object. */
const STATE_QUERY =
  "SELECT 'column' AS kind, m.name AS tbl, p.name AS name FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table' UNION ALL SELECT 'object' AS kind, '' AS tbl, name FROM sqlite_master WHERE type IN ('table','index','view','trigger')";

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** wrangler prints a banner before its JSON array; slice at the first bracket. */
function remoteState(raw) {
  const start = raw.indexOf('[');
  if (start < 0) throw new Error('无法解析 wrangler 输出：缺少 JSON 数组');
  let entries;
  try {
    entries = JSON.parse(raw.slice(start));
  } catch {
    throw new Error('无法解析 wrangler JSON');
  }
  const columns = new Set();
  const objects = new Set();
  for (const row of entries.flatMap((entry) => entry.results ?? [])) {
    if (row.kind === 'object') {
      objects.add(String(row.name));
    } else if (row.tbl && row.name) {
      columns.add(`${String(row.tbl)}.${String(row.name)}`);
    } else if (row.name) {
      // Older callers pipe `SELECT name FROM pragma_table_info('facts')`, which
      // has no table column: everything in it belongs to facts.
      columns.add(`facts.${String(row.name)}`);
    }
  }
  return { columns, objects };
}

function statements(sql) {
  return sql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

const ALTER_ADD = /^ALTER\s+TABLE\s+([\w."]+)\s+ADD\s+COLUMN\s+(\w+)\s+([\s\S]+)$/i;
const CREATE_IF_ABSENT = /^CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|VIEW|TRIGGER)\s+IF\s+NOT\s+EXISTS\s+([\w."]+)/i;

function planStatements(state, dir) {
  const files = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  const plan = { statements: [], skipped: [] };
  for (const file of files) {
    for (const statement of statements(fs.readFileSync(path.join(dir, file), 'utf8'))) {
      const alter = ALTER_ADD.exec(statement);
      if (alter) {
        const key = `${alter[1].replace(/"/g, '')}.${alter[2]}`;
        if (state.columns.has(key)) {
          plan.skipped.push(`${key} (${file})`);
          continue;
        }
        plan.statements.push(`${statement};`);
        continue;
      }
      const create = CREATE_IF_ABSENT.exec(statement);
      if (create) {
        const name = create[1].replace(/"/g, '');
        if (state.objects.has(name)) {
          plan.skipped.push(`${name} (${file})`);
          continue;
        }
        plan.statements.push(`${statement};`);
        continue;
      }
      throw new Error(`${file}: 语句不是可重复执行的，需要人工处理：${statement.split('\n')[0]}`);
    }
  }
  return plan;
}

/**
 * Runs wrangler's own entry with the current node binary. Going through
 * `pnpm exec` would need a shell on Windows (`.cmd` shims are EINVAL for
 * spawnSync), and the deploy job does not put node_modules/.bin on PATH either.
 */
function wrangler(args, target) {
  const bin = wranglerEntry();
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: WORKER_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw new Error(`跑不起 wrangler：${result.error.message}`);
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim().split('\n').slice(-6).join(' ');
    throw new Error(`wrangler d1 execute 失败（${target}）：${detail}`);
  }
  return result.stdout ?? '';
}

function wranglerEntry() {
  const candidates = [];
  try {
    candidates.push(createRequire(path.join(WORKER_DIR, 'package.json')).resolve('wrangler/package.json'));
  } catch {
    // Exports maps may hide package.json; the hoisted path still works.
  }
  candidates.push(path.join(WORKER_DIR, 'node_modules', 'wrangler', 'package.json'));
  for (const pkgPath of candidates) {
    if (!fs.existsSync(pkgPath)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.wrangler;
    if (!bin) continue;
    const entry = path.join(path.dirname(pkgPath), bin);
    if (fs.existsSync(entry)) return entry;
  }
  throw new Error('找不到 wrangler：先在 worker/ 下 pnpm install');
}

function report(plan) {
  if (plan.skipped.length > 0) console.error(`· 已存在，跳过：${plan.skipped.join(', ')}`);
  if (plan.statements.length === 0) {
    console.error('✓ D1 schema 已是最新，无需变更');
    return;
  }
  console.error(`· 待执行 ${plan.statements.length} 条语句`);
}

function apply(target) {
  const flag = `--${target}`;
  const { columns, objects } = remoteState(wrangler(['d1', 'execute', 'loam', flag, '--json', '--command', STATE_QUERY], target));
  const plan = planStatements({ columns, objects }, path.join(WORKER_DIR, 'migrations'));
  report(plan);
  if (plan.statements.length === 0) return;

  const file = path.join(os.tmpdir(), `loam-d1-${target}-${process.pid}.sql`);
  fs.writeFileSync(file, `${plan.statements.join('\n')}\n`);
  try {
    wrangler(['d1', 'execute', 'loam', flag, '--file', file, ...(target === 'remote' ? ['-y'] : [])], target);
  } finally {
    fs.rmSync(file, { force: true });
  }
  console.error(`✓ 已应用 ${plan.statements.length} 条语句（${target}）`);
}

function main() {
  const argv = process.argv.slice(2);
  const target = argv.includes('--remote') ? 'remote' : argv.includes('--local') ? 'local' : null;

  if (target) {
    try {
      apply(target);
    } catch (error) {
      console.error(`✗ ${error.message}`);
      process.exit(1);
    }
    return;
  }

  const dirIndex = argv.indexOf('--dir');
  const dir = dirIndex >= 0 && argv[dirIndex + 1] ? argv[dirIndex + 1] : path.join(WORKER_DIR, 'migrations');

  let plan;
  try {
    plan = planStatements(remoteState(readStdin()), dir);
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  }
  report(plan);
  if (plan.statements.length > 0) process.stdout.write(`${plan.statements.join('\n')}\n`);
}

main();