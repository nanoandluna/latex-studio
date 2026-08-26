import { chromium } from '@playwright/test';
import path from 'node:path';

const FIX = p => path.resolve('tests/fixtures', p);
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('response', r => {
  if (r.url().includes('/api/')) console.log('[net]', r.status(), r.url().split('3210')[1]);
});
await page.goto('http://localhost:3210');
await page.waitForTimeout(800);
await page.getByRole('button', { name: 'Open Workspace' }).first().click();
await page.locator('input[placeholder*="Research"]').fill(FIX('bibliography'));
await page.getByRole('button', { name: 'Open', exact: true }).click();
await page.waitForTimeout(4000);
const t = await page.locator('body').innerText();
console.log('BODY:', JSON.stringify(t.slice(0, 600)));
console.log('has main.tex:', t.includes('main.tex'), '· has Explorer tab:', t.includes('Explorer'));
await browser.close();
