#!/usr/bin/env node
/**
 * Syncs the static demo (`demo/`) from `worker/public`.
 *
 *   node scripts/build-demo.mjs
 *
 * Only the six files that come from the product UI are copied; `mock-api.js`,
 * `_headers` and `README.md` stay hand-written in `demo/`. Copying instead of
 * duplicating means the demo cannot drift when the workbench is restyled, and
 * the injected script keeps `mock-api.js` running before the module app boots.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'worker', 'public');
const OUT = path.join(ROOT, 'demo');

const COPIES = ['app.js', 'i18n.js', 'overlays.js', 'views.js', 'styles.css', 'index.html'];
const SCRIPT_MARK = '<!-- demo:mock-api -->';
const CSS_MARK = '/* ---- 静态演示标签';

const DEMO_CSS = `
${CSS_MARK}（demo/mock-api.js 注入） ---- */
.demo-strip {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 14px;
  background: var(--ink, #3f6b4f);
  color: var(--paper, #f6f3ec);
  font-size: 12.5px;
  line-height: 1.45;
  text-align: center;
}
.demo-strip a { color: inherit; text-decoration: underline; }
`;

if (!fs.existsSync(path.join(SRC, 'index.html'))) {
  console.error(`缺少 ${path.join(SRC, 'index.html')}：worker/public 不是完整的工作台产物`);
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });
for (const name of COPIES) {
  if (!fs.existsSync(path.join(SRC, name))) {
    console.error(`缺少 ${path.join(SRC, name)}`);
    process.exit(1);
  }
  fs.copyFileSync(path.join(SRC, name), path.join(OUT, name));
}

const indexPath = path.join(OUT, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
if (!html.includes(SCRIPT_MARK)) {
  const anchor = '<link rel="stylesheet" href="/styles.css">';
  if (!html.includes(anchor)) {
    console.error('index.html 里找不到 styles.css 的 <link>，无法注入演示脚本');
    process.exit(1);
  }
  html = html.replace(anchor, `${anchor}\n    ${SCRIPT_MARK}\n    <script src="/mock-api.js"></script>`);
  fs.writeFileSync(indexPath, html);
}

const cssPath = path.join(OUT, 'styles.css');
let css = fs.readFileSync(cssPath, 'utf8');
if (!css.includes(CSS_MARK)) {
  css += DEMO_CSS;
  fs.writeFileSync(cssPath, css);
}

const written = fs.readdirSync(OUT).sort();
console.error(`✓ demo/ 就绪（${written.length} 个文件：${written.join(', ')}）`);