import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface CollectedOutput {
  stdout: string;
  stderr: string;
}

/**
 * Collects raw compiler output for one build and produces a bounded tail
 * suitable for the UI Output panel.
 */
export class LogCollector {
  readonly entries: { time: number; line: string }[] = [];
  private stdout = '';
  private stderr = '';

  addStdout(chunk: string): void {
    this.stdout += chunk;
  }

  addStderr(chunk: string): void {
    this.stderr += chunk;
  }

  addLine(line: string): void {
    this.entries.push({ time: Date.now(), line });
  }

  /** Combined raw output, bounded. */
  combined(): string {
    const both = `${this.stdout}\n${this.stderr}`.trim();
    return both.length > 400_000 ? both.slice(-400_000) : both;
  }

  /** Last N KB of the engine .log file (the interesting part is always at the end). */
  static async readLogTail(logPath: string | null, maxBytes = 200_000): Promise<string> {
    if (!logPath) return '(no log available)';
    try {
      const stat = await fs.stat(logPath);
      const start = Math.max(0, stat.size - maxBytes);
      const fh = await fs.open(logPath, 'r');
      try {
        const buf = Buffer.alloc(stat.size - start);
        await fh.read(buf, 0, buf.length, start);
        return buf.toString('utf8');
      } finally {
        await fh.close();
      }
    } catch {
      return '(no log available)';
    }
  }
}

/**
 * Owns build artifacts inside the isolated build dir:
 *   main.pdf / main.log / main.aux / main.bbl / main.bcf /
 *   main.fls / main.fdb_latexmk / main.synctex.gz / main.run.xml
 */
export class ArtifactManager {
  constructor(readonly buildDir: string) {}

  jobname(mainFile: string): string {
    return path.basename(mainFile).replace(/\.tex$/i, '');
  }

  artifactPath(mainFile: string, ext: string): string {
    return path.join(this.buildDir, this.jobname(mainFile) + ext);
  }

  pdfPath(mainFile: string): string {
    return this.artifactPath(mainFile, '.pdf');
  }

  logPath(mainFile: string): string {
    return this.artifactPath(mainFile, '.log');
  }

  auxPath(mainFile: string): string {
    return this.artifactPath(mainFile, '.aux');
  }

  synctexPath(mainFile: string): string {
    return this.artifactPath(mainFile, '.synctex.gz');
  }

  /**
   * Remove stale outputs so a failed rebuild can never serve a previous
   * build's PDF/log as if it were fresh.
   */
  async cleanStale(mainFile: string): Promise<void> {
    const exts = ['.pdf', '.log', '.synctex.gz'];
    await Promise.all(
      exts.map((ext) =>
        fs.rm(this.artifactPath(mainFile, ext), { force: true }).catch(() => {})
      )
    );
    // latexmk writes these too
    await fs.rm(path.join(this.buildDir, 'main.pdf'), { force: true }).catch(() => {});
    await fs.rm(path.join(this.buildDir, 'main.log'), { force: true }).catch(() => {});
    await fs.rm(path.join(this.buildDir, 'main.synctex.gz'), { force: true }).catch(() => {});
  }

  async ensureDir(): Promise<void> {
    await fs.mkdir(this.buildDir, { recursive: true });
  }

  async pdfExists(mainFile: string): Promise<boolean> {
    try {
      const stat = await fs.stat(this.pdfPath(mainFile));
      return stat.isFile() && stat.size > 0;
    } catch {
      return false;
    }
  }

  async readPdf(mainFile: string): Promise<Buffer> {
    return fs.readFile(this.pdfPath(mainFile));
  }
}
