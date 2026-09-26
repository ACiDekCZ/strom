import { test, expect, Page } from '@playwright/test';
import { openApp, fillPerson, exportTreeJson } from './helpers.js';

/** Import the 53-person fixture as a new tree (it has no version: accept the warning). */
async function importBigTree(page: Page, name: string): Promise<void> {
    await page.locator('#file-input').setInputFiles('test/comprehensive.json');
    await page.getByRole('button', { name: 'Continue with warnings' }).click();
    const dialog = page.locator('#import-tree-modal');
    await expect(dialog).toBeVisible();
    await dialog.locator('#import-tree-name').fill(name);
    await dialog.getByRole('button', { name: 'Import' }).click();
    await expect(dialog).toBeHidden();
}

/** Make the browser keep storage best-effort (refuse persistence) or grant it. */
async function stubPersistence(page: Page, granted: boolean): Promise<void> {
    await page.addInitScript((ok) => {
        let persistent = false;
        Object.defineProperty(navigator, 'storage', {
            configurable: true,
            value: {
                ...(navigator.storage ? { estimate: navigator.storage.estimate.bind(navigator.storage), getDirectory: navigator.storage.getDirectory?.bind(navigator.storage) } : {}),
                persisted: async () => persistent,
                persist: async () => { persistent = ok; (window as unknown as { __persistAsked: number }).__persistAsked = ((window as unknown as { __persistAsked?: number }).__persistAsked ?? 0) + 1; return ok; },
            },
        });
    }, granted);
}

/** A user edit: add an unconnected person from the toolbar. */
async function addPerson(page: Page, firstName: string): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showAddPersonModal());
    await fillPerson(page, firstName, 'Edit');
    await expect(page.locator('#person-modal')).toBeHidden();
}

test('edits no file holds: a notice at once, the toolbar icon until the next export', async ({ page }) => {
    await stubPersistence(page, false);
    await openApp(page, { fileCopyReminders: true });
    const notice = page.locator('#file-copy-notice');
    const indicator = page.locator('#unsaved-copy-indicator');

    // An imported tree has its file: nothing to warn about yet.
    await importBigTree(page, 'Persistence');
    await page.waitForFunction(() => (window as unknown as { __persistAsked?: number }).__persistAsked === 1);
    await expect(notice).toHaveCount(0);
    await expect(indicator).toBeHidden();

    // The first edit: notice + icon; "Save to file" goes straight to a full
    // JSON backup of this tree (the encryption step, privacy "all data").
    await addPerson(page, 'First');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Persistence');
    await expect(indicator).toBeVisible();
    await notice.getByRole('button', { name: 'Save to file' }).click();
    await expect(notice).toHaveCount(0);
    const pwd = page.locator('#export-password-modal');
    await expect(pwd).toBeVisible();
    await expect(pwd.locator('#export-privacy-mode')).toHaveValue('full');
    await pwd.locator('.close-btn').first().click();

    // More edits in the same stretch stay quiet (the icon stays).
    await addPerson(page, 'Second');
    await expect(indicator).toBeVisible();
    await expect(notice).toHaveCount(0);

    // A full export: "Saved to file" briefly, then the pill goes; the next
    // edit starts a new stretch.
    await exportTreeJson(page);
    await expect(indicator).toHaveClass(/is-saved/);
    await expect(indicator).toBeHidden({ timeout: 6000 });
    await addPerson(page, 'Third');
    await expect(notice).toBeVisible();

    // After a reload: the icon is back (still unsaved), no notice without an edit.
    await page.reload();
    await expect(page.locator('.toolbar')).toBeVisible();
    await expect(indicator).toBeVisible();
    await expect(notice).toHaveCount(0);

    // The icon opens "Where your data is".
    await indicator.click();
    const dialog = page.locator('#storage-status-modal');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('may clear it');
    await expect(dialog).toContainText('Changes made since then are only in the browser');
});

test('reminders off: no notice, the toolbar icon still shows', async ({ page }) => {
    await stubPersistence(page, false);
    await openApp(page);
    await importBigTree(page, 'Quiet');
    await addPerson(page, 'First');
    await expect(page.locator('#unsaved-copy-indicator')).toBeVisible();
    await expect(page.locator('#file-copy-notice')).toHaveCount(0);
});

