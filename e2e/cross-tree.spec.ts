import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, card } from './helpers.js';

// Create a new tree (named `treeName`) holding the same Jan Novak *1900, then
// leave it active. The first (default) tree is "My Family Tree".
async function addTreeWithJan(page: import('@playwright/test').Page, treeName: string) {
    await page.evaluate(() => window.Strom.UI.showNewTreeDialog());
    const dialog = page.locator('#new-tree-modal');
    await dialog.locator('#new-tree-name').fill(treeName);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await page.evaluate(() => window.Strom.UI.closeTreeManagerDialog?.());
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1900' });
}

// Two trees sharing the same person → a "+1" badge appears on the card; the
// setting turns it off.
async function twoTreesSharingJan(page: import('@playwright/test').Page) {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1900' });
    await addTreeWithJan(page, 'Tree B');
}

// Three trees sharing Jan → from the active tree he matches in two others,
// which is what triggers the chooser.
async function threeTreesSharingJan(page: import('@playwright/test').Page) {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1900' });
    await addTreeWithJan(page, 'Tree B');
    await addTreeWithJan(page, 'Tree C');
}

test('one match: the badge shows, the setting hides it, a click switches directly (no chooser)', async ({ page }) => {
    await twoTreesSharingJan(page);
    await expect(page.locator('#current-tree-name')).toHaveText('Tree B');
    // Badge appears on Jan (found in the other tree).
    await expect(page.locator('.cross-tree-badge').first()).toBeVisible();

    // Turn the setting off → badges disappear; back on → they return.
    await page.evaluate(() => window.Strom.UI.toggleCrossTreeBadges(false));
    await expect(page.locator('.cross-tree-badge')).toHaveCount(0);
    await page.evaluate(() => window.Strom.UI.toggleCrossTreeBadges(true));
    await expect(page.locator('.cross-tree-badge').first()).toBeVisible();
    // The bubble says what the match was found by.
    await expect(page.locator('.cross-tree-tooltip-reason').first()).toHaveText('Matched by: name, birth');

    await page.locator('.cross-tree-badge').first().click();

    // No chooser for a single match; we land in the other tree.
    await expect(page.locator('.cross-tree-chooser')).toHaveCount(0);
    await expect(page.locator('#current-tree-name')).toHaveText('My Family Tree');
    await expect(card(page, 'Jan')).toBeVisible();
});

test('multiple matches: badge opens a chooser that Escape and an outside click close; a row switches the tree', async ({ page }) => {
    await threeTreesSharingJan(page);
    await expect(page.locator('#current-tree-name')).toHaveText('Tree C');
    const badge = page.locator('.cross-tree-badge').first();
    const chooser = page.locator('.cross-tree-chooser');

    // Escape closes it (and only it — the tree does not change).
    await badge.click();
    await expect(chooser).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(chooser).toHaveCount(0);
    await expect(page.locator('#current-tree-name')).toHaveText('Tree C');

    // Outside click (on the toolbar) closes it too.
    await badge.click();
    await expect(chooser).toBeVisible();
    await page.locator('.toolbar').click({ position: { x: 5, y: 5 } });
    await expect(chooser).toHaveCount(0);
    await expect(page.locator('#current-tree-name')).toHaveText('Tree C');

    await badge.click();
    await expect(chooser).toBeVisible();
    // One row per other tree (My Family Tree + Tree B).
    await expect(chooser.locator('.cross-tree-chooser-item')).toHaveCount(2);
    await expect(chooser.locator('.cross-tree-chooser-tree', { hasText: 'Tree B' })).toBeVisible();
    await expect(chooser.locator('.cross-tree-chooser-reason').first()).toHaveText('Matched by: name, birth');

    // Choosing a row switches to that tree and closes the chooser.
    await chooser.locator('.cross-tree-chooser-item', { hasText: 'Tree B' }).click();
    await expect(page.locator('.cross-tree-chooser')).toHaveCount(0);
    await expect(page.locator('#current-tree-name')).toHaveText('Tree B');
});

test('T22: a namesake sister born a year later, of the same parents, in another tree is not offered as the same person', async ({ page }) => {
    await openApp(page);
    await page.evaluate(async () => {
        const base = { isPlaceholder: false, partnerships: [], parentIds: [], childIds: [] };
        // Both Anežkas are daughters of Josef Lipa and Kateřina Horká;
        // Jan is Anežka's son, so all cards stand in one view.
        const tree = (anezkaBirth: string) => ({
            persons: {
                f: { ...base, id: 'f', firstName: 'Josef', lastName: 'Lipa', gender: 'male', birthDate: '1855', partnerships: ['u'], childIds: ['b'] },
                m: { ...base, id: 'm', firstName: 'Kateřina', lastName: 'Horká', gender: 'female', birthDate: '1858', partnerships: ['u'], childIds: ['b'] },
                b: { ...base, id: 'b', firstName: 'Anežka', lastName: 'Lipová', gender: 'female', birthDate: anezkaBirth, parentIds: ['f', 'm'], childIds: ['j'] },
                j: { ...base, id: 'j', firstName: 'Jan', lastName: 'Novak', gender: 'male', birthDate: '1910', parentIds: ['b'] },
            },
            partnerships: { u: { id: 'u', person1Id: 'f', person2Id: 'm', childIds: ['b'], status: 'married' } },
        });
        await window.Strom.DataManager.importAsNewTree(tree('1885') as never, 'Tree A');
        await window.Strom.DataManager.importAsNewTree(tree('1884') as never, 'Tree B');
        window.Strom.TreeRenderer.render();
    });
    // Jan and Anežka's parents are the same people in both trees: their pills show
    // (and prove the badges rendered).
    await expect(card(page, 'Jan').locator('.cross-tree-badge')).toBeVisible();
    await expect(card(page, 'Josef').locator('.cross-tree-badge')).toBeVisible();
    await expect(card(page, 'Anežka')).toBeVisible();
    await expect(card(page, 'Anežka').locator('.cross-tree-badge')).toHaveCount(0);
});
