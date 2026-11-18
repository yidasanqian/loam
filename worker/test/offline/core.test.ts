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
  listProjects,
  projectStats,
  pruneFacts,
  searchFacts,
  updateFact,
} from '../../src/facts.ts';
import { ApiFailure } from '../../src/errors.ts';
import type { Device } from '../../src/model.ts';
import { parseDurationDays, parseSearchParams, validateFactInput, validateFactPatch } from '../../src/validate.ts';
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

test('update rewrites the hash and rejects conflicting text', async () => {
  const db = createTestDb();
  const dev = device('dev-a');
  const first = await createFact(db, dev, validateFactInput({ project: 'loam', text: 'alpha' }), 1_000);
  await createFact(db, dev, validateFactInput({ project: 'loam', text: 'beta' }), 2_000);

  const updated = await updateFact(db, first.fact.id, { text: 'gamma', tags: ['edited'] });
  assert.equal(updated.text, 'gamma');
  assert.deepEqual(updated.tags, ['edited']);
  assert.equal((await searchFacts(db, parseSearchParams(new URLSearchParams('project=loam&q=gamma')))).facts[0].id, first.fact.id);
  assert.equal((await searchFacts(db, parseSearchParams(new URLSearchParams('project=loam&q=alpha')))).facts.length, 0);

  await assert.rejects(
    () => updateFact(db, first.fact.id, { text: 'beta' }),
    (error: unknown) => error instanceof ApiFailure && error.status === 409,
  );
  assert.deepEqual(await listProjects(db), [{ project: 'loam', facts: 2 }]);
});

