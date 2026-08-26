import { chromium } from '@playwright/test';
import path from 'node:path';

const FIX = p => path.resolve('tests/fixtures', p);
const browser = await chromium.launch();
const page = await browser.newPage();

for (let run = 1; run <= 3; run++) {
  console.log(`=== run ${run} ===`);
  await page.goto('http://localhost:3210');
  await page.getByRole('button', { name: 'Open Workspace' }).first().click();
  await page.locator('input[placeholder*="Research"]').fill(FIX('bibliography'));
  await page.getByRole('button', { name: 'Open', exact: true }).click();

  try {
    await page.getByText('main.tex').first().waitFor({ state: 'visible', timeout: 15000 });
    console.log('tree: OK');
  } catch {
    console.log('tree: MISSING');
  }

  await page.getByRole('tab', { name: 'Outline' }).click();
  try {
    await page.getByText('Citations in BibLaTeX').first().waitFor({ timeout: 15000 });
    console.log('outline: OK');
  } catch {
    console.log('outline: MISSING');
  }

  await page.getByRole('tab', { name: 'Navigator' }).click();
  try {
    await page
      .getByText('Diagnostics', { exact: true })
      .waitFor({ state: 'visible', timeout: 15000 });
    console.log('navigator: OK');
  } catch {
    console.log('navigator: MISSING');
  }

  // reset workspace for next run
  await page.evaluate(() => fetch('/api/workspace/close', { method: 'POST' }));
}
await browser.close();
