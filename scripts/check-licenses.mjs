#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaces = ['worker', 'cli'];
const allowed = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
  'BlueOak-1.0.0',
]);

function isAllowed(license) {
  if (!license) return false;
  const parts = license
    .replace(/[()]/gu, '')
    .split(/\s+(?:OR|AND)\s+/iu)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 && parts.every((part) => allowed.has(part));
}

const packages = new Map();
for (const workspace of workspaces) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, workspace, 'package.json'), 'utf8'));
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
    if (!packages.has(name)) packages.set(name, workspace);
  }
}

const resolvers = new Map(
  workspaces.map((workspace) => [workspace, createRequire(path.join(root, workspace, 'package.json'))]),
);

const rows = [];
const missing = [];
const violations = [];
for (const [name, workspace] of packages) {
  let manifest = null;
  try {
    manifest = resolvers.get(workspace).resolve(`${name}/package.json`);
  } catch {
    const candidates = [
      path.join(root, workspace, 'node_modules', name, 'package.json'),
      path.join(root, 'node_modules', name, 'package.json'),
    ];
    manifest = candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
  }
  if (!manifest) {
    missing.push(name);
    continue;
  }
  const dep = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  const license = typeof dep.license === 'string' ? dep.license : (dep.licenses ?? []).map((entry) => entry.type).join(' OR ');
  rows.push({ name, version: dep.version, license, workspace });
  if (!isAllowed(license)) violations.push({ name, license });
}

for (const row of rows.sort((a, b) => a.name.localeCompare(b.name))) {
  console.log(`${row.name.padEnd(36)} ${String(row.version).padEnd(12)} ${(row.license || 'UNKNOWN').padEnd(18)} ${row.workspace}`);
}

if (missing.length > 0) {
  const message = `依赖未安装，无法核对许可证: ${missing.join(', ')}`;
  if (process.env.CI) {
    console.error(message);
    process.exit(1);
  }
  console.warn(`${message}（先运行 pnpm install）`);
}

if (violations.length > 0) {
  console.error('许可证不在白名单:');
  for (const item of violations) console.error(`- ${item.name}: ${item.license ?? 'UNKNOWN'}`);
  process.exit(1);
}

if (rows.length > 0) console.log(`\n${rows.length} 个依赖全部在白名单内。`);