import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson } from './helpers.js';

/**
 * The three toolbar overlays — the mobile "More" bottom sheet, the tree switcher
 * and the desktop ⋯ actions menu — are mutually exclusive. Opening any one
 * closes the others, so a user never sees two stacked (they once saw the old
 * hamburger and the switcher dropdown open together on a phone).
 */
test.describe('menus are mutually exclusive', () => {
    test.describe('on a phone', () => {
        test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

        test('opening the tree switcher closes the More sheet, and vice versa', async ({ page }) => {
            await openApp(page);
            await createFirstPerson(page, 'Jan', 'Novak');

            const sheet = page.locator('.bottom-sheet-menu');
            const switcher = page.locator('#tree-switcher-dropdown');

            // Switcher open, then open the More sheet from the bottom bar →
            // the switcher closes, only the sheet shows.
            await page.locator('.tree-switcher-btn').click();
            await expect(switcher).toHaveClass(/active/);
            await page.locator('#bb-view-more').click();
            await expect(sheet).toBeVisible();
            await expect(switcher).not.toHaveClass(/active/);

            // And the reverse: opening the switcher dismisses the sheet (the
            // sheet is a full-screen overlay, so the switcher is reopened via
            // its toggle rather than a tap through the backdrop).
            await page.evaluate(() => window.Strom.UI.toggleTreeSwitcher());
            await expect(switcher).toHaveClass(/active/);
            await expect(sheet).toHaveCount(0);
        });
    });

    test.describe('on desktop', () => {
        test.use({ viewport: { width: 1280, height: 800 } });

        test('opening the ⋯ actions menu closes the tree switcher', async ({ page }) => {
            await openApp(page);
            await createFirstPerson(page, 'Jan', 'Novak');

            const switcher = page.locator('#tree-switcher-dropdown');
            const actions = page.locator('#actions-menu-dropdown');

            await page.locator('.tree-switcher-btn').click();
            await expect(switcher).toHaveClass(/active/);

            await page.locator('.actions-menu-btn').click();
            await expect(actions).toHaveClass(/active/);
            await expect(switcher).not.toHaveClass(/active/);
        });
    });
});
