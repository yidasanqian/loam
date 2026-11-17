import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { CliError } from './errors.ts';

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function writeFileAtomic(file: string, content: string, mode = 0o644): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.loam-tmp`;
  fs.writeFileSync(tmp, content, { mode });
  try {
    fs.renameSync(tmp, file);
  } catch {
    fs.rmSync(file, { force: true });
    fs.renameSync(tmp, file);
  }
  if (process.platform !== 'win32') fs.chmodSync(file, mode);
}

export function readTextFile(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

export function todayIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** `180d` / `12h` / `30` (days) -> whole days, at least 1. */
export function parseDurationDays(input: string): number {
  const match = /^(\d+)\s*([dhm]?)$/i.exec(input.trim());
  if (!match) throw new CliError('bad_duration', '时间格式应为 180d / 12h / 30');
  const value = Number(match[1]);
  const unit = (match[2] || 'd').toLowerCase();
  const hours = unit === 'h' ? value : unit === 'm' ? value / 60 : value * 24;
  return Math.max(1, Math.ceil(hours / 24));
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

/** Reads one line without echoing when `secret` is set. */
export function promptLine(question: string, secret = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) {
      reject(new CliError('no_tty', 'stdin 不是终端：请改用 --admin-token-file 或 LOAM_ADMIN_TOKEN', 2));
      return;
    }
    const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true });
    type RlInternal = { _writeToOutput: (chunk: string) => void };
    const internal = rl as unknown as RlInternal;
    const original = internal._writeToOutput;
    if (secret) {
      internal._writeToOutput = function (chunk: string) {
        if (chunk.includes('\n')) original.call(rl, chunk);
      };
    }
    rl.on('SIGINT', () => {
      rl.close();
      reject(new CliError('cancelled', '已取消', 130));
    });
    rl.question(question, (answer) => {
      rl.close();
      if (secret) stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

/** Best-effort harness identity for provenance; agents may override with --harness. */
export function detectHarness(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.LOAM_HARNESS;
  if (explicit) return explicit.toLowerCase();
  if (env.CLAUDECODE || env.CLAUDE_CODE) return 'claude';
  if (env.CODEX_HOME || env.CODEX_SANDBOX) return 'codex';
  if (env.DSH_HOME || env.DSH_SESSION_ID) return 'dsh';
  return 'cli';
}

export function parseTags(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const tag = part.trim().toLowerCase();
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}