/**
 * Generate a large synthetic LaTeX project for performance/stability testing.
 *
 * Usage: node scripts/generate-large-project.mjs <targetDir> [sections=240]
 *
 * Structure:
 *   main.tex                 \input{chapters/chNNN} chain + bibliography
 *   chapters/chNNN.tex       \section + paragraphs + labels/refs/citations
 *   refs.bib                 N bib entries
 *   figures/*.png            tiny placeholder PNGs
 */
import fs from 'node:fs';
import path from 'node:path';

const target = process.argv[2];
const SECTION_COUNT = Number(process.argv[3] ?? 240);

if (!target || SECTION_COUNT < 1) {
  console.error('usage: node generate-large-project.mjs <dir> [sections]');
  process.exit(2);
}

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
  0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x03, 0x01, 0x01, 0x00, 0xc9, 0xfe, 0x92, 0xef, 0x00, 0x00, 0x00,
  0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.join(target, 'chapters'), { recursive: true });
fs.mkdirSync(path.join(target, 'figures'), { recursive: true });

const bibEntries = [];
for (let i = 1; i <= 200; i++) {
  bibEntries.push(
    `@article{key${i},\n  author = {Author${i}, A.},\n  title = {Paper number ${i}},\n  year = {${2000 + (i % 26)}},\n}`
  );
}
fs.writeFileSync(path.join(target, 'refs.bib'), bibEntries.join('\n\n') + '\n');

for (let i = 0; i < 12; i++) {
  fs.writeFileSync(path.join(target, 'figures', `fig${i}.png`), PNG);
}

const chapterInputs = [];
const FIG_REFS = ['fig:arch', 'fig:result', 'tab:conf'];

// One labeled anchor figure/table/equation set referenced everywhere
fs.writeFileSync(
  path.join(target, 'anchors.tex'),
  [
    '\\begin{figure}[h]\\caption{Architecture}\\label{fig:arch}\\end{figure}',
    '\\begin{figure}[h]\\caption{Result}\\label{fig:result}\\end{figure}',
    '\\begin{table}[h]\\caption{Confusion}\\label{tab:conf}\\end{table}',
    '\\begin{equation}\\label{eq:loss} L = \\sum_i (y_i - \\hat y_i)^2 \\end{equation}',
  ].join('\n')
);

for (let i = 0; i < SECTION_COUNT; i++) {
  const id = String(i).padStart(3, '0');
  const lines = [
    `\\section{Section ${id}}\\label{sec:s${i}}`,
    `This chapter cites key${(i % 200) + 1} and discusses Figure~\\ref{${FIG_REFS[i % FIG_REFS.length]}}.`,
    `Equation reference: \\eqref{eq:loss}. Table: \\ref{tab:conf}.`,
    `Lorem ipsum dolor sit amet ${i} consectetur adipiscing elit sed do eiusmod tempor.`,
  ];
  if (i % 25 === 0) {
    lines.push(`\\subsection{Subsection ${id}.1}\\label{sec:s${i}sub}`);
    lines.push('Subsection body text.');
  }
  // every 60th chapter plants ONE undefined reference for diagnostics checks
  if (i % 60 === 7) lines.push('\\ref{ghost:ref}');
  fs.writeFileSync(path.join(target, 'chapters', `ch${id}.tex`), lines.join('\n') + '\n');
  chapterInputs.push(`\\input{chapters/ch${id}}`);
}

fs.writeFileSync(
  path.join(target, 'main.tex'),
  [
    '\\documentclass{article}',
    '\\usepackage{amsmath}',
    '\\usepackage{graphicx}',
    '\\begin{document}',
    '\\title{Large Synthetic Project}',
    '\\maketitle',
    '\\input{anchors}',
    ...chapterInputs,
    '\\bibliographystyle{plain}',
    '\\bibliography{refs}',
    '\\end{document}',
  ].join('\n')
);

console.log(
  `generated ${SECTION_COUNT} chapters · ${bibEntries.length} bib entries · 12 figures at ${target}`
);
