#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { Command } from 'commander';
import pc from 'picocolors';
import { cacheAgeMinutes, readCache, writeCache } from './cache.ts';
import { Client, activate, type CreateResponse, type DeviceSummary, type Fact, type SearchResponse } from './client.ts';
import { configPath, readConfig, requireConfig, resolveConfig, writeConfig, writeLastRecall } from './config.ts';
import { CliError, OfflineError } from './errors.ts';
import { formatDetail, formatFacts, oneLine, shortId } from './format.ts';
import { doctorChecks } from './install/doctor.ts';
import { install, uninstall } from './install/index.ts';
import { appendOutbox, flushOutbox } from './outbox.ts';
import { detectProject, sanitizeProject } from './project.ts';
import { detectHarness, parseDurationDays, parseTags, promptLine, readStdin, writeFileAtomic } from './util.ts';
import { VERSION } from './version.ts';

const program = new Command();

const PROXY_FLAG = '--use-env-proxy';

function argvProxy(): string | undefined {
  const index = process.argv.indexOf('--proxy');
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : undefined;
}

function configProxy(): string | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(), 'utf8')) as { proxy?: unknown };
    return typeof parsed.proxy === 'string' && parsed.proxy.trim() ? parsed.proxy.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Node >=24 fetches only read HTTPS_PROXY when started with `--use-env-proxy`.
 * Re-exec once so `loam` behaves like curl; the proxy may come from the shell,
 * LOAM_PROXY, `login --proxy`, or ~/.loamrc.json.
 */
function ensureEnvProxy(): void {
  const fromEnv = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
  const proxy = fromEnv ?? process.env.LOAM_PROXY ?? argvProxy() ?? configProxy();
  if (!proxy) return;
  if (process.env.LOAM_PROXY_REEXEC === '1' || process.execArgv.includes(PROXY_FLAG)) {
    process.env.HTTPS_PROXY ??= proxy;
    return;
  }
  const major = Number(process.versions.node.split('.')[0]);
  if (Number.isFinite(major) && major < 24) return;
  const child = spawnSync(process.execPath, [PROXY_FLAG, ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, LOAM_PROXY_REEXEC: '1', HTTPS_PROXY: proxy },
  });
  process.exit(child.status ?? 1);
}

ensureEnvProxy();

async function run(task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch (error) {
    if (error instanceof CliError) {
      console.error(pc.red(`loam: ${error.message}`));
      process.exitCode = error.exitCode;
      return;
    }
    if (error instanceof OfflineError) {
      console.error(pc.yellow(`loam: 网络不可用（${error.message}）；离线写入请用 --offline，之后 loam flush`));
      process.exitCode = 4;
      return;
    }
    console.error(pc.red('loam: 未预期错误'), error);
    process.exitCode = 1;
  }
}

function queueFact(input: { project: string; kind: string; text: string; tags: string[]; harness: string }): void {
  const queued = appendOutbox({ ...input, queuedAt: Date.now() });
  console.log(pc.yellow(`~ 已写入 outbox（${queued} 条待 loam flush）`));
}

function sanitizeDeviceName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 64);
  return cleaned || 'device';
}

async function readAdminToken(file?: string): Promise<string> {
  if (file) {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8').trim();
    } catch {
      throw new CliError('admin_token_unreadable', `读不到 --admin-token-file ${file}`, 2);
    }
    if (text) return text;
    throw new CliError('empty_admin_token_file', `--admin-token-file ${file} 是空的`, 2);
  }
  const fromEnv = process.env.LOAM_ADMIN_TOKEN;
  if (fromEnv) return fromEnv.trim();
  return promptLine('ADMIN_TOKEN: ', true);
}

function isTty(): boolean {
  return Boolean(process.stdin.isTTY);
}

program.name('loam').description('单人 / 多设备 / 多 harness 的项目记忆').version(VERSION, '-v, --version');

