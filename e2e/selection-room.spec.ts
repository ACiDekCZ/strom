/**
 * The window's selection and the room it takes (spec 098): Fit to screen
 * keeps every card clear of the floating selection pill (top on a computer
 * and a tablet, bottom on a phone), the toolbar's Selection ▾ list takes
 * the window's height (all of it at 1440×900, scrolling only on a low
 * window), and the map's scope switch shows a long selection's name whole
 * while there is room. Invented names only (e2e/rods-fixture.ts,
 * e2e/map-path-fixture.ts).
 */

import { test, expect, Page, Locator } from '@playwright/test';
import { openApp } from './helpers.js';
import { rodsTree } from './rods-fixture.js';
import { seedPathTree, stubTiles } from './map-path-fixture.js';

async function setup(page: Page, focus = 'b16'): Promise<void> {
    await openApp(page);
    await page.evaluate(async ([data, f]) => {
        const S = window.Strom;
        await S.DataManager.importAsNewTree(data, 'Brandvold');
        S.UI.updateTreeSwitcher?.();
        S.TreeRenderer.setFocus(f as never);
        await S.TreeRenderer.renderAsync();
    }, [rodsTree(), focus] as const);
}

const host = (page: Page): Locator => page.locator('#view-rod-picker');
const pill = (page: Page): Locator => page.locator('#evidence-pill');

/** A list of people made the window's selection (through the toolbar's choice where it is shown). */
async function chooseList(page: Page, name: string, ids: string[], viaPicker: boolean): Promise<void> {
    await page.evaluate(([n, p]) => {
        window.Strom.DataManager.createPersonList({ name: n, dynamic: false, personIds: p as never[], sort: 'manual' });
    }, [name, ids] as const);
    if (viaPicker) {
        await host(page).locator('.sp-rodpick-btn').click();
        const pop = host(page).locator('.sp-rodpick-pop');
        await expect(pop).toBeVisible();
        await pop.locator('li.sp-selpick-row[data-sec="lists"]', { hasText: name }).locator('button').click();
    } else {
        await page.locator('#bb-view-more').click();
        await page.locator('#sheet-rod').click();
        await page.locator('.rod-pick-sheet li.sp-selpick-row[data-sec="lists"]', { hasText: name }).locator('button').click();
        await expect(page.locator('.rod-pick-sheet')).toHaveCount(0);
    }
    await expect(pill(page).locator('.evidence-pill-label--pick')).toContainText(name);
}

/** The drawn cards that overlap the pill on screen. */
async function cardsUnderPill(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        const p = document.getElementById('evidence-pill')!.getBoundingClientRect();
        return [...document.querySelectorAll<HTMLElement>('#tree-canvas .person-card[data-id]')].filter(c => {
            const r = c.getBoundingClientRect();
            return r.width > 0 && r.right > p.left && r.left < p.right && r.bottom > p.top && r.top < p.bottom;
        }).map(c => c.dataset.id!);
    });
}

/** Every drawn card inside the tree's area (none cut off by Fit to screen). */
async function cardsOutside(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        const box = document.getElementById('tree-container')!.getBoundingClientRect();
        return [...document.querySelectorAll<HTMLElement>('#tree-canvas .person-card[data-id]')].filter(c => {
            const r = c.getBoundingClientRect();
            return r.left < box.left - 0.5 || r.right > box.right + 0.5 || r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5;
        }).map(c => c.dataset.id!);
    });
}

const fit = (page: Page): Promise<void> => page.evaluate(() => window.Strom.ZoomPan.fitToScreen());

