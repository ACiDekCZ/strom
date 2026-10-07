import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, card } from './helpers.js';

test('the phone search: the magnifier opens the field over the bar; a long name fits the dropdown, on screen', { tag: '@smoke' }, async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Bartholomew', 'Featherstonehaugh-Wellington');
    // The toolbar picker snapshots its person list on build; tree load/import
    // paths refresh it. Do the same so it sees the just-added person.
    await page.evaluate(() => window.Strom.UI.refreshSearch());

    const input = page.locator('#toolbar-search-picker .person-picker-input');
    await expect(input).toBeHidden();
    await page.locator('#search-open-btn').click();
    await expect(input).toBeFocused();
    await expect(page.locator('#search-cancel-btn')).toBeVisible();
    await expect(page.locator('.tree-switcher')).toBeHidden();
    await input.fill('Bartho');

    const item = page.locator('#toolbar-search-picker .person-picker-item', { hasText: 'Bartholomew' }).first();
    await expect(item).toBeVisible();
    const dropBox = (await page.locator('#toolbar-search-picker .person-picker-dropdown').boundingBox())!;
    // Fully on-screen (never past the right edge)...
    const viewport = page.viewportSize()!;
    expect(dropBox.x).toBeGreaterThanOrEqual(0);
    expect(dropBox.x + dropBox.width).toBeLessThanOrEqual(viewport.width);
    // ...and the option text is not clipped mid-name.
    const overflow = await item.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
});

// Emulate a touch phone so matchMedia('(pointer: coarse)') is true.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

/** Dispatch a long-press (touchstart, hold, touchend) on a locator. */
async function longPress(page: Page, selector: string): Promise<void> {
    await page.locator(selector).evaluate((el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        const t = new Touch({ identifier: 1, target: el, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 });
        el.dispatchEvent(new TouchEvent('touchstart', { touches: [t], targetTouches: [t], changedTouches: [t], bubbles: true }));
    });
    await page.waitForTimeout(600); // longer than the 500 ms long-press threshold
    await page.locator(selector).evaluate((el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        const t = new Touch({ identifier: 1, target: el, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 });
        el.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [t], bubbles: true }));
    });
}

test('long-press on a card opens the bottom sheet; Edit opens the person modal', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    // Long-press the focused card.
    const sel = '.person-card.focused';
    await longPress(page, sel);

    const sheet = page.locator('.bottom-sheet');
    await expect(sheet).toBeVisible();
    // Same actions as the context menu.
    await sheet.locator('.bottom-sheet-item[data-action="edit"]').click();
    await expect(page.locator('#person-modal')).toBeVisible();
});

test('pinch changes the zoom level', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    const before = await page.evaluate(() => window.Strom.ZoomPan.getScale());

    // Dispatch a two-finger pinch (fingers moving apart) on the tree container.
    await page.evaluate(() => {
        const el = document.getElementById('tree-container')!;
        const mk = (id: number, x: number, y: number) => new Touch({ identifier: id, target: el, clientX: x, clientY: y });
        const start = [mk(1, 180, 400), mk(2, 210, 420)];
        el.dispatchEvent(new TouchEvent('touchstart', { touches: start, targetTouches: start, changedTouches: start, bubbles: true, cancelable: true }));
        const move = [mk(1, 120, 340), mk(2, 270, 480)];
        el.dispatchEvent(new TouchEvent('touchmove', { touches: move, targetTouches: move, changedTouches: move, bubbles: true, cancelable: true }));
        el.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [], bubbles: true, cancelable: true }));
    });

    await expect.poll(() => page.evaluate(() => window.Strom.ZoomPan.getScale())).not.toBe(before);
});

test('a single tap on a card opens the bottom sheet (first tap = person menu)', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await page.locator('.person-card.focused').tap();

    const sheet = page.locator('.bottom-sheet');
    await expect(sheet).toBeVisible();
    // The desktop floating context menu must NOT appear on touch.
    await expect(page.locator('.context-menu')).toHaveCount(0);
});

