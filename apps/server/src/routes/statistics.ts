import type { FastifyInstance } from 'fastify';
import { projectIndexService } from '../services/projectIndexService.js';
import { analyzeTextStatistics, type TextStatsResult } from '@latex-studio/latex-parser';
import {
  assembleFromIndex,
  chapterLevelOf,
  sectionRanges,
  sliceText,
} from '../services/chapterAssembly.js';
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
   * Per-file content is read once and reused for every level. Since V0.5.1
   * the section/chapter breakdown comes from the assembled document (include
   * graph from mainFile, see chapterAssembly.ts) — chapters span \input'd
   * files, and Paper Overview shares the exact same semantics. Files not
   * reachable from mainFile fall back to per-file intervals.
   */
  app.get('/api/statistics', async () => {
    if (projectIndexService.needsRebuild()) await projectIndexService.refresh();
    const index = projectIndexService.getSnapshot();
    if (!index) return { project: EMPTY_STATS, chapters: [], sections: [], files: [] };

    const texFiles = index.files.filter((f) => f.endsWith('.tex'));

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

    let sections: SectionStat[];
    let chapters: { title: string; file: string; line: number; stats: TextStatsResult }[];

    const { assembly } = await assembleFromIndex(index);
    if (assembly) {
      const ranges = sectionRanges(assembly.sections, assembly.lines.length);
      sections = ranges.map((r) => ({
        title: r.section.title,
        level: r.section.level,
        file: r.section.file,
        line: r.section.line,
        stats: analyzeTextStatistics(sliceText(assembly.lines, r.start, r.end)),
      }));
      const level = chapterLevelOf(assembly.sections);
      chapters = sections
        .filter((s) => s.level === level)
        .map((s) => ({ title: s.title, file: s.file, line: s.line, stats: s.stats }));
    } else {
      // no mainFile → per-file intervals (legacy semantics)
      const byFile = new Map<string, SectionEntry[]>();
      for (const s of index.sections) {
        if (!contents.has(s.file)) continue;
        const list = byFile.get(s.file) ?? [];
        list.push(s);
        byFile.set(s.file, list);
      }
      sections = [];
      for (const [file, list] of byFile) {
        const lines = (contents.get(file) ?? '').split(/\r?\n/);
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
            stats: analyzeTextStatistics(
              lines.slice(Math.max(0, start - 1), Math.max(0, end - 1)).join('\n')
            ),
          });
        }
      }
      sections.sort((a, b) =>
        a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)
      );
      const levels = [...new Set(sections.map((s) => s.level))].sort((a, b) => a - b);
      const chapterLevel = levels.includes(1) ? 1 : (levels[0] ?? 2);
      chapters = sections
        .filter((s) => s.level === chapterLevel)
        .map((s) => ({ title: s.title, file: s.file, line: s.line, stats: s.stats }));
    }

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
