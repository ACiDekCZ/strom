import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, card, cardAction } from './helpers.js';

/**
 * Occupation (B7, first half). It is an event, not a field, because a trade
 * changes over a life — apprentice, journeyman, master. What was missing was
 * that the field you type it into was labelled "Note", so people wrote
 * sentences into what GEDCOM exports as the man's occupation.
 */
test('the field says it is the occupation, not a note', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
    await cardAction(page, 'Jan', 'edit');
    await page.evaluate(() => window.Strom.UI.showAddEventModal());

    const label = page.locator('#event-note-label');
    const field = page.locator('#input-event-note');

    // Baptism (the default): a note is a note.
    await expect(label).toHaveText('Note');

    await page.locator('#input-event-type').selectOption('occupation');
    await expect(label).toHaveText('Occupation / trade');
    // And it says what belongs in it, since this becomes GEDCOM OCCU.
    await expect(field).toHaveAttribute('placeholder', /blacksmith/);

    await page.locator('#input-event-type').selectOption('residence');
    await expect(label).toHaveText('Note');
});

test('the card and tooltip show the trade someone ended up with', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const id = dm.getAllPersons()[0].id;
        dm.addLifeEvent(id, { type: 'occupation', note: 'učeň', date: '1895' });
        dm.addLifeEvent(id, { type: 'occupation', note: 'kovář', date: '1910' });
        window.Strom.UI.setCardDensity('detailed');
    });

    // A trade changes over a life; the summary shows the last one, not the first.
    await expect(card(page, 'Jan').locator('.card-trade')).toHaveText('kovář');
    await expect(card(page, 'Jan')).toContainText('kovář');
    await expect(card(page, 'Jan')).not.toContainText('učeň');

    // The tooltip carries it at every density — it used to show it nowhere.
    await page.evaluate(() => window.Strom.UI.setCardDensity('normal'));
    await expect(card(page, 'Jan').locator('.card-tooltip')).toContainText('kovář');
});

test('a person with no trade recorded gets no empty line', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
    await page.evaluate(() => window.Strom.UI.setCardDensity('detailed'));
    await expect(card(page, 'Jan').locator('.card-trade')).toHaveCount(0);
});
