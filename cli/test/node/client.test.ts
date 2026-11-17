import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { Client, activate } from '../../src/client.ts';
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
      if (req.headers.authorization !== 'Bearer test-token') {
        json(401, { error: { code: 'unauthorized', message: 'invalid token' } });
        return;
      }
      json(200, { device: { id: 'dev-1', name: 'win-desktop', scopes: ['read'] } });
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