import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, card, openTreeStructure } from './helpers.js';

/** The open tree's sheet (More → Tree: {name}), menu 1020 §3.1: headings and rows (Change structure folded). */
const TREE_SHEET_HEADERS = ['Research', 'Tree settings'];
const TREE_SHEET_KEYS = ['overview', 'overview-quality', 'snapshots', 'researchInfo',
    'rename', 'defaultPerson', 'startup', 'places', 'surnames', 'structure',
    'visibility', 'lock', 'delete', 'manageTrees'];

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
    // Held until the long-press (500 ms) has opened the sheet, then lifted.
    await expect(page.locator('.bottom-sheet')).toBeVisible();
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

/** A real finger (the browser's own gesture handling: a tap makes a click) dragged from (x, y) by (dx, dy). */
async function fingerDrag(page: Page, x: number, y: number, dx: number, dy: number, steps = 8): Promise<void> {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= steps; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / steps, y: y + dy * i / steps }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
}

test('a finger dragged from a card pans the canvas and opens no sheet; a tap still opens it (T38)', async ({ page }) => {
    // The long-press time is run past on Playwright's clock.
    await page.clock.install();
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    const transform = () => page.locator('#tree-canvas').evaluate((el) => (el as HTMLElement).style.transform);
    const sheet = page.locator('.bottom-sheet');
    const box = (await page.locator('.person-card.focused').boundingBox())!;
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

    const before = await transform();
    await fingerDrag(page, cx, cy, -80, 60);
    await expect.poll(transform).not.toBe(before);
    await page.clock.fastForward(700);   // past the long-press time too
    await expect(sheet).toHaveCount(0);

    // A tap (a finger that barely moves) is still the card's: the sheet opens, nothing pans.
    const panned = await transform();
    const moved = (await page.locator('.person-card.focused').boundingBox())!;
    await fingerDrag(page, moved.x + moved.width / 2, moved.y + moved.height / 2, 3, 2, 2);
    await expect(sheet).toBeVisible();
    expect(await transform()).toBe(panned);
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

test('the "More" sheet (menu 1020 §7): Undo|Redo tiles, content, For the family ›, View tiles, the Tree row, Settings|About tiles', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await page.locator('#bb-view-more').tap();
    const sheet = page.locator('.bottom-sheet-menu');
    await expect(sheet).toBeVisible();
    // The title stays for assistive technology only.
    await expect(sheet).toHaveAttribute('aria-label', 'More');
    await expect(sheet.locator('.bottom-sheet-menu-title')).toBeHidden();

    // The Undo/Redo tiles come first; no shortcut chip on a touch screen.
    const pairs = sheet.locator('.bottom-sheet-pair');
    await expect(pairs).toHaveCount(3);
    await expect(pairs.nth(0).locator('.bottom-sheet-item')).toHaveText([/^↶ Undo/, /^↷ Redo/]);
    await expect(page.locator('#sheet-undo')).toHaveAttribute('aria-label', 'Undo');
    await expect(page.locator('#sheet-undo .menu-kbd')).toBeHidden();
    for (const tile of await sheet.locator('.bottom-sheet-pair .bottom-sheet-item').all()) {
        expect((await tile.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }

    // The rows (no section headers), then the View tiles, then Settings | About (no version: it is in About).
    await expect(sheet.locator('.bottom-sheet-section')).toHaveCount(0);
    const rows = (await sheet.locator('.bottom-sheet-items > .bottom-sheet-item:not(.bottom-sheet-storage-row)').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
    // "Ancestor research · New" only while it is new (menu 1020 §1.1); seen here: in the tree's sheet.
    expect(rows).toEqual(['Anniversaries', 'Export…', 'For the family ›', 'Tree: My Family Tree ›', 'Add family…']);
    await expect(pairs.nth(1)).toHaveAttribute('aria-label', 'View');
    await expect(pairs.nth(1).locator('.bottom-sheet-item')).toHaveText(['Fan', 'Map']);
    await expect(pairs.nth(2).locator('.bottom-sheet-item')).toHaveText(['Settings', 'About Strom']);
    // Tree management left the first level (Tree › and the tree switcher carry it).
    await expect(sheet.locator('.bottom-sheet-item', { hasText: 'Manage trees' })).toHaveCount(0);

    // The prominent "Tree: {name}" row carries the active tree's name and a chevron.
    const treeRow = sheet.locator('.bottom-sheet-tree-row');
    await expect(treeRow.locator('.bottom-sheet-tree-name')).toHaveText('My Family Tree');
    await expect(treeRow.locator('.bottom-sheet-tree-chevron')).toBeVisible();

    // For the family › opens a second level in the same sheet; ‹ Back returns.
    await page.locator('#sheet-family').tap();
    const sub = sheet.locator('.bottom-sheet-subpage');
    await expect(sub).toBeVisible();
    await expect(sub.locator('.sheet-subhead-title')).toHaveText('For the family');
    await expect(sub.locator('.bottom-sheet-items .bottom-sheet-item')).toHaveText(['Family book', 'Poster…', 'Slideshow (TV)']);
    await expect(sheet.locator(':scope > .bottom-sheet-items')).toBeHidden();
    await sub.locator('.sheet-back').tap();
    await expect(sub).toHaveCount(0);
    await expect(page.locator('#sheet-family')).toBeVisible();

    // Poster… opens the view-aware poster dialog and closes the sheet.
    await page.locator('#sheet-family').tap();
    await page.locator('#sheet-poster').tap();
    await expect(page.locator('#poster-modal')).toBeVisible();
    await expect(page.locator('.bottom-sheet-menu')).toHaveCount(0);
});

test('More: Family book, Poster…, Slideshow, Settings and Import… are all within reach on a phone', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(page.locator('.person-card').first()).toBeVisible();
    const more = async () => {
        await page.locator('#bb-view-more').tap();
        await expect(page.locator('.bottom-sheet-menu')).toBeVisible();
    };
    const viaFamily = async (id: string) => {
        await more();
        await page.locator('#sheet-family').tap();
        await page.locator(id).tap();
        await expect(page.locator('.bottom-sheet-menu')).toHaveCount(0);
    };
    await viaFamily('#sheet-book');
    await expect(page.locator('#book-modal')).toBeVisible();
    await page.evaluate(() => window.Strom.UI.closeBookDialog());
    await viaFamily('#sheet-poster');
    await expect(page.locator('#poster-modal')).toBeVisible();
    await page.evaluate(() => window.Strom.UI.closePosterDialog());
    await more();
    await page.locator('#sheet-settings').tap();
    await expect(page.locator('#settings-modal')).toHaveClass(/active/);
    await page.evaluate(() => window.Strom.UI.closeSettingsDialog());
    // Import… is in the tree switcher (a new tree), not in More.
    await more();
    await expect(page.locator('.bottom-sheet-menu')).not.toContainText('Import');
    await page.evaluate(() => window.Strom.UI.hideBottomSheet());
    await page.locator('.tree-switcher-btn').tap();
    await page.locator('#tree-sheet-import').tap();
    await expect(page.locator('#import-modal')).toHaveClass(/active/);
    await page.evaluate(() => window.Strom.UI.closeImportDialog());
    // Last: the fly-through.
    await viaFamily('#sheet-slideshow');
    await expect(page.locator('body')).toHaveClass(/slideshow-mode/);
    await page.evaluate(() => window.Strom.UI.stopSlideshow());
});

test.describe('More on a small phone and held sideways', () => {
    test('360 × 640: the whole first level without scrolling', async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 640 });
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await page.locator('#bb-view-more').tap();
        const sheet = page.locator('.bottom-sheet-menu');
        await expect(sheet).toBeVisible();
        await expect.poll(() => sheet.evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
    });

    test('360 × 640: no row runs past the sheet\'s right edge, the Tree row sits evenly inside', async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 640 });
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await page.locator('#bb-view-more').tap();
        const items = page.locator('.bottom-sheet-menu > .bottom-sheet-items');
        await expect(items).toBeVisible();
        const fit = await items.evaluate(el => {
            const box = el.getBoundingClientRect();
            const row = el.querySelector('.bottom-sheet-tree-row')!.getBoundingClientRect();
            return { overflow: el.scrollWidth - el.clientWidth, left: row.left - box.left, right: box.right - row.right };
        });
        expect(fit.overflow).toBeLessThanOrEqual(0);
        expect(fit.right).toBeGreaterThanOrEqual(0);
        expect(Math.abs(fit.left - fit.right)).toBeLessThanOrEqual(1);
    });

    test('640 × 360 sideways: two columns of 44px rows, no scrolling', async ({ page }) => {
        await page.setViewportSize({ width: 640, height: 360 });
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Novak');
        await page.locator('#bb-view-more').tap();
        const sheet = page.locator('.bottom-sheet-menu');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator(':scope > .bottom-sheet-items')).toHaveCSS('display', 'grid');
        // Measured once the sheet has slid in.
        await expect.poll(() => sheet.evaluate(el => getComputedStyle(el).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
        const undo = (await page.locator('#sheet-undo').boundingBox())!;
        const redo = (await page.locator('#sheet-redo').boundingBox())!;
        expect(Math.abs(undo.y - redo.y)).toBeLessThan(2);
        expect(redo.x).toBeGreaterThan(undo.x + undo.width - 1);
        expect(undo.height).toBeGreaterThanOrEqual(44);
        const tree = (await sheet.locator('.bottom-sheet-tree-row').boundingBox())!;
        expect(tree.height).toBeLessThan(46);
        await expect.poll(() => sheet.evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
    });
});

