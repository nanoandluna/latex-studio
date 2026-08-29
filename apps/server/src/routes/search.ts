import type { FastifyInstance } from 'fastify';
import { promises as fsp } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { searchWorkspace, planReplace, PlanTimeoutError } from '../services/projectSearch.js';
import { safeResolve, safeRealpathInside } from '../utils/paths.js';
import { workspaceService } from '../services/workspaceService.js';
import { snapshotService } from '../services/snapshotService.js';
import { projectIndexService } from '../services/projectIndexService.js';
import { toErrorPayload } from '../errors.js';
import type {
  ReplaceApplyRequest,
  ReplaceApplyResponse,
  ReplacePreviewRequest,
  SearchOptions,
} from '@latex-studio/shared';

/** Wire shape: fields arrive as `any` from JSON, so they are validated here. */
type ReplaceBody = SearchOptions & { replacement?: string; confirmToken?: string };

/** How long a preview token stays valid, and how many may sit in memory. */
const PREVIEW_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_PREVIEWS = 200;
/** Ceiling for one cached plan (the new content of every file it touches). */
const MAX_PLAN_BYTES = 64 * 1024 * 1024;

type ReplacePlanInternal = {
  files: { file: string; content: string; count: number }[];
  total: number;
};

interface PendingPreview {
  fingerprint: string;
  expiresAt: number;
  /**
   * The plan computed at preview time, reused at apply time. Recomputing it
   * re-reads the whole project, which alone exceeded the Replace All budget;
   * and applying exactly what was previewed is the honest semantics anyway —
   * what the user confirmed is what gets written.
   */
  plan: ReplacePlanInternal | null;
  planBytes: number;
}

const pendingPreviews = new Map<string, PendingPreview>();

/**
 * Binds a token to the exact replace parameters it was issued for, so the
 * apply call cannot swap in a different query or target after previewing.
 */
function fingerprintOf(body: ReplaceBody): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        body.query ?? '',
        body.replacement ?? '',
        body.caseSensitive ? 1 : 0,
        body.wholeWord ? 1 : 0,
        body.regex ? 1 : 0,
        body.includeGlob ?? '',
        body.excludeGlob ?? '',
      ])
    )
    .digest('hex');
}

function issuePreviewToken(
  body: ReplaceBody,
  plan: ReplacePlanInternal | null,
  planBytes: number
): string {
  if (pendingPreviews.size >= MAX_PENDING_PREVIEWS) {
    const oldest = [...pendingPreviews.entries()].sort(
      (a, b) => a[1].expiresAt - b[1].expiresAt
    )[0];
    if (oldest) pendingPreviews.delete(oldest[0]);
  }
  const token = randomBytes(16).toString('hex');
  pendingPreviews.set(token, {
    fingerprint: fingerprintOf(body),
    expiresAt: Date.now() + PREVIEW_TTL_MS,
    plan,
    planBytes,
  });
  return token;
}

/**
 * Marks the token consumed (single use) and returns its cached plan, or null
 * when the token never had one.
 */
function consumePreviewToken(
  body: ReplaceBody
): { ok: true; plan: ReplacePlanInternal } | { ok: false } {
  const token = body.confirmToken;
  if (typeof token !== 'string' || !token) return { ok: false };
  const entry = pendingPreviews.get(token);
  if (!entry) return { ok: false };
  pendingPreviews.delete(token); // single use
  if (entry.expiresAt < Date.now()) return { ok: false };
  if (entry.fingerprint !== fingerprintOf(body)) return { ok: false };
  if (!entry.plan) return { ok: false };
  return { ok: true, plan: entry.plan };
}

function validateBody(body: ReplaceBody): string | null {
  if (!body.query) return 'Missing query';
  if (typeof body.replacement !== 'string') return 'Missing replacement';
  return null;
}

/**
 * Errors go through the shared envelope so internal messages and paths never
 * reach the client; only a timeout is spelled out, since the user can act on it.
 */
function sendError(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, err: unknown) {
  if (err instanceof PlanTimeoutError) {
    return reply
      .code(504)
      .send({ error: { code: 'SEARCH_TIMEOUT', message: err.message } });
  }
  const { error, statusCode } = toErrorPayload(err);
  return reply.code(statusCode).send({ error });
}

