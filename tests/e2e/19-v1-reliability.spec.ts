import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, tempFixture, openWorkspaceViaApi, openFile } from './helpers';

test('V1 restores unsaved draft bytes after a browser reload', async ({ page }) => {
  const dir = tempFixture('basic');
  const original = fs.readFileSync(path.join(dir, 'main.tex'), 'utf8');
  await page.goto(BASE);
  await openWorkspaceViaApi(page, dir);
  await openFile(page, 'main.tex');
  await page.locator('.monaco-editor textarea').focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n% unsaved recovery marker');
  await expect(page.getByTestId('tab-strip')).toContainText('main.tex *');
  page.on('dialog', (dialog) => void dialog.accept());
  await page.reload();
  await expect(page.getByText('Recovered 1 unsaved file. Review and save when ready.')).toBeVisible();
  await page.locator('.monaco-editor textarea').focus();
  await page.keyboard.press('Control+End');
  await expect(page.locator('.monaco-editor')).toContainText('unsaved recovery marker');
  expect(fs.readFileSync(path.join(dir, 'main.tex'), 'utf8')).toBe(original);
  await page.keyboard.press('Control+s');
  await expect.poll(() => fs.readFileSync(path.join(dir, 'main.tex'), 'utf8')).toContain('unsaved recovery marker');
  await expect(page.getByTestId('tab-strip')).not.toContainText('main.tex *');
});

test('V1 keeps typing during a slow save dirty until those bytes are saved', async ({ page }) => {
  const dir = tempFixture('basic');
  await page.goto(BASE);
  await openWorkspaceViaApi(page, dir);
  await openFile(page, 'main.tex');
  await page.locator('.monaco-editor textarea').focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n% first save');
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let requested = false;
  await page.route('**/api/file/save', async (route) => { requested = true; await blocked; await route.continue(); });
  await page.keyboard.press('Control+s');
  await expect.poll(() => requested).toBe(true);
  await page.keyboard.type('\n% typed while saving');
  release();
  await expect.poll(() => fs.readFileSync(path.join(dir, 'main.tex'), 'utf8')).toContain('first save');
  expect(fs.readFileSync(path.join(dir, 'main.tex'), 'utf8')).not.toContain('typed while saving');
  await expect(page.getByTestId('tab-strip')).toContainText('main.tex *');
  await page.unroute('**/api/file/save');
  await page.keyboard.press('Control+s');
  await expect.poll(() => fs.readFileSync(path.join(dir, 'main.tex'), 'utf8')).toContain('typed while saving');
});

test('V1 exposes disk conflicts and saves an explicitly reviewed version', async ({ page }) => {
  const dir = tempFixture('basic');
  await page.goto(BASE);
  await openWorkspaceViaApi(page, dir);
  await openFile(page, 'main.tex');
  await page.locator('.monaco-editor textarea').focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n% my draft');
  fs.appendFileSync(path.join(dir, 'main.tex'), '\n% external writer');
  await page.keyboard.press('Control+s');
  await page.getByRole('button', { name: 'Review disk changes', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review disk changes', exact: true });
  await expect(dialog.locator('.monaco-diff-editor')).toBeVisible();
  expect(fs.readFileSync(path.join(dir, 'main.tex'), 'utf8')).toContain('external writer');
  await dialog.getByRole('button', { name: 'Save my version', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(() => fs.readFileSync(path.join(dir, 'main.tex'), 'utf8')).toContain('my draft');
  expect(fs.readFileSync(path.join(dir, 'main.tex'), 'utf8')).not.toContain('external writer');
});

test('V1 literature search inserts a citation and updates external bibliography changes', async ({ page }) => {
  const dir = tempFixture('research-thesis');
  await page.goto(BASE);
  await openWorkspaceViaApi(page, dir);
  await openFile(page, 'main.tex');
  await page.locator('.monaco-editor textarea').focus();
  await page.keyboard.press('Control+End');
  await page.getByRole('tab', { name: 'Navigator' }).click();
  await page.getByRole('button', { name: 'Citations', exact: true }).click();
  const panel = page.getByTestId('citation-workspace');
  await panel.getByRole('textbox', { name: 'Search literature' }).fill('smith');
  const row = panel.locator('[data-entry="smith2025"]');
  await row.getByRole('button', { name: 'Insert citation', exact: true }).click();
  await page.keyboard.press('Control+s');
  await expect.poll(() => fs.readFileSync(path.join(dir, 'main.tex'), 'utf8')).toContain('\\cite{smith2025}');
  fs.appendFileSync(path.join(dir, 'refs.bib'), '\n@article{newpaper,title={New externally exported paper},doi={10.1234/newpaper}}');
  await panel.getByRole('textbox', { name: 'Search literature' }).fill('newpaper');
  await expect(panel.locator('[data-entry="newpaper"]')).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByRole('link', { name: 'Open paper ↗' })).toHaveAttribute('href', 'https://doi.org/10.1234/newpaper');
});

test('V1 offline editor uses local workers and makes no CDN requests', async ({ page }) => {
  const foreign: string[] = [];
  page.on('request', (request) => { if (/^https?:/.test(request.url()) && !request.url().startsWith(BASE)) foreign.push(request.url()); });
  await page.goto(BASE);
  await openWorkspaceViaApi(page, tempFixture('basic'));
  await openFile(page, 'main.tex');
  await page.locator('.monaco-editor textarea').focus();
  await page.keyboard.type('% local editor\n');
  expect(foreign).toEqual([]);
});