test('the backups dialog says whether the browser may clear the data', async ({ page }) => {
    await stubPersistence(page, false);
    await openApp(page);
    await importBigTree(page, 'Backups');
    await page.evaluate(() => window.Strom.UI.showSnapshotsDialog());
    const note = page.locator('#snapshots-persistence');
    await expect(note).toContainText('may clear it');
    await expect(note).toContainText('was last saved to a file (or opened from one)');
    await note.getByRole('button', { name: 'Where is my data?' }).click();
    await expect(page.locator('#storage-status-modal')).toBeVisible();
});

test('persistent storage: no notice, no icon, and the backups dialog says so', async ({ page }) => {
    await stubPersistence(page, true);
    await openApp(page, { fileCopyReminders: true });
    await importBigTree(page, 'Persistent');
    await addPerson(page, 'First');
    await page.waitForFunction(() => (window as unknown as { __persistAsked?: number }).__persistAsked === 1);
    await expect(page.locator('#file-copy-notice')).toHaveCount(0);
    await expect(page.locator('#unsaved-copy-indicator')).toBeHidden();
    await page.evaluate(() => window.Strom.UI.showSnapshotsDialog());
    await expect(page.locator('#snapshots-persistence')).toContainText('keeps the storage for good');
});

test('wide screens: a labelled pill, "Saved to file" after an export', async ({ page }) => {
    await stubPersistence(page, false);
    await page.setViewportSize({ width: 1440, height: 800 });
    await openApp(page);
    await importBigTree(page, 'Wide');
    await addPerson(page, 'First');
    const pill = page.locator('#unsaved-copy-indicator');
    await expect(pill).toBeVisible();
    await expect(pill.locator('.storage-pill-label')).toHaveText('Only in browser');
    await exportTreeJson(page);
    await expect(pill.locator('.storage-pill-label')).toHaveText('Saved to file');
    await expect(pill).toBeHidden({ timeout: 6000 });
});

test('bottom-bar regime: the state rides the More tab and tops its sheet', async ({ page }) => {
    await stubPersistence(page, false);
    await page.setViewportSize({ width: 390, height: 800 });
    await openApp(page);
    await importBigTree(page, 'Phone');
    const dot = page.locator('#bottom-bar-more-storage-dot');
    await expect(dot).toBeHidden();
    await addPerson(page, 'First');
    await expect(page.locator('#unsaved-copy-indicator')).toBeHidden();
    await expect(dot).toBeVisible();
    await expect(page.locator('#bb-view-more')).toHaveAttribute('aria-label', 'More – changes only in the browser');
    await page.locator('#bb-view-more').click();
    const row = page.locator('.bottom-sheet-storage-row');
    await expect(row).toContainText('Only in browser');
    await row.click();
    await expect(page.locator('#storage-status-modal')).toBeVisible();
    await expect(page.locator('#storage-status-modal .storage-pill')).toHaveClass(/is-unsaved/);
});

test('no state, no row in the More sheet', async ({ page }) => {
    await stubPersistence(page, false);
    await page.setViewportSize({ width: 390, height: 800 });
    await openApp(page);
    await importBigTree(page, 'Clean');
    await page.locator('#bb-view-more').click();
    await expect(page.locator('.bottom-sheet-menu')).toBeVisible();
    await expect(page.locator('.bottom-sheet-storage-row')).toHaveCount(0);
});

test('reduced motion: the first-edit highlight does not animate', async ({ page }) => {
    await stubPersistence(page, false);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 800 });
    await openApp(page, { fileCopyReminders: true });
    await importBigTree(page, 'Calm');
    await addPerson(page, 'First');
    await expect(page.locator('#file-copy-notice')).toBeVisible();
    const running = await page.locator('#unsaved-copy-indicator').evaluate(el => el.getAnimations().length);
    expect(running).toBe(0);
});

test('the indicator covers every tree; the dialog names them and saves all', async ({ page }) => {
    await stubPersistence(page, false);
    await openApp(page);
    await importBigTree(page, 'First tree');
    await addPerson(page, 'Edited');
    await importBigTree(page, 'Second tree');
    // The open tree is saved (just imported), the first still is not.
    const indicator = page.locator('#unsaved-copy-indicator');
    await expect(indicator).toBeVisible();
    await indicator.click();
    const dialog = page.locator('#storage-status-modal');
    // Only another tree is unsaved: a list, and "Save all trees" is the primary action.
    await expect(dialog.locator('.storage-status-list-title')).toHaveText('Not saved to a file yet');
    await expect(dialog.locator('.storage-status-trees li')).toHaveCount(1);
    await expect(dialog.locator('.storage-status-trees')).toContainText('First tree');
    await expect(dialog.locator('#storage-status-save')).toBeHidden();
    await expect(dialog.locator('#storage-status-save-all')).toHaveClass(/primary/);
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        (async () => {
            await dialog.getByRole('button', { name: 'Save all trees' }).click();
            await page.locator('#export-password-modal').getByRole('button', { name: 'Export without encryption' }).click();
        })(),
    ]);
    expect(download.suggestedFilename()).toBe('strom-all-trees.json');
    await expect(indicator).toHaveClass(/is-saved/);
});

