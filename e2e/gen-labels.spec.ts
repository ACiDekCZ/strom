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

test('no left-fade veil: the focus card at the left edge keeps full opacity', async ({ page }) => {
    // Reproduces the reported bug: on a phone the descendants chart's focus card
    // (top generation, pinned near the left margin) looked washed out because an
    // opaque gen-labels left-fade gradient (.gen-labels::before) painted over it.
    // That veil is gone — readability is handled by hiding covered labels — so
    // the focus card must render at full opacity with no overlay above it.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/strom.html');
    await expect(page.locator('.toolbar')).toBeVisible();
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(page.locator('.person-card').first()).toBeVisible();

    // Focus the first root person and enter the descendants view (mobile tab).
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const root = dm.getAllPersons()[0];
        window.Strom.TreeRenderer.setFocus(root.id);
    });
    await page.locator('#bb-view-descendants').click();
    await expect(page.locator('#descendants-badge')).toBeVisible();

    const focus = page.locator('.person-card.focused');
    await expect(focus).toBeVisible();

    // The focus card itself carries no translucency.
    await expect(focus).toHaveCSS('opacity', '1');

    // The gen-labels overlay generates no ::before veil at all.
    const veilContent = await page.evaluate(() => {
        const overlay = document.getElementById('gen-labels')!;
        return getComputedStyle(overlay, '::before').content;
    });
    expect(veilContent).toBe('none');

    // No hit-testable overlay sits above the focus card's centre — the point
    // resolves to the card (or one of its children), never a covering layer.
    const onCard = await page.evaluate(() => {
        const f = document.querySelector('.person-card.focused') as HTMLElement;
        const r = f.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!el && (el === f || f.contains(el));
    });
    expect(onCard).toBe(true);
});
