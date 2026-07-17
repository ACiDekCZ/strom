import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

test('generation labels survive zooming out a step or two', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(page.locator('.person-card').first()).toBeVisible();
    await expect(page.locator('#gen-labels .gen-label').first()).toBeVisible();

    // Two zoom-out steps: labels must still be there (bands are still legible).
    await page.evaluate(() => { window.Strom.ZoomPan.zoomOut(); window.Strom.ZoomPan.zoomOut(); });
    await expect(page.locator('#gen-labels')).toBeVisible();

    // Zoom far out until the pitch collapses: labels hide. zoomOut animates,
    // so step with waits — synchronous calls would all target the same scale.
    for (let i = 0; i < 10; i++) {
        await page.evaluate(() => window.Strom.ZoomPan.zoomOut());
        await page.waitForTimeout(140);
    }
    await expect(page.locator('#gen-labels')).toBeHidden();
});
