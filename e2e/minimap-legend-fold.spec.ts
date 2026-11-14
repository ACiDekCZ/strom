import { test, expect, Page } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * Folding the minimap and the tree legend (spec 1112 §2). The minimap's tab
 * folds the canvas away with the zoom buttons left where they stood; the
 * legend's ◯ folds it into a chip "◯ Legend". Both are kept on the device
 * (strom-minimap-open, strom-tree-legend-open) and survive a reload; a drag
 * over the legend still moves the tree. A folded legend shows a dot while the
 * view has a kind of mark it has not shown open yet. A phone shows the legend
 * as a chip whose tap opens a sheet, never reopened by a reload.
 */

async function sample(page: Page): Promise<void> {
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
}

/** Zoom in until the tree overflows the view (the minimap is offered), the glide over. */
async function zoomForMinimap(page: Page): Promise<void> {
    const scale = () => page.evaluate(() => window.Strom.ZoomPan.getTransform().scale);
    const s0 = await scale();
    for (let i = 0; i < 4; i++) await page.evaluate(() => window.Strom.ZoomPan.zoomIn());
    await expect.poll(scale).toBeCloseTo(s0 * 1.3 ** 4, 5);
    await expect(page.locator('.minimap-toggle')).toBeVisible();
}

const zoomTops = (page: Page) => page.locator('.zoom-controls button').evaluateAll(
    bs => bs.map(b => Math.round(b.getBoundingClientRect().top)));

