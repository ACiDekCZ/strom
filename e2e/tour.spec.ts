import { test, expect } from '@playwright/test';
import { openApp, card } from './helpers.js';
import { getStringsForLang } from '../src/strings';

/**
 * Interactive tour: offered once after the demo loads, walks through a few
 * spotlighted steps, and can be dismissed with Escape. A second demo load no
 * longer offers it (localStorage flag). Mobile smoke checks the bubble fits.
 */
test('tour is offered, walks through steps, and Escape ends it', async ({ page }) => {
    await openApp(page, { tourOffer: true });
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();

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

    // Re-open from the contents of How Strom works and end it with Escape.
    await page.locator('.actions-menu-btn').click();
    await page.locator('#actions-help-row').click();
    await page.locator('.help-tour-link').click();
    await expect(page.locator('.help-overlay')).toHaveCount(0);
    await expect(overlay).toHaveClass(/active/);
    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();

    // A second demo load does not offer the tour again (flag persisted).
    await page.reload();
    await expect(page.locator('.toolbar')).toBeVisible();
    // Load the demo via a new tree; the offer must stay away.
    // (loadDemoTree resolves after it has offered the tour, or not.)
    await page.evaluate(() => window.Strom.UI.loadDemoTree());
    await expect(card(page, 'Johan')).toBeVisible();
    await expect(page.locator('.tour-offer')).toHaveCount(0);
});

test('mobile: the offer clears the bottom bar, the tour bubble fits within the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 780 });
    await openApp(page, { tourOffer: true });
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(page.locator('.tour-offer')).toBeVisible();
    // The offer stays up for 15 s: it must sit above the bottom bar, not over
    // its tabs (it used to block them for exactly that long).
    const bar = await page.locator('.bottom-bar').boundingBox();
    await expect.poll(async () => {
        const offer = await page.locator('.tour-offer').boundingBox();
        return offer ? offer.y + offer.height : Infinity;
    }).toBeLessThanOrEqual(bar!.y);
    await page.locator('.tour-offer-btn').click();

    const bubble = page.locator('#tour-bubble');
    await expect(bubble).toBeVisible();
    const box = await bubble.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(400);
});

