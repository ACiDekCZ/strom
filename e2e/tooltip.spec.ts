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

test('it shows the life span and the age it worked out to', async ({ page }) => {
    // The hover card is a fixed summary now (name, birth, death, family). The
    // richer detail — trade, name spellings, open questions — lives in the
    // person modal, not the hover.
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
    expect(text).toContain('1783');           // born
    expect(text).toContain('1850');           // died
    expect(text).toMatch(/67/);               // age, from the two dates
});

test('a partner shows on the relationship line', async ({ page }) => {
    // The hover card names the primary partner; the marriage year and status
    // belong to the modal, not the summary.
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
});

test('nothing to say means no tooltip', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await expect(card(page, 'Jan').locator('.card-tooltip')).toHaveCount(0);
});

test('the hover card gains a photo column when the person has one, none otherwise', async ({ page }) => {
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQAY3Y2wAAAAAElFTkSuQmCC';
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1880' });

    // No photo → no column at all (initials stay on the card, not the tooltip).
    await expect(tip(page, 'Jan').locator('.tt-photo')).toHaveCount(0);
    await expect(tip(page, 'Jan')).not.toHaveClass(/has-photo/);

    // Add the same thumbnail the card avatar uses → a photo column appears.
    await page.evaluate((photo) => {
        const dm = window.Strom.DataManager;
        dm.updatePerson(dm.getAllPersons()[0].id, { photo });
        window.Strom.TreeRenderer.render();
    }, PNG);

    await expect(tip(page, 'Jan')).toHaveClass(/has-photo/);
    await expect(tip(page, 'Jan').locator('.tt-photo')).toHaveCount(1);
    const src = await tip(page, 'Jan').locator('.tt-photo').getAttribute('src');
    expect(src).toMatch(/^data:image\//);
});
