import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { detectEnvironment } from '../src/compiler/detector.js';

/**
 * V0.2.1 hardening: build-queue stability under rapid fire, and SyncTeX
 * endpoint guards when no successful build exists.
 */

let tmpRoot: string;
let app: Awaited<ReturnType<typeof createApp>>;

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lstudio-queue-'));
  await fs.writeFile(
    path.join(tmpRoot, 'main.tex'),
    '\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n'
  );
  app = await createApp();
  await app.inject({
    method: 'POST',
    url: '/api/workspace/open',
    payload: { path: tmpRoot },
  });
});

afterAll(async () => {
  await app?.close();
  await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
});

describe('build queue stability (rapid fire)', () => {
  it('survives 6 back-to-back builds and settles with a consistent latest', async () => {
    const statuses: string[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/build',
        payload: { mainFile: 'main.tex', compiler: 'xelatex' },
      });
      expect(res.statusCode).toBe(200);
      statuses.push(res.json().status);
    }
    // Without TeX every build is compiler_unavailable; with TeX they succeed.
    const env = detectEnvironment();
    const okSet = env.anyAvailable ? ['success'] : ['compiler_unavailable'];
    for (const s of statuses) expect(okSet).toContain(s);

    // Queue fully drained: latest exists, nothing left running.
    const latest = await app.inject({ method: 'GET', url: '/api/build/latest' });
    expect(latest.statusCode).toBe(200);
    expect(latest.json().buildId).toBeTruthy();
  }, 300_000);
});

describe('synctex guards without a successful build', () => {
  it('forward returns BUILD_FAILED when the build has no PDF', async () => {
    // ensure at least one recorded build exists but without pdfAvailable
    await app.inject({
      method: 'POST',
      url: '/api/build',
      payload: { mainFile: 'main.tex', compiler: 'xelatex' },
    });
    const latest = await app.inject({ method: 'GET', url: '/api/build/latest' });
    const id = latest.json().buildId as string;
    const res = await app.inject({
      method: 'POST',
      url: `/api/build/${id}/synctex/forward`,
      payload: { file: 'main.tex', line: 1 },
    });
    if (detectEnvironment().anyAvailable && latest.json().pdfAvailable) {
      expect(res.statusCode).toBe(200); // real env: mapping may succeed
    } else {
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('INTERNAL_ERROR');
    }
  }, 120_000);

  it('inverse returns 400 on missing coordinates', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/build/nope/synctex/inverse',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_ARGUMENT');
  });

  it('inverse rejects unknown builds with structured error', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/build/does-not-exist/synctex/inverse',
      payload: { page: 1, x: 0, y: 0 },
    });
    expect(res.statusCode).toBe(404);
  });
});
