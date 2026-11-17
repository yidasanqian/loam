import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BLOCK_END, BLOCK_START, hasBlock, removeBlock, upsertBlock } from '../../src/install/blocks.ts';

const body = '## 项目记忆\n\n- run loam search';

test('upsert creates a marked block in an empty file', () => {
  const next = upsertBlock('', body);
  assert.equal(next, `${BLOCK_START}\n${body}\n${BLOCK_END}\n`);
  assert.equal(hasBlock(next), true);
});

test('upsert keeps surrounding content and is idempotent', () => {
  const original = '# AGENTS\n\nexisting rules\n';
  const once = upsertBlock(original, body);
  const twice = upsertBlock(once, body);
  assert.equal(twice, once);
  assert.ok(once.startsWith('# AGENTS\n\nexisting rules\n\n'));
  assert.equal(once.match(/loam:start/gu)?.length, 1);
});

test('upsert replaces the old block instead of appending', () => {
  const first = upsertBlock('# x\n', 'v1');
  const second = upsertBlock(first, 'v2');
  assert.ok(second.includes('v2'));
  assert.ok(!second.includes('v1'));
  assert.equal(second.match(/loam:start/gu)?.length, 1);
});

test('remove restores the original file', () => {
  const original = '# AGENTS\n\nexisting rules\n';
  assert.equal(removeBlock(upsertBlock(original, body)), original);
  assert.equal(removeBlock(upsertBlock('', body)), '');
});

test('remove leaves files without a block untouched', () => {
  const content = '# nothing here\n';
  assert.equal(removeBlock(content), content);
  assert.equal(hasBlock(content), false);
});