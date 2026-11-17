export const BLOCK_START = '<!-- loam:start -->';
export const BLOCK_END = '<!-- loam:end -->';

export function hasBlock(content: string): boolean {
  const start = content.indexOf(BLOCK_START);
  const end = content.indexOf(BLOCK_END);
  return start !== -1 && end > start;
}

/** Idempotent: re-running install rewrites only the marked block. */
export function upsertBlock(content: string, body: string): string {
  const wrapped = `${BLOCK_START}\n${body.trim()}\n${BLOCK_END}`;
  const start = content.indexOf(BLOCK_START);
  const end = content.indexOf(BLOCK_END);
  if (start !== -1 && end > start) {
    const tail = content.slice(end + BLOCK_END.length);
    return `${content.slice(0, start)}${wrapped}${tail}`;
  }
  const trimmed = content.replace(/\s+$/u, '');
  return trimmed ? `${trimmed}\n\n${wrapped}\n` : `${wrapped}\n`;
}

/** Removes the marked block and leaves the surrounding file intact. */
export function removeBlock(content: string): string {
  const start = content.indexOf(BLOCK_START);
  const end = content.indexOf(BLOCK_END);
  if (start === -1 || end < start) return content;
  const before = content.slice(0, start).replace(/\s+$/u, '');
  const after = content.slice(end + BLOCK_END.length).replace(/^\s+/u, '').replace(/\s+$/u, '');
  if (!before) return after ? `${after}\n` : '';
  if (!after) return `${before}\n`;
  return `${before}\n\n${after}\n`;
}