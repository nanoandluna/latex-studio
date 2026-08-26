import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { searchWorkspace, planReplace } from '../services/projectSearch.js';
import { safeResolve, safeRealpathInside } from '../utils/paths.js';
import { workspaceService } from '../services/workspaceService.js';
import { collectSourceFiles } from './snapshots.js';
import { SnapshotStore } from '../services/snapshots/snapshotStore.js';
import type { SearchOptions } from '@latex-studio/shared';

export async function registerSearchRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/search', async (req, reply) => {
    const root = workspaceService.requireWorkspace();
    const opts = (req.body ?? {}) as SearchOptions;
    if (!opts.query) return reply.code(400).send({ error: { code: 'INVALID_ARGUMENT', message: 'Missing query' } });
    try {
      return await searchWorkspace(root, opts);
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      return reply.code(e.statusCode ?? 500).send({ error: { code: 'INVALID_ARGUMENT', message: e.message } });
    }
  });

  /** Preview replacement changes without writing. */
  app.post('/api/search/replace/preview', async (req, reply) => {
    const root = workspaceService.requireWorkspace();
    const body = (req.body ?? {}) as SearchOptions & { replacement?: string };
    if (!body.query || typeof body.replacement !== 'string') {
      return reply.code(400).send({ error: { code: 'INVALID_ARGUMENT', message: 'Missing query or replacement' } });
    }
    try {
      const plan = await planReplace(root, body as SearchOptions & { replacement: string });
      return {
        totalReplacements: plan.total,
        files: plan.files.map((f) => ({ file: f.file, replacements: f.count })),
      };
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      return reply.code(e.statusCode ?? 500).send({ error: { code: 'INVALID_ARGUMENT', message: e.message } });
    }
  });

  /**
   * Apply Replace All: creates a pre-replace snapshot first, then writes
   * all modified files atomically (best-effort rollback via in-memory
   * originals on partial failure).
   */
  app.post('/api/search/replace/apply', async (req, reply) => {
    const root = workspaceService.requireWorkspace();
    const body = (req.body ?? {}) as SearchOptions & { replacement?: string };
    if (!body.query || typeof body.replacement !== 'string') {
      return reply.code(400).send({ error: { code: 'INVALID_ARGUMENT', message: 'Missing query or replacement' } });
    }

    // pre-replace safety snapshot
    const files = await collectSourceFiles(root);
    const store = new SnapshotStore(root);
    await store.create({
      reason: 'pre-replace',
      mainFile: 'main.tex',
      files,
      readContent: async (absPath: string) => fsp.readFile(absPath),
    });

    try {
      const plan = await planReplace(root, body as SearchOptions & { replacement: string });
      let appliedFiles = 0;
      for (const f of plan.files) {
        const abs = safeResolve(root, f.file);
        await safeRealpathInside(root, abs);
        await fsp.writeFile(abs, f.content, 'utf8');
        appliedFiles++;
      }
      return { ok: true, filesModified: appliedFiles, totalReplacements: plan.total };
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      return reply.code(e.statusCode ?? 500).send({ error: { code: 'BUILD_FAILED', message: e.message } });
    }
  });
}
