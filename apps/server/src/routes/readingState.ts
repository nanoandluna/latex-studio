import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { safeResolve } from '../utils/paths.js';
import { workspaceService } from '../services/workspaceService.js';

/**
 * V0.5-PLAN 3 — reading position. One JSON file per workspace at
 * <ws>/.latex-studio/cache/reading-state.json, mapping mainFile → page.
 * Losing it is harmless: worst case the reader reopens at page 1.
 */

const FILE = () => {
  const root = workspaceService.requireWorkspace();
  return safeResolve(root, path.join('.latex-studio', 'cache', 'reading-state.json'));
};

type ReadingState = Record<string, number>;

async function readAll(): Promise<ReadingState> {
  try {
    const raw = await fs.readFile(FILE(), 'utf8');
    const parsed = JSON.parse(raw) as ReadingState;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function registerReadingStateRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/reading-state', async () => readAll());

  app.put('/api/reading-state', async (req, reply) => {
    const body = (req.body ?? {}) as { mainFile?: string; page?: number };
    const mainFile = typeof body.mainFile === 'string' ? body.mainFile : '';
    const page = Number(body.page);
    if (!mainFile || !Number.isInteger(page) || page < 1 || page > 100_000) {
      return reply
        .code(400)
        .send({ error: { code: 'INVALID_ARGUMENT', message: 'mainFile and integer page required' } });
    }
    const all = await readAll();
    all[mainFile] = page;
    await fs.mkdir(path.dirname(FILE()), { recursive: true });
    await fs.writeFile(FILE(), `${JSON.stringify(all, null, 2)}\n`, 'utf8');
    return { ok: true };
  });
}
