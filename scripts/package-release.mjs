import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'apps/server/package.json'));
const JSZip = require('jszip');
const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
const zip = new JSZip();
const prefix = `latex-studio-${version}`;
const excluded = new Set(['node_modules', '.git', '.build', '.latex-studio', 'test-results', 'playwright-report', '.vite', 'release']);
const include = ['apps', 'packages', 'templates', 'tests', 'scripts', 'docs', '.github',
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json', 'README.md', 'CHANGELOG.md', 'LICENSE', '.gitignore', '.gitattributes', 'start.cmd', 'start.sh'];
for (const file of ['apps/web/dist/index.html', 'apps/server/dist/server.js', 'packages/shared/dist/index.js', 'packages/latex-parser/dist/index.js']) {
  await fs.access(path.join(root, file));
}
async function add(relative) {
  const absolute = path.join(root, relative);
  const stat = await fs.lstat(absolute);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    for (const name of (await fs.readdir(absolute)).sort()) {
      if (!excluded.has(name)) await add(`${relative}/${name}`);
    }
  } else if (!/\.(log|tsbuildinfo)$/.test(relative)) {
    zip.file(`${prefix}/${relative}`, await fs.readFile(absolute), { unixPermissions: relative === 'start.sh' ? 0o755 : 0o644 });
  }
}
for (const item of include) await add(item);
const output = path.join(root, 'release');
await fs.mkdir(output, { recursive: true });
const filename = `${prefix}.zip`;
const bytes = await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX', compression: 'DEFLATE', compressionOptions: { level: 6 } });
await fs.writeFile(path.join(output, filename), bytes);
await fs.writeFile(path.join(output, 'SHA256SUMS.txt'), `${createHash('sha256').update(bytes).digest('hex')}  ${filename}\n`);
console.log(`Packaged ${filename} (${(bytes.length / 1024 / 1024).toFixed(1)} MiB)`);
