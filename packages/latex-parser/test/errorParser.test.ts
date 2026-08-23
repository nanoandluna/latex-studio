import { describe, it, expect } from 'vitest';
import { parseLatexLog } from '../src/index.js';

const undefinedControlSeq = `This is XeTeX, Version 3.141592653-2.6 (TeX Live 2025)
(./main.tex
! Undefined control sequence.
l.127 \\textbb
              {hello}

? 
`;

const missingDollar = `(./main.tex
! Missing $ inserted.
<inserted text>
                $
l.15 cost is $5 for x and y

`;

const fileNotFound = `(./main.tex
! LaTeX Error: File \`figures/missing.png' not found.

See the LaTeX manual or LaTeX Companion for explanation.
Type  H <return>  for immediate help.
 ...                                              
                                                  
l.42 ...includegraphics{figures/missing.png}

`;

const citationWarning = `Package natbib Warning: Citation \`smith2025' on page 1 undefined on input line 203.
LaTeX Warning: Reference \`fig:plot' on page 1 undefined on input line 88.
LaTeX Warning: There were undefined references.
Overfull \\hbox (12.3pt too wide) in paragraph at lines 30--34
Underfull \\hbox (badness 2500) in paragraph at lines 40--44
! Package hyperref Error: Option clash for package hyperref.
`;

const nestedFile = `(./main.tex (./sections/method.tex
! Undefined control sequence.
l.9 \\badmacro

)
(./sections/result.tex) )`;

describe('parseLatexLog', () => {
  it('parses undefined control sequence with line number', () => {
    const { problems } = parseLatexLog(undefinedControlSeq);
    const err = problems.find((p) => p.severity === 'error');
    expect(err).toBeDefined();
    expect(err!.message).toContain('Undefined control sequence');
    expect(err!.line).toBe(127);
    expect(err!.file).toBe('main.tex');
  });

  it('parses missing $ inserted', () => {
    const { problems } = parseLatexLog(missingDollar);
    const err = problems.find((p) => p.severity === 'error');
    expect(err).toBeDefined();
    expect(err!.message).toContain('Missing $ inserted');
    expect(err!.line).toBe(15);
  });

  it('parses file not found error', () => {
    const { problems } = parseLatexLog(fileNotFound);
    const err = problems.find((p) => p.severity === 'error');
    expect(err).toBeDefined();
    expect(err!.message).toContain('not found');
    expect(err!.message).toContain('missing.png');
  });

  it('parses citation and reference warnings', () => {
    const { problems } = parseLatexLog(citationWarning);
    expect(problems.some((p) => p.message.includes('smith2025') && p.line === 203)).toBe(true);
    expect(problems.some((p) => p.message.includes('fig:plot') && p.severity === 'warning')).toBe(true);
    expect(problems.some((p) => p.severity === 'info' && p.message.includes('Overfull'))).toBe(true);
  });

  it('parses underfull hbox as info', () => {
    const { problems } = parseLatexLog(citationWarning);
    expect(problems.some((p) => p.severity === 'info' && p.message.includes('Underfull') && p.line === 40)).toBe(true);
  });

  it('parses package errors as errors', () => {
    const { problems } = parseLatexLog(citationWarning);
    expect(problems.some((p) => p.severity === 'error' && p.message.includes('hyperref'))).toBe(true);
  });

  it('attributes errors to the correct nested file', () => {
    const { problems } = parseLatexLog(nestedFile);
    const err = problems.find((p) => p.severity === 'error');
    expect(err!.file).toBe('sections/method.tex');
  });

  it('ignores fatal-error summary lines as separate errors', () => {
    const log = undefinedControlSeq + '\n!  ==> Fatal error occurred, no output PDF file produced!\n';
    const { problems } = parseLatexLog(log);
    expect(problems.filter((p) => p.severity === 'error')).toHaveLength(1);
  });

  it('returns empty for a clean log', () => {
    const log = 'This is XeTeX\n(./main.tex [1] [2] )\nOutput written on main.pdf (2 pages).\n';
    const { problems } = parseLatexLog(log);
    expect(problems.filter((p) => p.severity === 'error')).toHaveLength(0);
  });
});
