import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, addRelation, card } from './helpers.js';

/**
 * Splitting a tree into the families it holds (N3). Only families that nothing
 * connects are offered — splitting a connected tree would mean duplicating
 * whoever joins them.
 */
async function twoUnrelatedFamilies(page: import('@playwright/test').Page): Promise<void> {
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1900' });
    await addRelation(page, 'Jan', 'partner', 'Marie', 'Novakova', 'female');
    await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');
    // A second family with no link at all to the first.
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const josef = dm.createPerson({ firstName: 'Josef', lastName: 'Svoboda', gender: 'male' });
        const anna = dm.createPerson({ firstName: 'Anna', lastName: 'Svobodova', gender: 'female' });
        dm.createPartnership(josef.id, anna.id);
    });
}

test('a tree with two unrelated families can be split into two trees', async ({ page }) => {
    await openApp(page);
    await twoUnrelatedFamilies(page);

    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    await page.locator('.tree-row-menu-btn').first().click();
    await page.locator('.tree-row-menu-item', { hasText: 'Split by families' }).click();
    await expect(page.locator('#split-modal')).toBeVisible();

    // Both families are listed, biggest first, named after their surname.
    const rows = page.locator('.split-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Novak family');
    await expect(rows.first()).toContainText('3 people');
    await expect(rows.nth(1)).toContainText('Svoboda family');

    // Nothing selected yet: there is nothing to do.
    await expect(page.getByRole('button', { name: /Split off 0/ })).toBeDisabled();

    await rows.nth(1).locator('.split-check').check();
    await page.getByRole('button', { name: 'Split off 1' }).click();

    const trees = await page.evaluate(() => window.Strom.TreeManager.getTrees()
        .map((t: { name: string; personCount: number }) => [t.name, t.personCount]));
    // The new tree holds the Svobodas...
    expect(trees).toContainEqual(['Svoboda family', 2]);
    // ...and the original is untouched, both families still in it.
    expect(trees.find((t: [string, number]) => t[0] === 'My Family Tree')?.[1]).toBe(5);
});

test('a connected tree offers nothing to split', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1900' });
    await addRelation(page, 'Jan', 'partner', 'Marie', 'Novakova', 'female');
    await addRelation(page, 'Jan', 'child', 'Petr', 'Novak');

    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    await page.locator('.tree-row-menu-btn').first().click();
    await page.locator('.tree-row-menu-item', { hasText: 'Split by families' }).click();

    // One family: say so plainly rather than showing a pointless list.
    await expect(page.locator('#split-modal')).toContainText('one family here');
    await expect(page.locator('.split-row')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Split off/ })).toHaveCount(0);
});

test('the split leaves the original alone, so a wrong pick costs a delete', async ({ page }) => {
    await openApp(page);
    await twoUnrelatedFamilies(page);
    const before = await page.evaluate(() => window.Strom.DataManager.getAllPersons().length);

    await page.evaluate(() => window.Strom.UI.showSplitDialog());
    await page.locator('.split-check').first().check();
    await page.getByRole('button', { name: 'Split off 1' }).click();
    await expect(page.locator('#split-modal')).toHaveCount(0);

    // Still everyone: the split copies, it does not move.
    expect(await page.evaluate(() => window.Strom.DataManager.getAllPersons().length)).toBe(before);
    await expect(card(page, 'Jan')).toBeVisible();
});
