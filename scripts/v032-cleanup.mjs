import fs from 'node:fs';

// 1) graph.ts — remove dead citedKeys
let g = fs.readFileSync('packages/latex-parser/src/graph.ts', 'utf8');
g = g.replace(/  const citedKeys = new Set\(index\.citations\.map\(\(c\) => c\.key\)\);\r?\n/, '');
g = g.replace(/\r?\n\s*void citedKeys;/, '');
fs.writeFileSync('packages/latex-parser/src/graph.ts', g);

// 2) templates.ts — drop unused fs import + void marker
let t = fs.readFileSync('apps/server/src/routes/templates.ts', 'utf8');
t = t.replace(/import fs from 'node:fs';\r?\n/, '');
t = t.replace(/\r?\n\/\/ keep fs import used for the existsSync re-export guard above\r?\nvoid fs;/, '');
fs.writeFileSync('apps/server/src/routes/templates.ts', t);

// 3) real-latex.test.ts — clean void leftovers
let r = fs.readFileSync('apps/server/test/real-latex.test.ts', 'utf8');
r = r.replace(
  /    const \{ parseTexDocument, parseStructure \} = await import\('@latex-studio\/latex-parser'\);\r?\n    void parseTexDocument;/,
  "    const { parseStructure } = await import('@latex-studio/latex-parser');"
);
r = r.replace(/\r?\n\s*void mainSrc;/, '');
// mainSrc itself is now only read (void'd earlier); keep the read usage
fs.writeFileSync('apps/server/test/real-latex.test.ts', r);

// 4) workspaceService — remove dead collectBibKeys/collectLabels methods
let w = fs.readFileSync('apps/server/src/services/workspaceService.ts', 'utf8');
const start = w.indexOf('  /** Scan every .bib file in the workspace for citation keys. */');
if (start !== -1) {
  const endMarker = '\n  private async forEachFile(';
  const end = w.indexOf(endMarker, start);
  if (end !== -1) {
    w = w.slice(0, start) + w.slice(end + 1);
  }
}
// remove now-unused parseBibKeys import if present
w = w.replace(/,\r?\n  parseBibKeys,?\r?\n\}/, '\n}');
w = w.replace(/  parseBibKeys,\r?\n/, '');
fs.writeFileSync('apps/server/src/services/workspaceService.ts', w);

console.log('cleaned');
