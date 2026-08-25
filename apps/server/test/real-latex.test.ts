import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BuildManager } from '../src/compiler/buildManager.js';
import { detectEnvironment } from '../src/compiler/detector.js';
import type { BuildRecord } from '@latex-studio/shared';
import type { EngineChoice } from '../src/compiler/config.js';

/**
 * Real LaTeX compilation tests — the V0.1.0 Release Gate core.
 *
 * Rules:
 *  - Default (`pnpm test`): skipped when no TeX is installed (plain dev).
 *  - `RUN_LATEX_TESTS=1`: the gate REQUIRES TeX. Without it the suite FAILS
 *    with "BLOCKED" — a SKIP must never masquerade as a gate PASS.
 *
 * Assertions verify true artifacts: PDF exists, size > 0, header `%PDF-`.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, '../../../tests/fixtures');

const env = detectEnvironment(true);
const availableEngines = ['xelatex', 'pdflatex', 'lualatex'].filter((e) =>
  env.tools.some((t) => t.id === e && t.available && !t.shellWrapperOnly)
);
const latexmk = env.tools.find((t) => t.id === 'latexmk');
const latexmkUsable = !!latexmk?.available && !latexmk?.shellWrapperOnly;
const bibtex = env.tools.some((t) => t.id === 'bibtex' && t.available);
const biber = env.tools.some((t) => t.id === 'biber' && t.available);

const RUN = process.env.RUN_LATEX_TESTS === '1';

// ---- §十七: no silent skip inside the release gate -------------------------
if (RUN && availableEngines.length === 0) {
  describe('Real LaTeX Release Gate', () => {
    it('✕ BLOCKED: TeX environment unavailable', () => {
      throw new Error(
        'BLOCKED: RUN_LATEX_TESTS=1 was set but no usable TeX engine (xelatex/pdflatex/lualatex) ' +
          'was found. Install TeX Live or MiKTeX, run `pnpm doctor`, and retry. ' +
          'The Release Gate cannot pass on skipped tests.'
      );
    });
  });
}

let manager: BuildManager;
beforeAll(() => {
  manager = new BuildManager();
});

function skipMessage(what: string): string {
  return `SKIPPED: ${what} not installed on this machine`;
}

/** §十六: full diagnostics when a real build fails unexpectedly. */
function failWithDiagnostics(label: string, rec: BuildRecord): never {
  const tool = env.tools.find((t) => t.available);
  throw new Error(
    [
      `Real LaTeX Test Failed: ${label}`,
      `Compiler      : ${rec.compiler}`,
      `Executable    : ${tool?.path ?? '(unknown)'}`,
      `Working dir   : ${rec.workspacePath}`,
      `Status        : ${rec.status}`,
      `Error code    : ${rec.errorCode ?? '-'}`,
      `stderr/message: ${rec.errorMessage ?? '-'}`,
      'Build log tail:',
      rec.logTail ?? '(none)',
      `See: ${path.join(rec.workspacePath, '.build')}`,
    ].join('\n')
  );
}

async function assertValidPdf(workspace: string, mainFile: string): Promise<void> {
  const pdfPath = path.join(workspace, '.build', mainFile.replace(/\.tex$/, '.pdf'));
  const stat = await fs.stat(pdfPath);
  expect(stat.size).toBeGreaterThan(0);
  const fd = await fs.open(pdfPath, 'r');
  try {
    const header = Buffer.alloc(5);
    await fd.read(header, 0, 5, 0);
    expect(header.toString('ascii')).toBe('%PDF-');
  } finally {
    await fd.close();
  }
}

/** Copy a fixture into a temp workspace so originals stay pristine. */
async function tempWorkspace(fixture: string, subdir?: string): Promise<string> {
  const src = subdir ? path.join(FIXTURES, fixture, subdir) : path.join(FIXTURES, fixture);
  const dest = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'lstudio-real-')), fixture);
  await fs.cp(src, dest, { recursive: true });
  return dest;
}

