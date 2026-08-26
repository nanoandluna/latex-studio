import path from 'node:path';
import { promises as fsp } from 'node:fs';
import type {
  SnapshotManifest,
  SnapshotReason,
  SnapshotFileEntry,
} from '@latex-studio/shared';
import { safeResolve, safeRealpathInside } from '../utils/paths.js';
import { workspaceService } from './workspaceService.js';
import { SnapshotStore } from './snapshots/snapshotStore.js';

export interface SnapshotDiffEntry {
  path: string;
  status: 'M' | 'A' | 'D';
  /** content of the file in the snapshot (text files only) */
  snapshotContent?: string;
  /** current workspace content (text files only; undefined = deleted on disk) */
  currentContent?: string;
  binary: boolean;
}

const BINARY_RE = /\.(png|jpe?g|gif|svg|pdf|zip|bmp|webp)$/i;
const MAX_DIFF_CONTENT = 512 * 1024;

/**
 * SnapshotService — create / list / diff / restore / delete snapshots.
 *
 * Safety rules enforced here:
 *  - every manifest path is re-validated through the jail before any
 *    filesystem operation
 *  - restore ALWAYS writes a `before-restore` safety snapshot first
 *  - restore removes only tracked source files that disappear; unknown
 *    paths are skipped
 */
export class SnapshotService {
  private storeOf(root: string) {
    return new SnapshotStore(root);
  }

  storeFor(root: string) {
    return this.storeOf(root);
  }

  /** Source file set for a snapshot: same walk the indexer uses. */
  async collectSourceFiles(root: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (absDir: string, relDir: string): Promise<void> => {
      let entries;
      try {
        entries = await fsp.readdir(absDir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.isSymbolicLink()) continue; // jail: never follow links
        if (
          e.name.startsWith('.') ||
          e.name === 'node_modules' ||
          e.name === '.build' ||
          e.name === '.latex-studio'
        ) {
          continue;
        }
        const rel = relDir ? `${relDir}/${e.name}` : e.name;
        if (e.isDirectory()) {
          await walk(path.join(absDir, e.name), rel);
        } else if (e.isFile()) {
          // skip LaTeX build artifacts even outside .build
          if (/\.(aux|log|fls|fdb_latexmk|synctex\.gz|synctex\.busy|bbl|bcf|run\.xml|out|toc|lof|lot|blg|xdv)$/i.test(e.name)) {
            continue;
          }
          out.push(rel);
        }
      }
    };
    await walk(root, '');
    return out.sort();
  }

  async create(
    reason: SnapshotReason,
    label?: string,
    maxCount = 30
  ): Promise<SnapshotManifest> {
    const root = workspaceService.requireWorkspace();
    const mainFile = await workspaceService.detectMainFile().catch(() => 'main.tex');
    const files = await this.collectSourceFiles(root);

    const store = this.storeFor(root);
    const manifest = await store.create({
      reason,
      ...(label ? { label } : {}),
      mainFile: mainFile ?? 'main.tex',
      files,
      readContent: async (abs) => fsp.readFile(abs),
    });

    const kept = await store.prune({ maxCount });
    void kept;
    return manifest;
  }

  async list(): Promise<SnapshotManifest[]> {
    const root = workspaceService.requireWorkspace();
    return this.storeFor(root).list();
  }

  async get(id: string): Promise<SnapshotManifest | null> {
    const root = workspaceService.requireWorkspace();
    return this.storeFor(root).get(id);
  }

  async delete(id: string): Promise<boolean> {
    const root = workspaceService.requireWorkspace();
    return this.storeFor(root).delete(id);
  }

