import Fastify from 'fastify';
import cors from '@fastify/cors';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PORT } from './config.js';
import { toErrorPayload } from './errors.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerEnvRoutes } from './routes/env.js';
import { registerWorkspaceRoutes } from './routes/workspace.js';
import { registerFileRoutes } from './routes/files.js';
import { registerBuildRoutes } from './routes/build.js';

export async function createApp() {
  const app = Fastify({
    logger: false,
    bodyLimit: 20 * 1024 * 1024,
  });

  await app.register(cors, { origin: true });

  app.setErrorHandler((err, _req, reply) => {
    const payload = toErrorPayload(err);
    reply.code(payload.statusCode).send({ error: payload.error });
  });

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
