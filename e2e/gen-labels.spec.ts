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

test('a card panned over a generation label fades it — cards take precedence', async ({ page }) => {
    // Mobile viewport: this is where a card scrolling into the left-edge label
    // zone actually overlapped the band name (the reported bug).
    await page.setViewportSize({ width: 390, height: 844 });
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(page.locator('.person-card').first()).toBeVisible();

    // Baseline: with nothing panned over them, labels are shown and not faded.
    const firstLabel = page.locator('#gen-labels .gen-label').first();
    await expect(firstLabel).toBeVisible();
    await expect(firstLabel).not.toHaveClass(/covered/);

    // Drive a card's centre to screen (40, viewport centre) via
    // centerOnWorldPoint — that forces the card over its own band's label,
    // which lives at the left edge.
    await page.evaluate(() => {
        const zp = window.Strom.ZoomPan;
        const rend = window.Strom.TreeRenderer;
        const c = rend.getCardWorldRects()[0];
        const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
        const scale = zp.getScale();
        const { width, height } = zp.getViewportSize();
        const Sx = 40, Sy = height / 2;
        zp.centerOnWorldPoint(cx - (Sx - width / 2) / scale, cy - (Sy - height / 2) / scale);
    });

    // Every label a card now overlaps must be faded (covered) — never printed
    // on top of the person.
    const res = await page.evaluate(() => {
        const labels = Array.from(document.querySelectorAll('#gen-labels .gen-label'))
            .filter(el => (el as HTMLElement).style.display !== 'none') as HTMLElement[];
        const cardRects = Array.from(document.querySelectorAll('.person-card'))
            .map(c => c.getBoundingClientRect());
        let overlaps = 0, coveredWrong = 0;
        for (const el of labels) {
            const r = el.getBoundingClientRect();
            const hit = cardRects.some(cr =>
                cr.left < r.right && cr.right > r.left && cr.top < r.bottom && cr.bottom > r.top);
            if (hit) { overlaps++; if (!el.classList.contains('covered')) coveredWrong++; }
        }
        return { overlaps, coveredWrong };
    });
    expect(res.overlaps).toBeGreaterThan(0);
    expect(res.coveredWrong).toBe(0);
});
