import type { FastifyInstance } from 'fastify';
import { getEnvironment } from '../services/environmentService.js';

export async function registerEnvRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/env', async (req) => {
    const force = (req.query as { force?: string }).force === '1';
    return getEnvironment(force);
  });
}
