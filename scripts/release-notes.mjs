#!/usr/bin/env node
/**
 * 生成 GitHub Release 正文：英文在上，中文在下。
 *
 *   node scripts/release-notes.mjs v0.5.0 > release-notes.md
 *
 * 英文段取自 CHANGELOG.en.md，中文段取自 CHANGELOG.md，都是 `## [x.y.z]` 到下一个
 * `## ` 之间的内容。任一侧缺段落或段落为空即退出非零：半双语发布比报错更难发现。
 */

import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const version = (process.argv[2] ?? '').replace(/^v/, '');

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('用法: node scripts/release-notes.mjs v0.5.0');
  process.exit(1);
}

function section(file) {
  const lines = fs.readFileSync(path.join(root, file), 'utf8').split(/\r?\n/);
  const heading = new RegExp(`^## \\[${version.replaceAll('.', '\\.')}\\]`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) {
    console.error(`${file} 缺少 [${version}] 段落`);
    process.exit(2);
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
  if (body === '') {
    console.error(`${file} 的 [${version}] 段落为空`);
    process.exit(2);
  }
  return body;
}

const english = section('CHANGELOG.en.md');
const chinese = section('CHANGELOG.md');

process.stdout.write(`### English\n\n${english}\n\n---\n\n### 中文\n\n${chinese}\n`);