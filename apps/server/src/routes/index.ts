import type { FastifyInstance } from 'fastify';
import { promises as fs } from 'node:fs';
import { projectIndexService } from '../services/projectIndexService.js';
import { workspaceService } from '../services/workspaceService.js';
import { analyzeWriting } from '../services/writingChecks.js';

function envelope(index: import('@latex-studio/shared').ProjectIndex) {
  // V0.3 structured response: the graph fields stay TOP-LEVEL (backward
  // compatible with every existing consumer) plus monotonic revision and
  // workspace root for stale-response guards.
  const { edges, version, generatedAt, ...graph } = index as typeof index & {
    edges: unknown;
    version: number;
    generatedAt: number;
  };
  return {
    ...graph,
    edges,
    version: version ?? 0,
    generatedAt: generatedAt ?? Date.now(),
    root: workspaceService.workspacePath ?? '',
  };
}

export async function registerIndexRoutes(app: FastifyInstance): Promise<void> {
  /** Latest available index (refreshes automatically after a workspace switch). */
  app.get('/api/index', async () => {
    if (projectIndexService.needsRebuild()) {
      await projectIndexService.refresh();
    }
    const snap = projectIndexService.getSnapshot();
    return snap ? envelope(snap) : null;
  });

  /** Force a refresh; concurrent callers share the in-flight scan. */
  app.post('/api/index/refresh', async () => {
    const { index, filesParsed, cacheHits, durationMs } = await projectIndexService.refresh();
    return { filesParsed, cacheHits, durationMs, index };
  });

  /**
   * Push unsaved editor buffer content so completions/diagnostics reflect
   * what the user sees. Debounced upstream (500 ms). Returns the refreshed
   * index for the single changed file merged into the project view.
   */
  app.post('/api/index/update', async (req) => {
    const { path: rel, content } = (req.body ?? {}) as { path?: string; content?: string };
    let accepted = false;
    if (typeof rel === 'string' && typeof content === 'string' && workspaceService.workspacePath) {
      try {
        const { safeResolve } = await import('../utils/paths.js');
        safeResolve(workspaceService.workspacePath, rel);
        projectIndexService.updateBuffer(rel, content);
        accepted = true;
      } catch {
        /* invalid path — ignore silently */
      }
    }
    if (accepted) {
      // Always re-index after accepting a buffer (incremental + cached →
      // cheap) so the RESPONSE reflects it.
      await projectIndexService.refresh();
    } else if (projectIndexService.needsRebuild()) {
      await projectIndexService.refresh();
    }
    const snap = projectIndexService.getSnapshot();
    return snap ? envelope(snap) : null;
  });

  /** Rule-based academic-writing checks over the current tex sources. */
  app.get('/api/writing-checks', async (req) => {
    const enabled = (req.query as { disabled?: string }).disabled !== '1';
    if (!enabled || !workspaceService.workspacePath) return { diagnostics: [] };
    const { index } = await projectIndexService.refresh();
    const diags = [];
    for (const file of index.files.filter((f) => f.endsWith('.tex'))) {
      try {
        const abs = (
          await import('../utils/paths.js')
        ).safeResolve(workspaceService.workspacePath, file);
        const content = await fs.readFile(abs, 'utf8');
        diags.push(...analyzeWriting(content, file));
      } catch {
        /* unreadable → skip */
      }
    }
    return { diagnostics: diags };
  });
}
