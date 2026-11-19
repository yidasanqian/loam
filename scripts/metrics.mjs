#!/usr/bin/env node
/**
 * 宣传期的外部可见指标采集。
 *
 *   node scripts/metrics.mjs            # 输出 Markdown 表格，可直接贴进归档
 *   node scripts/metrics.mjs --json     # 输出 JSON，便于逐周 diff
 *
 * 只采外部能观测到的：GitHub 14 天流量、仓库热度、npm 版本与下载。
 * 自托管实例的活跃度在用户自己的 D1 里，这里不采、也不该采。
 *
 * GitHub 的 traffic 只保留 14 天，所以这个脚本的价值全在「每周跑一次并留档」。
 */

import { execFileSync } from 'node:child_process';

const REPO = 'yidasanqian/loam';
const PKG = '@yidasanqian/loam';
const JSON_OUT = process.argv.includes('--json');

function gh(path, jq) {
  try {
    const out = execFileSync('gh', ['api', path, '--jq', jq], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(out);
  } catch (error) {
    const message = String(error.stderr || error.message || '').trim().split('\n')[0];
    return { error: message || 'gh api failed' };
  }
}

async function json(url) {
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (!response.ok) return { error: `HTTP ${response.status}` };
    return await response.json();
  } catch (error) {
    return { error: String(error.message || error) };
  }
}

const views = gh(`repos/${REPO}/traffic/views`, '{count: .count, uniques: .uniques}');
const clones = gh(`repos/${REPO}/traffic/clones`, '{count: .count, uniques: .uniques}');
const referrers = gh(`repos/${REPO}/traffic/referrers`, '[.[] | {referrer: .referrer, count: .count, uniques: .uniques}]');
const repo = gh(`repos/${REPO}`, '{stars: .stargazers_count, forks: .forks_count, watchers: .subscribers_count, issues: .open_issues_count}');

const registry = await json(`https://registry.npmjs.org/${encodeURIComponent(PKG).replace('%40', '@')}`);
const latest = registry['dist-tags']?.latest ?? null;
const published = latest ? registry.time?.[latest] ?? null : null;
const downloads = await json(`https://api.npmjs.org/downloads/point/last-month/${PKG}`);

const rows = [
  ['GitHub views（14 天）', views.error ?? views.count, 'traffic/views'],
  ['GitHub unique visitors（14 天）', views.error ?? views.uniques, 'traffic/views'],
  ['clones（14 天）', clones.error ?? `${clones.count} / ${clones.uniques} unique`, 'traffic/clones'],
  ['stars', repo.error ?? repo.stars, 'repos'],
  ['forks', repo.error ?? repo.forks, 'repos'],
  ['watchers', repo.error ?? repo.watchers, 'repos'],
  ['open issues', repo.error ?? repo.issues, 'repos'],
  ['npm 最新版本', latest ?? registry.error ?? '—', 'registry'],
  ['npm 该版本发布时间', published ?? '—', 'registry'],
  ['npm 下载（30 天）', downloads.error ? `无记录（${downloads.error}）` : downloads.downloads, 'downloads/point'],
];

const sources = Array.isArray(referrers)
  ? referrers.filter((row) => row.referrer && row.referrer !== 'github.com')
  : [];

const snapshot = {
  at: new Date().toISOString(),
  views,
  clones,
  repo,
  referrers: sources,
  npm: { latest, published, downloads },
};

if (JSON_OUT) {
  console.log(JSON.stringify(snapshot, null, 2));
  process.exit(0);
}

console.log(`# loam 外部指标 · ${new Date().toISOString().slice(0, 10)}\n`);
console.log('| 指标 | 值 | 数据源 |');
console.log('|---|---|---|');
for (const [name, value, source] of rows) console.log(`| ${name} | ${value} | ${source} |`);

console.log('\n## 外部来源\n');
if (sources.length === 0) {
  console.log(referrers?.error ? `取不到来源数据：${referrers.error}` : '暂无外部来源（全部是直接访问或你自己的 clone）。');
} else {
  console.log('| 来源 | 访问 / 独立访客 |');
  console.log('|---|---|');
  for (const row of sources) console.log(`| ${row.referrer} | ${row.count} / ${row.uniques} |`);
}

console.log('\n> traffic 只保留 14 天；每周跑一次并把输出追加到归档，才看得出趋势。');