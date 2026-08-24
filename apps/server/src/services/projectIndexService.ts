import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ProjectIndex } from '@latex-studio/shared';
import {
  assembleProjectIndex,
  parseBibEntries as parseBibDocumentEntries,
  parseTexDocument,
  type FileParseResult,
} from '@latex-studio/latex-parser';
import { safeResolve } from '../utils/paths.js';
import { workspaceService } from './workspaceService.js';

interface CacheEntry {
  /** mtimeMs + size fingerprint of the file on disk at parse time */
  mtimeMs: number;
  size: number;
  parsed: FileParseResult;
}

export interface IndexRefreshResult {
  index: ProjectIndex;
  filesParsed: number;
  cacheHits: number;
  durationMs: number;
}

/**
 * Holds the ProjectIndex for the open workspace.
 *
 * Incrementality:
 *  - per-file parse results are cached keyed by (mtimeMs, size)
 *  - refresh() re-reads the directory, re-parses ONLY changed/new files and
 *    keeps cached parse results for unchanged ones
 *  - updateBuffer() lets an editor push unsaved buffer content so the index
 *    reflects what the user sees without waiting for a save; disk state always
 *    wins on the next refresh()
 */
export class ProjectIndexService {
  private cache = new Map<string, CacheEntry>();
  private bibCache = new Map<string, { mtimeMs: number; size: number; entries: ReturnType<typeof parseBibDocumentEntries> }>();
  private buffers = new Map<string, string>();
  private current: ProjectIndex | null = null;
  private inFlight: Promise<IndexRefreshResult> | null = null;
  /** Workspace root the current snapshot was built against. */
  private builtForRoot: string | null = null;

  /** Latest available index — always non-blocking, may be one refresh behind. */
  getSnapshot(): ProjectIndex | null {
    return this.current;
  }

  /**
   * True when the snapshot on hand belongs to a DIFFERENT workspace than the
   * currently open one (caller must refresh before serving).
   */
  needsRebuild(): boolean {
    let root: string | null = null;
    try {
      root = workspaceService.requireWorkspace();
    } catch {
      return true;
    }
    return !this.current || this.builtForRoot !== root;
  }

  reset(): void {
    this.cache.clear();
    this.bibCache.clear();
    this.buffers.clear();
    this.current = null;
    this.inFlight = null;
    this.builtForRoot = null;
  }

  /** Editor pushed unsaved content for a file (debounced upstream). */
  updateBuffer(relPath: string, content: string): void {
    this.buffers.set(relPath.replace(/\\/g, '/'), content);
  }

  dropBuffer(relPath: string): void {
    this.buffers.delete(relPath.replace(/\\/g, '/'));
  }

  /**
   * Refresh the index. Concurrent callers share one in-flight refresh; when
   * a refresh is already running the PREVIOUS index is returned immediately
   * (stale-but-valid) so consumers never block on a full rescan.
   */
  async refresh(): Promise<IndexRefreshResult> {
    if (this.inFlight) {
      const snapshot = this.current;
      if (snapshot) {
        return { index: snapshot, filesParsed: -1, cacheHits: -1, durationMs: 0 };
      }
      return this.inFlight;
    }
    this.inFlight = this.doRefresh();
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  private async doRefresh(): Promise<IndexRefreshResult> {
    const started = Date.now();
    const root = workspaceService.requireWorkspace();

    // Workspace switched since the last build? Drop everything — cached
    // per-file results are keyed by RELATIVE paths and would poison the new
    // project's index.
    if (this.builtForRoot !== root) {
      this.cache.clear();
      this.bibCache.clear();
      this.buffers.clear();
      this.current = null;
      this.builtForRoot = root;
    }

    // Collect tex/bib files (bounded depth walk, ignores hidden/build dirs).
    const texFiles: string[] = [];
    const bibFiles: string[] = [];
    await this.walk(root, '', texFiles, bibFiles);

    let cacheHits = 0;
    const parsed: FileParseResult[] = [];
    for (const rel of texFiles) {
      const buf = this.buffers.get(rel);
      if (buf !== undefined) {
        // Buffer content wins until the file is saved again through the API
        // (which drops the buffer entry).
        parsed.push(this.parseWithCache(rel, buf, Date.now(), buf.length));
        continue;
      }
      try {
        const abs = safeResolve(root, rel);
        const stat = await fs.stat(abs);
        const cached = this.cache.get(rel);
        if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
          cacheHits++;
          parsed.push(cached.parsed);
          continue;
        }
        const content = await fs.readFile(abs, 'utf8');
        parsed.push(this.parseWithCache(rel, content, stat.mtimeMs, stat.size));
      } catch {
        /* unreadable/deleted mid-scan → skip file */
      }
    }

    const bibParsed: { file: string; entries: ReturnType<typeof parseBibDocumentEntries> }[] = [];
    for (const rel of bibFiles) {
      try {
        const abs = safeResolve(root, rel);
        const stat = await fs.stat(abs);
        const cached = this.bibCache.get(rel);
        if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
          bibParsed.push({ file: rel, entries: cached.entries });
          continue;
        }
        const content = await fs.readFile(abs, 'utf8');
        const entries = parseBibDocumentEntries(content, rel);
        this.bibCache.set(rel, { mtimeMs: stat.mtimeMs, size: stat.size, entries });
        bibParsed.push({ file: rel, entries });
      } catch (err) {
        if (process.env.LS_DEBUG) console.error('[idx] bib loop error:', err);
      }
    }

    const mainFile = await workspaceService.detectMainFile();
    const index = assembleProjectIndex(parsed, bibParsed, mainFile);

    // Graphics candidates: match \includegraphics targets against real files.
    const allFiles = [...texFiles, ...bibFiles];
    const graphicsPaths: ProjectIndex['graphicsPaths'] = [];
    for (const f of parsed) {
      for (const g of f.graphics) {
        const target = g.file.replace(/\\/g, '/');
        const base = target.replace(/\.[^.]+$/, '');
        const matches = allFiles.filter(
          (cand) => cand === target || cand.startsWith(`${base}.`)
        );
        if (matches.length === 0) continue; // not present in the workspace
        for (const m of matches.slice(0, 3)) {
          graphicsPaths.push({ path: m.replace(/\.[^.]+$/, ''), detail: `in ${f.path}:${g.line}` });
        }
      }
    }
    // Deduplicate by path
    index.graphicsPaths = graphicsPaths.filter(
      (g, i, arr) => arr.findIndex((x) => x.path === g.path) === i
    );

    this.current = index;

    // Drop cache entries for deleted files.
    const liveSet = new Set(texFiles);
    for (const key of [...this.cache.keys()]) if (!liveSet.has(key)) this.cache.delete(key);

    return { index, filesParsed: parsed.length, cacheHits, durationMs: Date.now() - started };
  }

  /** Parse + store in cache; buffer-parsed entries use a synthetic stamp. */
  private parseWithCache(rel: string, content: string, mtimeMs: number, size: number): FileParseResult {
    const parsed = parseTexDocument({ path: rel, content });
    this.cache.set(rel, { mtimeMs, size, parsed });
    return parsed;
  }

  private async walk(
    absDir: string,
    relDir: string,
    texOut: string[],
    bibOut: string[]
  ): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '.build' || e.name === '.latex-studio') {
        continue;
      }
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await this.walk(path.join(absDir, e.name), rel, texOut, bibOut);
      } else if (e.isFile()) {
        if (/\.tex$/i.test(e.name)) texOut.push(rel);
        else if (/\.bib$/i.test(e.name)) bibOut.push(rel);
      }
    }
  }
}

export const projectIndexService = new ProjectIndexService();
