import path from 'node:path';
import { Client } from '../client.ts';
import { readConfig, readLastRecall, resolveConfig } from '../config.ts';
import { CliError } from '../errors.ts';
import { detectRepoRoot } from '../project.ts';
import { readTextFile } from '../util.ts';
import { hasBlock } from './blocks.ts';
import { readInstallRecord } from './index.ts';

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

export async function doctorChecks(options: { repoRoot?: string } = {}): Promise<Check[]> {
  const checks: Check[] = [];

  const config = readConfig();
  checks.push(
    config
      ? { name: 'config', ok: true, detail: `${config.deviceName || 'unknown device'} @ ${config.server}` }
      : { name: 'config', ok: false, detail: '未找到 ~/.loamrc.json', fix: 'loam login --server URL --name NAME' },
  );

  const resolved = resolveConfig();
  if (!resolved) {
    checks.push({ name: 'token', ok: false, detail: '没有可用的 server/token', fix: 'loam login --server URL --name NAME' });
  } else {
    let me: { device: { name: string; scopes: string[] } } | null = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2 && !me; attempt += 1) {
      try {
        me = await new Client(resolved).request<{ device: { name: string; scopes: string[] } }>('GET', '/v1/me');
      } catch (error) {
        lastError = error;
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    if (me) {
      checks.push({ name: 'token', ok: true, detail: `${me.device.name} (${me.device.scopes.join(',')})` });
    } else {
      const message = lastError instanceof Error ? lastError.message : String(lastError);
      const fix = lastError instanceof CliError && lastError.exitCode === 3 ? 'loam login --server URL --name NAME' : undefined;
      checks.push({ name: 'token', ok: false, detail: message, fix });
    }
  }

  const agentsFile = path.join(options.repoRoot ?? detectRepoRoot(), 'AGENTS.md');
  const agents = readTextFile(agentsFile);
  checks.push(
    agents && hasBlock(agents)
      ? { name: 'repo-block', ok: true, detail: agentsFile }
      : { name: 'repo-block', ok: false, detail: `${agentsFile} 没有 loam 标记块`, fix: 'loam install' },
  );

  const record = readInstallRecord();
  checks.push(
    record
      ? { name: 'install', ok: true, detail: `${record.harnesses.join(', ')} @ ${record.repoRoot}` }
      : { name: 'install', ok: false, detail: '没有 install.json', fix: 'loam install' },
  );

  if (record) {
    const missing = record.files.filter((file) => file.kind !== 'hooks' && readTextFile(file.path) === null);
    checks.push(
      missing.length
        ? { name: 'files', ok: false, detail: `缺失 ${missing.length} 个已记录文件`, fix: 'loam install' }
        : { name: 'files', ok: true, detail: `${record.files.length} 个已记录文件` },
    );
  }

  const recall = readLastRecall();
  checks.push(
    recall
      ? { name: 'last-recall', ok: true, detail: `${new Date(recall.at).toISOString()} · ${recall.hits} 条 · ${recall.project ?? 'all'}` }
      : { name: 'last-recall', ok: false, detail: '还没有搜索记录', fix: 'loam search "keyword"' },
  );

  return checks;
}