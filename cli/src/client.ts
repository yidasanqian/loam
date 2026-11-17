import type { Config } from './config.ts';
import { CliError, OfflineError } from './errors.ts';
import { VERSION } from './version.ts';

export interface Fact {
  id: string;
  project: string;
  kind: string;
  text: string;
  tags: string[];
  harness: string;
  deviceId: string;
  deviceName: string;
  createdAt: number;
}

export interface FactInput {
  project: string;
  kind: string;
  text: string;
  tags: string[];
  harness: string;
}

export interface CreateResponse {
  fact: Fact;
  deduped: boolean;
  projectCount: number;
  warning: string | null;
}

export interface SearchResponse {
  facts: Fact[];
  next: string | null;
  limit?: number;
}

export interface DeviceInfo {
  id: string;
  name: string;
  scopes: string[];
}

export interface DeviceSummary extends DeviceInfo {
  createdAt: number;
  lastSeenAt: number | null;
  revokedAt: number | null;
}

interface ErrorBody {
  error?: { code?: string; message?: string };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: unknown = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new CliError('bad_response', `服务端返回了非 JSON 响应（HTTP ${response.status}）`);
    }
  }
  if (!response.ok) {
    const body = payload as ErrorBody;
    throw new CliError(
      body.error?.code ?? `http_${response.status}`,
      body.error?.message ?? `HTTP ${response.status}`,
      response.status === 401 ? 3 : 1,
    );
  }
  return payload as T;
}

/** Cold proxy handshakes on CN networks regularly exceed 8s. */
const REQUEST_TIMEOUT_MS = 20_000;

async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    throw new OfflineError(error instanceof Error ? error.message : 'network error');
  }
}

export class Client {
  readonly config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.config.token}`,
      'user-agent': `loam-cli/${VERSION}`,
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await send(`${this.config.server}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status >= 500) throw new OfflineError(`server error ${response.status}`);
    return parseResponse<T>(response);
  }
}

export async function activate(
  server: string,
  adminToken: string,
  name: string,
  scopes: string,
): Promise<{ device: DeviceInfo; token: string; created: boolean }> {
  const response = await send(`${server.replace(/\/+$/, '')}/v1/activate`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-admin-token': adminToken,
      'user-agent': `loam-cli/${VERSION}`,
    },
    body: JSON.stringify({ name, scopes }),
  });
  return parseResponse(response);
}