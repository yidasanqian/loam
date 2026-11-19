import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { detectGit, hashPaths, type GitSpawn } from '../../src/git.ts';

const formatFile = fileURLToPath(new URL('../../src/format.ts', import.meta.url));
const gitFile = fileURLToPath(new URL('../../src/git.ts', import.meta.url));

type Reply = { stdout: string; status: number } | null;

function stub(handler: (args: string[]) => Reply): { spawn: GitSpawn; calls: string[][] } {
  const calls: string[][] = [];
  const spawn: GitSpawn = (cmd, args) => {
    assert.equal(cmd, 'git');
    calls.push(args);
    return handler(args);
  };
  return { spawn, calls };
}

function workTree(status: Reply, head = '845495035b7d'): (args: string[]) => Reply {
  return (args) => {
    if (args.includes('--is-inside-work-tree')) return { stdout: 'true\n', status: 0 };
    if (args.includes('HEAD')) return { stdout: `${head}\n`, status: 0 };
    if (args[0] === 'status') return status;
    return null;
  };
}

test('detectGit reports no anchor outside a work tree', () => {
  const { spawn, calls } = stub(() => ({ stdout: 'false\n', status: 0 }));
  assert.deepEqual(detectGit([formatFile], spawn), { commit: '' });
  assert.deepEqual(calls, [['rev-parse', '--is-inside-work-tree']]);
});

test('detectGit stops before dirty when HEAD is unborn', () => {
  const { spawn, calls } = stub((args) => {
    if (args.includes('--is-inside-work-tree')) return { stdout: 'true\n', status: 0 };
    if (args.includes('HEAD')) return { stdout: '', status: 128 };
    return null;
  });
  assert.deepEqual(detectGit([formatFile], spawn), { commit: '' });
  assert.ok(!calls.some((args) => args[0] === 'status'), 'an unborn HEAD must not report dirty');
});

test('detectGit records dirty, clean, and unknown worktree states', () => {
  const dirty = detectGit([], stub(workTree({ stdout: ' M cli/src/bin.ts\n', status: 0 })).spawn);
  assert.deepEqual(dirty, { commit: '845495035b7d', dirty: true });

  const clean = detectGit([], stub(workTree({ stdout: '', status: 0 })).spawn);
  assert.deepEqual(clean, { commit: '845495035b7d', dirty: false });

  const unknown = detectGit([], stub(workTree({ stdout: '', status: 1 })).spawn);
  assert.deepEqual(unknown, { commit: '845495035b7d' }, 'a failed status leaves dirty absent');
});

test('detectGit hashes each path behind its own filter path', () => {
  const { spawn, calls } = stub((args) => {
    const repo = workTree({ stdout: '', status: 0 })(args);
    if (repo) return repo;
    if (args[0] === 'hash-object') return { stdout: `${'b'.repeat(40)}\n`, status: 0 };
    return null;
  });

  assert.deepEqual(detectGit([formatFile, gitFile], spawn).blobs, {
    [formatFile]: 'b'.repeat(40),
    [gitFile]: 'b'.repeat(40),
  });

  assert.deepEqual(calls.filter((args) => args[0] === 'hash-object'), [
    ['hash-object', `--path=${formatFile}`, '--', formatFile],
    ['hash-object', `--path=${gitFile}`, '--', gitFile],
  ]);
});

test('detectGit hashes only paths present on disk', () => {
  const { spawn, calls } = stub((args) => {
    const repo = workTree({ stdout: '', status: 0 })(args);
    if (repo) return repo;
    if (args[0] === 'hash-object') return { stdout: `${'a'.repeat(40)}\n`, status: 0 };
    return null;
  });

  const anchor = detectGit([formatFile, 'does/not/exist.ts'], spawn);
  assert.deepEqual(anchor.blobs, { [formatFile]: 'a'.repeat(40) });
  const hashes = calls.filter((args) => args[0] === 'hash-object');
  assert.equal(hashes.length, 1);
  assert.ok(!JSON.stringify(hashes).includes('does/not/exist.ts'));
});

test('hashPaths returns no hashes outside a work tree', () => {
  const { spawn, calls } = stub(() => ({ stdout: 'false\n', status: 0 }));
  assert.deepEqual(hashPaths([formatFile], spawn), {});
  assert.deepEqual(calls, [['rev-parse', '--is-inside-work-tree']]);
});