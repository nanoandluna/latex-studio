import type { FastifyInstance } from 'fastify';
import { workspaceService } from '../services/workspaceService.js';
import { isPathTraversalError, toErrorPayload } from '../errors.js';

export async function registerFileRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/file/read', async (req, reply) => {
    const { path: rel } = req.query as { path?: string };
    if (!rel) return reply.code(400).send({ error: 'Missing path' });
    try {
      return { path: rel, content: await workspaceService.readFile(rel) };
    } catch (err) {
      return handleFileError(reply, err);
    }
  });

  app.post('/api/file/save', async (req, reply) => {
    const { path: rel, content } = (req.body ?? {}) as { path?: string; content?: string };
    if (!rel || typeof content !== 'string') {
      return reply.code(400).send({ error: 'Missing path or content' });
    }
    try {
      await workspaceService.saveFile(rel, content);
      return { ok: true };
    } catch (err) {
      return handleFileError(reply, err);
    }
  });

  app.post('/api/file/create', async (req, reply) => {
    const { path: rel, type, content } = (req.body ?? {}) as {
      path?: string;
      type?: 'file' | 'directory';
      content?: string;
    };
    if (!rel) return reply.code(400).send({ error: 'Missing path' });
    try {
      if (type === 'directory') {
        await workspaceService.createDirectory(rel);
      } else {
        await workspaceService.createFile(rel, content ?? '');
      }
      return { ok: true };
    } catch (err) {
      return handleFileError(reply, err);
    }
  });

  app.post('/api/file/delete', async (req, reply) => {
    const { path: rel } = (req.body ?? {}) as { path?: string };
    if (!rel) return reply.code(400).send({ error: 'Missing path' });
    try {
      await workspaceService.deleteEntry(rel);
      return { ok: true };
    } catch (err) {
      return handleFileError(reply, err);
    }
  });

  app.post('/api/file/rename', async (req, reply) => {
    const { from, to } = (req.body ?? {}) as { from?: string; to?: string };
    if (!from || !to) return reply.code(400).send({ error: 'Missing from/to' });
    try {
      await workspaceService.renameEntry(from, to);
      return { ok: true };
    } catch (err) {
      return handleFileError(reply, err);
    }
  });
}

function handleFileError(reply: import('fastify').FastifyReply, err: unknown) {
  const payload = toErrorPayload(err);
  return reply.code(payload.statusCode).send({ error: payload.error });
}