test('"Save all trees" only when two or more trees are unsaved; the open one first', async ({ page }) => {
    await stubPersistence(page, false);
    await openApp(page);
    await importBigTree(page, 'One');
    await addPerson(page, 'A');
    await page.locator('#unsaved-copy-indicator').click();
    const dialog = page.locator('#storage-status-modal');
    await expect(dialog.locator('#storage-status-save')).toBeVisible();
    await expect(dialog.locator('#storage-status-save-all')).toBeHidden();
    await expect(dialog.locator('.storage-status-trees')).toHaveCount(0);
    await page.evaluate(() => window.Strom.UI.closeStorageStatusDialog());

    await importBigTree(page, 'Two');
    await addPerson(page, 'B');
    await page.locator('#unsaved-copy-indicator').click();
    await expect(dialog.locator('#storage-status-save')).toBeVisible();
    await expect(dialog.locator('#storage-status-save-all')).toBeVisible();
    await expect(dialog.locator('#storage-status-save-all')).not.toHaveClass(/primary/);
    const rows = dialog.locator('.storage-status-trees li');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Two');
    await expect(rows.first().locator('.tree-badge')).toHaveText('open');
});

for (const width of [360, 768]) {
    test(`the "More" dots sit on the icon's corner at ${width}px, safe area or not`, async ({ page }) => {
        await stubPersistence(page, false);
        await page.setViewportSize({ width, height: 800 });
        await openApp(page);
        await importBigTree(page, 'Dots');
        await addPerson(page, 'A');
        for (const pad of [0, 34]) {
            await page.evaluate((p) => { (document.querySelector('.bottom-bar') as HTMLElement).style.paddingBottom = `${p}px`; }, pad);
            const gap = await page.evaluate(() => {
                const icon = document.querySelector('#bb-view-more .bottom-bar-icon')!.getBoundingClientRect();
                const dot = document.getElementById('bottom-bar-more-storage-dot')!.getBoundingClientRect();
                return { dx: Math.abs(dot.right - (icon.right + 4)), dy: Math.abs(dot.top - (icon.top - 2)) };
            });
            expect(gap.dx, `pad ${pad}: dot x`).toBeLessThanOrEqual(6);
            expect(gap.dy, `pad ${pad}: dot y`).toBeLessThanOrEqual(6);
        }
        // The top ⋯ carries the state too (the bottom bar may be off screen).
        await expect(page.locator('.mobile-more-btn .mobile-more-storage-dot')).toBeVisible();
    });
}

for (const width of [1100, 1200]) {
    test(`${width}px: the state never takes room from the tree switcher's name`, async ({ page }) => {
        await stubPersistence(page, false);
        await page.setViewportSize({ width, height: 800 });
        await openApp(page);
        await importBigTree(page, 'Novákovi');
        const nameWidth = () => page.locator('.tree-switcher-btn .tree-name').evaluate(el => el.clientWidth);
        const before = await nameWidth();
        await addPerson(page, 'A');
        await expect(page.locator('body')).toHaveClass(/storage-unsaved/);
        expect(await nameWidth()).toBe(before);
        if (width < 1180) {
            // No pill here: the Actions ⋯ has the dot, its menu the state row.
            await expect(page.locator('#unsaved-copy-indicator')).toBeHidden();
            await expect(page.locator('.actions-menu-storage-dot')).toBeVisible();
            await page.locator('.actions-menu-btn').click();
            await page.locator('#actions-storage-row').click();
            await expect(page.locator('#storage-status-modal')).toBeVisible();
        } else {
            await expect(page.locator('#unsaved-copy-indicator')).toBeVisible();
            await expect(page.locator('.actions-menu-storage-dot')).toBeHidden();
        }
    });
}
