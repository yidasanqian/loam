#!/usr/bin/env node
/**
 * Builds the Cloudflare Pages output directory.
 *
 *   node scripts/build-pages.mjs
 *
 * Copies `worker/public` to `pages/public` (gitignored) and adds the Pages-only
 * `_routes.json`, so `/v1/*` and `/health` go to Functions while every other path
 * is served as a static asset. Keeping the copy out of `worker/public` means the
 * Worker deploy never ships a Pages routing file.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'worker', 'public');
const OUT = path.join(ROOT, 'pages', 'public');

if (!fs.existsSync(path.join(SRC, 'index.html'))) {
  console.error(`缺少 ${path.join(SRC, 'index.html')}：worker/public 不是完整的工作台产物`);
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(SRC, OUT, { recursive: true });
fs.writeFileSync(
  path.join(OUT, '_routes.json'),
  `${JSON.stringify({ version: 1, include: ['/v1/*', '/health'], exclude: [] }, null, 2)}\n`,
);

console.error(`✓ pages/public 就绪（${fs.readdirSync(OUT).length} 个文件，含 _routes.json）`);