program
  .command('login')
  .description('注册当前设备并保存 token（同名设备会轮换 token）')
  .requiredOption('--server <url>', 'worker 地址，如 https://loam.example.workers.dev')
  .option('--name <name>', '设备名（默认主机名）')
  .option('--admin-token-file <file>', '包含 ADMIN_TOKEN 的文件')
  .option('--scopes <scopes>', 'read,write', 'read,write')
  .option('--proxy <url>', 'HTTP 代理，如 http://127.0.0.1:7890')
  .action((options: { server: string; name?: string; adminTokenFile?: string; scopes: string; proxy?: string }) =>
    run(async () => {
      const server = options.server.trim();
      if (!/^https?:\/\//u.test(server)) throw new CliError('bad_server', '--server 需要 http(s):// 前缀', 2);
      const name = sanitizeDeviceName(options.name ?? os.hostname());
      const adminToken = await readAdminToken(options.adminTokenFile);
      const result = await activate(server, adminToken, name, options.scopes);
      writeConfig({
        server: server.replace(/\/+$/u, ''),
        deviceId: result.device.id,
        deviceName: result.device.name,
        token: result.token,
        proxy: options.proxy ?? readConfig()?.proxy,
      });
      console.log(`${pc.green('✓')} ${result.created ? '已注册' : '已轮换'}设备 ${pc.bold(result.device.name)} (${shortId(result.device.id)})`);
      console.log(pc.dim(`  token 保存在 ${configPath()}`));
    }),
  );

program
  .command('add [text...]')
  .description('记录一条事实（project + kind + text 幂等）')
  .option('-k, --kind <kind>', 'decision|pitfall|convention|fact', 'fact')
  .option('-p, --project <project>')
  .option('-t, --tags <tags>', '逗号分隔，最多 8 个')
  .option('--harness <harness>', '来源 harness', detectHarness())
  .option('--stdin', '从 stdin 读取文本')
  .option('--offline', '直接写入本地 outbox')
  .option('--json')
  .action((textArgs: string[], options: { kind: string; project?: string; tags?: string; harness: string; stdin?: boolean; offline?: boolean; json?: boolean }) =>
    run(async () => {
      const raw = options.stdin ? await readStdin() : (textArgs ?? []).join(' ');
      if (!raw.trim()) throw new CliError('empty_text', '文本为空：loam add "…" 或 --stdin', 2);
      const input = {
        project: sanitizeProject(options.project ?? detectProject()),
        kind: options.kind,
        text: raw.trim(),
        tags: parseTags(options.tags),
        harness: options.harness,
      };
      if (input.tags.length > 8) throw new CliError('too_many_tags', '最多 8 个标签', 2);
      const config = requireConfig();
      if (options.offline) {
        queueFact(input);
        return;
      }
      let response: CreateResponse;
      try {
        response = await new Client(config).request<CreateResponse>('POST', '/v1/facts', input);
      } catch (error) {
        if (!(error instanceof OfflineError)) throw error;
        queueFact(input);
        return;
      }
      if (options.json) {
        console.log(JSON.stringify(response));
        return;
      }
      console.log(response.deduped ? pc.dim(`= 已存在 ${shortId(response.fact.id)} (${input.project})`) : `${pc.green('+')} ${shortId(response.fact.id)} [${input.kind}] ${input.project}`);
      if (response.warning) console.error(pc.yellow(`! ${response.warning}`));
    }),
  );

program
  .command('search [query...]')
  .description('检索项目记忆（默认 5 条，输出 ≤6 行，每行 ≤100 字符）')
  .option('-p, --project <project>')
  .option('-a, --all', '跨 project')
  .option('-k, --kind <kind>')
  .option('-t, --tag <tag>')
  .option('-l, --limit <n>', '1..5', '5')
  .option('--json')
  .option('--no-cache', '离线时不要读缓存')
  .action((queryArgs: string[], options: { project?: string; all?: boolean; kind?: string; tag?: string; limit: string; json?: boolean; cache?: boolean }) =>
    run(async () => {
      const config = requireConfig();
      const limit = Number(options.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 5) {
        throw new CliError('bad_limit', 'search --limit 取值 1..5；更多结果请用 loam list', 2);
      }
      const project = options.all ? null : sanitizeProject(options.project ?? detectProject());
      const query = (queryArgs ?? []).join(' ').trim();
      const params = new URLSearchParams({ limit: String(limit) });
      if (options.all) params.set('all', '1');
      else if (project) params.set('project', project);
      if (query) params.set('q', query);
      if (options.kind) params.set('kind', options.kind);
      if (options.tag) params.set('tag', options.tag);

      const cacheKey = params.toString();
      let payload: SearchResponse;
      let cached: number | null = null;
      try {
        payload = await new Client(config).request<SearchResponse>('GET', `/v1/facts?${cacheKey}`);
        writeCache(cacheKey, payload);
      } catch (error) {
        if (!(error instanceof OfflineError) || options.cache === false) throw error;
        const entry = readCache<SearchResponse>(cacheKey);
        if (!entry) throw error;
        payload = entry.value;
        cached = cacheAgeMinutes(entry);
      }

      writeLastRecall({ at: Date.now(), project, query: query || null, hits: payload.facts.length });
      if (options.json) {
        console.log(JSON.stringify(payload));
        return;
      }
      for (const line of formatFacts(payload.facts, { hasMore: Boolean(payload.next) })) console.log(line);
      if (cached !== null) console.error(pc.yellow(`（离线：显示 ${cached} 分钟前的缓存）`));
    }),
  );

program
  .command('show <id>')
  .description('显示一条事实（支持 8 位 id 前缀）')
  .option('--json')
  .action((id: string, options: { json?: boolean }) =>
    run(async () => {
      const config = requireConfig();
      const payload = await new Client(config).request<{ fact: Fact }>('GET', `/v1/facts/${encodeURIComponent(id)}`);
      console.log(options.json ? JSON.stringify(payload.fact) : formatDetail(payload.fact));
    }),
  );

program
  .command('list')
  .description('列出最近事实（默认 20 条）')
  .option('-p, --project <project>')
  .option('-a, --all', '跨 project')
  .option('-k, --kind <kind>')
  .option('-t, --tag <tag>')
  .option('-n, --limit <n>', '1..50', '20')
  .option('--json')
  .action((options: { project?: string; all?: boolean; kind?: string; tag?: string; limit: string; json?: boolean }) =>
    run(async () => {
      const config = requireConfig();
      const limit = Number(options.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new CliError('bad_limit', 'list --limit 取值 1..50', 2);
      const params = new URLSearchParams({ limit: String(limit) });
      if (options.all) params.set('all', '1');
      else params.set('project', sanitizeProject(options.project ?? detectProject()));
      if (options.kind) params.set('kind', options.kind);
      if (options.tag) params.set('tag', options.tag);
      const payload = await new Client(config).request<SearchResponse>('GET', `/v1/facts?${params.toString()}`);
      if (options.json) {
        console.log(JSON.stringify(payload));
        return;
      }
      for (const line of formatFacts(payload.facts, { hasMore: Boolean(payload.next), maxLines: limit })) console.log(line);
    }),
  );

program
  .command('devices [action] [id]')
  .description('list | revoke <id> | rotate <id>')
  .option('--json')
  .option('-y, --yes')
  .action((action: string | undefined, id: string | undefined, options: { json?: boolean; yes?: boolean }) =>
    run(async () => {
      const config = requireConfig();
      const client = new Client(config);
      const verb = action ?? 'list';

      if (verb === 'list') {
        const payload = await client.request<{ devices: DeviceSummary[] }>('GET', '/v1/devices');
        if (options.json) {
          console.log(JSON.stringify(payload));
          return;
        }
        if (payload.devices.length === 0) {
          console.log('没有设备');
          return;
        }
        for (const device of payload.devices) {
          const seen = device.lastSeenAt ? new Date(device.lastSeenAt).toISOString().slice(0, 16).replace('T', ' ') : 'never';
          const state = device.revokedAt ? pc.red('revoked') : pc.green('active');
          console.log(`${shortId(device.id)}  ${device.name.padEnd(16)} ${device.scopes.join(',').padEnd(10)} ${state}  seen ${seen}`);
        }
        return;
      }

      if (!id) throw new CliError('missing_id', `devices ${verb} 需要设备 id`, 2);

      if (verb === 'revoke') {
        if (!options.yes) {
          if (!isTty()) throw new CliError('confirm_required', '非交互环境请加 --yes', 2);
          const answer = await promptLine(`撤销设备 ${id}？(y/N) `);
          if (!/^y/iu.test(answer)) {
            console.log('已取消');
            return;
          }
        }
        const payload = await client.request<{ device: DeviceSummary }>('POST', `/v1/devices/${encodeURIComponent(id)}/revoke`);
        console.log(`${pc.green('✓')} 已撤销 ${payload.device.name} (${shortId(payload.device.id)})`);
        return;
      }

      if (verb === 'rotate') {
        const payload = await client.request<{ token: string }>('POST', `/v1/devices/${encodeURIComponent(id)}/rotate`);
        console.log(payload.token);
        console.error(pc.yellow('只显示这一次：把 token 写回 ~/.loamrc.json，或在该设备重新 loam login'));
        return;
      }

      throw new CliError('bad_action', `未知 action: ${verb}（list|revoke|rotate）`, 2);
    }),
  );

program
  .command('export')
  .description('导出 NDJSON')
  .option('-o, --out <file>')
  .option('-p, --project <project>')
  .option('-a, --all')
  .action((options: { out?: string; project?: string; all?: boolean }) =>
    run(async () => {
      const config = requireConfig();
      const client = new Client(config);
      const project = options.all ? null : sanitizeProject(options.project ?? detectProject());
      const chunks: string[] = [];
      let cursor: string | null = null;
      do {
        const params = new URLSearchParams({ limit: '200' });
        if (project) params.set('project', project);
        else params.set('all', '1');
        if (cursor) params.set('cursor', cursor);
        const page = await client.request<SearchResponse>('GET', `/v1/export?${params.toString()}`);
        for (const fact of page.facts) {
          chunks.push(
            JSON.stringify({
              project: fact.project,
              kind: fact.kind,
              text: fact.text,
              tags: fact.tags,
              harness: fact.harness,
              created_at: fact.createdAt,
            }),
          );
        }
        cursor = page.next;
      } while (cursor);
      const output = chunks.length ? `${chunks.join('\n')}\n` : '';
      if (options.out) {
        writeFileAtomic(options.out, output);
        console.log(`${pc.green('✓')} 导出 ${chunks.length} 条 → ${options.out}`);
      } else {
        process.stdout.write(output);
      }
    }),
  );

function parseImportFile(raw: string): Record<string, unknown>[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  let items: unknown[];
  try {
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      const parsed = JSON.parse(trimmed) as unknown;
      items = Array.isArray(parsed) ? parsed : [parsed];
    } else {
      items = trimmed
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as unknown);
    }
  } catch (error) {
    throw new CliError('bad_import', `无法解析导入文件：${error instanceof Error ? error.message : String(error)}`, 2);
  }
  return items.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new CliError('bad_import', '每条记录必须是 JSON 对象', 2);
    return item as Record<string, unknown>;
  });
}

