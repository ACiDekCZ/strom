import { test, expect, Page } from '@playwright/test';
import { openApp } from './helpers.js';

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

test('a big tree the browser may clear gets a one-time notice that opens the export', async ({ page }) => {
    await stubPersistence(page, false);
    await openApp(page, { persistenceWarning: true });
    await importBigTree(page, 'Persistence');
    const notice = page.locator('#persistence-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('53 people');
    await notice.getByRole('button', { name: 'Export' }).click();
    await expect(notice).toHaveCount(0);
    await expect(page.locator('#export-modal')).toBeVisible();

    // Once only: a reload and another save stay quiet.
    await page.reload();
    await expect(page.locator('.toolbar')).toBeVisible();
    await importBigTree(page, 'Persistence 2');
    await page.waitForFunction(() => (window as unknown as { __persistAsked?: number }).__persistAsked === 1);
    await expect(page.locator('#persistence-notice')).toHaveCount(0);
});

test('the backups dialog says whether the browser may clear the data', async ({ page }) => {
    await stubPersistence(page, false);
    await openApp(page);
    await importBigTree(page, 'Backups');
    await page.evaluate(() => window.Strom.UI.showSnapshotsDialog());
    await expect(page.locator('#snapshots-persistence')).toContainText('may clear this data');
});

test('persistent storage: no notice, and the backups dialog says so', async ({ page }) => {
    await stubPersistence(page, true);
    await openApp(page, { persistenceWarning: true });
    await importBigTree(page, 'Persistent');
    await page.waitForFunction(() => (window as unknown as { __persistAsked?: number }).__persistAsked === 1);
    await expect(page.locator('#persistence-notice')).toHaveCount(0);
    await page.evaluate(() => window.Strom.UI.showSnapshotsDialog());
    await expect(page.locator('#snapshots-persistence')).toContainText('Storage is persistent');
});
