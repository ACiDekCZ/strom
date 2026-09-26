import { test, expect, Page } from '@playwright/test';
import { openApp } from './helpers.js';

/**
 * The fullscreen image viewer (excerpts, scans): the page blocks browser
 * zoom, so the viewer zooms itself — buttons, keys, wheel, double-click,
 * drag, and a two-finger pinch on touch screens.
 */

/** A real register-like strip (1200×240 JPEG) drawn on a canvas. */
async function openStrip(page: Page): Promise<void> {
    await page.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = 1200; c.height = 240;
        const g = c.getContext('2d')!;
        g.fillStyle = '#e8dcc0'; g.fillRect(0, 0, 1200, 240);
        g.fillStyle = '#333'; g.font = '48px serif'; g.fillText('Křest Jana 1850, fol. 12', 30, 140);
        window.Strom.UI.showAttachmentImage(c.toDataURL('image/jpeg', 0.9));
    });
    await expect(page.locator('#attachment-overlay')).toHaveClass(/active/);
    await expect(page.locator('#image-viewer-level')).toHaveText('100 %');
}

const scale = (page: Page) => page.locator('#attachment-overlay-img').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a);
const offsetX = (page: Page) => page.locator('#attachment-overlay-img').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).e);
const level = (page: Page) => page.locator('#image-viewer-level');

test('computer: buttons, keys, wheel and double-click zoom; drag pans; the backdrop closes', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openApp(page);
    await openStrip(page);
    const fit = await scale(page);
    await expect(page.locator('#image-viewer-hint')).toContainText('Scroll or double-click to zoom');
    await expect(page.locator('#image-viewer-out')).toBeDisabled();

    await page.locator('#image-viewer-in').click();
    await expect(level(page)).toHaveText('150 %');
    await page.keyboard.press('+');
    await expect(level(page)).toHaveText('225 %');
    await page.keyboard.press('0');
    await expect(level(page)).toHaveText('100 %');

    // The wheel zooms around the cursor.
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, -300);
    await expect.poll(() => scale(page)).toBeGreaterThan(fit * 1.5);

    // Drag pans the zoomed image.
    const x0 = await offsetX(page);
    await page.mouse.move(640, 400);
    await page.mouse.down();
    await page.mouse.move(540, 400, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => offsetX(page)).toBeLessThan(x0 - 50);

    // The level button (or a double-click on the zoomed image) goes back to the fit.
    await level(page).click();
    await expect(level(page)).toHaveText('100 %');
    await page.locator('#attachment-overlay-img').dblclick();
    await expect(level(page)).toHaveText('300 %');
    await page.locator('#attachment-overlay-img').dblclick();
    await expect(level(page)).toHaveText('100 %');

    // A click on the image keeps it open; on the backdrop it closes.
    await page.locator('#attachment-overlay-img').click();
    await page.waitForTimeout(350);
    await expect(page.locator('#attachment-overlay')).toHaveClass(/active/);
    await page.mouse.click(20, 780);
    await expect(page.locator('#attachment-overlay')).not.toHaveClass(/active/);
});

test('phone: a two-finger pinch zooms, one finger pans, × closes', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openApp(page);
    await openStrip(page);
    const fit = await scale(page);

    // Two touch pointers moving apart around the centre.
    await page.evaluate(() => {
        const stage = document.getElementById('image-viewer-stage')!;
        const fire = (type: string, id: number, x: number, y: number) => stage.dispatchEvent(new PointerEvent(type, {
            pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: id === 1,
        }));
        fire('pointerdown', 1, 175, 422);
        fire('pointerdown', 2, 215, 422);
        for (let i = 1; i <= 10; i++) {
            fire('pointermove', 1, 175 - i * 12, 422);
            fire('pointermove', 2, 215 + i * 12, 422);
        }
        fire('pointerup', 1, 55, 422);
        fire('pointerup', 2, 335, 422);
    });
    const pinched = await scale(page);
    expect(pinched).toBeGreaterThan(fit * 3);
    await expect(page.locator('#attachment-overlay')).toHaveClass(/active/);   // a pinch is not a tap

    // One finger pans.
    const x0 = await offsetX(page);
    await page.evaluate(() => {
        const stage = document.getElementById('image-viewer-stage')!;
        const fire = (type: string, x: number) => stage.dispatchEvent(new PointerEvent(type, {
            pointerId: 3, pointerType: 'touch', clientX: x, clientY: 422, bubbles: true, isPrimary: true,
        }));
        fire('pointerdown', 200);
        for (let i = 1; i <= 5; i++) fire('pointermove', 200 - i * 20);
        fire('pointerup', 100);
    });
    await expect.poll(() => offsetX(page)).toBeLessThan(x0 - 50);
    await expect(page.locator('#image-viewer-hint')).not.toHaveClass(/show/);

    // The controls are 44px targets and stay inside the screen.
    const tools = await page.locator('.image-viewer-tools').boundingBox();
    expect(tools!.x).toBeGreaterThanOrEqual(0);
    expect(tools!.x + tools!.width).toBeLessThanOrEqual(390);
    expect((await page.locator('#image-viewer-close').boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await page.locator('#image-viewer-close').click();
    await expect(page.locator('#attachment-overlay')).not.toHaveClass(/active/);
});
