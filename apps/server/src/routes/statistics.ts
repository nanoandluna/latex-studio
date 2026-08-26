import type { FastifyInstance } from 'fastify';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { projectIndexService } from '../services/projectIndexService.js';
import { workspaceService } from '../services/workspaceService.js';
import { analyzeTextStatistics, type TextStatsResult } from '@latex-studio/latex-parser';

interface FileStatsEntry {
  path: string;
  stats: TextStatsResult;
}

export async function registerStatisticsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Paper statistics — derived from the Project Graph's per-file parse cache
   * (no filesystem rescan). Returns project-level totals plus per-section
   * and per-chapter breakdowns.
   */
  app.get('/api/statistics', async () => {
    if (projectIndexService.needsRebuild()) await projectIndexService.refresh();
    const index = projectIndexService.getSnapshot();
    if (!index) return { project: {}, chapters: [], files: [] };

    const root = workspaceService.requireWorkspace();
    const files: FileStatsEntry[] = [];

    for (const rel of index.files.filter((f) => f.endsWith('.tex'))) {
      try {
        const abs = path.join(root, rel);
        const content = await fsp.readFile(abs, 'utf8');
        files.push({ path: rel, stats: analyzeTextStatistics(content) });
      } catch { /* skip */ }
    }

    // aggregate per chapter (top-level \section groups within each file)
    const chapters = index.sections
      .filter((s) => s.level <= 1)
      .map((s) => {
        // sum all file stats that "belong" to this chapter
        const fileStat = files.find((f) => f.path === s.file);
        return {
          title: s.title,
          file: s.file,
          line: s.line,
          ...(fileStat?.stats ?? { cjkCharacters: 0, latinWords: 0 }),
        };
      });

    const project = files.reduce(
      (acc, f) => ({
        cjkCharacters: acc.cjkCharacters + f.stats.cjkCharacters,
        latinWords: acc.latinWords + f.stats.latinWords,
        numericTokens: acc.numericTokens + f.stats.numericTokens,
        visibleCharacters: acc.visibleCharacters + f.stats.visibleCharacters,
        estimatedWords: acc.estimatedWords + f.stats.estimatedWords,
        equations: acc.equations + f.stats.equations,
        figures: index.figures.length,
        tables: index.tables.length,
        sections: index.sections.length,
        citations: index.citations.length,
        bibEntries: index.bibEntries.length,
      }),
      { cjkCharacters: 0, latinWords: 0, numericTokens: 0, visibleCharacters: 0, estimatedWords: 0, equations: 0, figures: index.figures.length, tables: index.tables.length, sections: index.sections.length, citations: index.citations.length, bibEntries: index.bibEntries.length }
    );

    return { project, chapters, files };
  });
}