program
  .command('import <file>')
  .description('从 NDJSON 或 JSON 数组导入')
  .option('-p, --project <project>', '记录缺少 project 时使用')
  .action((file: string, options: { project?: string }) =>
    run(async () => {
      const config = requireConfig();
      const items = parseImportFile(fs.readFileSync(file, 'utf8'));
      const fallback = options.project ? sanitizeProject(options.project) : detectProject();
      const prepared = items.map((item) => ({ project: fallback, ...item }));
      let inserted = 0;
      let deduped = 0;
      for (let index = 0; index < prepared.length; index += 200) {
        const response = await new Client(config).request<{ inserted: number; deduped: number }>('POST', '/v1/import', {
          facts: prepared.slice(index, index + 200),
        });
        inserted += response.inserted;
        deduped += response.deduped;
      }
      console.log(`${pc.green('✓')} 导入 ${inserted} 条，去重 ${deduped} 条（共 ${prepared.length}）`);
    }),
  );

program
  .command('flush')
  .description('补发 outbox 中的离线写入')
  .option('-q, --quiet')
  .action((options: { quiet?: boolean }) =>
    run(async () => {
      const config = requireConfig();
      const client = new Client(config);
      const result = await flushOutbox(async (entry) => {
        await client.request<CreateResponse>('POST', '/v1/facts', {
          project: entry.project,
          kind: entry.kind,
          text: entry.text,
          tags: entry.tags,
          harness: entry.harness,
        });
      });
      if (!options.quiet) {
        console.log(`已补发 ${result.sent} 条，丢弃 ${result.dropped} 条，剩余 ${result.remaining.length} 条`);
      }
      if (result.remaining.length > 0) process.exitCode = 4;
    }),
  );

