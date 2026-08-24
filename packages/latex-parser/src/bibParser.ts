import type { BibEntry, BibKeyEntry, LabelEntry } from '@latex-studio/shared';

const BIB_ENTRY_RE = /@(\w+)\s*[{(]\s*([^,\s{}()]+)\s*,/g;
const LABEL_RE = /\\label\{([^}]+)\}/g;

/** Extract citation keys from .bib content. */
export function parseBibKeys(content: string, file = ''): BibKeyEntry[] {
  return parseBibEntries(content, file).map(({ key, file: f, line, type }) => ({
    key,
    file: f,
    line,
    type,
  }));
}

/** Extract full bib entries (key + hover fields) from .bib content. */
export function parseBibEntries(content: string, file = ''): BibEntry[] {
  const entries: BibEntry[] = [];
  const seen = new Set<string>();
  // Strip comment lines starting with %
  const cleaned = content
    .split('\n')
    .map((l) => (l.trimStart().startsWith('%') ? '' : l))
    .join('\n');

  let m: RegExpExecArray | null;
  BIB_ENTRY_RE.lastIndex = 0;
  while ((m = BIB_ENTRY_RE.exec(cleaned)) !== null) {
    const type = m[1].toLowerCase();
    if (type === 'comment' || type === 'string' || type === 'preamble') continue;
    const key = m[2];
    if (seen.has(key)) continue;
    seen.add(key);
    const bodyStart = m.index + m[0].length;
    const bodyEnd = findEntryEnd(cleaned, bodyStart);
    const body = cleaned.slice(bodyStart, bodyEnd);
    entries.push({
      key,
      file,
      line: cleaned.slice(0, m.index).split('\n').length,
      type,
      author: extractField(body, 'author'),
      title: extractField(body, 'title'),
      year: extractField(body, 'year'),
    });
  }
  return entries;
}

/** Body of an entry runs until the brace closing the entry. The regex that
 *  matched `@type{key,` already consumed the entry's opening brace, so the
 *  scan starts at depth 1. */
function findEntryEnd(text: string, start: number): number {
  let depth = 1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth <= 0) return i;
    }
  }
  return Math.min(start + 2000, text.length);
}

function extractField(body: string, field: string): string | undefined {
  const m = body.match(new RegExp(`${field}\\s*=\\s*`, 'i'));
  if (!m) return undefined;
  let i = m.index! + m[0].length;
  const open = body[i];
  let raw = '';
  if (open === '{') {
    let depth = 1;
    i++;
    for (; i < body.length && depth > 0; i++) {
      if (body[i] === '{') depth++;
      else if (body[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
      raw += body[i];
    }
  } else if (open === '"') {
    i++;
    for (; i < body.length && body[i] !== '"'; i++) raw += body[i];
  } else {
    for (; i < body.length && !/[\s,]/.test(body[i]); i++) raw += body[i];
  }
  // strip nested braces and collapse whitespace
  const value = raw
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!value) return undefined;
  return `${value.slice(0, 160)}${value.length > 160 ? '…' : ''}`;
}

/** Extract \label{...} keys from .tex content. */
export function parseLabels(content: string, file = ''): LabelEntry[] {
  const entries: LabelEntry[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  LABEL_RE.lastIndex = 0;
  while ((m = LABEL_RE.exec(content)) !== null) {
    const key = m[1].trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    entries.push({
      key,
      file,
      line: content.slice(0, m.index).split('\n').length,
      column: m.index + 1,
    });
  }
  return entries;
}
