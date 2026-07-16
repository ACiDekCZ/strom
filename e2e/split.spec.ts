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

test('importing a file with several families offers to split it', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1900' });

    // A file holding two families that nothing connects — somebody's whole
    // account exported at once, which is how they usually arrive.
    const file = await page.evaluate(() => {
        const mk = (id: string, first: string, last: string) => ({
            id, firstName: first, lastName: last, gender: 'male',
            isPlaceholder: false, partnerships: [], parentIds: [], childIds: [],
        });
        return JSON.stringify({
            version: 5,
            persons: {
                a: { ...mk('a', 'Josef', 'Novak'), partnerships: ['u1'] },
                b: { ...mk('b', 'Marie', 'Novakova'), gender: 'female', partnerships: ['u1'] },
                x: { ...mk('x', 'Karel', 'Svoboda'), partnerships: ['u2'] },
                y: { ...mk('y', 'Anna', 'Svobodova'), gender: 'female', partnerships: ['u2'] },
            },
            partnerships: {
                u1: { id: 'u1', person1Id: 'a', person2Id: 'b', childIds: [], status: 'married' },
                u2: { id: 'u2', person1Id: 'x', person2Id: 'y', childIds: [], status: 'married' },
            },
        });
    });

    await page.evaluate((json) => {
        const ui = window.Strom.UI as unknown as { importTreeData: unknown };
        ui.importTreeData = JSON.parse(json);
        window.Strom.UI.showImportTreeDialog(JSON.parse(json), 'Imported');
    }, file);
    await page.getByRole('button', { name: /Import|Create/ }).first().click();

    // The split has been in the tree manager all along; nobody goes looking for
    // a thing they do not know they need. This is the moment they think about it.
    await expect(page.getByText(/families that nothing connects/i)).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Split by families' }).click();
    await expect(page.locator('#split-modal')).toBeVisible();
    await expect(page.locator('.split-row')).toHaveCount(2);
});

test('a tree with one family and a few strays is not offered a split', async ({ page }) => {
    // 222 people plus four unconnected strays is not "five families" — nobody
    // wants a tree holding one person, they want to link them.
    await openApp(page);
    const file = await page.evaluate(() => JSON.stringify({
        version: 5,
        persons: {
            a: { id: 'a', firstName: 'Josef', lastName: 'Novak', gender: 'male', isPlaceholder: false, partnerships: ['u1'], parentIds: [], childIds: [] },
            b: { id: 'b', firstName: 'Marie', lastName: 'Novakova', gender: 'female', isPlaceholder: false, partnerships: ['u1'], parentIds: [], childIds: [] },
            lost: { id: 'lost', firstName: 'Kdo', lastName: 'Vi', gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [] },
        },
        partnerships: { u1: { id: 'u1', person1Id: 'a', person2Id: 'b', childIds: [], status: 'married' } },
    }));
    await page.evaluate((json) => {
        window.Strom.UI.showImportTreeDialog(JSON.parse(json), 'Imported');
    }, file);
    await page.getByRole('button', { name: /Import|Create/ }).first().click();
    await page.waitForTimeout(1000);
    await expect(page.getByText(/families that nothing connects/i)).toHaveCount(0);
});
