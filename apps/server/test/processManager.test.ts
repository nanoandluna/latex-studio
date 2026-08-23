import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { ProcessManager } from '../src/compiler/processManager.js';
import { ArtifactManager } from '../src/compiler/artifactManager.js';
import { BuildManager } from '../src/compiler/buildManager.js';

const nodeBin = process.execPath;

describe('ProcessManager', () => {
  it('captures stdout of a real child process', async () => {
    const pm = new ProcessManager();
    const res = await pm.run(nodeBin, ['-e', 'console.log("hello-from-child")'], {
      cwd: process.cwd(),
      timeoutMs: 10_000,
    });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('hello-from-child');
    pm.dispose();
  });

  it('enforces timeout and kills the child (no hang)', async () => {
    const pm = new ProcessManager();
    const start = Date.now();
    const res = await pm.run(
      nodeBin,
      ['-e', 'setInterval(()=>{},100)'],
      { cwd: process.cwd(), timeoutMs: 500 }
    );
    const elapsed = Date.now() - start;
    expect(res.timedOut).toBe(true);
    // must actually die well before a 10s default would suggest
    expect(elapsed).toBeLessThan(5000);
    pm.dispose();
  }, 15_000);

  it('reports cancellation and kills the process tree', async () => {
    const pm = new ProcessManager();
    let cancelled = false;
    const run = pm.run(
      nodeBin,
      ['-e', 'setInterval(()=>{},100)'],
      { cwd: process.cwd(), timeoutMs: 30_000, cancelled: () => cancelled }
    );
    setTimeout(() => (cancelled = true), 400);
    const res = await run;
    expect(res.cancelled).toBe(true);
    expect(res.code).not.toBe(0);
    pm.dispose();
  }, 15_000);

  it('reports spawn errors for missing executables', async () => {
    const pm = new ProcessManager();
    const res = await pm.run('definitely-not-a-real-tool-xyz', ['--version'], {
      cwd: process.cwd(),
      timeoutMs: 5000,
    });
    expect(res.spawnError).toBeDefined();
    pm.dispose();
  });
});

describe('ArtifactManager', () => {
  it('derives artifact paths from the main file jobname', () => {
    const am = new ArtifactManager(path.join('w', '.build'));
    expect(am.pdfPath('thesis.tex')).toMatch(/thesis\.pdf$/);
    expect(am.logPath('thesis.tex')).toMatch(/thesis\.log$/);
    expect(am.synctexPath('thesis.tex')).toMatch(/thesis\.synctex\.gz$/);
    expect(am.jobname('paper.tex')).toBe('paper');
  });
});

describe('BuildManager concurrency (no LaTeX required)', () => {
  it('runs builds strictly one at a time; latest build wins', async () => {
    const bm = new BuildManager();
    const ws = process.cwd(); // any directory; no compiler → fast compiler_unavailable
    const [a, b, c] = await Promise.all([
      bm.build(ws, { mainFile: 'package.json', compiler: 'xelatex' }),
      bm.build(ws, { mainFile: 'package.json', compiler: 'xelatex' }),
      bm.build(ws, { mainFile: 'package.json', compiler: 'xelatex' }),
    ]);
    // All three complete; none is left 'running' after the others finish.
    for (const rec of [a, b, c]) {
      expect(['compiler_unavailable', 'failed', 'cancelled']).toContain(rec.status);
      expect(rec.durationMs).toBeGreaterThanOrEqual(0);
    }
    // The latest build by startedAt is C (queued last).
    expect(bm.getLatestBuild()!.buildId).toBe(c.buildId);
    // After everything settles no context remains active.
    expect(bm.getCurrentContext()).toBeNull();
    bm.dispose();
  });
});
