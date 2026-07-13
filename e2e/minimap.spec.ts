import { test, expect } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * Overview minimap: appears when the tree overflows the viewport, navigates the
 * canvas on click, and can be turned off in settings.
 */
test.describe('Minimap', () => {
    test('shows when zoomed in, navigates on click, hides via settings', async ({ page }) => {
        await openApp(page);
        await page.getByRole('button', { name: 'Try a sample tree' }).click();
        await expect(card(page, 'Henry VIII')).toBeVisible();

        const panel = page.locator('#minimap-panel');

        // Zoom in until the tree overflows the viewport -> minimap appears.
        for (let i = 0; i < 4; i++) await page.evaluate(() => window.Strom.ZoomPan.zoomIn());
        await expect(panel).toBeVisible();

        // Clicking in the minimap re-centers the canvas (transform changes).
        const before = await page.locator('#tree-canvas').evaluate((el) => el.style.transform);
        const box = await page.locator('#minimap-canvas').boundingBox();
        if (!box) throw new Error('minimap canvas has no box');
        await page.mouse.click(box.x + box.width * 0.85, box.y + box.height * 0.85);
        await expect.poll(async () =>
            page.locator('#tree-canvas').evaluate((el) => el.style.transform)
        ).not.toBe(before);

        // Turning the setting off hides the minimap.
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        await page.locator('#minimap-toggle').uncheck();
        await expect(panel).toBeHidden();
    });
});
