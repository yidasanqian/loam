import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { authenticate, constantTimeEqual, parseBearer, sha256Hex, touchDevice } from './auth.ts';
import type { Db } from './db.ts';
import { activateDevice, listDevices, revokeDevice, rotateToken } from './devices.ts';
import { ApiFailure } from './errors.ts';
import { countProject, createFact, deleteFact, getFact, importFacts, pruneFacts, searchFacts } from './facts.ts';
import {
  EXPORT_LIMIT,
  RATE_API_PER_MIN,
  RATE_AUTH_PER_MIN,
  VERSION,
  parseScopes,
  type Device,
} from './model.ts';
import { allow, type RateLimiter } from './rate.ts';
import {
  asObject,
  parseDurationDays,
  parseSearchParams,
  validateDeviceName,
  validateFactInput,
  validateProject,
} from './validate.ts';

export interface Env {
  DB: Db;
  ADMIN_TOKEN?: string;
  RL_AUTH?: RateLimiter;
  RL_API?: RateLimiter;
}

type AppEnv = { Bindings: Env; Variables: { device: Device } };

const app = new Hono<AppEnv>();

function jsonError(c: Context<AppEnv>, err: ApiFailure) {
  return c.json({ error: { code: err.code, message: err.message } }, err.status as ContentfulStatusCode);
}

app.onError((err, c) => {
  if (err instanceof ApiFailure) return jsonError(c, err);
  console.error('loam: unhandled error', err);
  return c.json({ error: { code: 'internal', message: 'internal error' } }, 500);
});

async function readJson(c: Context<AppEnv>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ApiFailure(400, 'invalid_json', 'body must be valid JSON');
  }
}

function requireScope(device: Device, scope: 'read' | 'write'): void {
  if (!device.scopes.includes(scope)) throw new ApiFailure(403, 'forbidden', `token lacks the ${scope} scope`);
}

function publicDevice(device: Device) {
  return { id: device.id, name: device.name, scopes: device.scopes };
}

app.use('/v1/*', async (c, next) => {
  if (c.req.path === '/v1/activate') return next();
  const token = parseBearer(c.req.header('authorization'));
  if (!token) throw new ApiFailure(401, 'unauthorized', 'missing bearer token');
  const device = await authenticate(c.env.DB, token);
  if (!(await allow(c.env.RL_API, `dev:${device.id}`, RATE_API_PER_MIN, 60))) {
    throw new ApiFailure(429, 'rate_limited', 'too many requests (60/min per device)');
  }
  await touchDevice(c.env.DB, device, Date.now());
  c.set('device', device);
  return next();
});

app.get('/health', (c) => c.json({ ok: true, version: VERSION }));

app.post('/v1/activate', async (c) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'local';
  if (!(await allow(c.env.RL_AUTH, `ip:${ip}`, RATE_AUTH_PER_MIN, 60))) {
    throw new ApiFailure(429, 'rate_limited', 'too many activation attempts (10/min per IP)');
  }
  const admin = c.env.ADMIN_TOKEN;
  if (!admin) throw new ApiFailure(503, 'not_configured', 'ADMIN_TOKEN is not configured on the worker');
  const provided = c.req.header('x-admin-token') ?? parseBearer(c.req.header('authorization'));
  if (!provided) throw new ApiFailure(401, 'unauthorized', 'missing admin token');
  if (!constantTimeEqual(await sha256Hex(provided), await sha256Hex(admin))) {
    throw new ApiFailure(401, 'unauthorized', 'invalid admin token');
  }
  const body = asObject(await readJson(c));
  const name = validateDeviceName(body.name);
  const rawScopes = body.scopes === undefined ? 'read,write' : Array.isArray(body.scopes) ? body.scopes.join(',') : String(body.scopes);
  const scopes = parseScopes(rawScopes);
  if (scopes.length === 0) throw new ApiFailure(400, 'invalid_field', 'scopes must include read and/or write');
  const result = await activateDevice(c.env.DB, name, Date.now(), scopes.join(','));
  return c.json({ created: result.created, device: publicDevice(result.device), token: result.token }, result.created ? 201 : 200);
});

