import fs from 'node:fs';

// largeProject: update endpoint returns envelope now
let c = fs.readFileSync('apps/server/test/largeProject.perf.test.ts', 'utf8');
c = c.replace(
  '      const idx = res.json();',
  '      const body2 = res.json();\n      const idx = body2.graph ?? body2;'
);
fs.writeFileSync('apps/server/test/largeProject.perf.test.ts', c);

// performance.matrix: robust extraction + debug output
c = fs.readFileSync('apps/server/test/performance.matrix.test.ts', 'utf8');
c = c.replace(
  '      const idx = res.json().graph;',
  `      const body3 = res.json();
      const idx = body3.graph ?? body3;
      if (!idx?.sections) {
        console.error('[dbg] update response keys:', Object.keys(body3), 'status', res.statusCode);
      }`
);
fs.writeFileSync('apps/server/test/performance.matrix.test.ts', c);

console.log('patched');
