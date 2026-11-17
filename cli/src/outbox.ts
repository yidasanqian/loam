import fs from 'node:fs';
import { loamDir, outboxPath } from './config.ts';
import { CliError, OfflineError } from './errors.ts';
import { ensureDir, writeFileAtomic } from './util.ts';

export interface PendingFact {
  project: string;
  kind: string;
  text: string;
  tags: string[];
  harness: string;
  queuedAt: number;
}

export function readOutbox(): PendingFact[] {
  let raw: string;
  try {
    raw = fs.readFileSync(outboxPath(), 'utf8');
  } catch {
    return [];
  }
  const items: PendingFact[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as PendingFact;
      if (parsed && typeof parsed.text === 'string' && typeof parsed.project === 'string') items.push(parsed);
    } catch {
      // A torn line is skipped; the original file is rewritten on the next flush.
    }
  }
  return items;
}

export function appendOutbox(entry: PendingFact): number {
  try {
    ensureDir(loamDir());
    fs.appendFileSync(outboxPath(), `${JSON.stringify(entry)}\n`);
  } catch (error) {
    throw new CliError(
      'outbox_write_failed',
      `无法写入 outbox（${outboxPath()}）：${error instanceof Error ? error.message : String(error)}；沙箱环境请把 LOAM_DIR 指到可写目录`,
      2,
    );
  }
  return readOutbox().length;
}

export function writeOutbox(items: PendingFact[]): void {
  try {
    writeFileAtomic(outboxPath(), items.length ? `${items.map((item) => JSON.stringify(item)).join('\n')}\n` : '');
  } catch (error) {
    throw new CliError(
      'outbox_write_failed',
      `无法写入 outbox（${outboxPath()}）：${error instanceof Error ? error.message : String(error)}`,
      2,
    );
  }
}

export interface DrainResult {
  sent: number;
  dropped: number;
  remaining: PendingFact[];
}

/**
 * Pure queue walk: sends in order, stops at the first network failure, drops
 * 4xx entries (except 401, which is retryable after login).
 */
export async function drainOutbox(items: PendingFact[], send: (entry: PendingFact) => Promise<void>): Promise<DrainResult> {
  const remaining: PendingFact[] = [];
  let sent = 0;
  let dropped = 0;
  for (const [index, item] of items.entries()) {
    try {
      await send(item);
      sent += 1;
    } catch (error) {
      if (error instanceof OfflineError) {
        remaining.push(...items.slice(index));
        break;
      }
      if (error instanceof CliError && error.exitCode === 1) {
        dropped += 1;
        continue;
      }
      remaining.push(...items.slice(index));
      break;
    }
  }
  return { sent, dropped, remaining };
}

export async function flushOutbox(send: (entry: PendingFact) => Promise<void>): Promise<DrainResult> {
  const result = await drainOutbox(readOutbox(), send);
  writeOutbox(result.remaining);
  return result;
}