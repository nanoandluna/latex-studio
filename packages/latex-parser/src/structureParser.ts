import type {
  SectionEntry,
} from '@latex-studio/shared';

export interface RawOccurrence {
  key: string;
  file: string;
  line: number;
  column: number;
  /** extra payload (command name etc.) */
  kind?: string;
}

const SECTION_COMMANDS: { command: string; level: number }[] = [
  { command: 'part', level: 0 },
  { command: 'chapter', level: 1 },
  { command: 'section', level: 2 },
  { command: 'subsection', level: 3 },
  { command: 'subsubsection', level: 4 },
  { command: 'paragraph', level: 5 },
  { command: 'subparagraph', level: 6 },
];

/** Strip line comments (% …) while respecting escaped \% . */
export function stripComments(line: string): string {
  let out = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length) {
      out += ch + line[i + 1];
      i++;
      continue;
    }
    if (ch === '%') break;
    out += ch;
  }
  return out;
}

/** Parse sectioning commands from one .tex document. */
export function parseStructure(content: string, file: string): SectionEntry[] {
  const out: SectionEntry[] = [];
  const lines = content.split(/\r?\n/);
  const names = SECTION_COMMANDS.map((s) => s.command).join('|');
  const re = new RegExp(`\\\\(${names})\\*?\\s*(?:\\[[^\\]]*\\])?\\{`);
  for (let i = 0; i < lines.length; i++) {
    const line = stripComments(lines[i]);
    const m = line.match(re);
    if (!m) continue;
    const start = m.index! + m[0].length;
    const close = findClosingBrace(line, start - 1);
    if (close === -1) continue;
    const title = line.slice(start, close).trim();
    if (!title) continue;
    const level = SECTION_COMMANDS.find((s) => s.command === m![1])!.level;
    out.push({ title, level, file, line: i + 1, column: m.index! + 1 });
  }
  return out;
}

/** Find the index of the `}` closing the `{` at `braceIndex`. -1 if unbalanced. */
export function findClosingBrace(line: string, braceIndex: number): number {
  let depth = 0;
  for (let i = braceIndex; i < line.length; i++) {
    if (line[i] === '{') depth++;
    else if (line[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Keys inside a braced group, split on commas ("a,b" from \cite{a,b}). */
function keysInGroup(line: string, openBrace: number): string[] {
  const close = findClosingBrace(line, openBrace);
  if (close === -1) return [];
  return line
    .slice(openBrace + 1, close)
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

/** \label{key} occurrences. */
export function parseLabelOccurrences(content: string, file: string): RawOccurrence[] {
  return matchCommandKeys(content, file, ['label']);
}

/** \ref / \pageref / \eqref / \autoref occurrences. */
export function parseReferenceOccurrences(content: string, file: string): RawOccurrence[] {
  return matchCommandKeys(content, file, ['ref', 'pageref', 'eqref', 'autoref']);
}

/** \cite-family occurrences; multi-key groups expand to one entry per key. */
export function parseCitationOccurrences(content: string, file: string): RawOccurrence[] {
  const out: RawOccurrence[] = [];
  const lines = content.split(/\r?\n/);
  const re = /\\(cite|citep|citet|citealp|autocite|textcite|parencite|footcite|Citep|Citet)\*?\s*(?:\[[^\]]*\]\s*){0,2}\{/g;
  for (let i = 0; i < lines.length; i++) {
    const line = stripComments(lines[i]);
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      for (const key of keysInGroup(line, m.index + m[0].length - 1)) {
        out.push({
          key,
          file,
          line: i + 1,
          column: m.index + 1,
          kind: m[1],
        });
      }
    }
  }
  return out;
}

/** Generic matcher for single-key commands (\label/\ref family). */
function matchCommandKeys(content: string, file: string, commands: string[]): RawOccurrence[] {
  const out: RawOccurrence[] = [];
  const lines = content.split(/\r?\n/);
  const re = new RegExp(`\\\\(${commands.join('|')})\\s*\\{`, 'g');
  for (let i = 0; i < lines.length; i++) {
    const line = stripComments(lines[i]);
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const keys = keysInGroup(line, m.index + m[0].length - 1);
      for (const key of keys) {
        out.push({ key, file, line: i + 1, column: m.index + 1, kind: m[1] });
      }
    }
  }
  return out;
}
