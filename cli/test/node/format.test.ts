import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDetail, formatFactLine, formatFacts, oneLine, shortId } from '../../src/format.ts';
import type { Fact } from '../../src/client.ts';

const base = {
  id: '9f1c2d3e-4b5a-6c7d-8e9f-001122334455',
  project: 'loam',
  kind: 'decision',
  text: 'Use Hono for the worker',
  tags: ['arch'],
  harness: 'dsh',
  deviceId: 'dev-1',
  deviceName: 'win-desktop',
  createdAt: Date.UTC(2026, 10, 17),
};

function fact(overrides: Partial<Fact> = {}): Fact {
  return { ...base, ...overrides };
}

test('oneLine truncates by code points', () => {
  assert.equal(oneLine('abc', 5), 'abc');
  assert.equal(oneLine('abcdef', 4), 'abc…');
  assert.equal(oneLine('林壤林壤林壤', 4), '林壤林…');
  assert.equal(oneLine('  多  空格  ', 10), '多 空格');
});

test('a fact line never exceeds 100 characters', () => {
  const line = formatFactLine(fact({ text: '长'.repeat(500) }));
  assert.ok(Array.from(line).length <= 100, `line was ${Array.from(line).length}`);
  assert.ok(line.includes('[decision]'));
  assert.ok(line.includes(shortId(base.id)));
});

test('formatFacts keeps at most 5 facts plus one hint line', () => {
  const facts = Array.from({ length: 5 }, (_, index) => fact({ id: `id-${index}`, text: `fact ${index}` }));
  const lines = formatFacts(facts, { hasMore: true });
  assert.equal(lines.length, 6);
  for (const line of lines) assert.ok(Array.from(line).length <= 100);
});

test('formatFacts reports an empty result', () => {
  assert.deepEqual(formatFacts([]), ['无命中。']);
});

test('formatDetail exposes provenance and tags', () => {
  const detail = formatDetail(fact());
  assert.ok(detail.includes(base.text));
  assert.ok(detail.includes('tags: arch'));
  assert.ok(detail.includes('from dsh on win-desktop'));
});