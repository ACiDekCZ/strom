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

test.describe('the spacing segment\'s pictures', () => {
    for (const scheme of ['light', 'dark'] as const) {
        test(`${scheme}: the chosen option's picture takes its label's colour, the other the faint one (1113)`, async ({ page }) => {
            await page.emulateMedia({ colorScheme: scheme });
            await page.setViewportSize({ width: 1440, height: 900 });
            await openApp(page);
            await page.evaluate(() => window.Strom.UI.showSettingsDialog());
            const look = () => page.locator('#settings-modal .tree-spacing-options .settings-radio').evaluateAll(opts => opts.map(o => ({
                checked: (o.querySelector('input') as HTMLInputElement).checked,
                glyph: getComputedStyle(o.querySelector('.spacing-glyph')!).color,
                label: getComputedStyle(o.querySelector('.spacing-opt-label')!).color,
                ground: getComputedStyle(o).backgroundColor,
            })));
            for (const value of ['normal', 'dense']) {
                await page.locator(`#settings-modal input[name="tree-spacing"][value="${value}"]`).check({ force: true });
                const opts = await look();
                const chosen = opts.find(o => o.checked)!;
                const other = opts.find(o => !o.checked)!;
                // Without a fill under the chosen option a white picture vanishes on the light ground.
                expect(chosen.glyph).toBe(chosen.label);
                expect(chosen.glyph).not.toBe(chosen.ground);
                expect(other.glyph).not.toBe(chosen.glyph);
            }
        });
    }
});

test.describe('a choice that lays the tree out anew (C80, waiting buttons §8)', () => {
    type Watch = { atLayout: string[]; chosenAtLayout: string[]; shown: boolean; added: number; removed: number; layoutEnd: number };
    /**
     * The layout of the view made `ms` long (in one go), and what the tree's area says around it. `null`: the
     * layout is replaced by one that takes no time, so "quick" does not hang on the machine's speed (the sample
     * tree's real layout takes 120 ms and more on a slow CI runner, and there the overlay is rightly seen).
     */
    const watch = (page: Page, ms: number | null) => page.evaluate((ms) => {
        const w = window as unknown as { __cb: Watch };
        w.__cb = { atLayout: [], chosenAtLayout: [], shown: false, added: 0, removed: 0, layoutEnd: 0 };
        const R = window.Strom.TreeRenderer as unknown as { renderKeepingView: () => Promise<void> };
        const orig = R.renderKeepingView.bind(R);
        R.renderKeepingView = () => {
            w.__cb.atLayout.push(document.querySelector('#tree-container > .canvas-busy')?.textContent ?? '');
            w.__cb.chosenAtLayout.push(window.Strom.SettingsManager.getTreeSpacing());
            if (ms === null) {
                w.__cb.layoutEnd = performance.now();
                return Promise.resolve();
            }
            const end = performance.now() + ms;
            while (performance.now() < end) { /* the layout of a large tree */ }
            const r = orig();
            w.__cb.layoutEnd = performance.now();
            return r;
        };
        new MutationObserver(recs => {
            for (const r of recs) {
                for (const n of r.addedNodes) if ((n as Element).classList?.contains('canvas-busy')) w.__cb.added = performance.now();
                for (const n of r.removedNodes) if ((n as Element).classList?.contains('canvas-busy')) w.__cb.removed = performance.now();
                if (r.type === 'attributes' && (r.target as Element).classList?.contains('canvas-busy')) w.__cb.shown = true;
            }
        }).observe(document.getElementById('tree-container')!, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-shown'] });
    }, ms);
    const watched = (page: Page) => page.evaluate(() => (window as unknown as { __cb: Watch }).__cb);

    test('Spacing with a long layout: the choice is on at once, the overlay painted before the layout, seen and held', async ({ page }) => {
        await sampleTree(page);
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        await watch(page, 300);
        await page.locator('#tree-spacing-setting input[value="dense"]').check();
        await expect(page.locator('#tree-spacing-setting input[value="dense"]')).toBeChecked();
        await expect.poll(() => gaps(page).then(g => g.config[0])).toBe(20);
        await expect(page.locator('#tree-container > .canvas-busy')).toHaveCount(0);
        const cb = await watched(page);
        expect(cb.atLayout).toEqual(['Calculating the layout…']);
        expect(cb.chosenAtLayout).toEqual(['dense']);
        expect(cb.shown).toBe(true);
        // Seen past 120 ms of a 300 ms layout: it stays until 420 ms after it was painted, gone after the layout.
        expect(cb.removed - cb.added).toBeGreaterThanOrEqual(400);
        expect(cb.removed).toBeGreaterThan(cb.layoutEnd);
        await expect(page.locator('#settings-modal')).toBeVisible();
    });

    test('a quick layout never shows the overlay', async ({ page }) => {
        await sampleTree(page);
        await page.evaluate(() => window.Strom.UI.showSettingsDialog());
        await watch(page, null);
        await page.evaluate(() => window.Strom.UI.setTreeSpacing('dense'));
        await expect(page.locator('#tree-container > .canvas-busy')).toHaveCount(0);
        const cb = await watched(page);
        expect(cb.atLayout).toEqual(['Calculating the layout…']);
        expect(cb.chosenAtLayout).toEqual(['dense']);
        // It went over the tree and away again without ever being seen.
        expect(cb.added).toBeGreaterThan(0);
        expect(cb.removed).toBeGreaterThan(0);
        expect(cb.shown).toBe(false);
    });
});
