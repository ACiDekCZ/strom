import { test, expect } from '@playwright/test';
import { openApp, card, createFirstPerson } from './helpers.js';

/**
 * Timeline view: a third display mode showing people as life-bars on a year
 * axis. Switching in shows the bars; switching back restores the family tree.
 */
test('timeline view shows life-bars and switches back to the family tree', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();

    // Switch to the timeline segment.
    await page.locator('#view-mode-timeline').click();
    const container = page.locator('#timeline-container');
    await expect(container).toBeVisible();
    await expect(page.locator('.timeline-bar').first()).toBeVisible();
    expect(await page.locator('.timeline-bar').count()).toBeGreaterThan(3);
    await expect(page.locator('.tl-name', { hasText: 'Henry VIII' })).toBeVisible();
    // The family canvas is hidden while the timeline is up.
    await expect(page.locator('#tree-canvas')).toBeHidden();

    // Clicking a bar re-focuses that person (still in timeline).
    await page.locator('.timeline-bar', { hasText: 'Elizabeth I' }).click();
    await expect(container).toBeVisible();

    // Back to the family view: cards return, timeline hidden.
    await page.locator('#view-mode-family').click();
    await expect(container).toBeHidden();
    await expect(card(page, 'Henry VIII')).toBeVisible();
});

test('timeline life-bars fill from the gender tokens (--male / --female), not old pastels', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await page.locator('#view-mode-timeline').click();
    await expect(page.locator('.timeline-bar').first()).toBeVisible();

    // The on-screen bars carry the CSS token in their fill attribute — so they
    // follow the theme — and never the retired pastel hexes.
    const fills = await page.locator('.tl-bar-rect').evaluateAll(
        els => els.map(el => el.getAttribute('fill')));
    expect(fills.length).toBeGreaterThan(0);
    for (const f of fills) {
        expect(f === 'var(--male)' || f === 'var(--female)').toBeTruthy();
    }

    // Bars resolve to a non-empty, non-transparent colour in both themes.
    const resolved = await page.locator('.tl-bar-rect').first().evaluate(
        el => getComputedStyle(el).fill);
    expect(resolved).not.toBe('');
});

test('timeline hides the floating zoom controls (it scrolls natively)', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1950' });
    await expect(page.locator('.zoom-controls')).toBeVisible();

    await page.locator('#view-mode-timeline').click();
    await expect(page.locator('.zoom-controls')).toBeHidden();

    await page.locator('#view-mode-family').click();
    await expect(page.locator('.zoom-controls')).toBeVisible();
});

test('mouse wheel over the timeline scrolls it instead of zooming the tree', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await page.locator('#view-mode-timeline').click();
    await expect(page.locator('#timeline-container')).toBeVisible();

    const before = await page.evaluate(() => window.Strom.ZoomPan.getScale());
    await page.locator('#timeline-container').hover();
    await page.mouse.wheel(0, 240);
    // The wheel must NOT be hijacked by the canvas zoom.
    const after = await page.evaluate(() => window.Strom.ZoomPan.getScale());
    expect(after).toBe(before);
});
