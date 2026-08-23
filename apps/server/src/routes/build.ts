import type { FastifyInstance } from 'fastify';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { workspaceService } from '../services/workspaceService.js';
import { compilerService } from '../services/compilerService.js';
import { safeResolve } from '../utils/paths.js';
import { ApiError, isPathTraversalError, toErrorPayload } from '../errors.js';
import { BUILD_DIR_NAME } from '../services/compilerService.js';
import { SyncTexService } from '../compiler/synctexService.js';
import type { BuildOptions, CompilerChoice } from '@latex-studio/shared';

const VALID_COMPILERS: CompilerChoice[] = ['auto', 'latexmk', 'xelatex', 'pdflatex', 'lualatex'];

const synctex = new SyncTexService();

export async function registerBuildRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/build', async (req, reply) => {
    const root = workspaceService.requireWorkspace();
    const body = (req.body ?? {}) as Partial<BuildOptions>;
    const mainFile = body.mainFile;
    const compiler = (body.compiler ?? 'xelatex') as CompilerChoice;

    if (!mainFile || typeof mainFile !== 'string') {
      return sendError(reply, new ApiError('INVALID_ARGUMENT', 'Missing mainFile'));
    }
    if (!VALID_COMPILERS.includes(compiler)) {
      return sendError(
        reply,
        new ApiError('INVALID_ARGUMENT', `Invalid compiler: ${compiler}`)
      );
    }

    // Validate mainFile exists inside workspace and is a .tex file
    try {
      const abs = safeResolve(root, mainFile);
      const stat = await fs.stat(abs);
      if (!stat.isFile() || !mainFile.endsWith('.tex')) {
        return sendError(reply, new ApiError('INVALID_FILE', `mainFile is not a .tex file: ${mainFile}`));
      }
    } catch (err) {
      if (isPathTraversalError(err)) {
        return sendError(reply, err);
      }
      return sendError(reply, new ApiError('WORKSPACE_NOT_FOUND', `mainFile not found in workspace: ${mainFile}`, 404));
    }

    const record = await compilerService.build(root, { mainFile, compiler });
    return record;
  });

  app.get('/api/build/latest', async () => {
    return compilerService.getLatestBuild() ?? null;
  });

  app.get('/api/build/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const rec = compilerService.getBuild(id);
    if (!rec) {
      return sendError(reply, new ApiError('FILE_NOT_FOUND', `Unknown build: ${id}`));
    }
    return rec;
  });

  app.post('/api/build/:id/cancel', async (req) => {
    const { id } = req.params as { id: string };
    return { ok: await compilerService.cancel(id) };
  });

  app.get('/api/build/:id/log', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return { log: await compilerService.getLogTail(id) };
    } catch {
      return sendError(reply, new ApiError('FILE_NOT_FOUND', `Unknown build: ${id}`));
    }
  });

  app.get('/api/build/:id/pdf', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const pdfPath = await compilerService.getPdfPath(id);
      const buf = await fs.readFile(pdfPath);
      // Sanity check: never serve a non-PDF payload as application/pdf
      if (buf.length < 5 || buf.subarray(0, 5).toString('ascii') !== '%PDF-') {
        return sendError(reply, new ApiError('BUILD_FAILED', 'Build output is not a valid PDF'));
      }
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Cache-Control', 'no-store')
        .send(buf);
    } catch (err) {
      // getPdfPath throws typed ApiError (FILE_NOT_FOUND / BUILD_FAILED);
      // fs failures fall through to the generic FILE_NOT_FOUND branch of
      // toErrorPayload — no paths are echoed either way.
      return sendError(reply, err);
    }
  });

  app.post('/api/synctex/forward', async (req, reply) => {
    const root = workspaceService.requireWorkspace();
    const body = (req.body ?? {}) as {
      buildId?: string;
      file?: string;
      line?: number;
      column?: number;
    };
    if (!body.file || !body.line) {
      return sendError(reply, new ApiError('INVALID_ARGUMENT', 'Missing file or line'));
    }
    const rec = body.buildId
      ? compilerService.getBuild(body.buildId)
      : compilerService.getLatestBuild();
    if (!rec || !rec.pdfAvailable) {
      return sendError(reply, new ApiError('BUILD_FAILED', 'No successful build available for SyncTeX'));
    }
    try {
      // Validate first, then pass the RESOLVED path downstream — never the
      // raw client-supplied string.
      const abs = safeResolve(root, body.file);
      const result = await synctex.forwardSearch(
        root,
        path.join(root, BUILD_DIR_NAME),
        rec.mainFile,
        abs,
        body.line,
        body.column ?? 0
      );
      if (!result) {
        return sendError(reply, new ApiError('INTERNAL_ERROR', 'SyncTeX unavailable or no mapping found', 404));
      }
      return result;
    } catch (err) {
      return sendError(reply, err);
    }
  });
}

function sendError(reply: import('fastify').FastifyReply, err: unknown) {
  const payload = toErrorPayload(err);
  return reply.code(payload.statusCode).send({ error: payload.error });
}
