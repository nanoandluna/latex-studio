import Fastify from 'fastify';
import cors from '@fastify/cors';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PORT } from './config.js';
import { toErrorPayload } from './errors.js';
import { createInstanceToken, registerSecurity } from './security.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerIndexRoutes } from './routes/index.js';
import { registerTemplateRoutes } from './routes/templates.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerEnvRoutes } from './routes/env.js';
import { registerWorkspaceRoutes } from './routes/workspace.js';
import { registerFileRoutes } from './routes/files.js';
import { registerBuildRoutes } from './routes/build.js';

/** Origins allowed to read API responses cross-origin (dev server only). */
const DEV_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

export async function createApp() {
  const app = Fastify({
    logger: false,
    bodyLimit: 20 * 1024 * 1024,
  });

  const isTest = process.env.NODE_ENV === 'test';
  const instanceToken = createInstanceToken();

  // CORS: never reflect arbitrary origins.
  //  - no Origin header (curl / same-origin fetch) → no ACAO needed
  //  - production serves the UI same-origin → no ACAO needed
  //  - only the Vite dev server may read responses cross-origin
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || DEV_ORIGINS.has(origin)) return cb(null, true);
      return cb(null, false);
    },
  });

  registerSecurity(app, { enforceAuth: !isTest, token: instanceToken });

  app.setErrorHandler((err, _req, reply) => {
    const payload = toErrorPayload(err);
    reply.code(payload.statusCode).send({ error: payload.error });
  });

  await registerAuthRoutes(app, instanceToken);
  await registerIndexRoutes(app);
  await registerTemplateRoutes(app);
  await registerHealthRoutes(app);
  await registerEnvRoutes(app);
  await registerWorkspaceRoutes(app);
  await registerFileRoutes(app);
  await registerBuildRoutes(app);

  // In production (pnpm build + pnpm start), serve the built web app.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDist = path.resolve(here, '../../web/dist');
  const hasDist = await fs
    .access(path.join(webDist, 'index.html'))
    .then(() => true)
    .catch(() => false);

  if (hasDist) {
    const fastifyStatic = (await import('@fastify/static')).default;
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}

export async function startServer() {
  const app = await createApp();
  await app.listen({ port: PORT, host: '127.0.0.1' });
  console.log(`LaTeX Studio server running at http://localhost:${PORT}`);
  if (!process.env.VITE_DEV) {
    console.log('(Serving built web UI if present. Use `pnpm dev` for hot reload.)');
  }
  return app;
}
