import path from 'node:path';
import type { BuildOptions, BuildRecord } from '@latex-studio/shared';
import { BuildManager, type BuildContext } from '../compiler/buildManager.js';
import { ArtifactManager, LogCollector } from '../compiler/artifactManager.js';
import { BUILD_DIR_NAME, BUILD_TIMEOUT_MS } from '../compiler/config.js';

export { BUILD_DIR_NAME, BUILD_TIMEOUT_MS };

/**
 * Public compiler facade (unchanged external contract):
 *   detect → build → cancel → getLog → getPdf
 * Internals live in src/compiler/* (Detector / Runner / BuildManager /
 * ProcessManager / LogCollector / ArtifactManager / SyncTeX).
 */
export class CompilerService {
  private manager = new BuildManager();

  getCurrentContext(): BuildContext | null {
    return this.manager.getCurrentContext();
  }

  getBuild(buildId: string): BuildRecord | undefined {
    return this.manager.getBuild(buildId);
  }

  getLatestBuild(): BuildRecord | undefined {
    return this.manager.getLatestBuild();
  }

  async cancel(buildId: string): Promise<boolean> {
    return this.manager.cancel(buildId);
  }

  async build(workspacePath: string, options: BuildOptions): Promise<BuildRecord> {
    return this.manager.build(workspacePath, options);
  }

  async getLogTail(buildId: string, maxBytes = 200_000): Promise<string> {
    const rec = this.manager.getBuild(buildId);
    if (!rec) throw new Error(`Unknown build ${buildId}`);
    const artifacts = new ArtifactManager(path.join(rec.workspacePath, BUILD_DIR_NAME));
    return LogCollector.readLogTail(artifacts.logPath(rec.mainFile), maxBytes);
  }

  async getPdfPath(buildId: string): Promise<string> {
    const rec = this.manager.getBuild(buildId);
    if (!rec) throw new Error(`Unknown build ${buildId}`);
    if (!rec.pdfAvailable) throw new Error('PDF not available for this build');
    const artifacts = new ArtifactManager(path.join(rec.workspacePath, BUILD_DIR_NAME));
    return artifacts.pdfPath(rec.mainFile);
  }

  dispose(): void {
    this.manager.dispose();
  }
}

export const compilerService = new CompilerService();
