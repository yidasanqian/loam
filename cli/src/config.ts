import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CliError } from './errors.ts';
import { ensureDir, readTextFile, writeFileAtomic } from './util.ts';

export interface Config {
  server: string;
  deviceId: string;
  deviceName: string;
  token: string;
  /** Optional HTTP proxy for networks where workers.dev is blocked. */
  proxy?: string;
}

export function configPath(): string {
  return process.env.LOAMRC ?? path.join(os.homedir(), '.loamrc.json');
}

export function loamDir(): string {
  return process.env.LOAM_DIR ?? path.join(os.homedir(), '.loam');
}

export function outboxPath(): string {
  return path.join(loamDir(), 'outbox.jsonl');
}

export function installRecordPath(): string {
  return path.join(loamDir(), 'install.json');
}

export function cacheDir(): string {
  return path.join(loamDir(), 'cache');
}

export function lastRecallPath(): string {
  return path.join(loamDir(), 'last-recall.json');
}

export function readConfig(): Config | null {
  const file = configPath();
  const raw = readTextFile(file);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliError('config_invalid', `${file} 不是合法 JSON；请重新 loam login`);
  }
  const cfg = parsed as Partial<Config>;
  if (!cfg.server || !cfg.token) throw new CliError('config_invalid', `${file} 缺少 server 或 token；请重新 loam login`);
  return {
    server: cfg.server.replace(/\/+$/, ''),
    deviceId: cfg.deviceId ?? '',
    deviceName: cfg.deviceName ?? '',
    token: cfg.token,
    proxy: typeof cfg.proxy === 'string' && cfg.proxy.trim() ? cfg.proxy.trim() : undefined,
  };
}

/** Config file with environment overrides (LOAM_SERVER / LOAM_TOKEN / ...). */
export function resolveConfig(): Config | null {
  const file = readConfig();
  const server = process.env.LOAM_SERVER ?? file?.server;
  const token = process.env.LOAM_TOKEN ?? file?.token;
  if (!server || !token) return null;
  return {
    server: server.replace(/\/+$/, ''),
    deviceId: process.env.LOAM_DEVICE_ID ?? file?.deviceId ?? '',
    deviceName: process.env.LOAM_DEVICE_NAME ?? file?.deviceName ?? '',
    token,
    proxy: process.env.LOAM_PROXY ?? file?.proxy,
  };
}

export function requireConfig(): Config {
  const config = resolveConfig();
  if (!config) throw new CliError('not_logged_in', '尚未登录：先运行 loam login --server URL --name NAME', 2);
  return config;
}

export function writeConfig(config: Config): void {
  ensureDir(loamDir());
  writeFileAtomic(configPath(), `${JSON.stringify(config, null, 2)}\n`, 0o600);
}

export interface LastRecall {
  at: number;
  project: string | null;
  query: string | null;
  hits: number;
}

export function writeLastRecall(entry: LastRecall): void {
  try {
    fs.mkdirSync(loamDir(), { recursive: true });
    writeFileAtomic(lastRecallPath(), `${JSON.stringify(entry)}\n`);
  } catch {
    // Diagnostics only; never fail a search because the log could not be written.
  }
}

export function readLastRecall(): LastRecall | null {
  const raw = readTextFile(lastRecallPath());
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LastRecall;
  } catch {
    return null;
  }
}