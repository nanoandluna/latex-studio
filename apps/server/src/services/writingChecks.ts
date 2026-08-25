import type { WritingDiagnostic } from '@latex-studio/shared';
import { stripComments } from '@latex-studio/latex-parser';

/**
 * V0.3 rule-based academic-writing checks. Local-only, deterministic,
 * severity-tiered (never "error") and toggleable per client.
 */

const MAX_SENTENCE_WORDS = 45;

export function analyzeWriting(content: string, file: string): WritingDiagnostic[] {
  const out: WritingDiagnostic[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = stripComments(raw);

    // TODO / FIXME markers
    const todo = line.match(/\b(TODO|FIXME)\b:??(.*)/);
    if (todo) {
      out.push({
        code: 'TODO_FIXME',
        severity: 'warning',
        message: `${todo[1]}: ${(todo[2] ?? '').trim().slice(0, 60) || 'unresolved note'}`,
        file,
        line: i + 1,
      });
    }

    // repeated words ("the the", "is is") — letters only, ignore commands
    const plain = line.replace(/\\[a-zA-Z]+/g, ' ');
    const rep = plain.match(/\b([A-Za-z]{3,})(\s+\1\b)+/i);
    if (rep) {
      out.push({
        code: 'REPEATED_WORD',
        severity: 'warning',
        message: `Repeated word "${rep[1]}"`,
        file,
        line: i + 1,
      });
    }

    // suspicious punctuation
    if (/\.\.(?!\.)|\?\?|!!/.test(line)) {
      out.push({
        code: 'SUSPICIOUS_PUNCTUATION',
        severity: 'info',
        message: 'Suspicious punctuation sequence',
        file,
        line: i + 1,
      });
    }

    // very long sentence (rough split on sentence enders)
    for (const sentence of line.split(/[.!?]\s+/)) {
      const words = sentence.trim().split(/\s+/).filter(Boolean);
      if (words.length > MAX_SENTENCE_WORDS) {
        out.push({
          code: 'LONG_SENTENCE',
          severity: 'info',
          message: `Very long sentence (${words.length} words) — consider splitting`,
          file,
          line: i + 1,
        });
        break; // one flag per line
      }
    }
  }

  // empty sections: heading with no content before the next heading/end
  const headingRe = /\\(?:part|chapter|section|subsection|subsubsection)\*?\s*\{/;
  for (let i = 0; i < lines.length; i++) {
    if (!headingRe.test(stripComments(lines[i]))) continue;
    let j = i + 1;
    let hasBody = false;
    while (j < lines.length) {
      const l = stripComments(lines[j]).trim();
      if (l === '') {
        j++;
        continue;
      }
      if (headingRe.test(l) || /\\end\{document\}/.test(l)) break;
      hasBody = true;
      break;
    }
    if (!hasBody) {
      out.push({
        code: 'EMPTY_SECTION',
        severity: 'warning',
        message: 'Section has no body text before the next section',
        file,
        line: i + 1,
      });
    }
  }

  return out;
}