test.describe('minimap fold', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('the tab folds the canvas away, the zoom buttons stay, a reload keeps it', async ({ page }) => {
        await sample(page);
        await zoomForMinimap(page);
        const panel = page.locator('#minimap-panel');
        const tab = page.locator('.minimap-toggle');
        await expect(panel).toBeVisible();
        await expect(tab).toHaveAttribute('aria-expanded', 'true');
        await expect(tab).toHaveAttribute('aria-label', 'Collapse minimap');
        await expect(tab).toHaveAttribute('aria-controls', 'minimap-panel');
        // Hidden with a mouse until the pointer is on the block.
        expect(await tab.evaluate(el => getComputedStyle(el).opacity)).toBe('0');
        await page.locator('.zoom-controls button').first().hover();
        await expect.poll(() => tab.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
        const before = await zoomTops(page);

        await tab.click();
        await expect(panel).toBeHidden();
        await expect(page.locator('#minimap-canvas')).toBeHidden();
        expect(await panel.evaluate(el => getComputedStyle(el).display)).toBe('none');
        await expect(tab).toHaveAttribute('aria-expanded', 'false');
        await expect(tab).toHaveAttribute('aria-label', 'Expand minimap');
        expect(await zoomTops(page)).toEqual(before);
        // Folded, it shows the minimap's sign without the pointer, and nothing is drawn.
        await page.mouse.move(10, 400);
        await expect.poll(() => tab.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
        expect(await page.evaluate(() => (window.Strom.UI as unknown as { minimapTransform: unknown }).minimapTransform)).toBeNull();
        expect(await page.evaluate(() => localStorage.getItem('strom-minimap-open'))).toBe('0');

        await page.reload();
        await expect(card(page, 'Johan')).toBeVisible();
        await zoomForMinimap(page);
        await expect(tab).toHaveAttribute('aria-expanded', 'false');
        await expect(panel).toBeHidden();

        // Unfolded again, the canvas still moves the view.
        await tab.click();
        await expect(panel).toBeVisible();
        await expect(tab).toHaveAttribute('aria-expanded', 'true');
        const transform = await page.locator('#tree-canvas').evaluate(el => el.style.transform);
        const box = (await page.locator('#minimap-canvas').boundingBox())!;
        await page.mouse.click(box.x + box.width * 0.85, box.y + box.height * 0.85);
        await expect.poll(() => page.locator('#tree-canvas').evaluate(el => el.style.transform)).not.toBe(transform);
        expect(await page.evaluate(() => localStorage.getItem('strom-minimap-open'))).toBe('1');
    });
});

test.describe('legend fold', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('a drag from the middle of the legend moves the tree; ◯ folds it into a chip and back, a reload keeps it', async ({ page }) => {
        await sample(page);
        await page.evaluate(() => window.Strom.UI.toggleBranchLegend(true));
        const legend = page.locator('#tree-legend');
        const toggle = legend.locator('.tree-legend-toggle');
        await expect(legend).toBeVisible();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(toggle).toHaveAttribute('aria-label', 'Collapse legend');

        // A drag starting in the middle of the pill pans the canvas.
        const l = (await legend.boundingBox())!;
        const t = (await toggle.boundingBox())!;
        const x = l.x + l.width / 2, y = l.y + l.height / 2;
        // Not on the button (the pill's first segment, or the panel's head).
        expect(x > t.x + t.width || y > t.y + t.height).toBe(true);
        const transform = await page.locator('#tree-canvas').evaluate(el => el.style.transform);
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 60, y - 40, { steps: 5 });
        await page.mouse.move(x + 120, y - 80, { steps: 5 });
        await page.mouse.up();
        await expect.poll(() => page.locator('#tree-canvas').evaluate(el => el.style.transform)).not.toBe(transform);

        await toggle.click();
        await expect(legend).toHaveClass(/is-collapsed/);
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(toggle).toHaveAttribute('aria-label', 'Expand legend');
        await expect(legend.locator('.legend-item').first()).toBeHidden();
        await expect(toggle).toHaveText('Legend');
        expect(await page.evaluate(() => localStorage.getItem('strom-tree-legend-open'))).toBe('0');
        // The chip's height lifts back / forward by what it is now (legend-lift.ts).
        await expect.poll(() => page.evaluate(() => document.body.style.getPropertyValue('--tree-legend-h')))
            .toBe(`${Math.ceil((await legend.boundingBox())!.height)}px`);

        await page.reload();
        await expect(card(page, 'Johan')).toBeVisible();
        await expect(legend).toHaveClass(/is-collapsed/);
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');

        await toggle.click();
        await expect(legend).not.toHaveClass(/is-collapsed/);
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(legend.locator('.legend-item').first()).toBeVisible();
        expect(await page.evaluate(() => localStorage.getItem('strom-tree-legend-open'))).toBe('1');
    });

    test('a folded legend marks a kind of card mark it has not shown open yet with a dot', async ({ page }) => {
        await page.addInitScript(() => {
            if (sessionStorage.getItem('seeded')) return;
            sessionStorage.setItem('seeded', '1');
            localStorage.setItem('strom-tree-legend-open', '0');
        });
        await openApp(page);
        await page.evaluate(async () => {
            const persons = {
                a: {
                    id: 'a', firstName: 'Ofélie', lastName: 'Šplíchalová', gender: 'female', birthDate: '1903',
                    question: 'Kde se narodila?', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [],
                },
            };
            await window.Strom.DataManager.importAsNewTree({ persons, partnerships: {}, sources: {} } as never, 'Legenda');
        });
        await expect(card(page, 'Ofélie')).toBeVisible();
        await page.evaluate(() => window.Strom.UI.toggleBranchLegend(true));
        const legend = page.locator('#tree-legend');
        const toggle = legend.locator('.tree-legend-toggle');
        const dot = toggle.locator('.tlt-dot');
        await expect(legend).toHaveClass(/is-collapsed/);
        await expect(dot).toBeVisible();
        await expect(toggle).toHaveAttribute('aria-label', 'Legend, new mark');

        // Shown open, the mark counts as seen: folded again, no dot.
        await toggle.click();
        await expect(legend).toHaveClass(/has-marks/);
        await expect(legend.locator('.legend-mark-row')).toContainText(['awaiting a decision (!, ≠, ?)']);
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('strom-tree-legend-seen') ?? '[]'))).toEqual(['action']);
        await toggle.click();
        await expect(legend).toHaveClass(/is-collapsed/);
        await expect(dot).toBeHidden();
        await expect(toggle).toHaveAttribute('aria-label', 'Expand legend');
    });
});

/**
 * The zoom and minimap panel is set into the canvas's bottom-right corner
 * (spec 046 A8): flush with the window's right edge and with the canvas's
 * bottom (the window's on a computer, the bottom bar's top on a tablet), square,
 * no shadow, an edge only on its top and left; the minimap inside it framed by a
 * 1px divider line, square. The legend at the other corner stays clear of it,
 * open with its card marks or folded, and keeps its height on the body for
 * back / forward (legend-lift.ts).
 */
