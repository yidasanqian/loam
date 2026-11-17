import type { Db } from './db.ts';
import { ApiFailure } from './errors.ts';
import { LAST_SEEN_THROTTLE_MS, parseScopes, type Device, type DeviceRow } from './model.ts';

const encoder = new TextEncoder();
const TOKEN_RE = /^loam_[A-Za-z0-9_-]{8}_[A-Za-z0-9_-]{20,}$/;

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** `loam_<deviceId8>_<32B base64url>` (PLAN §5). */
export function randomToken(deviceId: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const base64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
  return `loam_${deviceId.slice(0, 8)}_${base64}`;
}

export function parseBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function authenticate(db: Db, token: string): Promise<Device> {
  if (!TOKEN_RE.test(token)) throw new ApiFailure(401, 'unauthorized', 'invalid token');
  const hash = await sha256Hex(token);
  const row = await db
    .prepare('SELECT id, name, token_hash, scopes, created_at, last_seen_at, revoked_at FROM devices WHERE token_hash = ?')
    .bind(hash)
    .first<DeviceRow>();
  if (!row) throw new ApiFailure(401, 'unauthorized', 'invalid token');
  if (row.revoked_at !== null) throw new ApiFailure(401, 'unauthorized', 'device revoked');
  return { id: row.id, name: row.name, scopes: parseScopes(row.scopes) };
}

/** Throttled last_seen_at write: at most one D1 row write per device per 5 minutes. */
export async function touchDevice(db: Db, device: Device, now: number): Promise<void> {
  await db
    .prepare('UPDATE devices SET last_seen_at = ? WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < ?)')
    .bind(now, device.id, now - LAST_SEEN_THROTTLE_MS)
    .run();
}