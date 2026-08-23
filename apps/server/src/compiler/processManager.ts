import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { toolHelperDirs } from './detector.js';

export interface SpawnOutcome {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
  spawnError?: Error;
}

const MAX_CAPTURE = 2_000_000;

/**
 * Owns the lifecycle of one child process:
 *   spawn (shell:false) → capture stdout/stderr → timeout → cancel → tree kill.
 *
 * Process-tree cleanup strategy:
 *   - win32:  `taskkill /pid <pid> /T /F` immediately (kills latexmk + xelatex + bibtex…)
 *   - posix:  spawn detached in its own process group, then `process.kill(-pid)`.
 */
export class ProcessManager {
  private active = new Map<number, ChildProcess>();

  async run(
    command: string,
    args: string[],
    opts: { cwd: string; timeoutMs?: number; cancelled?: () => boolean }
  ): Promise<SpawnOutcome> {
    return new Promise<SpawnOutcome>((resolve) => {
      let settled = false;
      const outcome: SpawnOutcome = {
        code: null,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        cancelled: false,
      };

      let child: ChildProcess;
      try {
        // Append known TeX/Perl helper dirs so latexmk etc. work even when
        // they are not on this process's PATH.
        const helperPath = [...toolHelperDirs(), process.env.PATH].join(path.delimiter);
        child = spawn(command, args, {
          cwd: opts.cwd,
          shell: false,
          windowsHide: true,
          env: { ...process.env, PATH: helperPath },
          detached: process.platform !== 'win32',
        });
      } catch (err) {
        outcome.spawnError = err as Error;
        resolve(outcome);
        return;
      }

      if (child.pid) this.active.set(child.pid, child);

      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (child.pid) this.active.delete(child.pid);
        resolve(outcome);
      };

      let timer: ReturnType<typeof setTimeout> | undefined;
      timer =
        opts.timeoutMs && opts.timeoutMs > 0
          ? setTimeout(() => {
              outcome.timedOut = true;
              this.killTree(child);
            }, opts.timeoutMs)
          : undefined;

      child.stdout?.on('data', (d: Buffer) => {
        outcome.stdout += d.toString('utf8');
        if (outcome.stdout.length > MAX_CAPTURE) outcome.stdout = outcome.stdout.slice(-MAX_CAPTURE / 2);
      });
      child.stderr?.on('data', (d: Buffer) => {
        outcome.stderr += d.toString('utf8');
        if (outcome.stderr.length > MAX_CAPTURE / 2) outcome.stderr = outcome.stderr.slice(-MAX_CAPTURE / 4);
      });

      child.on('error', (err) => {
        outcome.spawnError = err;
        finish();
      });

      // Poll for external cancellation requests
      const poll = setInterval(() => {
        if (!settled && opts.cancelled?.()) {
          outcome.cancelled = true;
          clearInterval(poll);
          this.killTree(child);
        }
      }, 150);

      child.on('close', (code, signal) => {
        clearInterval(poll);
        outcome.code = code;
        outcome.signal = signal;
        finish();
      });
    });
  }

  /** Kill an entire process tree. Safe to call multiple times. */
  private killedTrees = new WeakSet<ChildProcess>();

  killTree(child: ChildProcess): void {
    if (this.killedTrees.has(child)) return;
    this.killedTrees.add(child);
    try {
      if (process.platform === 'win32') {
        if (child.pid) {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
            shell: false,
            windowsHide: true,
          });
          killer.on('error', () => {
            try {
              child.kill('SIGTERM');
            } catch {
              /* ignore */
            }
          });
        }
      } else {
        try {
          if (child.pid) process.kill(-child.pid, 'SIGTERM');
        } catch {
          try {
            child.kill('SIGTERM');
          } catch {
            /* ignore */
          }
        }
        setTimeout(() => {
          try {
            if (child.pid && child.exitCode === null) process.kill(-child.pid, 'SIGKILL');
          } catch {
            /* already dead */
          }
        }, 2000).unref();
      }
    } catch {
      /* best effort */
    }
  }

  dispose(): void {
    for (const child of this.active.values()) this.killTree(child);
    this.active.clear();
  }
}
