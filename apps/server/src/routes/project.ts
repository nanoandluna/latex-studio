import type { FastifyInstance } from 'fastify';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { workspaceService } from '../services/workspaceService.js';
import { snapshotService } from '../services/snapshotService.js';
import { projectIndexService } from '../services/projectIndexService.js';
import { safeResolve, safeRealpathInside } from '../utils/paths.js';
import { collectSourceFiles } from '../utils/walkWorkspace.js';
import { ApiError, toErrorPayload } from '../errors.js';
import type { ProjectImportResult } from '@latex-studio/shared';

/** Compressed payload ceiling. The uncompressed ceiling is enforced below. */
const MAX_IMPORT_BYTES = 200 * 1024 * 1024;
/** Zip-bomb guard: total extracted size must stay under this. */
const MAX_EXTRACTED_BYTES = 512 * 1024 * 1024;
const MAX_ENTRIES = 5000;

/**
 * ZIP export/import for a project.
 *
 * Export walks the shared source-file set (build artifacts and the
 * `.latex-studio` metadata dir are excluded by construction) and keeps
 * dotfiles, since `.latexmkrc` is part of a project's reproducible build.
 *
 * Import treats every entry name as hostile: it is fed through `safeResolve`,
 * which rejects `..`, absolute paths, drive letters and UNC before anything is
 * written. A `before-import` snapshot is taken first, so a bad import is
 * always one restore away.
 */
