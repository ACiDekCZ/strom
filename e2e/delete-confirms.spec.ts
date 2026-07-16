import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, cardAction } from './helpers.js';

/**
 * A confirmation has to say WHAT it is about to destroy. The app already does
 * this for a person and for a tree; events, attachments and backups asked
 * "Delete this event?" and left the user guessing which row they had hit.
 */
/** The confirm can open a tick late (some paths read storage first). */
async function confirmText(page: import('@playwright/test').Page): Promise<string> {
    await expect(page.locator('#confirmation-modal')).toHaveClass(/active/);
    return page.locator('#confirm-message').innerText();
}

test('deleting an event says which event', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const id = dm.getAllPersons()[0].id;
        dm.addLifeEvent(id, { type: 'baptism', date: '1880-05-20', place: 'Kolín' });
        dm.addLifeEvent(id, { type: 'occupation', note: 'kovář', date: '1910' });
    });
    await cardAction(page, 'Jan', 'edit');

    // The second one — a generic message would be identical for both.
    await page.locator('.event-row:not(.readonly)').nth(1).locator('.event-actions button').nth(1).click();
    const text = await confirmText(page);
    expect(text).toContain('Occupation');
    expect(text).toContain('1910');
    expect(text).not.toContain('Baptism');

    // And it really deletes that one.
    await page.getByRole('button', { name: 'Yes' }).click();
    const left = await page.evaluate(() =>
        window.Strom.DataManager.getAllPersons()[0].events!.map(e => e.type));
    expect(left).toEqual(['baptism']);
});

test('deleting an attachment says which file', async ({ page }) => {
    await openApp(page);
    await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
    await cardAction(page, 'Jan', 'edit');
    await page.locator('#input-attachment').setInputFiles('e2e/fixtures/avatar.png');
    await expect(page.locator('.attachment-row')).toHaveCount(1);

    await page.locator('.attachment-row button[title="Delete"], .attachment-delete').first().click();
    expect(await confirmText(page)).toContain('avatar.png');
});

test('deleting a backup says which backup', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
    await page.evaluate(async () => { await window.Strom.DataManager.snapshotNow('manual'); });
    await page.evaluate(() => window.Strom.UI.showSnapshotsDialog());

    await page.locator('.snapshot-delete').first().click();
    const text = await confirmText(page);
    expect(text).toContain('person');          // "1 person" — what is in it
    // …and WHEN it was taken: the current year, as toLocaleString prints it
    // ("1 person" alone would satisfy any bare \d+ pattern).
    expect(text).toContain(String(new Date().getFullYear()));
});
