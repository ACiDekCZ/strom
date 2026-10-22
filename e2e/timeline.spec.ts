import { test, expect } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * Timeline view: a third display mode showing people as life-bars on a year
 * axis. Switching in shows the bars; switching back restores the family tree.
 */
test('timeline view: life-bars from the gender tokens, no zoom controls, the wheel scrolls it (no tree zoom), a bar refocuses, back to the family tree', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
    await expect(page.locator('.zoom-controls')).toBeVisible();

    // Switch to the timeline segment.
    await page.locator('#view-mode-timeline').click();
    const container = page.locator('#timeline-container');
    await expect(container).toBeVisible();
    await expect(page.locator('.timeline-bar').first()).toBeVisible();
    expect(await page.locator('.timeline-bar').count()).toBeGreaterThan(3);
    await expect(page.locator('.tl-name', { hasText: 'Johan' })).toBeVisible();
    // The family canvas is hidden while the timeline is up.
    await expect(page.locator('#tree-canvas')).toBeHidden();
    // The timeline scrolls natively: no floating zoom controls.
    await expect(page.locator('.zoom-controls')).toBeHidden();

    // The on-screen bars carry the CSS token in their fill attribute — so they
    // follow the theme — and never the retired pastel hexes.
    const fills = await page.locator('.tl-bar-rect').evaluateAll(
        els => els.map(el => el.getAttribute('fill')));
    expect(fills.length).toBeGreaterThan(0);
    for (const f of fills) {
        expect(f === 'var(--male)' || f === 'var(--female)').toBeTruthy();
    }
    // Bars resolve to a non-empty colour.
    const resolved = await page.locator('.tl-bar-rect').first().evaluate(
        el => getComputedStyle(el).fill);
    expect(resolved).not.toBe('');

    // The mouse wheel over the timeline must NOT be hijacked by the canvas zoom.
    const before = await page.evaluate(() => window.Strom.ZoomPan.getScale());
    await container.hover();
    await page.mouse.wheel(0, 240);
    const after = await page.evaluate(() => window.Strom.ZoomPan.getScale());
    expect(after).toBe(before);

    // Clicking a bar re-focuses that person (still in timeline).
    await page.locator('.timeline-bar', { hasText: 'Hanna' }).click();
    await expect(container).toBeVisible();

    // Back to the family view: cards and zoom controls return, timeline hidden.
    await page.locator('#view-mode-family').click();
    await expect(container).toBeHidden();
    await expect(card(page, 'Johan')).toBeVisible();
    await expect(page.locator('.zoom-controls')).toBeVisible();
});
