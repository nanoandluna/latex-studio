import * as m from './src/index.js';

const main = m.parseTexDocument({
  path: 'main.tex',
  content: '\\section{A}\\label{l1}\n\\ref{ghost}\n\\input{missing}\n',
});
const idx = m.assembleProjectIndex([main], [], 'main.tex');
const diags = m.deriveGraphDiagnostics(idx);
console.log('codes:', diags.map((d) => d.code).join(','));
const q = new m.ProjectGraphQuery(idx);
console.log('unused:', JSON.stringify(q.getUnusedLabels().map((l) => l.key)));
console.log('missingInc:', q.getMissingIncludes().length);
