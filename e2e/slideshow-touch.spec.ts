import { test, expect, Page } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * The slideshow without a hover (mobile review 5a, point 5): on touch its
 * controls are fully visible 44 px targets, on a phone and a tablet they sit
 * at the top right clear of the caption, the keyboard hint is left out, and a
 * tap on ›, ‹, pause and ✕ works.
 */

type Box = { x: number; y: number; width: number; height: number };
const apart = (a: Box, b: Box) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;

async function start(page: Page): Promise<void> {
    await page.clock.install();
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
    await page.evaluate(() => window.Strom.UI.startSlideshow());
    await expect(page.locator('body')).toHaveClass(/slideshow-mode/);
    await expect(page.locator('#slideshow-caption .slideshow-name')).toBeVisible();
}

async function checkControls(page: Page): Promise<void> {
    const controls = page.locator('.slideshow-controls');
    await expect(controls).toBeVisible();
    expect(Number(await controls.evaluate((el) => getComputedStyle(el).opacity))).toBe(1);
    await expect(page.locator('.slideshow-hint')).toBeHidden();
    const caption = (await page.locator('#slideshow-caption').boundingBox())!;
    const vw = page.viewportSize()!.width;
    for (const b of await controls.locator('button').all()) {
        const r = (await b.boundingBox())!;
        expect(r.width).toBeGreaterThanOrEqual(44);
        expect(r.height).toBeGreaterThanOrEqual(44);
        expect(r.x + r.width).toBeLessThanOrEqual(vw);
        expect(apart(r, caption)).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test.describe('slideshow on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the controls are visible 44 px targets above the caption, without the keyboard hint; taps move, pause and exit', async ({ page }) => {
        await start(page);
        await checkControls(page);
        const name = page.locator('#slideshow-caption .slideshow-name');
        const first = await name.textContent();
        await page.getByRole('button', { name: 'Next' }).tap();
        await expect.poll(() => name.textContent()).not.toBe(first);
        await page.getByRole('button', { name: 'Previous' }).tap();
        await expect.poll(() => name.textContent()).toBe(first);
        await page.locator('#slideshow-pause').tap();
        await expect(page.locator('body')).toHaveClass(/slideshow-paused/);
        await page.getByRole('button', { name: 'Exit slideshow' }).tap();
        await expect(page.locator('body')).not.toHaveClass(/slideshow-mode/);
    });
});

test.describe('slideshow on a phone held sideways', () => {
    test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

    test('the controls stay clear of the caption', async ({ page }) => {
        await start(page);
        await checkControls(page);
    });
});

test.describe('slideshow on a touch tablet', () => {
    test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true });

    test('the controls are visible 44 px targets clear of the caption', async ({ page }) => {
        await start(page);
        await checkControls(page);
    });
});

test.describe('slideshow with a mouse', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the controls stay faint at the bottom right until hovered, the keyboard hint is shown', async ({ page }) => {
        await start(page);
        const controls = page.locator('.slideshow-controls');
        expect(Number(await controls.evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(0.5);
        await expect(page.locator('.slideshow-hint')).toBeVisible();
        const r = (await controls.boundingBox())!;
        expect(r.y).toBeGreaterThan(900 / 2);
        await controls.locator('button').first().hover();
        await expect.poll(() => controls.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    });
});
