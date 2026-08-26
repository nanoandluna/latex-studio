import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { SnapshotStore } from '../services/snapshots/snapshotStore.js';
import { safeResolve, safeRealpathInside } from '../utils/paths.js';
import { workspaceService } from '../services/workspaceService.js';
import type { SnapshotReason } from '@latex-studio/shared';

const VALID_REASONS: string[] = ['manual', 'auto', 'build-ok', 'pre-replace', 'pre-restore', 'before-import'];

function getStore(root: string) {
  return new SnapshotStore(root);
}

export async function registerSnapshotRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/workspace/snapshots', async (req, reply) => {
    const root = workspaceService.requireWorkspace();
    const body = (req.body ?? {}) as { reason?: string; label?: string };
    const reason = (VALID_REASONS as string[]).includes(body.reason ?? '')
      ? (body.reason as SnapshotReason)
      : 'manual';

    const files = await collectSourceFiles(root);
    const store = getStore(root);
    const manifest = await store.create({
      reason,
      ...(body.label ? { label: body.label } : {}),
      mainFile: 'main.tex',
      files,
      readContent: async (absPath: string) => {
        safeResolve(root, path.relative(root, absPath).replace(/\\/g, '/'));
        return fs.readFileSync(absPath);
      },
    });
    return reply.code(201).send(manifest);
  });

  app.get('/api/workspace/snapshots', async () => {
    const root = workspaceService.requireWorkspace();
    return getStore(root).list();
  });

  app.get('/api/workspace/snapshots/:id', async (req, reply) => {
    const root = workspaceService.requireWorkspace();
    const { id } = req.params as { id: string };
    const m = await getStore(root).get(id);
    if (!m) {
      return reply.code(404).send({ error: { code: 'FILE_NOT_FOUND', message: `Unknown snapshot: ${id}` } });
    }
    return m;
  });

  app.get('/api/workspace/snapshots/:id/diff', async (req, reply) => {
    const root = workspaceService.requireWorkspace();
    const { id } = req.params as { id: string };
    const store = getStore(root);
    const m = await store.get(id);
    if (!m) {
      return reply.code(404).send({ error: { code: 'FILE_NOT_FOUND', message: 'Unknown snapshot' } });
    }

    const snapPaths = new Set(m.files.map((f) => f.path));
    const currentFiles = await collectSourceFiles(root);
    const currentSet = new Set(currentFiles);
    const allPaths = [...new Set([...snapPaths, ...currentFiles])].sort();

    const entries = [];
    for (const rel of allPaths) {
      const inSnap = snapPaths.has(rel);
      const onDisk = currentSet.has(rel);
      if (!inSnap && !onDisk) continue;

      const isBinary = /\.(png|jpe?g|gif|svg|pdf|zip)$/i.test(rel);
      let status: 'M' | 'A' | 'D' = 'M';
      if (!onDisk) status = 'D';
      else if (!inSnap) status = 'A';

      let snapContent: string | undefined;
      let diskContent: string | undefined;
      if (!isBinary) {
        try { snapContent = (await store.readFile(id, rel)).toString('utf8'); } catch {}
        try { diskContent = (await fsp.readFile(path.join(root, rel), 'utf8')); } catch {}
      }

      entries.push({
        path: rel,
        status,
        binary: isBinary,
        ...(isBinary ? {} : { snapContent: snapContent ?? '', diskContent: diskContent ?? '' }),
      });
    }
    return { snapshotId: id, entries };
  });

  app.post('/api/workspace/snapshots/:id/restore', async (req, reply) => {
    const root = workspaceService.requireWorkspace();
    const { id } = req.params as { id: string };

    // safety net: capture CURRENT state before overwriting
    const preFiles = await collectSourceFiles(root);
    const preId = `snap_pre_restore_${Date.now().toString(36)}`;
    const tmpDir = path.join(root, '.latex-studio', 'snapshots', `.tmp-${preId}`);
    try {
      await fsp.mkdir(tmpDir, { recursive: true });
      for (const rel of preFiles.sort()) {
        const destAbs = path.join(tmpDir, 'files', ...rel.split('/'));
        await fsp.mkdir(path.dirname(destAbs), { recursive: true });
        await fsp.copyFile(path.join(root, rel), destAbs);
      }
      await fsp.writeFile(
        path.join(tmpDir, 'manifest.json'),
        JSON.stringify({
          version: 1, snapshotId: preId, workspaceId: '',
          createdAt: Date.now(), reason: 'pre-restore',
          mainFile: 'main.tex', fileCount: preFiles.length,
          totalBytes: 0, contentHash: '', files: [],
        })
      );
      await fsp.rename(
        tmpDir,
        path.join(root, '.latex-studio', 'snapshots', preId)
      );
    } catch { /* non-fatal */ }

    // validate + write snapshot files back to workspace
    const store = getStore(root);
    const m = await store.get(id);
    if (!m) {
      return reply.code(404).send({ error: { code: 'FILE_NOT_FOUND', message: 'Unknown snapshot' } });
    }

    let restored = 0;
    for (const f of m.files) {
      try {
        const abs = safeResolve(root, f.path);
        await safeRealpathInside(root, abs);
        const buf = await store.readFile(id, f.path);
        await fsp.mkdir(path.dirname(abs), { recursive: true });
        await fsp.writeFile(abs, buf);
        restored++;
      } catch { /* skip */ }
    }
    return reply.code(200).send({ ok: true, restored, preRestoreSnapshotId: preId });
  });

  app.delete('/api/workspace/snapshots/:id', async (req, reply) => {
    const root = workspaceService.requireWorkspace();
    const { id } = req.params as { id: string };
    const deleted = await getStore(root).delete(id);
    if (!deleted) {
      return reply.code(404).send({ error: { code: 'FILE_NOT_FOUND', message: 'Not found' } });
    }
    return { ok: true };
  });
}

/** Collect source file paths using the same walk rules as the indexer. */
export async function collectSourceFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (absDir: string, relDir: string): Promise<void> => {
    let entries;
    try {
      entries = await fsp.readdir(absDir, { withFileTypes: true });
    } catch { return; }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue; // jail: never follow links
      if (
        e.name.startsWith('.') ||
        e.name === 'node_modules' ||
        e.name === '.build' ||
        e.name === '.latex-studio'
      ) continue;
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(path.join(absDir, e.name), rel);
      } else if (e.isFile()) {
        // skip LaTeX build artifacts even outside .build
        if (/\.(aux|log|fls|fdb_latexmk|synctex\.gz|synctex\.busy|bbl|bcf|run\.xml|out|toc|lof|lot|blg|xdv)$/i.test(e.name)) continue;
        out.push(rel);
      }
    }
  };
  await walk(path.resolve(root), '');
  return out;
}
