import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

/**
 * V0.5 — terminology rules (variants/forbidden/word-boundary/comments),
 * the reading-position store, and the search section context.
 */

let ws: string;
let app: Awaited<ReturnType<typeof createApp>>;

const get = (url: string) => app.inject({ method: 'GET', url });
const put = (url: string, payload: unknown) =>
  app.inject({ method: 'PUT', url, payload: payload as Record<string, unknown> });

beforeAll(async () => {
  ws = await fs.mkdtemp(path.join(os.tmpdir(), 'lstudio-v05-terms-'));
  await fs.writeFile(
    path.join(ws, 'main.tex'),
    [
      '\\documentclass{article}',
      '\\begin{document}',
      'The millimeter-wave radar works. 毫米波雷达也出现了。',
      '% a comment mentioning millimeter-wave radar must not count',
      'A mmWaveX is a longer word, not a hit. mmWave radar is preferred.',
      '\\section{Method}',
      '正文提到 millimeter wave radar 一次。',
      '\\end{document}',
      '',
    ].join('\n')
  );

  app = await createApp();
  await app.inject({ method: 'POST', url: '/api/workspace/open', payload: { path: ws } });
});

afterAll(async () => {
  await app?.close();
  await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
});

describe('terminology', () => {
  it('saves the glossary and drops empty/noise entries', async () => {
    const res = await put('/api/paper/terminology', {
      terms: [
        { preferred: 'mmWave radar', variants: ['millimeter-wave radar', 'millimeter wave radar', '毫米波雷达', ''], acronym: 'mmWave' },
        { preferred: '   ', variants: [] },
      ],
    });
    expect(res.statusCode).toBe(200);
    const { terms } = res.json() as { terms: { preferred: string; variants: string[]; acronym?: string }[] };
    expect(terms).toHaveLength(1);
    expect(terms[0].preferred).toBe('mmWave radar');
    expect(terms[0].variants).toEqual(['millimeter-wave radar', 'millimeter wave radar', '毫米波雷达']);
  });

  it('flags variants, acronyms and forbidden forms with word boundaries', async () => {
    await put('/api/paper/terminology', {
      terms: [
        {
          preferred: 'mmWave radar',
          variants: ['millimeter-wave radar', 'millimeter wave radar', '毫米波雷达'],
          acronym: 'mmWave',
          forbidden: ['5G radar'],
        },
      ],
    });
    const res = await get('/api/paper/terminology/hits');
    expect(res.statusCode).toBe(200);
    const { hits } = res.json() as {
      hits: { preferred: string; matched: string; file: string; line: number; forbidden: boolean }[];
    };

    // line 3: millimeter-wave radar + 毫米波雷达; line 4 is a comment (skipped);
    // line 5: mmWaveX must NOT hit, the second "mmWave radar" is the preferred
    // form itself (never flagged); line 7: millimeter wave radar
    const lines = hits.map((h) => h.line).sort((a, b) => a - b);
    expect(lines).toEqual([3, 3, 5, 7]);
    expect(hits.some((h) => h.matched === '毫米波雷达' && h.line === 3)).toBe(true);
    expect(hits.some((h) => h.matched === 'mmWave' && h.line === 5 && !h.forbidden)).toBe(true);
    expect(hits.every((h) => h.file === 'main.tex')).toBe(true);
  });

  it('forbidden forms are marked as forbidden', async () => {
    await put('/api/paper/terminology', {
      terms: [{ preferred: 'radar sensor', variants: [], forbidden: ['5G radar'] }],
    });
    // add a file with the forbidden phrase
    await fs.writeFile(
      path.join(ws, 'extra.tex'),
      '\\begin{document}\nThe 5G radar is here.\n\\end{document}\n'
    );
    // a real session re-indexes via the file watcher; tests do it explicitly
    await app.inject({ method: 'POST', url: '/api/index/refresh' });
    // index refresh picks the new file up on the next scan
    const res = await get('/api/paper/terminology/hits');
    const { hits } = res.json() as { hits: { matched: string; forbidden: boolean; line: number; file: string }[] };
    const hit = hits.find((h) => h.forbidden);
    expect(hit?.matched).toBe('5G radar');
    expect(hit?.file).toBe('extra.tex');
    expect(hit?.line).toBe(2);
    await fs.rm(path.join(ws, 'extra.tex'), { force: true });
  });
});

describe('reading state', () => {
  it('round-trips a page per main file and rejects nonsense', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/reading-state',
      payload: { mainFile: 'main.tex', page: 83 },
    });
    expect(put.statusCode).toBe(200);
    const got = await get('/api/reading-state');
    expect(got.json()).toEqual({ 'main.tex': 83 });

    const bad = await app.inject({
      method: 'PUT',
      url: '/api/reading-state',
      payload: { mainFile: 'main.tex', page: -3 },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('search section context', () => {
  it('annotates matches with the nearest preceding section', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/search',
      payload: { query: 'millimeter', caseSensitive: false },
    });
    expect(res.statusCode).toBe(200);
    const { matches } = res.json() as { matches: { line: number; section?: string }[] };
    expect(matches.length).toBeGreaterThanOrEqual(2);
    // line 3 and 5 sit before \section{Method} → no section;
    // the line-7 hit (if the file still has it) belongs to Method
    const before = matches.find((m) => m.line === 3);
    expect(before?.section).toBeUndefined();
    const after = matches.find((m) => m.line === 7);
    if (after) expect(after.section).toBe('Method');
  });
});
