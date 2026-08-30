import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { BASE, tempFixture, openWorkspaceViaApi, openFile } from './helpers';

/**
 * V0.4.2 Task 1 — the snapshot diff opens as a read-only workspace tab in the
 * main editor area, with a CHANGES rail for multi-file navigation,
 * side-by-side when there is room and unified when not.
 */

async function editAndSave(page: import('@playwright/test').Page, marker: string): Promise<void> {
  await page.locator('.view-lines').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(`\n% ${marker}`);
  await page.keyboard.press('Control+s');
}

test.describe('16 · diff workspace (main editor area)', () => {
  test('01 · opens as a read-only tab; close returns to the editor', async ({ page }) => {
    const dir = tempFixture('multi-file');
    await page.goto(BASE);
    await openWorkspaceViaApi(page, dir);

    // snapshot the pristine state, then modify main.tex
    await page.getByRole('tab', { name: 'History' }).click();
    await page.getByRole('button', { name: 'Snapshot', exact: true }).click();
    await page.getByText('Manual', { exact: true }).first().click();
    await expect(page.getByText('No differences')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restore this snapshot' })).toBeDisabled();
    await page.getByRole('button', { name: '← History' }).click();

    await page.getByRole('tab', { name: 'Explorer' }).click();
    await openFile(page, 'main.tex');
    await editAndSave(page, 'diff-workspace-marker');
    await expect(page.locator('button', { hasText: 'main.tex *' })).toHaveCount(0);

    // select the snapshot again — now there is a real change to view
    await page.getByRole('tab', { name: 'History' }).click();
    await page.getByText('Manual', { exact: true }).first().click();
    await page.getByRole('button', { name: 'M main.tex' }).click();

    // the diff lives in the main area as its own tab
    await expect(page.getByRole('button', { name: /Diff: .*→ Now/ })).toBeVisible();
    await expect(page.locator('.monaco-diff-editor')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('read-only', { exact: true })).toBeVisible();
    // Monaco virtualizes — scroll the modified side to the changed line
    await page.locator('.monaco-diff-editor .modified .view-lines').click();
    await page.keyboard.press('Control+End');
    await expect(page.locator('.monaco-diff-editor')).toContainText('diff-workspace-marker');
    // read-only is behavioral: typing changes nothing
    await page.keyboard.type('SHOULD-NOT-APPEAR');
    await expect(page.locator('.monaco-diff-editor')).not.toContainText('SHOULD-NOT-APPEAR');

    // clicking a file tab goes back to editing; the diff tab stays available
    await page.getByRole('button', { name: /TEX\s*main\.tex/ }).first().click();
    await expect(page.locator('.view-lines')).toBeVisible();
    await page.getByRole('button', { name: /Diff: .*→ Now/ }).click();
    await expect(page.locator('.monaco-diff-editor')).toBeVisible();

    // closing the diff mutates nothing and returns to the editor
    await page.getByRole('button', { name: 'Close diff', exact: true }).click();
    await expect(page.getByRole('button', { name: /Diff: .*→ Now/ })).toHaveCount(0);
    await expect(page.locator('.view-lines')).toBeVisible();
    // the marker edit is untouched by the diff detour
    expect(fs.readFileSync(path.join(dir, 'main.tex'), 'utf8')).toContain('diff-workspace-marker');
  });

  test('02 · changes rail navigates between multiple modified files', async ({ page }) => {
    const dir = tempFixture('multi-file');
    await page.goto(BASE);
    await openWorkspaceViaApi(page, dir);

    // snapshot BEFORE both edits, so the diff really shows two modified files
    await page.getByRole('tab', { name: 'History' }).click();
    await page.getByRole('button', { name: 'Snapshot', exact: true }).click();
    await page.getByRole('tab', { name: 'Explorer' }).click();
    await openFile(page, 'main.tex');
    await editAndSave(page, 'changed-main-marker');
    await openFile(page, 'intro.tex');
    await editAndSave(page, 'changed-intro-marker');

    await page.getByRole('tab', { name: 'History' }).click();
    await page.getByText('Manual', { exact: true }).first().click();

    // both rows exist and no diff is open yet — the row is unambiguous
    await page.getByRole('button', { name: 'M main.tex' }).click();
    await expect(page.locator('.monaco-diff-editor')).toBeVisible({ timeout: 15_000 });
    await page.locator('.monaco-diff-editor .modified .view-lines').click();
    await page.keyboard.press('Control+End');
    await expect(page.locator('.monaco-diff-editor')).toContainText('changed-main-marker');

    // switch files from the workspace CHANGES rail
    await page
      .getByTestId('diff-changes')
      .getByRole('button', { name: /M sections\/intro\.tex/ })
      .click();
    await page.locator('.monaco-diff-editor .modified .view-lines').click();
    await page.keyboard.press('Control+End');
    await expect(page.locator('.monaco-diff-editor')).toContainText('changed-intro-marker');
    await page.getByTestId('diff-changes').getByRole('button', { name: 'M main.tex' }).click();
    await page.locator('.monaco-diff-editor .modified .view-lines').click();
    await page.keyboard.press('Control+End');
    await expect(page.locator('.monaco-diff-editor')).toContainText('changed-main-marker');
  });

  test('03 · unified on narrow panes, side-by-side when there is room', async ({ page }) => {
    const dir = tempFixture('multi-file');
    await page.goto(BASE);
    await openWorkspaceViaApi(page, dir);

    await openFile(page, 'main.tex');
    await page.getByRole('tab', { name: 'History' }).click();
    await page.getByRole('button', { name: 'Snapshot', exact: true }).click();
    await page.getByRole('tab', { name: 'Explorer' }).click();
    await openFile(page, 'intro.tex');
    await editAndSave(page, 'layout-marker');
    await page.getByRole('tab', { name: 'History' }).click();
    await page.getByText('Manual', { exact: true }).first().click();
    await page.getByRole('button', { name: 'M sections/intro.tex' }).click();
    await expect(page.locator('.monaco-diff-editor')).toBeVisible({ timeout: 15_000 });

    // 1440×900 leaves the diff body only ~490 px (sidebar + PDF flank it)
    await expect(page.locator('[data-view]')).toHaveAttribute('data-view', 'unified');
    await page.setViewportSize({ width: 800, height: 700 });
    await expect(page.locator('[data-view]')).toHaveAttribute('data-view', 'unified');
    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect(page.locator('[data-view]')).toHaveAttribute('data-view', 'side-by-side', {
      timeout: 5_000,
    });
  });
});