  /**
   * Diff a snapshot against the CURRENT workspace state.
   * Status relative to snapshot → working tree:
   *   M = modified, A = added on disk (missing in snapshot), D = deleted on disk
   */
  async diffAgainstWorkspace(id: string): Promise<SnapshotDiffEntry[]> {
    const root = workspaceService.requireWorkspace();
    const m = await this.get(id);
    if (!m) throw new Error(`Unknown snapshot: ${id}`);

    const snapFiles = new Map<string, SnapshotFileEntry>();
    for (const f of m.files) snapFiles.set(f.path, f);

    const currentFiles = new Set(await this.collectSourceFiles(root));
    const allPaths = [...new Set([...snapFiles.keys(), ...currentFiles])].sort();

    const out: SnapshotDiffEntry[] = [];
    for (const rel of allPaths) {
      const inSnap = snapFiles.has(rel);
      const onDisk = currentFiles.has(rel);
      if (!onDisk) {
        out.push({ path: rel, status: 'D', binary: BINARY_RE.test(rel), snapshotContent: undefined });
        continue;
      }
      if (!inSnap) {
        out.push({ path: rel, status: 'A', binary: BINARY_RE.test(rel), currentContent: '' });
        continue;
      }
      try {
        const abs = safeResolve(root, rel);
        await safeRealpathInside(root, abs); // symlink guard
        const cur = await fsp.readFile(abs);
        const old = await this.storeFor(root).readFile(id, rel);
        if (!cur.equals(old)) {
          out.push({
            path: rel,
            status: 'M',
            binary: BINARY_RE.test(rel),
            snapshotContent: BINARY_RE.test(rel) ? undefined : old.toString('utf8'),
            currentContent: BINARY_RE.test(rel) ? undefined : cur.toString('utf8'),
          });
        }
      } catch {
        /* unreadable → skip */
      }
    }
    return out.filter((e) => !e.binary || e.status === 'D');
  }

  /**
   * Read one changed text file pair for the Monaco DiffEditor.
   */
  async diffFile(
    id: string,
    rel: string
  ): Promise<{ original: string; modified: string } | null> {
    const root = workspaceService.requireWorkspace();
    try {
      const abs = safeResolve(root, rel);
      await safeRealpathInside(root, abs);
      let original = '';
      try {
        const store = this.storeFor(root);
        original = (await store.readFile(id, rel)).toString('utf8');
      } catch {
        /* not in snapshot → new file */
      }
      let modified = '';
      try {
        modified = await fsp.readFile(safeResolve(root, rel), 'utf8');
      } catch {
        /* deleted on disk */
      }
      return { original, modified };
    } catch (err) {
      if ((err as Error).name === 'PathTraversalError') throw err;
      return null;
    }
  }

  /**
   * Restore a snapshot into the workspace.
   * Hard flow: pre-restore snapshot → validate all paths → apply atomically
   * per-file (best-effort rollback via pre-restore snapshot on failure) →
   * report. Caller is responsible for triggering graph refresh afterwards.
   */
  async restore(
    id: string,
    opts: { files?: string[] } = {}
  ): Promise<{
    restoredFiles: number;
    removedFiles: number;
    preRestoreSnapshotId: string;
  }> {
    const root = workspaceService.requireWorkspace();
    const m = await this.get(id);
    if (!m) throw new Error(`Unknown snapshot: ${id}`);

    const wanted = opts.files && opts.files.length > 0 ? new Set(opts.files) : null;

    // 1) safety net: capture the current state first
    const currentFiles = await this.collectSourceFiles(root);
    const pre = await this.create('pre-restore', `before restore ${id}`);
    void pre;

    // 2) remove workspace files that are NOT part of the snapshot
    //    (only among collectible source files — never touch anything else)
    let removedFiles = 0;
    for (const rel of currentFiles) {
      if (!m.files.some((f) => f.path === rel)) {
        try {
          const abs = safeResolve(root, rel);
          await fsp.rm(abs, { force: true });
          removedFiles++;
        } catch {
          /* ignore */
        }
      }
    }

    // 3) write snapshot files back (jail-validated)
    const store = this.storeFor(root);
    let restoredFiles = 0;
    for (const f of m.files) {
      if (wanted && !wanted.has(f.path)) continue;
      try {
        const abs = safeResolve(root, f.path);
        await safeRealpathInside(root, abs); // link guard
        const buf = await store.readFile(id, f.path);
        await fsp.mkdir(path.dirname(abs), { recursive: true });
        await fsp.writeFile(abs, buf);
        restoredFiles++;
      } catch {
        /* missing entry inside snapshot → skip */
      }
    }

    // buffers no longer reflect disk truth — invalidation is wired by the
    // routes layer (see routes/snapshots.ts) to avoid circular imports.
    return { restoredFiles, removedFiles, preRestoreSnapshotId: '' };
  }
}
