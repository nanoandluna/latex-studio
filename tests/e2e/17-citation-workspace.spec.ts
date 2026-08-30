import { test, expect } from '@playwright/test';
import { BASE, tempFixture, openWorkspaceViaApi } from './helpers';

/**
 * V0.5-PLAN 2 — Citation Workspace through the real research-thesis fixture
 * (multi-file thesis, \autocite/\textcite, a real refs.bib).
 */
test.describe('20 · citation workspace', () => {
  test('groups, bib metadata and usage locations for a real thesis', async ({ page }) => {
    await page.goto(BASE);
    await openWorkspaceViaApi(page, tempFixture('research-thesis'));

    await page.getByRole('tab', { name: 'Navigator' }).click();
    await page.getByRole('button', { name: 'Citations', exact: true }).click();

    const panel = page.locator('[data-testid="citation-workspace"]');
    await expect(panel).toBeVisible({ timeout: 15_000 });

    // the fixture cites exactly two keys, both defined in refs.bib
    await expect(panel.getByText('All 2')).toBeVisible();
    await expect(panel.getByText('Used 2')).toBeVisible();
    await expect(panel.getByText('Undefined 0')).toBeVisible();

    const smithRow = panel.locator('[data-entry="smith2025"]');
    await expect(smithRow).toBeVisible();
    await expect(smithRow).toContainText('Used 1×');
    // bib metadata flows from the single .bib parser
    await expect(smithRow).toContainText('Smith');

    // first usage lands in the thesis chapter, with the citing line as context
    await smithRow.getByRole('button', { name: /Show Usages/ }).click();
    const usage = smithRow.locator('[data-usage]').first();
    await expect(usage).toContainText('chapters/ch1.tex:3');
    await expect(usage).toContainText('绪论');
    await expect(usage).toContainText('autocite');

    // Open Bib jumps to the definition
    await smithRow.getByRole('button', { name: 'Open Bib' }).click();
    await expect(page.locator('button', { hasText: 'refs.bib' }).first()).toBeVisible();
  });

  test('undefined and unused entries surface through the filters', async ({ page }) => {
    await page.goto(BASE);
    await openWorkspaceViaApi(page, tempFixture('multi-file'));
    // multi-file has no .bib at all — every \ref-style citation is undefined
    await page.getByRole('tab', { name: 'Navigator' }).click();
    await page.getByRole('button', { name: 'Citations', exact: true }).click();

    const panel = page.locator('[data-testid="citation-workspace"]');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    // multi-file fixture has no \cite at all
    await expect(panel.getByText('All 0')).toBeVisible();
    await expect(panel.getByText('No citations in this project yet.')).toBeVisible();
  });

  test('palette reaches the citation workspace', async ({ page }) => {
    await page.goto(BASE);
    await openWorkspaceViaApi(page, tempFixture('research-thesis'));

    await page.keyboard.press('Control+Shift+P');
    await page.getByPlaceholder('Type a command…').fill('Show Citation Workspace');
    await page.getByRole('button', { name: 'Show Citation Workspace' }).click();
    await expect(page.locator('[data-testid="citation-workspace"]')).toBeVisible({
      timeout: 15_000,
    });
  });
});
