import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, card } from './helpers.js';

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

test('the hamburger menu exposes the current-view actions (poster, export selection)', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    await page.evaluate(() => window.Strom.UI.toggleMobileMenu());
    const menu = page.locator('#mobile-menu');
    await expect(menu).toHaveClass(/active/);

    await expect(menu.locator('button', { hasText: 'Poster' })).toBeVisible();
    await expect(menu.locator('button', { hasText: 'Export this view' })).toBeVisible();

    // Poster… opens the view-aware poster dialog.
    await menu.locator('button', { hasText: 'Poster' }).click();
    await expect(page.locator('#poster-modal')).toBeVisible();
});
