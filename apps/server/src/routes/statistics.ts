import type { FastifyInstance } from 'fastify';
import { projectIndexService } from '../services/projectIndexService.js';
import { analyzeTextStatistics, type TextStatsResult } from '@latex-studio/latex-parser';
import type { SectionEntry } from '@latex-studio/shared';

const EMPTY_STATS: TextStatsResult = {
  cjkCharacters: 0,
  latinWords: 0,
  numericTokens: 0,
  whitespaceTokens: 0,
  visibleCharacters: 0,
  sourceCharacters: 0,
  estimatedWords: 0,
  equations: 0,
};

function addStats(a: TextStatsResult, b: TextStatsResult): TextStatsResult {
  return {
    cjkCharacters: a.cjkCharacters + b.cjkCharacters,
    latinWords: a.latinWords + b.latinWords,
    numericTokens: a.numericTokens + b.numericTokens,
    whitespaceTokens: a.whitespaceTokens + b.whitespaceTokens,
    visibleCharacters: a.visibleCharacters + b.visibleCharacters,
    sourceCharacters: a.sourceCharacters + b.sourceCharacters,
    estimatedWords: a.estimatedWords + b.estimatedWords,
    equations: a.equations + b.equations,
  };
}

/**
 * V0.4-PLAN 3.2 — attribute text to the section that actually contains it.
 *
 * Each section owns the half-open range [line, nextSectionAtSameOrShallowerLevel).
 * In other words a section INCLUDES its subsections, which is what makes a
 * chapter's count meaningful: stopping at the next section of any level would
 * hand a chapter's own prose to its first subsection and leave the chapter
 * itself looking nearly empty.
 *
 * Text before the first section (preamble, front matter) is deliberately not
 * attributed to any section — the counting model excludes the preamble — so
 * section totals sum to less than the project total and never double-count.
 */
function sliceForRange(lines: string[], startLine: number, endLineExclusive: number): string {
  return lines.slice(Math.max(0, startLine - 1), Math.max(0, endLineExclusive - 1)).join('\n');
}

interface SectionStat {
  title: string;
  level: number;
  file: string;
  line: number;
  stats: TextStatsResult;
}

export async function registerStatisticsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Paper statistics — three aggregation levels (project / chapter / section).
   * Per-file content is read once and reused for every level; the section
   * breakdown comes from line ranges in the Project Graph, not a second walk.
   */
  app.get('/api/statistics', async () => {
    if (projectIndexService.needsRebuild()) await projectIndexService.refresh();
    const index = projectIndexService.getSnapshot();
    if (!index) return { project: EMPTY_STATS, chapters: [], sections: [], files: [] };

    const texFiles = index.files.filter((f) => f.endsWith('.tex'));

    // Text comes from the indexer's content cache (buffer-aware, mtime-keyed),
    // so a repeat call costs no disk I/O and no second walk.
    const contents = new Map<string, string>();
    const fileStats: { path: string; stats: TextStatsResult }[] = [];
    let project = { ...EMPTY_STATS };

    for (const rel of texFiles) {
      const content = await projectIndexService.getFileContent(rel);
      if (content === null) continue;
      contents.set(rel, content);
      const stats = analyzeTextStatistics(content);
      fileStats.push({ path: rel, stats });
      project = addStats(project, stats);
    }

    // group sections per file so ranges never span file boundaries
    const byFile = new Map<string, SectionEntry[]>();
    for (const s of index.sections) {
      if (!contents.has(s.file)) continue;
      const list = byFile.get(s.file) ?? [];
      list.push(s);
      byFile.set(s.file, list);
    }

    const sections: SectionStat[] = [];
    for (const [file, list] of byFile) {
      const content = contents.get(file) ?? '';
      const lines = content.split(/\r?\n/);
      list.sort((a, b) => a.line - b.line);
      for (let i = 0; i < list.length; i++) {
        const start = list[i].line;
        let end = lines.length + 1;
        for (let j = i + 1; j < list.length; j++) {
          if (list[j].level <= list[i].level) {
            end = list[j].line;
            break;
          }
        }
        sections.push({
          title: list[i].title,
          level: list[i].level,
          file,
          line: start,
          stats: analyzeTextStatistics(sliceForRange(lines, start, end)),
        });
      }
    }
    sections.sort((a, b) =>
      a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)
    );

    // Chapter level: real \chapter when the document has one, otherwise the
    // shallowest section level present (the article/book degenerate case).
    const levels = [...new Set(sections.map((s) => s.level))].sort((a, b) => a - b);
    const chapterLevel = levels.includes(1) ? 1 : (levels[0] ?? 2);
    const chapters = sections
      .filter((s) => s.level === chapterLevel)
      .map((s) => ({
        title: s.title,
        file: s.file,
        line: s.line,
        stats: s.stats,
      }));

    return {
      project: {
        ...project,
        figures: index.figures.length,
        tables: index.tables.length,
        sections: index.sections.length,
        citations: index.citations.length,
        bibEntries: index.bibEntries.length,
      },
      chapters,
      sections,
      files: fileStats,
    };
  });
}
