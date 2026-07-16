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

test('cross-tree badge shows a shared person and the setting hides it', async ({ page }) => {
    await twoTreesSharingJan(page);
    // Badge appears on Jan (found in the other tree).
    await expect(page.locator('.cross-tree-badge').first()).toBeVisible();

    // Turn the setting off → badges disappear.
    await page.evaluate(() => window.Strom.UI.toggleCrossTreeBadges(false));
    await expect(page.locator('.cross-tree-badge')).toHaveCount(0);

    // Back on → they return.
    await page.evaluate(() => window.Strom.UI.toggleCrossTreeBadges(true));
    await expect(page.locator('.cross-tree-badge').first()).toBeVisible();
});

test('one match: clicking the badge switches directly (no chooser)', async ({ page }) => {
    await twoTreesSharingJan(page);
    await expect(page.locator('#current-tree-name')).toHaveText('Tree B');

    await page.locator('.cross-tree-badge').first().click();

    // No chooser for a single match; we land in the other tree.
    await expect(page.locator('.cross-tree-chooser')).toHaveCount(0);
    await expect(page.locator('#current-tree-name')).toHaveText('My Family Tree');
    await expect(card(page, 'Jan')).toBeVisible();
});

test('multiple matches: badge opens a chooser and a row switches the tree', async ({ page }) => {
    await threeTreesSharingJan(page);
    await expect(page.locator('#current-tree-name')).toHaveText('Tree C');

    await page.locator('.cross-tree-badge').first().click();

    const chooser = page.locator('.cross-tree-chooser');
    await expect(chooser).toBeVisible();
    // One row per other tree (My Family Tree + Tree B).
    await expect(chooser.locator('.cross-tree-chooser-item')).toHaveCount(2);
    await expect(chooser.locator('.cross-tree-chooser-tree', { hasText: 'Tree B' })).toBeVisible();

    // Choosing a row switches to that tree and closes the chooser.
    await chooser.locator('.cross-tree-chooser-item', { hasText: 'Tree B' }).click();
    await expect(page.locator('.cross-tree-chooser')).toHaveCount(0);
    await expect(page.locator('#current-tree-name')).toHaveText('Tree B');
});

test('chooser closes on Escape and on outside click', async ({ page }) => {
    await threeTreesSharingJan(page);
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
});
