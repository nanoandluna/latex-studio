import { projectIndexService } from './projectIndexService.js';
import { stripComments } from '@latex-studio/latex-parser';
import type {
  CitationEntryView,
  CitationUsage,
  CitationWorkspaceResponse,
  ProjectIndex,
  SectionEntry,
} from '@latex-studio/shared';

/**
 * V0.5-PLAN 2 — Citation Workspace model.
 *
 * Single-source rule (see the audit in the plan): keys and their usages come
 * from `index.citations`, bib metadata from `index.bibEntries`. Nothing here
 * re-parses a .tex or .bib file; the only extra reads are the indexer's cached
 * file contents, for the one-line citation context.
 */

const CONTEXT_MAX = 140;

/** Nearest preceding heading at the given level-or-shallower, if any. */
function nearestHeading(
  sorted: SectionEntry[],
  line: number,
  maxLevel: number
): SectionEntry | null {
  let best: SectionEntry | null = null;
  for (const s of sorted) {
    if (s.line > line) break;
    if (s.level <= maxLevel) best = s;
  }
  return best;
}

function contextFor(contents: Map<string, string>, file: string, line: number): string {
  const raw = (contents.get(file) ?? '').split(/\r?\n/)[line - 1] ?? '';
  const cleaned = stripComments(raw).trim();
  return cleaned.length > CONTEXT_MAX ? `${cleaned.slice(0, CONTEXT_MAX - 1)}…` : cleaned;
}

export async function buildCitationWorkspace(): Promise<CitationWorkspaceResponse> {
  if (projectIndexService.needsRebuild()) await projectIndexService.refresh();
  const index: ProjectIndex | null = projectIndexService.getSnapshot();
  if (!index) {
    return {
      counts: { all: 0, used: 0, unused: 0, undefined: 0, duplicate: 0 },
      entries: [],
    };
  }

  // cached contents only for the context line
  const touchedFiles = [...new Set(index.citations.map((c) => c.file))];
  const contents = new Map<string, string>();
  for (const rel of touchedFiles) {
    const text = await projectIndexService.getFileContent(rel);
    if (text !== null) contents.set(rel, text);
  }

  // per-file sorted section lists for the usage's chapter/section context
  const sectionsByFile = new Map<string, SectionEntry[]>();
  for (const s of index.sections) {
    const list = sectionsByFile.get(s.file) ?? [];
    list.push(s);
    sectionsByFile.set(s.file, list);
  }
  for (const list of sectionsByFile.values()) list.sort((a, b) => a.line - b.line);
  const chapterLevel = (() => {
    const levels = [...new Set(index.sections.map((s) => s.level))].sort((a, b) => a - b);
    return levels.includes(1) ? 1 : (levels[0] ?? 2);
  })();

  // group usages by key, in document order
  const usages = new Map<string, CitationUsage[]>();
  for (const c of index.citations) {
    const list = usages.get(c.key) ?? [];
    list.push({ file: c.file, line: c.line, column: c.column, context: contextFor(contents, c.file, c.line) });
    usages.set(c.key, list);
  }
  for (const list of usages.values()) {
    list.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
  }

  // bib metadata: first definition wins for display; the parser flags
  // duplicate keys on the surviving entry
  const bibByKey = new Map<string, { author?: string; title?: string; year?: string; file: string; line: number }>();
  const duplicateKeys = new Set<string>();
  for (const b of index.bibEntries) {
    if (b.duplicate) duplicateKeys.add(b.key);
    if (!bibByKey.has(b.key)) {
      bibByKey.set(b.key, { author: b.author, title: b.title, year: b.year, file: b.file, line: b.line });
    }
  }

  const entries: CitationEntryView[] = [];
  for (const [key, list] of usages) {
    const bib = bibByKey.get(key);
    const sortedSections = sectionsByFile.get(list[0].file);
    const first = list[0];
    const usageContext = (u: CitationUsage): CitationUsage => {
      const sorted = sectionsByFile.get(u.file);
      return {
        ...u,
        section: sorted ? (nearestHeading(sorted, u.line, Number.MAX_SAFE_INTEGER)?.title ?? undefined) : undefined,
        chapter: sorted ? (nearestHeading(sorted, u.line, chapterLevel)?.title ?? undefined) : undefined,
      };
    };
    entries.push({
      key,
      used: list.length > 0 && bibByKey.has(key),
      undefinedKey: !bibByKey.has(key),
      duplicate: duplicateKeys.has(key),
      usageCount: list.length,
      author: bib?.author,
      title: bib?.title,
      year: bib?.year,
      bibFile: bib?.file,
      bibLine: bib?.line,
      firstUsage: usageContext(first),
      usages: list.map(usageContext),
    });
  }

  // keys that only exist in the bib and were never cited
  const unusedEntries: CitationEntryView[] = [];
  for (const [key, bib] of bibByKey) {
    if (usages.has(key)) continue;
    unusedEntries.push({
      key,
      used: false,
      undefinedKey: false,
      duplicate: duplicateKeys.has(key),
      usageCount: 0,
      author: bib.author,
      title: bib.title,
      year: bib.year,
      bibFile: bib.file,
      bibLine: bib.line,
      firstUsage: null,
      usages: [],
    });
  }

  // cited entries in reading order, then unused in bib order, undefined last
  const undefinedKeyFirst = (e: CitationEntryView) => (e.undefinedKey ? 1 : 0);
  entries.sort((a, b) => {
    if (undefinedKeyFirst(a) !== undefinedKeyFirst(b)) return undefinedKeyFirst(a) - undefinedKeyFirst(b);
    const fa = a.firstUsage;
    const fb = b.firstUsage;
    if (fa && fb) return fa.file === fb.file ? fa.line - fb.line : fa.file.localeCompare(fb.file);
    if (fa) return -1;
    if (fb) return 1;
    return a.key.localeCompare(b.key);
  });
  unusedEntries.sort((a, b) =>
    (a.bibFile ?? '').localeCompare(b.bibFile ?? '') || (a.bibLine ?? 0) - (b.bibLine ?? 0)
  );
  entries.push(...unusedEntries);

  const used = entries.filter((e) => e.used).length;
  return {
    counts: {
      all: entries.length,
      used,
      unused: unusedEntries.length,
      undefined: entries.filter((e) => e.undefinedKey).length,
      duplicate: entries.filter((e) => e.duplicate).length,
    },
    entries,
  };
}
