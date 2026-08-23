import path from 'node:path';
import { promises as fs } from 'node:fs';
import { ProcessManager, type SpawnOutcome } from './processManager.js';
import { ArtifactManager } from './artifactManager.js';
import { BUILD_DIR_NAME } from './config.js';

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

    const deadline = Date.now() + opts.timeoutMs;
    const remaining = () => Math.max(1000, deadline - Date.now());
    const result: RunResult = { success: false, cancelled: false, timedOut: false, steps: [] };

    let pass = 0;
    let lastLog = '';
    let engineFailed = false;
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
        if (!bibRun.ok && !bibRun.skipped) {
          // Bib tool failure is not fatal — the LaTeX warnings will surface it.
          lastLog = `${lastLog}\n${bibRun.stderr ?? ''}`;
        }
        if (bibRun.ran) continue; // force at least one more pass to resolve citations
      }

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
  ): Promise<{ ran: boolean; skipped: boolean; ok: boolean; stderr?: string }> {
    if (cfg.usesBiber && cfg.biberCmd) {
      const res = await this.runTool(
        cfg.biberCmd,
        [`--input-directory=${buildDir}`, jobname],
        workspace,
        opts
      );
      return { ran: true, skipped: false, ok: res.success };
    }
    if (cfg.usesBibtex && cfg.bibtexCmd) {
      // Run from the workspace root so \bibliography{refs} resolves relative
      // to the project, while aux/bbl live in the isolated build dir.
      const res = await this.runTool(
        cfg.bibtexCmd,
        [`${BUILD_DIR_NAME}/${jobname}`],
        workspace,
        opts
      );
      void mainFile;
      return { ran: true, skipped: false, ok: res.success };
    }
    return { ran: false, skipped: true, ok: true };
  }

  private async runTool(
    command: string,
    args: string[],
    cwd: string,
    opts: { timeoutMs: number; cancelled?: () => boolean }
  ): Promise<RunResult> {
    const started = Date.now();
    const outcome: SpawnOutcome = await this.processes.run(command, args, {
      cwd,
      timeoutMs: opts.timeoutMs,
      cancelled: opts.cancelled,
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
