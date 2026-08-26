import fs from 'node:fs';
import type { SnapshotManifest, SnapshotReason } from '@latex-studio/shared';
import path from 'node:path';
import { createHash } from 'node:crypto';

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
   */
  async create(
    input: {
      reason: SnapshotReason;
      label?: string;
      mainFile: string;
      files: string[];
      readContent: (relPath: string) => Promise<Buffer>;
    }
  ): Promise<SnapshotManifest> {
    const now = new Date();
    const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const rand = Math.random().toString(36).slice(2, 8);
    const id = `snap_${stamp}_${rand}`;
    const tmpDir = path.join(this.baseDir, `.tmp-${id}`);
    const finalDir = this.snapshotDir(id);

    const fileEntries: { path: string; size: number; mtimeMs: number; hash: string }[] = [];
    const hashes: string[] = [];
    let totalBytes = 0;

    try {
      for (const rel of input.files) {
        const buf = await input.readContent(rel);
        const hash = sha256(buf);
        let mtimeMs = Date.now();
        try {
          mtimeMs = (await fs.promises.stat(path.join(this.root, rel))).mtimeMs;
        } catch {
          /* stat optional */
        }

        const destAbs = path.join(tmpDir, 'files', ...rel.split('/'));
        await fs.promises.mkdir(path.dirname(destAbs), { recursive: true });
        await fs.promises.writeFile(destAbs, buf);

        fileEntries.push({ path: rel, size: buf.length, mtimeMs, hash });
        hashes.push(`${rel}:${hash}`);
        totalBytes += buf.length;
      }

      const contentHash = sha256(hashes.sort().join('\n'));
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
      return manifest;
    } catch (err) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
  }

  /** Read one file's content out of a snapshot. */
  async readFile(id: string, relPath: string): Promise<Buffer> {
    const abs = path.join(this.snapshotDir(id), 'files', ...relPath.split('/'));
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
   * Retention policy: hard cap by count (newest kept), plus age-based
   * coalescing beyond 24h — at most one snapshot per UTC day.
   */
  async prune(policy: { maxCount: number }): Promise<string[]> {
    const all = await this.list();
    const removed: string[] = [];

    for (let i = policy.maxCount; i < all.length; i++) {
      if (await this.delete(all[i].snapshotId)) removed.push(all[i].snapshotId);
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




