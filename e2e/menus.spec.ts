import { test, expect } from '@playwright/test';
import { openApp, createFirstPerson } from './helpers.js';

/**
 * The three floating toolbar menus — the hamburger, the tree switcher and the
 * desktop ⋯ actions menu — are mutually exclusive. Opening any one closes the
 * others, so a user never sees two stacked (they once saw the hamburger and the
 * switcher dropdown open together on a phone).
 */
test.describe('menus are mutually exclusive', () => {
    test.describe('on a phone', () => {
        test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

        test('opening the tree switcher closes the hamburger, and vice versa', async ({ page }) => {
            await openApp(page);
            await createFirstPerson(page, 'Jan', 'Novak');

            const menu = page.locator('#mobile-menu');
            const switcher = page.locator('#tree-switcher-dropdown');

            // Hamburger open.
            await page.locator('.hamburger-btn').click();
            await expect(menu).toHaveClass(/active/);

            // Tap the tree combo → hamburger closes, only the dropdown shows.
            await page.locator('.tree-switcher-btn').click();
            await expect(switcher).toHaveClass(/active/);
            await expect(menu).not.toHaveClass(/active/);

            // And the reverse: opening the hamburger closes the switcher.
            await page.locator('.hamburger-btn').click();
            await expect(menu).toHaveClass(/active/);
            await expect(switcher).not.toHaveClass(/active/);
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