export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {
  // The client posts the raw .zip bytes; Fastify needs to be told how to
  // buffer them, and the limit must be generous enough for real projects.
  app.addContentTypeParser(
    ['application/zip', 'application/octet-stream'],
    { parseAs: 'buffer', bodyLimit: MAX_IMPORT_BYTES },
    (_req, body, done) => done(null, body)
  );

  app.get('/api/project/export', async (_req, reply) => {
    const root = workspaceService.requireWorkspace();
    try {
      const files = await collectSourceFiles(root, { includeHidden: true });
      const zip = new JSZip();
      const prefix = workspaceService.workspaceName ?? 'project';

      for (const rel of files) {
        const buf = await fsp.readFile(safeResolve(root, rel));
        zip.file(`${prefix}/${rel}`, buf);
      }

      const nodeBuffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });

      const filename = `${prefix}.zip`.replace(/[^\w.-]+/g, '_');
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(nodeBuffer);
    } catch (err) {
      const { error, statusCode } = toErrorPayload(
        new ApiError('EXPORT_FAILED', (err as Error).message)
      );
      return reply.code(statusCode).send({ error });
    }
  });

  /**
   * Import a project zip. Refuses to merge into a non-empty workspace unless
   * `?merge=true` is passed explicitly, so "import" can never silently clobber
   * work in progress.
   */
  app.post('/api/project/import', async (req, reply) => {
    const root = workspaceService.requireWorkspace();
    const merge = (req.query as { merge?: string }).merge === 'true';

    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      return reply
        .code(400)
        .send({ error: { code: 'INVALID_ARCHIVE', message: 'Empty request body' } });
    }
    if (buf.length > MAX_IMPORT_BYTES) {
      return reply.code(413).send({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: `Archive exceeds ${Math.floor(MAX_IMPORT_BYTES / 1024 / 1024)}MB`,
        },
      });
    }

    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(buf);
    } catch {
      return reply
        .code(400)
        .send({ error: { code: 'INVALID_ARCHIVE', message: 'Not a readable zip archive' } });
    }

    const entries = Object.values(zip.files).filter((e) => !e.dir);
    if (entries.length === 0) {
      return reply
        .code(400)
        .send({ error: { code: 'INVALID_ARCHIVE', message: 'Archive contains no files' } });
    }
    if (entries.length > MAX_ENTRIES) {
      return reply.code(413).send({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: `Archive contains more than ${MAX_ENTRIES} files`,
        },
      });
    }

    const existing = await collectSourceFiles(root);
    if (existing.length > 0 && !merge) {
      return reply.code(409).send({
        error: {
          code: 'CONFLICT',
          message:
            'Workspace is not empty. Pass ?merge=true to overlay the archive onto it ' +
            '(existing files with the same path will be overwritten).',
        },
      });
    }

    // every write below is validated individually; this is the undo handle
    let snapshotId: string | null = null;
    try {
      const created = await snapshotService.create('before-import', 'before project import');
      snapshotId = created.manifest.snapshotId;
    } catch {
      // A failed safety net must not block an import into an empty workspace.
      if (existing.length > 0) {
        return reply.code(500).send({
          error: {
            code: 'SNAPSHOT_FAILED',
            message: 'Aborted import: could not snapshot the non-empty workspace first',
          },
        });
      }
    }

    const written: string[] = [];
    const rejected: { name: string; reason: string }[] = [];
    let extractedBytes = 0;
    const commonRoot = commonRootOf(entries.map((e) => e.name));

    projectIndexService.suspendWatcher();
    try {
      for (const entry of entries) {
        if (extractedBytes > MAX_EXTRACTED_BYTES) {
          throw new ApiError('PAYLOAD_TOO_LARGE', 'Archive expands beyond the size limit');
        }

        const data = await entry.async('nodebuffer');
        extractedBytes += data.length;

        const rel = stripCommonRoot(commonRoot, entry.name);
        if (!rel) {
          rejected.push({ name: entry.name, reason: 'empty path' });
          continue;
        }

        // never let an archive overwrite the snapshot store it just wrote to
        if (rel === '.latex-studio' || rel.startsWith('.latex-studio/')) {
          rejected.push({ name: entry.name, reason: 'internal metadata path' });
          continue;
        }

        let abs: string;
        try {
          abs = safeResolve(root, rel);
          const parent = path.dirname(abs);
          // If the parent already exists it may be a link pointing outside the
          // jail; a parent we are about to create cannot be, since safeResolve
          // has already pinned `abs` inside root.
          const parentExists = await fsp
            .stat(parent)
            .then(() => true)
            .catch(() => false);
          if (parentExists) await safeRealpathInside(root, parent);
        } catch (err) {
          rejected.push({ name: entry.name, reason: (err as Error).message });
          continue;
        }

        await fsp.mkdir(path.dirname(abs), { recursive: true });
        await fsp.writeFile(abs, data);
        written.push(rel);
      }
    } catch (err) {
      const { error, statusCode } = toErrorPayload(err);
      return reply.code(statusCode).send({
        error,
        ...({ writtenFiles: written.length, rejected, snapshotId } as object),
      });
    } finally {
      projectIndexService.resumeWatcher();
    }

    await projectIndexService.refresh().catch(() => {});

    const result: ProjectImportResult = {
      ok: rejected.length === 0,
      importedFiles: written.length,
      rejected,
      snapshotId,
    };
    return reply.code(200).send(result);
  });
}

/**
 * Zip archives usually wrap everything in one top-level folder. When every
 * entry shares the same first segment, drop it so the import lands at the
 * workspace root instead of nesting one level deeper.
 *
 * Computed once per archive and passed down — recomputing it per entry would
 * make a 5000-entry import quadratic for no reason.
 */
function commonRootOf(allNames: string[]): string {
  const normalized = allNames.map((n) => n.replace(/\\/g, '/').replace(/^\/+/, ''));
  const firsts = new Set(normalized.map((n) => n.split('/')[0]));
  if (firsts.size !== 1) return '';
  const candidate = [...firsts][0] ?? '';
  // a bare file at the root means there is no wrapper folder to strip
  const anyBareFile = normalized.some((n) => !n.includes('/'));
  return candidate && !anyBareFile ? candidate : '';
}

function stripCommonRoot(common: string, name: string): string | null {
  const posix = name.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!posix || posix.endsWith('/')) return null;
  const rel = common && posix.startsWith(common + '/') ? posix.slice(common.length + 1) : posix;
  return rel || null;
}