test('the bottom bar carries the three primary views + a raised FAB', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    const bar = page.locator('#bottom-bar');
    await expect(bar).toBeVisible();
    // Three primary view tabs live on the bar (fan/map moved to the More sheet).
    for (const id of ['bb-view-family', 'bb-view-descendants', 'bb-view-timeline', 'bb-view-more']) {
        await expect(page.locator(`#${id}`)).toBeVisible();
    }
    // The old hamburger is gone.
    await expect(page.locator('.hamburger-btn')).toHaveCount(0);
    await expect(page.locator('#mobile-menu')).toHaveCount(0);

    // The central FAB opens the add-person modal.
    await page.locator('#bottom-bar-fab').tap();
    await expect(page.locator('#person-modal')).toBeVisible();
});

test('a bottom-bar tab switches the view and lights up copper', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await page.locator('#bb-view-timeline').tap();
    await expect(page.locator('#bb-view-timeline')).toHaveClass(/active/);
    await expect(page.locator('#bb-view-family')).not.toHaveClass(/active/);
    // Timeline view is now on screen.
    await expect(page.locator('#timeline-container')).toBeVisible();
});

test('the "More" sheet mirrors the desktop actions menu: Undo/Redo pair, content, outputs, one Export…, the views, the Tree row', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await page.locator('#bb-view-more').tap();
    const sheet = page.locator('.bottom-sheet-menu');
    await expect(sheet).toBeVisible();

    // The Undo/Redo pair is the compact first group (no section header above it).
    const pair = sheet.locator('.bottom-sheet-pair').first();
    await expect(pair).toBeVisible();
    await expect(pair.locator('.bottom-sheet-item', { hasText: 'Undo' })).toBeVisible();
    await expect(pair.locator('.bottom-sheet-item', { hasText: 'Redo' })).toBeVisible();

    // One section header only: the views.
    expect(await sheet.locator('.bottom-sheet-section').allTextContents()).toEqual(['View']);
    const rows = (await sheet.locator('.bottom-sheet-items > .bottom-sheet-item:not(.bottom-sheet-storage-row)').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
    expect(rows.slice(0, 6)).toEqual(['Family book', 'Anniversaries', 'Export… whole tree or current view', 'Poster…', 'Slideshow (TV mode)', 'Ancestor research']);
    expect(rows.slice(-3, -1)).toEqual(['Add family…', 'Settings']);
    // About carries the version (BETA · version on the beta site): no badge room in the phone toolbar.
    expect(rows[rows.length - 1]).toMatch(/^About Strom \d+\.\d+\.\d+/);

    // The prominent "Tree: {name}" row carries the active tree's name and a
    // trailing chevron (a submenu opener).
    const treeRow = sheet.locator('.bottom-sheet-tree-row');
    await expect(treeRow).toBeVisible();
    await expect(treeRow.locator('.bottom-sheet-tree-name')).toHaveText('My Family Tree');
    await expect(treeRow.locator('.bottom-sheet-tree-chevron')).toBeVisible();

    // "Manage trees" right under the Tree row (its actions sheet no longer lists it).
    const manage = sheet.locator('.bottom-sheet-item', { hasText: 'Manage trees' });
    await expect(manage).toHaveCount(1);
    expect(await manage.evaluate(el => {
        const items = [...document.querySelectorAll('.bottom-sheet-menu .bottom-sheet-item')];
        return items.indexOf(el) - items.indexOf(document.querySelector('.bottom-sheet-tree-row')!);
    })).toBe(1);

    // Fan / Map side by side under "View"; one Export… with its second line.
    await expect(sheet.locator('.bottom-sheet-section', { hasText: /^View$/ })).toBeVisible();
    const views = sheet.locator('.bottom-sheet-pair').last();
    await expect(views.locator('.bottom-sheet-item')).toHaveText(['Fan', 'Map']);
    const fan = (await views.locator('.bottom-sheet-item').first().boundingBox())!;
    expect(fan.height).toBeGreaterThanOrEqual(44);
    const exports = sheet.locator('.bottom-sheet-item', { hasText: 'Export' });
    await expect(exports).toHaveCount(1);
    await expect(exports).toHaveText('Export…whole tree or current view');

    // Poster… opens the view-aware poster dialog and closes the sheet.
    await sheet.locator('.bottom-sheet-item', { hasText: 'Poster' }).click();
    await expect(page.locator('#poster-modal')).toBeVisible();
    await expect(page.locator('.bottom-sheet-menu')).toHaveCount(0);
});

