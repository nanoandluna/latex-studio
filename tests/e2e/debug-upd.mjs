import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage();

// Direct API probe of the update endpoint against a generated project
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-'));
execFileSync(process.execPath, [path.resolve('scripts/generate-large-project.mjs'), dir, '20']);

const resp = [];
page.on('response', (r) => {
  if (r.url().includes('/api/')) resp.push(r.status() + ' ' + r.url().split('3210')[1]);
});

await page.goto('http://localhost:3210');
await page.evaluate(async (d) => {
  await fetch('/api/workspace/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: d }),
  });
}, dir);

// call update via page context (cookie-authenticated)
const result = await page.evaluate(async () => {
  const res = await fetch('/api/index/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: 'chapters/ch000.tex',
      content: '\\section{Hot Section}\\label{sec:hot}\nhot\n',
    }),
  });
  const j = await res.json().catch(() => null);
  return { status: res.status, keys: j ? Object.keys(j) : null, hasGraph: !!j?.graph, sections: j?.graph?.sections?.length ?? j?.sections?.length };
});
console.log('update:', JSON.stringify(result));
console.log('responses:', JSON.stringify(resp.slice(0, 10)));
await browser.close();
