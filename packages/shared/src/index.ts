export type CompilerId = 'latexmk' | 'xelatex' | 'pdflatex' | 'lualatex';

export type ProblemSeverity = 'error' | 'warning' | 'info';

export interface Problem {
  severity: ProblemSeverity;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  raw?: string;
}

export interface CompilerInfo {
  /** logical tool id, e.g. 'xelatex' | 'latexmk' | 'bibtex' | 'biber' */
  id: string;
  /** human readable name, e.g. 'XeLaTeX' */
  name: string;
  /** command used to invoke it */
  command: string;
  /** absolute resolved executable path (null if not found) */
  path: string | null;
  version?: string;
  platform: string;
  available: boolean;
  /** true when only reachable via cmd.exe wrapper (.cmd/.bat) — direct spawn impossible */
  shellWrapperOnly?: boolean;
}

export interface LatexEnvironment {
  tools: CompilerInfo[];
  distribution?: string;
  allAvailable: boolean;
  anyAvailable: boolean;
  latexmkAvailable: boolean;
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

export type CompilerChoice = CompilerId | 'auto';

export interface BuildOptions {
  mainFile: string;
  compiler: CompilerId | 'auto';
}

/**
 * Full build lifecycle. The frontend distinguishes every terminal state:
 * failed / cancelled / timeout / compiler_unavailable.
 */
export type BuildStatus =
  | 'queued'
  | 'starting'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'timeout'
  | 'compiler_unavailable';

export function isTerminalBuildStatus(s: BuildStatus): boolean {
  return (
    s === 'success' ||
    s === 'failed' ||
    s === 'cancelled' ||
    s === 'timeout' ||
    s === 'compiler_unavailable'
  );
}

export interface BuildResult {
  buildId: string;
  status: BuildStatus;
  durationMs: number;
  pdfAvailable: boolean;
  problems: Problem[];
  errorCount: number;
  warningCount: number;
  /** e.g. "latexmk unavailable — using direct compiler mode" */
  notice?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface BuildRecord extends BuildResult {
  workspacePath: string;
  mainFile: string;
  compiler: CompilerId;
  startedAt: number;
  logTail?: string;
}

export interface WorkspaceState {
  path: string;
  name: string;
  mainFile: string | null;
}

export interface BibKeyEntry {
  key: string;
  file: string;
  line: number;
  type: string;
}

export interface LabelEntry {
  key: string;
  file: string;
  line: number;
}

/** Result of a SyncTeX forward search (source → PDF). */
export interface SyncTexForwardResult {
  page: number;
  x?: number;
  y?: number;
}
