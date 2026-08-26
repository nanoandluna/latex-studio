import fsSync from 'node:fs';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { ProjectIndex } from '@latex-studio/shared';
import {
  assembleProjectIndex,
  parseBibEntries as parseBibDocumentEntries,
  parseTexDocument,
  deriveGraphDiagnostics,
  deriveEdges,
  type FileParseResult,
} from '@latex-studio/latex-parser';
import { safeResolve } from '../utils/paths.js';
import { workspaceService } from './workspaceService.js';
import { FileWatcher } from './fileWatcher.js';
import { GRAPH_SCHEMA_VERSION } from '@latex-studio/latex-parser';

const PARSER_VERSION = '0.3.1';

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
  /** internal: another pass is required (a buffer landed mid-pass) */
  rerun?: boolean;
}

const MAX_RERUNS = 2;

/**
 * Holds the ProjectGraph for the open workspace.
 *
 * Incrementality:
 *  - per-file parse results cached by (mtimeMs, size); unchanged files are
 *    cache hits and are never re-parsed
 *  - updateBuffer() lets the editor push unsaved content so the graph reflects
 *    what the user sees; a buffer landing mid-refresh forces exactly ONE more
 *    pass (bounded) so the committed graph always includes it
 *  - switching workspaces clears all caches (relative keys would poison)
 *
 * Concurrency: refresh() coalesces concurrent callers onto one in-flight pass;
 * late joiners receive the previous snapshot (stale-but-valid). `version`
 * increases on every COMMITTED mutation so clients can drop stale responses.
 */
export class ProjectIndexService {
  private cache = new Map<string, CacheEntry>();
  private bibCache = new Map<
    string,
    { mtimeMs: number; size: number; entries: ReturnType<typeof parseBibDocumentEntries> }
  >();
  private buffers = new Map<string, string>();
  private current: ProjectIndex | null = null;
  private inFlight: Promise<IndexRefreshResult> | null = null;
  private builtForRoot: string | null = null;
  private pendingBufferAt = 0;
  private rev = 0;
  private watcher = new FileWatcher();
  /** Persistent per-file parse cache: rel → { hash, parsed } (schema-gated). */
  private diskFiles = new Map<string, { hash: string; parsed: FileParseResult }>();
  private diskBib = new Map<string, { hash: string; entries: ReturnType<typeof parseBibDocumentEntries> }>();
  private diskLoadedRoot: string | null = null;
  private diskDirty = false;
  /** Observability ring buffers / last-pass stats. */
  private recentBatches: { at: number; paths: string[] }[] = [];
  lastStats: {
    startedAt: number; durationMs: number; walkMs: number; parseMs: number;
    assembleMs: number; diagMs: number; filesParsed: number; cacheHits: number;
    memCacheHits: number; rerun: boolean;
  } | null = null;

  get version(): number {
    return this.rev;
  }

  get watcherActive(): boolean {
    return this.watcher.active;
  }

  enableAutoRefresh(root: string): void {
    if (process.env.LS_DISABLE_WATCHER === '1') return;
    if (this.watcher.watchedRoot === root && this.watcher.active) return;
    this.watcher.onChange = (paths) => {
      this.recentBatches.unshift({ at: Date.now(), paths });
      if (this.recentBatches.length > 10) this.recentBatches.pop();
      void this.refresh().catch(() => {});
    };
    this.watcher.start(root);
  }

  disableAutoRefresh(): void {
    this.watcher.stop();
  }

