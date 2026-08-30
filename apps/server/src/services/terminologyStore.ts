import { promises as fs } from 'node:fs';
import path from 'node:path';
import { safeResolve } from '../utils/paths.js';
import { workspaceService } from './workspaceService.js';
import type { TerminologyTerm } from '@latex-studio/shared';

/**
 * V0.5-PLAN 4 — user terminology list, persisted per workspace at
 * `<ws>/.latex-studio/terminology.json` (inside the watcher-ignore zone).
 * The list is user data; the rule-based scan that consumes it lives in
 * terminologyScan.ts.
 */

const FILE = () => {
  const root = workspaceService.requireWorkspace();
  return safeResolve(root, path.join('.latex-studio', 'terminology.json'));
};

export async function readTerms(): Promise<TerminologyTerm[]> {
  try {
    const raw = await fs.readFile(FILE(), 'utf8');
    const parsed = JSON.parse(raw) as { terms?: TerminologyTerm[] };
    return (Array.isArray(parsed.terms) ? parsed.terms : []).filter(
      (t) => typeof t.preferred === 'string' && t.preferred.trim() !== ''
    );
  } catch {
    return []; // missing or corrupt file = empty glossary
  }
}

export async function writeTerms(terms: TerminologyTerm[]): Promise<TerminologyTerm[]> {
  const cleaned = terms
    .map((t) => ({
      preferred: String(t.preferred ?? '').trim(),
      variants: (Array.isArray(t.variants) ? t.variants : [])
        .map((v) => String(v).trim())
        .filter((v) => v !== '' && v.toLowerCase() !== String(t.preferred ?? '').trim().toLowerCase()),
      acronym: t.acronym ? String(t.acronym).trim() : undefined,
      forbidden: (Array.isArray(t.forbidden) ? t.forbidden : [])
        .map((v) => String(v).trim())
        .filter((v) => v !== ''),
    }))
    .filter((t) => t.preferred !== '');
  await fs.mkdir(path.dirname(FILE()), { recursive: true });
  await fs.writeFile(FILE(), `${JSON.stringify({ terms: cleaned }, null, 2)}\n`, 'utf8');
  return cleaned;
}
