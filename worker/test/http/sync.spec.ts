import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'vitest';
import { activate, addFact, call, resetDb, search, stats } from './helpers.ts';

beforeEach(resetDb);

describe('sync', () => {
  test('A writes, B reads the same project', async () => {
    const a = await activate('win-desktop');
    const b = await activate('macbook');

    const created = await addFact(a.token, { project: 'loam', kind: 'decision', text: 'D1 is the source of truth', harness: 'dsh' });
    assert.equal(created.status, 201);

    const found = await search(b.token, 'project=loam&q=source');
    assert.equal(found.facts.length, 1);
    assert.equal(found.facts[0].text, 'D1 is the source of truth');
  });

  test('B writes, A reads', async () => {
    const a = await activate('win-desktop');
    const b = await activate('macbook');
    await addFact(b.token, { project: 'loam', kind: 'pitfall', text: 'Marker blocks must be idempotent' });
    const found = await search(a.token, 'project=loam');
    assert.equal(found.facts.length, 1);
  });

  test('three identical writes produce one row', async () => {
    const a = await activate('win-desktop');
    for (let i = 0; i < 3; i += 1) {
      const response = await addFact(a.token, { project: 'loam', text: 'CLI is commander based' });
      assert.ok(response.status === 201 || response.status === 200);
    }
    assert.equal(await stats(a.token, 'loam'), 1);
    const response = await addFact(a.token, { project: 'loam', text: 'CLI is commander based' });
    const body = (await response.json()) as { deduped: boolean };
    assert.equal(body.deduped, true);
  });

  test('concurrent writes of different facts both persist', async () => {
    const a = await activate('win-desktop');
    const b = await activate('macbook');
    await Promise.all([
      addFact(a.token, { project: 'loam', text: 'fact from A' }),
      addFact(b.token, { project: 'loam', text: 'fact from B' }),
    ]);
    assert.equal(await stats(a.token, 'loam'), 2);
  });

  test('concurrent writes of the same fact still collapse', async () => {
    const a = await activate('win-desktop');
    const b = await activate('macbook');
    await Promise.all([
      addFact(a.token, { project: 'loam', text: 'same fact' }),
      addFact(b.token, { project: 'loam', text: 'same fact' }),
    ]);
    assert.equal(await stats(a.token, 'loam'), 1);
  });

  test('export pages with a cursor', async () => {
    const a = await activate('win-desktop');
    for (let i = 0; i < 3; i += 1) await addFact(a.token, { project: 'loam', text: `fact ${i}` });
    const first = await call(a.token, '/v1/export?project=loam&limit=2');
    const body1 = (await first.json()) as { facts: unknown[]; next: string | null };
    assert.equal(body1.facts.length, 2);
    assert.ok(body1.next);
    const second = await call(a.token, `/v1/export?project=loam&limit=2&cursor=${body1.next}`);
    const body2 = (await second.json()) as { facts: unknown[] };
    assert.equal(body2.facts.length, 1);
  });
});