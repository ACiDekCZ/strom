import { test, expect } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * The app tour is hidden until it shows more than a few elements: no offer
 * after the sample tree (and the offer is still due once it comes back), no
 * link in the contents of How Strom works, on a computer and on a phone. The
 * tour itself is tested in tour.spec.ts with it turned on.
 */
test('desktop: the sample tree offers no tour, the help has no tour link', async ({ page }) => {
    await openApp(page, { tourOffer: true });
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
    await expect(page.locator('.toast')).toBeVisible();
    await expect(page.locator('.tour-offer')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('strom-tour-offered'))).toBeNull();
    await page.locator('.actions-menu-btn').click();
    await page.locator('#actions-help-row').click();
    await expect(page.locator('.help-index-link')).toBeVisible();
    await expect(page.locator('.help-tour-link')).toHaveCount(0);
    await expect(page.locator('#tour-overlay')).not.toHaveClass(/active/);
});

test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    test('390: no tour offer, no tour link under More → How Strom works', async ({ page }) => {
        await openApp(page, { tourOffer: true });
        await page.getByRole('button', { name: 'Try a sample tree' }).click();
        await expect(card(page, 'Johan')).toBeVisible();
        await expect(page.locator('.tour-offer')).toHaveCount(0);
        await page.locator('#bb-view-more').tap();
        await page.locator('#sheet-help').tap();
        await expect(page.locator('.help-modal')).toBeVisible();
        await expect(page.locator('.help-index-link')).toBeVisible();
        await expect(page.locator('.help-tour-link')).toHaveCount(0);
    });
});
