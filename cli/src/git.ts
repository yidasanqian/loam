import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

/** Minimal shape so tests can inject git without a real repository. */
export type GitSpawn = (cmd: string, args: string[]) => { stdout: string; status: number } | null;

export interface GitAnchor {
  commit: string;
  dirty?: boolean;
  blobs?: Record<string, string>;
}

const HEX = /^[0-9a-f]{7,40}$/u;

function defaultSpawn(cmd: string, args: string[]): { stdout: string; status: number } | null {
  try {
    const result = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (result.error || typeof result.status !== 'number') return null;
    return { stdout: result.stdout ?? '', status: result.status };
  } catch {
    return null;
  }
}

function runGit(spawn: GitSpawn, args: string[]): { stdout: string; status: number } | null {
  try {
    return spawn('git', args);
  } catch {
    return null;
  }
}

function isWorkTree(spawn: GitSpawn): boolean {
  const result = runGit(spawn, ['rev-parse', '--is-inside-work-tree']);
  return Boolean(result && result.status === 0 && result.stdout.trim() === 'true');
}

function freshPaths(paths: string[]): string[] {
  return Array.from(new Set(paths)).filter((path) => {
    try {
      return fs.existsSync(path);
    } catch {
      return false;
    }
  });
}

/**
 * `--path` decides the .gitattributes filters; without it a CRLF checkout hashes
 * differently from the blob git actually stored. Git takes one filter path per
 * invocation and `--` ends option parsing, so a chained call would silently hash
 * only the first file: one call per path is the shape that actually holds.
 */
function objectHashes(paths: string[], spawn: GitSpawn): Record<string, string> {
  const hashes: Record<string, string> = {};

  for (const path of paths) {
    const single = runGit(spawn, ['hash-object', `--path=${path}`, '--', path]);
    const hash = single && single.status === 0 ? single.stdout.trim().toLowerCase() : '';
    if (HEX.test(hash)) hashes[path] = hash;
  }
  return hashes;
}

/** Current blob hashes for the read side; no repo or no file yields no hash. */
export function hashPaths(paths: string[], spawn: GitSpawn = defaultSpawn): Record<string, string> {
  if (!isWorkTree(spawn)) return {};
  return objectHashes(freshPaths(paths), spawn);
}

/**
 * The anchor is captured, not asked for. Missing repository, unborn HEAD, or a
 * failing `git status` leave the corresponding field absent instead of guessing.
 */
export function detectGit(paths: string[], spawn: GitSpawn = defaultSpawn): GitAnchor {
  if (!isWorkTree(spawn)) return { commit: '' };

  const head = runGit(spawn, ['rev-parse', '--short=12', 'HEAD']);
  const commit = head && head.status === 0 ? head.stdout.trim().toLowerCase() : '';
  if (!HEX.test(commit)) return { commit: '' };

  const anchor: GitAnchor = { commit };
  const status = runGit(spawn, ['status', '--porcelain']);
  if (status && status.status === 0) anchor.dirty = status.stdout.trim().length > 0;

  const blobs = objectHashes(freshPaths(paths), spawn);
  if (Object.keys(blobs).length > 0) anchor.blobs = blobs;
  return anchor;
}