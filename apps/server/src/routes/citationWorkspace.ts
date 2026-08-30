import type { FastifyInstance } from 'fastify';
import { buildCitationWorkspace } from '../services/citationWorkspace.js';

/**
 * V0.5-PLAN 2 — Citation Workspace. A pure read over the Project Graph
 * snapshot (usages + bib metadata); the only extra reads are cached file
 * contents for the one-line usage context.
 */
export async function registerCitationWorkspaceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/paper/citations', async () => buildCitationWorkspace());
}
