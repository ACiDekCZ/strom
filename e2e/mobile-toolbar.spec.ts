import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson } from './helpers.js';

/**
 * The phone top bar (≤640px, ZADANI_DEV_mobil_ovladani 1.1–1.5): the tree
 * icon, the tree's name with all the room, the magnifier; the search folds
 * to the magnifier at rest, opens over the whole bar with Cancel, and stays
 * as a field while a query or a filter holds.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const input = (page: Page) => page.locator('#toolbar-search-picker .person-picker-input');

async function twoPeople(page: Page): Promise<void> {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novák');
    await page.evaluate(() => {
        window.Strom.DataManager.createPerson({ firstName: 'Marie', lastName: 'Dvořáková', gender: 'female' });
        window.Strom.UI.refreshSearch();
    });
}

test('at rest: the tree icon, the name with all the room, the magnifier — 52px high, no ⋯, no wordmark', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novák');
    for (const width of [320, 390, 430]) {
        await page.setViewportSize({ width, height: 800 });
        const bar = (await page.locator('.toolbar').boundingBox())!;
        expect(Math.round(bar.height), `${width}px bar`).toBe(52);
        const icon = (await page.locator('.toolbar-tree-icon').boundingBox())!;
        const lupa = (await page.locator('#search-open-btn').boundingBox())!;
        for (const box of [icon, lupa]) {
            expect(Math.round(box.width)).toBeGreaterThanOrEqual(44);
            expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
        }
        await expect(page.locator('.app-logo')).toBeHidden();
        await expect(page.locator('.mobile-more-btn')).toBeHidden();
        await expect(page.locator('.toolbar .search-container')).toBeHidden();
        // The name's button fills what is left between the icon and the magnifier.
        const name = (await page.locator('.tree-switcher-btn').boundingBox())!;
        expect(name.x + name.width).toBeLessThanOrEqual(lupa.x + 1);
        expect(name.width, `${width}px name room`).toBeGreaterThan(width - 44 - 44 - 20);
    }
    // A long name is cut at its end with "…".
    await page.evaluate(() => window.Strom.TreeManager.renameTree(window.Strom.TreeManager.getActiveTreeId()!, 'Beispiel: Familie Berg aus Minneapolis und Oslo'));
    await page.evaluate(() => window.Strom.UI.updateTreeSwitcher());
    const cut = await page.locator('.tree-switcher-btn .tree-name').evaluate(el => ({
        clipped: el.scrollWidth > el.clientWidth, ellipsis: getComputedStyle(el).textOverflow,
    }));
    expect(cut).toEqual({ clipped: true, ellipsis: 'ellipsis' });
    // The tree icon opens About, as the wordmark did.
    await page.locator('.toolbar-tree-icon').tap();
    await expect(page.locator('#about-modal')).toHaveClass(/active/);
});

test('one dot before the name: only in the browser, or offline (More says it)', async ({ page, context }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novák');
    const dot = page.locator('.toolbar-state-dot');
    await page.evaluate(() => document.body.classList.remove('storage-unsaved'));
    await expect(dot).toBeHidden();
    await context.setOffline(true);
    await expect(dot).toBeVisible();
    await page.locator('#bb-view-more').tap();
    await expect(page.locator('.bottom-sheet-menu .bottom-sheet-note')).toHaveText('Offline');
    await context.setOffline(false);
    await expect(dot).toBeHidden();
});

test('search: the magnifier opens the field over the bar; a query stays with the keyboard closed (count, ×); × leaves the filters', async ({ page }) => {
    await twoPeople(page);
    await page.locator('#search-open-btn').tap();
    await expect(input(page)).toBeFocused();
    await expect(page.locator('#search-cancel-btn')).toBeVisible();
    await expect(page.locator('.tree-switcher')).toBeHidden();
    await expect(page.locator('.toolbar-tree-icon')).toBeHidden();
    // 16px: iOS zooms into anything smaller.
    expect(await input(page).evaluate(el => getComputedStyle(el).fontSize)).toBe('16px');

    await input(page).fill('Nov');
    await input(page).blur();
    // Active: the field stays, its count and ×; no Cancel.
    await expect(page.locator('body')).toHaveClass(/search-active/);
    await expect(page.locator('body')).not.toHaveClass(/search-open/);
    await expect(page.locator('#search-query-count')).toHaveText('1 person');
    await expect(page.locator('#search-clear-btn')).toBeVisible();
    await expect(page.locator('#search-cancel-btn')).toBeHidden();
    await expect(page.locator('#search-open-btn')).toBeHidden();

    // × clears the text; no filter, no focus: back to the magnifier.
    await page.locator('#search-clear-btn').tap();
    await expect(input(page)).toHaveValue('');
    await expect(page.locator('#search-open-btn')).toBeVisible();
    await expect(page.locator('.tree-switcher')).toBeVisible();
});

test('search: a filter keeps the field (the funnel counts it); Cancel drops the query and the filters', async ({ page }) => {
    await twoPeople(page);
    await page.locator('#search-open-btn').tap();
    await page.locator('#search-filter-toggle').tap();
    const sheet = page.locator('#search-filters');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('.search-filters-title')).toHaveText('Filter');
    // One field per row, 44px, 16px, inside the sheet.
    const last = sheet.locator('#filter-lastname');
    expect(await sheet.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    const field = (await last.boundingBox())!;
    expect(field.x + field.width).toBeLessThanOrEqual(390 - 15);
    expect(Math.round((await last.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
    expect(await last.evaluate(el => getComputedStyle(el).fontSize)).toBe('16px');
    await last.fill('Dvoř');
    const show = page.locator('#search-filters-show');
    await expect(show).toHaveText('Show 1 person');
    await expect(show).toBeEnabled();
    await last.fill('Nobody');
    await expect(show).toHaveText('No matches');
    await expect(show).toBeDisabled();
    await last.fill('Dvoř');
    await expect(show).toHaveText('Show 1 person');
    await show.tap();
    await expect(sheet).toBeHidden();

    // The field stays with the funnel's badge: a folded field never hides a filter.
    await expect(page.locator('body')).toHaveClass(/search-active/);
    await expect(page.locator('#search-filter-badge')).toHaveText('1');
    await expect(page.locator('#search-open-btn')).toBeHidden();
    // "Show n" closes the keyboard too: the active field, no Cancel.
    await expect(page.locator('#search-cancel-btn')).toBeHidden();

    // Cancel (the field focused again): query and filters go, the bar rests.
    await input(page).tap();
    await input(page).fill('Mar');
    await page.locator('#search-cancel-btn').tap();
    await expect(input(page)).toHaveValue('');
    await expect(page.locator('#filter-lastname')).toHaveValue('');
    await expect(page.locator('#search-filter-badge')).toBeHidden();
    await expect(page.locator('#search-open-btn')).toBeVisible();
    await expect(page.locator('body')).not.toHaveClass(/search-(open|active)/);
});

test('search: Escape in the open field is Cancel', async ({ page }) => {
    await twoPeople(page);
    await page.locator('#search-open-btn').tap();
    await input(page).fill('Nov');
    await page.keyboard.press('Escape');
    await expect(input(page)).toHaveValue('');
    await expect(page.locator('#search-open-btn')).toBeVisible();
});

test('the tree name opens the tree list as a sheet: the trees, the open one marked, Manage trees › last', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novák');
    await page.evaluate(() => window.Strom.DataManager.importAsNewTree({ persons: {}, partnerships: {} } as never, 'Jiný strom'));
    await page.evaluate(() => window.Strom.UI.updateTreeSwitcher());
    const before = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId());

    await page.locator('.tree-switcher-btn').tap();
    const sheet = page.locator('.bottom-sheet-menu');
    await expect(sheet).toBeVisible();
    await expect(page.locator('#tree-switcher-dropdown')).not.toHaveClass(/active/);
    const rows = sheet.locator('.bottom-sheet-item');
    await expect(rows.last()).toContainText('Manage trees');
    await expect(sheet.locator('.bottom-sheet-item.active')).toHaveCount(1);
    for (const h of await rows.evaluateAll(els => els.map(el => el.getBoundingClientRect().height))) {
        expect(Math.round(h)).toBeGreaterThanOrEqual(48);
    }
    await sheet.locator('.bottom-sheet-item:not(.active)', { hasText: /Jiný strom|My Family Tree/ }).first().tap();
    await expect.poll(() => page.evaluate(() => window.Strom.TreeManager.getActiveTreeId())).not.toBe(before);
});
