import type { PackageEntry } from '@latex-studio/shared';
import { findClosingBrace, stripComments } from './structureParser.js';

export interface RawInclude {
  from: string;
  kind: 'input' | 'include';
  targetRaw: string;
  line: number;
}

export interface RawGraphic {
  file: string;
  line: number;
}

export interface RawBibDirective {
  kind: 'bibtex' | 'biber';
  targets: string[];
  line: number;
}

/**
 * Scan every line with a FRESH per-line regex instance.
 *
 * Module-level /g regexes share lastIndex across calls — a correctness hazard
 * under nesting/concurrency. Local literals keep each scan self-contained.
 *
 * onMatch may return the next lastIndex (e.g. to resume after a closing
 * brace); returning undefined uses the default advance.
 */
function scanLines(
  content: string,
  pattern: RegExp,
  onMatch: (line: string, m: RegExpExecArray, lineNumber: number) => number | void
): void {
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = stripComments(lines[i]);
    const re = new RegExp(pattern.source, pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const next = onMatch(line, m, i + 1);
      if (typeof next === 'number') {
        if (next <= m.index) break; // never go backwards
        re.lastIndex = next;
      } else if (re.lastIndex === m.index) {
        re.lastIndex++; // zero-width safety
      }
    }
  }
}

/** \input / \include directives (raw, unresolved). */
export function parseIncludes(content: string, file: string): RawInclude[] {
  const out: RawInclude[] = [];
  scanLines(content, /\\(input|include)\s*\{/g, (line, m, lineNo) => {
    const open = m.index + m[0].length - 1;
    const close = findClosingBrace(line, open);
    if (close === -1) return line.length;
    const target = line.slice(open + 1, close).trim();
    if (target) {
      out.push({ from: file, kind: m[1] as 'input' | 'include', targetRaw: target, line: lineNo });
    }
    return close + 1;
  });
  return out;
}

/** \includegraphics targets (raw, extension optional in LaTeX). */
export function parseGraphics(content: string, file: string): RawGraphic[] {
  const out: RawGraphic[] = [];
  scanLines(content, /\\includegraphics\s*(?:\[[^\]]*\])?\s*\{/g, (line, m, lineNo) => {
    const open = m.index + m[0].length - 1;
    const close = findClosingBrace(line, open);
    if (close === -1) return line.length;
    const target = line.slice(open + 1, close).trim();
    if (target) out.push({ file: target, line: lineNo });
    return close + 1;
  });
  return out;
}

/** \usepackage[opts]{a,b} — multi-package groups expand. */
export function parsePackages(content: string, file: string): PackageEntry[] {
  const out: PackageEntry[] = [];
  scanLines(content, /\\usepackage\s*(?:\[([^\]]*)\])?\s*\{/g, (line, m, lineNo) => {
    const open = m.index + m[0].length - 1;
    const close = findClosingBrace(line, open);
    if (close === -1) return line.length;
    for (const name of line.slice(open + 1, close).split(',').map((s) => s.trim()).filter(Boolean)) {
      out.push({ name, options: m[1], file, line: lineNo });
    }
    return close + 1;
  });
  return out;
}

/** Bibliography directives anywhere in the project sources. */
export function parseBibDirectives(content: string, file: string): RawBibDirective[] {
  const out: RawBibDirective[] = [];
  const handle = (
    line: string,
    m: RegExpExecArray,
    lineNo: number,
    kind: 'bibtex' | 'biber'
  ): number => {
    const open = m.index + m[0].length - 1;
    const close = findClosingBrace(line, open);
    if (close === -1) return line.length;
    const targets = line
      .slice(open + 1, close)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (targets.length) out.push({ kind, targets, line: lineNo });
    return close + 1;
  };
  scanLines(content, /\\(?:no)?bibliography\s*\{/g, (l, m, n) => handle(l, m, n, 'bibtex'));
  scanLines(content, /\\addbibresource\s*(?:\[[^\]]*\])?\s*\{/g, (l, m, n) => handle(l, m, n, 'biber'));
  return out;
}