program
  .command('prune')
  .description('软删除过期事实')
  .option('--older <duration>', '180d / 12h / 30', '180d')
  .option('-p, --project <project>')
  .option('-a, --all')
  .option('-y, --yes')
  .action((options: { older: string; project?: string; all?: boolean; yes?: boolean }) =>
    run(async () => {
      const config = requireConfig();
      const days = parseDurationDays(options.older);
      const project = options.all ? null : sanitizeProject(options.project ?? detectProject());
      if (!options.yes) {
        if (!isTty()) throw new CliError('confirm_required', '非交互环境请加 --yes', 2);
        const answer = await promptLine(`软删除 ${options.all ? '全部 project' : project} 中早于 ${options.older} 的事实？(y/N) `);
        if (!/^y/iu.test(answer)) {
          console.log('已取消');
          return;
        }
      }
      const params = new URLSearchParams({ older: `${days}d` });
      if (project) params.set('project', project);
      else params.set('all', '1');
      const response = await new Client(config).request<{ deleted: number }>('DELETE', `/v1/facts?${params.toString()}`);
      console.log(`${pc.green('✓')} 已软删除 ${response.deleted} 条`);
    }),
  );

program
  .command('install')
  .description('把 loam 接到 DSH / Claude Code / Codex')
  .option('--only <list>', '只装指定端，逗号分隔 dsh,claude,codex')
  .option('--dry-run', '只打印将写入的文件')
  .option('-y, --yes', '使用所有探测到的端，不询问')
  .option('--with-hooks', '额外安装 Claude Code UserPromptSubmit hook')
  .option('--repo <path>', '项目根（默认探测 git 根）')
  .action((options: { only?: string; dryRun?: boolean; yes?: boolean; withHooks?: boolean; repo?: string }) =>
    run(async () => {
      const only = options.only
        ? options.only
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
        : undefined;
      const result = await install({
        only,
        dryRun: Boolean(options.dryRun),
        yes: Boolean(options.yes),
        withHooks: Boolean(options.withHooks),
        repoRoot: options.repo,
      });
      for (const action of result.actions) console.log(action);
      if (!options.dryRun) {
        console.log(`${pc.green('✓')} 已安装到 ${result.record.harnesses.join(', ')}`);
        if (!readConfig()) console.log(pc.yellow('  下一步：loam login --server URL --name 本机名'));
      }
    }),
  );

