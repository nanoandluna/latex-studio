import { chromium } from '@playwright/test';
import path from 'node:path';

const FIX = p => path.resolve('tests/fixtures', p);
const browser = await chromium.launch();
const page = await browser.newPage();

// rAF-throttle-safe text polling (headless pages may stop painting)
async function waitText(substr, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const txt = await page.evaluate(() => document.body.innerText);
    if (process.env.DBG) console.log('poll', JSON.stringify(substr), 'len', txt.length, 'hit', txt.includes(substr));
    if (txt.includes(substr)) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

page.on('response', r => {
  if (r.url().includes('/api/')) console.log('[net]', r.status(), r.url().split('3210')[1]);
});
await page.goto('http://localhost:3210');
await page.getByRole('button', { name: 'Open Workspace' }).first().click();
await page.locator('input[placeholder*="Research"]').fill(FIX('bibliography'));
await page.getByRole('button', { name: 'Open', exact: true }).click();
await page.waitForTimeout(800);
console.log('[post-click] modal visible:', await page.getByText('Recent Projects').isVisible().catch(()=>false), '| err shown:', await page.locator('.text-red-600, .text-red-400').count());

const treeOk = await waitText('main.tex') && (await waitText('refs.bib'));
if (!treeOk) console.log('DUMP:', JSON.stringify((await page.evaluate(() => document.body.innerText)).slice(0, 400)));
console.log('tree:', treeOk ? 'OK' : 'MISSING');
console.log('tabs:', ['Explorer','Outline','Navigator'].every(t => page.locator('body').innerText().then(x => x.includes(t))));

await page.getByRole('tab', { name: 'Outline' }).click();
console.log('outline:', (await waitText('Citations in BibLaTeX')) ? 'OK' : 'MISSING');

await page.getByRole('tab', { name: 'Navigator' }).click();
console.log('navigator:', (await waitText('Diagnostics')) ? 'OK' : 'MISSING');

await browser.close();
