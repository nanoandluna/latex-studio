import type { FastifyInstance } from 'fastify';
import { readTerms, writeTerms } from '../services/terminologyStore.js';
import { scanTerminology } from '../services/terminologyScan.js';
import type { TerminologyTerm } from '@latex-studio/shared';

/**
 * V0.5-PLAN 4 — terminology list CRUD and the rule-based consistency scan.
 * The list is user data in <ws>/.latex-studio/terminology.json; hits are
 * computed on demand over the indexer's content cache.
 */
export async function registerTerminologyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/paper/terminology', async () => ({ terms: await readTerms() }));

  app.put('/api/paper/terminology', async (req, reply) => {
    const body = (req.body ?? {}) as { terms?: TerminologyTerm[] };
    if (!Array.isArray(body.terms)) {
      return reply
        .code(400)
        .send({ error: { code: 'INVALID_ARGUMENT', message: 'terms[] required' } });
    }
    const saved = await writeTerms(body.terms);
    return { terms: saved };
  });

  app.get('/api/paper/terminology/hits', async () => scanTerminology());
}
