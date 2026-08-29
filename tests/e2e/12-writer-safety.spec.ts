import { test, expect } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { BASE, tempFixture, openWorkspaceViaApi, openFile, apiToken } from './helpers';

/**
 * V0.4 writer's safety loop, the exact scenario from the plan's test matrix:
 * edit → project search → jump → Replace All (preview + confirm) → the
 * automatic pre-replace snapshot shows up in History → inspect its diff →
 * restore. Restoring must put the original bytes back on disk.
 */
test.describe('12 · writer safety loop (search → replace → snapshot → diff → restore)', () => {
  test('replace-all round trip through the UI restores the pre-replace state', async ({
    page,
  }) => {
    const dir = tempFixture('multi-file');
    await page.goto(BASE);
    await openWorkspaceViaApi(page, dir);
    const intro = path.join(dir, 'sections', 'intro.tex');

    // 1. Edit: a unique token + CJK sample appended to the body of intro.tex
    await openFile(page, 'intro.tex');
    await page.locator('.view-lines').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nalpha-e2e-token 中文统计样本\n');
    await page.keyboard.press('Control+s');
    await expect(page.locator('button', { hasText: 'intro.tex *' })).toHaveCount(0);

    // 2. Ctrl+Shift+F opens the project-wide search panel
    await page.keyboard.press('Control+Shift+F');
    const searchTab = page.getByRole('tab', { name: 'Search' });
    if ((await searchTab.getAttribute('aria-selected')) !== 'true') {
      await searchTab.click();
    }
    const query = page.getByPlaceholder('Search in project…');
    await expect(query).toBeVisible();
    await query.fill('alpha-e2e-token');
    await query.press('Enter');
    await expect(page.getByText(/1 in 1 file/)).toBeVisible({ timeout: 15_000 });

    // 3. Clicking a match jumps to the file and line in the editor
    await page.locator('button[title^="sections/intro.tex:"]').first().click();
    await expect(page.locator('.monaco-editor')).toBeVisible();
    await expect(page.locator('.view-lines')).toContainText('alpha-e2e-token');

    // 4. Replace All is preview-confirmed: Preview mints the token that arms Apply
    await page.getByPlaceholder('Replace with…').fill('beta-e2e-token');
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByText('1 changes')).toBeVisible({ timeout: 15_000 });
    const applyButton = page.getByRole('button', { name: 'Replace all' });
    await expect(applyButton).toBeEnabled();
    await applyButton.click();
    await expect(page.getByText(/Replaced 1 in 1 file/)).toBeVisible({ timeout: 30_000 });

    const afterReplace = fs.readFileSync(intro, 'utf8');
    expect(afterReplace).toContain('beta-e2e-token');
    expect(afterReplace).not.toContain('alpha-e2e-token');

    // 5. The automatic pre-replace snapshot appears in History
    //    (the server labels it; the panel shows the label when present)
    await page.getByRole('tab', { name: 'History' }).click();
    await page.getByText('before replace all').first().click();

    // 6. Its diff lists the modified file; clicking opens the inline diff view
    const diffRow = page.locator('button', { hasText: 'sections/intro.tex' }).first();
    await expect(diffRow).toBeVisible();
    await expect(diffRow).toHaveText(/M\s*sections\/intro\.tex/);
    await diffRow.click();
    await expect(page.locator('.monaco-diff-editor')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '← Back' }).click();

    // 7. Restore is a two-click confirmation, and puts the original bytes back
    await page.getByRole('button', { name: 'Restore this snapshot' }).click();
    await expect(page.getByText('Overwrite working tree with this snapshot?')).toBeVisible();
    await page.getByRole('button', { name: 'Yes, restore' }).click();
    await expect(page.getByText(/Restored \d+ file/)).toBeVisible({ timeout: 30_000 });

    const afterRestore = fs.readFileSync(intro, 'utf8');
    expect(afterRestore).toContain('alpha-e2e-token');
    expect(afterRestore).not.toContain('beta-e2e-token');
    // unrelated work done after the snapshot (the CJK sample) survives
    expect(afterRestore).toContain('中文统计样本');
    // the pre-restore safety snapshot was recorded
    await expect(page.getByText(/before restore snap_/).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});

/**
 * Same loop at the API level, plus the guarantees the UI cannot provoke on its
 * own: apply refuses to run without a preview token, and a partial restore
 * never deletes files created after the snapshot (the fixed P0 bug).
 */
test.describe('13 · replace/restore safety at the API level', () => {
  test('apply requires preview confirmation; pre-replace snapshot + restore round trip', async ({
    request,
  }) => {
    const token = await apiToken();
    const H = { 'x-latex-studio-token': token };

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lstudio-e2e-api-'));
    fs.writeFileSync(
      path.join(dir, 'main.tex'),
      '\\documentclass{article}\n\\begin{document}\nThe quick brown fox jumps.\n\\end{document}\n'
    );
    fs.writeFileSync(path.join(dir, 'ch1.tex'), 'The quick brown fox again.\n');
    await request.post('/api/workspace/open', { data: { path: dir }, headers: H });

    // apply without a preview token is rejected outright
    const noConfirm = await request.post('/api/search/replace/apply', {
      data: { query: 'fox', replacement: 'cat' },
      headers: H,
    });
    expect(noConfirm.status()).toBe(400);
    expect((await noConfirm.json()).error.code).toBe('CONFIRMATION_REQUIRED');

    const preview = await request.post('/api/search/replace/preview', {
      data: { query: 'fox', replacement: 'cat' },
      headers: H,
    });
    expect(preview.status()).toBe(200);
    const previewBody = (await preview.json()) as {
      confirmToken: string;
      totalReplacements: number;
    };
    expect(previewBody.totalReplacements).toBe(2);

    const apply = await request.post('/api/search/replace/apply', {
      data: { query: 'fox', replacement: 'cat', confirmToken: previewBody.confirmToken },
      headers: H,
    });
    expect(apply.status()).toBe(200);
    const applyBody = (await apply.json()) as {
      ok: boolean;
      filesModified: number;
      snapshotId: string;
    };
    expect(applyBody.ok).toBe(true);
    expect(applyBody.filesModified).toBe(2);
    const mainTex = path.join(dir, 'main.tex');
    expect(fs.readFileSync(mainTex, 'utf8')).toContain('cat jumps');
    expect(fs.readFileSync(path.join(dir, 'ch1.tex'), 'utf8')).not.toContain('fox');

    // the apply response points at a real pre-replace snapshot
    const list = (await (
      await request.get('/api/workspace/snapshots', { headers: H })
    ).json()) as { snapshotId: string; reason: string }[];
    expect(list.find((s) => s.snapshotId === applyBody.snapshotId)?.reason).toBe('pre-replace');

    // its diff flags both files as modified against the working tree
    const diff = (await (
      await request.get(`/api/workspace/snapshots/${applyBody.snapshotId}/diff`, { headers: H })
    ).json()) as { entries: { path: string; status: string }[] };
    expect(diff.entries.filter((e) => e.status === 'M').map((e) => e.path)).toEqual(
      expect.arrayContaining(['main.tex', 'ch1.tex'])
    );

    // full restore returns the original bytes…
    const restore = await request.post(`/api/workspace/snapshots/${applyBody.snapshotId}/restore`, {
      data: {},
      headers: H,
    });
    expect(restore.status()).toBe(200);
    expect(((await restore.json()) as { restoredFiles: number }).restoredFiles).toBeGreaterThan(0);
    expect(fs.readFileSync(mainTex, 'utf8')).toContain('fox jumps');

    // …and a partial restore never deletes files created after the snapshot
    const manual = await request.post('/api/workspace/snapshots', {
      data: { reason: 'manual', label: 'e2e-partial' },
      headers: H,
    });
    const manifest = (await manual.json()) as { snapshotId: string };
    fs.writeFileSync(path.join(dir, 'new-later.tex'), 'born after the snapshot\n');
    fs.writeFileSync(path.join(dir, 'ch1.tex'), 'mutated after the snapshot\n');
    const partial = await request.post(
      `/api/workspace/snapshots/${manifest.snapshotId}/restore`,
      { data: { files: ['ch1.tex'] }, headers: H }
    );
    expect(partial.status()).toBe(200);
    expect(fs.existsSync(path.join(dir, 'new-later.tex'))).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'ch1.tex'), 'utf8')).not.toContain('mutated');
  });
});

