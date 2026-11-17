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

  test('editing a fact rewrites it and rejects duplicate text', async () => {
    const a = await activate('win-desktop');
    const created = await addFact(a.token, { project: 'loam', text: 'alpha' });
    const first = (await created.json()) as { fact: { id: string } };
    const second = await addFact(a.token, { project: 'loam', text: 'beta' });
    assert.equal(second.status, 201);

    const patched = await call(a.token, `/v1/facts/${first.fact.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ text: 'gamma', tags: ['edited'] }),
    });
    assert.equal(patched.status, 200);
    const body = (await patched.json()) as { fact: { text: string; tags: string[] } };
    assert.equal(body.fact.text, 'gamma');
    assert.deepEqual(body.fact.tags, ['edited']);

    const conflict = await call(a.token, `/v1/facts/${first.fact.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ text: 'beta' }),
    });
    assert.equal(conflict.status, 409);
  });

  test('projects endpoint lists counts', async () => {
    const a = await activate('win-desktop');
    await addFact(a.token, { project: 'loam', text: 'one' });
    await addFact(a.token, { project: 'other', text: 'two' });
    const response = await call(a.token, '/v1/projects');
    assert.equal(response.status, 200);
    const body = (await response.json()) as { projects: Array<{ project: string; facts: number }> };
    assert.deepEqual(
      body.projects.map((entry) => entry.project).sort(),
      ['loam', 'other'],
    );
    assert.equal(body.projects.find((entry) => entry.project === 'loam')?.facts, 1);
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