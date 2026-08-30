import { test, expect } from '@playwright/test';
import { BASE, tempFixture, openWorkspaceViaApi } from './helpers';

/**
 * V0.5 Paper Overview — the dashboard numbers come from the Project Graph and
 * must be exact: structure counts, asset counts, and the per-chapter rows.
 */
test.describe('19 · paper overview', () => {
  test('metrics and chapter rows for a multi-file paper', async ({ page }) => {
    await page.goto(BASE);
    await openWorkspaceViaApi(page, tempFixture('multi-file'));

    await page.getByRole('tab', { name: 'Navigator' }).click();
    await page.getByRole('button', { name: 'Overview' }).click();

    const panel = page.getByTestId('paper-overview');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    // the fixture has two \section files and no \chapter — the degenerate
    // chapter level is the section itself
    await expect(panel.getByText('Structure')).toBeVisible();
    await expect(panel.locator('span', { hasText: 'Chapters' }).locator('..')).toContainText('2');
    await expect(panel.locator('span', { hasText: 'Sections' }).locator('..')).toContainText('2');
    await expect(panel.locator('span', { hasText: 'Figures' }).locator('..')).toContainText('1');

    // per-chapter rows (the two sections) with content stats
    await expect(panel.getByText('Introduction')).toBeVisible();
    await expect(panel.getByText('Method', { exact: true })).toBeVisible();
  });

  test('chinese thesis shows real chapter CJK counts', async ({ page }) => {
    await page.goto(BASE);
    await openWorkspaceViaApi(page, tempFixture('chinese-thesis'));

    await page.getByRole('tab', { name: 'Navigator' }).click();
    await page.getByRole('button', { name: 'Overview' }).click();

    const panel = page.getByTestId('paper-overview');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    const chapterRows = panel.getByRole('button', { title: /main\.tex:\d+/ });
    await expect(chapterRows).toHaveCount(2);
    const firstRow = chapterRows.first();
    await expect(firstRow).toContainText(/绪论|方法/);
    // CJK track counts real characters, not zero
    const cjk = Number((await firstRow.innerText()).match(/(\d+) CJK/)?.[1] ?? 0);
    expect(cjk).toBeGreaterThanOrEqual(5);
  });

  test('palette reaches the overview', async ({ page }) => {
    await page.goto(BASE);
    await openWorkspaceViaApi(page, tempFixture('multi-file'));

    await page.keyboard.press('Control+Shift+P');
    await page.getByPlaceholder('Type a command…').fill('Show Paper Overview');
    await page.getByRole('button', { name: 'Show Paper Overview' }).click();
    await expect(page.getByTestId('paper-overview')).toBeVisible({ timeout: 15_000 });
  });
});
