import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { BASE, tempFixture, openWorkspaceViaApi, openFile, build, hasLatex } from './helpers';

const RUN_REAL = process.env.E2E_HAS_LATEX === '1';

test.describe('06 · real build', () => {
  test.skip(() => !RUN_REAL, 'SKIPPED: real LaTeX not installed (set E2E_HAS_LATEX=1)');

  test('basic fixture produces a valid PDF end to end', async ({ page }) => {
    await page.goto(BASE);
    const dir = tempFixture('basic');
    await openWorkspaceViaApi(page, dir);
    await openFile(page, 'main.tex');
    await build(page);
    await expect(page.getByText(/Build successful/)).toBeVisible({ timeout: 180_000 });

    const pdfPath = path.join(dir, '.build', 'main.pdf');
    const buf = fs.readFileSync(pdfPath);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});

test.describe('07 · pdf preview', () => {
  test('shows the empty state before any build', async ({ page }) => {
    test.skip(RUN_REAL, 'real-LaTeX run — PDF expected after builds');
    await page.goto(BASE);
    await openWorkspaceViaApi(page, tempFixture('basic'));
    await expect(page.getByText('No PDF yet')).toBeVisible();
  });

  test.skip(() => !RUN_REAL, 'SKIPPED: real LaTeX not installed');

  test('renders canvas pages after a build and refreshes on rebuild', async ({ page }) => {
    await page.goto(BASE);
    const dir = tempFixture('basic');
    await openWorkspaceViaApi(page, dir);
    await openFile(page, 'main.tex');
    await build(page);
    await expect(page.getByText(/Build successful/)).toBeVisible({ timeout: 180_000 });
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });

    // Edit at a SAFE position (end of file) → rebuild → PDF refreshes
    const pdfPath = path.join(dir, '.build', 'main.pdf');
    const mtimeBefore = fs.statSync(pdfPath).mtimeMs;
    await page.locator('.view-lines').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('% second pass');
    await page.keyboard.press('Control+s');
    await build(page);
    await expect(page.getByText(/Build successful/)).toBeVisible({ timeout: 180_000 });
    expect(fs.statSync(pdfPath).mtimeMs).toBeGreaterThan(mtimeBefore);
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  });
});

test.describe('08 · problem jump', () => {
  test.skip(() => !RUN_REAL, 'SKIPPED: real LaTeX not installed');

  test('error fixture lists problems and clicking jumps to source line', async ({ page }) => {
    await page.goto(BASE);
    await openWorkspaceViaApi(page, tempFixture('error'));
    await build(page);
    // Wait for the parsed problem row (stronger than the status text).
    await expect(page.getByText('Undefined control sequence')).toBeVisible({ timeout: 180_000 });
    await expect(page.getByText(/Build failed/)).toBeVisible();
    const row = page.getByText('Undefined control sequence').first();
    await expect(row).toBeVisible();
    await row.click();
    // Editor should now show main.tex with cursor on the offending area
    await expect(page.locator('.monaco-editor')).toBeVisible();
  });
});

test.describe('09 · tab switching', () => {
  test('open two files, switch tabs, contents preserved', async ({ page }) => {
    await page.goto(BASE);
    const dir = tempFixture('multi-file');
    await openWorkspaceViaApi(page, dir);
    // expand the sections/ folder first (tree starts collapsed)
    await page.getByText('sections', { exact: true }).first().click();
    await openFile(page, 'intro.tex');
    await page.getByText('method.tex').first().dblclick();

    const tabButtons = page
      .getByTestId('tab-strip')
      .locator('button', { hasText: /intro\.tex|method\.tex/ });
    await expect(tabButtons).toHaveCount(2);

    // type into the ACTIVE file (intro), switch away and back, expect persistence
    const strip = page.getByTestId('tab-strip');
    await strip.locator('button', { hasText: 'intro.tex' }).first().click();
    await expect(page.locator('.view-lines')).toContainText('Introduction');
    await page.locator('.view-lines').click();
    await page.keyboard.type('% unique-marker-intro');
    await expect(page.locator('.view-lines')).toContainText('% unique-marker-intro');
    await strip.locator('button', { hasText: 'method.tex' }).first().click();
    await strip.locator('button', { hasText: 'intro.tex' }).first().click();
    await expect(page.locator('.view-lines')).toContainText('% unique-marker-intro');
  });
});

test.describe('10 · workspace switch isolation', () => {
  test('switching workspaces resets problems/pdf state', async ({ page }) => {
    await page.goto(BASE);
    await openWorkspaceViaApi(page, tempFixture('basic'));
    await expect(page.getByText('Ready').first()).toBeVisible();

    await openWorkspaceViaApi(page, tempFixture('chinese'));
    // No PDF carried over
    await expect(page.getByText('No PDF yet')).toBeVisible();
    // Problems reset
    await expect(page.getByText('No problems detected.')).toBeVisible();
  });
});
