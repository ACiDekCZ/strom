import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, cardAction, personModal, addRelation } from './helpers.js';

/**
 * Research fields (sources, attachments, reference number, name spellings) are
 * off by default: most people writing down their family never touch them, and a
 * wall of fields is its own kind of unusable.
 */
const ADVANCED = ['#person-sources-section', '#attachments-section', '#refn-group',
    '#name-variants-group', '#question-group'];

test('a plain person form does not open with an archive of fields', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
    await cardAction(page, 'Jan', 'edit');
    const modal = personModal(page);
    await modal.locator('#expand-details').click();

    for (const sel of ADVANCED) {
        await expect(modal.locator(sel), sel).toBeHidden();
    }
    // What everyone needs is still right there.
    await expect(modal.locator('#input-deathdate')).toBeVisible();
    await expect(modal.locator('#input-notes')).toBeVisible();
    await expect(modal.locator('#btn-add-event')).toBeVisible();
});

test('turning research fields on brings them back', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
    await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));

    await cardAction(page, 'Jan', 'edit');
    const modal = personModal(page);
    await modal.locator('#expand-details').click();
    for (const sel of ADVANCED) {
        await expect(modal.locator(sel), sel).toBeVisible();
    }
});

test('a field that already has something in it is never hidden', async ({ page }) => {
    // The whole danger of a switch like this: hiding data the user has already
    // entered, so it silently disappears from their tree.
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        dm.updatePerson(dm.getAllPersons()[0].id, {
            refn: 'box 12/1880', nameVariants: ['Wischek'], question: 'Kdo byli rodiče?',
        });
    });
    // Research fields are OFF...
    await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(false));

    await cardAction(page, 'Jan', 'edit');
    const modal = personModal(page);
    // ...but these two have values, so they show anyway.
    await expect(modal.locator('#refn-group')).toBeVisible();
    await expect(modal.locator('#input-refn')).toHaveValue('box 12/1880');
    await expect(modal.locator('#name-variants-group')).toBeVisible();
    await expect(modal.locator('#input-name-variants')).toHaveValue('Wischek');
    await expect(modal.locator('#question-group')).toBeVisible();
    // The empty ones stay out of the way.
    await expect(modal.locator('#person-sources-section')).toBeHidden();
});

test('adding a person starts from the short form', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
    await page.evaluate(() => window.Strom.UI.showAddPersonModal());
    const modal = personModal(page);
    await modal.locator('#expand-details').click();
    for (const sel of ADVANCED) {
        await expect(modal.locator(sel), sel).toBeHidden();
    }
});

test('sources are hidden everywhere they appear, not just on a person', async ({ page }) => {
    // Sources sit in three places: the person, a marriage, and an event. Hiding
    // one and leaving the others was worse than hiding none — the form claimed
    // to be simple and the panel next to it did not.
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
    await addRelation(page, 'Jan', 'partner', 'Marie', 'Novakova', 'female');
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        dm.addLifeEvent(dm.getAllPersons()[0].id, { type: 'baptism', date: '1880' });
    });

    // Relationships panel: no citing a marriage record.
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        window.Strom.UI.showRelationshipsPanel(dm.getAllPersons()[0].id);
    });
    await expect(page.locator('#relationships-modal')).toHaveClass(/active/);
    await expect(page.locator('.partnership-citations')).toBeHidden();
    await page.keyboard.press('Escape');

    // Event editor: no citing an event either.
    await cardAction(page, 'Jan', 'edit');
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        window.Strom.UI.showEditEventModal(dm.getAllPersons()[0].events![0].id);
    });
    await expect(page.locator('#event-sources-section')).toBeHidden();
});

test('a marriage that already cites a source keeps showing it', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
    await addRelation(page, 'Jan', 'partner', 'Marie', 'Novakova', 'female');
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const src = dm.addSource({ title: 'Parish register' });
        const union = Object.values(dm.getData().partnerships)[0] as { id: string };
        dm.citePartnership(union.id, src.id);
    });

    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        window.Strom.UI.showRelationshipsPanel(dm.getAllPersons()[0].id);
    });
    await expect(page.locator('.partnership-citations')).toBeVisible();
    await expect(page.locator('.partnership-citations')).toContainText('Parish register');
});
