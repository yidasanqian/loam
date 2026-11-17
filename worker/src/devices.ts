import type { Db } from './db.ts';
import { sha256Hex, randomToken } from './auth.ts';
import { ApiFailure } from './errors.ts';
import { parseScopes, type Device, type DeviceRow } from './model.ts';

export interface DeviceSummary {
  id: string;
  name: string;
  scopes: string[];
  createdAt: number;
  lastSeenAt: number | null;
  revokedAt: number | null;
}

const DEVICE_SELECT = 'SELECT id, name, token_hash, scopes, created_at, last_seen_at, revoked_at FROM devices';

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/** Accepts a full UUID or a prefix of at least 6 chars (CLI prints id8). */
async function resolveDeviceId(db: Db, idOrPrefix: string): Promise<string | null> {
  if (idOrPrefix.length >= 32) return idOrPrefix;
  if (idOrPrefix.length < 6) {
    throw new ApiFailure(400, 'invalid_id', 'device id prefix must be at least 6 characters');
  }
  const row = await db
    .prepare("SELECT id FROM devices WHERE id LIKE ? ESCAPE '\\' LIMIT 1")
    .bind(`${escapeLike(idOrPrefix)}%`)
    .first<{ id: string }>();
  return row?.id ?? null;
}

function toSummary(row: DeviceRow): DeviceSummary {
  return {
    id: row.id,
    name: row.name,
    scopes: parseScopes(row.scopes),
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
  };
}

/**
 * Re-running `loam login` with the same device name rotates that device's
 * token instead of piling up duplicate rows.
 */
export async function activateDevice(
  db: Db,
  name: string,
  now: number,
  scopes: string,
): Promise<{ device: Device; token: string; created: boolean }> {
  const existing = await db
    .prepare('SELECT id, name, scopes, revoked_at FROM devices WHERE name = ? AND revoked_at IS NULL')
    .bind(name)
    .first<{ id: string; name: string; scopes: string }>();
  if (existing) {
    const token = await rotateToken(db, existing.id, now);
    if (!token) throw new ApiFailure(500, 'internal', 'failed to rotate existing device');
    return { device: { id: existing.id, name: existing.name, scopes: parseScopes(existing.scopes) }, token, created: false };
  }
  const id = crypto.randomUUID();
  const token = randomToken(id);
  await db
    .prepare(
      'INSERT INTO devices (id, name, token_hash, scopes, created_at, last_seen_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL, NULL)',
    )
    .bind(id, name, await sha256Hex(token), scopes, now)
    .run();
  return { device: { id, name, scopes: parseScopes(scopes) }, token, created: true };
}

export async function listDevices(db: Db): Promise<DeviceSummary[]> {
  const result = await db.prepare(`${DEVICE_SELECT} ORDER BY created_at ASC`).all<DeviceRow>();
  return result.results.map(toSummary);
}

export async function revokeDevice(db: Db, idOrPrefix: string, now: number): Promise<DeviceSummary | null> {
  const id = await resolveDeviceId(db, idOrPrefix);
  if (!id) return null;
  const result = await db.prepare('UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(now, id).run();
  if (result.meta.changes === 0) return null;
  const row = await db.prepare(`${DEVICE_SELECT} WHERE id = ?`).bind(id).first<DeviceRow>();
  return row ? toSummary(row) : null;
}

/** Returns the new plaintext token once; only its SHA-256 is stored. */
export async function rotateToken(db: Db, idOrPrefix: string, _now: number): Promise<string | null> {
  const id = await resolveDeviceId(db, idOrPrefix);
  if (!id) return null;
  const token = randomToken(id);
  const result = await db.prepare('UPDATE devices SET token_hash = ? WHERE id = ? AND revoked_at IS NULL').bind(await sha256Hex(token), id).run();
  return result.meta.changes > 0 ? token : null;
}