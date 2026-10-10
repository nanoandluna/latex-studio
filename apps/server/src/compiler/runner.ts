import path from 'node:path';
import { promises as fs } from 'node:fs';
import { ProcessManager, type SpawnOutcome } from './processManager.js';
import { ArtifactManager } from './artifactManager.js';
import { safeResolve, safeRealpathForWrite } from '../utils/paths.js';

export interface RunStep {
  tool: string;
  command: string;
  args: string[];
  cwd: string;
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  stdoutTail: string;
  stderrTail: string;
}

export interface RunResult {
  success: boolean;
  cancelled: boolean;
  timedOut: boolean;
  spawnError?: Error;
  failureMessage?: string;
  steps: RunStep[];
}

export type EngineId = 'xelatex' | 'pdflatex' | 'lualatex';

const RERUN_PATTERNS = [
  'Rerun to get',
  'Rerun LaTeX',
  'Please rerun',
  'Label(s) may have changed',
];

const MAX_ENGINE_PASSES = 5;

/**
 * Recursively collect the LaTeX sources reachable from the main file via
 * \input / \include, so bibliography directives declared in sub-files are
 * detected too. Unresolvable includes are skipped silently.
 */
export async function collectSources(workspace: string, mainFile: string): Promise<string> {
  const seen = new Set<string>();
  const out: string[] = [];

  const walk = async (relFile: string, depth: number): Promise<void> => {
    const key = relFile.replace(/\\/g, '/').replace(/^\.\//, '');
    if (depth > 8 || seen.has(key)) return;
    seen.add(key);
    let content: string;
    try {
      content = await fs.readFile(path.join(workspace, relFile), 'utf8');
    } catch {
      return;
    }
    out.push(content);

    const inputRe = /\\(?:input|include)\{([^}]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = inputRe.exec(content)) !== null) {
      let rel = m[1].trim().replace(/\\/g, '/');
      if (!/\.(tex|ltx)$/i.test(rel)) rel += '.tex';
      if (rel.includes('..') || path.isAbsolute(rel)) continue; // stay inside workspace
      const candidates = [rel];
      const dir = path.posix.dirname(relFile.replace(/\\/g, '/'));
      if (dir && dir !== '.') candidates.push(path.posix.join(dir, rel));
      for (const candidate of candidates) {
        try {
          await fs.access(path.join(workspace, candidate));
          await walk(candidate, depth + 1);
          break;
        } catch {
          /* try next candidate */
        }
      }
    }
  };

  await walk(mainFile, 0);
  return out.join('\n');
}

/** TeX Live does not create output parents for nested include auxiliary files. */
export async function prepareIncludeDirectories(workspace: string, buildDir: string, source: string): Promise<void> {
  const includes = source.replace(/(?<!\\)%[^\n]*/g, '').matchAll(/\\include\s*\{([^}]+)\}/g);
  const directories = new Set<string>();
  for (const match of includes) {
    const name = match[1].trim().replace(/\\/g, '/');
    if (name.split('/').includes('..') || path.isAbsolute(name) || name.includes(':')) continue;
    const parent = path.posix.dirname(name);
    if (parent !== '.') directories.add(safeResolve(buildDir, parent));
  }
  for (const directory of directories) {
    await safeRealpathForWrite(workspace, directory);
    await fs.mkdir(directory, { recursive: true });
    await safeRealpathForWrite(workspace, directory);
  }
}

/**
 * Executes the actual compiler invocations.
 *
 * Two modes:
 *  - latexmk mode (preferred): one process handles reruns + bibliography.
 *  - direct mode: engine passes with log-driven rerun detection and
 *    explicit BibTeX/Biber runs based on the project's own directives
 *    (\bibliography → bibtex, \addbibresource → biber) — never assumed.
 */
export class CompilerRunner {
  private readonly processes = new ProcessManager();

  dispose(): void {
    this.processes.dispose();
  }

  cancelActive(): void {
    this.processes.dispose();
  }

