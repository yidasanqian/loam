import { CliError } from '../errors.ts';
import { readTextFile, writeFileAtomic } from '../util.ts';

export const HOOK_COMMAND = 'loam inject';

interface HookEntry {
  matcher?: string;
  hooks?: Array<{ type?: string; command?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

interface Settings {
  hooks?: { UserPromptSubmit?: HookEntry[]; [event: string]: HookEntry[] | undefined };
  [key: string]: unknown;
}

function readSettings(file: string): Settings {
  const raw = readTextFile(file);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Settings;
  } catch {
    throw new CliError('settings_invalid', `${file} 不是合法 JSON；请先手动修复再安装 hooks`, 2);
  }
}

function hasCommand(entry: HookEntry): boolean {
  return (entry.hooks ?? []).some((hook) => hook.command === HOOK_COMMAND);
}

/** Claude Code UserPromptSubmit hook; opt-in only (PLAN §4.5: default is prompt-time injection once). */
export function addHook(file: string): 'added' | 'unchanged' {
  const settings = readSettings(file);
  const hooks = settings.hooks ?? (settings.hooks = {});
  const list = hooks.UserPromptSubmit ?? (hooks.UserPromptSubmit = []);
  if (list.some(hasCommand)) return 'unchanged';
  list.push({ hooks: [{ type: 'command', command: HOOK_COMMAND }] });
  writeFileAtomic(file, `${JSON.stringify(settings, null, 2)}\n`);
  return 'added';
}

export function removeHook(file: string): 'removed' | 'absent' {
  if (readTextFile(file) === null) return 'absent';
  const settings = readSettings(file);
  const list = settings.hooks?.UserPromptSubmit;
  if (!list) return 'absent';
  const remaining = list.filter((entry) => !hasCommand(entry));
  if (remaining.length === list.length) return 'absent';
  if (remaining.length) settings.hooks!.UserPromptSubmit = remaining;
  else delete settings.hooks!.UserPromptSubmit;
  if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks;
  writeFileAtomic(file, `${JSON.stringify(settings, null, 2)}\n`);
  return 'removed';
}