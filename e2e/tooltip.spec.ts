import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, addRelation, card } from './helpers.js';

/** The hover card: what it shows, and that it shows it at all. */
const tip = (page: import('@playwright/test').Page, name: string) =>
    card(page, name).locator('.card-tooltip');

test('a place without a date is still shown', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        // Ordinary in parish work: you know the village, not the date.
        dm.updatePerson(dm.getAllPersons()[0].id, { birthPlace: 'Kolín', deathPlace: 'Beroun' });
        window.Strom.TreeRenderer.render();
    });

    // This person used to get no tooltip at all: both lines needed a date.
    await expect(tip(page, 'Jan')).toContainText('Kolín');
    await expect(tip(page, 'Jan')).toContainText('Beroun');
});

test('date and place read as one line when both are known', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880-05-15' });
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        dm.updatePerson(dm.getAllPersons()[0].id, { birthPlace: 'Kolín' });
        window.Strom.TreeRenderer.render();
    });
    await expect(tip(page, 'Jan')).toContainText('Kolín');
    expect(await tip(page, 'Jan').textContent()).toMatch(/\*.*1880.*Kolín/);
});

test('it carries what was added to a person today', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Josef', 'Víšek', { birthDate: '1783' });
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const id = dm.getAllPersons()[0].id;
        dm.updatePerson(id, { deathDate: '1850', nameVariants: ['Wischek'], question: 'Kdo byli rodiče?' });
        dm.addLifeEvent(id, { type: 'occupation', note: 'kovář', date: '1810' });
        window.Strom.TreeRenderer.render();
    });

    const text = await tip(page, 'Josef').textContent();
    expect(text).toContain('kovář');          // the trade
    expect(text).toContain('Wischek');        // how the registers spell him
    expect(text).toContain('Kdo byli rodiče?'); // the open question
    expect(text).toMatch(/67/);               // age, from the two dates
});

test('a partner shows with the marriage year', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });
    await addRelation(page, 'Jan', 'partner', 'Marie', 'Novakova', 'female');
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const u = Object.values(dm.getData().partnerships)[0] as { id: string };
        dm.updatePartnership(u.id, { startDate: '1905' });
        window.Strom.TreeRenderer.render();
    });
    await expect(tip(page, 'Jan')).toContainText('Marie Novakova');
    await expect(tip(page, 'Jan')).toContainText('1905');
});

test('nothing to say means no tooltip', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await expect(card(page, 'Jan').locator('.card-tooltip')).toHaveCount(0);
});
