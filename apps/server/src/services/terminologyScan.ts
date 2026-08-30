import { projectIndexService } from './projectIndexService.js';
import { readTerms } from './terminologyStore.js';
import type { TerminologyHit, TerminologyTerm } from '@latex-studio/shared';

/**
 * V0.5-PLAN 4 — rule-based terminology consistency scan. No AI: a hit is a
 * whole-word, case-insensitive occurrence of a variant or forbidden form in
 * comment-stripped body text. Word boundaries use the neighbouring character,
 * which works for both latin ("mmWaveX" ≠ "mmWave") and CJK variants.
 */

const MAX_CONTEXT = 160;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** All occurrences of needle (case-insensitive, word-bounded) on one line. */
function occurrences(line: string, needle: string): number[] {
  const lower = line.toLowerCase();
  const target = needle.toLowerCase();
  const out: number[] = [];
  let from = 0;
  for (;;) {
    const at = lower.indexOf(target, from);
    if (at === -1) break;
    from = at + target.length;
    const before = at > 0 ? line[at - 1] : '';
    const after = line[at + target.length] ?? '';
    const wordish = (ch: string) => /[A-Za-z0-9_]/.test(ch);
    if (wordish(before) || wordish(after)) continue; // inside a longer word
    out.push(at);
  }
  return out;
}

export async function scanTerminology(): Promise<{
  hits: TerminologyHit[];
  scannedFiles: number;
  terms: TerminologyTerm[];
}> {
  const terms = await readTerms();
  const patterns: { term: TerminologyTerm; needle: string; forbidden: boolean }[] = [];
  for (const t of terms) {
    for (const v of t.variants) patterns.push({ term: t, needle: v, forbidden: false });
    for (const v of t.forbidden ?? []) patterns.push({ term: t, needle: v, forbidden: true });
    // an acronym is a variant too when it differs from the preferred form
    if (t.acronym && t.acronym.toLowerCase() !== t.preferred.toLowerCase()) {
      patterns.push({ term: t, needle: t.acronym, forbidden: false });
    }
  }
  if (patterns.length === 0) return { hits: [], scannedFiles: 0, terms };

  if (projectIndexService.needsRebuild()) await projectIndexService.refresh();
  const index = projectIndexService.getSnapshot();
  if (!index) return { hits: [], scannedFiles: 0, terms };

  const texFiles = index.files.filter((f) => f.endsWith('.tex'));
  const hits: TerminologyHit[] = [];
  for (const rel of texFiles) {
    const text = await projectIndexService.getFileContent(rel);
    if (text === null) continue;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      // raw line for column math, comment-stripped line for matching
      const stripped = lines[i].replace(/(?<!\\)%.*$/, '');
      if (stripped.trim() === '') continue;
      for (const p of patterns) {
        for (const col of occurrences(stripped, p.needle)) {
          hits.push({
            preferred: p.term.preferred,
            matched: p.needle,
            forbidden: p.forbidden,
            file: rel,
            line: i + 1,
            column: col + 1,
            context: stripped.trim().slice(0, MAX_CONTEXT),
          });
        }
      }
    }
  }
  hits.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
  return { hits, scannedFiles: texFiles.length, terms };
}
