import type { Problem } from '@latex-studio/shared';

export interface LogParseResult {
  problems: Problem[];
}

const MAX_LOOKAHEAD = 12;

/**
 * Track which source files are open in the log by counting parentheses,
 * the classic TeX log-walking heuristic:
 *   (./main.tex (./sections/intro.tex ... ) ...)
 */
function updateFileStack(line: string, stack: string[]): void {
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '(') {
      let j = i + 1;
      while (j < line.length && !/[\s()]/.test(line[j])) j++;
      const token = line.slice(i + 1, j);
      if (token.length > 0 && /\.(tex|ltx|sty|cls|clo|fd|def|cfg)$/i.test(token)) {
        stack.push(normalizePath(token));
      } else {
        stack.push(''); // unnamed group
      }
      i = j;
    } else if (ch === ')') {
      if (stack.length > 0) stack.pop();
      i++;
    } else {
      i++;
    }
  }
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function lastRealFile(stack: string[]): string | undefined {
  for (let k = stack.length - 1; k >= 0; k--) {
    if (stack[k]) return stack[k];
  }
  return undefined;
}

/**
 * Parse a full LaTeX .log content into structured problems.
 * Covers: errors (l.NN), file-not-found, citation/reference warnings
 * (LaTeX & package level), generic package/latex warnings, overfull/underfull.
 */
export function parseLatexLog(log: string): LogParseResult {
  const problems: Problem[] = [];
  const eol = log.includes('\r\n') ? '\r\n' : '\n';
  const lines = log.split(eol);
  const fileStack: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];

    // ---- errors -------------------------------------------------------
    if (/^!/.test(raw)) {
      const message = raw.replace(/^!\s*/, '').trim();
      const isFatalSummary = /^!+\s*==>\s*Fatal error occurred/i.test(raw) || /^ ==> /.test(message);
      if (!isFatalSummary && !/^ ==> /.test(message)) {
        let line = 0;
        let snippet = '';
        for (let k = i + 1; k <= Math.min(i + MAX_LOOKAHEAD, lines.length - 1); k++) {
          const m = lines[k].match(/^l\.(\d+)\s?(.*)/);
          if (m) {
            line = parseInt(m[1], 10);
            snippet = m[2] ?? '';
            break;
          }
          if (lines[k].trim() === '' && k > i + 2) break;
        }
        problems.push({
          severity: 'error',
          message: snippet ? `${message} (${snippet.trim().slice(0, 80)})` : message,
          file: lastRealFile(fileStack),
          line: line || undefined,
        });
      }
      updateFileStack(raw, fileStack);
      i++;
      continue;
    }

    // ---- package errors ("!\ Package xxx Error" appears as "! Package x Error: ...")
    // handled above by the generic ! branch.

    // ---- warnings / info ------------------------------------------------
    let m: RegExpMatchArray | null;
    const file = () => lastRealFile(fileStack);

    if ((m = raw.match(/^(?:LaTeX|Package \w+) Warning: [Cc]itation `([^']+)'.*?input line (\d+)/))) {
      problems.push({ severity: 'warning', message: `Citation '${m[1]}' is undefined`, file: file(), line: parseInt(m[2], 10) });
    } else if ((m = raw.match(/^(?:LaTeX|Package \w+) Warning: [Rr]eference `([^']+)'.*?input line (\d+)/))) {
      problems.push({ severity: 'warning', message: `Reference '${m[1]}' is undefined`, file: file(), line: parseInt(m[2], 10) });
    } else if ((m = raw.match(/^Package ([\w@]+) Error: (.+?)(?: on input line (\d+))?\.?\s*$/))) {
      problems.push({
        severity: 'error',
        message: `${m[1]}: ${m[2]}`,
        file: file(),
        line: m[3] ? parseInt(m[3], 10) : undefined,
      });
    } else if ((m = raw.match(/^(?:LaTeX|Package [\w@]+) Warning: (.*?)(?: on input line (\d+))?\.\s*$/))) {
      problems.push({
        severity: 'warning',
        message: m[1],
        file: file(),
        line: m[2] ? parseInt(m[2], 10) : undefined,
      });
    } else if ((m = raw.match(/^Overfull \\hbox \(.*\) in .*at lines (\d+)/))) {
      problems.push({ severity: 'info', message: `Overfull hbox at line ${m[1]}`, file: file(), line: parseInt(m[1], 10) });
    } else if ((m = raw.match(/^Underfull \\hbox \(.*\) in .*at lines (\d+)/))) {
      problems.push({ severity: 'info', message: `Underfull hbox at line ${m[1]}`, file: file(), line: parseInt(m[1], 10) });
    }

    updateFileStack(raw, fileStack);
    i++;
  }

  return { problems };
}

/** Find main.log inside a directory listing (helper for services). */
export function findMainLogFile(files: string[]): string | null {
  return files.find((f) => f === 'main.log') ?? files.find((f) => f.endsWith('.log')) ?? null;
}
