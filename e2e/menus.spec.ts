import { test, expect, Page } from '@playwright/test';
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
 * The ⋯ actions menu, ordered by what the user wants to do: the tree's content
 * (book, sources, anniversaries), the outputs (one Export…, poster, the
 * fly-through), the research and "Tree: {name}" — about the tree and its
 * management (all except Delete, which stays in the tree manager).
 */
test.describe('actions menu "Tree:" submenu', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('the first level by intent: no Undo / Redo, one Export…, the anniversaries count on its row', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));

        await page.locator('.actions-menu-btn').click();
        const dropdown = page.locator('#actions-menu-dropdown');
        await expect(dropdown).toHaveClass(/active/);
        const rows = await dropdown.locator(':scope > .tree-switcher-action:visible, :scope > .actions-tree-wrap:visible > .actions-tree-row')
            .evaluateAll(els => els.map(el => (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));
        expect(rows[0]).toBe('Family book');
        expect(rows[1]).toBe('Sources');
        expect(rows[2]).toMatch(/^Anniversaries/);
        expect(rows[3]).toBe('Export… whole tree or current view');
        expect(rows.slice(4, 6)).toEqual(['Poster…', 'Slideshow (TV mode)']);
        expect(rows[6]).toMatch(/^(Research|Ancestor research)/);
        expect(rows[7]).toMatch(/^Tree:/);
        expect(rows[8]).toBe('Settings');
        expect(rows).toHaveLength(9);
        // Undo / Redo are in the toolbar, not here.
        await expect(dropdown.locator('#actions-undo-row, #actions-redo-row')).toHaveCount(0);
        // Exactly one "Export", and no two "Merge into…" with the same text.
        const all = await dropdown.locator('.tree-switcher-action').evaluateAll(els => els.map(el => (el as HTMLElement).textContent!.replace(/\s+/g, ' ').trim()));
        expect(all.filter(t => t.includes('Export'))).toHaveLength(1);
        const merges = all.filter(t => t.startsWith('Merge'));
        expect(new Set(merges).size).toBe(merges.length);
    });

    test('names the active tree and carries the tree\'s actions in order; Delete is absent', async ({ page }) => {
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

        const items = (await submenu.locator('.tree-switcher-action:visible, .menu-section-header:visible').allInnerTexts()).map(t => t.trim());
        expect(items.filter(t => t !== 'Save to file…')).toEqual([
            'Statistics', 'Tree health',
            'Rename', 'Duplicate', 'Hide',
            'FROM THE CURRENT VIEW', 'Make a new tree', 'Merge view into…',
            'Merge into another tree…', 'Split into families…',
            'Manage trees',
        ]);
        // Delete stays in the tree manager only; no standalone "Validate".
        await expect(submenu).not.toContainText('Delete');
        await expect(submenu).not.toContainText('Validate');
        // Book, sources, anniversaries and export moved up to the first level.
        await expect(submenu).not.toContainText('Family book');
        await expect(submenu).not.toContainText('Export');
    });

    test('the mouse crosses from the row to the flyout without losing it', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await page.locator('.actions-menu-btn').click();
        const row = page.locator('#actions-tree-row');
        const submenu = page.locator('#actions-tree-submenu');
        await row.hover();
        await expect(submenu).toBeVisible();
        const r = (await row.boundingBox())!;
        const sub = (await submenu.boundingBox())!;
        const y = r.y + r.height / 2;
        // Along the row, through the gap between the menu and the flyout…
        await page.mouse.move(r.x + 4, y);
        await page.mouse.move((r.x + sub.x + sub.width) / 2, y);
        await expect(submenu).toBeVisible();
        // …a corner off the row (a diagonal path) is forgiven a moment…
        await page.mouse.move(sub.x + sub.width + 6, r.y + r.height + 6);
        await page.mouse.move(sub.x + sub.width - 20, r.y + r.height + 10);
        await expect(submenu).toBeVisible();
        // …and it stays while in the flyout.
        await page.waitForTimeout(400);
        await expect(submenu).toBeVisible();
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

    test('a submenu opened by a click: one Escape closes the whole menu, the pointer still on the row (J6); open again, hover shows it', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');

        await page.locator('.actions-menu-btn').click();
        const row = page.locator('#actions-tree-row');
        const submenu = page.locator('#actions-tree-wrap > .actions-tree-submenu');
        await row.click();
        await expect(page.locator('#actions-tree-wrap')).toHaveClass(/submenu-open/);
        await expect(submenu).toBeVisible();
        // The pointer stays on the row: Escape closes the submenu and the menu.
        await page.keyboard.press('Escape');
        await expect(submenu).toBeHidden();
        await expect(page.locator('#actions-menu-dropdown')).not.toHaveClass(/active/);
        // The menu again, away and back: hover opens the submenu.
        await page.mouse.move(5, 450);
        await page.locator('.actions-menu-btn').click();
        await row.hover();
        await expect(submenu).toBeVisible();
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

    test('Sources: hidden in the plain mode, offered with research fields, opens the catalog', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');

        const sourcesRow = page.locator('#actions-sources-row');
        await page.locator('.actions-menu-btn').click();
        await expect(sourcesRow).toBeHidden();
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');

        await page.evaluate(() => window.Strom.UI.toggleAdvancedFields(true));
        await page.locator('.actions-menu-btn').click();
        await expect(sourcesRow).toBeVisible();
        await sourcesRow.click();
        await expect(page.locator('#sources-modal')).toHaveClass(/active/);
        await expect(page.locator('#actions-menu-dropdown')).not.toHaveClass(/active/);
    });

    test('Sources: offered without research fields once the tree has a source', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await page.evaluate(() => window.Strom.DataManager.addSource({ title: 'Matrika N 1861' }));

        await page.locator('.actions-menu-btn').click();
        await expect(page.locator('#actions-sources-row')).toBeVisible();
    });

    test('the actions menu stays inside the window at every desktop width', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        for (const width of [1025, 1100, 1280, 1440, 1920]) {
            await page.setViewportSize({ width, height: 800 });
            await page.locator('.actions-menu-btn').click();
            const box = (await page.locator('#actions-menu-dropdown').boundingBox())!;
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(width);
            await page.keyboard.press('Escape');
        }
    });

    test('on a short window the flyout stays inside it; every item is reachable', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 560 });
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');

        await page.locator('.actions-menu-btn').click();
        const submenu = page.locator('#actions-tree-submenu');
        for (const open of ['hover', 'keyboard'] as const) {
            if (open === 'hover') {
                await page.locator('#actions-tree-row').hover();
            } else {
                await page.mouse.move(5, 300);
                await page.locator('#actions-tree-row').focus();
                await page.locator('#actions-tree-row').press('ArrowRight');
            }
            await expect(submenu).toBeVisible();
            const box = (await submenu.boundingBox())!;
            expect(box.y).toBeGreaterThanOrEqual(0);
            expect(box.y + box.height).toBeLessThanOrEqual(560);
            const last = submenu.locator('.tree-switcher-action').last();
            await last.scrollIntoViewIfNeeded();
            const lastBox = (await last.boundingBox())!;
            expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(560);
        }
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

