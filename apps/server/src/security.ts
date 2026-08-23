import { randomBytes } from 'node:crypto';
import os from 'node:os';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Local-instance security.
 *
 * Threat model (single-user, loopback-only server):
 *  - CSRF: any web page in the user's browser can fire requests at
 *    http://localhost:<port>. Mitigations below make such requests unreadable
 *    and unauthenticated.
 *  - DNS rebinding: an attacker page whose hostname re-resolves to 127.0.0.1
 *    is rejected by the Host allow-list before any handler runs.
 *
 * Layers:
 *  1. Host allow-list (always on) — kills DNS rebinding.
 *  2. Origin allow-list when an Origin header is present (always on).
 *  3. Instance token (prod/dev; skipped under NODE_ENV=test so fastify-inject
 *     integration tests keep exercising business logic unchanged):
 *     requests must carry the token via the `lstudio_token` HttpOnly cookie
 *     (set on every same-origin HTML/asset response) or the
 *     `x-latex-studio-token` header (obtained from GET /api/auth/token).
 */

export const INSTANCE_TOKEN_COOKIE = 'lstudio_token';
export const INSTANCE_TOKEN_HEADER = 'x-latex-studio-token';

export function createInstanceToken(): string {
  return randomBytes(24).toString('hex');
}

function stripPort(host: string): string {
  if (host.startsWith('[')) {
    // IPv6 form [::1]:3210
    const end = host.indexOf(']');
    return end === -1 ? host : host.slice(1, end);
  }
  return host.split(':')[0];
}

export function isAllowedHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const host = stripPort(hostHeader.trim().toLowerCase());
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    host === '::1' ||
    host === '::ffff:127.0.0.1' ||
    host === os.hostname().toLowerCase()
  );
}

function isAllowedOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    if (!isAllowedHost(u.host)) return false;
    // Vite dev server ports
    if (/:(5173|5174)$/.test(u.host)) return true;
    return true; // host already validated — any port on a local host is us
  } catch {
    return false;
  }
}

function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

export interface SecurityOptions {
  /** Auth layer on/off. Off only for automated tests (NODE_ENV=test). */
  enforceAuth: boolean;
  token: string;
}

function reject(reply: FastifyReply, status: 401 | 403, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

export function registerSecurity(
  app: FastifyInstance,
  options: SecurityOptions
): void {
  const { enforceAuth, token } = options;

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    // ---- 1) DNS-rebinding / Host validation -------------------------------
    if (!isAllowedHost(req.headers.host)) {
      reject(reply, 403, 'FORBIDDEN', 'Request Host is not allowed');
      return reply;
    }

    const url = req.url;

    // ---- 2) Origin validation (when the browser sends one) ----------------
    const origin = req.headers.origin;
    if (origin && !isAllowedOrigin(origin)) {
      reject(reply, 403, 'FORBIDDEN', 'Request Origin is not allowed');
      return reply;
    }

    if (!url.startsWith('/api/')) {
      // Same-origin page loads carry the instance token as an HttpOnly cookie
      // so subsequent same-origin fetches authenticate automatically.
      if (req.method === 'GET') {
        reply.header(
          'Set-Cookie',
          `${INSTANCE_TOKEN_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`
        );
      }
      return;
    }

    // Token bootstrap endpoint: returns the token to same-origin scripts only
    // (CORS never reflects foreign origins, and foreign hosts fail check #1).
    if (url.startsWith('/api/auth/token')) {
      return;
    }

    // ---- 3) Instance-token authentication ---------------------------------
    if (!enforceAuth) return;

    const cookieToken = readCookie(req.headers.cookie, INSTANCE_TOKEN_COOKIE);
    const headerToken = req.headers[INSTANCE_TOKEN_HEADER];
    const provided =
      (cookieToken && cookieToken === token) ||
      (typeof headerToken === 'string' && headerToken === token);
    if (!provided) {
      reject(
        reply,
        401,
        'UNAUTHORIZED',
        'Missing or invalid instance session. Reload the app to obtain a new session.'
      );
      return reply;
    }
  });
}
