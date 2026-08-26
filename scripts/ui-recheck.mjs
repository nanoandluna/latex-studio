import { chromium } from '@playwright/test';
import path from 'node:path';

const BASE = 'http://localhost:3210';
const FIX = p => path.resolve('tests/fixtures', p);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

// 02 rerun: poll-wait for tree
await page.goto(BASE);
await page.getByRole('button', { name: 'Open Workspace' }).first().click();
await page.locator('input[placeholder*="Research"]').fill(FIX('bibliography'));
await page.getByRole('button', { name: 'Open', exact: true }).click();
try {
  await page.waitForFunction(() => {
    const t = document.body.innerText;
    return t.includes('main.tex') && t.includes('refs.bib');
  }, { timeout: 15000 });
  console.log('PASS 02 workspace opened (poll-wait)');
} catch {
  console.log('FAIL 02 BODY:', JSON.stringify((await page.locator('body').innerText()).slice(0,400)));
}

// 03 tabs
console.log('tabs visible:', await page.getByRole('tab', { name: 'Explorer' }).isVisible(), await page.getByRole('tab', { name: 'Outline' }).isVisible(), await page.getByRole('tab', { name: 'Navigator' }).isVisible());

// 07 outline with proper wait
await page.getByRole('tab', { name: 'Outline' }).click();
try {
  await page.getByText('Citations in BibLaTeX').first().waitFor({ timeout: 15000 });
  console.log('PASS 07 outline section visible (poll-wait)');
} catch {
  console.log('FAIL 07 outline section never appeared');
}

// 08 navigator groups with proper wait
await page.getByRole('tab', { name: 'Navigator' }).click();
try {
  await page.waitForFunction(() => {
    const t = document.body.innerText;
    return ['Sections','Figures','Tables','Equations','Citations','Labels','Diagnostics'].every(g => t.includes(g));
  }, { timeout: 15000 });
  console.log('PASS 08 navigator groups render (poll-wait)');
} catch {
  console.log('FAIL 08 navigator groups incomplete after 15s');
}

// 09 undefined badge after planting ghost citation
await page.evaluate(async () => {
  await fetch('/api/index/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'main.tex', content: '\\section{Citations in BibLaTeX}\n\\autocite{ghost999}.\n' }),
  });
});
try {
  await page.getByText('ghost999').first().waitFor({ timeout: 15000 });
  const t = await page.locator('body').innerText();
  console.log('PASS 09 ghost999 flagged:', t.includes('undefined'));
} catch {
  console.log('FAIL 09 ghost999 never flagged');
}

await browser.close();