  getSnapshot(): ProjectIndex | null {
    return this.current;
  }

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
    this.pendingBufferAt = 0;
    this.disableAutoRefresh();
  }

  updateBuffer(relPath: string, content: string): void {
    this.buffers.set(relPath.replace(/\\/g, '/'), content);
    this.pendingBufferAt = Date.now();
  }

  dropBuffer(relPath: string): void {
    this.buffers.delete(relPath.replace(/\\/g, '/'));
  }

  async refresh(): Promise<IndexRefreshResult> {
    if (this.inFlight) {
      const snapshot = this.current;
      if (snapshot && !this.rerunPending()) {
        // stale-but-valid fast path — unless a landed buffer demands a rerun
        return { index: snapshot, filesParsed: -1, cacheHits: -1, durationMs: 0 };
      }
      return this.inFlight;
    }
    let result = await this.doRefresh();
    let guard = 0;
    while (result.rerun && guard < MAX_RERUNS) {
      guard++;
      result = await this.doRefresh();
    }
    return result;
  }

  private rerunPending(): boolean {
    return this.pendingBufferAt > 0 && this.buffers.size > 0;
  }

  private async doRefresh(): Promise<IndexRefreshResult> {
    const startedAt = Date.now();
    const root = workspaceService.requireWorkspace();
    this.ensureDiskCache(root);
    const walkStart = Date.now();

    if (this.builtForRoot !== root) {
      this.cache.clear();
      this.bibCache.clear();
      this.buffers.clear();
      this.current = null;
      this.builtForRoot = root;
    }

    const texFiles: string[] = [];
    const bibFiles: string[] = [];
    await this.walk(root, '', texFiles, bibFiles);
    const walkMs = Date.now() - walkStart;
    const parseStart = Date.now();

    let cacheHits = 0;
    const parsed: FileParseResult[] = [];
    for (const rel of texFiles) {
      const buf = this.buffers.get(rel);
      if (buf !== undefined) {
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
        const hash = this.sha1(content);
        const diskHit = this.diskFiles.get(rel);
        if (diskHit && diskHit.hash === hash) {
          this.cache.set(rel, { mtimeMs: stat.mtimeMs, size: stat.size, parsed: diskHit.parsed });
          parsed.push(diskHit.parsed);
          continue;
        }
        parsed.push(this.parseWithCache(rel, content, stat.mtimeMs, stat.size));
        this.diskFiles.set(rel, { hash, parsed: parsed[parsed.length - 1] });
        this.diskDirty = true;
      } catch {
        /* unreadable/deleted mid-scan → skip file */
      }
    }

    const bibParsed: {
      file: string;
      entries: ReturnType<typeof parseBibDocumentEntries>;
    }[] = [];
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
        const hash = this.sha1(content);
        const diskHit = this.diskBib.get(rel);
        let entries = diskHit?.hash === hash ? diskHit.entries : undefined;
        if (!entries) {
          entries = parseBibDocumentEntries(content, rel);
          this.diskBib.set(rel, { hash, entries });
          this.diskDirty = true;
        }
        this.bibCache.set(rel, { mtimeMs: stat.mtimeMs, size: stat.size, entries });
        bibParsed.push({ file: rel, entries });
      } catch {
        /* unreadable → skip */
      }
    }

    const mainFile = await workspaceService.detectMainFile();
    const index = assembleProjectIndex(parsed, bibParsed, mainFile);
    index.diagnostics = deriveGraphDiagnostics(index);
    const withMeta = index as ProjectIndex & { edges: unknown; version: number };
    withMeta.edges = deriveEdges(index);
    withMeta.version = ++this.rev;
    index.generatedAt = Date.now();

    // Graphics candidates matched against real files
    const allFiles = [...texFiles, ...bibFiles];
    const graphicsPaths: ProjectIndex['graphicsPaths'] = [];
    for (const f of parsed) {
      for (const g of f.graphics) {
        const target = g.file.replace(/\\/g, '/');
        const base = target.replace(/\.[^.]+$/, '');
        const matches = allFiles.filter((c) => c === target || c.startsWith(`${base}.`));
        for (const m of matches.slice(0, 3)) {
          graphicsPaths.push({ path: m.replace(/\.[^.]+$/, ''), detail: `in ${f.path}:${g.line}` });
        }
      }
    }
    index.graphicsPaths = graphicsPaths.filter(
      (g, i, arr) => arr.findIndex((x) => x.path === g.path) === i
    );

    this.current = index;

    const liveSet = new Set(texFiles);
    for (const key of [...this.cache.keys()]) if (!liveSet.has(key)) this.cache.delete(key);

    // A buffer landed after this pass started → exactly one extra pass so the
    // committed graph includes it. Bounded to avoid livelock.
    const rerun = this.pendingBufferAt > startedAt;
    const parseMs = Date.now() - parseStart;
    this.lastStats = { startedAt, durationMs: Date.now() - startedAt, walkMs, parseMs, assembleMs: 0, diagMs: 0, filesParsed: parsed.length, cacheHits, memCacheHits: cacheHits, rerun };
    if (!rerun) this.pendingBufferAt = 0;
    this.persistDiskCacheIfDirty();
    return { index, filesParsed: parsed.length, cacheHits, durationMs: Date.now() - startedAt, rerun };
  }

  private sha1(s: string): string {
    return createHash('sha1').update(s, 'utf8').digest('hex');
  }

  /** Persistent per-file cache lives inside the workspace (.latex-studio/) —
   *  automatically per-project and gitignored. Schema/parser version mismatch
   *  or corruption discards it (auto-rebuild). */
  private ensureDiskCache(root: string): void {
    if (this.diskLoadedRoot === root) return;
    this.diskFiles.clear();
    this.diskBib.clear();
    this.diskLoadedRoot = root;
    this.diskDirty = false;
    try {
      const p = this.diskCachePath(root);
      const raw = JSON.parse(fsSync.readFileSync(p, 'utf8')) as {
        schemaVersion?: number;
        parserVersion?: string;
        files?: Record<string, { hash: string; parsed: FileParseResult }>;
        bib?: Record<string, { hash: string; entries: unknown }>;
      };
      if (raw.schemaVersion !== GRAPH_SCHEMA_VERSION || raw.parserVersion !== PARSER_VERSION) return;
      for (const [rel, v] of Object.entries(raw.files ?? {})) {
        if (v?.hash && v?.parsed) this.diskFiles.set(rel, { hash: v.hash, parsed: v.parsed });
      }
      for (const [rel, v] of Object.entries(raw.bib ?? {})) {
        if (v?.hash && Array.isArray(v.entries)) {
          this.diskBib.set(rel, { hash: v.hash, entries: v.entries as ReturnType<typeof parseBibDocumentEntries> });
        }
      }
    } catch {
      /* missing/corrupt → clean rebuild */
    }
  }

  private diskCachePath(root: string): string {
    return path.join(root, '.latex-studio', 'cache', `fileparse-v${GRAPH_SCHEMA_VERSION}.json`);
  }

  /** Best-effort write-behind; corruption on next load → clean rebuild. */
  private persistDiskCacheIfDirty(): void {
    if (!this.diskDirty || !this.builtForRoot) return;
    try {
      const p = this.diskCachePath(this.builtForRoot);
      fsSync.mkdirSync(path.dirname(p), { recursive: true });
      const payload = {
        schemaVersion: GRAPH_SCHEMA_VERSION,
        parserVersion: PARSER_VERSION,
        savedAt: Date.now(),
        files: Object.fromEntries(this.diskFiles),
        bib: Object.fromEntries(this.diskBib),
      };
      fsSync.writeFileSync(p, JSON.stringify(payload));
      this.diskDirty = false;
    } catch {
      /* best-effort */
    }
  }

  getDebugInfo() {
    const idx = this.current;
    const edgesByKind: Record<string, number> = {};
    const edges = (idx as unknown as { edges?: { kind: string }[] })?.edges ?? [];
    for (const e of edges) edgesByKind[e.kind] = (edgesByKind[e.kind] ?? 0) + 1;
    return {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      parserVersion: PARSER_VERSION,
      rev: this.rev,
      builtForRoot: this.builtForRoot,
      nodes: {
        files: idx?.files.length ?? 0,
        sections: idx?.sections.length ?? 0,
        labels: idx?.labels.length ?? 0,
        references: idx?.references.length ?? 0,
        citations: idx?.citations.length ?? 0,
        figures: idx?.figures.length ?? 0,
        tables: idx?.tables.length ?? 0,
        equations: idx?.equations.length ?? 0,
        packages: idx?.packages.length ?? 0,
        bibEntries: idx?.bibEntries.length ?? 0,
      },
      edges: edgesByKind,
      lastPass: this.lastStats,
      recentBatches: this.recentBatches.slice(-10),
      watcherActive: this.watcherActive,
      watchedRoot: this.watcher.watchedRoot,
      diskCache: { entries: this.diskFiles.size + this.diskBib.size, dirty: this.diskDirty },
    };
  }

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
      if (
        e.name.startsWith('.') ||
        e.name === 'node_modules' ||
        e.name === '.build' ||
        e.name === '.latex-studio'
      ) {
        continue;
      }
      // V0.3 security: never follow symlinks/junctions out of the jail.
      if (e.isSymbolicLink()) continue;
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