test('tour reveals the hover-only card buttons during the card-buttons step', async ({ page }) => {
    await openApp(page, { tourOffer: true });
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

/**
 * Geometry of the current step: spotlight hole, bubble and viewport, read once
 * the hole and the bubble have glided to the new target (their CSS transitions
 * are over and both boxes read the same across two frames).
 */
async function tourGeometry(page: import('@playwright/test').Page) {
    return page.evaluate(async () => {
        const frame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
        const moving = ['tour-hole', 'tour-bubble'].map((id) => document.getElementById(id)!);
        const where = () => moving.map((el) => JSON.stringify(el.getBoundingClientRect())).join();
        for (let i = 0; i < 60; i++) {
            const before = where();
            await Promise.all(moving.flatMap((el) => el.getAnimations().map((a) => a.finished.catch(() => undefined))));
            await frame();
            await frame();
            if (where() === before && moving.every((el) => el.getAnimations().length === 0)) break;
        }
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

// The last step's target: the Actions menu on desktop, More on the phone.
const LAST_TARGET: Record<number, string> = { 1440: '.actions-menu-btn', 390: '#bb-view-more' };

for (const [w, h] of [[1440, 900], [1024, 768], [550, 900], [390, 844]] as const) {
    test(`every step at ${w}px spotlights a real target and the bubble never covers it; the last one points at anniversaries, export and settings`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        await openApp(page, { tourOffer: true });
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
            if (i === total - 1) {
                await expect(page.locator('#tour-text')).toHaveText(/^Anniversaries, export, things for the family, settings and How Strom works are here\./);
                // The spotlight sits on the menu that holds them (not on the tree switcher).
                const target = LAST_TARGET[w];
                if (target) {
                    await expect.poll(() => page.evaluate((sel) => {
                        const hole = document.getElementById('tour-hole')!.getBoundingClientRect();
                        const t = document.querySelector(sel)!.getBoundingClientRect();
                        return hole.left <= t.left && hole.right >= t.right && hole.top <= t.top && hole.bottom >= t.bottom;
                    }, target)).toBe(true);
                }
            }
            await page.locator('#tour-next').click();
        }
        await expect(overlay).toBeHidden();
    });
}

test('the spotlight follows its card when the canvas is panned or zoomed', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 850 });
    await openApp(page, { tourOffer: true });
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

/**
 * The tour starts from the contents of How Strom works (no longer from About):
 * the help closes with its history, and every step shows its own text at a
 * visible target of that step (none is skipped for a missing element).
 */
const STEP_TARGETS: Record<string, string[]> = {
    step1: ['.person-card.focused', '.person-card'],
    step2: ['.person-card.focused', '.person-card'],
    step3: ['.toolbar-buttons button', '.bottom-bar-fab'],
    step4: ['#focus-controls', '.toolbar .toolbar-focus'],
    step5: ['#view-mode-segment', '.bottom-bar'],
    step5Bar: ['#view-mode-segment', '.bottom-bar'],
    step6: ['.zoom-controls'],
    step6Touch: ['.zoom-controls'],
    step7: ['#toolbar-search-picker', '#search-open-btn'],
    step8: ['.actions-menu-btn', '.bottom-bar-more'],
};

async function walkTourFromHelp(page: import('@playwright/test').Page, keys: string[]): Promise<void> {
    const overlay = page.locator('#tour-overlay');
    await expect(overlay).toHaveClass(/active/);
    const texts = getStringsForLang('en').tour as unknown as Record<string, string>;
    await expect(page.locator('#tour-step')).toHaveText(`1/${keys.length}`);
    for (let i = 0; i < keys.length; i++) {
        await expect(page.locator('#tour-step')).toHaveText(`${i + 1}/${keys.length}`);
        await expect(page.locator('#tour-text')).toHaveText(texts[keys[i]]);
        await tourGeometry(page);
        // The spotlight holds a visible element of this step.
        await expect.poll(() => page.evaluate((sels) => {
            const hole = document.getElementById('tour-hole')!.getBoundingClientRect();
            return sels.some((sel) => Array.from(document.querySelectorAll(sel)).some((el) => {
                const r = el.getBoundingClientRect();
                return r.width >= 24 && Math.abs(r.left - hole.left) <= 20 && Math.abs(r.right - hole.right) <= 20
                    && Math.abs(r.top - hole.top) <= 20 && Math.abs(r.bottom - hole.bottom) <= 20;
            }));
        }, STEP_TARGETS[keys[i]]), keys[i]).toBe(true);
        await page.locator('#tour-next').click();
    }
    await expect(overlay).toBeHidden();
}

test.describe('the tour from How Strom works, computer', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the contents offer the app tour next to the glossary; it closes the help and shows all eight steps', async ({ page }) => {
        await openApp(page);
        await page.getByRole('button', { name: 'Try a sample tree' }).click();
        await expect(card(page, 'Johan')).toBeVisible();
        // About no longer starts it: Close is its only button.
        await page.locator('.app-logo').click();
        await expect(page.locator('#about-modal .about-footer button')).toHaveText(['Close']);
        await page.keyboard.press('Escape');
        await expect(page.locator('#about-modal')).not.toHaveClass(/active/);

        await page.locator('.actions-menu-btn').click();
        await page.locator('#actions-help-row').click();
        const link = page.locator('.help-home-info .help-tour-link');
        await expect(link).toHaveText('App tour');
        // Right after the glossary link, the same kind of link.
        expect(await page.locator('.help-home-info > *').evaluateAll((els) => els.map((el) => el.className)))
            .toEqual(['help-linkbtn help-index-link', 'help-linkbtn help-tour-link', 'help-docver']);
        await link.click();
        await expect(page.locator('.help-overlay')).toHaveCount(0);
        // The help's history entry is gone with it.
        await expect.poll(() => page.evaluate(() => (history.state as { stromHelp?: number } | null)?.stromHelp ?? 0)).toBe(0);
        await walkTourFromHelp(page, ['step1', 'step2', 'step3', 'step4', 'step5', 'step6', 'step7', 'step8']);
    });

    test('over another window the help does not offer the tour', async ({ page }) => {
        await openApp(page);
        await page.evaluate(() => { window.Strom.UI.showSettingsDialog(); window.Strom.UI.showHelp(); });
        await expect(page.locator('.help-home')).toBeVisible();
        await expect(page.locator('.help-index-link')).toBeVisible();
        await expect(page.locator('.help-tour-link')).toHaveCount(0);
    });
});

test.describe('the tour from How Strom works, phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('More → How Strom works → App tour: every step but the hover-only card buttons, each at its target', async ({ page }) => {
        await openApp(page);
        await page.getByRole('button', { name: 'Try a sample tree' }).click();
        await expect(card(page, 'Johan')).toBeVisible();
        await page.locator('#bb-view-more').tap();
        await page.locator('#sheet-help').tap();
        await expect(page.locator('.help-modal')).toBeVisible();
        const link = page.locator('.help-tour-link');
        const box = (await link.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        await link.tap();
        await expect(page.locator('.help-overlay')).toHaveCount(0);
        // Touch has no hover: the quick-add step is left out by design; the
        // bottom bar holds only some of the views (its own wording).
        await walkTourFromHelp(page, ['step1', 'step3', 'step4', 'step5Bar', 'step6Touch', 'step7', 'step8']);
    });
});
