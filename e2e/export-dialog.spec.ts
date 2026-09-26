import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp, fillPerson } from './helpers.js';

/**
 * The export dialog: encryption is an option (off, never focused unless asked
 * for), one action button, titles per format; the storage notice saves with
 * one click. See docs (local) ZADANI_DEV_export-dialog.md.
 */

async function importBigTree(page: Page, name: string): Promise<void> {
    await page.locator('#file-input').setInputFiles('test/comprehensive.json');
    await page.getByRole('button', { name: 'Continue with warnings' }).click();
    const dialog = page.locator('#import-tree-modal');
    await expect(dialog).toBeVisible();
    await dialog.locator('#import-tree-name').fill(name);
    await dialog.getByRole('button', { name: 'Import' }).click();
    await expect(dialog).toBeHidden();
}

async function refusePersistence(page: Page): Promise<void> {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'storage', {
            configurable: true,
            value: {
                ...(navigator.storage ? { estimate: navigator.storage.estimate.bind(navigator.storage) } : {}),
                persisted: async () => false,
                persist: async () => false,
            },
        });
    });
}

async function addPerson(page: Page, firstName: string): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showAddPersonModal());
    await fillPerson(page, firstName, 'Edit');
    await expect(page.locator('#person-modal')).toBeHidden();
}

const dialog = (page: Page) => page.locator('#export-password-modal');

test('export opens on the button: no password fields, encryption off', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => { window.Strom.UI.showExportDialog(); void window.Strom.UI.exportTargetTreeJSON(); });
    await expect(dialog(page)).toHaveClass(/active/);
    await expect(dialog(page).locator('#export-dialog-title')).toHaveText('Export – JSON');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('export-submit-btn');
    await expect(dialog(page).locator('#export-encrypt-toggle')).not.toBeChecked();
    await expect(dialog(page).locator('#export-password-input')).toBeHidden();
    await expect(dialog(page).locator('#export-submit-btn')).toHaveText('Export');
    // One action button only.
    await expect(dialog(page).locator('.export-buttons button')).toHaveCount(1);
});

test('the switch shows the password fields, focuses them, and names the button; off empties them', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => { window.Strom.UI.showExportDialog(); void window.Strom.UI.exportTargetTreeApp(); });
    const d = dialog(page);
    await expect(d.locator('#export-dialog-title')).toHaveText('Export – standalone app (HTML)');
    await d.locator('#export-encrypt-row').click();
    await expect(d.locator('#export-encrypt-toggle')).toHaveAttribute('aria-checked', 'true');
    await expect(d.locator('#export-password-input')).toBeFocused();
    await expect(d.locator('#export-submit-btn')).toHaveText('Export encrypted');
    await d.locator('#export-password-input').fill('secret1');
    await d.locator('#export-password-confirm').fill('secret1');
    await d.locator('#export-encrypt-row').click();
    await expect(d.locator('#export-password-input')).toBeHidden();
    await expect(d.locator('#export-encrypt-toggle')).toBeFocused();
    expect(await d.locator('#export-password-input').inputValue()).toBe('');
    expect(await d.locator('#export-password-confirm').inputValue()).toBe('');
    await expect(d.locator('#export-submit-btn')).toHaveText('Export');
});

for (const [format, method, title] of [
    ['GEDCOM', 'exportTargetTreeGedcom', 'Export – GEDCOM'],
    ['CSV', 'exportTargetTreeCsv', 'Export – CSV'],
] as const) {
    test(`${format} cannot be encrypted: no switch in the dialog at all`, async ({ page }) => {
        await openApp(page);
        await page.evaluate((m) => { window.Strom.UI.showExportDialog(); void (window.Strom.UI as unknown as Record<string, () => void>)[m](); }, method);
        await expect(dialog(page)).toHaveClass(/active/);
        await expect(dialog(page).locator('#export-dialog-title')).toHaveText(title);
        await expect(page.locator('#export-encrypt-toggle')).toHaveCount(0);
        // And it comes back for a format that can be encrypted.
        await page.evaluate(() => { window.Strom.UI.closeExportPasswordDialog(); void window.Strom.UI.exportTargetTreeJSON(); });
        await expect(page.locator('#export-encrypt-toggle')).toHaveCount(1);
    });
}

