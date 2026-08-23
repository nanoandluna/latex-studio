import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectSources } from '../src/compiler/runner.js';

describe('collectSources (recursive \\input/\\include resolution)', () => {
  let ws: string;

  beforeAll(async () => {
    ws = await fs.mkdtemp(path.join(os.tmpdir(), 'lstudio-sources-'));
    await fs.mkdir(path.join(ws, 'sections'), { recursive: true });
    await fs.writeFile(
      path.join(ws, 'main.tex'),
      ['\\documentclass{article}', '\\begin{document}', '\\input{sections/content}', '\\include{sections/backmatter}', '\\end{document}'].join('\n')
    );
    await fs.writeFile(
      path.join(ws, 'sections', 'content.tex'),
      ['Cites \\cite{smith2025}.', '\\input{nested}', ''].join('\n')
    );
    // nested relative to the INCLUDING file's directory
    await fs.writeFile(path.join(ws, 'sections', 'nested.tex'), 'nested content\n');
    await fs.writeFile(
      path.join(ws, 'sections', 'backmatter.tex'),
      '\\bibliographystyle{plain}\n\\bibliography{refs}\n'
    );
    await fs.writeFile(path.join(ws, 'refs.bib'), '@article{x2020, title={X}}\n');
  });

  afterAll(async () => {
    await fs.rm(ws, { recursive: true, force: true });
  });

  it('collects main + all reachable sub-files', async () => {
    const combined = await collectSources(ws, 'main.tex');
    expect(combined).toContain('\\documentclass');
    expect(combined).toContain('smith2025');
    expect(combined).toContain('nested content');
    expect(combined).toContain('\\bibliography{refs}');
  });

  it('detects bibliography directive that lives only in a sub-file', async () => {
    const combined = await collectSources(ws, 'main.tex');
    expect(/\\(?:no)?bibliography\s*\{/.test(combined)).toBe(true);
  });

  it('does not follow .. escapes or absolute paths in \\input', async () => {
    const ws2 = await fs.mkdtemp(path.join(os.tmpdir(), 'lstudio-escape-'));
    try {
      await fs.writeFile(path.join(ws2, 'main.tex'), '\\input{../../outside}\n');
      const combined = await collectSources(ws2, 'main.tex');
      expect(combined).not.toContain('secret');
      // main file itself is always included
      expect(combined).toContain('\\input{../../outside}');
    } finally {
      await fs.rm(ws2, { recursive: true, force: true });
    }
  });

  it('handles missing includes gracefully', async () => {
    const ws3 = await fs.mkdtemp(path.join(os.tmpdir(), 'lstudio-missing-'));
    try {
      await fs.writeFile(path.join(ws3, 'main.tex'), '\\input{does-not-exist}\ntext\n');
      const combined = await collectSources(ws3, 'main.tex');
      expect(combined).toContain('text');
    } finally {
      await fs.rm(ws3, { recursive: true, force: true });
    }
  });

  it('terminates on circular includes', async () => {
    const ws4 = await fs.mkdtemp(path.join(os.tmpdir(), 'lstudio-cycle-'));
    try {
      await fs.writeFile(path.join(ws4, 'a.tex'), 'A\\input{b}');
      await fs.writeFile(path.join(ws4, 'b.tex'), 'B\\input{a}');
      const combined = await collectSources(ws4, 'a.tex');
      expect(combined).toContain('A');
      expect(combined).toContain('B');
    } finally {
      await fs.rm(ws4, { recursive: true, force: true });
    }
  });
});
