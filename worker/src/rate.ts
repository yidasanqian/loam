export interface RateLimiter {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

/**
 * Best-effort limiter for `wrangler dev` and tests, where the native
 * `ratelimits` binding is absent. Production uses the binding (see wrangler.toml).
 */
const memory = new Map<string, number[]>();

export function resetFallbackLimits(): void {
  memory.clear();
}

export async function allow(
  limiter: RateLimiter | undefined,
  key: string,
  limit: number,
  periodSeconds: number,
  now: number = Date.now(),
): Promise<boolean> {
  if (limiter) return (await limiter.limit({ key })).success;
  if (memory.size > 5000) memory.clear();
  const windowStart = now - periodSeconds * 1000;
  const hits = (memory.get(key) ?? []).filter((t) => t > windowStart);
  if (hits.length >= limit) {
    memory.set(key, hits);
    return false;
  }
  hits.push(now);
  memory.set(key, hits);
  return true;
}