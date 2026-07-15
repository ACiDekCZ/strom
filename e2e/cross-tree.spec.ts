import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson, card } from './helpers.js';

// Two trees sharing the same person → a "+1" badge appears on the card; the
// setting turns it off.
async function twoTreesSharingJan(page: import('@playwright/test').Page) {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1900' });
    // Second tree with the same person.
    await page.evaluate(() => window.Strom.UI.showNewTreeDialog());
    const dialog = page.locator('#new-tree-modal');
    await dialog.locator('#new-tree-name').fill('Tree B');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await page.evaluate(() => window.Strom.UI.closeTreeManagerDialog?.());
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1900' });
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
