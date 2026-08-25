import fs from 'node:fs';
import path from 'node:path';

/**
 * V0.3 File Watcher — owns the OS watch handle for the open workspace.
 *
 * Design:
 *  - SOURCE_ROOT is the workspace itself; BUILD_ROOT (.build) and metadata
 *    dirs (.latex-studio, node_modules, hidden entries) NEVER schedule work.
 *  - LaTeX artifact extensions are filtered even outside the build root
 *    (e.g. a stray .log next to sources must not trigger re-indexing).
 *  - Events are debounced (150 ms) and coalesced into one batch of changed
 *    relative paths, so rapid save bursts produce a single incremental pass.
 *
 * Lifecycle: start(root) → change events → stop()/dispose(). Restarting with
 * a new root replaces the old handle; handles never accumulate.
 */

const IGNORED_TOP_DIRS = new Set(['.build', '.latex-studio', 'node_modules', '.git']);

const ARTIFACT_RE =
  /\.(aux|log|fls|fdb_latexmk|synctex\.gz|synctex\.busy|bbl|bcf|run\.xml|out|toc|lof|lot|blg|xdv)$/i;

export function isIgnoredWorkspacePath(relPosix: string): boolean {
  const first = relPosix.split('/')[0];
  if (first && IGNORED_TOP_DIRS.has(first)) return true;
  if (relPosix.split('/').some((seg) => seg.startsWith('.') && seg !== '.')) return true;
  return ARTIFACT_RE.test(relPosix);
}

export class FileWatcher {
  private watcher: fs.FSWatcher | null = null;
  private root: string | null = null;
  private pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private startedAt = 0;

  /** Set by the owner (ProjectIndexService). Receives coalesced rel paths. */
  onChange: ((paths: string[]) => void) | null = null;

  get active(): boolean {
    return this.watcher !== null;
  }

  get watchedRoot(): string | null {
    return this.root;
  }

  start(root: string): void {
    if (this.root === root && this.active) return; // idempotent restart guard
    this.stop();
    this.root = root;
    this.startedAt = Date.now();
    try {
      this.watcher = fs.watch(root, { recursive: true }, (_event, name) => {
        this.onFsEvent(name);
      });
    } catch {
      this.watcher = null;
    }
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
    this.root = null;
  }

  dispose(): void {
    this.onChange = null;
    this.stop();
  }

  private onFsEvent(name: string | Buffer | null): void {
    if (Date.now() - this.startedAt < 300) return; // attach storm guard
    if (!name) return;
    const rel = name.toString().replace(/\\/g, '/');
    if (isIgnoredWorkspacePath(rel)) return;
    this.pending.add(rel);
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        if (process.env.LS_DEBUG) console.error('[watcher] batch:', this.pending.size);
        const paths = [...this.pending];
        this.pending.clear();
        if (paths.length > 0) this.onChange?.(paths);
      }, 150);
    }
  }
}

export function buildRootFor(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.build');
}