test('the Tree row opens the tree-actions sheet: name, summary, the six groups as 48px rows', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await page.locator('#bb-view-more').tap();
    await page.locator('.bottom-sheet-tree-row').click();

    const sheet = page.locator('.bottom-sheet-tree-actions');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('.tree-actions-title')).toHaveText('My Family Tree');
    await expect(sheet.locator('.tree-actions-sub')).toHaveText('Open tree');
    await expect(sheet.locator('.tree-actions-summary')).toContainText('1 person');
    await expect(sheet.locator('.tree-actions-summary')).toContainText('edited');

    await expect(sheet.locator('.bottom-sheet-section')).toHaveText(['Overview', 'Outputs', 'Tree settings', 'Structure', 'Manage']);
    const keys = await sheet.locator('.tree-actions-row').evaluateAll(els => els.map(el => (el as HTMLElement).dataset.action));
    expect(keys).toEqual(['stats', 'health', 'export', 'snapshots', 'rename', 'defaultPerson', 'startup', 'places', 'surnames',
        'makeTree', 'mergeView', 'splitFamilies', 'split', 'mergeInto', 'duplicate', 'visibility', 'lock', 'delete']);
    for (const box of await sheet.locator('.tree-actions-row').evaluateAll(els => els.map(el => el.getBoundingClientRect().height))) {
        expect(Math.round(box)).toBeGreaterThanOrEqual(48); // subpixel layout
    }
    await expect(sheet.locator('[data-action="delete"]')).toHaveClass(/danger/);
    // Opens at 80% of the window at most; the list scrolls, the head stays.
    const h = (await sheet.boundingBox())!.height;
    expect(h).toBeLessThanOrEqual(844 * 0.8 + 1);
    expect(await sheet.locator('.tree-actions-list').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);

    // "Open at startup" toggles in place, the sheet stays.
    const startup = sheet.locator('[data-action="startup"]');
    await expect(startup).toHaveAttribute('aria-checked', 'false');
    await startup.click();
    await expect(startup).toHaveAttribute('aria-checked', 'true');
    await expect(sheet).toBeVisible();

    // Any other row closes the sheet and runs.
    await sheet.locator('[data-action="stats"]').click();
    await expect(page.locator('.bottom-sheet-tree-actions')).toHaveCount(0);
    await expect(page.locator('#tree-stats-modal')).toHaveClass(/active/);
});

test('the tree manager on a phone: ⋯ opens the sheet over it; another tree has no open-tree rows and a note', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await page.evaluate(() => window.Strom.DataManager.importAsNewTree({ persons: {}, partnerships: {} } as never, 'Jiný strom'));
    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    const manager = page.locator('#tree-manager-modal');

    // The open tree's row: a label instead of Open; Close gives way to × and the drag.
    const active = manager.locator('.tree-manager-item.active');
    await expect(active.locator('.tree-opened-label')).toBeVisible();
    await expect(active.locator('.tree-open-btn')).toBeHidden();
    await expect(manager.locator('.tree-manager-footer [data-dismiss]')).toBeHidden();
    const more = (await active.locator('.tree-row-menu-btn').boundingBox())!;
    expect(more.width).toBeGreaterThanOrEqual(44);
    expect(more.height).toBeGreaterThanOrEqual(44);

    const other = manager.locator('.tree-manager-item:not(.active)').first();
    await other.locator('.tree-row-menu-btn').tap();
    const sheet = page.locator('.bottom-sheet-tree-actions');
    await expect(sheet).toBeVisible();
    // No floating menu on touch; the manager stays open under the sheet.
    await expect(other.locator('.tree-row-menu.open')).toHaveCount(0);
    await expect(manager).toHaveClass(/active/);
    await expect(sheet.locator('.tree-actions-sub')).toHaveText('Tree settings and file');
    await expect(sheet.locator('.tree-actions-summary')).toContainText('no research');
    for (const key of ['places', 'surnames', 'split', 'splitFamilies', 'makeTree']) {
        await expect(sheet.locator(`[data-action="${key}"]`)).toHaveCount(0);
    }
    await expect(sheet.locator('.tree-actions-note')).toBeVisible();

    // Escape closes the sheet only; the manager stays.
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(manager).toHaveClass(/active/);
});

