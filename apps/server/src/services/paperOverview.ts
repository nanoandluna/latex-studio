import { projectIndexService } from './projectIndexService.js';
import { analyzeTextStatistics } from '@latex-studio/latex-parser';
import {
  assembleFromIndex,
  chapterLevelOf,
  sectionRanges,
  sliceText,
} from './chapterAssembly.js';
import type { PaperOverview, PaperOverviewChapter, ProjectIndex, SectionEntry } from '@latex-studio/shared';

/**
 * V0.5-PLAN 1 — Paper Overview.
 *
 * Everything comes from the existing Project Graph snapshot and the indexer's
 * content cache; there is no second walk of the workspace. Since V0.5.1 the
 * chapter model is the assembled document (include graph from mainFile), so
 * chapters span \input'd files; files unreachable from mainFile fall back to
 * per-file intervals.
 */

function emptyOverview(): PaperOverview {
  return {
    structure: { chapters: 0, sections: 0 },
    content: { cjkCharacters: 0, latinWords: 0, estimatedWords: 0 },
    assets: { figures: 0, tables: 0, equations: 0 },
    references: { citations: 0, bibEntries: 0, undefinedCitations: 0, undefinedReferences: 0 },
    diagnostics: { errors: 0, warnings: 0, infos: 0 },
    chapters: [],
  };
}

interface ChapterBucket {
  chapter: PaperOverviewChapter;
  /** Inclusive start, exclusive end — assembled positions. */
  start: number;
  end: number;
}

function distinctKeysNotIn(entries: { key: string }[], known: Set<string>): number {
  return new Set(entries.map((e) => e.key).filter((k) => !known.has(k))).size;
}

export async function buildPaperOverview(): Promise<PaperOverview> {
  if (projectIndexService.needsRebuild()) await projectIndexService.refresh();
  const index: ProjectIndex | null = projectIndexService.getSnapshot();
  if (!index) return emptyOverview();

  const { assembly, contents } = await assembleFromIndex(index);
  const texFiles = index.files.filter((f) => f.endsWith('.tex'));

  let content = { cjkCharacters: 0, latinWords: 0, estimatedWords: 0 };
  for (const text of contents.values()) {
    const stats = analyzeTextStatistics(text);
    content.cjkCharacters += stats.cjkCharacters;
    content.latinWords += stats.latinWords;
    content.estimatedWords += stats.estimatedWords;
  }

  const chapters: PaperOverviewChapter[] = [];

  let buckets: ChapterBucket[];
  if (assembly) {
    const ranges = sectionRanges(assembly.sections, assembly.lines.length);
    const level = chapterLevelOf(assembly.sections);
    buckets = ranges
      .filter((r) => r.section.level === level)
      .map((r) => ({
        chapter: {
          title: r.section.title,
          file: r.section.file,
          line: r.section.line,
          cjkCharacters: 0,
          estimatedWords: 0,
          citations: 0,
          figures: 0,
          tables: 0,
          equations: 0,
        },
        start: r.start,
        end: r.end,
      }));
    for (const b of buckets) {
      const stats = analyzeTextStatistics(sliceText(assembly.lines, b.start, b.end));
      b.chapter.cjkCharacters = stats.cjkCharacters;
      b.chapter.estimatedWords = stats.estimatedWords;
    }
    // chapters stay in reading order — no alphabetical re-sort here
    chapters.push(...buckets.map((b) => b.chapter));
    const findOwner = (pos: number): PaperOverviewChapter | null =>
      buckets.find((b) => pos >= b.start && pos < b.end)?.chapter ?? null;
    const posOf = assembly.posOf;
    attributeEntries(index, (file, line) => {
      const pos = posOf(file, line);
      return pos === undefined ? null : findOwner(pos);
    }, chapters);
  } else {
    // no mainFile → per-file intervals (legacy semantics)
    const perFile = new Map<string, SectionEntry[]>();
    for (const s of index.sections) {
      if (!contents.has(s.file)) continue;
      const list = perFile.get(s.file) ?? [];
      list.push(s);
      perFile.set(s.file, list);
    }
    const fileLines = new Map<string, string[]>();
    for (const [rel, text] of contents) fileLines.set(rel, text.split(/\r?\n/));
    buckets = [];
    for (const [file, list] of perFile) {
      list.sort((a, b) => a.line - b.line);
      const linesArr = fileLines.get(file) ?? [];
      for (let i = 0; i < list.length; i++) {
        let end = linesArr.length + 1;
        for (let j = i + 1; j < list.length; j++) {
          if (list[j].level <= list[i].level) {
            end = list[j].line;
            break;
          }
        }
        const stats = analyzeTextStatistics(
          linesArr.slice(list[i].line - 1, end - 1).join('\n')
        );
        buckets.push({
          chapter: {
            title: list[i].title,
            file,
            line: list[i].line,
            cjkCharacters: stats.cjkCharacters,
            estimatedWords: stats.estimatedWords,
            citations: 0,
            figures: 0,
            tables: 0,
            equations: 0,
          },
          start: list[i].line,
          end,
        });
      }
    }
    chapters.push(...buckets.map((b) => b.chapter));
    chapters.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
    attributeEntries(index, (file, line) => {
      const b = buckets.find(
        (x) => x.chapter.file === file && line >= x.start && line < x.end
      );
      return b?.chapter ?? null;
    }, chapters);
  }

  const bibKeys = new Set(index.bibEntries.map((b) => b.key));
  const labelKeys = new Set(index.labels.map((l) => l.key));

  const diagnostics = { errors: 0, warnings: 0, infos: 0 };
  for (const d of index.diagnostics) {
    if (d.severity === 'error') diagnostics.errors++;
    else if (d.severity === 'warning') diagnostics.warnings++;
    else diagnostics.infos++;
  }

  return {
    structure: { chapters: chapters.length, sections: index.sections.length },
    content,
    assets: {
      figures: index.figures.length,
      tables: index.tables.length,
      equations: index.equations.length,
    },
    references: {
      citations: index.citations.length,
      bibEntries: index.bibEntries.length,
      undefinedCitations: distinctKeysNotIn(index.citations, bibKeys),
      undefinedReferences: distinctKeysNotIn(index.references, labelKeys),
    },
    diagnostics,
    chapters,
  };
}

function attributeEntries(
  index: ProjectIndex,
  ownerOf: (file: string, line: number) => PaperOverviewChapter | null,
  chapters: PaperOverviewChapter[]
): void {
  void chapters;
  const bump = (fn: (c: PaperOverviewChapter) => void, file: string, line: number) => {
    const c = ownerOf(file, line);
    if (c) fn(c);
  };
  for (const fig of index.figures) bump((c) => c.figures++, fig.file, fig.line);
  for (const t of index.tables) bump((c) => c.tables++, t.file, t.line);
  for (const eq of index.equations) bump((c) => c.equations++, eq.file, eq.line);
  for (const cit of index.citations) bump((c) => c.citations++, cit.file, cit.line);
}