export async function registerSearchRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/search', async (req, reply) => {
    const root = workspaceService.requireWorkspace();
    const opts = (req.body ?? {}) as SearchOptions;
    if (!opts.query) {
      return reply
        .code(400)
        .send({ error: { code: 'INVALID_ARGUMENT', message: 'Missing query' } });
    }
    try {
      return await searchWorkspace(root, opts);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /** Preview replacement changes without writing; issues a confirm token. */
  app.post('/api/search/replace/preview', async (req, reply) => {
    const root = workspaceService.requireWorkspace();
    const body = (req.body ?? {}) as ReplaceBody;
    const invalid = validateBody(body);
    if (invalid) {
      return reply.code(400).send({ error: { code: 'INVALID_ARGUMENT', message: invalid } });
    }

    try {
      const plan = await planReplace(root, body as SearchOptions & { replacement: string });
      const planBytes = plan.files.reduce((n, f) => n + f.content.length, 0);
      // Plans above the memory ceiling are not cached; apply will recompute.
      const cacheable = planBytes <= MAX_PLAN_BYTES ? plan : null;
      return {
        confirmToken: issuePreviewToken(body, cacheable, planBytes),
        totalReplacements: plan.total,
        files: plan.files.map((f) => ({ file: f.file, replacements: f.count })),
      };
    } catch (err) {
      return sendError(reply, err);
    }
  });

  /**
   * Apply Replace All. Requires a token from a matching preview, writes every
   * changed file, and restores the original bytes if any write fails so the
   * project is never left half-replaced.
   */
  app.post('/api/search/replace/apply', async (req, reply) => {
    const root = workspaceService.requireWorkspace();
    const body = (req.body ?? {}) as ReplaceBody;
    const invalid = validateBody(body);
    if (invalid) {
      return reply.code(400).send({ error: { code: 'INVALID_ARGUMENT', message: invalid } });
    }
    const consumed = consumePreviewToken(body);
    if (!consumed.ok) {
      return reply.code(400).send({
        error: {
          code: 'CONFIRMATION_REQUIRED',
          message: 'Run a preview first and pass its confirmToken (tokens are single-use)',
        },
      });
    }

    // pre-replace safety snapshot — its failure aborts the write, since
    // replacing without a way back is exactly what this system exists to prevent
    let snapshotId: string;
    try {
      const created = await snapshotService.create('pre-replace', 'before replace all');
      snapshotId = created.manifest.snapshotId;
    } catch (err) {
      return reply.code(500).send({
        error: {
          code: 'SNAPSHOT_FAILED',
          message: `Aborted replace: pre-replace snapshot failed (${(err as Error).message})`,
        },
      });
    }

    // Apply exactly what was previewed (the token carries the plan). Only a
    // plan that exceeded the memory ceiling forces a recompute.
    let plan = consumed.plan;
    if (!plan) {
      try {
        plan = await planReplace(root, body as SearchOptions & { replacement: string });
      } catch (err) {
        return sendError(reply, err);
      }
    }

    // Write in parallel, watcher suspended (see SnapshotService.create for why).
    // allSettled (not all) so that when one write fails the others are allowed
    // to finish before the rollback runs — rolling back while sibling writes
    // are still in flight would race them.
    projectIndexService.suspendWatcher();
    let results: PromiseSettledResult<void>[];
    try {
      results = await Promise.allSettled(
        plan.files.map((f) => fsp.writeFile(safeResolve(root, f.file), f.content, 'utf8'))
      );
    } finally {
      projectIndexService.resumeWatcher();
    }
    const failures = results.filter((r) => r.status === 'rejected').length;

    if (failures > 0) {
      // The pre-replace snapshot holds every original byte, verified by hash
      // at creation — restoring from it is both the fastest and the most
      // faithful way back.
      try {
        const rollback = await snapshotService.restore(snapshotId);
        const unrolled = rollback.failed.filter(Boolean);
        return reply.code(500).send({
          error: {
            code: 'REPLACE_FAILED',
            message:
              unrolled.length === 0
                ? `Replace aborted after ${failures} failed write(s); all changes rolled back`
                : `Replace aborted after ${failures} failed write(s); ` +
                  `rollback could not restore: ${unrolled.slice(0, 10).join(', ')}` +
                  (unrolled.length > 10 ? ` (+${unrolled.length - 10} more)` : ''),
          },
        });
      } catch (rbErr) {
        return reply.code(500).send({
          error: {
            code: 'REPLACE_FAILED',
            message:
              `Replace aborted after ${failures} failed write(s); ` +
              `rollback failed (${(rbErr as Error).message}) — restore snapshot ${snapshotId} manually`,
          },
        });
      }
    }

    const appliedFiles = plan.files.length;

    // disk truth changed under us. The rebuild must not share the event loop
    // with this reply at all: refresh's parse pass over a thousand cached
    // buffers costs seconds of pure CPU, and every scheduler that runs it
    // "in the background" (setImmediate / nextTick) still executes before
    // light-my-request and the socket layer report the response done. A short
    // delay puts it firmly after the response, which is also what the watcher
    // path does with its 150ms debounce.
    setTimeout(() => {
      void projectIndexService.refresh().catch(() => {});
    }, 300);

    const response: ReplaceApplyResponse = {
      ok: true,
      filesModified: appliedFiles,
      totalReplacements: plan.total,
      snapshotId,
    };
    return response;
  });
}