describe.skipIf(!RUN || availableEngines.length === 0)('real build: basic', () => {
  it('compiles with each available engine and emits a valid PDF', async () => {
    for (const engine of availableEngines.slice(0, RUN ? 3 : 1)) {
      const ws = await tempWorkspace('basic');
      const rec = await manager.build(ws, { mainFile: 'main.tex', compiler: engine as EngineChoice });
      if (rec.status !== 'success') failWithDiagnostics(`basic/${engine}`, rec);
      await assertValidPdf(ws, 'main.tex');
    }
    if (availableEngines.length === 0) console.warn(skipMessage('any engine'));
  }, 900_000);

  it.runIf(RUN && latexmkUsable)('compiles via latexmk', async () => {
    const ws = await tempWorkspace('basic');
    const rec = await manager.build(ws, { mainFile: 'main.tex', compiler: 'latexmk' });
    if (rec.status !== 'success') failWithDiagnostics('basic/latexmk', rec);
    await assertValidPdf(ws, 'main.tex');
  }, 900_000);
});
if (RUN && !latexmkUsable && availableEngines.length > 0) console.warn(skipMessage('latexmk'));

describe.skipIf(!RUN || !availableEngines.includes('xelatex'))('real build: chinese (ctexart)', () => {
  it('produces a valid PDF with Chinese content via XeLaTeX', async () => {
    const ws = await tempWorkspace('chinese');
    const rec = await manager.build(ws, { mainFile: 'main.tex', compiler: 'xelatex' });
    if (rec.status !== 'success') failWithDiagnostics('chinese/xelatex', rec);
    await assertValidPdf(ws, 'main.tex');
  }, 900_000);
});
if (!availableEngines.includes('xelatex')) console.warn(skipMessage('XeLaTeX (chinese fixture)'));

describe.skipIf(!RUN || availableEngines.length === 0)('real build: multi-file + image', () => {
  it('resolves \\input, \\include and \\includegraphics', async () => {
    const ws = await tempWorkspace('multi-file');
    const rec = await manager.build(ws, { mainFile: 'main.tex', compiler: availableEngines[0] as EngineChoice });
    if (rec.status !== 'success') failWithDiagnostics('multi-file', rec);
    await assertValidPdf(ws, 'main.tex');
  }, 900_000);

  it.runIf(RUN && availableEngines.length > 0)('image fixture renders includegraphics', async () => {
    const ws = await tempWorkspace('image');
    const rec = await manager.build(ws, { mainFile: 'main.tex', compiler: availableEngines[0] as EngineChoice });
    if (rec.status !== 'success') failWithDiagnostics('image', rec);
    await assertValidPdf(ws, 'main.tex');
  }, 900_000);
});

describe.skipIf(!RUN || availableEngines.length === 0 || !bibtex)('real build: bibliography (bibtex)', () => {
  it('runs xelatex → bibtex → reruns; citations resolve', async () => {
    const ws = await tempWorkspace('bibliography');
    const rec = await manager.build(ws, { mainFile: 'main.tex', compiler: availableEngines[0] as EngineChoice });
    if (rec.status !== 'success') failWithDiagnostics('bibliography/bibtex', rec);
    await assertValidPdf(ws, 'main.tex');
    // No undefined-citation warnings may survive a successful gated build.
    const cites = rec.problems.filter((p) => p.message.includes('smith2025'));
    expect(cites).toHaveLength(0);
  }, 900_000);
});
if (!bibtex) console.warn(skipMessage('BibTeX'));

describe.skipIf(!RUN || availableEngines.length === 0 || !bibtex)('real build: bibliography in sub-file', () => {
  it('detects \\bibliography declared inside an \\input-ed file', async () => {
    const ws = await tempWorkspace('multi-file-bib');
    const rec = await manager.build(ws, { mainFile: 'main.tex', compiler: availableEngines[0] as EngineChoice });
    if (rec.status !== 'success') failWithDiagnostics('multi-file-bib/bibtex', rec);
    await assertValidPdf(ws, 'main.tex');
    expect(rec.problems.filter((p) => p.message.includes('smith2025'))).toHaveLength(0);
  }, 900_000);
});

