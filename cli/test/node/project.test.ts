import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { detectProject, detectRepoRoot, sanitizeProject } from '../../src/project.ts';

const original = process.env.LOAM_PROJECT;

afterEach(() => {
  if (original === undefined) delete process.env.LOAM_PROJECT;
  else process.env.LOAM_PROJECT = original;
});

test('sanitizeProject strips characters the API rejects', () => {
  assert.equal(sanitizeProject('  my project  '), 'my-project');
  assert.equal(sanitizeProject('loam'), 'loam');
  assert.equal(sanitizeProject('a/b:c@d.e'), 'a/b:c@d.e');
  assert.equal(sanitizeProject('***'), 'unknown');
});

test('LOAM_PROJECT wins over detection', () => {
  process.env.LOAM_PROJECT = 'demo project';
  assert.equal(detectProject(), 'demo-project');
});

test('detectRepoRoot falls back to the starting directory without a .git parent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loam-project-'));
  try {
    assert.equal(detectRepoRoot(dir), dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('detectProject derives a stable name from the directory', () => {
  const start = path.resolve(process.cwd(), '..');
  assert.equal(detectProject(start), sanitizeProject(path.basename(detectRepoRoot(start))));
});