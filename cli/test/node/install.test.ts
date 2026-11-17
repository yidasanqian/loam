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

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'loam-test-'));
  home = path.join(root, 'home');
  repo = path.join(root, 'repo');
  for (const dir of ['.dsh', '.claude', '.codex']) fs.mkdirSync(path.join(home, dir), { recursive: true });
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), '# project rules\n');
  process.env.LOAM_DIR = path.join(root, 'loam-home');
});

afterEach(() => {
  delete process.env.LOAM_DIR;
  fs.rmSync(root, { recursive: true, force: true });
});

function runInstall(extra: Parameters<typeof install>[0] = {}) {
  return install({ home, repoRoot: repo, env: {} as NodeJS.ProcessEnv, yes: true, ...extra });
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
  assert.ok(fs.existsSync(path.join(home, '.dsh', 'skills', 'loam', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(home, '.claude', 'skills', 'loam', 'SKILL.md')));
  assert.ok(fs.existsSync(installRecordPath()));
});

test('--only codex touches only the codex and repo files', async () => {
  const result = await runInstall({ only: ['codex'] });
  assert.deepEqual(result.record.harnesses, ['codex']);
  assert.ok(hasBlock(fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8')));
  assert.ok(fs.existsSync(path.join(home, '.codex', 'AGENTS.md')));
  assert.equal(fs.existsSync(path.join(home, '.dsh', 'AGENTS.md')), false);
  assert.equal(fs.existsSync(path.join(home, '.claude', 'CLAUDE.md')), false);
});

test('reinstalling is idempotent', async () => {
  await runInstall();
  const first = fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8');
  await runInstall();
  const second = fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8');
  assert.equal(second, first);
  assert.equal(second.split(BLOCK_START).length - 1, 1);
});

test('dry-run writes nothing', async () => {
  const before = fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8');
  await runInstall({ dryRun: true });
  assert.equal(fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8'), before);
  assert.equal(fs.existsSync(installRecordPath()), false);
  assert.equal(fs.existsSync(path.join(home, '.dsh', 'AGENTS.md')), false);
});

test('uninstall restores pre-existing files and deletes created ones', async () => {
  await runInstall();
  uninstall({});

  assert.equal(fs.readFileSync(path.join(repo, 'AGENTS.md'), 'utf8'), '# project rules\n');
  assert.equal(fs.existsSync(path.join(home, '.dsh', 'AGENTS.md')), false);
  assert.equal(fs.existsSync(path.join(home, '.claude', 'CLAUDE.md')), false);
  assert.equal(fs.existsSync(path.join(home, '.codex', 'AGENTS.md')), false);
  assert.equal(fs.existsSync(path.join(home, '.dsh', 'skills', 'loam', 'SKILL.md')), false);
  assert.equal(fs.existsSync(installRecordPath()), false);
});

test('--with-hooks registers and removes the Claude inject hook', async () => {
  await runInstall({ only: ['claude'], withHooks: true });
  const settingsFile = path.join(home, '.claude', 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) as {
    hooks: { UserPromptSubmit: Array<{ hooks: Array<{ command: string }> }> };
  };
  assert.equal(settings.hooks.UserPromptSubmit[0].hooks[0].command, 'loam inject');

  uninstall({});
  assert.equal(fs.existsSync(settingsFile), false);
});