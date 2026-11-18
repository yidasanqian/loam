#!/usr/bin/env node
/**
 * Fails when the workbench uses a translation key that i18n.js does not define.
 *
 *   node scripts/check-i18n.mjs
 *
 * Covers `data-i18n*` attributes in index.html and literal `t('…')` calls in the
 * JS modules. Template-literal keys are allowed only for the four `kind.*` names,
 * which are enumerated explicitly.
 */

import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', 'worker', 'public');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

const used = new Set();
const dynamic = [];

for (const match of read('index.html').matchAll(/data-i18n(?:-placeholder|-aria)?="([^"]+)"/g)) {
  used.add(match[1]);
}

for (const file of ['app.js', 'views.js', 'overlays.js', 'i18n.js']) {
  const text = read(file);
  for (const match of text.matchAll(/\bt\(\s*'([^']+)'/g)) used.add(match[1]);
  for (const match of text.matchAll(/\bt\(\s*`([^`]+)`/g)) dynamic.push(`${file}: t(\`${match[1]}\`)`);
}

const kinds = ['decision', 'pitfall', 'convention', 'fact'];
for (const kind of kinds) used.add(`kind.${kind}`);

const defined = new Set([...read('i18n.js').matchAll(/^\s*'([^']+)':\s*\[/gm)].map((match) => match[1]));
const missing = [...used].filter((key) => !defined.has(key));
const unused = [...defined].filter((key) => !used.has(key));
const unexpectedDynamic = dynamic.filter((entry) => !entry.includes('kind.'));

if (unexpectedDynamic.length > 0) {
  console.error(`动态 key 需要显式登记：\n  ${unexpectedDynamic.join('\n  ')}`);
}
if (missing.length > 0) {
  console.error(`缺少文案：\n  ${missing.join('\n  ')}`);
}
if (unused.length > 0) {
  console.log(`未使用的文案（可删）：${unused.join(', ')}`);
}
if (missing.length > 0 || unexpectedDynamic.length > 0) process.exit(1);
console.log(`✓ i18n: ${used.size} 个 key 全部有定义`);