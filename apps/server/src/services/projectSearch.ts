import path from 'node:path';
import { promises as fsp } from 'node:fs';
import type { SearchMatch, SearchOptions } from '@latex-studio/shared';
import { safeResolve, safeRealpathInside } from '../utils/paths.js';
import { workspaceService } from './workspaceService.js';

const MAX_FILE_SIZE = 2 * 1024 * 1024; // skip files > 2MB
const MAX_MATCHES = 1000;
const SOURCE_RE = /\.(tex|bib|cls|sty|tikz|txt|md)$/i;

/** Same exclusion rules as the indexer walk. */
function isExcluded(relPosix: string): boolean {
  const first = relPosix.split('/')[0];
  if (first && ['.build', '.latex-studio', 'node_modules', '.git'].includes(first)) return true;
  if (relPosix.split('/').some((seg) => seg.startsWith('.') && seg !== '.')) return true;
  return /\.(aux|log|fls|fdb_latexmk|synctex\.gz|bbl|bcf|run\.xml|out|toc|lof|lot|blg)$/i.test(relPosix);
}

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

/** Collect source file paths using the same exclusion rules as the watcher. */
async function collectFiles(root: string, includeGlob?: string, excludeGlob?: string): Promise<string[]> {
  const out: string[] = [];
  const includeRe = includeGlob
    ? new RegExp('^' + includeGlob.replace(/[.+^{}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '::').replace(/\*/g, '[^/]*').replace(/::/g, '.*').replace(/\?/g, '.') + '$')
    : null;
  const excludeRe = excludeGlob
    ? new RegExp('^' + excludeGlob.replace(/[.+^{}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '::').replace(/\*/g, '[^/]*').replace(/::/g, '.*') + '$')
    : null;

  const walk = async (absDir: string, relDir: string): Promise<void> => {
    let entries;
    try {
      entries = await fsp.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue; // jail
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (e.name === '.build' || e.name === '.latex-studio') continue;
        await walk(path.join(absDir, e.name), rel);
      } else if (e.isFile()) {
        if (isExcluded(rel)) continue;
        if (!SOURCE_RE.test(e.name)) continue;
        if (includeRe && !includeRe.test(rel)) continue;
        if (excludeRe && excludeRe.test(rel)) continue;
        out.push(rel);
      }
    }
  };
  await walk(root, '');
  return out.sort();
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
  if (matcher.error) throw Object.assign(new Error(matcher.error), { statusCode: 400 });

  const re = new RegExp(matcher.re.source, matcher.re.flags.includes('g') ? matcher.re.flags : matcher.re.flags + 'g');
  const files = await collectFiles(root, opts.includeGlob, opts.excludeGlob);

  const matches: SearchMatch[] = [];
  const byFile = new Set<string>();
  let truncated = false;

  for (const rel of files) {
    if (signal?.aborted) break;
    try {
      const abs = safeResolve(root, rel);
      await safeRealpathInside(root, abs);
      const stat = await fsp.stat(abs);
      if (stat.size > MAX_FILE_SIZE) continue;
      const content = await fsp.readFile(abs, 'utf8');
      const lines = content.split(/\r?\n/);

      for (let li = 0; li < lines.length; li++) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(lines[li])) !== null) {
          matches.push({
            file: rel,
            line: li + 1,
            column: m.index + 1,
            preview: lines[li].trim().slice(0, 160),
          });
          if (matches.length >= MAX_MATCHES) {
            truncated = true;
            break;
          }
          if (m.index === re.lastIndex) re.lastIndex++;
        }
        if (truncated) break;
      }
      byFile.add(rel);
      if (truncated) break;
    } catch {
      /* unreadable → skip */
    }
  }

  void signal;
  return {
    matches,
    fileCount: byFile.size,
    truncated,
    searchedFiles: files.length,
    durationMs: Date.now() - started,
  };
}

/**
 * Compute replacement plan without writing. Returns per-file new content.
 */
export async function planReplace(
  root: string,
  opts: SearchOptions & { replacement: string },
  signal?: AbortSignal
): Promise<{ files: { file: string; content: string; count: number }[]; total: number }> {
  const matcher = buildMatcher(opts);
  if (matcher.error) throw Object.assign(new Error(matcher.error), { statusCode: 400 });
  const re = new RegExp(matcher.re.source, matcher.re.flags);
  const files = await collectFiles(root, opts.includeGlob, opts.excludeGlob);
  const out: { file: string; content: string; count: number }[] = [];
  let total = 0;

  for (const rel of files) {
    if (signal?.aborted) break;
    try {
      const abs = safeResolve(root, rel);
      await safeRealpathInside(root, abs);
      const stat = await fsp.stat(abs);
      if (stat.size > MAX_FILE_SIZE) continue;
      const original = await fsp.readFile(abs, 'utf8');
      re.lastIndex = 0;
      const updated = original.replace(re, opts.replacement);
      if (updated !== original) {
        const count = (original.match(re) ?? []).length;
        out.push({ file: rel, content: updated, count });
        total += count;
      }
    } catch {
      /* unreadable → skip */
    }
  }
  return { files: out, total };
}