  async runLatexmk(
    workspace: string,
    buildDir: string,
    mainFile: string,
    engine: EngineId,
    latexmkCommand: string,
    opts: { timeoutMs: number; cancelled?: () => boolean }
  ): Promise<RunResult> {
    await prepareIncludeDirectories(workspace, buildDir, await collectSources(workspace, mainFile));
    const args = [
      `-${engine}`,
      '-interaction=nonstopmode',
      '-halt-on-error',
      '-synctex=1',
      `-output-directory=${buildDir}`,
      mainFile,
    ];
    return this.runTool(latexmkCommand, args, workspace, opts);
  }

  async runDirectEngine(
    workspace: string,
    buildDir: string,
    mainFile: string,
    engine: EngineId,
    tools: { engineCmd: string; bibtex?: string; biber?: string },
    opts: { timeoutMs: number; cancelled?: () => boolean }
  ): Promise<RunResult> {
    const artifacts = new ArtifactManager(buildDir);
    const mainBase = path.basename(mainFile).replace(/\.tex$/i, '');
    // Scan the main file AND every file reachable via \input/\include for
    // bibliography directives.
    let mainSource = '';
    try {
      mainSource = await collectSources(workspace, mainFile);
    } catch {
      /* unreadable main — the engine will report it */
    }
    const usesBiber = /\\addbibresource\s*\[?[^\]]*\]?\{/.test(mainSource);
    const usesBibtex = /\\(?:no)?bibliography\s*\{/.test(mainSource);
    await prepareIncludeDirectories(workspace, buildDir, mainSource);

    const deadline = Date.now() + opts.timeoutMs;
    const remaining = () => Math.max(1000, deadline - Date.now());
    const result: RunResult = { success: false, cancelled: false, timedOut: false, steps: [] };

    let pass = 0;
    let lastLog = '';
    let engineFailed = false;
    let minimumPasses = 1;
    while (pass < MAX_ENGINE_PASSES) {
      if (opts.cancelled?.()) {
        result.cancelled = true;
        return result;
      }
      if (Date.now() > deadline) {
        result.timedOut = true;
        return result;
      }

      const step = await this.runEngineOnce(
        workspace,
        buildDir,
        mainFile,
        tools.engineCmd,
        {
          timeoutMs: remaining(),
          cancelled: opts.cancelled,
        }
      );
      result.steps.push(...step.steps);
      if (step.cancelled) {
        result.cancelled = true;
        return result;
      }
      if (step.timedOut) {
        result.timedOut = true;
        return result;
      }
      if (step.spawnError) {
        result.spawnError = step.spawnError;
        return result;
      }

      pass++;
      try {
        lastLog = await fs.readFile(artifacts.logPath(mainFile), 'utf8').catch(() => lastLog);
      } catch {
        /* keep old */
      }

      // A TeX error ('!' lines in the log) or a non-zero exit code means the
      // document is broken — even if nonstopmode still emitted a partial PDF.
      const s = step.steps[0];
      const hadError = s ? !s.ok || /^!\s/m.test(lastLog) : true;
      if (hadError) {
        engineFailed = true;
        break;
      }

      // Bibliography phase: exactly once, after first clean pass.
      if (pass === 1 && !result.steps.some((st) => st.tool === 'bibtex' || st.tool === 'biber')) {
        const bibRun = await this.runBibliography(
          workspace,
          buildDir,
          mainFile,
          mainBase,
          { usesBiber, usesBibtex, bibtexCmd: tools.bibtex, biberCmd: tools.biber },
          { timeoutMs: Math.min(remaining(), 60_000), cancelled: opts.cancelled }
        );
        if (bibRun.run) {
          result.steps.push(...bibRun.run.steps);
          result.cancelled = bibRun.run.cancelled;
          result.timedOut = bibRun.run.timedOut;
          result.spawnError = bibRun.run.spawnError;
          if (result.cancelled || result.timedOut || result.spawnError) return result;
        }
        if (!bibRun.ok && !bibRun.skipped) {
          engineFailed = true;
          result.failureMessage = bibRun.message ?? 'The bibliography tool failed. See its output in the build log.';
          break;
        }
        if (bibRun.ran) {
          // The first post-bibliography pass writes citation mappings to aux;
          // the following pass consumes them. TeX distributions differ in which
          // rerun warnings they print, so do not rely on the warning wording.
          minimumPasses = 3;
          continue;
        }
      }

      if (pass < minimumPasses) continue;
      if (!RERUN_PATTERNS.some((p) => lastLog.includes(p))) break;
    }

    result.success = !engineFailed && (await artifacts.pdfExists(mainFile));
    return result;
  }

  private async runEngineOnce(
    workspace: string,
    buildDir: string,
    mainFile: string,
    engineCmd: string,
    opts: { timeoutMs: number; cancelled?: () => boolean }
  ): Promise<RunResult> {
    const args = [
      '-interaction=nonstopmode',
      '-synctex=1',
      `-output-directory=${buildDir}`,
      mainFile,
    ];
    return this.runTool(engineCmd, args, workspace, opts);
  }

  private async runBibliography(
    workspace: string,
    buildDir: string,
    mainFile: string,
    jobname: string,
    cfg: { usesBiber: boolean; usesBibtex: boolean; bibtexCmd?: string; biberCmd?: string },
    opts: { timeoutMs: number; cancelled?: () => boolean }
  ): Promise<{ ran: boolean; skipped: boolean; ok: boolean; run?: RunResult; message?: string }> {
    if (cfg.usesBiber && cfg.biberCmd) {
      const res = await this.runTool(
        cfg.biberCmd,
        [`--input-directory=${buildDir}`, jobname],
        workspace,
        opts
      );
      return { ran: true, skipped: false, ok: res.success, run: res };
    }
    if (cfg.usesBibtex && cfg.bibtexCmd) {
      // TeX Live's default openout_any=p refuses ".build/main.blg" when
      // invoked from the workspace. Run inside the build directory, keeping
      // the project bibliography/style roots in the child's search paths.
      const res = await this.runTool(
        cfg.bibtexCmd,
        [jobname],
        buildDir,
        { ...opts, env: {
          BIBINPUTS: [workspace, process.env.BIBINPUTS ?? ''].join(path.delimiter),
          BSTINPUTS: [workspace, process.env.BSTINPUTS ?? ''].join(path.delimiter),
        } }
      );
      return { ran: true, skipped: false, ok: res.success, run: res };
    }
    if (cfg.usesBiber || cfg.usesBibtex) return {
      ran: false, skipped: false, ok: false,
      message: `${cfg.usesBiber ? 'Biber' : 'BibTeX'} is required by this document but is not available. Install it and check the TeX environment.`,
    };
    return { ran: false, skipped: true, ok: true };
  }

  private async runTool(
    command: string,
    args: string[],
    cwd: string,
    opts: { timeoutMs: number; cancelled?: () => boolean; env?: NodeJS.ProcessEnv }
  ): Promise<RunResult> {
    const started = Date.now();
    const outcome: SpawnOutcome = await this.processes.run(command, args, {
      cwd,
      timeoutMs: opts.timeoutMs,
      cancelled: opts.cancelled,
      env: opts.env,
    });
    return {
      success: !outcome.spawnError && outcome.code === 0,
      cancelled: outcome.cancelled,
      timedOut: outcome.timedOut,
      spawnError: outcome.spawnError,
      steps: [
        {
          tool: path.basename(command).replace(/^miktex-/i, '').replace(/\.(exe|cmd|bat)$/i, ''),
          command,
          args,
          cwd,
          ok: !outcome.spawnError && outcome.code === 0,
          exitCode: outcome.code,
          durationMs: Date.now() - started,
          stdoutTail: outcome.stdout.slice(-4000),
          stderrTail: outcome.stderr.slice(-4000),
        },
      ],
    };
  }
}