program
  .command('uninstall')
  .description('按 install.json 回滚')
  .option('--dry-run', '只打印将回滚的内容')
  .option('-y, --yes')
  .action((options: { dryRun?: boolean; yes?: boolean }) =>
    run(async () => {
      if (!options.yes && !options.dryRun) {
        if (!isTty()) throw new CliError('confirm_required', '非交互环境请加 --yes', 2);
        const answer = await promptLine('卸载并回滚 loam 写入的文件？(y/N) ');
        if (!/^y/iu.test(answer)) {
          console.log('已取消');
          return;
        }
      }
      for (const action of uninstall({ dryRun: Boolean(options.dryRun) })) console.log(action);
    }),
  );

program
  .command('doctor')
  .description('自检 token / skill / hook / 最近 recall')
  .action(() =>
    run(async () => {
      const checks = await doctorChecks();
      for (const check of checks) {
        console.log(`${check.ok ? pc.green('✓') : pc.red('✗')} ${check.name.padEnd(10)} ${check.detail}`);
        if (!check.ok && check.fix) console.log(`  ${pc.dim('fix:')} ${check.fix}`);
      }
      if (checks.some((check) => !check.ok)) process.exitCode = 1;
    }),
  );

program
  .command('inject')
  .description('打印开工前注入块（≤3 条，≤200 token）')
  .option('-p, --project <project>')
  .option('-n, --max <n>', '1..3', '3')
  .action((options: { project?: string; max: string }) =>
    run(async () => {
      const config = resolveConfig();
      if (!config) return;
      const raw = Number(options.max);
      const max = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 3) : 3;
      const project = sanitizeProject(options.project ?? detectProject());
      try {
        const page = await new Client(config).request<SearchResponse>('GET', `/v1/facts?project=${encodeURIComponent(project)}&limit=${max}`);
        if (page.facts.length === 0) return;
        const lines = ['<loam>'];
        for (const fact of page.facts) lines.push(`- [${fact.kind}] ${oneLine(fact.text, 60)}`);
        lines.push('</loam>');
        const text = lines.join('\n');
        if (Array.from(text).length <= 800) console.log(text);
      } catch {
        // A hook must never break the harness prompt.
      }
    }),
  );

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(pc.red('loam:'), error instanceof Error ? error.message : error);
  process.exitCode = 1;
});