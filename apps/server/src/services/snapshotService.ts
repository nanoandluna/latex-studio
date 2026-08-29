import path from 'node:path';
import { promises as fsp } from 'node:fs';
import type {
  SnapshotManifest,
  SnapshotReason,
  SnapshotFileEntry,
  SnapshotDiffEntry,
} from '@latex-studio/shared';
import { safeResolve, safeRealpathInside } from '../utils/paths.js';
import { workspaceService } from './workspaceService.js';
import { collectSourceFiles } from '../utils/walkWorkspace.js';
import { SnapshotStore } from './snapshots/snapshotStore.js';
import { projectIndexService } from './projectIndexService.js';

const BINARY_RE = /\.(png|jpe?g|gif|svg|pdf|zip|bmp|webp)$/i;

/** V0.4-PLAN 1.3 retention: 24h keep-all, then daily coalesce, 30 total, 30 days. */
const RETENTION = { maxCount: 30, maxAgeDays: 30 };

/**
 * SnapshotService — the single implementation behind snapshot, history, diff
 * and restore. Routes are a thin HTTP layer over this class.
 *
 * Safety rules enforced here:
 *  - every manifest path is re-validated through the jail before any
 *    filesystem operation
 *  - restore ALWAYS writes a `pre-restore` safety snapshot first, and aborts
 *    if that safety net cannot be captured
 *  - restore removes only tracked source files that are absent from the
 *    snapshot; unknown paths are never touched
 */
export class SnapshotService {
  private storeOf(root: string) {
    return new SnapshotStore(root);
  }

  storeFor(root: string) {
    return this.storeOf(root);
  }

  /**
   * Create a snapshot of the current workspace.
   *
   * Returns the manifest plus `skipped`, which is true when the content hash
   * matches the newest snapshot and nothing was written.
   */
  async create(
    reason: SnapshotReason,
    label?: string,
    opts: { maxCount?: number; maxAgeDays?: number } = {}
  ): Promise<{ manifest: SnapshotManifest; skipped: boolean }> {
    const root = workspaceService.requireWorkspace();
    const mainFile = (await workspaceService.detectMainFile().catch(() => null)) ?? 'main.tex';
    const files = await collectSourceFiles(root);

    const store = this.storeFor(root);
    // Snapshotting writes one copy of every source file. With the watcher live
    // each of those writes is taxed by the OS change feed, which alone pushed
    // a 1000-file pre-replace snapshot far past the Replace All budget. The
    // snapshot tree is index-invisible anyway, so events during the write are
    // dropped rather than processed.
    projectIndexService.suspendWatcher();
    let result: { manifest: SnapshotManifest; skipped: boolean };
    try {
      result = await store.create({
        reason,
        ...(label ? { label } : {}),
        mainFile,
        files,
        // rel is workspace-relative; resolving it through the jail keeps reads
        // independent of process.cwd()
        readContent: (rel) => fsp.readFile(safeResolve(root, rel)),
        skipIfUnchanged: true,
      });

      if (!result.skipped) {
        await store.prune({
          maxCount: opts.maxCount ?? RETENTION.maxCount,
          maxAgeDays: opts.maxAgeDays ?? RETENTION.maxAgeDays,
        });
      }
    } finally {
      projectIndexService.resumeWatcher();
    }
    return result;
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

    const currentFiles = new Set(await collectSourceFiles(root));
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
        original = (await this.storeFor(root).readFile(id, rel)).toString('utf8');
      } catch {
        /* not in snapshot → new file */
      }
      let modified = '';
      try {
        modified = await fsp.readFile(abs, 'utf8');
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
   *
   * Hard flow: pre-restore snapshot → validate every path → apply per file →
   * report. A partial failure is reported through `failed` rather than being
   * swallowed, so the caller can tell the user exactly what did not come back.
   * Caller is responsible for triggering a graph refresh afterwards.
   */
  async restore(
    id: string,
    opts: { files?: string[] } = {}
  ): Promise<{
    restoredFiles: number;
    removedFiles: number;
    preRestoreSnapshotId: string;
    failed: string[];
  }> {
    const root = workspaceService.requireWorkspace();
    const m = await this.get(id);
    if (!m) throw new Error(`Unknown snapshot: ${id}`);

    const wanted = opts.files && opts.files.length > 0 ? new Set(opts.files) : null;

    // 1) safety net: capture the current state before anything is overwritten
    const { manifest: pre } = await this.create('pre-restore', `before restore ${id}`);

    // Bulk restore: watcher suspended for the same reason as in create(). The
    // caller (route layer) refreshes the index explicitly afterwards.
    projectIndexService.suspendWatcher();

    let removedFiles = 0;
    let restoredFiles = 0;
    const failed: string[] = [];
    try {
      // 2) remove workspace source files that are NOT part of the snapshot
      //    (only among collectible source files — never touch anything else).
      //    A partial restore must not delete anything: the point of restoring
      //    one file is to salvage it, not to roll the whole tree back and take
      //    everything written since the snapshot with it.
      if (!wanted) {
        const currentFiles = await collectSourceFiles(root);
        for (const rel of currentFiles) {
          if (!m.files.some((f) => f.path === rel)) {
            try {
              await fsp.rm(safeResolve(root, rel), { force: true });
              removedFiles++;
            } catch {
              /* ignore */
            }
          }
        }
      }

      // 3) write snapshot files back (jail-validated)
      const store = this.storeFor(root);
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
          failed.push(f.path);
        }
      }
    } finally {
      projectIndexService.resumeWatcher();
    }

    return {
      restoredFiles,
      removedFiles,
      preRestoreSnapshotId: pre.snapshotId,
      failed,
    };
  }
}

export const snapshotService = new SnapshotService();
