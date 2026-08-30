import { projectIndexService } from './projectIndexService.js';
import { analyzeTextStatistics } from '@latex-studio/latex-parser';
import type { PaperOverview, PaperOverviewChapter, ProjectIndex, SectionEntry } from '@latex-studio/shared';

/**
 * V0.5-PLAN 1 — Paper Overview.
 *
 * Everything comes from the existing Project Graph snapshot and the indexer's
 * content cache; there is no second walk of the workspace. Chapter attribution
 * reuses the statistics interval semantics: a section owns
 * [line, next section at same-or-shallower level) within its own file, and
 * entries before the first section belong to no chapter.
 */

interface ChapterInterval {
  chapter: PaperOverviewChapter;
  endLineExclusive: number;
}

/** Same interval rule as the statistics route: level ≤ own ends the range. */
function chapterIntervals(
  sections: SectionEntry[],
  fileEndLine: (file: string) => number
): Map<string, ChapterInterval[]> {
  const byFile = new Map<string, SectionEntry[]>();
  for (const s of sections) {
    const list = byFile.get(s.file) ?? [];
    list.push(s);
    byFile.set(s.file, list);
  }
  const out = new Map<string, ChapterInterval[]>();
  const levels = [...new Set(sections.map((s) => s.level))].sort((a, b) => a - b);
  const chapterLevel = levels.includes(1) ? 1 : (levels[0] ?? 2);
  for (const [file, list] of byFile) {
    list.sort((a, b) => a.line - b.line);
    const intervals: ChapterInterval[] = [];
    for (let i = 0; i < list.length; i++) {
      if (list[i].level !== chapterLevel) continue;
      let end = fileEndLine(file) + 1;
      for (let j = i + 1; j < list.length; j++) {
        if (list[j].level <= list[i].level) {
          end = list[j].line;
          break;
        }
      }
      intervals.push({
        endLineExclusive: end,
        chapter: {
          title: list[i].title,
          file,
          line: list[i].line,
          cjkCharacters: 0,
          estimatedWords: 0,
          citations: 0,
          figures: 0,
          tables: 0,
          equations: 0,
        },
      });
    }
    out.set(file, intervals);
  }
  return out;
}

/** Chapter the (file, line) falls into, or null for pre-section content. */
function ownerOf(
  intervals: Map<string, ChapterInterval[]>,
  file: string,
  line: number
): PaperOverviewChapter | null {
  for (const iv of intervals.get(file) ?? []) {
    if (line >= iv.chapter.line && line < iv.endLineExclusive) return iv.chapter;
  }
  return null;
}

function distinctKeysNotIn(
  entries: { key: string }[],
  known: Set<string>
): number {
  return new Set(entries.map((e) => e.key).filter((k) => !known.has(k))).size;
}

export async function buildPaperOverview(): Promise<PaperOverview> {
  if (projectIndexService.needsRebuild()) await projectIndexService.refresh();
  const index: ProjectIndex | null = projectIndexService.getSnapshot();
  if (!index) {
    return {
      structure: { chapters: 0, sections: 0 },
      content: { cjkCharacters: 0, latinWords: 0, estimatedWords: 0 },
      assets: { figures: 0, tables: 0, equations: 0 },
      references: { citations: 0, bibEntries: 0, undefinedCitations: 0, undefinedReferences: 0 },
      diagnostics: { errors: 0, warnings: 0, infos: 0 },
      chapters: [],
    };
  }

  const texFiles = index.files.filter((f) => f.endsWith('.tex'));

  // cached content per file: line counts for interval ends, text for word counts
  const contents = new Map<string, string>();
  let content = { cjkCharacters: 0, latinWords: 0, estimatedWords: 0 };
  for (const rel of texFiles) {
    const text = await projectIndexService.getFileContent(rel);
    if (text === null) continue;
    contents.set(rel, text);
    const stats = analyzeTextStatistics(text);
    content.cjkCharacters += stats.cjkCharacters;
    content.latinWords += stats.latinWords;
    content.estimatedWords += stats.estimatedWords;
  }

  const intervals = chapterIntervals(
    index.sections,
    (f) => contents.get(f)?.split(/\r?\n/).length ?? 0
  );

  // chapter word counts use the statistics slice: [line, next same-or-shallower)
  for (const [file, list] of intervals) {
    const lines = (contents.get(file) ?? '').split(/\r?\n/);
    for (const iv of list) {
      const slice = lines.slice(iv.chapter.line - 1, iv.endLineExclusive - 1).join('\n');
      const stats = analyzeTextStatistics(slice);
      iv.chapter.cjkCharacters = stats.cjkCharacters;
      iv.chapter.estimatedWords = stats.estimatedWords;
    }
  }
  const chapters = [...intervals.values()].flat().map((iv) => iv.chapter);
  chapters.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));

  // attribute graph entries to their chapters by (file, line)
  const bump = (fn: (c: PaperOverviewChapter) => void, file: string, line: number) => {
    const c = ownerOf(intervals, file, line);
    if (c) fn(c);
  };
  for (const fig of index.figures) bump((c) => c.figures++, fig.file, fig.line);
  for (const t of index.tables) bump((c) => c.tables++, t.file, t.line);
  for (const eq of index.equations) bump((c) => c.equations++, eq.file, eq.line);
  for (const cit of index.citations) bump((c) => c.citations++, cit.file, cit.line);

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
