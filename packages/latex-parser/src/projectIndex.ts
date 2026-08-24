import type {
  EquationEntry,
  FigureTableEntry,
  LabelEntry,
  ProjectIndex,
} from '@latex-studio/shared';
import { parseBibKeys } from './bibParser.js';
import {
  findClosingBrace,
  parseCitationOccurrences,
  parseLabelOccurrences,
  parseReferenceOccurrences,
  parseStructure,
  stripComments,
} from './structureParser.js';
import { parseBibDirectives, parseGraphics, parseIncludes, parsePackages } from './packageParser.js';

export interface SourceFile {
  /** workspace-relative slash path */
  path: string;
  content: string;
}

export interface BibSourceFile extends SourceFile {
  /* .bib file */
}

const ENV_LABEL_KIND: Record<string, LabelEntry['kind']> = {
  figure: 'figure',
  table: 'table',
};

/**
 * Parse labeled float/math environments in one document:
 *   figure/table → FigureTableEntry (caption + label)
 *   equation/align/gather (+ starred, with \label) → EquationEntry
 */
export function parseEnvironments(content: string, file: string): {
  figures: FigureTableEntry[];
  tables: FigureTableEntry[];
  equations: EquationEntry[];
} {
  const figures: FigureTableEntry[] = [];
  const tables: FigureTableEntry[] = [];
  const equations: EquationEntry[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = stripComments(lines[i]);
    let m = line.match(/\\begin\{(figure\*?|table\*?|equation\*?|align\*?|gather\*?|multline\*?|flalign\*?)\}/);
    if (!m) continue;
    const env = m[1]!;
    // Find matching \end{env} allowing nested environments of other kinds.
    let depth = 1;
    let j = i;
    let endLine = -1;
    while (j < lines.length && depth > 0) {
      const l = stripComments(lines[j]);
      const beginRe = new RegExp(`\\\\begin\\{${env}\\}`, 'g');
      const endRe = new RegExp(`\\\\end\\{${env}\\}`, 'g');
      let mm: RegExpExecArray | null;
      beginRe.lastIndex = 0;
      endRe.lastIndex = 0;
      let scanFrom = j === i ? m.index! + m[0].length : 0;
      while ((mm = beginRe.exec(l.slice(scanFrom))) !== null) depth++;
      void scanFrom;
      while ((mm = endRe.exec(l)) !== null) {
        depth--;
        if (depth === 0) {
          endLine = j;
          break;
        }
      }
      j++;
    }
    if (endLine === -1) continue;

    const bodyLines = lines.slice(i, endLine + 1).join('\n');
    const labelMatch = bodyLines.match(/\\label\{([^}]+)\}/);
    const key = labelMatch ? labelMatch[1].trim() : null;

    if (env.startsWith('figure') || env.startsWith('table')) {
      const capMatch = bodyLines.match(/\\caption(?:\[[^\]]*\])?\{([^}]*)\}/);
      const caption = capMatch ? capMatch[1].trim() : null;
      const entry: FigureTableEntry = { key, caption, file, line: i + 1 };
      if (env.startsWith('figure')) figures.push(entry);
      else tables.push(entry);
    } else if (key) {
      equations.push({ key, file, line: i + 1 });
    }
    i = endLine; // skip past the environment
  }

  void findClosingBrace; // reserved for single-line parsing upgrades
  return { figures, tables, equations };
}

/** Labels enriched with their defining context kind. */
export function parseLabelsWithKind(content: string, file: string): LabelEntry[] {
  const raw = parseLabelOccurrences(content, file);
  const lines = content.split(/\r?\n/);
  return raw.map((r) => {
    const before = lines[r.line - 1]
      ? stripComments(lines[r.line - 1]).slice(0, r.column - 1)
      : '';
    let kind: LabelEntry['kind'] = 'other';
    if (/\\section|\\subsection|\\subsubsection|\\chapter|\\part/.test(before)) kind = 'section';
    return { key: r.key, file: r.file, line: r.line, column: r.column, kind };
  });
}

// ---------------------------------------------------------------------------
// Project assembly
// ---------------------------------------------------------------------------

export interface BuildProjectIndexInput {
  files: SourceFile[];
  bibFiles: BibSourceFile[];
  mainFile: string | null;
}

export interface FileParseResult {
  path: string;
  sections: ReturnType<typeof parseStructure>;
  labels: LabelEntry[];
  references: ReturnType<typeof parseReferenceOccurrences>;
  citations: ReturnType<typeof parseCitationOccurrences>;
  figures: FigureTableEntry[];
  tables: FigureTableEntry[];
  equations: EquationEntry[];
  packages: ReturnType<typeof parsePackages>;
  includes: ReturnType<typeof parseIncludes>;
  graphics: ReturnType<typeof parseGraphics>;
  bibDirectives: ReturnType<typeof parseBibDirectives>;
}