for (const viewport of [{ width: 1280, height: 800 }, { width: 1024, height: 768 }, { width: 700, height: 900 }]) {
    test.describe(`zoom panel in the corner at ${viewport.width}`, () => {
        test.use({ viewport });

        test('flush with the canvas\'s corner, square, edged top and left; the legend clear of it', async ({ page }) => {
            await sample(page);
            await zoomForMinimap(page);
            await page.evaluate(() => window.Strom.UI.toggleBranchLegend(true));
            const legend = page.locator('#tree-legend');
            await expect(legend).toBeVisible();
            const g = await page.evaluate(() => {
                const block = document.querySelector('.control-block') as HTMLElement;
                const mini = document.getElementById('minimap-panel') as HTMLElement;
                const bar = document.querySelector('.bottom-bar') as HTMLElement;
                const tree = (document.getElementById('tree-container') as HTMLElement).getBoundingClientRect();
                const r = block.getBoundingClientRect();
                const cs = getComputedStyle(block), ms = getComputedStyle(mini);
                const probe = document.createElement('i');
                probe.style.color = 'var(--divider)';
                document.body.appendChild(probe);
                const divider = getComputedStyle(probe).color;
                probe.remove();
                const barTop = bar && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect().top : innerHeight;
                return {
                    right: r.right, bottom: r.bottom, vw: document.documentElement.clientWidth, barTop, treeBottom: tree.bottom,
                    edges: [cs.borderTopWidth, cs.borderLeftWidth, cs.borderRightWidth, cs.borderBottomWidth],
                    radius: cs.borderRadius, shadow: cs.boxShadow,
                    mini: [ms.borderTopWidth, ms.borderTopColor === divider, ms.borderRadius],
                };
            });
            expect(g.right).toBe(g.vw);
            expect(g.bottom).toBe(g.barTop);
            expect(g.bottom).toBe(g.treeBottom);
            expect(g.edges).toEqual(['1px', '1px', '0px', '0px']);
            expect(g.radius).toBe('0px');
            expect(g.shadow).toBe('none');
            expect(g.mini).toEqual(['1px', true, '0px']);

            const apart = async () => {
                const a = (await legend.boundingBox())!, b = (await page.locator('.control-block').boundingBox())!;
                return a.x + a.width <= b.x || a.y + a.height <= b.y;
            };
            expect(await apart()).toBe(true);
            await legend.locator('.tree-legend-toggle').click();
            await expect(legend).toHaveClass(/is-collapsed/);
            expect(await apart()).toBe(true);
            await expect.poll(() => page.evaluate(() => document.body.style.getPropertyValue('--tree-legend-h')))
                .toBe(`${Math.ceil((await legend.boundingBox())!.height)}px`);
        });
    });
}

for (const [label, viewport] of [['390 upright', { width: 390, height: 844 }], ['844 × 390 sideways', { width: 844, height: 390 }]] as const) {
    test.describe(`legend on a phone ${label}`, () => {
        test.use({ viewport, hasTouch: true, isMobile: true });

        test('the chip opens the legend as a sheet; Done, Escape and a tap beside close it; a reload does not open it', async ({ page }) => {
            await sample(page);
            await page.evaluate(() => window.Strom.UI.toggleBranchLegend(true));
            const legend = page.locator('#tree-legend');
            const toggle = legend.locator('.tree-legend-toggle');
            await expect(legend).toHaveClass(/is-collapsed/);
            await expect(toggle).toHaveText('Legend');
            await expect(toggle).toHaveAttribute('aria-expanded', 'false');
            await expect(toggle).toHaveAttribute('aria-haspopup', 'dialog');

            const sheet = page.locator('.bottom-sheet-legend');
            await toggle.tap();
            await expect(sheet).toBeVisible();
            await expect(sheet).toHaveAttribute('role', 'dialog');
            await expect(toggle).toHaveAttribute('aria-expanded', 'true');
            await expect(sheet.locator('.tree-legend-sheet-title')).toHaveText('Legend');
            await expect(sheet.locator('.legend-item')).toContainText(['Male', 'Female']);
            if (viewport.width > viewport.height) {
                // Held sideways: a 340px panel at the right over the whole height.
                await expect.poll(async () => {
                    const b = (await sheet.boundingBox())!;
                    return [Math.round(b.width), Math.round(b.x + b.width), Math.round(b.height)];
                }).toEqual([340, viewport.width, viewport.height]);
            } else {
                await expect.poll(async () => {
                    const b = (await sheet.boundingBox())!;
                    return Math.round(b.y + b.height);
                }).toBe(viewport.height);
            }
            await sheet.getByRole('button', { name: 'Done' }).click();
            await expect(sheet).toHaveCount(0);
            await expect(toggle).toHaveAttribute('aria-expanded', 'false');
            await expect(legend).toHaveClass(/is-collapsed/);

            await toggle.tap();
            await expect(sheet).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(sheet).toHaveCount(0);

            await toggle.tap();
            await expect(sheet).toBeVisible();
            await page.mouse.click(viewport.width > viewport.height ? 200 : viewport.width / 2, 60);
            await expect(sheet).toHaveCount(0);
            // A phone neither reads nor writes the device's choice.
            expect(await page.evaluate(() => localStorage.getItem('strom-tree-legend-open'))).toBeNull();

            await toggle.tap();
            await expect(sheet).toBeVisible();
            await page.reload();
            await expect(card(page, 'Johan')).toBeVisible();
            await expect(legend).toHaveClass(/is-collapsed/);
            await expect(page.locator('.bottom-sheet-legend')).toHaveCount(0);
        });
    });
}
