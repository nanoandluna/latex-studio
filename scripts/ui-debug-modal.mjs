import { chromium } from '@playwright/test';
import path from 'node:path';

const BASE = 'http://localhost:3210';
const FIX = p => path.resolve('tests/fixtures', p);

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text().slice(0, 200)); });
page.on('response', r => {
  if (r.url().includes('/api/')) console.log('[net]', r.status(), r.url().split('3210')[1]);
});
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));

await page.goto(BASE);
await page.waitForTimeout(1000);
await page.getByRole('button', { name: 'Open Workspace' }).first().click();
await page.locator('input[placeholder*="Research"]').fill(FIX('bibliography'));
await page.getByRole('button', { name: 'Open', exact: true }).click();

try {
  await page.waitForFunction(() => document.body.innerText.includes('main.tex'), { timeout: 15000 });
  console.log('TREE OK');
} catch {
  console.log('TREE NEVER RENDERED');
  const t = await page.locator('body').innerText();
  console.log('BODY:', JSON.stringify(t.slice(0, 500)));
}
await browser.close();
