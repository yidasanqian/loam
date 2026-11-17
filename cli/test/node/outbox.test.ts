import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { CliError, OfflineError } from '../../src/errors.ts';
import { appendOutbox, drainOutbox, type PendingFact } from '../../src/outbox.ts';

const entry = (text: string): PendingFact => ({
  project: 'loam',
  kind: 'fact',
  text,
  tags: [],
  harness: 'cli',
  queuedAt: 1,
});

const originalLoamDir = process.env.LOAM_DIR;
let tempRoot: string | undefined;

after(() => {
  if (originalLoamDir === undefined) delete process.env.LOAM_DIR;
  else process.env.LOAM_DIR = originalLoamDir;
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('an unwritable outbox becomes a CliError, not a stack trace', () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'loam-outbox-'));
  const blocker = path.join(tempRoot, 'not-a-dir');
  fs.writeFileSync(blocker, 'x');
  process.env.LOAM_DIR = path.join(blocker, 'loam');
  assert.throws(
    () => appendOutbox(entry('queued')),
    (error: unknown) => error instanceof CliError && error.code === 'outbox_write_failed',
  );
});

test('drain sends everything in order', async () => {
  const sent: string[] = [];
  const result = await drainOutbox([entry('a'), entry('b')], async (item) => {
    sent.push(item.text);
  });
  assert.deepEqual(sent, ['a', 'b']);
  assert.deepEqual(result, { sent: 2, dropped: 0, remaining: [] });
});

test('drain stops at the first network failure and keeps the tail', async () => {
  const result = await drainOutbox([entry('a'), entry('b'), entry('c')], async (item) => {
    if (item.text === 'b') throw new OfflineError('down');
  });
  assert.equal(result.sent, 1);
  assert.deepEqual(
    result.remaining.map((item) => item.text),
    ['b', 'c'],
  );
});

test('drain drops rejected 4xx entries but keeps 401s for retry', async () => {
  const result = await drainOutbox([entry('ok'), entry('bad'), entry('unauthorized')], async (item) => {
    if (item.text === 'bad') throw new CliError('invalid_field', 'text too long', 1);
    if (item.text === 'unauthorized') throw new CliError('unauthorized', 'revoked', 3);
  });
  assert.equal(result.sent, 1);
  assert.equal(result.dropped, 1);
  assert.deepEqual(
    result.remaining.map((item) => item.text),
    ['unauthorized'],
  );
});

test('replaying the same queue is idempotent at the API contract level', async () => {
  const seen = new Set<string>();
  let calls = 0;
  const send = async (item: PendingFact) => {
    calls += 1;
    seen.add(item.text);
  };
  await drainOutbox([entry('same')], send);
  await drainOutbox([entry('same')], send);
  assert.equal(calls, 2);
  assert.equal(seen.size, 1);
});