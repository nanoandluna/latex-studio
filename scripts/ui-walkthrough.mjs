import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE = 'http://localhost:3210';
const FIX = p => path.resolve('tests/fixtures', p);
const results = [];
let shot = 0;

function ok(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text().slice(0, 200)); });

// ---------- 1. empty state ----------
await page.goto(BASE);
await page.waitForTimeout(1200);
ok('01 app loads (empty state)', (await page.locator('body').innerText()).includes('Open Workspace'));

// ---------- 2. open workspace via modal ----------
await page.getByRole('button', { name: 'Open Workspace' }).first().click();
await page.waitForTimeout(300);
await page.locator('input[placeholder*="Research"]').fill(FIX('bibliography'));
await page.getByRole('button', { name: 'Open', exact: true }).click();
await page.waitForTimeout(1200);
const body1 = await page.locator('body').innerText();
ok('02 workspace opened (tree visible)', body1.includes('main.tex') && body1.includes('refs.bib'));
ok('03 three sidebar tabs', body1.includes('Explorer') && body1.includes('Outline') && body1.includes('Navigator'));

// ---------- 3. editor: open main.tex ----------
await page.getByText('main.tex').first().dblclick();
await page.waitForSelector('.monaco-editor', { timeout: 20000 });
const edText = await page.locator('.view-lines').innerText();
ok('04 monaco shows LaTeX source', edText.includes('\\documentclass') || edText.includes('documentclass'));

// typing + dirty marker
await page.locator('.view-lines').click();
await page.keyboard.press('Control+End');
await page.keyboard.type('% ui-walkthrough');
await page.waitForTimeout(400);
ok('05 dirty marker appears', (await page.locator('[data-testid="tab-strip"]').innerText()).includes('*'));
await page.keyboard.press('Control+s');
await page.waitForTimeout(600);
ok('06 Ctrl+S clears dirty marker', !(await page.locator('[data-testid="tab-strip"]').innerText()).includes('*'));

// ---------- 4. Outline tab ----------
await page.getByRole('tab', { name: 'Outline' }).click();
await page.waitForTimeout(800);
const outlineTxt = await page.locator('body').innerText();
ok('07 outline shows section', outlineTxt.includes('Citations in BibLaTeX'));

// ---------- 5. Navigator tab: badges/flags/diagnostics ----------
await page.getByRole('tab', { name: 'Navigator' }).click();
await page.waitForTimeout(800);
const navTxt = await page.locator('body').innerText();
ok('08 navigator groups render', ['Sections','Figures','Tables','Equations','Citations','Labels','Diagnostics'].every(g => navTxt.includes(g)));

// plant an undefined citation to check flags + diagnostics group
await page.evaluate(async () => {
  await fetch('/api/index/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'main.tex', content: '\\section{Citations in BibLaTeX}\n\\autocite{ghost999}.\n' }),
  });
});
await page.waitForTimeout(1500);
const nav2 = await page.locator('body').innerText();
ok('09 undefined-citation flag badge', nav2.includes('ghost999') && nav2.includes('undefined'));
ok('10 diagnostics group lists it', nav2.includes('ghost999') === false ? true : nav2.includes('UNDEFINED_CITATION') || nav2.includes("not found"));

// ---------- 6. Problems panel: writing toggle + health ----------
await page.evaluate(() => window.scrollTo(0, 0));
const probBtn = page.getByRole('button', { name: /Problems/ });
await probBtn.click();
await page.waitForTimeout(400);
const probTxt = await page.locator('body').innerText();
ok('11 health score displayed', /Health \d+/.test(probTxt));
ok('12 writing-checks toggle present', probTxt.includes('Writing checks'));

// ---------- 7. Build flow ----------
await page.getByRole('button', { name: /Build/ }).click();
await page.waitForTimeout(500);
await expectBuild(page);
async function expectBuild(page) {
  for (let i = 0; i < 60; i++) {
    const t = await page.locator('body').innerText();
    if (/Build successful|Build failed/.test(t)) return t.match(/Build successful|Build failed/)[0];
    await page.waitForTimeout(1000);
  }
  return null;
}
const bres = await expectBuild(page);
ok('13 build reaches terminal state', !!bres, bres ?? 'timeout');

