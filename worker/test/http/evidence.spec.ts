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
  dirty?: boolean;
  blobs?: Record<string, string>;
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

async function read(token: string, id: string): Promise<Evidence | null> {
  const response = await call(token, `/v1/facts/${id}`);
  assert.equal(response.status, 200);
  return ((await response.json()) as { fact: { evidence: Evidence | null } }).fact.evidence;
}

async function failure(response: Response): Promise<{ code: string; message: string }> {
  return ((await response.json()) as { error: { code: string; message: string } }).error;
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

test('a dirty worktree anchor round-trips with its commit', async () => {
  const a = await activate('win-desktop');
  const created = await create(a.token, {
    project: 'loam',
    kind: 'pitfall',
    text: 'the worktree was dirty when this was captured',
    evidence: { paths: ['cli/src/format.ts'], commit: 'abc1234', dirty: true },
  });
  assert.equal(created.fact.evidence?.dirty, true);
  assert.equal(created.fact.evidence?.commit, 'abc1234');
  const fetched = await read(a.token, created.fact.id);
  assert.deepEqual(fetched, {
    paths: ['cli/src/format.ts'],
    symbols: [],
    check: '',
    commit: 'abc1234',
    dirty: true,
    at: 0,
  });
  assert.equal('blobs' in (fetched ?? {}), false, 'an absent blob map stays absent');
});

test('a non-boolean dirty flag is rejected and a commitless one is dropped', async () => {
  const a = await activate('win-desktop');
  const bad = await addFact(a.token, {
    project: 'loam',
    text: 'dirty typed wrong',
    evidence: { paths: ['cli/src/format.ts'], commit: 'abc1234', dirty: 'true' },
  });
  assert.equal(bad.status, 400);
  assert.deepEqual(await failure(bad), { code: 'invalid_field', message: 'dirty must be a boolean' });

  const commitless = await create(a.token, {
    project: 'loam',
    text: 'no commit to pin a dirty flag to',
    evidence: { paths: ['cli/src/format.ts'], dirty: true },
  });
  assert.ok(commitless.fact.evidence);
  assert.equal(commitless.fact.evidence.commit, '');
  assert.equal('dirty' in commitless.fact.evidence, false, 'dirty without a commit is dropped silently');

  const dirtyOnly = await create(a.token, { project: 'loam', text: 'only a dirty flag', evidence: { dirty: true } });
  assert.equal(dirtyOnly.fact.evidence, null, 'dirty alone is not evidence');
});

test('blobs anchor captured contents to the paths they belong to', async () => {
  const a = await activate('win-desktop');
  const created = await create(a.token, {
    project: 'loam',
    text: 'blob anchored claim',
    evidence: { paths: ['cli/src/format.ts'], commit: 'abc1234', blobs: { 'cli/src/format.ts': 'deadbeef' } },
  });
  assert.equal(created.fact.evidence?.commit, 'abc1234');
  assert.deepEqual(created.fact.evidence?.blobs, { 'cli/src/format.ts': 'deadbeef' });
  assert.deepEqual((await read(a.token, created.fact.id))?.blobs, { 'cli/src/format.ts': 'deadbeef' });

  const empty = await create(a.token, {
    project: 'loam',
    text: 'empty blob map',
    evidence: { paths: ['cli/src/format.ts'], blobs: {} },
  });
  assert.ok(empty.fact.evidence);
  assert.equal('blobs' in empty.fact.evidence, false, 'an empty blob map is not stored');
});

test('a ./ prefixed blob key is normalized like its path', async () => {
  const a = await activate('win-desktop');
  const created = await create(a.token, {
    project: 'loam',
    text: 'prefixed blob key',
    evidence: { paths: ['./cli/src/format.ts'], commit: 'abc1234', blobs: { './cli/src/format.ts': 'DEADBEE' } },
  });
  assert.deepEqual(created.fact.evidence?.paths, ['cli/src/format.ts']);
  assert.deepEqual(created.fact.evidence?.blobs, { 'cli/src/format.ts': 'deadbee' });
});

test('blob references outside the path list are rejected', async () => {
  const a = await activate('win-desktop');
  const cases: Array<{ body: Record<string, unknown>; message: string }> = [
    {
      body: { project: 'loam', text: 'stray blob', evidence: { paths: ['cli/src/format.ts'], blobs: { 'cli/src/bin.ts': 'deadbee' } } },
      message: 'blobs must reference paths',
    },
    {
      body: { project: 'loam', text: 'blob without paths', evidence: { blobs: { 'cli/src/format.ts': 'deadbee' } } },
      message: 'blobs must reference paths',
    },
    {
      body: { project: 'loam', text: 'blob map not an object', evidence: { paths: ['cli/src/format.ts'], blobs: 'deadbee' } },
      message: 'blobs must be an object',
    },
    {
      body: { project: 'loam', text: 'blob value not hex', evidence: { paths: ['cli/src/format.ts'], blobs: { 'cli/src/format.ts': 'zzz' } } },
      message: 'blob must be 7-40 hex characters',
    },
  ];
  for (const { body, message } of cases) {
    const response = await addFact(a.token, body);
    assert.equal(response.status, 400, `case ${body.text} must be rejected`);
    assert.deepEqual(await failure(response), { code: 'invalid_field', message });
  }
});

test('re-recording widens the blob anchors and keeps the freshest dirty flag', async () => {
  const a = await activate('win-desktop');
  const first = await create(a.token, {
    project: 'loam',
    kind: 'convention',
    text: 'blob merge claim',
    evidence: {
      paths: ['cli/src/format.ts'],
      commit: 'aaaaaaa',
      dirty: false,
      blobs: { 'cli/src/format.ts': '1111111' },
    },
  });
  const second = await create(a.token, {
    project: 'loam',
    kind: 'convention',
    text: 'blob merge claim',
    evidence: {
      paths: ['cli/src/bin.ts', 'cli/src/format.ts'],
      commit: 'bbbbbbb',
      dirty: true,
      blobs: { 'cli/src/bin.ts': '2222222', 'cli/src/format.ts': '3333333' },
    },
  });
  assert.equal(second.deduped, true);
  assert.equal(second.fact.id, first.fact.id);
  assert.deepEqual(second.fact.evidence?.paths, ['cli/src/format.ts', 'cli/src/bin.ts']);
  assert.deepEqual(second.fact.evidence?.blobs, {
    'cli/src/format.ts': '3333333',
    'cli/src/bin.ts': '2222222',
  });
  assert.equal(second.fact.evidence?.dirty, true, 'the newer capture wins');
  assert.deepEqual((await read(a.token, second.fact.id))?.blobs, second.fact.evidence?.blobs, 'the merge is persisted');
});

test('a blob whose path was trimmed by the cap is dropped from the merge', async () => {
  const a = await activate('win-desktop');
  const paths = Array.from({ length: 8 }, (_, index) => `src/f${index}.ts`);
  const first = await create(a.token, {
    project: 'loam',
    kind: 'convention',
    text: 'the path cap trims anchors',
    evidence: {
      paths,
      commit: 'aaaaaaa',
      blobs: Object.fromEntries(paths.map((path, index) => [path, `${index}000000`])),
    },
  });
  assert.equal(first.fact.evidence?.paths.length, 8);

  const second = await create(a.token, {
    project: 'loam',
    kind: 'convention',
    text: 'the path cap trims anchors',
    evidence: {
      paths: ['src/f0.ts', 'src/f8.ts'],
      blobs: { 'src/f8.ts': '8888888', 'src/f0.ts': '9999999' },
    },
  });
  assert.equal(second.deduped, true);
  const evidence = second.fact.evidence;
  assert.ok(evidence);
  assert.deepEqual(evidence.paths, paths, 'the ninth path is trimmed');
  assert.equal(evidence.paths.length, 8);
  assert.equal(evidence.paths.includes('src/f8.ts'), false);
  assert.equal('src/f8.ts' in (evidence.blobs ?? {}), false, 'a trimmed path leaves no orphan blob');
  assert.equal(evidence.blobs?.['src/f0.ts'], '9999999', 'the fresh blob overwrites');
  assert.deepEqual(Object.keys(evidence.blobs ?? {}), paths);
  assert.deepEqual((await read(a.token, second.fact.id))?.blobs, evidence.blobs, 'the filtered merge is persisted');
});

test('/v1/me reports the version clients gate evidence features on', async () => {
  const a = await activate('win-desktop');
  const body = (await (await call(a.token, '/v1/me')).json()) as { version: string };
  assert.match(body.version, /^\d+\.\d+\.\d+$/);
  assert.equal(body.version, pkg.version, 'worker VERSION must mirror worker/package.json');
});