/** Incremental unit of work: parse exactly ONE tex document. */
export function parseTexDocument(file: SourceFile): FileParseResult {
  const { path, content } = file;
  const envs = parseEnvironments(content, path);
  return {
    path,
    sections: parseStructure(content, path),
    labels: parseLabelsWithKind(content, path),
    references: parseReferenceOccurrences(content, path),
    citations: parseCitationOccurrences(content, path),
    figures: envs.figures,
    tables: envs.tables,
    equations: envs.equations,
    packages: parsePackages(content, path),
    includes: parseIncludes(content, path),
    graphics: parseGraphics(content, path),
    bibDirectives: parseBibDirectives(content, path),
  };
}

/** Parse one .bib document into entries. */
export function parseBibDocument(file: BibSourceFile) {
  return parseBibKeys(file.content, file.path);
}

function normalizeIncludeTarget(targetRaw: string, fromDir: string): string {
  let t = targetRaw.replace(/\\/g, '/').trim();
  if (!/\.(tex|ltx)$/i.test(t)) t += '.tex';
  if (t.startsWith('./')) t = t.slice(2);
  if (t.startsWith('/')) return t.replace(/^\/+/, ''); // jail at caller
  return fromDir && fromDir !== '.' ? `${fromDir}/${t}` : t;
}

/**
 * Assemble a full ProjectIndex from per-file parse results.
 * Pure aggregation + diagnostics — no filesystem access.
 */
export function assembleProjectIndex(
  parsedFiles: FileParseResult[],
  bibParsed: { file: string; entries: ReturnType<typeof parseBibKeys> }[],
  mainFile: string | null
): ProjectIndex {
  const index: ProjectIndex = {
    files: parsedFiles.map((f) => f.path),
    mainFile,
    sections: parsedFiles.flatMap((f) => f.sections),
    labels: parsedFiles.flatMap((f) => f.labels),
    references: parsedFiles.flatMap((f) =>
      f.references.map((r) => ({
        key: r.key,
        file: r.file,
        line: r.line,
        column: r.column,
        kind: (r.kind ?? 'ref') as 'ref' | 'pageref' | 'eqref' | 'autoref',
      }))
    ),
    citations: parsedFiles.flatMap((f) =>
      f.citations.map((c) => ({
        key: c.key,
        file: c.file,
        line: c.line,
        column: c.column,
        command: c.kind ?? 'cite',
      }))
    ),
    bibEntries: bibParsed.flatMap((b) => b.entries.map((e) => ({ ...e, file: b.file }))),
    figures: parsedFiles.flatMap((f) => f.figures),
    tables: parsedFiles.flatMap((f) => f.tables),
    equations: parsedFiles.flatMap((f) => f.equations),
    packages: parsedFiles.flatMap((f) => f.packages),
    includes: [],
    graphicsPaths: [],
    diagnostics: [],
  };

  // include graph (all files, not only reachable ones)
  for (const f of parsedFiles) {
    const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
    for (const inc of f.includes) {
      index.includes.push({
        from: f.path,
        to: normalizeIncludeTarget(inc.targetRaw, dir),
        kind: inc.kind,
        line: inc.line,
      });
    }
  }

  // label lookup for reference resolution
  const labelsByKey = new Map<string, LabelEntry[]>();
  for (const l of index.labels) {
    const arr = labelsByKey.get(l.key);
    if (arr) arr.push(l);
    else labelsByKey.set(l.key, [l]);
  }
  const bibKeySet = new Set(index.bibEntries.map((b) => b.key));

  // diagnostics
  for (const ref of index.references) {
    if (!labelsByKey.has(ref.key)) {
      index.diagnostics.push({
        code: 'UNDEFINED_REFERENCE',
        severity: 'warning',
        message: `Reference '${ref.key}' has no matching \\label`,
        file: ref.file,
        line: ref.line,
        key: ref.key,
      });
    }
  }
  for (const [key, arr] of labelsByKey) {
    if (arr.length > 1) {
      // point at the SECOND definition — that is the one to rename/remove
      const dup = arr[1];
      index.diagnostics.push({
        code: 'DUPLICATE_LABEL',
        severity: 'error',
        message: `Label '${key}' is defined ${arr.length} times`,
        file: dup.file,
        line: dup.line,
        key,
      });
    }
  }
  for (const c of index.citations) {
    if (!bibKeySet.has(c.key)) {
      index.diagnostics.push({
        code: 'UNDEFINED_CITATION',
        severity: 'warning',
        message: `Citation '${c.key}' not found in any .bib file`,
        file: c.file,
        line: c.line,
        key: c.key,
      });
    }
  }

  // stable ordering
  index.sections.sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)
  );
  return index;
}
