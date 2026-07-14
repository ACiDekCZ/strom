import { test, expect } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * Interactive tour: offered once after the demo loads, walks through a few
 * spotlighted steps, and can be dismissed with Escape. A second demo load no
 * longer offers it (localStorage flag). Mobile smoke checks the bubble fits.
 */
test('tour is offered, walks through steps, and Escape ends it', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();

    // The non-blocking offer appears; start the tour from it.
    const offer = page.locator('.tour-offer');
    await expect(offer).toBeVisible();
    await offer.locator('.tour-offer-btn').click();

    const overlay = page.locator('#tour-overlay');
    const bubble = page.locator('#tour-bubble');
    await expect(overlay).toHaveClass(/active/);
    await expect(bubble).toBeVisible();
    await expect(page.locator('#tour-step')).toHaveText(/^\d+\/\d+$/);

    // Advancing changes the bubble text.
    const firstText = await page.locator('#tour-text').textContent();
    await page.locator('#tour-next').click();
    await expect(page.locator('#tour-text')).not.toHaveText(firstText || '');

    // Finish the tour (click through until it closes).
    for (let i = 0; i < 6 && await overlay.isVisible(); i++) {
        await page.locator('#tour-next').click();
    }
    await expect(overlay).toBeHidden();

    // Re-open from the About dialog and end it with Escape.
    await page.evaluate(() => window.Strom.UI.showAboutDialog());
    await page.getByRole('button', { name: 'Take a tour' }).click();
    await expect(overlay).toHaveClass(/active/);
    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();

    // A second demo load does not offer the tour again (flag persisted).
    await page.reload();
    await expect(page.locator('.toolbar')).toBeVisible();
    // Load the demo via a new tree; the offer must stay away.
    await page.evaluate(() => window.Strom.UI.loadDemoTree());
    await page.waitForTimeout(300);
    await expect(page.locator('.tour-offer')).toHaveCount(0);
});

test('mobile: the tour bubble fits within the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 780 });
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(page.locator('.tour-offer')).toBeVisible();
    await page.locator('.tour-offer-btn').click();

    const bubble = page.locator('#tour-bubble');
    await expect(bubble).toBeVisible();
    const box = await bubble.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(400);
});
