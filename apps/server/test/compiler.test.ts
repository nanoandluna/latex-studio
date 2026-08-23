import { describe, it, expect, beforeAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { detectEnvironment } from '../src/compiler/detector.js';
import { CompilerService } from '../src/services/compilerService.js';

const env = detectEnvironment();
const canCompile = env.anyAvailable;

describe('environment detection', () => {
  it('reports rich tool info without throwing', () => {
    expect(Array.isArray(env.tools)).toBe(true);
    expect(env.tools.length).toBeGreaterThanOrEqual(4);
    for (const t of env.tools) {
      expect(typeof t.id).toBe('string');
      expect(typeof t.name).toBe('string');
      expect(t.platform).toBe(process.platform);
      if (!t.available) {
        expect(t.path).toBeNull();
      } else {
        // available tools must carry a resolvable path + version
        expect(t.path).toBeTruthy();
        expect(t.version).toBeTruthy();
        expect(t.shellWrapperOnly ?? false).toBe(false);
      }
    }
  });
});

describe('compiler service', () => {
  let tmpRoot: string;
  const service = new CompilerService();

  beforeAll(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lstudio-build-'));
  });

  it.runIf(canCompile)('builds a valid document successfully and emits a real PDF', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'main.tex'),
      '\\documentclass{article}\n\\begin{document}\nHello World\n\\end{document}\n'
    );
    const compiler = env.latexmkAvailable
      ? ('latexmk' as const)
      : (env.tools.find((t) => ['xelatex', 'pdflatex', 'lualatex'].includes(t.id) && t.available && !t.shellWrapperOnly)?.id as 'xelatex');
    const rec = await service.build(tmpRoot, { mainFile: 'main.tex', compiler });
    expect(rec.status).toBe('success');
    expect(rec.pdfAvailable).toBe(true);
    // Verify a real PDF artifact on disk, not just an API flag.
    const pdfPath = await service.getPdfPath(rec.buildId);
    const buf = await fs.readFile(pdfPath);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  }, 120_000);

  it.runIf(canCompile)('reports failure with parsed problems for a broken document', async () => {
    await fs.writeFile(
      path.join(tmpRoot, 'bad.tex'),
      '\\documentclass{article}\n\\begin{document}\n\\undefinedcommand\n\\end{document}\n'
    );
    const compiler = env.tools.find((t) => t.id === 'xelatex')?.available && !env.tools.find((t) => t.id === 'xelatex')?.shellWrapperOnly
      ? ('xelatex' as const)
      : (env.tools.find((t) => ['pdflatex', 'lualatex'].includes(t.id) && t.available && !t.shellWrapperOnly)?.id as 'pdflatex');
    const rec = await service.build(tmpRoot, { mainFile: 'bad.tex', compiler });
    expect(rec.status).toBe('failed');
    expect(rec.errorCount).toBeGreaterThan(0);
    expect(rec.pdfAvailable).toBe(false);
    // A failed rebuild must NOT leave a stale PDF from the previous success.
  }, 120_000);

  it.skipIf(canCompile)('returns compiler_unavailable when no LaTeX is installed', async () => {
    await fs.writeFile(path.join(tmpRoot, 'main.tex'), '\\documentclass{article}\n');
    const rec = await service.build(tmpRoot, { mainFile: 'main.tex', compiler: 'xelatex' });
    expect(rec.status).toBe('compiler_unavailable');
    expect(rec.errorCode).toBe('COMPILER_NOT_FOUND');
    expect(rec.pdfAvailable).toBe(false);
  });

  it('rejects unknown build ids', async () => {
    expect(service.getBuild('nope')).toBeUndefined();
  });
});
