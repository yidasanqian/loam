#!/usr/bin/env node
/**
 * Seed a local wrangler dev database with sample facts for the workbench.
 *
 *   node scripts/seed-dev.mjs --server http://127.0.0.1:8787 --token loam_xxxx
 *
 * Never point this at a deployed worker; it writes 3 projects × 16 facts.
 */

const args = process.argv.slice(2);

function arg(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const server = arg('server', 'http://127.0.0.1:8787').replace(/\/+$/, '');
const token = arg('token', process.env.LOAM_TOKEN ?? '');
const projects = arg('projects', 'loam,alpha,beta')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);

if (!token) {
  console.error('缺少 token：--token loam_... 或 LOAM_TOKEN');
  process.exit(2);
}

const KINDS = ['decision', 'pitfall', 'convention', 'fact'];
const SAMPLES = {
  decision: [
    '用 Hono 承载 Worker 路由与中间件',
    'D1 是唯一真相源，不做第二后端',
    '不做 MCP，用 CLI + skill 接入',
    '单条记忆控制在 4 KB 以内',
  ],
  pitfall: [
    '标记块必须幂等，否则重装会重复注入',
    'last_seen 写库要节流，不然烧 D1 写配额',
    'workers.dev 在部分网络下需要代理',
    'Windows 参数解析用 commander 更稳',
  ],
  convention: [
    'search 默认 5 条、每行 100 字符',
    'project 名只允许字母数字与 ._@:/-',
    '所有时间字段用毫秒时间戳',
    '错误响应统一 { error: { code, message } }',
  ],
  fact: [
    'vitest 官方池可以测 D1 binding',
    'node:sqlite 能跑真实 schema 的离线套件',
    'Workers 免费层 CPU 上限 10ms',
    'Node 24 的 fetch 才读 HTTPS_PROXY',
  ],
};

async function post(body) {
  const response = await fetch(`${server}/v1/facts`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${response.status}: ${data?.error?.message ?? text}`);
  return data;
}

async function main() {
  let created = 0;
  let supersedeTarget = null;
  for (const project of projects) {
    for (const kind of KINDS) {
      for (const [index, text] of SAMPLES[kind].entries()) {
        const pinned = index === 0 && kind === 'decision';
        const data = await post({
          project,
          kind,
          text,
          tags: [kind, index % 2 === 0 ? 'seed' : 'sample'],
          harness: 'seed',
          importance: pinned ? 5 : (index % 4) + 2,
          pinned,
        });
        if (data.deduped !== true) created += 1;
        if (kind === 'decision' && index === 1) supersedeTarget = data.fact?.id ?? supersedeTarget;
      }
    }
    if (supersedeTarget) {
      await post({
        project,
        kind: 'decision',
        text: 'D1 是唯一真相源（已改为 Hono + D1 组合）',
        tags: ['decision', 'seed'],
        harness: 'seed',
        importance: 4,
        supersedes: supersedeTarget,
      });
      supersedeTarget = null;
    }
  }
  console.log(`✓ ${created} 条新事实写入 ${projects.join(', ')}（${server}）`);
  console.log('  打开 http://127.0.0.1:8787 查看工作台；原理视图的计数来自 /v1/stats。');
}

main().catch((error) => {
  console.error('seed failed:', error.message);
  process.exit(1);
});