test('update and project listing ignore deleted facts', async () => {
  const db = createTestDb();
  const dev = device('dev-a');
  const fact = await createFact(db, dev, validateFactInput({ project: 'loam', text: 'gone' }), 1_000);
  await deleteFact(db, fact.fact.id, 2_000);
  await assert.rejects(
    () => updateFact(db, fact.fact.id, { text: 'later' }),
    (error: unknown) => error instanceof ApiFailure && error.status === 404,
  );
  assert.deepEqual(await listProjects(db), []);
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

test('pinned and importance drive rank order, and rank rejects cursors', async () => {
  const db = createTestDb();
  const dev = device('dev-a');
  const add = (text: string, extra: Record<string, unknown>, at: number) =>
    createFact(db, dev, validateFactInput({ project: 'loam', text, ...extra }), at);
  await add('pinned oldest', { pinned: true, importance: 1 }, 500);
  await add('hot older', { importance: 5 }, 1_000);
  await add('mid older', { importance: 3 }, 2_000);
  await add('newest', {}, 4_000);

  const ranked = await searchFacts(db, parseSearchParams(new URLSearchParams('project=loam&sort=rank')));
  assert.deepEqual(
    ranked.facts.map((fact) => fact.text),
    ['pinned oldest', 'hot older', 'newest', 'mid older'],
  );
  assert.equal(ranked.next, null);

  const recent = await searchFacts(db, parseSearchParams(new URLSearchParams('project=loam')));
  assert.deepEqual(
    recent.facts.map((fact) => fact.text),
    ['newest', 'mid older', 'hot older', 'pinned oldest'],
  );

  assert.throws(
    () => parseSearchParams(new URLSearchParams('project=loam&sort=rank&cursor=1_x')),
    /cursor cannot be combined with sort=rank/,
  );
});

test('supersede hides the old fact, is validated, and is released on delete', async () => {
  const db = createTestDb();
  const dev = device('dev-a');
  const old = await createFact(
    db,
    dev,
    validateFactInput({ project: 'loam', kind: 'decision', text: 'use Hono', pinned: true, importance: 5 }),
    1_000,
  );
  const next = await createFact(
    db,
    dev,
    validateFactInput({ project: 'loam', kind: 'decision', text: 'use Hono plus D1' }),
    2_000,
    old.fact.id,
  );

  assert.equal(next.fact.supersededBy, null);
  const hidden = await getFact(db, old.fact.id);
  assert.equal(hidden?.supersededBy, next.fact.id);
  assert.equal(hidden?.pinned, false, 'a retired fact must not stay pinned');
  assert.equal((await projectStats(db, 'loam')).pinned, 0);

  const visible = await searchFacts(db, parseSearchParams(new URLSearchParams('project=loam')));
  assert.deepEqual(visible.facts.map((fact) => fact.id), [next.fact.id]);

  const history = await searchFacts(db, parseSearchParams(new URLSearchParams('project=loam&include_superseded=1')));
  assert.equal(history.facts.length, 2);

  await assert.rejects(
    () => createFact(db, dev, validateFactInput({ project: 'loam', text: 'again' }), 3_000, old.fact.id),
    (error: unknown) => error instanceof ApiFailure && /already superseded/.test(error.message),
  );

  const other = await createFact(db, dev, validateFactInput({ project: 'other', text: 'elsewhere' }), 4_000);
  await assert.rejects(
    () => createFact(db, dev, validateFactInput({ project: 'loam', text: 'cross project' }), 5_000, other.fact.id),
    (error: unknown) => error instanceof ApiFailure && /another project/.test(error.message),
  );
  await assert.rejects(
    () => createFact(db, dev, validateFactInput({ project: 'loam', text: 'missing' }), 6_000, 'ffffff'),
    (error: unknown) => error instanceof ApiFailure && /not found/.test(error.message),
  );

  await deleteFact(db, next.fact.id, 7_000);
  assert.equal((await getFact(db, old.fact.id))?.supersededBy, null);
});

test('prune skips pinned facts and revive keeps the memory shape', async () => {
  const db = createTestDb();
  const dev = device('dev-a');
  const now = Date.now();
  const pinned = await createFact(
    db,
    dev,
    validateFactInput({ project: 'loam', text: 'keep me', pinned: true, importance: 5 }),
    now - 300 * DAY,
  );
  await createFact(db, dev, validateFactInput({ project: 'loam', text: 'drop me' }), now - 300 * DAY);

  assert.equal(await pruneFacts(db, { project: 'loam', olderThanDays: 180, now }), 1);
  assert.notEqual(await getFact(db, pinned.fact.id), null);

  await deleteFact(db, pinned.fact.id, now);
  const revived = await createFact(
    db,
    dev,
    validateFactInput({ project: 'loam', text: 'keep me', pinned: true, importance: 5 }),
    now,
  );
  assert.equal(revived.fact.id, pinned.fact.id);
  assert.equal(revived.fact.pinned, true);
  assert.equal(revived.fact.importance, 5);
});

test('project stats, patch validation and import carry the memory shape', async () => {
  const db = createTestDb();
  const dev = device('dev-a');
  const decision = await createFact(
    db,
    dev,
    validateFactInput({ project: 'loam', kind: 'decision', text: 'a', pinned: true, importance: 4 }),
    1_000,
  );
  await createFact(db, dev, validateFactInput({ project: 'loam', kind: 'pitfall', text: 'b' }), 2_000);
  await createFact(db, dev, validateFactInput({ project: 'loam', kind: 'pitfall', text: 'c' }), 3_000, decision.fact.id);

  const stats = await projectStats(db, 'loam');
  assert.equal(stats.facts, 3);
  assert.deepEqual(stats.byKind, { decision: 1, pitfall: 2, convention: 0, fact: 0 });
  assert.deepEqual(stats.activeByKind, { decision: 0, pitfall: 2, convention: 0, fact: 0 });
  assert.equal(stats.pinned, 0, 'the retired decision lost its pin');
  assert.equal(stats.superseded, 1);

  const patched = await updateFact(db, decision.fact.id, { pinned: false, importance: 2 });
  assert.equal(patched.pinned, false);
  assert.equal(patched.importance, 2);
  assert.equal((await updateFact(db, decision.fact.id, { supersededBy: null })).supersededBy, null);

  assert.throws(() => validateFactPatch({ importance: 6 }), /importance must be an integer/);
  assert.throws(() => validateFactPatch({ pinned: 1 }), /pinned must be a boolean/);
  assert.throws(
    () => validateFactPatch({ supersededBy: 'abc' }),
    (error: unknown) => error instanceof ApiFailure && error.code === 'unsupported_supersede',
  );
  assert.throws(() => validateFactPatch({}), /nothing to update/);

  await importFacts(
    db,
    dev,
    [{ project: 'loam', kind: 'convention', text: 'imported', pinned: true, importance: 5 }],
    4_000,
  );
  const imported = (
    await searchFacts(db, parseSearchParams(new URLSearchParams('project=loam&pinned=1&include_superseded=1')))
  ).facts.find((fact) => fact.text === 'imported');
  assert.equal(imported?.importance, 5);
  assert.equal(imported?.pinned, true);
});