// The top bar ⋯ opening the same "More" sheet: toolbar-responsive.spec.ts
// (the mobile ⋯ stays ghost … when its sheet is open).

test('bottom-bar tabs, the FAB and sheet rows meet the 44px touch target', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    for (const sel of ['#bb-view-family', '#bb-view-descendants', '#bb-view-timeline', '#bb-view-more']) {
        const box = (await page.locator(sel).boundingBox())!;
        expect(box.height, `${sel} height`).toBeGreaterThanOrEqual(44);
    }
    const fab = (await page.locator('#bottom-bar-fab').boundingBox())!;
    expect(fab.width).toBeGreaterThanOrEqual(44);
    expect(fab.height).toBeGreaterThanOrEqual(44);

    // Sheet rows are at least 48px tall.
    await page.locator('#bb-view-more').tap();
    const row = page.locator('.bottom-sheet-menu .bottom-sheet-item').first();
    const rowBox = (await row.boundingBox())!;
    expect(rowBox.height).toBeGreaterThanOrEqual(44);
});

test('the floating zoom buttons are circles at every phone width', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    for (const width of [320, 390, 430]) {
        await page.setViewportSize({ width, height: 844 });
        const buttons = page.locator('.zoom-controls button:visible');
        await expect(buttons.first()).toBeVisible();
        for (const box of await buttons.evaluateAll(els => els.map(el => el.getBoundingClientRect().toJSON()))) {
            // Same width and height: border-radius 50% draws a circle, not an oval.
            expect(Math.abs(box.width - box.height), `${width}px: ${box.width}×${box.height}`).toBeLessThanOrEqual(1);
            expect(box.height).toBeGreaterThanOrEqual(44);
        }
    }
});

test('the tree-actions sheet fits 320 and 430 wide: a long name wraps, nothing overflows sideways', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await page.evaluate(async () => {
        const id = window.Strom.TreeManager.getActiveTreeId()!;
        window.Strom.TreeManager.renameTree(id, 'Rodokmen rodu Novák-Dvořák-Svobodových z Horní Lhoty');
    });
    for (const width of [320, 430]) {
        await page.setViewportSize({ width, height: 700 });
        await page.evaluate(() => window.Strom.UI.showTreeActionsSheet());
        const sheet = page.locator('.bottom-sheet-tree-actions');
        await expect(sheet).toBeVisible();
        const fit = await sheet.evaluate(el => ({
            overflow: el.scrollWidth - el.clientWidth,
            right: el.getBoundingClientRect().right,
            titleLines: Math.round(el.querySelector('.tree-actions-title')!.getBoundingClientRect().height / 25),
        }));
        expect(fit.overflow, `${width}px`).toBeLessThanOrEqual(0);
        expect(fit.right).toBeLessThanOrEqual(width);
        expect(fit.titleLines, 'the name wraps, never cut').toBeGreaterThanOrEqual(2);
        await page.keyboard.press('Escape');
        await expect(sheet).toHaveCount(0);
    }
});

test('search fields take a name as typed: no auto-capitals, corrections or spell check (T23)', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    const id = await card(page, 'Jan').getAttribute('data-id');
    // A person picker built inside a dialog (the relationship calculator).
    await page.evaluate((pid) => window.Strom.UI.showRelationshipCalculator(pid as never), id);
    await expect(page.locator('#kinship-modal')).toBeVisible();
    const fields = await page.evaluate(() => {
        const sel = ['#toolbar-search-picker .person-picker-input', '#kinship-modal .person-picker-input',
            '#filter-lastname', '#filter-place', '#tree-manager-search', '#source-picker-search', '#sources-search'];
        return sel.map(s => {
            const el = document.querySelector(s) as HTMLInputElement | null;
            if (!el) return `${s}: missing`;
            const a = (n: string) => el.getAttribute(n);
            return `${s}: ${a('autocapitalize')} ${a('autocorrect')} ${el.spellcheck} ${a('autocomplete')}`;
        });
    });
    expect(fields).toEqual([
        '#toolbar-search-picker .person-picker-input: off off false off',
        '#kinship-modal .person-picker-input: off off false off',
        '#filter-lastname: off off false off',
        '#filter-place: off off false off',
        '#tree-manager-search: off off false off',
        '#source-picker-search: off off false off',
        '#sources-search: off off false off',
    ]);
});
