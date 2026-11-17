import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'vitest';
import { activate, addFact, call, resetDb } from './helpers.ts';

beforeEach(resetDb);

describe('auth', () => {
  test('rejects requests without a token', async () => {
    const response = await call(null, '/v1/facts?project=loam');
    assert.equal(response.status, 401);
  });

  test('rejects an unknown token', async () => {
    const response = await call('loam_deadbeef_' + 'a'.repeat(43), '/v1/facts?project=loam');
    assert.equal(response.status, 401);
  });

  test('activation requires the admin token', async () => {
    const response = await call(null, '/v1/activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'win-desktop' }),
    });
    assert.equal(response.status, 401);
  });

  test('revoking device A leaves device B working', async () => {
    const a = await activate('win-desktop');
    const b = await activate('macbook');

    const revoke = await call(b.token, `/v1/devices/${a.id}/revoke`, { method: 'POST' });
    assert.equal(revoke.status, 200);

    const revoked = await call(a.token, '/v1/facts?project=loam');
    assert.equal(revoked.status, 401);
    const still = await call(b.token, '/v1/facts?project=loam');
    assert.equal(still.status, 200);
  });

  test('a read-only token cannot write', async () => {
    const reader = await activate('reader', 'read');
    const response = await addFact(reader.token, { project: 'loam', text: 'nope' });
    assert.equal(response.status, 403);
    assert.equal((await call(reader.token, '/v1/facts?project=loam')).status, 200);
  });

  test('the 61st request in a minute is rate limited', async () => {
    const a = await activate('noisy');
    let status = 0;
    for (let index = 0; index < 61; index += 1) {
      const response = await call(a.token, '/v1/facts?project=loam');
      status = response.status;
      if (status === 429) break;
    }
    assert.equal(status, 429);
  });
});