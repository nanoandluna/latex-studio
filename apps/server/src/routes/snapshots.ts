import type { FastifyInstance } from 'fastify';
import { snapshotService } from '../services/snapshotService.js';
import { projectIndexService } from '../services/projectIndexService.js';
import { toErrorPayload } from '../errors.js';
import type { SnapshotReason } from '@latex-studio/shared';

const VALID_REASONS: string[] = [
  'manual',
  'auto',
  'build-ok',
  'pre-replace',
  'pre-restore',
  'before-import',
];

/**
 * Snapshot ids are store-generated ([a-z0-9-]); anything else is rejected here
 * so a crafted `:id` never reaches the filesystem layer.
 */
const SNAPSHOT_ID_RE = /^snap_[0-9]{14}_[a-z0-9]{1,8}$/;

function badId(id: string) {
  return { error: { code: 'INVALID_ARGUMENT', message: `Malformed snapshot id: ${id}` } };
}

/**
 * Thin HTTP layer over SnapshotService — no filesystem logic lives here.
 */
export async function registerSnapshotRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/workspace/snapshots', async (req, reply) => {
    const body = (req.body ?? {}) as { reason?: string; label?: string };
    const reason = (VALID_REASONS as string[]).includes(body.reason ?? '')
      ? (body.reason as SnapshotReason)
      : 'manual';

    try {
      const { manifest, skipped } = await snapshotService.create(reason, body.label);
      return reply.code(skipped ? 200 : 201).send({ ...manifest, skipped });
    } catch (err) {
      const { error, statusCode } = toErrorPayload(err);
      return reply.code(statusCode).send({ error });
    }
  });

  app.get('/api/workspace/snapshots', async () => {
    return snapshotService.list();
  });

  app.get('/api/workspace/snapshots/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!SNAPSHOT_ID_RE.test(id)) return reply.code(400).send(badId(id));
    const m = await snapshotService.get(id);
    if (!m) {
      return reply
        .code(404)
        .send({ error: { code: 'FILE_NOT_FOUND', message: `Unknown snapshot: ${id}` } });
    }
    return m;
  });

  /** Per-file change list (status + inline content for the diff viewer). */
  app.get('/api/workspace/snapshots/:id/diff', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!SNAPSHOT_ID_RE.test(id)) return reply.code(400).send(badId(id));
    try {
      const entries = await snapshotService.diffAgainstWorkspace(id);
      return { snapshotId: id, entries };
    } catch (err) {
      const { error, statusCode } = toErrorPayload(err);
      return reply.code(statusCode).send({ error });
    }
  });

  /** Single file pair for the Monaco DiffEditor. */
  app.get('/api/workspace/snapshots/:id/diff/file', async (req, reply) => {
    const { id, path: rel } = req.query as { id: string; path?: string };
    if (!SNAPSHOT_ID_RE.test(id)) return reply.code(400).send(badId(id));
    if (!rel) {
      return reply
        .code(400)
        .send({ error: { code: 'INVALID_ARGUMENT', message: 'Missing path' } });
    }
    try {
      const pair = await snapshotService.diffFile(id, rel);
      if (!pair) {
        return reply
          .code(404)
          .send({ error: { code: 'FILE_NOT_FOUND', message: `Unreadable: ${rel}` } });
      }
      return { snapshotId: id, path: rel, ...pair };
    } catch (err) {
      const { error, statusCode } = toErrorPayload(err);
      return reply.code(statusCode).send({ error });
    }
  });

  /**
   * Restore. Omitting `files` restores the whole snapshot; passing a subset
   * restores just those paths (the removal pass only ever runs for a full
   * restore, so a partial restore can never delete unrelated work).
   */
  app.post('/api/workspace/snapshots/:id/restore', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!SNAPSHOT_ID_RE.test(id)) return reply.code(400).send(badId(id));
    const body = (req.body ?? {}) as { files?: string[] };
    try {
      const result = await snapshotService.restore(id, { files: body.files });
      // disk truth changed under us — rebuild the index for the UI
      await projectIndexService.refresh().catch(() => {});
      return reply.code(200).send({ ok: result.failed.length === 0, ...result });
    } catch (err) {
      const { error, statusCode } = toErrorPayload(err);
      return reply.code(statusCode).send({ error });
    }
  });

  app.delete('/api/workspace/snapshots/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!SNAPSHOT_ID_RE.test(id)) return reply.code(400).send(badId(id));
    const deleted = await snapshotService.delete(id);
    if (!deleted) {
      return reply
        .code(404)
        .send({ error: { code: 'FILE_NOT_FOUND', message: 'Not found' } });
    }
    return { ok: true };
  });
}
