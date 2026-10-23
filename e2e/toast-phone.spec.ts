import { test, expect, Page, Locator } from '@playwright/test';
import { openApp } from './helpers.js';

/**
 * Message toasts on a phone (017 j): as wide as the phone allows (16px
 * gutters; held sideways, the room beside the side bar up to 420px), never
 * only the half right of their centre; a long sentence wraps; they cover
 * none of the floating buttons (back / forward, the zoom stack, the bar).
 * The desktop toast is as before.
 */

const LONG = 'Not sent. This copy of the tree does not have the research numbers for its people yet, so it would arrive there as a second family tree.';

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function sampleWithBack(page: Page): Promise<void> {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(page.locator('#toolbar-focus-name')).not.toHaveText('');
    await page.evaluate(() => {
        const S = window.Strom;
        const ids = Object.keys(S.DataManager.getData().persons);
        S.TreeRenderer.setFocus(ids[5] as never);
    });
    await expect(page.locator('#focus-back-btn')).toBeVisible();
}

/** A toast that stays, with an action and its ×, slid in. */
async function longToast(page: Page, text = LONG): Promise<Locator> {
    await page.evaluate((t) => window.Strom.UI.showToast(t, Infinity, { closable: true, action: { label: 'Load the version', run: () => undefined } }), text);
    const toast = page.locator('.toast.show');
    await expect(toast).toBeVisible();
    // Measured once it has slid in.
    await expect.poll(() => toast.evaluate(e => getComputedStyle(e).transform)).toMatch(/, 0\)$|^none$/);
    return toast;
}

/** None of the floating buttons and bars under the toast, nothing inside it wider than it. */
async function coversNothing(page: Page, toast: Locator): Promise<void> {
    const t = (await toast.boundingBox())!;
    for (const sel of ['#focus-back-btn', '#focus-forward-btn', '.zoom-controls button', '#bottom-bar']) {
        for (const el of await page.locator(sel).all()) {
            if (!await el.isVisible()) continue;
            const b = (await el.boundingBox())!;
            expect(overlaps(t, b), `${sel} under the toast`).toBe(false);
        }
    }
    expect(await toast.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
}

/** The action whole on one line under the sentence, the × beside the sentence. */
async function actionWhole(toast: Locator): Promise<void> {
    const a = (await toast.locator('.toast-action').boundingBox())!;
    const x = (await toast.locator('.toast-close').boundingBox())!;
    expect(a.height).toBeLessThan(30);
    expect(a.y).toBeGreaterThan(x.y + x.height);
}

test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('390: a long toast takes the width between 16px gutters, wraps, covers no button', async ({ page }) => {
        await sampleWithBack(page);
        const toast = await longToast(page);
        const t = (await toast.boundingBox())!;
        expect(Math.round(t.x)).toBe(16);
        expect(Math.round(t.width)).toBe(390 - 32);
        // Wrapped onto several lines (one line is about 20px).
        expect(t.height).toBeGreaterThan(60);
        await actionWhole(toast);
        await coversNothing(page, toast);
    });

    test('390: coming and going, the toast never slides across back / forward or the bar', async ({ page }) => {
        await sampleWithBack(page);
        // Every frame of its slide in and out, measured against the buttons under it.
        const crossed = await page.evaluate(async (t) => {
            const under = ['#focus-back-btn', '#focus-forward-btn', '#bottom-bar']
                .map(s => document.querySelector(s) as HTMLElement | null)
                .filter((e): e is HTMLElement => !!e && e.checkVisibility())
                .map(e => e.getBoundingClientRect());
            // Back and the bar at least (forward only once there is a way forward).
            if (under.length < 2) return [`${under.length} buttons shown`];
            const hits: string[] = [];
            const frames = async (ms: number): Promise<void> => {
                const end = performance.now() + ms;
                while (performance.now() < end) {
                    await new Promise(r => requestAnimationFrame(r));
                    const el = document.querySelector('.toast');
                    if (!el) continue;
                    const r = el.getBoundingClientRect();
                    for (const b of under) {
                        if (r.left < b.right && b.left < r.right && r.top < b.bottom && b.top < r.bottom) hits.push(`${Math.round(r.top)}–${Math.round(r.bottom)} over ${Math.round(b.top)}`);
                    }
                }
            };
            window.Strom.UI.showToast(t, 500);
            await frames(1200);
            return hits;
        }, LONG);
        expect(crossed).toEqual([]);
    });

    test('390: a short toast stays as wide as its text, centred', async ({ page }) => {
        await openApp(page);
        await page.evaluate(() => window.Strom.UI.showToast('Saved', 6000));
        const toast = page.locator('.toast.show');
        await expect(toast).toBeVisible();
        const t = (await toast.boundingBox())!;
        expect(t.width).toBeLessThan(150);
        expect(Math.abs(t.x + t.width / 2 - 195)).toBeLessThan(2);
    });
});

test.describe('phone held sideways', () => {
    test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

    test('844 × 390: the room beside the side bar up to 420px, covering no button', async ({ page }) => {
        await sampleWithBack(page);
        const toast = await longToast(page);
        const t = (await toast.boundingBox())!;
        expect(Math.round(t.width)).toBe(420);
        const bar = (await page.locator('#bottom-bar').boundingBox())!;
        expect(t.x).toBeGreaterThanOrEqual(bar.x + bar.width);
        expect(t.x + t.width).toBeLessThanOrEqual(844);
        await actionWhole(toast);
        await coversNothing(page, toast);
    });
});

test.describe('desktop', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('1440: the toast as before (at most the half right of its centre)', async ({ page }) => {
        await openApp(page);
        const toast = await longToast(page, LONG + ' ' + LONG);
        const t = (await toast.boundingBox())!;
        expect(t.width).toBeLessThanOrEqual(720);
        expect(Math.abs(t.x + t.width / 2 - 720)).toBeLessThan(2);
        expect(await toast.evaluate(e => getComputedStyle(e).paddingLeft)).toBe('24px');
    });
});
