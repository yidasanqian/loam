import assert from 'node:assert/strict';
import { env, SELF } from 'cloudflare:test';
import schemaSql from '../../schema.sql?raw';

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database;
    ADMIN_TOKEN: string;
  }
}

export const ADMIN_TOKEN = 'test-admin-token';

export async function resetDb(): Promise<void> {
  await env.DB.exec('DROP TABLE IF EXISTS facts; DROP TABLE IF EXISTS devices;');
  // D1 exec is line-oriented; split the schema and run each statement via batch.
  const statements = schemaSql
    .replace(/--.*$/gm, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
  await env.DB.batch(statements.map((statement) => env.DB.prepare(statement)));
}

export interface Activated {
  id: string;
  name: string;
  token: string;
}

export async function activate(name: string, scopes = 'read,write'): Promise<Activated> {
  const response = await SELF.fetch('https://loam.test/v1/activate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': ADMIN_TOKEN },
    body: JSON.stringify({ name, scopes }),
  });
  assert.ok(response.status === 200 || response.status === 201, `activate failed: ${response.status}`);
  const body = (await response.json()) as { device: { id: string; name: string }; token: string };
  return { id: body.device.id, name: body.device.name, token: body.token };
}

export async function call(token: string | null, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return SELF.fetch(`https://loam.test${path}`, { ...init, headers });
}

export async function addFact(token: string, body: Record<string, unknown>): Promise<Response> {
  return call(token, '/v1/facts', { method: 'POST', body: JSON.stringify(body) });
}

export async function search(token: string, query: string): Promise<{ facts: Array<{ id: string; text: string; deduped?: boolean }>; next: string | null }> {
  const response = await call(token, `/v1/facts?${query}`);
  assert.equal(response.status, 200);
  return (await response.json()) as { facts: Array<{ id: string; text: string }>; next: string | null };
}

export async function stats(token: string, project: string): Promise<number> {
  const response = await call(token, `/v1/stats?project=${encodeURIComponent(project)}`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as { facts: number };
  return body.facts;
}