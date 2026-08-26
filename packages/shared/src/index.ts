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

/** Result of a SyncTeX forward search (source → PDF). */

export interface SyncTexForwardResult {
  page: number;
  x?: number;
  y?: number;
}

/** Result of a SyncTeX inverse search (PDF → source). */
export interface SyncTexInverseResult {
  file: string;
  line: number;
  column?: number;
}

// ---------------------------------------------------------------------------
// Project Index (V0.2) — the single source of truth consumed by Outline,
// Navigator, IntelliSense and index-level diagnostics.
// ---------------------------------------------------------------------------

export interface SectionEntry {
  /** display title, e.g. "Method" */
  title: string;
  /** compiled depth: part=0 chapter=1 section=2 … */
  level: number;
  file: string;
  line: number;
  column: number;
}

export interface LabelEntry {
  key: string;
  file: string;
  line: number;
  column: number;
  /** environment/context that defined it, when detectable */
  kind?: 'section' | 'figure' | 'table' | 'equation' | 'other';
}

export interface ReferenceEntry {
  key: string;
  file: string;
  line: number;
  column: number;
  kind: 'ref' | 'pageref' | 'eqref' | 'autoref';
}

export interface CitationEntry {
  key: string;
  file: string;
  line: number;
  column: number;
  command: string;
}

export interface BibEntry {
  key: string;
  file: string;
  line: number;
  type: string;
  /** "Smith, Jane" — raw author field when present */
  author?: string;
  title?: string;
  year?: string;
}

export interface FigureTableEntry {
  key: string | null;
  caption: string | null;
  file: string;
  line: number;
}

export interface EquationEntry {
  key: string | null;
  file: string;
  line: number;
}

export interface PackageEntry {
  name: string;
  options?: string;
  file: string;
  line: number;
}

export interface IncludeEdge {
  /** file containing the directive */
  from: string;
  /** resolved target path inside the workspace (slash-separated, no ./) */
  to: string;
  kind: 'input' | 'include';
  line: number;
}

/** Resolvable graphic asset for \includegraphics completion. */
export interface GraphicsPathEntry {
  path: string;
  detail?: string;
}

export type IndexDiagnosticCode =
  | 'UNDEFINED_REFERENCE'
  | 'DUPLICATE_LABEL'
  | 'UNDEFINED_CITATION'
  | 'UNUSED_LABEL'
  | 'UNUSED_CITATION'
  | 'MISSING_INCLUDE';

export interface IndexDiagnostic {
  code: IndexDiagnosticCode;
  severity: 'error' | 'warning' | 'info';
  message: string;
  file: string;
  line: number;
  key: string;
}

export interface ProjectIndex {
  /** workspace-relative slash paths that were parsed (tex + bib) */
  files: string[];
  /** main file used to root the include graph (may be null pre-detection) */
  mainFile: string | null;
  sections: SectionEntry[];
  labels: LabelEntry[];
  references: ReferenceEntry[];
  citations: CitationEntry[];
  bibEntries: BibEntry[];
  figures: FigureTableEntry[];
  tables: FigureTableEntry[];
  equations: EquationEntry[];
  packages: PackageEntry[];
  includes: IncludeEdge[];
  /** V0.3.1 — stamped by the indexer; drives persistent-cache invalidation */
  schemaVersion?: number;
  parserVersion?: string;
  graphicsPaths: GraphicsPathEntry[];
  edges?: ProjectEdge[];
  version?: number;
  generatedAt?: number;
  diagnostics: IndexDiagnostic[];
}

// ---------------------------------------------------------------------------
// V0.3 — Project Graph, watcher, research workspace
// ---------------------------------------------------------------------------

export type ProjectEdgeKind =
  | 'INCLUDES'
  | 'REFERENCES'
  | 'CITES'
  | 'USES_GRAPHIC'
  | 'DEFINES'
  | 'CONTAINS';

export interface ProjectEdge {
  kind: ProjectEdgeKind;
  /** workspace-relative source of the edge */
  from: string;
  /**
   * target: file path for INCLUDES/USES_GRAPHIC/CONTAINS, symbol key for
   * REFERENCES/CITES/DEFINES. Always jail-safe (no .. / absolute).
   */
  to: string;
  line: number;
}

/** Monotonic counter — bumped on every committed graph mutation. */
export interface GraphEnvelope {
  version: number;
  generatedAt: number;
  root: string;
  graph: ProjectIndex & { edges: ProjectEdge[] };
}

export interface RecentProject {
  path: string;
  name: string;
  lastOpened: number;
}

export interface TemplateManifest {
  id: string;
  name: string;
  description?: string;
  version: string;
  mainFile: string;
  files: string[];
}

export interface SynctexDiagnostics {
  executableFound: boolean;
  mappingFileExists: boolean;
  pdfMatchesBuild: boolean;
  ok: boolean;
  reason?: string;
  suggestion?: string;
}

export type WritingCheckCode =
  | 'REPEATED_WORD'
  | 'LONG_SENTENCE'
  | 'TODO_FIXME'
  | 'EMPTY_SECTION'
  | 'SUSPICIOUS_PUNCTUATION';

export interface WritingDiagnostic {
  code: WritingCheckCode;
  severity: 'warning' | 'info';
  message: string;
  file: string;
  line: number;
}
