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

/** A card's centre on the screen (viewport px), by person id. */
const centerOf = (page: Page, id: string) => page.evaluate((pid) => {
    const r = document.querySelector(`#tree-canvas .person-card[data-id="${CSS.escape(pid)}"]`)!.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, id);

const focusId = (page: Page) => page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId()!);

/** Whether the card lies wholly in the tree's view. */
const wholeInView = (page: Page, id: string) => page.evaluate((pid) => {
    const v = document.getElementById('tree-container')!.getBoundingClientRect();
    const r = document.querySelector(`#tree-canvas .person-card[data-id="${CSS.escape(pid)}"]`)!.getBoundingClientRect();
    return r.left >= v.left && r.top >= v.top && r.right <= v.right && r.bottom <= v.bottom;
}, id);

/** The card whose centre is nearest the centre of the tree's view. */
const nearestToMiddle = (page: Page) => page.evaluate(() => {
    const v = document.getElementById('tree-container')!.getBoundingClientRect();
    const cx = v.left + v.width / 2, cy = v.top + v.height / 2;
    let best = '', bestD = Infinity;
    document.querySelectorAll<HTMLElement>('#tree-canvas .person-card[data-id]').forEach(el => {
        const r = el.getBoundingClientRect();
        const d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
        if (d < bestD) { bestD = d; best = el.dataset.id!; }
    });
    return best;
});

async function chooseSpacing(page: Page, spacing: 'normal' | 'dense'): Promise<void> {
    await page.locator(`#tree-spacing-setting input[value="${spacing}"]`).check();
    await expect(page.locator('#tree-canvas')).toHaveClass(spacing === 'dense' ? /tree-dense/ : /^(?!.*tree-dense)/);
    // The drawing runs async: wait until the layout has the chosen gaps.
    await expect.poll(() => gaps(page).then(g => g.config[0])).toBe(spacing === 'dense' ? 20 : 31);
}

test.describe('the view keeps its place when the spacing changes (D3)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the focus wholly in view stays where it stood (±1 px), the dialog stays open', async ({ page }) => {
        await sampleTree(page);
        const id = await focusId(page);
        expect(await wholeInView(page, id)).toBe(true);
        const before = await centerOf(page, id);
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        await chooseSpacing(page, 'dense');
        await expect(page.locator('#settings-modal')).toBeVisible();
        const dense = await centerOf(page, id);
        expect(Math.abs(dense.x - before.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(dense.y - before.y)).toBeLessThanOrEqual(1);
        // The card type changes the cards' size: the focus's centre stays too.
        const cardHeight = () => page.evaluate((pid) =>
            (document.querySelector(`#tree-canvas .person-card[data-id="${CSS.escape(pid)}"]`) as HTMLElement).offsetHeight, id);
        const normalHeight = await cardHeight();
        await page.evaluate(() => window.Strom.UI.setCardDensity('compact'));
        await expect.poll(cardHeight).toBeLessThan(normalHeight);
        const compact = await centerOf(page, id);
        expect(Math.abs(compact.x - before.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(compact.y - before.y)).toBeLessThanOrEqual(1);
    });

    test('the focus out of view: the card nearest the middle of the view stays where it stood', async ({ page }) => {
        await sampleTree(page);
        const focus = await focusId(page);
        // Pan the view until the focus card is out of it.
        const box = (await page.locator('#tree-container').boundingBox())!;
        await page.evaluate((dx) => window.Strom.ZoomPan.shiftWorld(dx, 0), Math.round(box.width / 2));
        expect(await wholeInView(page, focus)).toBe(false);
        const anchor = await nearestToMiddle(page);
        expect(anchor).not.toBe(focus);
        const before = await centerOf(page, anchor);
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        await chooseSpacing(page, 'dense');
        const after = await centerOf(page, anchor);
        expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    });

    test('Normal again: the tree is drawn exactly as before, pixel for pixel', async ({ page }) => {
        await sampleTree(page);
        const tree = page.locator('#tree-container');
        const layout = () => page.evaluate(() => {
            const r = window.Strom.TreeRenderer as unknown as { positions: Map<string, { x: number; y: number }> };
            return { positions: [...r.positions].sort(), transform: window.Strom.ZoomPan.getTransform() };
        });
        const before = await layout();
        // Toasts come and go on their own, the focus bar above the tree is no part of it: left out of the picture.
        const still = { animations: 'disabled' as const, style: '.toast, #focus-controls { visibility: hidden !important; }' };
        // A picture once two in a row are the same (the generation labels fade back after a pan).
        const stableShot = async () => {
            let prev = await tree.screenshot(still);
            for (let i = 0; i < 20; i++) {
                const next = await tree.screenshot(still);
                if (next.equals(prev)) return next;
                prev = next;
            }
            return prev;
        };
        await page.mouse.move(2, 450);
        const shot = await stableShot();
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        await chooseSpacing(page, 'dense');
        expect(await layout()).not.toEqual(before);
        await chooseSpacing(page, 'normal');
        // The pointer off the cards before the dialog goes (its option stood over the focus card).
        await page.mouse.move(2, 450);
        await page.keyboard.press('Escape');
        await expect(page.locator('#settings-modal')).toBeHidden();
        expect(await layout()).toEqual(before);
        expect((await stableShot()).equals(shot)).toBe(true);
    });
});

test.describe('the hint about the Compact card (§5)', () => {
    test('390 x 844: shown with the Normal card, gone with the Compact card', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await openApp(page);
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        const hint = page.locator('#tree-spacing-hint');
        await expect(hint).toBeVisible();
        await expect(hint).toHaveText('On a small screen, the Compact card helps too.');
        await page.locator('#card-type-row .card-type-tile[data-density="compact"]').click();
        await expect(hint).toBeHidden();
        await page.locator('#card-type-row .card-type-tile[data-density="normal"]').click();
        await expect(hint).toBeVisible();
    });

    test('1440: not drawn', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openApp(page);
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        await expect(page.locator('#tree-spacing-setting')).toBeVisible();
        await expect(page.locator('#tree-spacing-hint')).toBeHidden();
    });
});
