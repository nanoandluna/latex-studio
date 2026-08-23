import type { FastifyInstance } from 'fastify';

/**
 * Bootstrap endpoint for the instance token.
 *
 * Reachable WITHOUT the token itself, but protected by the global Host and
 * Origin allow-lists (see security.ts). Cross-origin pages can neither read
 * the response (CORS never reflects foreign origins) nor rebind the Host
 * (allow-list). Same-origin scripts — including the Vite dev server proxy —
 * use this to authenticate all subsequent /api/* calls.
 */
export async function registerAuthRoutes(
  app: FastifyInstance,
  token: string
): Promise<void> {
  app.get('/api/auth/token', async () => ({ token }));
}
