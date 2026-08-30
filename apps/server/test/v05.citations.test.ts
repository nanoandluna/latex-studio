import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

/**
 * V0.5-PLAN 2 — Citation Workspace model. Counts must be exact, usage
 * locations must land in the right chapter/section, and the three anomaly
 * groups (unused / undefined / duplicate) must be flagged from the single
 * Project Graph source.
 */

let ws: string;
let app: Awaited<ReturnType<typeof createApp>>;

beforeAll(async () => {
  ws = await fs.mkdtemp(path.join(os.tmpdir(), 'lstudio-v05-citations-'));
  await fs.writeFile(
    path.join(ws, 'main.tex'),
    [
      '\\documentclass{book}',
      '\\begin{document}',
      '\\chapter{Intro}',
      '相关工作见~\\cite{smith2025} 与 \\cite{ghostKey}。',
      '\\chapter{Method}',
      '\\section{Details}',
      '又见~\\cite{smith2025}。',
      '\\end{document}',
      '',
    ].join('\n')
  );
  await fs.writeFile(
    path.join(ws, 'refs.bib'),
    [
      '@article{smith2025, title={Deep Learning}, author={Smith, Jane}, year={2025}}',
      '@book{unusedBook, title={Nobody Cites Me}, year={2020}}',
      '@misc{dupKey, title={First}}',
      '@misc{dupKey, title={Second}}',
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

interface CitationWorkspaceResponse {
  counts: { all: number; used: number; unused: number; undefined: number; duplicate: number };
  entries: {
    key: string;
    used: boolean;
    undefinedKey: boolean;
    duplicate: boolean;
    usageCount: number;
    author?: string;
    year?: string;
    bibFile?: string;
    bibLine?: number;
    firstUsage: { file: string; line: number; chapter?: string; section?: string; context: string } | null;
    usages: { file: string; line: number; chapter?: string; section?: string; context: string }[];
  }[];
}

async function load() {
  const res = await app.inject({ method: 'GET', url: '/api/paper/citations' });
  expect(res.statusCode).toBe(200);
  return res.json() as CitationWorkspaceResponse;
}

describe('citation workspace', () => {
  let data: CitationWorkspaceResponse;
  beforeAll(async () => {
    data = await load();
  });

  it('computes the five group counts exactly', () => {
    // keys: smith2025 (used), ghostKey (undefined), unusedBook (unused), dupKey (unused+duplicate)
    expect(data.counts).toEqual({ all: 4, used: 1, unused: 2, undefined: 1, duplicate: 1 });
  });

  it('carries bib metadata and flags duplicates from the single bib source', () => {
    const smith = data.entries.find((e) => e.key === 'smith2025');
    expect(smith?.author).toBe('Smith, Jane');
    expect(smith?.year).toBe('2025');
    expect(smith?.bibFile).toBe('refs.bib');
    expect(smith?.bibLine).toBe(1);
    expect(smith?.duplicate).toBe(false);

    const dup = data.entries.find((e) => e.key === 'dupKey');
    expect(dup?.duplicate).toBe(true);
    expect(dup?.usageCount).toBe(0);
  });

  it('places first usage in the right chapter/section with context', () => {
    const smith = data.entries.find((e) => e.key === 'smith2025');
    expect(smith?.usageCount).toBe(2);
    expect(smith?.firstUsage?.chapter).toBe('Intro');
    expect(smith?.firstUsage?.file).toBe('main.tex');
    expect(smith?.firstUsage?.line).toBe(4);
    expect(smith?.firstUsage?.context).toContain('cite{smith2025}');
    expect(smith?.firstUsage?.context).not.toContain('%'); // comments never leak into context
  });

  it('sorts cited entries by reading order and unused to the end', () => {
    const cited = data.entries.filter((e) => e.usageCount > 0);
    expect(cited.map((e) => e.key)).toEqual(['smith2025', 'ghostKey']);
    // ghostKey: undefined, cited in the Intro chapter
    const ghost = data.entries.find((e) => e.key === 'ghostKey');
    expect(ghost?.undefinedKey).toBe(true);
    expect(ghost?.firstUsage?.chapter).toBe('Intro');

    const tail = data.entries.slice(cited.length).map((e) => e.key);
    expect(tail).toContain('unusedBook');
    expect(tail).toContain('dupKey');
  });
});