for (const vp of [
    { name: 'a computer', width: 1440, height: 900, picker: true },
    { name: 'a tablet', width: 1024, height: 768, picker: true, touch: true },
    { name: 'a phone', width: 390, height: 844, picker: false, touch: true },
] as const) {
    test.describe(`Fit to screen with a selection on ${vp.name}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: 'touch' in vp, isMobile: vp.width < 641 });

        test('no card under the selection pill, none cut off', async ({ page }) => {
            await setup(page);
            // The family line's founders and the focus: the top row stands in the pill's columns.
            await chooseList(page, 'Letters to the parish offices', ['b1', 'b16'], vp.picker);
            await fit(page);
            await expect(pill(page)).toBeVisible();
            expect(await cardsUnderPill(page)).toEqual([]);
            expect(await cardsOutside(page)).toEqual([]);
        });
    });
}

test.describe('the toolbar\'s Selection ▾ list', () => {
    test('at 1440×900 the whole list is in view, the last row without scrolling', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await setup(page);
        await page.evaluate(() => {
            const D = window.Strom.DataManager;
            D.createPersonList({ name: 'Letters to write', dynamic: false, personIds: ['b14', 'b15'] as never[], sort: 'manual' });
            D.createPersonList({ name: 'Registers to search', dynamic: false, personIds: ['b16'] as never[], sort: 'manual' });
        });
        await host(page).locator('.sp-rodpick-btn').click();
        const pop = host(page).locator('.sp-rodpick-pop');
        await expect(pop).toBeVisible();
        const list = pop.locator('.sp-rodpick-list');
        expect(await list.evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(0);
        const last = pop.locator('.sp-selpick-manage');
        await expect(last).toBeInViewport({ ratio: 1 });
        // The list ends inside the window.
        expect((await pop.boundingBox())!.y + (await pop.boundingBox())!.height).toBeLessThanOrEqual(900);
    });

    test('a low window: the list ends above the window\'s edge and scrolls', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 520 });
        await setup(page);
        await host(page).locator('.sp-rodpick-btn').click();
        const pop = host(page).locator('.sp-rodpick-pop');
        await expect(pop).toBeVisible();
        const box = (await pop.boundingBox())!;
        expect(box.y + box.height).toBeLessThanOrEqual(520);
        expect(await pop.locator('.sp-rodpick-list').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    });
});

const LONG = 'Letters to the parish offices of Lambda';

async function mapWithList(page: Page, name: string): Promise<Locator> {
    await stubTiles(page);
    await seedPathTree(page, {}, { timeOn: false });
    await page.evaluate((n) => {
        window.Strom.DataManager.createPersonList({ name: n, dynamic: false, personIds: ['ansel', 'ivar'] as never[], sort: 'manual' });
    }, name);
    await page.evaluate(() => window.Strom.UI.setMapScope('sel'));
    return page.locator('#map-container .map-scope-pick .sp-rodpick-pop, .rod-pick-sheet').first();
}

test.describe('the map\'s scope switch', () => {
    test('a wide window: a long selection\'s name is shown whole', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const pop = await mapWithList(page, LONG);
        await pop.locator('li.sp-selpick-row[data-sec="lists"]', { hasText: LONG }).locator('button').click();
        const name = page.locator('#map-scope-sel .map-scope-name');
        await expect(name).toContainText(LONG);
        expect(await name.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    });

    test('a touch tablet: the name stands in the middle of the 44 px part, as the other parts\' words do', async ({ browser }) => {
        const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
        const page = await ctx.newPage();
        const pop = await mapWithList(page, LONG);
        await pop.locator('li.sp-selpick-row[data-sec="lists"]', { hasText: LONG }).locator('button').click();
        const part = (await page.locator('#map-scope-sel').boundingBox())!;
        const name = (await page.locator('#map-scope-sel .map-scope-name').boundingBox())!;
        expect(part.height).toBeGreaterThanOrEqual(43.5);
        expect(Math.abs((name.y + name.height / 2) - (part.y + part.height / 2))).toBeLessThanOrEqual(2);
        expect(await page.locator('#map-scope-sel .map-scope-name').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
        await ctx.close();
    });

    test('a phone: the scope button with the long name does not spill over the page', async ({ browser }) => {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        const page = await ctx.newPage();
        const pop = await mapWithList(page, LONG);
        await pop.locator('li.sp-selpick-row[data-sec="lists"]', { hasText: LONG }).locator('button').click();
        await expect(page.locator('.map-scope-btn')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
        const b = (await page.locator('.map-scope-btn').boundingBox())!;
        expect(b.x + b.width).toBeLessThanOrEqual(390);
        await ctx.close();
    });
});
