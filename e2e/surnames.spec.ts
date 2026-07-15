import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, addRelation } from './helpers.js';

/**
 * Surname spellings (K3 v2). The registers write a family differently from one
 * entry to the next: the great-grandfathers are Vyšek, the living are Víšek.
 * Said ONCE for the tree — the first version wanted it on every person, in both
 * directions, and left anyone added later out.
 */
async function twoSpellings(page: import('@playwright/test').Page): Promise<void> {
    await createFirstPerson(page, 'Jan', 'Víšek', { birthDate: '1950' });
    await addRelation(page, 'Jan', 'parent', 'Josef', 'Vyšek');
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const p = dm.getAllPersons().find((x: { firstName: string }) => x.firstName === 'Josef');
        if (p) dm.updatePerson(p.id, { birthDate: '1880' });
    });
}

test('one entry makes both spellings findable, in both directions', async ({ page }) => {
    await openApp(page);
    await twoSpellings(page);

    // Before: each spelling finds only its own.
    expect(await page.evaluate(() => window.Strom.DataManager.searchPersons('Víšek').length)).toBe(1);

    await page.evaluate(() => window.Strom.UI.showSurnamesDialog());
    await expect(page.locator('#surnames-modal')).toBeVisible();

    // The tree's own surnames are offered — no typing needed for these.
    await page.locator('.surname-chip', { hasText: 'Víšek' }).click();
    await page.locator('.surname-chip', { hasText: 'Vyšek' }).click();
    await page.getByRole('button', { name: 'Link them', exact: true }).click();

    // One entry, and it works whichever way you search.
    expect(await page.evaluate(() => window.Strom.DataManager.searchPersons('Víšek').length)).toBe(2);
    expect(await page.evaluate(() => window.Strom.DataManager.searchPersons('Vyšek').length)).toBe(2);
});

test('a spelling the tree has never seen can be typed in', async ({ page }) => {
    await openApp(page);
    await twoSpellings(page);
    await page.evaluate(() => window.Strom.UI.showSurnamesDialog());

    // The register's spelling is exactly the one no dropdown can offer.
    await page.locator('.surname-chip', { hasText: 'Víšek' }).click();
    await page.locator('#surname-other').fill('Wischek');
    await page.locator('#surname-other-add').click();
    await expect(page.locator('.surname-chip', { hasText: 'Wischek' })).toHaveClass(/picked/);
    await page.getByRole('button', { name: 'Link them', exact: true }).click();

    expect(await page.evaluate(() => window.Strom.DataManager.searchPersons('Wischek').length)).toBe(1);
    await expect(page.locator('.surname-group-names')).toContainText('Wischek');
});

test('it holds for people added afterwards — the point of doing it once', async ({ page }) => {
    await openApp(page);
    await twoSpellings(page);
    await page.evaluate(() => window.Strom.DataManager.addSurnameGroup(['Víšek', 'Vyšek']));

    // Somebody entered later, under the old spelling, needs no annotation.
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        dm.createPerson({ firstName: 'Frantisek', lastName: 'Vyšek', gender: 'male' });
    });
    expect(await page.evaluate(() => window.Strom.DataManager.searchPersons('Víšek').length)).toBe(3);
});

test('linking is undoable, and unlinking puts it back', async ({ page }) => {
    await openApp(page);
    await twoSpellings(page);
    await page.evaluate(() => window.Strom.UI.showSurnamesDialog());
    await page.locator('.surname-chip', { hasText: 'Víšek' }).click();
    await page.locator('.surname-chip', { hasText: 'Vyšek' }).click();
    await page.getByRole('button', { name: 'Link them', exact: true }).click();
    await expect(page.locator('.surname-group')).toHaveCount(1);

    await page.getByRole('button', { name: 'Unlink' }).click();
    await expect(page.locator('.surname-group')).toHaveCount(0);
    expect(await page.evaluate(() => window.Strom.DataManager.searchPersons('Víšek').length)).toBe(1);
});

test('the spellings survive a reload — they belong to the tree', async ({ page }) => {
    await openApp(page);
    await twoSpellings(page);
    await page.evaluate(() => window.Strom.DataManager.addSurnameGroup(['Víšek', 'Vyšek']));

    await page.reload();
    await expect.poll(() => page.evaluate(() =>
        window.Strom.DataManager.getData().surnameVariants?.[0]?.length)).toBe(2);
    expect(await page.evaluate(() => window.Strom.DataManager.searchPersons('Vyšek').length)).toBe(2);
});
