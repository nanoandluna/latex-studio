import path from 'node:path';
import type { SyncTexForwardResult, SyncTexInverseResult } from '@latex-studio/shared';
import { detectTool } from './detector.js';
import { ProcessManager } from './processManager.js';
import { ArtifactManager } from './artifactManager.js';

/**
 * SyncTeX support (V0.2: bidirectional).
 *
 * Both directions run the `synctex` CLI shipped with TeX Live / MiKTeX.
 * Builds always pass `-synctex=1`, producing `<jobname>.synctex.gz`.
 *
 *  - forward: synctex view   -i "<line>:<col>:<src>" -o <pdf>
 *  - inverse: synctex edit   -o "<page>:<x>:<y>:<pdf>"
 */
export class SyncTexService {
  private processes = new ProcessManager();

  isAvailable(): boolean {
    return detectTool('synctex').available;
  }

  async forwardSearch(
    workspace: string,
    buildDir: string,
    mainFile: string,
    /** ABSOLUTE path inside the workspace (pre-validated by the route). */
    sourceFileAbs: string,
    line: number,
    column = 0
  ): Promise<SyncTexForwardResult | null> {
    const tool = detectTool('synctex');
    if (!tool.available || !tool.path) return null;

    const artifacts = new ArtifactManager(buildDir);
    const pdf = artifacts.pdfPath(mainFile);
    // MiKTeX/TeX Live match input tags against the ABSOLUTE path on Windows;
    // relative queries yield "No tag for …". The route already jail-validated
    // this absolute path via safeResolve.
    void buildDir;

    const outcome = await this.processes.run(
      tool.path,
      ['view', '-i', `${line}:${column}:${sourceFileAbs}`, '-o', pdf],
      { cwd: workspace, timeoutMs: 10_000 }
    );
    if (!outcome.stdout || outcome.code !== 0) return null;
    return parseSynctexViewOutput(outcome.stdout);
  }

  async inverseSearch(
    workspace: string,
    buildDir: string,
    mainFile: string,
    page: number,
    x: number,
    y: number
  ): Promise<SyncTexInverseResult | null> {
    const tool = detectTool('synctex');
    if (!tool.available || !tool.path) return null;

    const artifacts = new ArtifactManager(buildDir);
    const pdf = artifacts.pdfPath(mainFile);

    const outcome = await this.processes.run(
      tool.path,
      ['edit', '-o', `${page}:${x}:${y}:${pdf}`],
      { cwd: workspace, timeoutMs: 10_000 }
    );
    if (!outcome.stdout || outcome.code !== 0) return null;
    return parseSynctexEditOutput(outcome.stdout);
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

/**
 * Parse `synctex edit` output:
 *   Input:<path>
 *   Line:<n>
 *   Column:<n>
 */
export function parseSynctexEditOutput(output: string): SyncTexInverseResult | null {
  const input = output.match(/^Input:(.+)$/m)?.[1]?.trim();
  const line = output.match(/^Line:(\d+)/m)?.[1];
  if (!input || !line) return null;
  const column = output.match(/^Column:(\d+)/m)?.[1];
  return {
    file: input.replace(/\\/g, '/'),
    line: parseInt(line, 10),
    ...(column !== undefined ? { column: parseInt(column, 10) } : {}),
  };
}
