import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

/**
 * V0.5 Paper Overview — counts must be exact and deterministic: structure,
 * content, assets, references (including the undefined ones) and per-chapter
 * attribution of citations and figures.
 */

let ws: string;
let app: Awaited<ReturnType<typeof createApp>>;

beforeAll(async () => {
  ws = await fs.mkdtemp(path.join(os.tmpdir(), 'lstudio-v05-overview-'));
  await fs.writeFile(
    path.join(ws, 'main.tex'),
    [
      '\\documentclass{book}',
      '\\begin{document}',
      '\\chapter{Intro}',
      '这是第一章。Some latin words here.',
      'See \\ref{fig:one} and \\cite{smith2025} and \\cite{ghostKey}.',
      '\\begin{figure}[h]\\caption{One}\\label{fig:one}\\end{figure}',
      '\\chapter{Method}',
      '第二章内容。\\cite{smith2025}',
      '\\section{Details}',
      '细节。\\ref{no:such:label}',
      '\\end{document}',
      '',
    ].join('\n')
  );
  await fs.writeFile(
    path.join(ws, 'refs.bib'),
    ['@article{smith2025, title={T}, author={A}, year={2025}}', ''].join('\n')
  );

  app = await createApp();
  await app.inject({ method: 'POST', url: '/api/workspace/open', payload: { path: ws } });
});

afterAll(async () => {
  await app?.close();
  await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
});

describe('paper overview', () => {
  let overview: Awaited<ReturnType<typeof loadOverview>>;

  async function loadOverview() {
    const res = await app.inject({ method: 'GET', url: '/api/paper/overview' });
    expect(res.statusCode).toBe(200);
    return res.json() as import('@latex-studio/shared').PaperOverview;
  }

  beforeAll(async () => {
    overview = await loadOverview();
  });

  it('reports exact structure, content and asset counts', () => {
    expect(overview.structure).toEqual({ chapters: 2, sections: 3 });
    expect(overview.assets).toEqual({ figures: 1, tables: 0, equations: 0 });
    expect(overview.content.cjkCharacters).toBeGreaterThan(0);
    expect(overview.content.latinWords).toBeGreaterThan(0);
  });

  it('counts references and flags the undefined ones by distinct key', () => {
    expect(overview.references.citations).toBe(3); // ghostKey, smith2025, smith2025
    expect(overview.references.bibEntries).toBe(1);
    expect(overview.references.undefinedCitations).toBe(1); // ghostKey
    expect(overview.references.undefinedReferences).toBe(1); // no:such:label
  });

  it('attributes citations and figures to the right chapters', () => {
    expect(overview.chapters).toHaveLength(2);
    const [intro, method] = overview.chapters;
    expect(intro.title).toBe('Intro');
    expect(intro.citations).toBe(2); // smith2025 + ghostKey
    expect(intro.figures).toBe(1);
    expect(intro.cjkCharacters).toBeGreaterThan(0);
    expect(method.title).toBe('Method');
    expect(method.citations).toBe(1); // smith2025 again, counted in its own chapter
    expect(method.figures).toBe(0);
  });

  it('surfaces live index diagnostics counts', () => {
    // \ref{no:such:label} produces an undefined-reference warning
    expect(overview.diagnostics.warnings).toBeGreaterThanOrEqual(1);
    expect(overview.diagnostics.errors).toBe(0);
  });
});
