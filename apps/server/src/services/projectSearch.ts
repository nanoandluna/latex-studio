import { promises as fsp } from 'node:fs';
import type { SearchMatch, SearchOptions } from '@latex-studio/shared';
import { safeResolve, safeRealpathInside } from '../utils/paths.js';
import { collectSourceFiles } from '../utils/walkWorkspace.js';
import { ApiError } from '../errors.js';
import { projectIndexService } from './projectIndexService.js';

const MAX_FILE_SIZE = 2 * 1024 * 1024; // skip files > 2MB
const MAX_MATCHES = 1000;
/** Wall-clock ceiling for one search request; see the loop guard below. */
const TIME_BUDGET_MS = 5000;
/** Lines longer than this are skipped — catastrophic backtracking guard. */
const MAX_LINE_LENGTH = 20_000;

/** Raised when a replace plan exceeds the time budget, so callers can 504. */
export class PlanTimeoutError extends Error {
  constructor() {
    super('Replacement planning timed out — narrow the search or simplify the pattern');
    this.name = 'PlanTimeoutError';
  }
}
const SOURCE_RE = /\.(tex|bib|cls|sty|tikz|txt|md)$/i;

/** Compile the search pattern; throws on invalid regex. */
export function buildMatcher(opts: SearchOptions): { re: RegExp; error?: string } {
  let source = opts.query;
  if (!opts.regex) source = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (opts.wholeWord) source = `\\b${source}\\b`;
  const flags = opts.caseSensitive ? 'g' : 'gi';
  try {
    return { re: new RegExp(source, flags) };
  } catch (err) {
    return { re: /(?!)/, error: `Invalid regular expression: ${(err as Error).message}` };
  }
}

/** Translate a glob (`chapters/**`) into an anchored regex. */
function globToRegExp(glob: string): RegExp {
  return new RegExp(
    '^' +
      glob
        .replace(/[.+^{}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '::')
        .replace(/\*/g, '[^/]*')
        .replace(/::/g, '.*')
        .replace(/\?/g, '.') +
      '$'
  );
}

/**
 * Search scope = the shared source-file walk (artifact and metadata
 * exclusions already applied) narrowed by extension and the caller's globs.
 */
async function collectFiles(
  root: string,
  includeGlob?: string,
  excludeGlob?: string
): Promise<string[]> {
  const includeRe = includeGlob ? globToRegExp(includeGlob) : null;
  const excludeRe = excludeGlob ? globToRegExp(excludeGlob) : null;
  const all = await collectSourceFiles(root);
  return all.filter((rel) => {
    if (!SOURCE_RE.test(rel)) return false;
    if (includeRe && !includeRe.test(rel)) return false;
    if (excludeRe && excludeRe.test(rel)) return false;
    return true;
  });
}

export interface SearchResultPayload {
  matches: SearchMatch[];
  fileCount: number;
  truncated: boolean;
  searchedFiles: number;
  durationMs: number;
}

/** Search across workspace sources. Paths are jailed; content read is bounded. */
export async function searchWorkspace(
  root: string,
  opts: SearchOptions,
  signal?: AbortSignal
): Promise<SearchResultPayload> {
  const started = Date.now();
  const matcher = buildMatcher(opts);
  if (matcher.error) throw new ApiError('INVALID_ARGUMENT', matcher.error);

  const re = new RegExp(matcher.re.source, matcher.re.flags.includes('g') ? matcher.re.flags : matcher.re.flags + 'g');
  const files = await collectFiles(root, opts.includeGlob, opts.excludeGlob);

  const matches: SearchMatch[] = [];
  const byFile = new Set<string>();
  let truncated = false;

  // V0.5 Search → Context: nearest preceding heading per (file, line), from
  // the Project Graph snapshot. No extra scan; absent index → no annotation.
  const sectionsByFile = new Map<string, { line: number; title: string }[]>();
  try {
    const index = projectIndexService.getSnapshot();
    for (const s of index?.sections ?? []) {
      const list = sectionsByFile.get(s.file) ?? [];
      list.push({ line: s.line, title: s.title });
      sectionsByFile.set(s.file, list);
    }
  } catch {
    /* no workspace index yet */
  }
  const sectionFor = (file: string, line: number): string | undefined => {
    let best: string | undefined;
    for (const s of sectionsByFile.get(file) ?? []) {
      if (s.line > line) break;
      best = s.title;
    }
    return best;
  };

  for (const rel of files) {
    // A pathological pattern can make one match take arbitrarily long, and a
    // running regex cannot be interrupted. Checking the budget between files
    // keeps the request bounded instead of pinning the event loop.
    if (signal?.aborted || Date.now() - started > TIME_BUDGET_MS) {
      truncated = true;
      break;
    }
    try {
      const abs = safeResolve(root, rel);
      await safeRealpathInside(root, abs);
      const stat = await fsp.stat(abs);
      if (stat.size > MAX_FILE_SIZE) continue;
      const content = await fsp.readFile(abs, 'utf8');
      const lines = content.split(/\r?\n/);

      let hitsInFile = 0;
      for (let li = 0; li < lines.length; li++) {
        if (lines[li].length > MAX_LINE_LENGTH) continue; // backtracking guard
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(lines[li])) !== null) {
          matches.push({
            file: rel,
            line: li + 1,
            column: m.index + 1,
            preview: lines[li].trim().slice(0, 160),
            length: m[0].length,
            section: sectionFor(rel, li + 1),
          });
          hitsInFile++;
          if (matches.length >= MAX_MATCHES) {
            truncated = true;
            break;
          }
          if (m.index === re.lastIndex) re.lastIndex++;
        }
        if (truncated) break;
      }
      // fileCount means "files that matched", not "files we opened"
      if (hitsInFile > 0) byFile.add(rel);
      if (truncated) break;
    } catch {
      /* unreadable → skip */
    }
  }

  return {
    matches,
    fileCount: byFile.size,
    truncated,
    searchedFiles: files.length,
    durationMs: Date.now() - started,
  };
}

