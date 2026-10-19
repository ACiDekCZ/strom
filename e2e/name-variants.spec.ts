import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, cardAction, personModal, card } from './helpers.js';

/**
 * Name variants (K3). Before ~1900 spelling was not fixed: the same family is
 * Fischek in one register and Fíšek in the next. What the register wrote is a
 * fact about the source, not a typo — and if search cannot see it, you decide
 * the ancestor is missing and enter him twice.
 */
test('search finds a person under the spelling the register used', async ({ page }) => {
    await openApp(page);
    // Name variants are a research field — off by default (see advanced-fields.spec).
    await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));
    await createFirstPerson(page, 'Josef', 'Fíšek', { birthDate: '1783' });

    await cardAction(page, 'Josef', 'edit');
    const modal = personModal(page);
    await modal.locator('#input-name-variants').fill('Fischek, Fissek, u Kováře');
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).toBeHidden();

    expect(await page.evaluate(() => window.Strom.DataManager.getAllPersons()[0].nameVariants))
        .toEqual(['Fischek', 'Fissek', 'u Kováře']);

    // The whole point: every written form finds him.
    for (const term of ['Fíšek', 'Fischek', 'Fissek', 'Kováře']) {
        const hits = await page.evaluate((q) => window.Strom.DataManager.searchPersons(q).length, term);
        expect(hits, `searching "${term}"`).toBe(1);
    }
});

test('a variant alone reopens visible; clearing the field removes the variants', async ({ page }) => {
    await openApp(page);
    // Name variants / reference numbers are research fields — off by default.
    await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));
    await createFirstPerson(page, 'Josef', 'Fíšek');
    await cardAction(page, 'Josef', 'edit');
    const modal = personModal(page);
    await modal.locator('#input-name-variants').fill('Fischek');
    await modal.getByRole('button', { name: 'Save' }).click();

    // Reopen: a person whose only extra detail is a variant shows it on screen,
    // not hidden behind "More info" (the form auto-expands for extended data).
    await cardAction(page, 'Josef', 'edit');
    await expect(modal.locator('#input-name-variants')).toBeVisible();
    await expect(modal.locator('#input-name-variants')).toHaveValue('Fischek');
    await modal.locator('#input-name-variants').fill('');
    await modal.getByRole('button', { name: 'Save' }).click();

    expect(await page.evaluate(() => window.Strom.DataManager.getAllPersons()[0].nameVariants))
        .toBeUndefined();
    await expect(card(page, 'Josef')).toBeVisible();
});