describe.skipIf(!RUN || availableEngines.length === 0 || !biber)('real build: bibliography (biber)', () => {
  it('runs biber for biblatex projects', async () => {
    const ws = await tempWorkspace('bibliography-biber');
    const rec = await manager.build(ws, { mainFile: 'main.tex', compiler: availableEngines[0] as EngineChoice });
    if (rec.status !== 'success') failWithDiagnostics('bibliography-biber/biber', rec);
    await assertValidPdf(ws, 'main.tex');
    expect(rec.problems.filter((p) => p.message.includes('smith2025'))).toHaveLength(0);
  }, 900_000);
});
if (!biber) console.warn(skipMessage('Biber'));

describe.skipIf(!RUN || availableEngines.length === 0)('real build: error fixture', () => {
  it('fails loudly, parses problems, and produces no PDF', async () => {
    const ws = await tempWorkspace('error');
    const rec = await manager.build(ws, { mainFile: 'main.tex', compiler: availableEngines[0] as EngineChoice });
    expect(['failed']).toContain(rec.status);
    expect(rec.errorCount).toBeGreaterThan(0);
    expect(rec.pdfAvailable).toBe(false);
    // §十二/§十三: no stale PDF may survive a failed rebuild
    await expect(fs.access(path.join(ws, '.build', 'main.pdf'))).rejects.toThrow();
    const err = rec.problems.find(
      (p) => p.severity === 'error' && p.message.includes('Undefined control sequence')
    );
    expect(err).toBeDefined();
    expect(err!.file).toBe('main.tex');
    expect(err!.line).toBeGreaterThan(0);
  }, 900_000);

  it('stale-PDF regression: success → broken source → failed build serves NO pdf', async () => {
    const ws = await tempWorkspace('basic');
    const ok = await manager.build(ws, { mainFile: 'main.tex', compiler: availableEngines[0] as EngineChoice });
    expect(ok.status).toBe('success');
    await assertValidPdf(ws, 'main.tex');

    // Break the source.
    await fs.writeFile(ws + '/main.tex', '\\documentclass{article}\n\\begin{document}\n\\undefinedcommand\n\\end{document}\n');
    const bad = await manager.build(ws, { mainFile: 'main.tex', compiler: availableEngines[0] as EngineChoice });
    expect(bad.status).toBe('failed');
    expect(bad.pdfAvailable).toBe(false);
    await expect(fs.access(path.join(ws, '.build', 'main.pdf'))).rejects.toThrow();
  }, 900_000);
});

describe.skipIf(!RUN || availableEngines.length === 0 || !biber)('real build: biblatex full workflow (V0.2.3)', () => {
  it('numeric style + autocite/textcite/parencite via biber', async () => {
    const ws = await tempWorkspace('biblatex');
    const rec = await manager.build(ws, { mainFile: 'main.tex', compiler: availableEngines[0] as EngineChoice });
    if (rec.status !== 'success') failWithDiagnostics('biblatex/biber', rec);
    await assertValidPdf(ws, 'main.tex');
    expect(rec.problems.filter((p) => p.message.includes('smith2025'))).toHaveLength(0);
  }, 900_000);
});

describe.skipIf(!RUN || availableEngines.length === 0 || !bibtex)('real build: IEEEtran class (V0.2.3)', () => {
  it('compiles the IEEE conference class with classic bibtex', async () => {
    const ws = await tempWorkspace('ieee');
    const rec = await manager.build(ws, { mainFile: 'main.tex', compiler: availableEngines[0] as EngineChoice });
    if (rec.status !== 'success') failWithDiagnostics('ieee/bibtex', rec);
    await assertValidPdf(ws, 'main.tex');
    expect(rec.problems.filter((p) => p.message.includes('smith2025'))).toHaveLength(0);
  }, 900_000);
});