/**
 * Replace line by line, skipping lines too long to match safely.
 *
 * Only used when a file actually contains an over-long line. The whole-text
 * path is kept for normal files so a pattern that spans lines still works;
 * degenerating to per-line matching is the least-bad option for a file that
 * could otherwise pin the event loop on catastrophic backtracking.
 */
function replaceAvoidingLongLines(text: string, re: RegExp, replacement: string): string {
  const lines = text.split('\n');
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > MAX_LINE_LENGTH) continue;
    re.lastIndex = 0;
    const updated = lines[i].replace(re, replacement);
    if (updated !== lines[i]) {
      lines[i] = updated;
      changed = true;
    }
  }
  return changed ? lines.join('\n') : text;
}

/**
 * Compute replacement plan without writing. Returns per-file new content.
 *
 * Guarded the same way as search: a wall-clock budget between files, and
 * over-long lines skipped, because a pathological pattern cannot be
 * interrupted once it starts running.
 */
export async function planReplace(
  root: string,
  opts: SearchOptions & { replacement: string }
): Promise<{ files: { file: string; content: string; count: number }[]; total: number }> {
  const matcher = buildMatcher(opts);
  if (matcher.error) throw new ApiError('INVALID_ARGUMENT', matcher.error);
  const re = new RegExp(matcher.re.source, matcher.re.flags);
  const files = await collectFiles(root, opts.includeGlob, opts.excludeGlob);
  const out: { file: string; content: string; count: number }[] = [];
  let total = 0;
  const started = Date.now();

  for (const rel of files) {
    if (Date.now() - started > TIME_BUDGET_MS) throw new PlanTimeoutError();
    try {
      const abs = safeResolve(root, rel);
      await safeRealpathInside(root, abs);
      const stat = await fsp.stat(abs);
      if (stat.size > MAX_FILE_SIZE) continue;
      const original = await fsp.readFile(abs, 'utf8');

      const hasLongLine = original.split('\n').some((l) => l.length > MAX_LINE_LENGTH);
      const updated = hasLongLine
        ? replaceAvoidingLongLines(original, re, opts.replacement)
        : original.replace(re, opts.replacement);

      if (updated !== original) {
        const count = (original.match(re) ?? []).length;
        out.push({ file: rel, content: updated, count });
        total += count;
      }
    } catch (err) {
      if (err instanceof PlanTimeoutError) throw err;
      /* unreadable → skip */
    }
  }
  return { files: out, total };
}
