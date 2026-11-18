import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import { activate, addFact, call, resetDb } from './helpers.ts';

beforeEach(resetDb);

interface CreatedBody {
  fact: { id: string; pinned: boolean; importance: number; supersededBy: string | null };
  deduped: boolean;
}

interface ListBody {
  facts: Array<{ id: string; text: string; supersededBy: string | null }>;
  next: string | null;
}

interface StatsBody {
  project: string;
  facts: number;
  byKind: Record<string, number>;
  activeByKind: Record<string, number>;
  pinned: number;
  superseded: number;
}

test('stats expose kind counts, pinned and superseded totals', async () => {
  const a = await activate('win-desktop');
  const first = await addFact(a.token, { project: 'loam', kind: 'decision', text: 'one', pinned: true, importance: 5 });
  assert.equal(first.status, 201);
  const created = (await first.json()) as CreatedBody;
  assert.equal(created.fact.pinned, true);
  assert.equal(created.fact.importance, 5);

  const second = await addFact(a.token, { project: 'loam', kind: 'decision', text: 'two', pinned: true, importance: 4 });
  const secondBody = (await second.json()) as CreatedBody;
  const third = await addFact(a.token, {
    project: 'loam',
    kind: 'pitfall',
    text: 'three',
    supersedes: secondBody.fact.id,
  });
  assert.equal(third.status, 201);

  const retired = await call(a.token, `/v1/facts/${secondBody.fact.id}`);
  assert.equal(((await retired.json()) as CreatedBody).fact.pinned, false);

  const response = await call(a.token, '/v1/stats?project=loam');
  assert.equal(response.status, 200);
  const body = (await response.json()) as StatsBody;
  assert.equal(body.facts, 3);
  assert.deepEqual(body.byKind, { decision: 2, pitfall: 1, convention: 0, fact: 0 });
  assert.deepEqual(body.activeByKind, { decision: 1, pitfall: 1, convention: 0, fact: 0 });
  assert.equal(body.pinned, 1, 'only the surviving pinned fact counts');
  assert.equal(body.superseded, 1);
});

test('superseded facts drop out of the default list and can be patched', async () => {
  const a = await activate('win-desktop');
  const first = await addFact(a.token, { project: 'loam', kind: 'decision', text: 'one' });
  const created = (await first.json()) as CreatedBody;
  await addFact(a.token, { project: 'loam', kind: 'decision', text: 'two', supersedes: created.fact.id });

  const visible = await call(a.token, '/v1/facts?project=loam');
  const visibleBody = (await visible.json()) as ListBody;
  assert.equal(visibleBody.facts.length, 1);
  assert.equal(visibleBody.facts[0].text, 'two');

  const history = await call(a.token, '/v1/facts?project=loam&include_superseded=1&sort=rank');
  const historyBody = (await history.json()) as ListBody;
  assert.equal(historyBody.facts.length, 2);
  assert.equal(historyBody.next, null);

  const patched = await call(a.token, `/v1/facts/${created.fact.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ pinned: true, importance: 4 }),
  });
  assert.equal(patched.status, 200);
  const patchedBody = (await patched.json()) as CreatedBody;
  assert.equal(patchedBody.fact.pinned, true);
  assert.equal(patchedBody.fact.importance, 4);

  const cleared = await call(a.token, `/v1/facts/${created.fact.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ supersededBy: null }),
  });
  assert.equal(cleared.status, 200);
  assert.equal(((await cleared.json()) as CreatedBody).fact.supersededBy, null);
});

test('invalid memory-shape inputs are rejected', async () => {
  const a = await activate('win-desktop');
  const created = (await (await addFact(a.token, { project: 'loam', text: 'one' })).json()) as CreatedBody;

  const badImportance = await addFact(a.token, { project: 'loam', text: 'two', importance: 9 });
  assert.equal(badImportance.status, 400);

  const badPinned = await call(a.token, `/v1/facts/${created.fact.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ pinned: 'yes' }),
  });
  assert.equal(badPinned.status, 400);

  const badSupersede = await addFact(a.token, { project: 'loam', text: 'three', supersedes: 'ffffff' });
  assert.equal(badSupersede.status, 400);
  assert.equal(((await badSupersede.json()) as { error: { code: string } }).error.code, 'invalid_supersedes');

  const rankCursor = await call(a.token, '/v1/facts?project=loam&sort=rank&cursor=1_x');
  assert.equal(rankCursor.status, 400);

  const badSort = await call(a.token, '/v1/facts?project=loam&sort=random');
  assert.equal(badSort.status, 400);
});