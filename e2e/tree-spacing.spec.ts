import { test, expect, Page } from '@playwright/test';
import { openApp, card, seedSetting } from './helpers.js';

/**
 * Spacing of the tree view (Settings → Spacing, spec 069): the dense
 * spacing lays the same cards out with gaps 20 / 48 / 14 and marks the
 * canvas for its styles; the normal spacing keeps 31 / 80 / 18. Invented
 * data (the sample tree).
 */
async function sampleTree(page: Page): Promise<void> {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
}

/** The layout's gaps and the smallest gap between two rows of cards laid out (layout px). */
const gaps = (page: Page) => page.evaluate(() => {
    const r = window.Strom.TreeRenderer as unknown as {
        config: { horizontalGap: number; verticalGap: number; partnerGap: number };
        positions: Map<string, { x: number; y: number }>;
        cardHeightOf(id: string): number;
    };
    const c = r.config;
    const rows = new Map<number, number>();  // row top -> lowest card bottom
    for (const [id, pos] of r.positions) rows.set(pos.y, Math.max(rows.get(pos.y) ?? -Infinity, pos.y + r.cardHeightOf(id)));
    const tops = [...rows.keys()].sort((a, b) => a - b);
    let rowGap = Infinity;
    for (let i = 1; i < tops.length; i++) rowGap = Math.min(rowGap, tops[i] - rows.get(tops[i - 1])!);
    return {
        config: [c.horizontalGap, c.verticalGap, c.partnerGap],
        rows: tops.length,
        rowGap: Math.round(rowGap),
        dense: document.getElementById('tree-canvas')!.classList.contains('tree-dense'),
    };
});

test('dense spacing: tighter gaps between the cards and the rows', async ({ page }) => {
    await seedSetting(page, 'treeSpacing', 'dense');
    await sampleTree(page);
    const g = await gaps(page);
    expect(g.config).toEqual([20, 48, 14]);
    expect(g.rows).toBeGreaterThan(1);
    expect(g.rowGap).toBe(48);
    expect(g.dense).toBe(true);
});

test('normal spacing: the gaps as before, no dense mark', async ({ page }) => {
    await sampleTree(page);
    const g = await gaps(page);
    expect(g.config).toEqual([31, 80, 18]);
    expect(g.rows).toBeGreaterThan(1);
    expect(g.rowGap).toBe(80);
    expect(g.dense).toBe(false);
});
