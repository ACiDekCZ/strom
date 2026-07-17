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

    /**
     * Regression guard: the minimap must stay docked in its bottom-right control
     * block wherever it is shown, and disappear together with that block when a
     * narrow regime dissolves it (CSS `display: contents` ≤600px). It previously
     * escaped to the top-left of the page — landing on top of the focus chip and
     * the generation arrows — in the 501–600px window, because the panel was
     * only hidden at ≤500px while the block dissolved at ≤600px.
     */
    test('stays docked in the control block and is never orphaned at the top-left', async ({ page }) => {
        await page.setViewportSize({ width: 1200, height: 850 });
        await openApp(page);
        await page.getByRole('button', { name: 'Try a sample tree' }).click();
        await expect(card(page, 'Henry VIII')).toBeVisible();
        for (let i = 0; i < 6; i++) await page.evaluate(() => window.Strom.ZoomPan.zoomIn());

        for (const w of [1200, 900, 700, 620, 601, 600, 560, 520, 500]) {
            await page.setViewportSize({ width: w, height: 850 });
            await page.waitForTimeout(120);
            const s = await page.evaluate(() => {
                const box = (el: Element | null) => {
                    if (!el) return null;
                    const r = el.getBoundingClientRect();
                    return { x: r.x, y: r.y, right: r.right, w: r.width, h: r.height };
                };
                const panel = document.getElementById('minimap-panel');
                const cb = document.querySelector('.control-block');
                const chip = document.querySelector('.focus-controls');
                const visible = !!panel && getComputedStyle(panel).display !== 'none'
                    && panel.getBoundingClientRect().width > 0;
                const cbDissolved = !!cb && getComputedStyle(cb).display === 'contents';
                const pr = box(panel), cbr = box(cb);
                const chipShown = !!chip && getComputedStyle(chip).display !== 'none';
                const chipr = chipShown ? box(chip) : null;
                let insideBlock = true, overlapsChip = false;
                if (visible && pr) {
                    if (cbr && !cbDissolved) {
                        insideBlock = pr.x >= cbr.x - 2 && pr.right <= cbr.right + 2 && pr.y >= cbr.y - 2;
                    }
                    if (chipr) {
                        overlapsChip = !(pr.right < chipr.x || pr.x > chipr.right
                            || pr.y + pr.h < chipr.y || pr.y > chipr.y + chipr.h);
                    }
                }
                return { visible, cbDissolved, insideBlock, overlapsChip };
            });
            const at = `@${w}px`;
            if (s.cbDissolved) {
                // No docked home here — the minimap must be hidden, not floating.
                expect(s.visible, `${at}: minimap is hidden when the control block dissolves`).toBe(false);
            } else if (s.visible) {
                expect(s.insideBlock, `${at}: minimap sits inside its control block`).toBe(true);
                expect(s.overlapsChip, `${at}: minimap never covers the focus chip`).toBe(false);
            }
        }
    });
});
