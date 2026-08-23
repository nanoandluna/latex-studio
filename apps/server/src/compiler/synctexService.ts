import path from 'node:path';
import type { SyncTexForwardResult } from '@latex-studio/shared';
import { detectTool } from './detector.js';
import { ProcessManager } from './processManager.js';
import { ArtifactManager } from './artifactManager.js';

/**
 * SyncTeX support.
 *
 * Forward search (source → PDF) is implemented via the `synctex` CLI that
 * ships with TeX Live / MiKTeX. Builds always pass `-synctex=1`, so a
 * `<jobname>.synctex.gz` is produced next to the PDF.
 *
 * Inverse search (PDF → source) is reserved for V0.2:
 *   synctex edit -o "<page>:<x>:<y>:<pdfPath>" → Input:/Line: records.
 */
export interface SyncTeXService {
  isAvailable(): boolean;
  /** Map a source file/line to a PDF page (and position in 72dpi points). */
  forwardSearch(
    workspace: string,
    buildDir: string,
    mainFile: string,
    sourceFile: string,
    line: number,
    column?: number
  ): Promise<SyncTexForwardResult | null>;
}

export class SyncTexService implements SyncTeXService {
  private processes = new ProcessManager();

  isAvailable(): boolean {
    return detectTool('synctex').available;
  }

  async forwardSearch(
    workspace: string,
    buildDir: string,
    mainFile: string,
    sourceFile: string,
    line: number,
    column = 0
  ): Promise<SyncTexForwardResult | null> {
    const tool = detectTool('synctex');
    if (!tool.available || !tool.path) return null;

    const artifacts = new ArtifactManager(buildDir);
    const pdf = artifacts.pdfPath(mainFile);
    // synctex expects paths relative to the compile working directory
    const srcRel = path.relative(workspace, path.resolve(workspace, sourceFile)) || mainFile;

    const outcome = await this.processes.run(
      tool.path,
      ['view', '-i', `${line}:${column}:${srcRel}`, '-o', pdf],
      { cwd: workspace, timeoutMs: 10_000 }
    );
    if (!outcome.stdout || outcome.code !== 0) return null;
    return parseSynctexViewOutput(outcome.stdout);
  }

  dispose(): void {
    this.processes.dispose();
  }
}

/** Parse `synctex view` output: "Page:N;" plus optional x/y in the first hit block. */
export function parseSynctexViewOutput(output: string): SyncTexForwardResult | null {
  const hit = output.indexOf('Hit:');
  if (hit === -1 && !/^\s*Page:/m.test(output)) return null;
  const section = output.slice(hit >= 0 ? hit : 0);
  const page = section.match(/Page:(\d+)/)?.[1];
  if (!page) return null;
  const x = section.match(/\bx:([-\d.]+)/)?.[1];
  const y = section.match(/\by:([-\d.]+)/)?.[1];
  return {
    page: parseInt(page, 10),
    ...(x !== undefined ? { x: parseFloat(x) } : {}),
    ...(y !== undefined ? { y: parseFloat(y) } : {}),
  };
}
