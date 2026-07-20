import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { openApp, createFirstPerson } from './helpers.js';

/** Give the first (and only) person a sizeable inline photo. */
async function giveFirstPersonAPhoto(page: Page): Promise<void> {
    await page.evaluate(() => {
        const p = window.Strom.DataManager.getAllPersons()[0];
        window.Strom.DataManager.updatePerson(p.id, { photo: 'data:image/jpeg;base64,' + 'A'.repeat(4000) });
    });
}

/** Open the JSON export dialog (which surfaces the Content section). */
async function openJsonExportDialog(page: Page) {
    await page.evaluate(() => window.Strom.UI.showExportDialog());
    await page.evaluate(() => window.Strom.UI.exportTargetTreeJSON());
    const pwd = page.locator('#export-password-modal');
    await expect(pwd).toBeVisible();
    return pwd;
}

test('export dialog shows the Content section: four checkboxes on by default, three presets, live estimate', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1950' });

    const pwd = await openJsonExportDialog(page);
    const section = pwd.locator('#export-content-section');
    await expect(section).toBeVisible();

    // Four checkboxes, all ticked.
    for (const id of ['photos', 'attachments', 'notes', 'sources']) {
        await expect(pwd.locator(`#export-content-${id}`)).toBeChecked();
    }
    // Three presets, with "Complete archive" highlighted (matches all-on).
    await expect(pwd.locator('.content-preset')).toHaveCount(3);
    await expect(pwd.locator('.content-preset[data-preset="complete"]')).toHaveClass(/active/);

    // A live size estimate is shown.
    await expect(pwd.locator('#export-content-size')).toContainText(/Estimated size:/);
});

test('"Small file to send" produces a JSON without photos but with the persons', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1950' });
    await giveFirstPersonAPhoto(page);

    const pwd = await openJsonExportDialog(page);
    await pwd.locator('#export-privacy-mode').selectOption('full');

    // Apply the "small file" preset: photos + attachments off, text kept.
    await pwd.locator('.content-preset[data-preset="small"]').click();
    await expect(pwd.locator('#export-content-photos')).not.toBeChecked();
    await expect(pwd.locator('#export-content-notes')).toBeChecked();

    const [download] = await Promise.all([
        page.waitForEvent('download'),
        pwd.getByRole('button', { name: 'Export without encryption' }).click(),
    ]);
    const data = JSON.parse(readFileSync(await download.path(), 'utf-8'));

    // Persons survive; no person carries a photo.
    expect(Object.keys(data.persons).length).toBe(1);
    const withPhoto = Object.values(data.persons).filter((p: { photo?: string }) => p.photo);
    expect(withPhoto).toHaveLength(0);
    // Names (structure) are intact.
    expect(Object.values(data.persons).map((p: { firstName: string }) => p.firstName)).toContain('Jan');
});

test('size estimate shrinks when photos are unchecked', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1950' });
    await giveFirstPersonAPhoto(page);

    const pwd = await openJsonExportDialog(page);
    const sizeEl = pwd.locator('#export-content-size');
    const before = (await sizeEl.textContent())?.trim();

    // Unchecking photos drops the largest component; the estimate must change.
    await pwd.locator('#export-content-photos').uncheck();
    const after = (await sizeEl.textContent())?.trim();

    expect(after).not.toBe(before);
    // Custom mix: no preset stays highlighted.
    await expect(pwd.locator('.content-preset.active')).toHaveCount(0);
});
