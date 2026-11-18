/**
 * Skill wiring goes through the Skills CLI (`npx skills add`) instead of
 * shipping a copy: the CLI keeps one canonical copy under `~/.agents/skills`
 * and links every agent directory to it, so `npx skills update loam` is enough
 * to refresh all harnesses.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readTextFile } from '../util.ts';

/** GitHub source the Skills CLI clones; the repo keeps the skill at cli/skills/SKILL.md. */
export const SKILL_SOURCE = 'yidasanqian/loam';
export const SKILL_NAME = 'loam';
const SKILLS_PACKAGE = 'skills@latest';

export interface SkillRunResult {
  ok: boolean;
  detail: string;
}

/** Args for `npx`; `agents` are Skills CLI agent ids (claude-code, codex, universal). */
export function skillSource(env: NodeJS.ProcessEnv = process.env): string {
  // LOAM_SKILL_SOURCE points at a checkout: lets maintainers verify the wiring before a push.
  const override = env.LOAM_SKILL_SOURCE?.trim();
  return override || SKILL_SOURCE;
}

export function skillsCliArgs(verb: 'add' | 'remove', agents: string[] = [], source = SKILL_SOURCE): string[] {
  if (verb === 'remove') return ['-y', SKILLS_PACKAGE, 'remove', SKILL_NAME, '--global'];
  return ['-y', SKILLS_PACKAGE, 'add', source, '--skill', SKILL_NAME, '--global', '--yes', '--agent', ...agents];
}

export function skillsCommand(verb: 'add' | 'remove', agents: string[] = [], source = SKILL_SOURCE): string {
  return `npx ${skillsCliArgs(verb, agents, source).join(' ')}`;
}

function lastLine(text: string): string {
  const line = text
    .split('\n')
    .map((part) => part.trim())
    .filter(Boolean)
    .pop();
  return line ?? '';
}

export function runSkillsCli(args: string[], env: NodeJS.ProcessEnv = process.env): SkillRunResult {
  // npm ships npx as a .cmd shim on Windows; run it through the shell with a
  // single quoted command line so Node does not warn about args plus shell.
  const quote = (value: string) => (/[\s"]/u.test(value) ? `"${value.replace(/"/gu, '\\"')}"` : value);
  const result =
    process.platform === 'win32'
      ? spawnSync(['npx.cmd', ...args.map(quote)].join(' '), {
          encoding: 'utf8',
          env,
          timeout: 180_000,
          windowsHide: true,
          shell: true,
        })
      : spawnSync('npx', args, { encoding: 'utf8', env, timeout: 180_000 });
  if (result.error) return { ok: false, detail: result.error.message };
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.replace(/\u001b\[[0-9;]*m/gu, '');
  if (result.status === 0) return { ok: true, detail: lastLine(output) || 'ok' };
  return { ok: false, detail: lastLine(output) || `npx 退出码 ${String(result.status)}` };
}

export function skillStoreDir(home: string): string {
  return path.join(home, '.agents', 'skills', SKILL_NAME);
}

export function skillInstalled(home: string): boolean {
  return readTextFile(path.join(skillStoreDir(home), 'SKILL.md')) !== null;
}

function lstat(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}

/**
 * Drops a legacy copy (or plain directory) so the Skills CLI can place its link.
 * Links are left alone: they belong to the Skills CLI and it reuses them.
 */
export function clearLegacySkillDir(dir: string): boolean {
  const stat = lstat(dir);
  if (!stat || stat.isSymbolicLink()) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}
