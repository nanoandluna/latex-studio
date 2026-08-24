import type { FastifyInstance } from 'fastify';
import { projectIndexService } from '../services/projectIndexService.js';
import { workspaceService } from '../services/workspaceService.js';

export async function registerIndexRoutes(app: FastifyInstance): Promise<void> {
  /** Latest available index (refreshes automatically after a workspace switch). */
  app.get('/api/index', async () => {
    if (projectIndexService.needsRebuild()) {
      await projectIndexService.refresh();
    }
    return projectIndexService.getSnapshot();
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
        /* invalid path — ignore silently, index stays as-is */
      }
    }
    if (!accepted) {
      return projectIndexService.getSnapshot();
    }
    // Re-parse (incremental: unchanged files come from cache) so callers get
    // an index that already includes this buffer.
    await projectIndexService.refresh();
    return projectIndexService.getSnapshot();
  });
}