app.get('/v1/me', (c) =>
  c.json({ device: publicDevice(c.get('device')), version: VERSION, serverTime: Date.now() }),
);

app.get('/v1/devices', async (c) => {
  requireScope(c.get('device'), 'read');
  return c.json({ devices: await listDevices(c.env.DB) });
});

app.post('/v1/devices/:id/revoke', async (c) => {
  requireScope(c.get('device'), 'write');
  const device = await revokeDevice(c.env.DB, c.req.param('id'), Date.now());
  if (!device) throw new ApiFailure(404, 'not_found', 'device not found or already revoked');
  return c.json({ device });
});

app.post('/v1/devices/:id/rotate', async (c) => {
  requireScope(c.get('device'), 'write');
  const token = await rotateToken(c.env.DB, c.req.param('id'), Date.now());
  if (!token) throw new ApiFailure(404, 'not_found', 'device not found or revoked');
  return c.json({ token });
});

app.post('/v1/facts', async (c) => {
  const device = c.get('device');
  requireScope(device, 'write');
  const input = validateFactInput(await readJson(c));
  const result = await createFact(c.env.DB, device, input, Date.now());
  return c.json(result, result.deduped ? 200 : 201);
});

app.get('/v1/facts', async (c) => {
  requireScope(c.get('device'), 'read');
  const query = parseSearchParams(new URL(c.req.url).searchParams);
  const { facts, next } = await searchFacts(c.env.DB, query);
  return c.json({ facts, next, limit: query.limit });
});

app.get('/v1/facts/:id', async (c) => {
  requireScope(c.get('device'), 'read');
  const fact = await getFact(c.env.DB, c.req.param('id'));
  if (!fact) throw new ApiFailure(404, 'not_found', 'fact not found');
  return c.json({ fact });
});

app.delete('/v1/facts/:id', async (c) => {
  requireScope(c.get('device'), 'write');
  const deleted = await deleteFact(c.env.DB, c.req.param('id'), Date.now());
  if (!deleted) throw new ApiFailure(404, 'not_found', 'fact not found');
  return c.json({ deleted: 1 });
});

app.delete('/v1/facts', async (c) => {
  requireScope(c.get('device'), 'write');
  const params = new URL(c.req.url).searchParams;
  const all = params.get('all') === '1' || params.get('all') === 'true';
  const project = all ? null : validateProject(params.get('project'));
  const olderThanDays = parseDurationDays(params.get('older') ?? '180d');
  return c.json({ deleted: await pruneFacts(c.env.DB, { project, olderThanDays }) });
});

app.get('/v1/export', async (c) => {
  requireScope(c.get('device'), 'read');
  const query = parseSearchParams(new URL(c.req.url).searchParams, {
    defaultLimit: EXPORT_LIMIT,
    maxLimit: EXPORT_LIMIT,
  });
  const { facts, next } = await searchFacts(c.env.DB, query);
  return c.json({ facts, next });
});

app.post('/v1/import', async (c) => {
  const device = c.get('device');
  requireScope(device, 'write');
  const body = asObject(await readJson(c));
  if (!Array.isArray(body.facts)) throw new ApiFailure(400, 'invalid_body', 'facts must be an array');
  return c.json(await importFacts(c.env.DB, device, body.facts, Date.now()));
});

app.get('/v1/stats', async (c) => {
  requireScope(c.get('device'), 'read');
  const project = validateProject(new URL(c.req.url).searchParams.get('project'));
  return c.json({ project, facts: await countProject(c.env.DB, project) });
});

app.notFound((c) => c.json({ error: { code: 'not_found', message: 'no such endpoint' } }, 404));

export default app;
export { app };