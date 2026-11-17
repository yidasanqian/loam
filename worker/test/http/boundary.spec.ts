import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'vitest';
import { activate, addFact, call, resetDb, search, stats } from './helpers.ts';

beforeEach(resetDb);

describe('boundaries', () => {
  test('rejects text over 4 KB', async () => {
    const a = await activate('win-desktop');
    const response = await addFact(a.token, { project: 'loam', text: 'x'.repeat(4097) });
    assert.equal(response.status, 413);
    assert.equal(await stats(a.token, 'loam'), 0);
  });

  test('empty search returns an empty page', async () => {
    const a = await activate('win-desktop');
    const found = await search(a.token, 'project=empty');
    assert.deepEqual(found.facts, []);
    assert.equal(found.next, null);
  });

  test('project is required unless all=1', async () => {
    const a = await activate('win-desktop');
    assert.equal((await call(a.token, '/v1/facts')).status, 400);
    assert.equal((await call(a.token, '/v1/facts?all=1')).status, 200);
  });

  test('search default limit is five', async () => {
    const a = await activate('win-desktop');
    for (let i = 0; i < 7; i += 1) await addFact(a.token, { project: 'loam', text: `fact ${i}` });
    const found = await search(a.token, 'project=loam');
    assert.equal(found.facts.length, 5);
    assert.ok(found.next);
  });

  test('prune soft-deletes old facts only', async () => {
    const a = await activate('win-desktop');
    await addFact(a.token, { project: 'loam', text: 'fresh fact' });
    const pruned = await call(a.token, '/v1/facts?project=loam&older=1d', { method: 'DELETE' });
    assert.equal(pruned.status, 200);
    const prunedBody = (await pruned.json()) as { deleted: number };
    assert.equal(typeof prunedBody.deleted, 'number');
    assert.equal(await stats(a.token, 'loam'), 1);
    const all = await call(a.token, '/v1/facts?all=1&older=1d', { method: 'DELETE' });
    assert.equal(all.status, 200);
  });

  test('import rejects oversized batches', async () => {
    const a = await activate('win-desktop');
    const facts = Array.from({ length: 201 }, (_, i) => ({ project: 'loam', text: `fact ${i}` }));
    const response = await call(a.token, '/v1/import', { method: 'POST', body: JSON.stringify({ facts }) });
    assert.equal(response.status, 413);
  });
});