test('the storage notice saves with one click: a complete JSON, a toast, "Saved"', async ({ page }) => {
    await refusePersistence(page);
    await openApp(page, { fileCopyReminders: true });
    await importBigTree(page, 'Quick');
    await addPerson(page, 'First');
    const notice = page.locator('#file-copy-notice');
    await expect(notice).toBeVisible();
    await expect(notice.getByRole('button', { name: 'Encrypt with a password…' })).toBeVisible();
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        notice.getByRole('button', { name: 'Save to file' }).click(),
    ]);
    await expect(dialog(page)).not.toHaveClass(/active/);
    expect(download.suggestedFilename()).toBe('quick.json');
    const saved = JSON.parse(readFileSync(await download.path(), 'utf-8'));
    expect(Object.values(saved.persons).some((p: unknown) => (p as { firstName: string }).firstName === 'First')).toBe(true);
    await expect(page.locator('.toast').last()).toContainText('Saved to file quick.json');
    await expect(page.locator('#unsaved-copy-indicator')).toHaveClass(/is-saved/);
});

test('"Encrypt with a password…" opens the narrowed dialog, switch on, password focused', async ({ page }) => {
    await refusePersistence(page);
    await openApp(page, { fileCopyReminders: true });
    await importBigTree(page, 'Secret');
    await addPerson(page, 'First');
    await page.locator('#file-copy-notice').getByRole('button', { name: 'Encrypt with a password…' }).click();
    const d = dialog(page);
    await expect(d).toHaveClass(/active/);
    await expect(d.locator('#export-dialog-title')).toHaveText('Save to file');
    await expect(d.locator('#export-dialog-hint')).toContainText('The whole tree “Secret”');
    await expect(d.locator('#export-privacy-section')).toBeHidden();
    await expect(d.locator('#export-content-section')).toBeHidden();
    await expect(d.locator('#export-encrypt-toggle')).toBeChecked();
    await expect(d.locator('#export-password-input')).toBeFocused();
    await expect(d.locator('#export-submit-btn')).toHaveText('Save encrypted');
});

test('app data encrypted: the quick save opens the narrowed dialog with encryption on', async ({ page }) => {
    await refusePersistence(page);
    await openApp(page, { fileCopyReminders: true });
    await importBigTree(page, 'Locked');
    await addPerson(page, 'First');
    // Only the decision is under test here (setting up a real session is elsewhere).
    await page.evaluate(() => { window.Strom.SettingsManager.isEncryptionEnabled = () => true; });
    await page.locator('#unsaved-copy-indicator').click();
    const status = page.locator('#storage-status-modal');
    await expect(status.locator('#storage-status-encrypt')).toBeHidden();
    await status.locator('#storage-status-save').click();
    const d = dialog(page);
    await expect(d).toHaveClass(/active/);
    await expect(d.locator('#export-encrypt-toggle')).toBeChecked();
    await expect(d.locator('#export-app-encrypted-hint')).toBeVisible();
    // It can be turned off: then it saves without a password.
    await d.locator('#export-encrypt-row').click();
    await expect(d.locator('#export-submit-btn')).toHaveText('Save to file');
});

test('phones: content folds to one line; Edit unfolds it; a changed box says "Custom selection"', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await openApp(page);
    await page.evaluate(() => { window.Strom.UI.showExportDialog(); void window.Strom.UI.exportTargetTreeJSON(); });
    const d = dialog(page);
    const summary = d.locator('#export-content-summary');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('Complete archive');
    await expect(d.locator('.content-checks')).toBeHidden();
    await d.locator('#export-content-edit').click();
    await expect(d.locator('#export-content-edit')).toHaveAttribute('aria-expanded', 'true');
    await expect(d.locator('.content-checks')).toBeVisible();
    await d.locator('#export-content-notes').uncheck();
    await expect(d.locator('#export-content-summary-value')).toHaveText('Custom selection');
});

for (const width of [360, 768, 1280]) {
    test(`content cards keep the box small and the text inside at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await openApp(page);
        await page.evaluate(() => { window.Strom.UI.showExportDialog(); void window.Strom.UI.exportTargetTreeJSON(); });
        if (width < 500) await dialog(page).locator('#export-content-edit').click();
        const cards = await page.locator('#export-content-section .content-check').evaluateAll(els => els.map(el => {
            const card = el.getBoundingClientRect();
            const box = el.querySelector('input')!.getBoundingClientRect();
            const text = el.querySelector('span')!.getBoundingClientRect();
            return { box: box.width, inside: text.left >= card.left && text.right <= card.right + 0.5 };
        }));
        expect(cards).toHaveLength(4);
        for (const c of cards) {
            expect(c.box).toBeLessThanOrEqual(24);
            expect(c.inside).toBe(true);
        }
    });
}
