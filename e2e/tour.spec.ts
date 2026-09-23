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
    for (let i = 0; i < 12 && await overlay.isVisible(); i++) {
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

test('tour reveals the hover-only card buttons during the card-buttons step', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await page.locator('.tour-offer .tour-offer-btn').click();
    await expect(page.locator('#tour-overlay')).toHaveClass(/active/);

    // Step 2 spotlights the card and force-shows its + buttons.
    await page.locator('#tour-next').click();
    const revealed = page.locator('.person-card.tour-reveal');
    await expect(revealed).toHaveCount(1);
    await expect(revealed.locator('.add-btn.right')).toBeVisible();

    // Moving on hides them again.
    await page.locator('#tour-next').click();
    await expect(page.locator('.person-card.tour-reveal')).toHaveCount(0);
});

/** Geometry of the current step: spotlight hole, bubble and viewport. */
async function tourGeometry(page: import('@playwright/test').Page) {
    return page.evaluate(() => {
        const box = (id: string) => {
            const r = document.getElementById(id)!.getBoundingClientRect();
            return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
        };
        return {
            step: document.getElementById('tour-step')!.textContent ?? '',
            hole: box('tour-hole'),
            bubble: box('tour-bubble'),
            vw: window.innerWidth,
            vh: window.innerHeight,
        };
    });
}

for (const [w, h] of [[1440, 900], [1024, 768], [550, 900], [390, 844]] as const) {
    test(`every step at ${w}px spotlights a real target and the bubble never covers it`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        await openApp(page);
        await page.getByRole('button', { name: 'Try a sample tree' }).click();
        await page.locator('.tour-offer .tour-offer-btn').click();
        const overlay = page.locator('#tour-overlay');
        await expect(overlay).toHaveClass(/active/);

        // The focus panel, view switching and zoom steps exist at every width
        // (fixed-position targets such as the bottom bar used to be skipped).
        const total = Number((await page.locator('#tour-step').textContent())!.split('/')[1]);
        expect(total).toBe(8);

        for (let i = 0; i < total; i++) {
            await expect(page.locator('#tour-step')).toHaveText(`${i + 1}/${total}`);
            // Let the hole glide to the new target.
            await page.waitForTimeout(300);
            const g = await tourGeometry(page);
            expect(g.hole.width, g.step).toBeGreaterThanOrEqual(24);
            expect(g.hole.height, g.step).toBeGreaterThanOrEqual(12);
            expect(g.bubble.left, g.step).toBeGreaterThanOrEqual(0);
            expect(g.bubble.right, g.step).toBeLessThanOrEqual(g.vw);
            expect(g.bubble.top, g.step).toBeGreaterThanOrEqual(0);
            expect(g.bubble.bottom, g.step).toBeLessThanOrEqual(g.vh);
            const overlaps = g.bubble.left < g.hole.right && g.bubble.right > g.hole.left
                && g.bubble.top < g.hole.bottom && g.bubble.bottom > g.hole.top;
            expect(overlaps, `bubble covers the spotlight at ${g.step}`).toBe(false);
            await page.locator('#tour-next').click();
        }
        await expect(overlay).toBeHidden();
    });
}

test('the spotlight follows its card when the canvas is panned or zoomed', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 850 });
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await page.locator('.tour-offer .tour-offer-btn').click();
    await expect(page.locator('#tour-overlay')).toHaveClass(/active/);

    const offset = () => page.evaluate(() => {
        const h = document.getElementById('tour-hole')!.getBoundingClientRect();
        const c = document.querySelector('.person-card.focused')!.getBoundingClientRect();
        return Math.round(Math.abs(h.left + 6 - c.left) + Math.abs(h.top + 6 - c.top));
    });
    await expect.poll(offset).toBe(0);

    await page.mouse.move(300, 500);
    await page.mouse.down();
    await page.mouse.move(420, 560, { steps: 8 });
    await page.mouse.up();
    await expect.poll(offset).toBe(0);

    await page.mouse.wheel(0, -300);
    await expect.poll(offset).toBe(0);
});
