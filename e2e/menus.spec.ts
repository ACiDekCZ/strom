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
 * active tree and opens a flyout carrying EVERY whole-tree action (all except
 * Delete, which stays in the tree manager). Hide belongs here too.
 */
test.describe('actions menu "Tree:" submenu', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('names the active tree and carries the whole-tree actions; Delete is absent', async ({ page }) => {
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

        // The whole-tree actions moved in: tree health, book and split are here…
        await expect(submenu.locator('.tree-switcher-action', { hasText: 'Tree health' })).toBeVisible();
        await expect(submenu.locator('.tree-switcher-action', { hasText: 'Family book' })).toBeVisible();
        await expect(submenu.locator('.tree-switcher-action', { hasText: 'Split into families' })).toBeVisible();
        // …Hide is now offered here too…
        await expect(submenu.locator('.tree-switcher-action', { hasText: 'Hide' })).toBeVisible();
        // …but Delete stays in the tree manager only.
        await expect(submenu).not.toContainText('Delete');
        // The standalone "Validate" row is gone — validation now lives behind
        // Tree health → Validation details (single entry point).
        await expect(submenu).not.toContainText('Validate');
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

    test('Escape closes the submenu first, then the whole actions menu', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');

        await page.locator('.actions-menu-btn').click();
        const dropdown = page.locator('#actions-menu-dropdown');
        const wrap = page.locator('#actions-tree-wrap');
        const row = page.locator('#actions-tree-row');
        await row.focus();
        await row.press('ArrowRight');
        await expect(wrap).toHaveClass(/submenu-open/);

        // First Escape closes only the submenu; the menu stays open.
        await page.keyboard.press('Escape');
        await expect(wrap).not.toHaveClass(/submenu-open/);
        await expect(dropdown).toHaveClass(/active/);

        // Second Escape closes the whole actions menu.
        await page.keyboard.press('Escape');
        await expect(dropdown).not.toHaveClass(/active/);
    });
});

/**
 * A tree-manager row ⋯ menu is a floating menu inside the modal: Escape must
 * close it first (leaving the manager open), and only a second Escape closes
 * the manager.
 */
test.describe('tree manager row menu: Escape', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('closes an open row menu first, then the manager', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');

        await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
        const manager = page.locator('#tree-manager-modal');
        await expect(manager).toHaveClass(/active/);

        const row = page.locator('.tree-manager-item').first();
        await row.locator('.tree-row-menu-btn').click();
        const menu = row.locator('.tree-row-menu');
        await expect(menu).toHaveClass(/open/);

        // First Escape closes only the row menu; the manager stays open.
        await page.keyboard.press('Escape');
        await expect(menu).not.toHaveClass(/open/);
        await expect(manager).toHaveClass(/active/);

        // Second Escape closes the manager.
        await page.keyboard.press('Escape');
        await expect(manager).not.toHaveClass(/active/);
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
