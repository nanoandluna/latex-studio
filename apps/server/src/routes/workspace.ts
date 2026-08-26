import type { FastifyInstance } from 'fastify';
import { workspaceService } from '../services/workspaceService.js';
import { projectIndexService } from '../services/projectIndexService.js';
import { readRecents, recordRecent } from '../services/recentProjects.js';

export async function registerWorkspaceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/workspace/recent', async () => {
    return { recents: readRecents() };
  });

  app.post('/api/workspace/open', async (req, reply) => {
    const { path: dir } = (req.body ?? {}) as { path?: string };
    if (!dir || typeof dir !== 'string') {
      return reply.code(400).send({ error: { code: 'INVALID_ARGUMENT', message: 'Missing workspace path' } });
    }
    const opened = await workspaceService.open(dir);
    recordRecent(opened.path);
    // V0.3: keep the index fresh on external changes for THIS root only.
    projectIndexService.enableAutoRefresh(opened.path);
    const mainFile = await workspaceService.detectMainFile();
    return { ...opened, mainFile };
  });

  app.post('/api/workspace/close', async () => {
    projectIndexService.disableAutoRefresh();
    await workspaceService.close();
    return { ok: true };
  });

  app.get('/api/workspace/state', async () => {
    const root = workspaceService.workspacePath;
    if (!root) return { open: false };
    const mainFile = await workspaceService.detectMainFile();
    return { open: true, path: root, name: workspaceService.workspaceName, mainFile };
  });

  app.get('/api/workspace/tree', async () => {
    return workspaceService.getTree();
  });

  app.get('/api/workspace/mainfile', async () => {
    return { mainFile: await workspaceService.detectMainFile() };
  });

  /** Legacy compat endpoints — served from the Project Index (no rescan). */
  app.get('/api/workspace/bibkeys', async () => {
    await projectIndexService.refresh();
    const snap = projectIndexService.getSnapshot();
    return {
      keys: (snap?.bibEntries ?? []).map((b) => ({
        key: b.key,
        file: b.file,
        line: b.line,
        type: b.type,
      })),
    };
  });

  app.get('/api/workspace/labels', async () => {
    await projectIndexService.refresh();
    const snap = projectIndexService.getSnapshot();
    return {
      labels: (snap?.labels ?? []).map((l) => ({
        key: l.key,
        file: l.file,
        line: l.line,
      })),
    };
  });
}
