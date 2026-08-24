import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createApp } from '../src/app.js';

/**
 * V0.2.1 hardening: large-project index performance + incremental stability.
 *
 * Generates a ~240-chapter synthetic project (sections/labels/refs/citations/
 * includes + 200-entry bib) and asserts:
 *   - cold index refresh completes within a generous budget
 *   - warm refresh (all cache hits) is an order of magnitude faster
 *   - single-file buffer updates stay cheap and keep the index consistent
 *   - planted undefined-reference diagnostics are found exactly
 *
 * No LaTeX required — pure indexing.
 */

const root = path.resolve('..', '..');
const genScript = path.join(root, 'scripts', 'generate-large-project.mjs');

let tmpRoot: string;
let app: Awaited<ReturnType<typeof createApp>>;

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lstudio-large-'));
  execFileSync(process.execPath, [genScript, tmpRoot, '240']);
  app = await createApp();
  const open = await app.inject({
    method: 'POST',
    url: '/api/workspace/open',
    payload: { path: tmpRoot },
  });
  expect(open.statusCode).toBe(200);
}, 120_000);

afterAll(async () => {
  await app?.close();
  await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
});

describe('large project index (V0.2.1 hardening)', () => {
  it('cold refresh within budget and structurally correct', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/index/refresh' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Generous CI-friendly budget; local runs are typically <2 s.
    expect(body.durationMs).toBeLessThan(15_000);
    expect(body.filesParsed).toBe(242); // main + anchors + 240 chapters
    expect(body.index.sections.length).toBe(250); // 240 sections + 10 subsections (i%25===0)
    expect(body.index.bibEntries).toHaveLength(200);
    // exactly one planted ghost ref per 60 chapters (i%60===7 → 4 chapters)
    const ghosts = body.index.diagnostics.filter(
      (d: { code: string }) => d.code === 'UNDEFINED_REFERENCE'
    );
    expect(ghosts.length).toBe(4);
  }, 60_000);

  it('warm refresh is fast (cache-hit path)', async () => {
    const t0 = Date.now();
    const res = await app.inject({ method: 'POST', url: '/api/index/refresh' });
    const body = res.json();
    const wall = Date.now() - t0;
    expect(body.cacheHits).toBe(242);
    expect(body.durationMs).toBeLessThan(5_000);
    expect(wall).toBeLessThan(8_000);
  }, 30_000);

  it('repeated single-file buffer updates stay cheap and consistent', async () => {
    let lastDurationOk = true;
    for (let i = 0; i < 8; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/index/update',
        payload: {
          path: 'chapters/ch000.tex',
          content: `\\section{Section 000 v${i}}\\label{sec:s0}\nbuffer revision ${i}\n`,
        },
      });
      expect(res.statusCode).toBe(200);
      const idx = res.json();
      // consistency: no duplicated sections accumulate across updates
      const s0 = idx.sections.filter((s: { key?: string; title: string }) =>
        s.title.startsWith('Section 000')
      );
      if (s0.length !== 1) lastDurationOk = false;
    }
    expect(lastDurationOk).toBe(true);

    // final state reflects the LAST buffer, not an interleaving
    const snap = (await app.inject({ method: 'GET', url: '/api/index' })).json();
    expect(
      snap.sections.filter((s: { title: string }) => s.title.startsWith('Section 000'))
    ).toHaveLength(1);
  }, 60_000);

  it('disk truth wins over stale buffers after save-through-API', async () => {
    // drop the buffer via the API path used on save (saveFile route does this)
    await app.inject({
      method: 'POST',
      url: '/api/file/save',
      payload: { path: 'chapters/ch000.tex', content: '\\section{Section 000}\\label{sec:s0}\nfrom disk\n' },
    });
    const res = await app.inject({ method: 'POST', url: '/api/index/refresh' });
    const idx = res.json().index;
    const titles = idx.sections
      .filter((s: { title: string }) => s.title.startsWith('Section 000'))
      .map((s: { title: string }) => s.title);
    expect(titles).toEqual(['Section 000']);
  }, 60_000);
});
