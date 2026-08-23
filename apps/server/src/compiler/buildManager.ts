import path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { BuildOptions, BuildRecord } from '@latex-studio/shared';
import type { Problem } from '@latex-studio/shared';
import { parseLatexLog } from '@latex-studio/latex-parser';
import { detectEnvironment, resolveCompilerChoice } from './detector.js';
import { CompilerRunner, type EngineId } from './runner.js';
import { ArtifactManager, LogCollector } from './artifactManager.js';
import { BUILD_DIR_NAME, BUILD_TIMEOUT_MS, type EngineChoice } from './config.js';

export interface BuildContext {
  buildId: string;
  workspace: string;
  mainFile: string;
  compiler: CompilerId;
  buildDir: string;
  startedAt: number;
  cancelled: boolean;
}

export type CompilerId = 'latexmk' | EngineChoice;

const ENGINES: Record<Exclude<CompilerId, 'latexmk'>, string> = {
  xelatex: 'xelatex',
  pdflatex: 'pdflatex',
  lualatex: 'lualatex',
};

/**
 * Manages the full lifecycle of builds:
 *   queued → starting → running → success|failed|cancelled|timeout|compiler_unavailable
 *
 * Single-flight: a new build cancels the in-flight one and waits for its
 * process tree to fully exit before starting (prevents Windows file locks
 * and "Build C finished, then stale Build A overwrites the PDF" races).
 */
export class BuildManager {
  /** Bounded build history — prevents unbounded memory growth in long sessions. */
  private static readonly MAX_BUILD_HISTORY = 20;

  private builds = new Map<string, BuildRecord>();
  private contexts = new Map<string, BuildContext>();
  private runner = new CompilerRunner();
  private current: BuildContext | null = null;
  private currentRecord: BuildRecord | null = null;
  private latestId: string | null = null;

  getBuild(buildId: string): BuildRecord | undefined {
    return this.builds.get(buildId);
  }

  getLatestBuild(): BuildRecord | undefined {
    return this.latestId ? this.builds.get(this.latestId) : undefined;
  }

  getCurrentContext(): BuildContext | null {
    return this.current;
  }

  async cancel(buildId: string): Promise<boolean> {
    if (this.current && this.current.buildId === buildId) {
      this.current.cancelled = true;
      this.runner.cancelActive();
      return true;
    }
    return false;
  }

  cancelAll(): void {
    if (this.current) this.current.cancelled = true;
    this.runner.cancelActive();
  }

