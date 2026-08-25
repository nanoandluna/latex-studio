import fs from 'node:fs';

let c = fs.readFileSync('apps/server/src/routes/index.ts', 'utf8');
c = c.replace(/    console\.error\('\[upd\] ws='.*\n/, '');
c = c.replace(/          if \(process\.env\.LS_DEBUG\) console\.error\('\[upd\] store size after'.*\n/, '');
c = c.replace(/          console\.error\('\[upd\] buffered\?'.*\n/, '');
fs.writeFileSync('apps/server/src/routes/index.ts', c);

let s = fs.readFileSync('apps/server/src/services/projectIndexService.ts', 'utf8');
s = s.replace(/        if \(process\.env\.LS_DEBUG && rel==='chapters\/ch000\.tex'\) console\.error.*\n/, '');
fs.writeFileSync('apps/server/src/services/projectIndexService.ts', s);

console.log(
  'clean:',
  !/upd\]|map size/.test(fs.readFileSync('apps/server/src/routes/index.ts', 'utf8')) &&
    !/ch000\.tex'\) console/.test(fs.readFileSync('apps/server/src/services/projectIndexService.ts', 'utf8'))
);
