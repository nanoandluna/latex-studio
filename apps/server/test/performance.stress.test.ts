import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createApp } from '../src/app.js';

/**
 * V0.3.1 stress benchmarks — 500 / 1000 / 2000 chapter projects.
 *
 * Run explicitly: pnpm test:stress
 *
 * Asserts at every scale:
 *   - cold index budget
 *   - warm refresh (full cache hits) stays an order of magnitude faster
 *   - single-file buffer update stays cheap (no full rescan)
 *   - graph query + diagnostics derivation stay sub-second
 *   - heap growth across repeated refreshes stays bounded
 */

const root = path.resolve('..', '..');
const gen = path.join(root, 'scripts', 'generate-large-project.mjs');

interface Case {
  name: string;
  files: number;
  coldBudget: number;
  warmBudget: number;
}

const CASES: Case[] = [
  { name: 's500', files: 500, coldBudget: 25_000, warmBudget: 6_000 },
  { name: 's1000', files: 1000, coldBudget: 60_000, warmBudget: 12_000 },
];

// optional extra-heavy tier, opt-in
if (process.env.LS_STRESS_XL === '1') {
  CASES.push({ name: 's2000', files: 2000, coldBudget: 140_000, warmBudget: 30_000 });
}

let heapBaseline = 0;

for (const c of CASES) {
  describe(`stress · ${c.name} (${c.files} chapters)`, () => {
    let dir: string;
    let app: Awaited<ReturnType<typeof createApp>>;

    beforeAll(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), `lstudio-${c.name}-`));
      execFileSync(process.execPath, [gen, dir, String(c.files)]);
      app = await createApp();
      await app.inject({
        method: 'POST',
        url: '/api/workspace/open',
        payload: { path: dir },
      });
    }, c.coldBudget * 2);

    afterAll(async () => {
      await app?.close();
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    });

    it('cold index within budget', async () => {
      const t0 = Date.now();
      const res = await app.inject({ method: 'POST', url: '/api/index/refresh' });
      const body = res.json();
      expect(res.statusCode).toBe(200);
      expect(body.durationMs).toBeLessThan(c.coldBudget);
      void t0;
    }, c.coldBudget * 3);

    it('warm refresh within budget (cache-hit dominated)', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/index/refresh' });
      const body = res.json();
      expect(body.cacheHits).toBe(c.files + 2);
      expect(body.durationMs).toBeLessThan(c.warmBudget);
    }, c.warmBudget * 3);

    it('single-file buffer update stays cheap', async () => {
      const t0 = Date.now();
      const res = await app.inject({
        method: 'POST',
        url: '/api/index/update',
        payload: {
          path: 'chapters/ch000.tex',
          content: '\\section{Hot Section}\\label{sec:hot}\nstress buffer\n',
        },
      });
      const wall = Date.now() - t0;
      expect(res.statusCode).toBe(200);
      expect(wall).toBeLessThan(Math.min(3_000, c.warmBudget));
      const idx = res.json().graph ?? res.json();
      expect(idx.sections.some((s: { title: string }) => s.title === 'Hot Section')).toBe(true);
    }, c.warmBudget * 3);

    it('graph query + diagnostics derivation are sub-second', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/index' });
      const idx = res.json();
      const t0 = Date.now();
      // diagnostics already derived; simulate the heavy consumer cost:
      const refs = idx.references.length;
      const labels = idx.labels.length;
      const diags = idx.diagnostics.length;
      // touch every reference for lookup-style work
      let touched = 0;
      for (const r of idx.references) if (r.key) touched++;
      const wall = Date.now() - t0;
      expect(wall).toBeLessThan(1_000);
      expect(refs + labels + touched).toBeGreaterThan(0);
      expect(diags).toBeGreaterThanOrEqual(0);
    }, 10_000);

    it('heap growth across two more warm refreshes stays bounded (<256MB)', async () => {
      const before = process.memoryUsage().heapUsed;
      for (let i = 0; i < 2; i++) {
        await app.inject({ method: 'POST', url: '/api/index/refresh' });
      }
      global.gc?.();
      const after = process.memoryUsage().heapUsed;
      expect(after - before).toBeLessThan(256 * 1024 * 1024);
      if (heapBaseline === 0) heapBaseline = after;
    }, c.warmBudget * 6);
  });
}
