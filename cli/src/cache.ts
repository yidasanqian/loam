import crypto from 'node:crypto';
import path from 'node:path';
import { cacheDir } from './config.ts';
import { readTextFile, writeFileAtomic } from './util.ts';

export interface CacheEntry<T> {
  at: number;
  value: T;
}

function cacheFile(key: string): string {
  const digest = crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
  return path.join(cacheDir(), `search-${digest}.json`);
}

export function readCache<T>(key: string): CacheEntry<T> | null {
  const raw = readTextFile(cacheFile(key));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    return typeof parsed.at === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, value: T): void {
  try {
    writeFileAtomic(cacheFile(key), `${JSON.stringify({ at: Date.now(), value })}\n`);
  } catch {
    // Cache is an optimisation for CN latency; never fail a search over it.
  }
}

export function cacheAgeMinutes(entry: CacheEntry<unknown>): number {
  return Math.max(0, Math.round((Date.now() - entry.at) / 60_000));
}