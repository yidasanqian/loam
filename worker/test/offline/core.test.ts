import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authenticate } from '../../src/auth.ts';
import { activateDevice, listDevices, revokeDevice, rotateToken } from '../../src/devices.ts';
import {
  countProject,
  createFact,
  deleteFact,
  getFact,
  importFacts,
  pruneFacts,
  searchFacts,
} from '../../src/facts.ts';
import { ApiFailure } from '../../src/errors.ts';
import type { Device } from '../../src/model.ts';
import { parseDurationDays, parseSearchParams, validateFactInput } from '../../src/validate.ts';
import { allow, resetFallbackLimits } from '../../src/rate.ts';
import { createTestDb } from './sqlite-shim.ts';

const DAY = 86_400_000;

function device(id: string, name = 'win-desktop'): Device {
  return { id, name, scopes: ['read', 'write'] };
}

test('device activation is idempotent by name and rotates the token', async () => {
  const db = createTestDb();
  const first = await activateDevice(db, 'win-desktop', 1000, 'read,write');
  const oldToken = first.token;
  const second = await activateDevice(db, 'win-desktop', 2000, 'read,write');
  assert.equal(second.created, false);
  assert.equal(second.device.id, first.device.id);
  assert.notEqual(second.token, oldToken);
  assert.equal((await listDevices(db)).length, 1);
  await assert.rejects(() => authenticate(db, oldToken), (err: unknown) => {
    return err instanceof ApiFailure && err.status === 401;
  });
  assert.equal((await authenticate(db, second.token)).name, 'win-desktop');
});

test('revocation invalidates only the revoked device', async () => {
  const db = createTestDb();
  const a = await activateDevice(db, 'win-desktop', 1000, 'read,write');
  const b = await activateDevice(db, 'macbook', 1001, 'read,write');
  const revoked = await revokeDevice(db, a.device.id.slice(0, 8), 2000);
  assert.ok(revoked);
  assert.equal(revoked.revokedAt, 2000);
  await assert.rejects(() => authenticate(db, a.token), /device revoked/);
  assert.equal((await authenticate(db, b.token)).name, 'macbook');
  assert.equal(await revokeDevice(db, a.device.id, 3000), null);
  assert.equal(await rotateToken(db, b.device.id.slice(0, 8), 3000).then((token) => typeof token), 'string');
  assert.equal((await listDevices(db)).filter((d) => d.revokedAt !== null).length, 1);
});

test('rotateToken refuses revoked devices', async () => {
  const db = createTestDb();
  const a = await activateDevice(db, 'win-desktop', 1000, 'read,write');
  await revokeDevice(db, a.device.id, 2000);
  assert.equal(await rotateToken(db, a.device.id, 3000), null);
});

test('repeated writes of the same fact collapse to one row', async () => {
  const db = createTestDb();
  const dev = device('dev-a');
  const input = validateFactInput({ project: 'loam', kind: 'decision', text: 'Use Hono for the worker', tags: ['arch'] });
  const first = await createFact(db, dev, input, 10_000);
  const second = await createFact(db, dev, input, 20_000);
  const third = await createFact(db, dev, { ...input, text: '  Use Hono   for the worker  ' }, 30_000);
  assert.equal(first.deduped, false);
  assert.equal(second.deduped, true);
  assert.equal(third.deduped, true);
  assert.equal(third.fact.id, first.fact.id);
  assert.equal(await countProject(db, 'loam'), 1);
  assert.deepEqual(third.fact.tags, ['arch']);
  assert.equal((await getFact(db, first.fact.id.slice(0, 8)))?.id, first.fact.id);
});

