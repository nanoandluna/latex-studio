import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CompilerRunner, prepareIncludeDirectories } from '../src/compiler/runner.js';
import { ProcessManager, type SpawnOutcome } from '../src/compiler/processManager.js';

let root: string;
let buildDir: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'lstudio-compiler-v1-'));
  buildDir = path.join(root, '.build');
  await fs.mkdir(buildDir);
  await fs.writeFile(path.join(root, 'main.tex'), '\\documentclass{article}\n\\bibliography{refs}');
  await fs.writeFile(path.join(buildDir, 'main.pdf'), '%PDF-test');
  await fs.writeFile(path.join(buildDir, 'main.log'), 'No distribution-specific rerun warning');
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});
const outcome = (overrides: Partial<SpawnOutcome> = {}): SpawnOutcome => ({
  code: 0, signal: null, stdout: '', stderr: '', cancelled: false, timedOut: false, ...overrides,
});
const run = () => new CompilerRunner().runDirectEngine(root, buildDir, 'main.tex', 'xelatex', {
  engineCmd: 'xelatex', bibtex: 'bibtex',
}, { timeoutMs: 10000 });

it('runs both post-BibTeX passes even when the log has no rerun warning', async () => {
  const process = vi.spyOn(ProcessManager.prototype, 'run').mockResolvedValue(outcome());
  const result = await run();
  expect(result.success).toBe(true);
  expect(process.mock.calls.map(([command]) => command)).toEqual(['xelatex', 'bibtex', 'xelatex', 'xelatex']);
  expect(process.mock.calls[1][1]).toEqual(['main']);
  expect(process.mock.calls[1][2].cwd).toBe(buildDir);
  expect(process.mock.calls[1][2].env?.BIBINPUTS).toBe([root, globalThis.process.env.BIBINPUTS ?? ''].join(path.delimiter));
  expect(process.mock.calls[1][2].env?.BSTINPUTS).toBe([root, globalThis.process.env.BSTINPUTS ?? ''].join(path.delimiter));
  expect(result.steps.map((step) => step.tool)).toEqual(['xelatex', 'bibtex', 'xelatex', 'xelatex']);
});

it('reports bibliography failure instead of accepting a partial PDF', async () => {
  vi.spyOn(ProcessManager.prototype, 'run').mockImplementation(async (command) =>
    command === 'bibtex' ? outcome({ code: 2, stdout: 'Cannot open bibliography file' }) : outcome());
  const result = await run();
  expect(result.success).toBe(false);
  expect(result.steps).toHaveLength(2);
  expect(result.steps[1].stdoutTail).toContain('Cannot open bibliography file');
  expect(result.failureMessage).toContain('bibliography');
});

it('propagates bibliography cancellation and does not run another engine pass', async () => {
  const process = vi.spyOn(ProcessManager.prototype, 'run').mockImplementation(async (command) =>
    command === 'bibtex' ? outcome({ code: null, cancelled: true }) : outcome());
  const result = await run();
  expect(result.cancelled).toBe(true);
  expect(result.success).toBe(false);
  expect(process).toHaveBeenCalledTimes(2);
});

it('creates nested include auxiliary parents only inside the isolated build directory', async () => {
  await prepareIncludeDirectories(root, buildDir,
    '\\include{sections/deep/chapter}\n\\include{../escape/chapter}\n% \\include{commented/chapter}');
  expect((await fs.stat(path.join(buildDir, 'sections', 'deep'))).isDirectory()).toBe(true);
  expect(await fs.stat(path.join(root, 'escape')).catch(() => null)).toBeNull();
  expect(await fs.stat(path.join(buildDir, 'commented')).catch(() => null)).toBeNull();
});
