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

/** The sample tree: a focus person with ancestors and descendants. */
async function sample(page: Page): Promise<void> {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(page.locator('#focus-controls')).toBeVisible();
}

test('the person panel: one 48px row under the bar (name · ↑n · ↓n, no ×), the tree drawn below it', async ({ page }) => {
    await sample(page);
    const panel = (await page.locator('#focus-controls').boundingBox())!;
    const bar = (await page.locator('.toolbar').boundingBox())!;
    const tree = (await page.locator('#tree-container').boundingBox())!;
    expect(Math.round(panel.height)).toBe(48);
    expect(panel.x).toBe(0);
    expect(Math.round(panel.width)).toBe(390);
    expect(Math.round(panel.y)).toBe(Math.round(bar.y + bar.height));
    expect(Math.round(tree.y)).toBe(Math.round(panel.y + panel.height));
    await expect(page.locator('.focus-controls .focus-clear')).toBeHidden();
    await expect(page.locator('.focus-controls .focus-depth')).toBeHidden();
    const up = page.locator('.focus-chip[data-for="focus-depth-up"]');
    await expect(up.locator('.focus-chip-value')).toHaveText(await page.locator('#focus-depth-up').inputValue());
    for (const chip of await page.locator('#focus-controls .focus-chip').all()) {
        const b = (await chip.boundingBox())!;
        expect(Math.round(b.width)).toBeGreaterThanOrEqual(44);
        expect(Math.round(b.height)).toBeGreaterThanOrEqual(44);
    }
});

test('a chip unfolds the steppers as a second row and the tree moves down; the chip, the stepper and a tap into the tree work', async ({ page }) => {
    await sample(page);
    const treeTop = async () => Math.round((await page.locator('#tree-container').boundingBox())!.y);
    const before = await treeTop();
    const down = page.locator('.focus-chip[data-for="focus-depth-down"]');
    await down.tap();
    await expect(down).toHaveAttribute('aria-expanded', 'true');
    const steppers = page.locator('.focus-controls .focus-depth');
    await expect(steppers).toBeVisible();
    expect(Math.round((await steppers.boundingBox())!.height)).toBe(52);
    await expect.poll(treeTop).toBe(before + 52);
    // Nothing in the row overflows the phone.
    expect(await steppers.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);

    // − on ↓ lowers the depth; the chip follows.
    const value = Number(await page.locator('#focus-depth-down').inputValue());
    await steppers.locator('.depth-stepper').nth(1).locator('[data-step="-1"]').tap();
    await expect(down.locator('.focus-chip-value')).toHaveText(String(value - 1));

    // The chip again folds it; a tap into the tree too.
    await down.tap();
    await expect(steppers).toBeHidden();
    await expect.poll(treeTop).toBe(before);
    await down.tap();
    await expect(steppers).toBeVisible();
    await page.locator('#tree-container').dispatchEvent('pointerdown');
    await expect(steppers).toBeHidden();
    await expect(down).toHaveAttribute('aria-expanded', 'false');
});

test('the name in the panel opens the person\'s sheet', async ({ page }) => {
    await sample(page);
    await page.locator('#focus-name').tap();
    await expect(page.locator('.bottom-sheet-person')).toBeVisible();
});

test('touch zooms with two fingers: only ⛶ Fit, a 44px circle 12px above the bar and from the edge', async ({ page }) => {
    await sample(page);
    const buttons = page.locator('.zoom-controls button:visible');
    await expect(buttons).toHaveCount(1);
    await expect(buttons).toHaveAttribute('title', 'Fit to screen');
    const fit = (await buttons.boundingBox())!;
    const bar = (await page.locator('#bottom-bar').boundingBox())!;
    expect(Math.round(fit.width)).toBe(44);
    expect(Math.round(fit.height)).toBe(44);
    expect(Math.round(bar.y - (fit.y + fit.height))).toBe(12);
    expect(Math.round(390 - (fit.x + fit.width))).toBe(12);
});

test('the bottom bar is 56px with the FAB inside it; German labels fit one line at 320px', async ({ page }) => {
    await sample(page);
    const bar = (await page.locator('#bottom-bar').boundingBox())!;
    expect(Math.round(bar.height)).toBe(56);
    const fab = (await page.locator('#bottom-bar-fab').boundingBox())!;
    expect(Math.round(fab.width)).toBe(48);
    expect(fab.y).toBeGreaterThanOrEqual(bar.y);
    expect(fab.y + fab.height).toBeLessThanOrEqual(bar.y + bar.height);

    await page.evaluate(() => window.Strom.UI.setLanguage('de'));
    await page.setViewportSize({ width: 320, height: 700 });
    await expect(page.locator('#bb-view-descendants .bottom-bar-label')).toHaveText('Nachkommen');
    const labels = await page.locator('.bottom-bar-label').evaluateAll(els => els.map(el => ({
        text: el.textContent, cut: el.scrollWidth > el.clientWidth + 0.5,
        lines: Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight || '12')),
        size: getComputedStyle(el).fontSize,
    })));
    for (const l of labels) {
        expect(l.cut, `${l.text} cut`).toBe(false);
        expect(l.size).toBe('10.5px');
    }
});

test('every control of the phone chrome is a 44×44 target (the funnel and × in the field by their padding)', async ({ page }) => {
    await sample(page);
    const small = async () => page.evaluate(() => {
        const out: string[] = [];
        const sel = '.toolbar button, #focus-controls button, #bottom-bar button, .zoom-controls button';
        for (const el of document.querySelectorAll<HTMLElement>(sel)) {
            const r = el.getBoundingClientRect();
            if (!r.width || getComputedStyle(el).visibility === 'hidden' || el.closest('#search-filters')) continue;
            // The hit area: the box, or a ::before reaching past it.
            const cx = r.left + r.width / 2;
            const hitTop = document.elementFromPoint(cx, r.top + r.height / 2 - 21.5);
            const hitBottom = document.elementFromPoint(cx, r.top + r.height / 2 + 21.5);
            const tall = r.height >= 43.5 || (el.contains(hitTop) && el.contains(hitBottom));
            if (Math.round(r.width) < 44 || !tall) out.push(`${el.id || el.className} ${Math.round(r.width)}×${Math.round(r.height)}`);
        }
        return out;
    });
    expect(await small(), 'at rest').toEqual([]);
    await page.locator('#search-open-btn').tap();
    await page.locator('#toolbar-search-picker .person-picker-input').fill('Berg');
    await page.locator('#toolbar-search-picker .person-picker-input').blur();
    await expect(page.locator('#search-clear-btn')).toBeVisible();
    expect(await small(), 'with the active field').toEqual([]);
});

test('a tap leaves no hover fill (hover styles are for the mouse only)', async ({ page }) => {
    await sample(page);
    expect(await page.evaluate(() => matchMedia('(hover: hover)').matches)).toBe(false);
    // A row of the person's sheet (its hover tint was a plain :hover rule).
    await page.locator('#focus-name').tap();
    const row = page.locator('.bottom-sheet-person .bottom-sheet-item').last();
    const rest = await row.evaluate(el => getComputedStyle(el).backgroundColor);
    await row.hover();
    expect(await row.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(rest);
});

test('a sheet closed by Escape gives the focus back to what opened it', async ({ page }) => {
    await sample(page);
    await page.locator('#bb-view-more').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.bottom-sheet-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.bottom-sheet-menu')).toHaveCount(0);
    await expect(page.locator('#bb-view-more')).toBeFocused();
});
