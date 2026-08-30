import { test, expect } from '@playwright/test';
import { BASE, tempFixture, openWorkspaceViaApi, build, hasLatex } from './helpers';

const RUN_REAL = process.env.E2E_HAS_LATEX === '1';

/**
 * V0.5 P0-3 + P0-4 — reading workspace (thumbnails / outline / reading
 * position) and terminology consistency through the real UI.
 */
test.describe('21 · reading workspace & terminology', () => {
  test('terminology hits from a user glossary reach the panel and Problems', async ({
    page,
  }) => {
    await page.goto(BASE);
    await openWorkspaceViaApi(page, tempFixture('research-thesis'));

    // a glossary whose variant exists in ch1.tex line 3
    await page.evaluate(async () => {
      const res = await fetch('/api/paper/terminology', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terms: [{ preferred: 'Related work', variants: ['相关工作'] }] }),
      });
      if (!res.ok) throw new Error(await res.text());
    });

    await page.getByRole('tab', { name: 'Navigator' }).click();
    await page.getByRole('button', { name: 'Terms', exact: true }).click();
    const panel = page.locator('[data-testid="terminology-panel"]');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByText(/Inconsistencies \(1\)/)).toBeVisible();
    await expect(panel.getByText('→ Related work')).toBeVisible();
    await expect(panel.getByText(/相关工作/).first()).toBeVisible();

    // merged into the Problems panel as a warning
    await expect(page.getByText(/\[terminology\]/)).toBeVisible();
  });

  test('search results carry their section context', async ({ page }) => {
    await page.goto(BASE);
    await openWorkspaceViaApi(page, tempFixture('research-thesis'));

    await page.getByRole('tab', { name: 'Search' }).click();
    const query = page.getByPlaceholder('Search in project…');
    await query.fill('相关工作');
    await query.press('Enter');
    await expect(page.getByText(/in \d+ file/)).toBeVisible({ timeout: 15_000 });
    // the hit sits under \chapter{绪论} in ch1.tex (row: line · section · preview)
    await expect(page.getByText(/绪论 · 相关工作|绪论 ·相/).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('reading workspace: outline and thumbnails appear after a build', async ({
    page,
  }) => {
    test.skip(!RUN_REAL, 'SKIPPED: real LaTeX not installed (set E2E_HAS_LATEX=1)');
    await page.goto(BASE);
    await openWorkspaceViaApi(page, tempFixture('research-thesis'));
    test.skip(!(await hasLatex()), 'no LaTeX compiler on this machine');

    await build(page);
    await expect(page.getByText(/Build successful/)).toBeVisible({ timeout: 180_000 });

    // outline rail lists the thesis chapters; clicking jumps via SyncTeX
    await page.locator('[title="Outline — click a section to jump to its page"]').click();
    const introRow = page.locator('button[title^="Jump to page"]', { hasText: '绪论' });
    await expect(introRow).toBeVisible({ timeout: 15_000 });
    await introRow.click();
    await page.waitForTimeout(1500);
    await expect(page.getByText(/Page \d+ \/ \d+/)).toBeVisible();

    // thumbnails rail renders page canvases
    await page.locator('[title="Page thumbnails"]').click();
    await expect(page.locator('[title="Page 1"]').first()).toBeVisible({ timeout: 15_000 });

    // the reader position survives a reload through the reading-state store
    const saved = await page.evaluate(async () => {
      return (await (await fetch('/api/reading-state')).json()) as Record<string, number>;
    });
    expect(Object.values(saved).some((p) => p >= 1)).toBe(true);
  });
});