/**
 * Paper statistics through the real UI: the Navigator's Stats view must show
 * the CJK track for a Chinese thesis, including the per-chapter breakdown.
 */
test.describe('14 · paper statistics', () => {
  test('stats panel shows CJK counts and chapter breakdown for a Chinese thesis', async ({
    page,
  }) => {
    await page.goto(BASE);
    await openWorkspaceViaApi(page, tempFixture('chinese-thesis'));

    await page.getByRole('tab', { name: 'Navigator' }).click();
    await page.getByRole('button', { name: 'Stats' }).click();

    const cjkMetric = page.getByText('CJK chars').locator('..');
    await expect(cjkMetric).toBeVisible({ timeout: 15_000 });
    // 31+ CJK chars of body prose in the fixture; headings/captions would add more
    const value = Number((await cjkMetric.innerText()).replace(/[^\d]/g, ''));
    expect(value).toBeGreaterThanOrEqual(25);
    await expect(page.getByText('Latin words').locator('..')).toBeVisible();

    // per-chapter breakdown renders both chapters of the fixture
    await expect(page.getByText('Chapters by words')).toBeVisible();
    await expect(page.getByText('绪论').first()).toBeVisible();
    await expect(page.getByText('方法').first()).toBeVisible();
  });
});

/**
 * P1-1 fix: the auto-save policy and the auto-snapshot switch must be
 * reachable from the UI (header controls, mirrored as palette commands).
 */
test.describe('15 · auto-save settings entry points', () => {
  test('header controls exist and palette commands switch them', async ({ page }) => {
    await page.goto(BASE);
    await openWorkspaceViaApi(page, tempFixture('multi-file'));

    // defaults: both off
    const saveSelect = page.getByRole('combobox').filter({ hasText: 'Auto save:' });
    await expect(saveSelect).toHaveValue('off');
    const snapCheckbox = page.getByRole('checkbox', { name: 'Snap on blur' });
    await expect(snapCheckbox).not.toBeChecked();

    // palette command changes the policy — the header select follows
    await page.keyboard.press('Control+Shift+P');
    await page.getByPlaceholder('Type a command…').fill('Auto Save: On focus loss');
    await page.keyboard.press('Enter');
    await expect(saveSelect).toHaveValue('focus-loss');

    // palette toggle flips the auto-snapshot switch
    await page.keyboard.press('Control+Shift+P');
    await page.getByPlaceholder('Type a command…').fill('Auto Snapshot');
    await page.keyboard.press('Enter');
    await expect(snapCheckbox).toBeChecked();
  });
});
