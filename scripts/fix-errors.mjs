import fs from 'node:fs';

const files = [
  'apps/server/src/routes/files.ts',
  'apps/server/src/routes/workspace.ts',
];

for (const f of files) {
  let c = fs.readFileSync(f, 'utf8');
  // Replace simple string errors with structured ones
  c = c.replace(
    /\{ error: '([^']+)' \}/g,
    "{ error: { code: 'INVALID_ARGUMENT', message: '$1' } }"
  );
  fs.writeFileSync(f, c);
}
console.log('done');
