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

/**
 * The "Tree: {name}" submenu at the bottom of the ⋯ actions menu: it names the
 * active tree, opens a flyout with the tree-manager actions (never Delete/Hide),
 * acts on the active tree, and closes with the menu.
 */
test.describe('actions menu "Tree:" submenu', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('names the active tree and opens on hover; Delete/Hide are absent', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');

        await page.locator('.actions-menu-btn').click();
        await expect(page.locator('#actions-menu-dropdown')).toHaveClass(/active/);

        const row = page.locator('#actions-tree-row');
        await expect(row).toBeVisible();
        await expect(page.locator('#actions-tree-name')).not.toHaveText('');

        const submenu = page.locator('#actions-tree-submenu');
        await row.hover();
        await expect(submenu).toBeVisible();

        // The five manager actions are present; Delete/Hide are deliberately not.
        await expect(submenu.locator('.tree-switcher-action')).toHaveCount(5);
        await expect(submenu).not.toContainText('Delete');
        await expect(submenu).not.toContainText('Hide');
    });

    test('keyboard: → opens the submenu, ← closes it', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');

        await page.locator('.actions-menu-btn').click();
        const wrap = page.locator('#actions-tree-wrap');
        const row = page.locator('#actions-tree-row');
        await row.focus();

        await row.press('ArrowRight');
        await expect(wrap).toHaveClass(/submenu-open/);
        await expect(row).toHaveAttribute('aria-expanded', 'true');

        await row.press('ArrowLeft');
        await expect(wrap).not.toHaveClass(/submenu-open/);
        await expect(row).toHaveAttribute('aria-expanded', 'false');
    });

    test('Statistics acts on the active tree and closes the whole menu', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');

        await page.locator('.actions-menu-btn').click();
        await page.locator('#actions-tree-row').hover();
        await page.locator('#actions-tree-submenu .tree-switcher-action', { hasText: 'Statistics' }).click();

        // The tree statistics dialog opens; the actions menu is dismissed.
        await expect(page.locator('#tree-stats-modal')).toHaveClass(/active/);
        await expect(page.locator('#actions-menu-dropdown')).not.toHaveClass(/active/);
    });
});