test('search filters by kind, tag, text and pages with a cursor', async () => {
  const db = createTestDb();
  const dev = device('dev-a');
  const add = (text: string, kind: string, tags: string[], at: number) =>
    createFact(db, dev, validateFactInput({ project: 'loam', kind, text, tags, harness: 'dsh' }), at);
  const a = await add('Cloudflare D1 is the source of truth', 'decision', ['arch'], 1_000);
  await add('Marker blocks must stay idempotent', 'pitfall', ['installer'], 2_000);
  await add('Search returns five lines by default', 'convention', ['cli'], 3_000);

  const byKind = await searchFacts(db, parseSearchParams(new URLSearchParams('project=loam&kind=pitfall')));
  assert.deepEqual(byKind.facts.map((f) => f.kind), ['pitfall']);

  const byTag = await searchFacts(db, parseSearchParams(new URLSearchParams('project=loam&tag=cli')));
  assert.equal(byTag.facts.length, 1);

  const byText = await searchFacts(db, parseSearchParams(new URLSearchParams('project=loam&q=marker')));
  assert.equal(byText.facts[0].text.includes('Marker'), true);

  const multiWord = await searchFacts(db, parseSearchParams(new URLSearchParams('project=loam&q=cloudflare+truth')));
  assert.equal(multiWord.facts.length, 1);
  const missingWord = await searchFacts(db, parseSearchParams(new URLSearchParams('project=loam&q=cloudflare+missing')));
  assert.equal(missingWord.facts.length, 0);

  const page1 = await searchFacts(db, parseSearchParams(new URLSearchParams('project=loam&limit=1')));
  assert.equal(page1.facts.length, 1);
  assert.ok(page1.next);
  const page2 = await searchFacts(db, parseSearchParams(new URLSearchParams(`project=loam&limit=1&cursor=${page1.next}`)));
  assert.equal(page2.facts.length, 1);
  assert.notEqual(page1.facts[0].id, page2.facts[0].id);

  const otherProject = await searchFacts(db, parseSearchParams(new URLSearchParams('project=other')));
  assert.equal(otherProject.facts.length, 0);
  assert.equal(a.fact.project, 'loam');
});

test('soft delete hides a fact and prune respects the age cutoff', async () => {
  const db = createTestDb();
  const dev = device('dev-a');
  const now = Date.now();
  const old = await createFact(db, dev, validateFactInput({ project: 'loam', text: 'old fact' }), now - 200 * DAY);
  const fresh = await createFact(db, dev, validateFactInput({ project: 'loam', text: 'fresh fact' }), now);

  assert.equal(await deleteFact(db, fresh.fact.id, now), true);
  assert.equal(await getFact(db, fresh.fact.id), null);
  assert.equal(await deleteFact(db, fresh.fact.id, now), false);

  const pruned = await pruneFacts(db, { project: 'loam', olderThanDays: 180, now });
  assert.equal(pruned, 1);
  assert.equal(await getFact(db, old.fact.id), null);
});

test('re-adding a pruned fact revives it instead of staying hidden', async () => {
  const db = createTestDb();
  const dev = device('dev-a');
  const now = Date.now();
  const input = validateFactInput({ project: 'loam', text: 'revived fact' });
  const first = await createFact(db, dev, input, now - 200 * DAY);
  await pruneFacts(db, { project: 'loam', olderThanDays: 180, now });
  assert.equal(await getFact(db, first.fact.id), null);
  const revived = await createFact(db, dev, input, now);
  assert.equal(revived.deduped, true);
  assert.equal(revived.fact.id, first.fact.id);
  assert.notEqual(await getFact(db, first.fact.id), null);
});

test('fallback limiter enforces the sliding window', async () => {
  resetFallbackLimits();
  const now = 1_000_000;
  assert.equal(await allow(undefined, 'dev:a', 2, 60, now), true);
  assert.equal(await allow(undefined, 'dev:a', 2, 60, now + 1), true);
  assert.equal(await allow(undefined, 'dev:a', 2, 60, now + 2), false);
  assert.equal(await allow(undefined, 'dev:b', 2, 60, now + 2), true);
  assert.equal(await allow(undefined, 'dev:a', 2, 60, now + 61_000), true);
});

test('import dedupes against existing rows and within one batch', async () => {
  const db = createTestDb();
  const dev = device('dev-b');
  const items = [
    { project: 'loam', kind: 'fact', text: 'one', created_at: 1_000 },
    { project: 'loam', kind: 'fact', text: 'two', created_at: 2_000 },
    { project: 'loam', kind: 'fact', text: 'one' },
  ];
  const first = await importFacts(db, dev, items, 5_000);
  assert.deepEqual(first, { inserted: 2, deduped: 1 });
  const second = await importFacts(db, dev, items, 6_000);
  assert.deepEqual(second, { inserted: 0, deduped: 3 });
  assert.equal(await countProject(db, 'loam'), 2);
});

test('input limits are enforced', async () => {
  assert.throws(() => validateFactInput({ project: 'loam', text: '   ' }), /text must not be empty/);
  assert.throws(() => validateFactInput({ project: 'bad project', text: 'x' }), /project may only contain/);
  assert.throws(() => validateFactInput({ project: 'loam', kind: 'nope', text: 'x' }), /kind must be one of/);
  assert.throws(
    () => validateFactInput({ project: 'loam', text: 'x'.repeat(4097) }),
    (err: unknown) => err instanceof ApiFailure && err.status === 413,
  );
  assert.equal(parseDurationDays('180d'), 180);
  assert.equal(parseDurationDays('12h'), 1);
  assert.throws(() => parseSearchParams(new URLSearchParams('limit=1')), /project is required/);
});