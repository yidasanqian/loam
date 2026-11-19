import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';
import pkg from '../../package.json';
import { activate, addFact, call, resetDb } from './helpers.ts';

beforeEach(resetDb);

interface Evidence {
  paths: string[];
  symbols: string[];
  check: string;
  commit: string;
  at: number;
}

interface CreatedBody {
  fact: { id: string; evidence: Evidence | null };
  deduped: boolean;
}

interface ListBody {
  facts: Array<{ id: string; text: string; evidence: Evidence | null }>;
}

async function create(token: string, body: Record<string, unknown>): Promise<CreatedBody> {
  return (await (await addFact(token, body)).json()) as CreatedBody;
}

test('evidence round-trips and normalizes its pointers', async () => {
  const a = await activate('win-desktop');
  const created = await addFact(a.token, {
    project: 'loam',
    kind: 'convention',
    text: '工整的行宽上限是 100 字符',
    evidence: {
      paths: ['./cli/src/format.ts'],
      symbols: ['formatFactLine'],
      check: 'pnpm -r test',
      commit: 'abc1234def',
      at: 1_760_000_000_000,
    },
  });
  assert.equal(created.status, 201);
  const evidence = ((await created.json()) as CreatedBody).fact.evidence;
  assert.ok(evidence, 'evidence must be stored');
  assert.deepEqual(evidence.paths, ['cli/src/format.ts'], './ is stripped at the boundary');
  assert.deepEqual(evidence.symbols, ['formatFactLine']);
  assert.equal(evidence.check, 'pnpm -r test');
  assert.equal(evidence.commit, 'abc1234def');
  assert.equal(evidence.at, 1_760_000_000_000);
});

test('an empty pointer set is stored as no evidence', async () => {
  const a = await activate('win-desktop');
  const body = await create(a.token, {
    project: 'loam',
    text: 'no pointers here',
    evidence: { paths: [], symbols: [], check: '', commit: '' },
  });
  assert.equal(body.fact.evidence, null);
});

test('a path reverses to the facts scoped to it', async () => {
  const a = await activate('win-desktop');
  await create(a.token, {
    project: 'loam',
    text: 'format lines stay under 100 chars',
    evidence: { paths: ['cli/src/format.ts'] },
  });
  await create(a.token, {
    project: 'loam',
    text: 'worker rejects absolute evidence paths',
    evidence: { paths: ['worker/src/validate.ts'] },
  });

  const hit = await call(a.token, `/v1/facts?project=loam&file=${encodeURIComponent('cli/src/format.ts')}`);
  assert.equal(hit.status, 200);
  const hitBody = (await hit.json()) as ListBody;
  assert.equal(hitBody.facts.length, 1);
  assert.equal(hitBody.facts[0].text, 'format lines stay under 100 chars');

  const miss = await call(a.token, `/v1/facts?project=loam&file=${encodeURIComponent('cli/src/format.test.ts')}`);
  assert.equal(miss.status, 200);
  assert.equal(((await miss.json()) as ListBody).facts.length, 0);
});

test('unfollowable pointers are rejected', async () => {
  const a = await activate('win-desktop');
  for (const path of ['/etc/passwd', 'C:/repo/a.ts', 'cli/src/format.ts:26', '../outside.ts', 'a b.ts']) {
    const response = await addFact(a.token, {
      project: 'loam',
      text: `path ${path}`,
      evidence: { paths: [path] },
    });
    assert.equal(response.status, 400, `path ${JSON.stringify(path)} must be rejected`);
  }

  const badCommit = await addFact(a.token, { project: 'loam', text: 'x', evidence: { commit: 'not-a-sha' } });
  assert.equal(badCommit.status, 400);

  const badSymbol = await addFact(a.token, { project: 'loam', text: 'y', evidence: { symbols: ['not a symbol'] } });
  assert.equal(badSymbol.status, 400);

  const tooMany = await addFact(a.token, {
    project: 'loam',
    text: 'z',
    evidence: { paths: Array.from({ length: 9 }, (_, index) => `src/f${index}.ts`) },
  });
  assert.equal(tooMany.status, 400);
});

test('re-recording the same claim widens its scope instead of dropping it', async () => {
  const a = await activate('win-desktop');
  const first = await create(a.token, {
    project: 'loam',
    kind: 'convention',
    text: 'format lines stay under 100 chars',
    evidence: { paths: ['cli/src/format.ts'], commit: 'aaaaaaa' },
  });
  const second = await create(a.token, {
    project: 'loam',
    kind: 'convention',
    text: 'format lines stay under 100 chars',
    evidence: { paths: ['cli/src/bin.ts', 'cli/src/format.ts'], symbols: ['formatDetail'] },
  });
  assert.equal(second.deduped, true, 'the text is still a duplicate');
  assert.equal(second.fact.id, first.fact.id);
  assert.deepEqual(second.fact.evidence?.paths, ['cli/src/format.ts', 'cli/src/bin.ts']);
  assert.deepEqual(second.fact.evidence?.symbols, ['formatDetail']);
  assert.equal(second.fact.evidence?.commit, 'aaaaaaa', 'an older anchor is kept when the new write has none');
});

test('evidence can be replaced and cleared by patch', async () => {
  const a = await activate('win-desktop');
  const created = await create(a.token, {
    project: 'loam',
    text: 'patched',
    evidence: { paths: ['cli/src/format.ts'] },
  });

  const replaced = await call(a.token, `/v1/facts/${created.fact.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ evidence: { paths: ['worker/src/facts.ts'], symbols: ['createFact'] } }),
  });
  assert.equal(replaced.status, 200);
  const replacedBody = (await replaced.json()) as CreatedBody;
  assert.deepEqual(replacedBody.fact.evidence?.paths, ['worker/src/facts.ts']);

  const cleared = await call(a.token, `/v1/facts/${created.fact.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ evidence: null }),
  });
  assert.equal(cleared.status, 200);
  assert.equal(((await cleared.json()) as CreatedBody).fact.evidence, null);
});

test('/v1/me reports the version clients gate evidence features on', async () => {
  const a = await activate('win-desktop');
  const body = (await (await call(a.token, '/v1/me')).json()) as { version: string };
  assert.match(body.version, /^\d+\.\d+\.\d+$/);
  assert.equal(body.version, pkg.version, 'worker VERSION must mirror worker/package.json');
});