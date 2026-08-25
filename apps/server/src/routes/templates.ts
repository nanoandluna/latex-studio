import type { FastifyInstance, FastifyReply } from 'fastify';
import path from 'node:path';
import fs from 'node:fs';
import { listTemplates, instantiateTemplate } from '../services/templateService.js';
import { workspaceService } from '../services/workspaceService.js';

export async function registerTemplateRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/templates', async () => {
    return { templates: listTemplates() };
  });

  /**
   * Create a new project from a template package. The target directory must
   * not exist or must be empty; created files never overwrite.
   */
  app.post('/api/templates/create', async (req, reply) => {
    const { id, targetDir } = (req.body ?? {}) as { id?: string; targetDir?: string };
    if (!id || !targetDir || typeof targetDir !== 'string') {
      return reply.code(400).send({ error: { code: 'INVALID_ARGUMENT', message: 'Missing id or targetDir' } });
    }
    try {
      const abs = path.resolve(targetDir);
      // basic sanity: refuse filesystem roots
      if (path.dirname(abs) === abs) {
        return reply.code(400).send({ error: { code: 'INVALID_ARGUMENT', message: 'Refusing to use a filesystem root' } });
      }
      const result = instantiateTemplate(id, abs);
      if (!result) {
        return reply.code(404).send({ error: { code: 'FILE_NOT_FOUND', message: `Unknown template: ${id}` } });
      }
      // open it right away so the UX is Create → editing
      const opened = await workspaceService.open(abs);
      return {
        ok: true,
        path: opened.path,
        name: opened.name,
        mainFile: result.mainFile,
        written: result.written,
      };
    } catch (err) {
      const e = err as Error;
      if (/not empty/i.test(e.message)) {
        return reply.code(409).send({ error: { code: 'CONFLICT', message: e.message } });
      }
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: e.message } });
    }
  });
}

// keep fs import used for the existsSync re-export guard above
void fs;
