import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, cardAction, addRelation } from './helpers.js';

/**
 * Godparents & witnesses (K2). The point of the feature is that a godparent is
 * usually NOT in the tree — a neighbour — so a name alone has to be enough,
 * while a godparent who IS a relative can be linked.
 */
test('a godparent can be recorded by name alone, and is visible without reopening', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
    await cardAction(page, 'Jan', 'edit');

    await page.evaluate(() => window.Strom.UI.showAddEventModal());
    const editor = page.locator('#event-editor-modal');
    await expect(editor).toHaveClass(/active/);

    await editor.getByRole('button', { name: '+ Add', exact: true }).click();
    const row = page.locator('.participant-row').first();
    await row.locator('.participant-name').fill('Marie Dvořáková');
    await row.locator('.participant-note').fill('sousedka');
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(editor).toBeHidden();

    // Stored as data, not buried in a note.
    expect(await page.evaluate(() => window.Strom.DataManager.getAllPersons()[0].events?.[0].participants))
        .toMatchObject([{ role: 'godparent', name: 'Marie Dvořáková', note: 'sousedka' }]);

    // And readable straight from the event list.
    await expect(page.locator('.event-participants')).toContainText('Marie Dvořáková');
});

test('a godparent who is in the tree can be linked to their person', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
    await addRelation(page, 'Jan', 'parent', 'Frantisek', 'Novak');
    await cardAction(page, 'Jan', 'edit');

    await page.evaluate(() => window.Strom.UI.showAddEventModal());
    const editor = page.locator('#event-editor-modal');
    await editor.getByRole('button', { name: '+ Add', exact: true }).click();

    // The link button opens the person picker.
    await page.locator('.participant-link').first().click();
    await expect(page.locator('#participant-picker-modal')).toHaveClass(/active/);
    await page.locator('#participant-picker input').fill('Frantisek');
    await page.locator('#participant-picker .person-picker-item, #participant-picker [data-person-id]').first().click();
    await expect(page.locator('#participant-picker-modal')).not.toHaveClass(/active/);

    // The row now shows the person from the tree, and the name is not retyped.
    await expect(page.locator('.participant-name').first()).toHaveValue(/Frantisek/);
    await editor.getByRole('button', { name: 'Save' }).click();

    const saved = await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const jan = dm.getAllPersons().find((p: { firstName: string }) => p.firstName === 'Jan');
        const fra = dm.getAllPersons().find((p: { firstName: string }) => p.firstName === 'Frantisek');
        return { part: jan?.events?.[0].participants?.[0], fraId: fra?.id };
    });
    expect(saved.part).toMatchObject({ role: 'godparent', personId: saved.fraId });
    expect(saved.part.name).toBeUndefined();   // the name lives on the person, not copied
});

test('cancelling the editor does not touch the stored participants', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
    await cardAction(page, 'Jan', 'edit');
    await page.evaluate(() => window.Strom.UI.showAddEventModal());
    const editor = page.locator('#event-editor-modal');
    await editor.getByRole('button', { name: '+ Add', exact: true }).click();
    await page.locator('.participant-name').first().fill('Marie Dvořáková');
    await editor.getByRole('button', { name: 'Save' }).click();

    // Reopen, add another, then cancel: the first must survive untouched.
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const ev = dm.getAllPersons()[0].events![0];
        window.Strom.UI.showEditEventModal(ev.id);
    });
    await editor.getByRole('button', { name: '+ Add', exact: true }).click();
    await page.locator('.participant-name').nth(1).fill('Nikdo Nikdo');
    await editor.getByRole('button', { name: 'Cancel' }).click();

    expect(await page.evaluate(() => window.Strom.DataManager.getAllPersons()[0].events?.[0].participants))
        .toMatchObject([{ name: 'Marie Dvořáková' }]);
});
