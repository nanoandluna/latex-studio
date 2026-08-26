import type { ProjectEdge, ProjectIndex } from '@latex-studio/shared';

/** Bump whenever the derived graph shape/diagnostic rules change. A mismatch
 *  invalidates any persisted cache and forces a full rebuild. */
export const GRAPH_SCHEMA_VERSION = 1;

/**
 * V0.3 Project Graph — query layer over the assembled project index.
 *
 * The index collections (sections/labels/…) remain the storage format;
 * edges and the query API are derived views so Outline, Navigator,
 * IntelliSense, Inspectors and Diagnostics share ONE data source.
 */

export type GraphDiagnostics = import('@latex-studio/shared').IndexDiagnostic[];

/** Derive explicit edges from the aggregated index. */
export function deriveEdges(index: ProjectIndex): ProjectEdge[] {
  const edges: ProjectEdge[] = [];
  for (const inc of index.includes) {
    edges.push({ kind: 'INCLUDES', from: inc.from, to: inc.to, line: inc.line });
  }
  for (const r of index.references) {
    edges.push({ kind: 'REFERENCES', from: r.file, to: r.key, line: r.line });
  }
  for (const c of index.citations) {
    edges.push({ kind: 'CITES', from: c.file, to: c.key, line: c.line });
  }
  // figure/table labels that carry a caption imply a graphic resource use is
  // not derivable without \includegraphics — those are added via graphics.
  return edges;
}

// ---------------------------------------------------------------------------
// Query API
// ---------------------------------------------------------------------------

export interface UsageSite {
  file: string;
  line: number;
  column: number;
  kind?: string;
}

export class ProjectGraphQuery {
  constructor(private readonly index: ProjectIndex) {}

  get data(): ProjectIndex {
    return this.index;
  }

  getSections() {
    return this.index.sections;
  }

  getLabels() {
    return this.index.labels;
  }

  /** All reference sites; optionally filtered by key. */
  getReferences(key?: string): UsageSite[] {
    return this.index.references
      .filter((r) => !key || r.key === key)
      .map((r) => ({ file: r.file, line: r.line, column: r.column, kind: r.kind }));
  }

  /** All citation sites; optionally filtered by key. */
  getCitations(key?: string): UsageSite[] {
    return this.index.citations
      .filter((c) => !key || c.key === key)
      .map((c) => ({ file: c.file, line: c.line, column: c.column, kind: c.command }));
  }

  getFigures() {
    return this.index.figures;
  }

  getTables() {
    return this.index.tables;
  }

  getEquations() {
    return this.index.equations;
  }

  /** Edges leaving the given file (what it includes/uses). */
  getDependencies(file: string): ProjectEdge[] {
    const norm = file.replace(/\\/g, '/');
    return deriveEdges(this.index).filter((e) => e.from === norm && e.kind === 'INCLUDES');
  }

  /** Edges entering the given file (who includes it). */
  getDependents(file: string): ProjectEdge[] {
    const norm = file.replace(/\\/g, '/');
    return deriveEdges(this.index).filter((e) => e.to === norm && e.kind === 'INCLUDES');
  }

  getBrokenReferences(): (UsageSite & { key: string })[] {
    const defined = new Set(this.index.labels.map((l) => l.key));
    return this.index.references
      .filter((r) => !defined.has(r.key))
      .map((r) => ({ file: r.file, line: r.line, column: r.column, kind: r.kind, key: r.key }));
  }

  getDuplicateLabels(): Map<string, typeof this.index.labels> {
    const byKey = new Map<string, typeof this.index.labels>();
    for (const l of this.index.labels) {
      const arr = byKey.get(l.key);
      if (arr) arr.push(l);
      else byKey.set(l.key, [l]);
    }
    const out = new Map<string, typeof this.index.labels>();
    for (const [k, arr] of byKey) if (arr.length > 1) out.set(k, arr);
    return out;
  }

  /** Labels defined but never referenced. */
  getUnusedLabels(): typeof this.index.labels {
    const used = new Set(this.index.references.map((r) => r.key));
    return this.index.labels.filter((l) => !used.has(l.key));
  }

  /** Bib keys never cited. */
  getUnusedCitations(): typeof this.index.bibEntries {
    const cited = new Set(this.index.citations.map((c) => c.key));
    return this.index.bibEntries.filter((b) => !cited.has(b.key));
  }

  getMissingIncludes(): ProjectEdge[] {
    const files = new Set(this.index.files);
    return this.getDependenciesOfAll().filter((e) => !files.has(e.to));
  }

  private getDependenciesOfAll(): ProjectEdge[] {
    return deriveEdges(this.index).filter((e) => e.kind === 'INCLUDES');
  }
}

// ---------------------------------------------------------------------------
// Diagnostics derivation — READ-ONLY over the graph (no rescanning).
// ---------------------------------------------------------------------------

export function deriveGraphDiagnostics(index: ProjectIndex): GraphDiagnostics {
  const q = new ProjectGraphQuery(index);
  const diags: GraphDiagnostics = [];

  // carried-over deterministic rules from assembleProjectIndex
  for (const r of q.getBrokenReferences()) {
    diags.push({
      code: 'UNDEFINED_REFERENCE',
      severity: 'warning',
      message: `Reference '${r.key}' has no matching \\label`,
      file: r.file,
      line: r.line,
      key: r.key,
    });
  }
  for (const [, arr] of q.getDuplicateLabels()) {
    diags.push({
      code: 'DUPLICATE_LABEL',
      severity: 'error',
      message: `Label '${arr[0].key}' is defined ${arr.length} times`,
      file: arr[1].file,
      line: arr[1].line,
      key: arr[0].key,
    });
  }
  const citedKeys = new Set(index.citations.map((c) => c.key));
  const definedBib = new Set(index.bibEntries.map((b) => b.key));
  for (const c of index.citations) {
    if (!definedBib.has(c.key)) {
      diags.push({
        code: 'UNDEFINED_CITATION',
        severity: 'warning',
        message: `Citation '${c.key}' not found in any .bib file`,
        file: c.file,
        line: c.line,
        key: c.key,
      });
    }
    void citedKeys;
  }

  // V0.3 additions
  for (const l of q.getUnusedLabels()) {
    diags.push({
      code: 'UNUSED_LABEL',
      severity: 'info',
      message: `Label '${l.key}' is never referenced`,
      file: l.file,
      line: l.line,
      key: l.key,
    });
  }
  for (const b of q.getUnusedCitations()) {
    diags.push({
      code: 'UNUSED_CITATION',
      severity: 'info',
      message: `Bib entry '${b.key}' is never cited`,
      file: b.file,
      line: b.line,
      key: b.key,
    });
  }
  for (const e of q.getMissingIncludes()) {
    diags.push({
      code: 'MISSING_INCLUDE',
      severity: 'error',
      message: `Included file '${e.to}' does not exist`,
      file: e.from,
      line: e.line,
      key: e.to,
    });
  }
  return diags;
}