test.describe('many trees in a short window (J5 of the language round)', () => {
    const manyTrees = async (page: Page) => {
        await page.setViewportSize({ width: 1440, height: 779 });
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await page.evaluate(async () => {
            for (let i = 1; i <= 18; i++) {
                await window.Strom.DataManager.importAsNewTree({ persons: {}, partnerships: {} } as never, `Strom ${i}`);
            }
            window.Strom.UI.updateTreeSwitcher();
        });
    };

    test('the tree switcher scrolls: "Manage trees…" at its end is reachable', async ({ page }) => {
        await manyTrees(page);
        await page.locator('.tree-switcher-btn').click();
        const dropdown = page.locator('#tree-switcher-dropdown');
        await expect(dropdown).toHaveClass(/active/);
        const box = await dropdown.boundingBox();
        expect(box!.y + box!.height).toBeLessThanOrEqual(779);
        await dropdown.getByText('Manage trees').click();
        await expect(page.locator('#tree-manager-modal')).toHaveClass(/active/);
    });

    test('the first tree\'s ⋯ menu in the manager: every item below the header and inside the window', async ({ page }) => {
        await manyTrees(page);
        await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
        const modal = page.locator('#tree-manager-modal');
        await modal.locator('.tree-row-menu-btn').first().click();
        const menu = modal.locator('.tree-row-menu.open');
        await expect(menu).toBeVisible();
        const header = await modal.locator('.modal-header').boundingBox();
        const m = await menu.boundingBox();
        expect(m!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
        expect(m!.y + m!.height).toBeLessThanOrEqual(779);
        // The last item is reachable (scrolled to inside the menu when needed).
        await menu.locator('.tree-row-menu-item').last().scrollIntoViewIfNeeded();
        await expect(menu.locator('.tree-row-menu-item').last()).toBeInViewport();
    });
});

test.describe('tree manager ⋯ menu on desktop: the tree-action groups', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('the open tree: the groups in order, rows not bordered buttons, under ⋯ and never over the name', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());

        const row = page.locator('.tree-manager-item.active');
        const btn = row.locator('.tree-row-menu-btn');
        await btn.click();
        const menu = row.locator('.tree-row-menu.open');
        await expect(menu).toBeVisible();

        // The sheet's groups in its order; Research only with a research action
        // to offer (none for a one-person tree without a link), never empty.
        await expect(menu.locator('.tree-row-menu-group:visible')).toHaveText(
            ['Overview', 'Outputs', 'Tree settings', 'Structure', 'Manage']);
        const keys = await menu.locator('.tree-row-menu-item:visible').evaluateAll(els => els.map(el => (el as HTMLElement).dataset.action));
        expect(keys.slice(0, 2)).toEqual(['stats', 'health']);
        expect(keys).toContain('places');
        expect(keys).toContain('surnames');
        expect(keys).toContain('split');
        expect(keys[keys.length - 1]).toBe('delete');

        // Rows, not bordered centered buttons (the row buttons' style leaked in).
        const item = menu.locator('.tree-row-menu-item[data-action="stats"]');
        const style = await item.evaluate(el => {
            const cs = getComputedStyle(el);
            return { border: cs.borderTopWidth, align: cs.textAlign, justify: cs.justifyContent, font: cs.fontSize, h: el.getBoundingClientRect().height };
        });
        expect(style.border).toBe('0px');
        expect(style.align).toBe('left');
        expect(style.justify).not.toBe('center');
        expect(style.font).toBe('14px');
        expect(style.h).toBeGreaterThanOrEqual(32);

        // Under ⋯, right edges aligned, the tree's name stays visible.
        const b = (await btn.boundingBox())!;
        const m = (await menu.boundingBox())!;
        const name = (await row.locator('.tree-manager-item-header').boundingBox())!;
        expect(m.y).toBeGreaterThanOrEqual(b.y + b.height);
        expect(Math.abs((m.x + m.width) - (b.x + b.width))).toBeLessThanOrEqual(1);
        expect(m.y).toBeGreaterThanOrEqual(name.y + name.height);

        // The default person shows its value; the startup row is a checkbox.
        await expect(menu.locator('[data-action="startup"]')).toHaveAttribute('role', 'menuitemcheckbox');
        await expect(menu.locator('[data-action="defaultPerson"]')).toBeVisible();
    });

    test('a tree that is not open: no open-tree rows, a note says where they are', async ({ page }) => {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await page.evaluate(() => window.Strom.DataManager.importAsNewTree({ persons: {}, partnerships: {} } as never, 'Jiný strom'));
        await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());

        const row = page.locator('.tree-manager-item:not(.active)').first();
        await row.locator('.tree-row-menu-btn').click();
        const menu = row.locator('.tree-row-menu.open');
        await expect(menu).toBeVisible();
        for (const key of ['audit', 'places', 'surnames', 'makeTree', 'splitFamilies', 'split', 'saveToFile']) {
            await expect(menu.locator(`[data-action="${key}"]`)).toHaveCount(0);
        }
        for (const key of ['stats', 'export', 'rename', 'mergeInto', 'duplicate', 'delete']) {
            await expect(menu.locator(`[data-action="${key}"]`)).toHaveCount(1);
        }
        await expect(menu.locator('.tree-row-menu-note')).toHaveText(
            'Places, surnames, change log and splitting are available once the tree is open.');
    });

    test('a menu taller than its room: a fade and chevron at the bottom, gone at the end', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 560 });
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());

        const row = page.locator('.tree-manager-item.active');
        await row.locator('.tree-row-menu-btn').click();
        const menu = row.locator('.tree-row-menu.open');
        await expect(menu).toHaveClass(/can-scroll/);
        await expect(menu.locator('.tree-row-menu-more')).toBeVisible();
        // The menu stays inside the window.
        const m = (await menu.boundingBox())!;
        expect(m.y + m.height).toBeLessThanOrEqual(560);

        await menu.evaluate(el => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); });
        await expect(menu).not.toHaveClass(/can-scroll/);
        await expect(menu.locator('.tree-row-menu-more')).toBeHidden();
    });
});
