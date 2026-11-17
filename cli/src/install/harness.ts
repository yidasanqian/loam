import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HARNESS_IDS = ['dsh', 'claude', 'codex'] as const;
export type HarnessId = (typeof HARNESS_IDS)[number];

export function isHarnessId(value: string): value is HarnessId {
  return (HARNESS_IDS as readonly string[]).includes(value);
}

export interface Harness {
  id: HarnessId;
  label: string;
  home: string;
  detected: boolean;
  /** Harness-level instruction file that receives the marker block. */
  homeFiles: string[];
  /** Where the packaged SKILL.md is copied, if the harness supports skills. */
  skillDir: string | null;
  /** Settings JSON that can host the `loam inject` hook. */
  hooksFile: string | null;
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

export function buildHarnesses(home: string = os.homedir(), env: NodeJS.ProcessEnv = process.env): Harness[] {
  const dshHome = env.DSH_HOME ? path.resolve(env.DSH_HOME) : path.join(home, '.dsh');
  const claudeHome = env.CLAUDE_CONFIG_DIR ? path.resolve(env.CLAUDE_CONFIG_DIR) : path.join(home, '.claude');
  const codexHome = env.CODEX_HOME ? path.resolve(env.CODEX_HOME) : path.join(home, '.codex');
  return [
    {
      id: 'dsh',
      label: 'DSH',
      home: dshHome,
      detected: isDirectory(dshHome),
      homeFiles: [path.join(dshHome, 'AGENTS.md')],
      skillDir: path.join(dshHome, 'skills', 'loam'),
      hooksFile: null,
    },
    {
      id: 'claude',
      label: 'Claude Code',
      home: claudeHome,
      detected: isDirectory(claudeHome),
      homeFiles: [path.join(claudeHome, 'CLAUDE.md')],
      skillDir: path.join(claudeHome, 'skills', 'loam'),
      hooksFile: path.join(claudeHome, 'settings.json'),
    },
    {
      id: 'codex',
      label: 'Codex',
      home: codexHome,
      detected: isDirectory(codexHome),
      homeFiles: [path.join(codexHome, 'AGENTS.md')],
      skillDir: null,
      hooksFile: null,
    },
  ];
}