import { test, expect, Page } from '@playwright/test';
import { openApp, createFirstPerson, card, focusViaSearch } from './helpers.js';

function canvasTransform(page: Page): Promise<string> {
    return page.locator('#tree-canvas').evaluate((el) => (el as HTMLElement).style.transform);
}

/** Current zoom scale (zoom is animated, so assertions must poll this). */
function scale(page: Page): Promise<number> {
    return page.evaluate(() => window.Strom.ZoomPan.getScale());
}

/** Wait until the zoom animation stops (two identical reads ~100ms apart). */
function waitZoomSettled(page: Page): Promise<unknown> {
    return page.waitForFunction(() => new Promise<boolean>((resolve) => {
        const a = window.Strom.ZoomPan.getScale();
        setTimeout(() => resolve(window.Strom.ZoomPan.getScale() === a), 100);
    }));
}

test('keyboard: Ctrl+F focuses search, +/0 zoom, Esc closes a modal', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    // Ctrl+F focuses the toolbar search input.
    const searchInput = page.locator('#toolbar-search-picker .person-picker-input');
    await page.keyboard.press('Control+f');
    await expect(searchInput).toBeFocused();

    // Blur the input so single-key zoom shortcuts are active (they are ignored
    // while a text field holds focus). Click an empty corner so the click does
    // not land on the centred card (which would open the context menu).
    await searchInput.blur();
    await page.locator('#tree-container').click({ position: { x: 8, y: 8 } });
    await expect(searchInput).not.toBeFocused();
    const base = await scale(page);
    await page.keyboard.press('+');
    await expect.poll(() => scale(page)).toBeGreaterThan(base);
    // reset() does not cancel the in-flight zoom animation, so wait for it to
    // fully settle before pressing 0, otherwise the animation clobbers the reset.
    await waitZoomSettled(page);
    await expect(searchInput).not.toBeFocused();
    await page.keyboard.press('0'); // reset to scale 1
    await expect.poll(() => scale(page)).toBe(1);

    // Esc closes an open modal.
    await page.evaluate(() => window.Strom.UI.showAddPersonModal());
    await expect(page.locator('#person-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#person-modal')).toBeHidden();
});

test('zoom controls and mouse wheel change the zoom level', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    const base = await scale(page);
    await page.locator('.zoom-controls button').first().click(); // zoom in
    await expect.poll(() => scale(page)).toBeGreaterThan(base);

    // Mouse wheel over the canvas also changes the zoom.
    const afterButton = await scale(page);
    await page.locator('#tree-container').hover();
    await page.mouse.wheel(0, -200);
    await expect.poll(() => scale(page)).not.toBe(afterButton);
});

test('dragging the canvas pans the tree', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');

    const before = await canvasTransform(page);
    const box = await page.locator('#tree-container').boundingBox();
    if (!box) throw new Error('no tree container');
    // Drag from an empty area of the canvas.
    await page.mouse.move(box.x + box.width - 40, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 160, box.y + 160, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => canvasTransform(page)).not.toBe(before);
});

test('expanded mode: a multi-marriage person shows all partners inline', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(page.locator('#empty-state')).toBeHidden();

    // Henry VIII had several marriages; focusing him lays out all wives inline.
    await focusViaSearch(page, 'Henry VIII');
    await expect(card(page, 'Jane')).toBeVisible();    // Jane Seymour
    await expect(card(page, 'Anne')).toBeVisible();    // Anne Boleyn
    // More than a single couple is on screen.
    expect(await page.locator('.person-card').count()).toBeGreaterThan(4);

    // Refocusing another person re-lays-out the tree around the new focus.
    await focusViaSearch(page, 'Mary I');
    await expect(card(page, 'Mary I')).toHaveClass(/focused/);
});
