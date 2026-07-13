import { test, expect, Page, TestInfo } from '@playwright/test';
import { pathToFileURL } from 'url';
import { openApp, createFirstPerson, card, addRelation } from './helpers.js';

/**
 * Start the standalone-HTML app export from the export dialog. Optionally set an
 * encryption password. Returns after the export-password dialog is ready to
 * confirm.
 */
async function openAppExportDialog(page: Page, password?: string): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showExportDialog());
    await page.evaluate(() => window.Strom.UI.exportTargetTreeApp());
    const pwd = page.locator('#export-password-modal');
    await expect(pwd).toBeVisible();
    await pwd.locator('#export-privacy-mode').selectOption('full');
    if (password) {
        await pwd.locator('#export-password-input').fill(password);
        await pwd.locator('#export-password-confirm').fill(password);
    }
}

/** Save the just-triggered download as an .html file and open it via file://. */
async function saveAndOpen(page: Page, testInfo: TestInfo, downloadPromise: Promise<import('@playwright/test').Download>): Promise<void> {
    const download = await downloadPromise;
    const out = testInfo.outputPath('exported.html');
    await download.saveAs(out);
    await page.goto(pathToFileURL(out).href);
}

test('exported standalone HTML opens in read-only view mode', async ({ page }, testInfo) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await addRelation(page, 'Jan', 'partner', 'Marie', 'Novak', 'female');

    await openAppExportDialog(page);
    await saveAndOpen(page, testInfo, (async () => {
        const [d] = await Promise.all([
            page.waitForEvent('download'),
            page.locator('#export-password-modal').getByRole('button', { name: 'Export without encryption' }).click(),
        ]);
        return d;
    })());

    await expect(page.locator('body')).toHaveClass(/view-mode/);
    await expect(page.locator('#view-mode-banner')).toBeVisible();
    await expect(card(page, 'Jan')).toBeVisible();
    await expect(card(page, 'Marie')).toBeVisible();

    // Editing affordances are hidden in view mode (CSS driven by body.view-mode).
    await expect(page.locator('#add-person-btn')).toBeHidden();
    await expect(page.locator('.add-person-round')).toBeHidden();
    await expect(page.locator('.toolbar-buttons')).toBeHidden();
});

test('encrypted exported HTML requires the correct password to reveal the tree', async ({ page }, testInfo) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await addRelation(page, 'Jan', 'partner', 'Marie', 'Novak', 'female');

    await openAppExportDialog(page, 'correct-horse');
    await saveAndOpen(page, testInfo, (async () => {
        const [d] = await Promise.all([
            page.waitForEvent('download'),
            page.locator('#export-password-modal').locator('#export-with-password-btn').click(),
        ]);
        return d;
    })());

    // The opened file withholds view mode behind a password prompt.
    const prompt = page.locator('#password-prompt-modal');
    await expect(prompt).toBeVisible();
    await expect(page.locator('body')).not.toHaveClass(/view-mode/);

    // Wrong password: error shown, prompt stays, still locked.
    await prompt.locator('#password-prompt-input').fill('nope');
    await prompt.locator('#password-prompt-input').press('Enter');
    await expect(prompt.locator('#password-prompt-error')).toBeVisible();
    await expect(prompt).toBeVisible();

    // Correct password: prompt closes, tree revealed in view mode.
    await prompt.locator('#password-prompt-input').fill('correct-horse');
    await prompt.locator('#password-prompt-input').press('Enter');
    await expect(prompt).toBeHidden();
    await expect(page.locator('body')).toHaveClass(/view-mode/);
    await expect(card(page, 'Jan')).toBeVisible();
    await expect(card(page, 'Marie')).toBeVisible();
});
