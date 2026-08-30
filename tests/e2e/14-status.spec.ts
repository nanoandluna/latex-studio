import { test, expect } from '@playwright/test';
import { BASE, tempFixture, openWorkspaceViaApi, openFile, build, hasLatex } from './helpers';

const RUN_REAL = process.env.E2E_HAS_LATEX === '1';

/**
 * V0.4.2 Task 4 — the status bar answers "is my thesis safe right now?" with
 * typed save/snapshot/build states.
 */
test.describe('17 · status bar', () => {
  test('03 · save state: Saved → Unsaved changes → Saved', async ({ page }) => {
    await page.goto(BASE);
    await openWorkspaceViaApi(page, tempFixture('multi-file'));

    await openFile(page, 'main.tex');
    await expect(page.getByText('✓ Saved', { exact: true })).toBeVisible();

    await page.locator('.view-lines').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n% status-marker');
    await expect(page.getByText('● Unsaved changes')).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press('Control+s');
    await expect(page.getByText('✓ Saved', { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('● Unsaved changes')).toHaveCount(0);
  });

  test('04 · snapshot state: No snapshot yet → Snapshot just now', async ({ page }) => {
    await page.goto(BASE);
    await openWorkspaceViaApi(page, tempFixture('multi-file'));

    await expect(page.getByText('No snapshot yet', { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('tab', { name: 'History' }).click();
    await page.getByRole('button', { name: 'Snapshot', exact: true }).click();
    await expect(page.getByText(/^Snapshot (just now|\d+s ago)$/)).toBeVisible({
      timeout: 15_000,
    });
  });

  test('05 · build state: terminal status shows compiler outcome and duration', async ({
    page,
  }) => {
    test.skip(!RUN_REAL, 'SKIPPED: real LaTeX not installed (set E2E_HAS_LATEX=1)');
    await page.goto(BASE);
    await openWorkspaceViaApi(page, tempFixture('multi-file'));
    test.skip(!(await hasLatex()), 'no LaTeX compiler on this machine');

    await build(page);
    await expect(page.getByText(/✓ Build successful · \d+\.\d\ds/)).toBeVisible({
      timeout: 180_000,
    });
  });
});
