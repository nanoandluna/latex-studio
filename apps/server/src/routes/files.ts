import type { FastifyInstance, FastifyReply } from 'fastify';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { workspaceService } from '../services/workspaceService.js';
import { projectIndexService } from '../services/projectIndexService.js';
import { safeResolve } from '../utils/paths.js';
import { toErrorPayload } from '../errors.js';

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
};

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

  /** Binary-safe read for image/pdf preview. Path jailed via safeResolve. */
  app.get('/api/file/raw', async (req, reply) => {
    const root = workspaceService.requireWorkspace();
    const { path: rel } = req.query as { path?: string };
    if (!rel) return reply.code(400).send({ error: 'Missing path' });
    try {
      const abs = safeResolve(root, rel);
      const ext = path.extname(rel).toLowerCase();
      const mime = MIME_BY_EXT[ext];
      if (!mime) {
        return reply
          .code(415)
          .send({ error: { code: 'INVALID_FILE', message: `Unsupported raw file type: ${ext || '(none)'}` } });
      }
      const buf = await fs.readFile(abs);
      return reply
        .header('Content-Type', mime)
        .header('Cache-Control', 'no-store')
        .send(buf);
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
      // Saved content is now the disk truth — drop any editor buffer copy so
      // the project index refreshes from disk.
      projectIndexService.dropBuffer(rel);
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
      projectIndexService.dropBuffer(rel);
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
      projectIndexService.dropBuffer(from);
      projectIndexService.dropBuffer(to);
      return { ok: true };
    } catch (err) {
      return handleFileError(reply, err);
    }
  });
}

function handleFileError(reply: FastifyReply, err: unknown) {
  const payload = toErrorPayload(err);
  return reply.code(payload.statusCode).send({ error: payload.error });
}
