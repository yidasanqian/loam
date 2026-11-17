import fs from 'node:fs';
import path from 'node:path';

const PROJECT_RE = /[^A-Za-z0-9._@:/-]+/g;

export function sanitizeProject(name: string): string {
  const cleaned = name.trim().replace(PROJECT_RE, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'unknown';
}

/** Git root when present, otherwise the starting directory. */
export function detectRepoRoot(start: string = process.cwd()): string {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

export function detectProject(start: string = process.cwd()): string {
  const override = process.env.LOAM_PROJECT;
  if (override) return sanitizeProject(override);
  return sanitizeProject(path.basename(detectRepoRoot(start)));
}