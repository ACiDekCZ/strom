import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, card } from './helpers.js';

test('the search dropdown sizes to long names, not the narrow mobile input', async ({ page }) => {
    await openApp(page);
    // A name far wider than the ~140px mobile toolbar search field.
    await createFirstPerson(page, 'Bartholomew', 'Featherstonehaugh-Wellington');
    // The toolbar picker snapshots its person list on build; tree load/import
    // paths refresh it. Do the same so it sees the just-added person.
    await page.evaluate(() => window.Strom.UI.refreshSearch());

    const input = page.locator('#toolbar-search-picker .person-picker-input');
    await input.click();
    await input.fill('Bartho');

    const item = page.locator('#toolbar-search-picker .person-picker-item', { hasText: 'Bartholomew' }).first();
    await expect(item).toBeVisible();

    const inputBox = (await input.boundingBox())!;
    const dropBox = (await page.locator('#toolbar-search-picker .person-picker-dropdown').boundingBox())!;

    // The dropdown is wider than the narrow search input (names not squashed)...
    expect(dropBox.width).toBeGreaterThan(inputBox.width + 10);

    // ...yet stays fully on-screen (never overflows the right edge).
    const viewport = page.viewportSize()!;
    expect(dropBox.x).toBeGreaterThanOrEqual(0);
    expect(dropBox.x + dropBox.width).toBeLessThanOrEqual(viewport.width);

    // The option text is not clipped mid-name: its content fits its own box.
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

test('the "More" sheet exposes the remaining views and the current-view actions', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    // Open the More sheet from the bottom bar.
    await page.locator('#bb-view-more').tap();
    const sheet = page.locator('.bottom-sheet-menu');
    await expect(sheet).toBeVisible();

    // Section headers (grouped, no emoji) and key items are present.
    await expect(sheet.locator('.bottom-sheet-section', { hasText: 'Current view' })).toBeVisible();
    await expect(sheet.locator('.bottom-sheet-section', { hasText: /^View$/ })).toBeVisible();
    await expect(sheet.locator('.bottom-sheet-item', { hasText: 'Fan' })).toBeVisible();
    await expect(sheet.locator('.bottom-sheet-item', { hasText: 'Map' })).toBeVisible();
    await expect(sheet.locator('.bottom-sheet-item', { hasText: 'Export this view' })).toBeVisible();

    // Poster… opens the view-aware poster dialog and closes the sheet.
    await sheet.locator('.bottom-sheet-item', { hasText: 'Poster' }).click();
    await expect(page.locator('#poster-modal')).toBeVisible();
    await expect(page.locator('.bottom-sheet-menu')).toHaveCount(0);
});

test('the top bar ⋯ opens the same "More" sheet', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await page.locator('.mobile-more-btn').tap();
    await expect(page.locator('.bottom-sheet-menu')).toBeVisible();
});

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
