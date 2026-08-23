import type { FastifyInstance } from 'fastify';
import { workspaceService } from '../services/workspaceService.js';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => {
    return {
      ok: true,
      workspace: workspaceService.workspacePath,
      time: new Date().toISOString(),
    };
  });
}
