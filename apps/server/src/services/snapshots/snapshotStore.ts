import fs from 'node:fs';
import type { SnapshotManifest, SnapshotReason } from '@latex-studio/shared';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { safeResolve } from '../../utils/paths.js';

/**
 * V0.4 Snapshot Store — atomic, hash-verified local snapshots.
 *
 * Layout:
 *   <root>/.latex-studio/snapshots/<snapshotId>/
 *     ├── manifest.json
 *     └── files/<workspace-relative path…>
 *
 * Atomicity: everything is written into a temp dir first; the finished
 * snapshot becomes visible via a single directory rename. Any failure
 * removes the temp dir — a partial snapshot can never be observed.
 */

export const SNAPSHOTS_DIR = 'snapshots';

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export class SnapshotStore {
  constructor(private readonly root: string) {}

  private get baseDir(): string {
    return path.join(this.root, '.latex-studio', SNAPSHOTS_DIR);
  }

  private snapshotDir(id: string): string {
    if (!/^snap_[0-9a-z_-]+$/i.test(id)) throw new Error(`Invalid snapshot id: ${id}`);
    return path.join(this.baseDir, id);
  }

  async list(): Promise<SnapshotManifest[]> {
    let dirs: string[] = [];
    try {
      dirs = await fs.promises.readdir(this.baseDir);
    } catch {
      return [];
    }
    const manifests: SnapshotManifest[] = [];
    for (const d of dirs) {
      try {
        const raw = await fs.promises.readFile(path.join(this.baseDir, d, 'manifest.json'), 'utf8');
        const m = JSON.parse(raw) as SnapshotManifest;
        if (m?.snapshotId && Array.isArray(m.files)) manifests.push(m);
      } catch {
        /* corrupt entry → invisible */
      }
    }
    return manifests.sort((a, b) => b.createdAt - a.createdAt);
  }

  async get(id: string): Promise<SnapshotManifest | null> {
    const all = await this.list();
    return all.find((m) => m.snapshotId === id) ?? null;
  }

  /**
   * Atomically create a snapshot from workspace-relative files.
   *
   * `readContent` always receives a workspace-relative POSIX path and is
   * expected to return that file's bytes. Callers must resolve it against the
   * workspace root themselves (see safeResolve) — passing it straight to
   * fs.readFile would resolve against process.cwd() instead.
   *
   * When `skipIfUnchanged` is set and the freshly computed contentHash matches
   * the newest existing snapshot, nothing is written and that snapshot is
   * returned with `skipped: true`.
   */
  async create(
    input: {
      reason: SnapshotReason;
      label?: string;
      mainFile: string;
      files: string[];
      readContent: (relPath: string) => Promise<Buffer>;
      skipIfUnchanged?: boolean;
    }
  ): Promise<{ manifest: SnapshotManifest; skipped: boolean }> {
    const now = new Date();
    const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const rand = Math.random().toString(36).slice(2, 8);
    const id = `snap_${stamp}_${rand}`;
    const tmpDir = path.join(this.baseDir, `.tmp-${id}`);
    const finalDir = this.snapshotDir(id);

    const hashes: string[] = [];
    let totalBytes = 0;

    try {
      // Read+write in bounded parallel batches. A 1000-file snapshot used to
      // walk the project serially, which alone blew the Replace All budget —
      // each file costs a read, a stat and a write, and on Windows those add
      // up to seconds of pure latency. Order stays deterministic: entries are
      // written back into input order regardless of completion order.
      const madeDirs = new Set<string>();
      const CONCURRENCY = 16;

      const processOne = async (rel: string): Promise<SnapshotManifest['files'][number]> => {
        const buf = await input.readContent(rel);
        const hash = sha256(buf);

        const destAbs = path.join(tmpDir, 'files', ...rel.split('/'));
        const dir = path.dirname(destAbs);
        if (!madeDirs.has(dir)) {
          await fs.promises.mkdir(dir, { recursive: true });
          madeDirs.add(dir);
        }
        await fs.promises.writeFile(destAbs, buf);

        // Creation time, not the source file's mtime: this field answers
        // "when was this captured", and dropping the per-file stat removes a
        // third of the snapshot's thread-pool work.
        return { path: rel, size: buf.length, mtimeMs: now.getTime(), hash };
      };

      const fileEntries: SnapshotManifest['files'] = new Array(input.files.length);
      let cursor = 0;
      const worker = async (): Promise<void> => {
        while (cursor < input.files.length) {
          const i = cursor++;
          fileEntries[i] = await processOne(input.files[i]);
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, input.files.length) }, worker)
      );

      for (const e of fileEntries) {
        hashes.push(`${e.path}:${e.hash}`);
        totalBytes += e.size;
      }

      const contentHash = sha256(hashes.sort().join('\n'));

      if (input.skipIfUnchanged) {
        const newest = (await this.list())[0];
        if (newest && newest.contentHash === contentHash) {
          await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
          return { manifest: newest, skipped: true };
        }
      }

      const manifest: SnapshotManifest = {
        version: 1,
        snapshotId: id,
        workspaceId: sha256(this.root).slice(0, 16),
        createdAt: now.getTime(),
        reason: input.reason,
        ...(input.label ? { label: input.label } : {}),
        mainFile: input.mainFile,
        fileCount: fileEntries.length,
        totalBytes,
        contentHash,
        files: fileEntries,
      };
      const manifestRaw = JSON.stringify(manifest, null, 2);
      await fs.promises.writeFile(path.join(tmpDir, 'manifest.json'), manifestRaw);

      // integrity check before publish
      const reRead = JSON.parse(
        await fs.promises.readFile(path.join(tmpDir, 'manifest.json'), 'utf8')
      ) as SnapshotManifest;
      if (reRead.contentHash !== contentHash || reRead.fileCount !== reRead.files.length) {
        throw new Error('Snapshot integrity verification failed');
      }

      await fs.promises.rename(tmpDir, finalDir); // atomic publish
      return { manifest, skipped: false };
    } catch (err) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
  }

  /**
   * Read one file's content out of a snapshot.
   *
   * The jail is applied here too rather than trusting callers: snapshot reads
   * are driven by manifest entries, and a manifest is data we wrote once and
   * read back many times.
   */
  async readFile(id: string, relPath: string): Promise<Buffer> {
    const filesDir = path.join(this.snapshotDir(id), 'files');
    const abs = safeResolve(filesDir, relPath);
    return fs.promises.readFile(abs);
  }

  /** All stored file paths of a snapshot. */
  async fileList(id: string): Promise<string[]> {
    const m = await this.get(id);
    return m ? m.files.map((f) => f.path) : [];
  }

  async delete(id: string): Promise<boolean> {
    const dir = this.snapshotDir(id);
    if (!fs.existsSync(dir)) return false;
    await fs.promises.rm(dir, { recursive: true, force: true });
    return true;
  }

  /**
   * Retention policy (V0.4-PLAN 1.3), applied newest-first:
   *   1. hard cap by count — everything past `maxCount` is dropped
   *   2. beyond 24h — at most one snapshot per UTC day
   *   3. beyond `maxAgeDays` — dropped outright
   */
  async prune(policy: { maxCount: number; maxAgeDays?: number }): Promise<string[]> {
    const removed: string[] = [];
    const maxAgeDays = policy.maxAgeDays ?? 30;
    const maxAgeMs = maxAgeDays * 24 * 3600_000;

    let all = await this.list();
    for (let i = policy.maxCount; i < all.length; i++) {
      if (await this.delete(all[i].snapshotId)) removed.push(all[i].snapshotId);
    }

    all = await this.list();
    for (const m of all) {
      if (Date.now() - m.createdAt > maxAgeMs) {
        if (await this.delete(m.snapshotId)) removed.push(m.snapshotId);
      }
    }

    const olderThan24h = (await this.list()).filter(
      (m) => Date.now() - m.createdAt > 24 * 3600_000
    );
    const seenDays = new Set<string>();
    for (const m of olderThan24h) {
      const day = new Date(m.createdAt).toISOString().slice(0, 10);
      if (seenDays.has(day)) {
        if (await this.delete(m.snapshotId)) removed.push(m.snapshotId);
      } else {
        seenDays.add(day);
      }
    }
    return removed;
  }
}
