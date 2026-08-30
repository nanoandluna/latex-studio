import { projectIndexService } from './projectIndexService.js';
import type { IncludeEdge, ProjectIndex, SectionEntry } from '@latex-studio/shared';

/**
 * V0.5.1 — flatten the include graph from mainFile into reading order so
 * chapters can span files. The directive line is emitted, then the included
 * file's lines, then the directive file continues; a visited set breaks
 * cycles, and files unreachable from mainFile are appended sorted at the end
 * so their sections still count.
 *
 * Everything that attributes content to sections (Paper Overview, Statistics)
 * consumes this instead of per-file line math.
 */

export interface AssembledLine {
  file: string;
  line: number;
  text: string;
}

export interface AssembledSection {
  section: SectionEntry;
  /** Position of the heading line inside the assembly. */
  pos: number;
}

export interface DocumentAssembly {
  lines: AssembledLine[];
  sections: AssembledSection[];
  posOf: (file: string, line: number) => number | undefined;
}

export async function assembleDocument(
  index: ProjectIndex,
  contents: Map<string, string>
): Promise<DocumentAssembly | null> {
  const mainFile = index.mainFile;
  if (!mainFile || !contents.has(mainFile)) return null;

  const fileLines = new Map<string, string[]>();
  for (const [rel, text] of contents) {
    if (rel.endsWith('.tex')) fileLines.set(rel, text.split(/\r?\n/));
  }

  const edges = new Map<string, { to: string; line: number }[]>();
  for (const e of index.includes as IncludeEdge[]) {
    if (!fileLines.has(e.from) || !fileLines.has(e.to)) continue;
    const list = edges.get(e.from) ?? [];
    list.push({ to: e.to, line: e.line });
    edges.set(e.from, list);
  }
  for (const list of edges.values()) list.sort((a, b) => a.line - b.line);

  const lines: AssembledLine[] = [];
  const posByKey = new Map<string, number>();
  const visited = new Set<string>();
  const emitFile = (file: string): void => {
    if (visited.has(file)) return;
    visited.add(file);
    const outgoing = edges.get(file) ?? [];
    let ei = 0;
    const fileText = fileLines.get(file) ?? [];
    for (let i = 0; i < fileText.length; i++) {
      const lineNo = i + 1;
      lines.push({ file, line: lineNo, text: fileText[i] });
      posByKey.set(`${file}:${lineNo}`, lines.length - 1);
      while (ei < outgoing.length && outgoing[ei].line === lineNo) {
        emitFile(outgoing[ei].to);
        ei++;
      }
    }
  };
  emitFile(mainFile);
  for (const file of [...fileLines.keys()].sort()) {
    if (!visited.has(file)) emitFile(file);
  }

  const sections: AssembledSection[] = [];
  for (const s of index.sections) {
    const pos = posByKey.get(`${s.file}:${s.line}`);
    if (pos !== undefined) sections.push({ section: s, pos });
  }
  sections.sort((a, b) => a.pos - b.pos);

  return {
    lines,
    sections,
    posOf: (file, line) => posByKey.get(`${file}:${line}`),
  };
}

export interface SectionRange {
  section: SectionEntry;
  start: number;
  /** Exclusive. */
  end: number;
}

/** A section owns [start, next section at level ≤ own) over the assembly. */
export function sectionRanges(
  assembled: AssembledSection[],
  total: number
): SectionRange[] {
  const out: SectionRange[] = [];
  for (let i = 0; i < assembled.length; i++) {
    let end = total;
    for (let j = i + 1; j < assembled.length; j++) {
      if (assembled[j].section.level <= assembled[i].section.level) {
        end = assembled[j].pos;
        break;
      }
    }
    out.push({ section: assembled[i].section, start: assembled[i].pos, end });
  }
  return out;
}

export function sliceText(lines: AssembledLine[], start: number, end: number): string {
  return lines.slice(start, end).map((l) => l.text).join('\n');
}

export function chapterLevelOf(assembled: AssembledSection[]): number {
  const levels = [...new Set(assembled.map((s) => s.section.level))].sort((a, b) => a - b);
  return levels.includes(1) ? 1 : (levels[0] ?? 2);
}

/** Convenience: assemble from the indexer's content cache. */
export async function assembleFromIndex(
  index: ProjectIndex
): Promise<{ assembly: DocumentAssembly | null; contents: Map<string, string> }> {
  const contents = new Map<string, string>();
  for (const rel of index.files) {
    if (!rel.endsWith('.tex')) continue;
    const text = await projectIndexService.getFileContent(rel);
    if (text !== null) contents.set(rel, text);
  }
  return { assembly: await assembleDocument(index, contents), contents };
}