describe.skipIf(!RUN || !availableEngines.includes('xelatex'))('real build: chinese thesis ctexbook (V0.2.3)', () => {
  it('compiles chapter-level 中文论文 with figure cross-reference', async () => {
    const ws = await tempWorkspace('chinese-thesis');
    const rec = await manager.build(ws, { mainFile: 'main.tex', compiler: 'xelatex' });
    if (rec.status !== 'success') failWithDiagnostics('chinese-thesis/xelatex', rec);
    await assertValidPdf(ws, 'main.tex');

    // V0.2 structure parser must capture chapter AND section levels here.
    const { parseStructure } = await import('@latex-studio/latex-parser');
    const mainSrc = await fs.readFile(path.join(ws, 'main.tex'), 'utf8');
    const levels = parseStructure(mainSrc, 'main.tex').map((s) => s.level);
    expect(levels).toContain(1); // \chapter
    expect(levels).toContain(2); // \section
  }, 900_000);
});

describe.skipIf(!RUN || availableEngines.length === 0)('synctex stability loop (V0.2.3)', () => {
  it('repeated forward searches against one build return consistent pages', async () => {
    const ws = await tempWorkspace('multi-file');
    // one successful build to anchor all subsequent queries
    const setup = await manager.build(ws, { mainFile: 'main.tex', compiler: availableEngines[0] as EngineChoice });
    if (setup.status !== 'success') failWithDiagnostics('multi-file/setup', setup);

    const { SyncTexService } = await import('../src/compiler/synctexService.js');
    const svc = new SyncTexService();
    const results: number[] = [];
    for (let i = 0; i < 5; i++) {
      const hit = await svc.forwardSearch(
        ws,
        path.join(ws, '.build'),
        'main.tex',
        path.join(ws, 'sections', 'method.tex'),
        1
      );
      if (!hit) throw new Error(`forward search #${i + 1} returned null`);
      results.push(hit.page);
    }
    expect(new Set(results).size).toBe(1); // deterministic mapping
    expect(results[0]).toBeGreaterThan(0);
    svc.dispose();
  }, 300_000);
});

describe.skipIf(!RUN || availableEngines.length === 0)('real build: unicode path + spaces', () => {
  it('compiles inside 科研项目 我的论文/', async () => {
    const ws = await tempWorkspace('unicode-path', '科研项目 我的论文');
    const rec = await manager.build(ws, { mainFile: 'main.tex', compiler: availableEngines[0] as EngineChoice });
    if (rec.status !== 'success') failWithDiagnostics('unicode-path', rec);
    await assertValidPdf(ws, 'main.tex');
  }, 900_000);
});

describe.skipIf(!RUN || availableEngines.length === 0)('real build: beamer', () => {
  it('compiles a presentation class', async () => {
    const ws = await tempWorkspace('beamer');
    const rec = await manager.build(ws, { mainFile: 'main.tex', compiler: availableEngines[0] as EngineChoice });
    if (rec.status !== 'success') failWithDiagnostics('beamer', rec);
    await assertValidPdf(ws, 'main.tex');
  }, 900_000);
});

describe.skipIf(!RUN || availableEngines.length === 0)('real build: large PDF (V0.2.1)', () => {
  it('builds a ~120-page document and the PDF reports its page count', async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'lstudio-bigpdf-'));
    // \newpage ×120 keeps compile fast while producing a genuinely large PDF
    const body = Array.from({ length: 120 }, (_, i) => `Page ${i + 1}\\newpage`).join('\n');
    await fs.writeFile(
      path.join(ws, 'big.tex'),
      `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`
    );
    const rec = await manager.build(ws, { mainFile: 'big.tex', compiler: availableEngines[0] as EngineChoice });
    if (rec.status !== 'success') failWithDiagnostics('large-pdf', rec);

    const pdfPath = path.join(ws, '.build', 'big.pdf');
    const stat = await fs.stat(pdfPath);
    expect(stat.size).toBeGreaterThan(10_000); // non-trivial artifact

    // Authoritative page count via the same PDF.js the previewer uses.
    const pdfjs = await import('pdfjs-dist');
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(await fs.readFile(pdfPath)),
      useWorkerFetch: false,
      isEvalSupported: false,
    }).promise;
    expect(doc.numPages).toBeGreaterThanOrEqual(100);
    void doc.destroy();
  }, 900_000);
});
