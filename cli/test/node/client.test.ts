import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { Client, activate, requireEvidenceSupport, workerSupportsEvidence } from '../../src/client.ts';
import { CliError, OfflineError } from '../../src/errors.ts';

let server: http.Server;
let base = '';

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/v1/me') {
      const token = req.headers.authorization;
      if (token !== 'Bearer test-token' && token !== 'Bearer new-token') {
        json(401, { error: { code: 'unauthorized', message: 'invalid token' } });
        return;
      }
      // 0.3.0 reports its version; older workers answer without one.
      const version = token === 'Bearer new-token' ? '0.3.0' : undefined;
      json(200, { device: { id: 'dev-1', name: 'win-desktop', scopes: ['read'] }, ...(version ? { version } : {}) });
      return;
    }
    if (url.pathname === '/v1/activate') {
      if (req.headers['x-admin-token'] !== 'admin-secret') {
        json(401, { error: { code: 'unauthorized', message: 'invalid admin token' } });
        return;
      }
      json(201, { created: true, device: { id: 'dev-1', name: 'win-desktop', scopes: ['read', 'write'] }, token: 'loam_devtoken' });
      return;
    }
    if (url.pathname === '/v1/boom') {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('boom');
      return;
    }
    if (url.pathname === '/v1/text') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('not json');
      return;
    }
    json(404, { error: { code: 'not_found', message: 'no such endpoint' } });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

function client(token = 'test-token'): Client {
  return new Client({ server: base, deviceId: 'dev-1', deviceName: 'win-desktop', token });
}

test('request sends the bearer token and parses JSON', async () => {
  const payload = await client().request<{ device: { name: string } }>('GET', '/v1/me');
  assert.equal(payload.device.name, 'win-desktop');
});

test('401 surfaces the server code with exit code 3', async () => {
  await assert.rejects(
    () => client('wrong-token').request('GET', '/v1/me'),
    (error: unknown) => error instanceof CliError && error.exitCode === 3 && error.code === 'unauthorized',
  );
});

test('5xx is treated as offline so callers can queue writes', async () => {
  await assert.rejects(() => client().request('GET', '/v1/boom'), OfflineError);
});

test('non-JSON bodies are reported instead of crashing', async () => {
  await assert.rejects(
    () => client().request('GET', '/v1/text'),
    (error: unknown) => error instanceof CliError && error.code === 'bad_response',
  );
});

test('activate posts the admin token and returns the device token', async () => {
  const result = await activate(base, 'admin-secret', 'win-desktop', 'read,write');
  assert.equal(result.created, true);
  assert.equal(result.token, 'loam_devtoken');
  assert.deepEqual(result.device.scopes, ['read', 'write']);
});

test('a refused connection becomes OfflineError', async () => {
  const unreachable = new Client({ server: 'http://127.0.0.1:1', deviceId: 'x', deviceName: 'x', token: 'x' });
  await assert.rejects(() => unreachable.request('GET', '/v1/me'), OfflineError);
});

test('evidence support is decided by the version /v1/me reports', async () => {
  assert.equal(workerSupportsEvidence('0.1.3'), false);
  assert.equal(workerSupportsEvidence('0.3.0'), true);
  assert.equal(workerSupportsEvidence('0.10.0'), true);
  assert.equal(workerSupportsEvidence(undefined), false, 'an old worker answers without a version');
  assert.equal(workerSupportsEvidence(''), false);
  assert.equal(workerSupportsEvidence('not-a-version'), false);

  await requireEvidenceSupport(client('new-token'));

  await assert.rejects(
    () => requireEvidenceSupport(client()),
    (error: unknown) => error instanceof CliError && error.code === 'worker_too_old' && error.exitCode === 1,
  );
});

test('the gate fails closed when the worker cannot be asked', async () => {
  const unreachable = new Client({ server: 'http://127.0.0.1:1', deviceId: 'x', deviceName: 'x', token: 'x' });
  await assert.rejects(() => requireEvidenceSupport(unreachable), OfflineError);
});