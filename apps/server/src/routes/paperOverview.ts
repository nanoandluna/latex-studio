import type { FastifyInstance } from 'fastify';
import { buildPaperOverview } from '../services/paperOverview.js';

/**
 * V0.5-PLAN 1 — Paper Overview. A pure read over the Project Graph snapshot
 * and the indexer's content cache; no new scan, no parameters.
 */
export async function registerPaperOverviewRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/paper/overview', async () => buildPaperOverview());
}
