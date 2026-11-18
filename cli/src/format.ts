import fs from 'node:fs';
import type { Fact, FactEvidence } from './client.ts';
import { todayIso } from './util.ts';

export const MAX_LINE = 100;
export const MAX_SEARCH_LINES = 6;
export const DEFAULT_IMPORTANCE = 3;

export type FactLine = Pick<Fact, 'id' | 'kind' | 'text' | 'harness' | 'createdAt' | 'pinned' | 'importance'>;

export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** Truncates by code points and keeps the line single-line. */
export function oneLine(text: string, max: number): string {
  const chars = Array.from(text.replace(/\s+/gu, ' ').trim());
  if (chars.length <= max) return chars.join('');
  if (max <= 1) return '…';
  return `${chars.slice(0, max - 1).join('')}…`;
}

export function formatFactLine(fact: FactLine, maxLine = MAX_LINE): string {
  const pinned = fact.pinned ? '★ ' : '';
  const prefix = `- [${fact.kind}] ${pinned}`;
  const importance = fact.importance && fact.importance !== DEFAULT_IMPORTANCE ? ` · ${fact.importance}/5` : '';
  const suffix = ` (${fact.harness || 'unknown'} · ${todayIso(fact.createdAt)} · ${shortId(fact.id)}${importance})`;
  const budget = Math.max(12, maxLine - Array.from(prefix).length - Array.from(suffix).length);
  const line = `${prefix}${oneLine(fact.text, budget)}${suffix}`;
  return Array.from(line).length <= maxLine ? line : oneLine(line, maxLine).replace(/…$/u, '') + '…';
}

export interface FormatFactsOptions {
  hasMore?: boolean;
  emptyHint?: string;
  maxLines?: number;
}

/** Every line stays under 100 chars; callers cap the number of lines. */
export function formatFacts(facts: FactLine[], options: FormatFactsOptions = {}): string[] {
  const lines = facts.slice(0, options.maxLines ?? facts.length).map((fact) => formatFactLine(fact));
  if (facts.length === 0) lines.push(options.emptyHint ?? '无命中。');
  if (options.hasMore) lines.push(oneLine('… 更多结果（降低关键词精度，或用 loam list -n 20）', MAX_LINE));
  return lines;
}

export interface DetailOptions {
  /** Injected so tests stay filesystem-free; production resolves against the cwd. */
  exists?: (path: string) => boolean;
}

function defaultExists(path: string): boolean {
  try {
    return fs.existsSync(path);
  } catch {
    return false;
  }
}

/**
 * Evidence is a pointer set, so the only failure worth rendering is a dead one: a
 * path that no longer resolves would otherwise read as verified. The fact stays;
 * the pointers are dropped as a group and the reader is told to look again.
 */
function formatEvidence(evidence: FactEvidence, exists: (path: string) => boolean): string {
  const missing = evidence.paths.filter((path) => !exists(path));
  if (missing.length > 0) {
    return oneLine(`evidence: 已失效，找不到 ${missing.join(', ')}；事实保留，位置请重新定位`, MAX_LINE * 2);
  }
  const parts: string[] = [];
  if (evidence.paths.length) parts.push(evidence.paths.join(', '));
  if (evidence.symbols.length) parts.push(evidence.symbols.join(', '));
  if (evidence.check) parts.push(`check: ${evidence.check}`);
  if (evidence.commit) parts.push(`@${evidence.commit}`);
  if (parts.length === 0) return '';
  const at = evidence.at ? ` · ${new Date(evidence.at).toISOString().slice(0, 10)}` : '';
  return oneLine(`evidence: ${parts.join(' · ')}${at}`, MAX_LINE * 2);
}

export function formatDetail(fact: Fact, options: DetailOptions = {}): string {
  const marks = [];
  if (fact.pinned) marks.push('pinned');
  if (fact.importance !== undefined && fact.importance !== DEFAULT_IMPORTANCE) marks.push(`importance ${fact.importance}/5`);
  if (fact.supersededBy) marks.push(`superseded by ${shortId(fact.supersededBy)}`);
  const lines = [
    `${shortId(fact.id)}  [${fact.kind}]  ${fact.project}${marks.length ? `  (${marks.join(', ')})` : ''}`,
    fact.text,
    fact.tags.length ? `tags: ${fact.tags.join(', ')}` : '',
    `from ${fact.harness} on ${fact.deviceName || 'unknown device'} at ${new Date(fact.createdAt).toISOString()}`,
    fact.evidence ? formatEvidence(fact.evidence, options.exists ?? defaultExists) : '',
  ];
  return lines.filter(Boolean).join('\n');
}