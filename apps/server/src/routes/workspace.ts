import type { FastifyInstance } from 'fastify';
import { workspaceService } from '../services/workspaceService.js';

export async function registerWorkspaceRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/workspace/open', async (req, reply) => {
    const { path: dir } = (req.body ?? {}) as { path?: string };
    if (!dir || typeof dir !== 'string') {
      return reply.code(400).send({ error: 'Missing workspace path' });
    }
    const opened = await workspaceService.open(dir);
    const mainFile = await workspaceService.detectMainFile();
    return { ...opened, mainFile };
  });

  app.post('/api/workspace/close', async () => {
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

  app.get('/api/workspace/bibkeys', async () => {
    return { keys: await workspaceService.collectBibKeys() };
  });

  app.get('/api/workspace/labels', async () => {
    return { labels: await workspaceService.collectLabels() };
  });
}
