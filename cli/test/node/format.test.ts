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

test('pinned and importance marks stay inside the line budget', () => {
  const line = formatFactLine(fact({ pinned: true, importance: 5 }));
  assert.ok(line.includes('★'));
  assert.ok(line.includes('5/5'));
  assert.ok(Array.from(line).length <= 100);

  const defaultLine = formatFactLine(fact({ importance: 3 }));
  assert.ok(!defaultLine.includes('3/5'));

  const detail = formatDetail(fact({ pinned: true, importance: 5, supersededBy: 'abcdef12-0000-0000-0000-000000000000' }));
  assert.ok(detail.includes('pinned'));
  assert.ok(detail.includes('importance 5/5'));
  assert.ok(detail.includes('superseded by abcdef12'));
});

test('formatDetail exposes provenance and tags', () => {
  const detail = formatDetail(fact());
  assert.ok(detail.includes(base.text));
  assert.ok(detail.includes('tags: arch'));
  assert.ok(detail.includes('from dsh on win-desktop'));
});

test('formatDetail renders a live pointer set', () => {
  const evidence = {
    paths: ['cli/src/format.ts'],
    symbols: ['formatFactLine'],
    check: 'pnpm -r test',
    commit: 'abc1234def01',
    at: Date.UTC(2026, 10, 18),
  };
  const detail = formatDetail(fact({ evidence }), { exists: () => true });
  assert.ok(detail.includes('evidence: cli/src/format.ts'));
  assert.ok(detail.includes('formatFactLine'));
  assert.ok(detail.includes('check: pnpm -r test'));
  assert.ok(detail.includes('@abc1234def01'));
  assert.ok(detail.includes('2026-11-18'));
});

test('a dead pointer set is dropped whole instead of dressed up', () => {
  const evidence = {
    paths: ['cli/src/format.ts'],
    symbols: ['formatFactLine'],
    check: 'pnpm -r test',
    commit: 'abc1234def01',
    at: Date.UTC(2026, 10, 18),
  };
  const detail = formatDetail(fact({ evidence }), { exists: () => false });
  assert.ok(detail.includes('已失效'));
  assert.ok(detail.includes(base.text), 'the fact itself survives a stale pointer');
  assert.ok(!detail.includes('check: pnpm -r test'), 'an unusable check must not be presented');
  assert.ok(!detail.includes('formatFactLine'));
});

test('evidence never enters the search envelope', () => {
  const line = formatFactLine(
    fact({ evidence: { paths: ['cli/src/format.ts'], symbols: [], check: 'pnpm -r test', commit: '', at: 0 } }),
  );
  assert.ok(!line.includes('evidence'));
  assert.ok(!line.includes('cli/src/format.ts'));
  assert.ok(Array.from(line).length <= 100);
});

test('dirty evidence marks the captured commit as uncommitted', () => {
  const evidence = {
    paths: ['cli/src/format.ts'],
    symbols: [],
    check: '',
    commit: 'abc1234def01',
    dirty: true,
    at: Date.UTC(2026, 10, 18),
  };
  const detail = formatDetail(fact({ evidence }), { exists: () => true });
  assert.ok(detail.includes('@abc1234def01 (未提交)'));
});

test('clean evidence leaves the commit unmarked', () => {
  const evidence = {
    paths: ['cli/src/format.ts'],
    symbols: [],
    check: '',
    commit: 'abc1234def01',
    dirty: false,
    at: Date.UTC(2026, 10, 18),
  };
  const detail = formatDetail(fact({ evidence }), { exists: () => true });
  assert.ok(detail.includes('@abc1234def01'));
  assert.ok(!detail.includes('未提交'));
});

test('a changed blob is reported as drift while the fact and pointers stay', () => {
  const evidence = {
    paths: ['cli/src/format.ts'],
    symbols: [],
    check: '',
    commit: 'abc1234def01',
    blobs: { 'cli/src/format.ts': 'a'.repeat(40) },
    at: Date.UTC(2026, 10, 18),
  };
  const detail = formatDetail(fact({ evidence }), {
    exists: () => true,
    digest: () => ({ 'cli/src/format.ts': 'b'.repeat(40) }),
  });
  assert.ok(detail.includes('内容已改: cli/src/format.ts'));
  assert.ok(detail.includes(base.text), 'drift must not drop the fact');
  assert.ok(detail.includes('@abc1234def01'), 'drift must not drop the commit pointer');
});

test('missing digest hashes stay silent instead of inventing drift', () => {
  const evidence = {
    paths: ['cli/src/format.ts'],
    symbols: [],
    check: '',
    commit: 'abc1234def01',
    blobs: { 'cli/src/format.ts': 'a'.repeat(40) },
    at: Date.UTC(2026, 10, 18),
  };
  const withoutDigest = formatDetail(fact({ evidence }), { exists: () => true });
  assert.ok(!withoutDigest.includes('内容已改'));
  assert.ok(withoutDigest.includes('@abc1234def01'));

  const emptyDigest = formatDetail(fact({ evidence }), { exists: () => true, digest: () => ({}) });
  assert.ok(!emptyDigest.includes('内容已改'));
  assert.ok(emptyDigest.includes('@abc1234def01'));
});

test('a matching blob stays quiet', () => {
  const hash = 'a'.repeat(40);
  const evidence = {
    paths: ['cli/src/format.ts'],
    symbols: [],
    check: '',
    commit: 'abc1234def01',
    blobs: { 'cli/src/format.ts': hash },
    at: Date.UTC(2026, 10, 18),
  };
  const detail = formatDetail(fact({ evidence }), {
    exists: () => true,
    digest: () => ({ 'cli/src/format.ts': hash }),
  });
  assert.ok(!detail.includes('内容已改'));
  assert.ok(detail.includes('@abc1234def01'));
});

test('a fact without evidence says nothing about it', () => {
  assert.ok(!formatDetail(fact()).includes('evidence:'));
});