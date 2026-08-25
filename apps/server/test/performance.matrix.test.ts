import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createApp } from '../src/app.js';

/**
 * V0.3 performance matrix — small / medium / large / stress.
 *
 * Proves the core V0.3 invariant: a single-file change must NOT trigger a
 * full-project re-parse (warm refresh stays cheap at every size).
 *
 * stress (1000 files) runs only with LS_STRESS=1 to keep default suites fast.
 */

const root = path.resolve('..', '..');
const gen = path.join(root, 'scripts', 'generate-large-project.mjs');

interface Case {
  name: string;
  files: number;
  coldBudget: number;
  warmBudget: number;
  skip?: boolean;
}

const CASES: Case[] = [
  { name: 'small', files: 20, coldBudget: 5_000, warmBudget: 2_000 },
  { name: 'medium', files: 100, coldBudget: 8_000, warmBudget: 2_500 },
  { name: 'large', files: 240, coldBudget: 15_000, warmBudget: 4_000 },
  {
    name: 'stress',
    files: 1000,
    coldBudget: 60_000,
    warmBudget: 12_000,
    skip: process.env.LS_STRESS !== '1',
  },
];

for (const c of CASES) {
  describe.skipIf(c.skip)(`perf matrix · ${c.name} (${c.files} chapters)`, () => {
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
    }, 120_000);

    afterAll(async () => {
      await app?.close();
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    });

    it('cold index within budget', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/index/refresh' });
      const body = res.json();
      expect(body.filesParsed).toBe(c.files + 2); // main + anchors
      expect(body.durationMs).toBeLessThan(c.coldBudget);
    }, c.coldBudget * 3);

    it('warm index within budget', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/index/refresh' });
      const body = res.json();
      expect(body.cacheHits).toBe(c.files + 2);
      expect(body.durationMs).toBeLessThan(c.warmBudget);
    }, c.warmBudget * 3);

    it('single-file buffer update does not rescan everything', async () => {
      const t0 = Date.now();
      const res = await app.inject({
        method: 'POST',
        url: '/api/index/update',
        payload: {
          path: c.files > 1 ? 'chapters/ch000.tex' : 'chapters/ch001.tex',
          content:
            '\\section{Hot Section}\\label{sec:hot}\nhot buffer content\n',
        },
      });
      const wall = Date.now() - t0;
      expect(res.statusCode).toBe(200);
      // incremental: must stay far below even the warm full-refresh budget
      expect(wall).toBeLessThan(Math.min(2_500, c.warmBudget));
      const body3 = res.json();
      const idx = body3.graph ?? body3;
      if (!idx?.sections) {
        console.error('[dbg] update response keys:', Object.keys(body3), 'status', res.statusCode);
      }
      expect(idx.sections.some((s: { title: string }) => s.title === 'Hot Section')).toBe(true);
    }, 10_000);
  });
}
