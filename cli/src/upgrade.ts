/**
 * Upgrade advice. The CLI never replaces itself: a global npm install from a
 * running process is fragile on Windows. It only reports current / npm latest /
 * installed skill version and the exact commands to run.
 */

export const PACKAGE_NAME = '@yidasanqian/loam';
export const REGISTRY_LATEST = 'https://registry.npmjs.org/@yidasanqian/loam/latest';

export type UpgradeState = 'current' | 'outdated' | 'ahead' | 'unknown';

export interface UpgradePlan {
  current: string;
  latest: string | null;
  /** Version recorded in ~/.loam/install.json (the skill + AGENTS wiring). */
  wiring: string | null;
  state: UpgradeState;
  commands: string[];
}

/** Numeric semver compare for the subset we publish (x.y.z, prerelease ignored). */
export function compareVersions(a: string, b: string): number {
  const parts = (value: string) =>
    value
      .split('-')[0]
      .split('.')
      .slice(0, 3)
      .map((part) => {
        const n = Number.parseInt(part, 10);
        return Number.isFinite(n) ? n : 0;
      });
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < 3; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export async function fetchLatestVersion(url = REGISTRY_LATEST, timeoutMs = 8000): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { version?: unknown };
    return typeof body.version === 'string' ? body.version : null;
  } catch {
    return null;
  }
}

export function planUpgrade(input: { current: string; latest: string | null; wiring: string | null }): UpgradePlan {
  let state: UpgradeState = 'unknown';
  if (input.latest) {
    const cmp = compareVersions(input.current, input.latest);
    state = cmp === 0 ? 'current' : cmp < 0 ? 'outdated' : 'ahead';
  }
  const commands: string[] = [];
  if (state === 'outdated' || state === 'unknown') commands.push(`npm i -g ${PACKAGE_NAME}@latest`);
  // The installed skill/AGENTS block is a copy: it only refreshes when install runs.
  // After an npm upgrade the wiring is always one version behind the target.
  if (state === 'outdated' || input.wiring !== input.current) commands.push('loam install');
  return { current: input.current, latest: input.latest, wiring: input.wiring, state, commands };
}