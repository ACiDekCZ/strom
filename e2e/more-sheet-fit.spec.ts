import { test, expect, Page } from '@playwright/test';
import { openApp } from './helpers.js';

/**
 * T52: on a phone the tiles of More (Undo | Redo, View: Fan | Map,
 * Settings | How Strom works | About) keep their names inside: a long name
 * (de, pl) wraps inside its tile instead of running out of it, and no two
 * tiles of a row overlap.
 */

interface TileBox { text: string; btnClient: number; btnScroll: number; labelClient: number; labelScroll: number;
    left: number; right: number; labelLeft: number; labelRight: number; top: number; bottom: number; row: number }

async function tiles(page: Page): Promise<TileBox[]> {
    return page.evaluate(() => {
        const rows = [...document.querySelectorAll('.bottom-sheet-more .bottom-sheet-pair')];
        return rows.flatMap((row, i) => [...row.querySelectorAll<HTMLElement>('.bottom-sheet-item')].map((btn) => {
            const label = btn.querySelector<HTMLElement>('.bottom-sheet-label')!;
            const b = btn.getBoundingClientRect();
            const l = label.getBoundingClientRect();
            return { text: label.textContent ?? '', btnClient: btn.clientWidth, btnScroll: btn.scrollWidth,
                labelClient: label.clientWidth, labelScroll: label.scrollWidth,
                left: b.left, right: b.right, labelLeft: l.left, labelRight: l.right, top: b.top, bottom: b.bottom, row: i };
        }));
    });
}

for (const width of [360, 390]) {
    test.describe(`More on a ${width}px phone`, () => {
        test.use({ viewport: { width, height: 800 }, hasTouch: true, isMobile: true });

        for (const lang of ['cs', 'de', 'pl']) {
            test(`${lang}: every tile keeps its name inside, the tiles of a row do not overlap`, async ({ page }) => {
                await openApp(page);
                await page.getByRole('button', { name: 'Try a sample tree' }).click();
                await expect(page.locator('.person-card').first()).toBeVisible();
                await page.evaluate((l) => (window as unknown as { Strom: { UI: { setLanguage(l: string): void } } }).Strom.UI.setLanguage(l), lang);
                await page.locator('#bb-view-more').tap();
                await expect(page.locator('#sheet-help')).toBeVisible();
                await expect(page.locator('.bottom-sheet-overlay')).toHaveClass(/active/);
                const boxes = await tiles(page);
                // Undo | Redo, Fan | Map, Settings | How Strom works | About.
                expect(boxes.length).toBe(7);
                for (const t of boxes) {
                    expect(t.btnScroll, `${t.text}: tile overflows`).toBeLessThanOrEqual(t.btnClient);
                    expect(t.labelScroll, `${t.text}: name overflows`).toBeLessThanOrEqual(t.labelClient);
                    expect(t.labelLeft, `${t.text}: name starts outside its tile`).toBeGreaterThanOrEqual(t.left - 0.5);
                    expect(t.labelRight, `${t.text}: name ends outside its tile`).toBeLessThanOrEqual(t.right + 0.5);
                    expect(t.left).toBeGreaterThanOrEqual(0);
                    expect(t.right).toBeLessThanOrEqual(width);
                }
                for (let i = 1; i < boxes.length; i++) {
                    const [a, b] = [boxes[i - 1], boxes[i]];
                    if (a.row === b.row) expect(b.left, `${a.text} | ${b.text} overlap`).toBeGreaterThanOrEqual(a.right);
                }
                const docWidth = await page.evaluate(() => document.documentElement.scrollWidth);
                expect(docWidth).toBeLessThanOrEqual(width);
            });
        }
    });
}
