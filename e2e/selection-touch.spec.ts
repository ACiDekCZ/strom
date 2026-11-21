/**
 * The window's selection on touch screens (spec 098 §10): on a phone (Pixel,
 * iPhone) More › Selection picks it, the pill stays one row above the bottom
 * bar with 44 px targets (the label, Hide others, Next person, ×) and a long
 * name cut inside it; the map's Scope button is a 44 px target. On a tablet
 * the pill sits under the toolbar with 44 px targets; a phone held sideways
 * keeps the map's segment with 44 px parts. Nothing wider than the screen.
 * Invented names only (e2e/rods-fixture.ts).
 */

import { test, expect, devices, type Page, type Locator } from '@playwright/test';
import { openApp } from './helpers.js';
import { rodsTree } from './rods-fixture.js';
import { stubTiles } from './map-path-fixture.js';

const LONG = 'Brandvold-Ekhammarsson Lindenau';

async function setup(page: Page): Promise<void> {
    await stubTiles(page);
    await openApp(page);
    await page.evaluate(async ([data, name]) => {
        const S = window.Strom;
        await S.DataManager.importAsNewTree(data, 'Brandvold');
        S.DataManager.createPersonList({ name, dynamic: false, personIds: ['b14', 'b15', 'b16'] as never[], sort: 'manual' });
        S.UI.updateTreeSwitcher?.();
        S.TreeRenderer.setFocus('b16' as never);
        await S.TreeRenderer.renderAsync();
    }, [rodsTree(), LONG] as const);
}

const pill = (page: Page): Locator => page.locator('#evidence-pill');
const TARGETS = ['.evidence-pill-label--pick', '.evidence-pill-hide', '.evidence-pill-next', '.evidence-pill-close'];

/** The list chosen: the phone's More › Selection, else the toolbar's choice. */
async function chooseLong(page: Page): Promise<void> {
    const host = page.locator('#view-rod-picker');
    if (!(await host.locator('.sp-rodpick-btn').isVisible())) {
        await page.locator('#bb-view-more').click();
        await page.locator('#sheet-rod').click();
        const sheet = page.locator('.rod-pick-sheet');
        await expect(sheet).toBeVisible();
        await sheet.locator('li.sp-selpick-row[data-sec="lists"]', { hasText: LONG }).locator('button').click();
        await expect(sheet).toHaveCount(0);
    } else {
        await host.locator('.sp-rodpick-btn').click();
        await host.locator('.sp-rodpick-pop li.sp-selpick-row[data-sec="lists"]', { hasText: LONG }).locator('button').click();
    }
    await expect(pill(page).locator('.evidence-pill-label--pick')).toContainText(LONG.slice(0, 9));
}

/** Each of the pill's targets: its size; the pill inside the screen on one row. */
async function pillTargets(page: Page): Promise<Record<string, [number, number]>> {
    const out: Record<string, [number, number]> = {};
    for (const sel of TARGETS) {
        const box = await pill(page).locator(sel).boundingBox();
        expect(box, sel).not.toBeNull();
        out[sel] = [Math.round(box!.width), Math.round(box!.height)];
    }
    return out;
}

async function noOverflow(page: Page): Promise<void> {
    const { sw, iw, right, left } = await page.evaluate(() => {
        const r = document.getElementById('evidence-pill')!.getBoundingClientRect();
        return { sw: document.documentElement.scrollWidth, iw: innerWidth, right: r.right, left: r.left };
    });
    expect(sw).toBeLessThanOrEqual(iw);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(right).toBeLessThanOrEqual(iw);
}

function phone(name: string, device: (typeof devices)[string]): void {
    const { defaultBrowserType: _browser, ...use } = device;
    test.describe(`on a phone (${name})`, () => {
        test.use(use);

        test('More › Selection; the pill one row above the bottom bar, 44 px targets, the long name cut; the map\'s Scope 44 px', async ({ page }) => {
            await setup(page);
            expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
            await chooseLong(page);
            const sizes = await pillTargets(page);
            for (const [sel, [w, h]] of Object.entries(sizes)) {
                expect(h, `${sel} height`).toBeGreaterThanOrEqual(44);
                expect(w, `${sel} width`).toBeGreaterThanOrEqual(44);
            }
            await noOverflow(page);
            // One row: every target on the same line.
            const tops = await Promise.all(TARGETS.map(s => pill(page).locator(s).evaluate(el => { const r = el.getBoundingClientRect(); return Math.round(r.top + r.height / 2); })));
            expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(2);
            // The name cut with an ellipsis inside the label, the whole in its title.
            const label = pill(page).locator('.evidence-pill-label--pick');
            await expect(label).toHaveAttribute('title', new RegExp(LONG));
            expect(await label.locator('.evidence-pill-pick-text').evaluate(el => getComputedStyle(el).textOverflow)).toBe('ellipsis');
            // Above the bottom bar, clear of it.
            const [pb, bar] = await page.evaluate(() => [
                document.getElementById('evidence-pill')!.getBoundingClientRect().bottom,
                document.querySelector('.bottom-bar, #bottom-bar')?.getBoundingClientRect().top ?? innerHeight,
            ]);
            expect(pb).toBeLessThanOrEqual(bar);

            await page.evaluate(() => window.Strom.UI.setDisplayViewMode('map'));
            await expect(page.locator('#map-container')).toBeVisible();
            const scope = page.locator('#map-container .map-scope-btn');
            await expect(scope).toBeVisible();
            expect((await scope.boundingBox())!.height).toBeGreaterThanOrEqual(44);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        });
    });
}

phone('Pixel 7', devices['Pixel 7']);
phone('iPhone 14', devices['iPhone 14']);

test.describe('on a tablet', () => {
    test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });

    test('the pill under the toolbar, 44 px targets, nothing past the edge', async ({ page }) => {
        await setup(page);
        await chooseLong(page);
        const sizes = await pillTargets(page);
        for (const [sel, [, h]] of Object.entries(sizes)) expect(h, `${sel} height`).toBeGreaterThanOrEqual(44);
        await noOverflow(page);
        const [top, bar] = await page.evaluate(() => [
            document.getElementById('evidence-pill')!.getBoundingClientRect().top,
            document.querySelector('.toolbar')!.getBoundingClientRect().bottom,
        ]);
        expect(top).toBeGreaterThanOrEqual(bar);
    });
});

test.describe('a phone held sideways', () => {
    test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

    test('the pill\'s targets 44 px; the map\'s segment with 44 px parts', async ({ page }) => {
        await setup(page);
        await chooseLong(page);
        const sizes = await pillTargets(page);
        for (const [sel, [, h]] of Object.entries(sizes)) expect(h, `${sel} height`).toBeGreaterThanOrEqual(44);
        await noOverflow(page);
        await page.evaluate(() => window.Strom.UI.setDisplayViewMode('map'));
        await expect(page.locator('.map-scope')).toBeVisible();
        for (const id of ['#map-scope-view', '#map-scope-sel', '#map-scope-tree']) {
            expect((await page.locator(id).boundingBox())!.height, id).toBeGreaterThanOrEqual(44);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
});
