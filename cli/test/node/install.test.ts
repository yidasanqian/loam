import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { installRecordPath } from '../../src/config.ts';
import { BLOCK_START, hasBlock } from '../../src/install/blocks.ts';
import { install, uninstall } from '../../src/install/index.ts';

let root: string;
let home: string;
let repo: string;
let skillCalls: string[][];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'loam-test-'));
  home = path.join(root, 'home');
  repo = path.join(root, 'repo');
  for (const dir of ['.dsh', '.claude', '.codex']) fs.mkdirSync(path.join(home, dir), { recursive: true });
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), '# project rules\n');
  process.env.LOAM_DIR = path.join(root, 'loam-home');
  skillCalls = [];
});

afterEach(() => {
  delete process.env.LOAM_DIR;
  fs.rmSync(root, { recursive: true, force: true });
});

/** Stands in for `npx skills`: records the args and materializes the shared store. */
function stubSkill(args: string[]) {
  skillCalls.push(args);
  if (args.includes('add')) {
    const store = path.join(home, '.agents', 'skills', 'loam');
    fs.mkdirSync(store, { recursive: true });
    fs.writeFileSync(path.join(store, 'SKILL.md'), '---\nname: loam\n---\n');
  }
  return { ok: true, detail: 'stub' };
}

function runInstall(extra: Parameters<typeof install>[0] = {}) {
  return install({ home, repoRoot: repo, env: {} as NodeJS.ProcessEnv, yes: true, runSkill: stubSkill, ...extra });
}

test('a clean machine gets all three harnesses wired', async () => {
  const result = await runInstall();
  assert.deepEqual(result.record.harnesses, ['dsh', 'claude', 'codex']);

  assert.ok(hasBlock(fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8')));
  const expected = [
    path.join(home, '.dsh', 'AGENTS.md'),
    path.join(home, '.claude', 'CLAUDE.md'),
    path.join(home, '.codex', 'AGENTS.md'),
  ];
  for (const target of expected) assert.ok(fs.existsSync(target), `${target} should exist`);

  // The skill comes from the Skills CLI, never from a file copy.
  const add = skillCalls.find((args) => args.includes('add'));
  assert.ok(add, 'npx skills add should run');
  assert.deepEqual(add.slice(add.indexOf('--skill')), ['--skill', 'loam', '--global', '--yes', '--agent', 'claude-code', 'codex']);
  assert.deepEqual(result.record.skill?.agents, ['claude-code', 'codex']);
  assert.equal(fs.existsSync(path.join(home, '.claude', 'skills', 'loam', 'SKILL.md')), false);

  // DSH reads the shared store (`~/.agents/skills`), the same target the codex agent uses.
  assert.ok(fs.existsSync(path.join(home, '.agents', 'skills', 'loam', 'SKILL.md')));
  assert.equal(fs.existsSync(path.join(home, '.dsh', 'skills', 'loam')), false);
  assert.ok(fs.existsSync(installRecordPath()));
});

test('--only codex touches only the codex and repo files', async () => {
  const result = await runInstall({ only: ['codex'] });
  assert.deepEqual(result.record.harnesses, ['codex']);
  assert.ok(hasBlock(fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8')));
  assert.ok(fs.existsSync(path.join(home, '.codex', 'AGENTS.md')));
  assert.equal(fs.existsSync(path.join(home, '.dsh', 'AGENTS.md')), false);
  assert.equal(fs.existsSync(path.join(home, '.claude', 'CLAUDE.md')), false);
  assert.deepEqual(result.record.skill?.agents, ['codex']);
});

test('reinstalling is idempotent', async () => {
  await runInstall();
  const first = fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8');
  await runInstall();
  const second = fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8');
  assert.equal(second, first);
  assert.equal(second.split(BLOCK_START).length - 1, 1);
});

test('a legacy skill copy is removed so the store is the only copy', async () => {
  const legacy = path.join(home, '.dsh', 'skills', 'loam');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'SKILL.md'), 'old copy');
  await runInstall({ only: ['dsh'] });
  assert.equal(fs.existsSync(legacy), false);
  assert.ok(fs.existsSync(path.join(home, '.agents', 'skills', 'loam', 'SKILL.md')));
});

test('dry-run writes nothing', async () => {
  const before = fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8');
  await runInstall({ dryRun: true });
  assert.equal(fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8'), before);
  assert.equal(fs.existsSync(installRecordPath()), false);
  assert.equal(fs.existsSync(path.join(home, '.dsh', 'AGENTS.md')), false);
  assert.equal(skillCalls.length, 0);
});

test('uninstall restores pre-existing files and deletes created ones', async () => {
  await runInstall();
  uninstall({ runSkill: stubSkill });

  assert.equal(fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8'), '# project rules\n');
  assert.equal(fs.existsSync(path.join(home, '.dsh', 'AGENTS.md')), false);
  assert.equal(fs.existsSync(path.join(home, '.claude', 'CLAUDE.md')), false);
  assert.equal(fs.existsSync(path.join(home, '.codex', 'AGENTS.md')), false);
  assert.equal(fs.existsSync(path.join(home, '.dsh', 'skills', 'loam')), false);
  assert.ok(skillCalls.some((args) => args.includes('remove')));
  assert.equal(fs.existsSync(installRecordPath()), false);
});

test('--with-hooks registers and removes the Claude inject hook', async () => {
  await runInstall({ only: ['claude'], withHooks: true });
  const settingsFile = path.join(home, '.claude', 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) as {
    hooks: { UserPromptSubmit: Array<{ hooks: Array<{ command: string }> }> };
  };
  assert.equal(settings.hooks.UserPromptSubmit[0].hooks[0].command, 'loam inject');

  uninstall({ runSkill: stubSkill });
  assert.equal(fs.existsSync(settingsFile), false);
});