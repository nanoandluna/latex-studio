import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { BASE, tempFixture, openWorkspaceViaApi, openFile } from './helpers';

/**
 * V0.4.2 Tasks 2 & 7 — header stays clean at common viewports, the palette
 * reaches everything, and workspace switches never leak state.
 */

/** Drive Replace All through the real UI (preview → apply), as a user would. */
async function replaceAllViaUi(page: import('@playwright/test').Page, query: string, replacement: string) {
  await page.getByRole('tab', { name: 'Search' }).click();
  const q = page.getByPlaceholder('Search in project…');
  await q.fill(query);
  await q.press('Enter');
  await page.getByPlaceholder('Replace with…').fill(replacement);
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByText(/\d+ changes/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Replace all' }).click();
  await expect(page.getByText(/Replaced \d+ in \d+ file/)).toBeVisible({ timeout: 30_000 });
}

test.describe('18 · header, palette & recovery', () => {
  test('06 · header holds at 1280/1440/1920 and the settings menu carries the rest', async ({
    page,
  }) => {
    await page.goto(BASE);
    await openWorkspaceViaApi(page, tempFixture('multi-file'));

    for (const [w, h] of [
      [1280, 720],
      [1440, 900],
      [1920, 1080],
    ] as const) {
      await page.setViewportSize({ width: w, height: h });
      const header = page.locator('header');
      await expect(header).toBeVisible();
      await expect(page.getByRole('button', { name: /Build/ })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
      // no horizontal overflow inside the header at this size
      const overflow = await header.evaluate(
        (el) => el.scrollWidth - el.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(1);

      // the low-frequency controls live in the settings menu, reachable
      await page.getByRole('button', { name: 'Settings' }).click();
      await expect(page.getByRole('combobox', { name: /Compiler/ })).toBeVisible();
      await expect(page.getByRole('combobox', { name: 'Auto save', exact: true })).toBeVisible();
      await expect(page.getByRole('combobox', { name: 'Theme' })).toBeVisible();
      await page.keyboard.press('Escape');
    }
  });

  test('palette reaches export / import / statistics / panel toggles', async ({ page }) => {
    await page.goto(BASE);
    await openWorkspaceViaApi(page, tempFixture('multi-file'));

    for (const [query, label] of [
      ['Export', 'Export Project (ZIP)'],
      ['Import', 'Import Project (ZIP)…'],
      ['Statistics', 'Show Statistics'],
      ['Toggle PDF', 'Toggle PDF Preview'],
      ['Toggle Problems', 'Toggle Problems Panel'],
    ] as const) {
      await page.keyboard.press('Control+Shift+P');
      await page.getByPlaceholder('Type a command…').fill(query);
      await expect(page.getByRole('button', { name: label })).toBeVisible();
      await page.keyboard.press('Escape');
    }

    // the toggles really toggle — click the command by exact name rather than
    // Enter, so the executed command never depends on list ordering
    await page.keyboard.press('Control+Shift+P');
    await page.getByPlaceholder('Type a command…').fill('Toggle PDF Preview');
    await page.getByRole('button', { name: 'Toggle PDF Preview' }).click();
    await expect(page.getByText('No PDF yet')).toHaveCount(0);
    await page.keyboard.press('Control+Shift+P');
    await page.getByPlaceholder('Type a command…').fill('Toggle PDF Preview');
    await page.getByRole('button', { name: 'Toggle PDF Preview' }).click();
    await expect(page.getByText('No PDF yet')).toBeVisible();
  });

  test('07 · switching workspaces leaves nothing behind', async ({ page }) => {
    const dirA = tempFixture('multi-file');
    const dirB = tempFixture('chinese-thesis');
    await page.goto(BASE);
    await openWorkspaceViaApi(page, dirA);

    // workspace A accumulates state: a dirty tab, a labelled snapshot, search results
    await openFile(page, 'main.tex');
    await page.locator('.view-lines').click();
    await page.keyboard.type('% workspace-A-marker');
    await page.getByRole('tab', { name: 'History' }).click();
    await page.getByPlaceholder('Label (optional)').fill('A-marker');
    await page.getByRole('button', { name: 'Snapshot', exact: true }).click();
    await page.getByText('A-marker', { exact: true }).first().waitFor();
    await page.getByRole('tab', { name: 'Search' }).click();
    const query = page.getByPlaceholder('Search in project…');
    await query.fill('figure');
    await query.press('Enter');
    await expect(page.getByText(/in \d+ file/)).toBeVisible({ timeout: 15_000 });

    // switch through the real UI path (modal), not a reload
    await page.getByRole('button', { name: /multi-file/ }).click();
    await page.getByPlaceholder('e.g. D:\\Research\\thesis').fill(dirB);
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.getByRole('button', { name: /chinese-thesis/ })).toBeVisible({
      timeout: 30_000,
    });

    // nothing from A survives: no tabs, no diff, no search hits, no snapshots
    await expect(page.locator('[data-testid="tab-strip"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Diff: .*→ Now/ })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Search' }).click();
    await expect(page.getByText('No matches.')).toBeVisible(); // query kept, results gone
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.getByText('A-marker', { exact: true })).toHaveCount(0);
    await expect(page.getByText('No snapshots yet.')).toBeVisible();
    // disk truth for A is untouched
    expect(fs.readFileSync(path.join(dirA, 'main.tex'), 'utf8')).not.toContain(
      'workspace-A-marker'
    );
  });

  test('08 · replace + restore: dirty buffer preserved, clean buffer synced', async ({
    page,
  }) => {
    const dir = tempFixture('multi-file');
    await page.goto(BASE);
    await openWorkspaceViaApi(page, dir);
    const intro = path.join(dir, 'sections', 'intro.tex');

    // Scenario A — dirty buffer: replace-all rewrites the file underneath,
    // the unsaved user buffer must win
    await openFile(page, 'intro.tex');
    await page.locator('.view-lines').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n% user-dirty-marker');
    await expect(page.getByText('● Unsaved changes')).toBeVisible();

    await replaceAllViaUi(page, "introduction", "preamble");
    await expect(
      page
        .getByTestId('tab-strip')
        .getByRole('button', { name: /TEX intro\.tex \*/ })
    ).toBeVisible();
    await expect(page.locator('.view-lines')).toContainText('user-dirty-marker');
    await expect(page.locator('.view-lines')).not.toContainText('preamble');

    // save (user wins — buffer is written to disk as-is)
    await page.keyboard.press('Control+s');
    await expect(page.getByText('✓ Saved', { exact: true })).toBeVisible();

    // Scenario B — clean buffer: the next replace-all syncs the editor
    // (the disk now holds the user's saved version with 'introduction')
    await replaceAllViaUi(page, "introduction", "replaced-body-text");
    await expect(page.locator('.view-lines')).toContainText('replaced-body-text', {
      timeout: 15_000,
    });
    await expect(page.locator('button', { hasText: 'intro.tex *' })).toHaveCount(0);

    // restore the pre-replace snapshot — a clean tab follows the disk back
    await page.getByRole('tab', { name: 'History' }).click();
    await page.getByText('before replace all').first().click();
    await page.getByRole('button', { name: 'Restore this snapshot' }).click();
    await page.getByRole('button', { name: 'Yes, restore' }).click();
    await expect(page.getByText(/Restored \d+ file/)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.view-lines')).toContainText('This is the introduction', {
      timeout: 15_000,
    });
    expect(fs.readFileSync(intro, 'utf8')).toContain('This is the introduction');
  });
});