  async build(workspacePath: string, options: BuildOptions): Promise<BuildRecord> {
    // Cancel any in-flight build and wait for the process tree to die.
    if (this.current) {
      this.current.cancelled = true;
      this.runner.cancelActive();
      const deadline = Date.now() + 10_000;
      while (this.current && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    const env = detectEnvironment();
    const resolved = resolveCompilerChoice(options.compiler, env);

    const buildId = `build_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
    const startedAt = Date.now();
    const buildDir = path.join(workspacePath, BUILD_DIR_NAME);

    const record: BuildRecord = {
      buildId,
      status: 'starting',
      durationMs: 0,
      pdfAvailable: false,
      problems: [],
      errorCount: 0,
      warningCount: 0,
      workspacePath,
      mainFile: options.mainFile,
      compiler: resolved?.compiler ?? 'xelatex',
      startedAt,
    };
    this.builds.set(buildId, record);
    this.latestId = buildId;
    // Prune oldest records (Map preserves insertion order); the newest build
    // is never pruned.
    while (this.builds.size > BuildManager.MAX_BUILD_HISTORY) {
      const oldest = this.builds.keys().next().value as string | undefined;
      if (oldest === undefined || oldest === buildId) break;
      this.builds.delete(oldest);
      this.contexts.delete(oldest);
    }

    const ctx: BuildContext = {
      buildId,
      workspace: workspacePath,
      mainFile: options.mainFile,
      compiler: record.compiler,
      buildDir,
      startedAt,
      cancelled: false,
    };
    this.contexts.set(buildId, ctx);
    this.current = ctx;
    this.currentRecord = record;

    try {
      if (!resolved) {
        record.status = 'compiler_unavailable';
        record.errorCode = 'COMPILER_NOT_FOUND';
        record.errorMessage =
          'No usable LaTeX compiler was found. Install TeX Live or MiKTeX and make sure xelatex/latexmk is on PATH.';
      } else {
        record.notice = resolved.notice;
        record.status = 'running';
        await this.executeBuild(ctx, record, env);
      }
    } catch (err) {
      if (ctx.cancelled) {
        record.status = 'cancelled';
      } else {
        record.status = 'failed';
        record.errorCode = 'INTERNAL_ERROR';
        record.errorMessage = (err as Error).message;
      }
    } finally {
      this.current = null;
      this.currentRecord = null;
      record.durationMs = Date.now() - startedAt;
    }

    await this.collectArtifacts(ctx, record);
    return record;
  }

  private async executeBuild(
    ctx: BuildContext,
    record: BuildRecord,
    env: ReturnType<typeof detectEnvironment>
  ): Promise<void> {
    const artifacts = new ArtifactManager(ctx.buildDir);
    await artifacts.ensureDir();
    // Critical: remove previous outputs so a failed rebuild can never
    // serve a stale PDF as if it were fresh.
    await artifacts.cleanStale(ctx.mainFile);

    const tool = (id: string) => env.tools.find((t) => t.id === id);
    const timeoutMs = BUILD_TIMEOUT_MS;
    const cancelled = () => ctx.cancelled;

    let result;
    // Always spawn the resolved ABSOLUTE path so compilation works even when
    // the TeX bin dir is not on PATH of this process.
    const exe = (id: string) => {
      const t = tool(id);
      if (!t?.available) return undefined;
      return t.path ?? t.command;
    };
    if (record.compiler === 'latexmk') {
      const latexmkExe = exe('latexmk');
      if (!latexmkExe) {
        record.status = 'compiler_unavailable';
        record.errorCode = 'COMPILER_NOT_FOUND';
        record.errorMessage = 'latexmk was selected but is not available';
        return;
      }
      result = await this.runner.runLatexmk(
        ctx.workspace,
        ctx.buildDir,
        ctx.mainFile,
        'xelatex',
        latexmkExe,
        { timeoutMs, cancelled }
      );
    } else {
      const engineCmd = exe(record.compiler);
      if (!engineCmd) {
        record.status = 'compiler_unavailable';
        record.errorCode = 'COMPILER_NOT_FOUND';
        record.errorMessage = `${record.compiler} is not available`;
        return;
      }
      result = await this.runner.runDirectEngine(ctx.workspace, ctx.buildDir, ctx.mainFile, record.compiler, {
        engineCmd,
        bibtex: exe('bibtex'),
        biber: exe('biber'),
      }, { timeoutMs, cancelled });
    }

    // Persist runner output into the record for the Output panel, with full
    // diagnostics on failure (compiler / command / cwd / exit / tails).
    const collector = new LogCollector();
    for (const step of result.steps) {
      collector.addLine(
        `[${new Date().toISOString().slice(11, 19)}] ${step.tool} ${step.ok ? '✓' : '✕'} (${(step.durationMs / 1000).toFixed(2)}s)`
      );
      if (!step.ok) {
        collector.addLine(`  command : ${step.command} ${step.args.join(' ')}`);
        collector.addLine(`  cwd     : ${step.cwd}`);
        collector.addLine(`  exit    : ${step.exitCode ?? 'n/a'}`);
        if (step.stderrTail.trim()) collector.addLine(`  stderr  : ${step.stderrTail.trim().slice(-1500)}`);
      }
    }
    record.logTail = collector.combined();

    if (ctx.cancelled) {
      record.status = 'cancelled';
      record.errorCode = 'BUILD_CANCELLED';
    } else if (result.timedOut) {
      record.status = 'timeout';
      record.errorCode = 'BUILD_TIMEOUT';
      record.errorMessage = `Build exceeded ${BUILD_TIMEOUT_MS / 1000}s and was terminated`;
    } else if (result.spawnError) {
      record.status = 'failed';
      record.errorCode = 'COMPILER_NOT_FOUND';
      record.errorMessage = `Failed to start '${record.compiler}': ${result.spawnError.message}`;
    } else {
      record.status = result.success ? 'success' : 'failed';
      if (!result.success) record.errorCode = 'BUILD_FAILED';
    }
  }

  private async collectArtifacts(ctx: BuildContext, record: BuildRecord): Promise<void> {
    const artifacts = new ArtifactManager(ctx.buildDir);
    try {
      let log: string | null = null;
      for (const name of [`${artifacts.jobname(ctx.mainFile)}.log`, 'main.log']) {
        log = await fs.readFile(path.join(ctx.buildDir, name), 'utf8').catch(() => null);
        if (log) break;
      }
      if (log) {
        const { problems }: { problems: Problem[] } = parseLatexLog(log);
        record.problems = problems;
      }
      record.pdfAvailable = record.status === 'success' && (await artifacts.pdfExists(ctx.mainFile));
      // §ReleaseGate: a failed/cancelled/timed-out build must never serve a
      // (possibly partial or stale) PDF.
      if (!record.pdfAvailable) {
        await fs.rm(artifacts.pdfPath(ctx.mainFile), { force: true }).catch(() => {});
        await fs.rm(path.join(ctx.buildDir, 'main.pdf'), { force: true }).catch(() => {});
      }
      if (!record.logTail) {
        const logPath = artifacts.logPath(ctx.mainFile);
        record.logTail = await LogCollector.readLogTail(logPath);
      }
    } catch {
      record.pdfAvailable = false;
    }
    record.errorCount = record.problems.filter((p) => p.severity === 'error').length;
    record.warningCount = record.problems.filter((p) => p.severity === 'warning').length;
  }

  dispose(): void {
    this.runner.dispose();
  }
}