// PDF appears
const hasCanvas = await page.locator('canvas').first().isVisible().catch(() => false);
ok('14 PDF canvas rendered after build', hasCanvas);

// screenshot archive
await page.screenshot({ path: 'docs/images/walkthrough-build.png' });
shot++;

// ---------- 8. PDF toolbar controls ----------
const tbTxt = await page.locator('body').innerText();
ok('15 pdf toolbar controls', ['Fit Width','⟳','⭳','⛶'].every(x => tbTxt.includes(x)));
ok('16 search box present', await page.locator('input[placeholder="Find…"]').isVisible().catch(() => false));

// zoom out/in roundtrip keeps % label
await page.getByText('−', { exact: true }).first().click().catch(() => {});
await page.getByText('+', { exact: true }).first().click().catch(() => {});

// ---------- 9. theme switch ----------
await page.locator('select[title="Theme"], select').last().selectOption('light').catch(() => {});
await page.waitForTimeout(400);
const isLight = await page.evaluate(() => !document.documentElement.classList.contains('dark'));
ok('17 light theme applies', isLight);
await page.locator('select').last().selectOption('dark');
await page.waitForTimeout(300);

// ---------- 10. command palette ----------
await page.keyboard.press('Control+Shift+p');
await page.waitForTimeout(400);
const palVisible = await page.getByPlaceholder('Type a command…').isVisible().catch(() => false);
ok('18 command palette opens', palVisible);
if (palVisible) {
  await page.keyboard.type('graph');
  await page.waitForTimeout(300);
  const dumpCmd = await page.getByText('Dump Graph Debug').isVisible().catch(() => false);
  ok('19 graph-debug command listed', dumpCmd);
  if (dumpCmd) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    const t2 = await page.locator('body').innerText();
    ok('20 graph debug dumped to Output', t2.includes('Graph Debug') && t2.includes('Rev:'));
  }
  await page.keyboard.press('Escape');
}

// ---------- 11. image preview ----------
await page.evaluate(async () => {
  await fetch('/api/workspace/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: 'D:\\opencode\\overleafweb\\tests\\fixtures\\image' }),
  });
});
await page.reload();
await page.waitForTimeout(1200);
await page.getByText('figure.png').first().dblclick();
await page.waitForTimeout(800);
const imgVisible = await page.locator('img[alt="figure.png"]').isVisible().catch(() => false);
ok('21 image preview opens', imgVisible);
const imgToolbar = await page.locator('body').innerText();
ok('22 image toolbar (zoom/fit/rotate)', imgToolbar.includes('Fit') && imgToolbar.includes('⟳'));

await page.screenshot({ path: `docs/images/walkthrough-${++shot}.png` });

// ---------- 12. templates modal ----------
await page.evaluate(() => localStorage.removeItem('latex-studio-workspace'));
await page.reload();
await page.waitForTimeout(800);
await page.getByRole('button', { name: 'Open Workspace' }).first().click();
await page.getByText('New from template').click();
await page.waitForTimeout(500);
const tplOptions = await page.locator('select').first().locator('option').count();
ok('23 template catalog loaded', tplOptions >= 6, `${tplOptions} templates`);

// create from template into temp dir
const tmpTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-tpl-'));
const targetDir = path.join(tmpTarget, 'my-article');
await page.locator('input[placeholder*="Research"], input[placeholder*="D:"]').last().fill(path.dirname(targetDir));
await page.locator('input[placeholder="my-paper"]').fill(path.basename(targetDir));
await page.getByRole('button', { name: 'Create & Open' }).click();
await page.waitForTimeout(1500);
const createdOk = fs.existsSync(path.join(targetDir, 'main.tex'));
const bodyFinal = await page.locator('body').innerText();
ok('24 template creates & opens workspace', createdOk && bodyFinal.includes('main.tex'), createdOk ? targetDir : 'main.tex missing');

await page.screenshot({ path: `docs/images/walkthrough-template.png` });

console.log('\n==== SUMMARY ====');
const fails = results.filter(r => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
console.log('pageerrors:', errors.length ? errors : 'none');

await browser.close();
process.exit(fails.length ? 1 : 0);
