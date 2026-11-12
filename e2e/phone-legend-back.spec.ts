import { test, expect, Page } from '@playwright/test';
import { openApp } from './helpers.js';

/**
 * A phone, upright and held sideways (spec 082 K1.2, T44): the legend stays at the
 * bottom edge (above the bottom bar, beside the side bar) and back / forward stand
 * above it — in the family view (the legend pill, also with the card marks) and in
 * the fan (its legend chip). The map has no legend on a phone: back keeps its
 * place. Nothing covers anything: the legend, the buttons, the bar, the zoom, the
 * map's controls and a toast.
 */

const FLOATING = ['#tree-legend', '#fan-legend-chip', '#focus-back-btn', '#focus-forward-btn', '#bottom-bar',
    '.control-block:not(.control-block--empty)', '#fan-zoom-controls', '.map-controls', '.map-status', 'body > .toast.show'];

async function sampleWithBack(page: Page): Promise<void> {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(page.locator('#toolbar-focus-name')).not.toHaveText('');
    await page.evaluate(() => window.Strom.UI.toggleBranchLegend(true));
    await page.evaluate(() => {
        const S = window.Strom;
        const ids = Object.keys(S.DataManager.getData().persons);
        S.TreeRenderer.setFocus(ids[5] as never);
    });
    await expect(page.locator('#focus-back-btn')).toBeVisible();
}

/** Pairs of shown floating elements that cover each other. */
function clashes(page: Page): Promise<string[]> {
    return page.evaluate((sels) => {
        const shown = sels.flatMap(s => [...document.querySelectorAll(s)]
            .filter(e => (e as HTMLElement).checkVisibility({ visibilityProperty: true }))
            .map(e => ({ s, r: e.getBoundingClientRect() })));
        const out: string[] = [];
        for (let i = 0; i < shown.length; i++) {
            for (let j = i + 1; j < shown.length; j++) {
                const a = shown[i].r, b = shown[j].r;
                const pair = [shown[i].s, shown[j].s];
                if (pair.includes('body > .toast.show') && pair.some(x => /legend|chip/.test(x))) continue; // a toast may pass over the passive legend
                if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) out.push(`${shown[i].s} × ${shown[j].s}`);
            }
        }
        for (const { s, r } of shown) {
            if (r.top < 0 || r.bottom > window.innerHeight + 0.5 || r.left < 0 || r.right > window.innerWidth + 0.5) out.push(`${s} outside`);
        }
        return out;
    }, FLOATING);
}

/** Bottom of the button above the top of what it stands on (8px apart at least). */
async function standsAbove(page: Page, button: string, below: string): Promise<void> {
    await expect.poll(() => page.evaluate(([a, b]) => {
        const ra = document.querySelector(a)!.getBoundingClientRect();
        const rb = document.querySelector(b)!.getBoundingClientRect();
        return Math.round(rb.top - ra.bottom);
    }, [button, below]), `${button} above ${below}`).toBeGreaterThanOrEqual(8);
}

for (const [label, viewport] of [['390 upright', { width: 390, height: 844 }], ['844 × 390 sideways', { width: 844, height: 390 }]] as const) {
    test.describe(`phone ${label}`, () => {
        test.use({ viewport, hasTouch: true, isMobile: true });

        test('the family view: the legend at the bottom edge, back and forward above it, nothing covered (T44)', async ({ page }) => {
            await sampleWithBack(page);
            const legend = page.locator('#tree-legend');
            await expect(legend).toBeVisible();
            await standsAbove(page, '#focus-back-btn', '#tree-legend');
            // The legend at the edge: right above the bottom bar (upright) or the screen's bottom (sideways).
            const l = (await legend.boundingBox())!;
            const bar = (await page.locator('#bottom-bar').boundingBox())!;
            const floor = viewport.width < viewport.height ? bar.y : viewport.height;
            expect(floor - (l.y + l.height)).toBeLessThanOrEqual(16);
            await expect.poll(() => clashes(page)).toEqual([]);
            // Forward alone (back to the first focus) stands above the legend too.
            await page.evaluate(() => window.Strom.TreeRenderer.goBack());
            await expect(page.locator('#focus-forward-btn')).toBeVisible();
            await standsAbove(page, '#focus-forward-btn', '#tree-legend');
            // A toast keeps clear of the buttons.
            await page.evaluate(() => window.Strom.UI.showToast('Not sent. This copy of the tree does not have the research numbers for its people yet.', 10000));
            await expect(page.locator('body > .toast.show')).toBeVisible();
            await expect.poll(() => clashes(page)).toEqual([]);
            // Without the legend the buttons come down to their place over the bar.
            await page.evaluate(() => window.Strom.UI.toggleBranchLegend(false));
            await expect(legend).toBeHidden();
            await expect.poll(async () => {
                const f = (await page.locator('#focus-forward-btn').boundingBox())!;
                return Math.round(floor - (f.y + f.height));
            }).toBe(16);
        });

        test('the fan: the legend chip at the bottom, back above it, nothing covered (T44)', async ({ page }) => {
            await sampleWithBack(page);
            await page.evaluate(() => window.Strom.UI.setDisplayViewMode('fan'));
            await expect(page.locator('#fan-legend-chip')).toBeVisible();
            await standsAbove(page, '#focus-back-btn', '#fan-legend-chip');
            await expect.poll(() => clashes(page)).toEqual([]);
            await page.evaluate(() => window.Strom.UI.showToast('Not sent. This copy of the tree does not have the research numbers for its people yet.', 10000));
            await expect(page.locator('body > .toast.show')).toBeVisible();
            await expect.poll(() => clashes(page)).toEqual([]);
        });

        test('the map: back over the bar, clear of the map\'s controls (T44)', async ({ page }) => {
            await sampleWithBack(page);
            await page.evaluate(() => window.Strom.UI.setDisplayViewMode('map'));
            await expect(page.locator('body')).toHaveAttribute('data-view-mode', 'map');
            await expect(page.locator('#focus-back-btn')).toBeVisible();
            await expect.poll(() => clashes(page)).toEqual([]);
            // A message on the map leaves back free as well.
            await page.evaluate(() => window.Strom.UI.showToast('Not sent. This copy of the tree does not have the research numbers for its people yet.', 10000));
            await expect(page.locator('body > .toast.show')).toBeVisible();
            await expect.poll(() => clashes(page)).toEqual([]);
        });
    });
}
