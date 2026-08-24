import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

let tmpRoot: string;
let app: Awaited<ReturnType<typeof createApp>>;

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lstudio-index-'));
  await fs.mkdir(path.join(tmpRoot, 'sections'), { recursive: true });
  await fs.writeFile(
    path.join(tmpRoot, 'main.tex'),
    [
      '\\documentclass{article}',
      '\\section{Intro}\\label{sec:intro}',
      '\\ref{sec:method}',
      '\\ref{ghost}',
      '\\cite{smith2025}',
      '\\cite{ghost2020}',
      '\\input{sections/method}',
      '\\includegraphics{figures/plot.png}',
      '% \\label{commented}',
    ].join('\n')
  );
  await fs.writeFile(
    path.join(tmpRoot, 'sections', 'method.tex'),
    ['\\section{Method}\\label{sec:method}', '\\label{sec:dup}', '\\label{sec:dup}'].join('\n')
  );
  await fs.writeFile(
    path.join(tmpRoot, 'refs.bib'),
    '@article{smith2025,\n  author = {Smith, Jane},\n  title = {T},\n  year = {2025},\n}\n'
  );
  app = await createApp();
  await app.inject({
    method: 'POST',
    url: '/api/workspace/open',
    payload: { path: tmpRoot },
  });
});

afterAll(async () => {
  await app.close();
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('GET /api/index', () => {
  let index: import('@latex-studio/shared').ProjectIndex;

  beforeAll(async () => {
    const res = await app.inject({ method: 'POST', url: '/api/index/refresh' });
    index = res.json().index;
  });

  it('aggregates sections across files', () => {
    const titles = index.sections.map((s) => `${s.file}::${s.title}`);
    expect(titles).toContain('main.tex::Intro');
    expect(titles).toContain('sections/method.tex::Method');
  });

  it('resolves include graph', () => {
    expect(index.includes).toContainEqual({
      from: 'main.tex',
      to: 'sections/method.tex',
      kind: 'input',
      line: 7,
    });
  });

  it('reports undefined references with locations', () => {
    const ghost = index.diagnostics.find(
      (d) => d.code === 'UNDEFINED_REFERENCE' && d.key === 'ghost'
    );
    expect(ghost).toMatchObject({ file: 'main.tex', line: 4, severity: 'warning' });
  });

  it('reports duplicate labels pointing at the second definition', () => {
    const dup = index.diagnostics.find((d) => d.code === 'DUPLICATE_LABEL');
    expect(dup).toMatchObject({ key: 'sec:dup', file: 'sections/method.tex' });
  });

  it('reports undefined citations but not resolved ones', () => {
    const codes = index.diagnostics.filter((d) => d.code === 'UNDEFINED_CITATION');
    expect(codes).toHaveLength(1);
    expect(codes[0]).toMatchObject({ key: 'ghost2020', line: 6 });
  });

  it('exposes bib entries with hover fields', () => {
    const entry = index.bibEntries.find((b) => b.key === 'smith2025');
    expect(entry?.author).toBe('Smith, Jane');
  });

  it('lists graphics candidates for present files only', () => {
    // figures/plot.png does not exist in this fixture → excluded
    expect(index.graphicsPaths).toHaveLength(0);
  });
});

describe('/api/file/raw', () => {
  it('serves a png with the right content type', async () => {
    // 1x1 valid-ish png header
    await fs.mkdir(path.join(tmpRoot, 'figures'), { recursive: true });
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
    ]);
    await fs.writeFile(path.join(tmpRoot, 'figures', 'plot.png'), png);
    const res = await app.inject({ method: 'GET', url: '/api/file/raw?path=figures/plot.png' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
  });

  it('rejects text extensions with 415', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/file/raw?path=main.tex' });
    expect(res.statusCode).toBe(415);
  });

  it.each(['../secret.png', 'C:/Windows/x.png', '/abs/x.png'])(
    'blocks traversal for %j (403)',
    async (p) => {
      const res = await app.inject({ method: 'GET', url: `/api/file/raw?path=${encodeURIComponent(p)}` });
      expect([403, 404]).toContain(res.statusCode);
      if (res.statusCode === 403) {
        expect(res.json().error.code).toBe('PATH_FORBIDDEN');
      }
    }
  );
});

describe('/api/index/update', () => {
  it('accepts buffer updates for jail-safe paths and ignores bad ones', async () => {
    let res = await app.inject({
      method: 'POST',
      url: '/api/index/update',
      payload: { path: 'main.tex', content: '\\section{FromBuffer}' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sections.some((s: { title: string }) => s.title === 'FromBuffer')).toBe(true);

    res = await app.inject({
      method: 'POST',
      url: '/api/index/update',
      payload: { path: '../outside.tex', content: '\\section{Evil}' },
    });
    expect(res.statusCode).toBe(200);
    // evil path must NOT appear
    expect(res.json().files).not.toContain('../outside.tex');
  });
});