test('the Tree row opens the tree-actions sheet: name, summary, the groups of the one list as 48px rows', async ({ page }) => {
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

    // Menu 1020 §3.1: no Export, Save to file nor Send changes here (one level up / the manager's ⋯);
    // the structure actions fold under "Change structure ⌄"; Manage trees… last.
    await expect(sheet.locator('.bottom-sheet-section')).toHaveText(TREE_SHEET_HEADERS);
    // Sentence case as in design 3d (not the uppercase labels of other sheets).
    expect(await sheet.locator('.bottom-sheet-section').first().evaluate(el => getComputedStyle(el).textTransform)).toBe('none');
    await expect(sheet.locator('[data-action="defaultPerson"] .tree-actions-value')).toHaveText('First person');
    const keys = () => sheet.locator('.tree-actions-row:visible').evaluateAll(els => els.map(el => (el as HTMLElement).dataset.action));
    expect(await keys()).toEqual(TREE_SHEET_KEYS);
    await openTreeStructure(page, sheet);
    expect(await keys()).toEqual([...TREE_SHEET_KEYS.slice(0, TREE_SHEET_KEYS.indexOf('structure') + 1),
        'makeTree', 'mergeView', 'splitFamilies', 'split', 'mergeInto', 'duplicate',
        ...TREE_SHEET_KEYS.slice(TREE_SHEET_KEYS.indexOf('structure') + 1)]);
    for (const box of await sheet.locator('.tree-actions-row:visible').evaluateAll(els => els.map(el => el.getBoundingClientRect().height))) {
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
    await sheet.locator('[data-action="overview"]').click();
    await expect(page.locator('.bottom-sheet-tree-actions')).toHaveCount(0);
    await expect(page.locator('#tree-overview-modal .modal.tov')).toBeVisible();
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
