import type { BibKeyEntry, LabelEntry } from '@latex-studio/shared';

const BIB_ENTRY_RE = /@(\w+)\s*[{(]\s*([^,\s{}()]+)\s*,/g;
const LABEL_RE = /\\label\{([^}]+)\}/g;

/** Extract citation keys from .bib content. */
export function parseBibKeys(content: string, file = ''): BibKeyEntry[] {
  const entries: BibKeyEntry[] = [];
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
    entries.push({
      key,
      file,
      line: cleaned.slice(0, m.index).split('\n').length,
      type,
    });
  }
  return entries;
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
    });
  }
  return entries;
}
