import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { openApp } from './helpers.js';

/**
 * Other partners and other families (GitHub #4, §5). A card whose person
 * has partners of unions without children out of view carries "▸ ∞ N" on
 * its bottom-left edge (in place, not a focus): a click draws them as
 * further marriages beside the card — the card keeps its place, the
 * partners carry the hatch of the cards shown here, the pill turns to
 * "▾ ∞ N" — and a second click gives the view back. The former ⌂ (other
 * families) is gone: "▸ children" promises those children, its bubble by
 * marriage. Invented fixtures only (test/edge-childless-partners.json: the
 * grandfather "gf" has a partner without children, "gf_x", out of view).
 */

const FOCUS = 'f';
const PERSON = 'gf';
const PARTNER = 'gf_x';

const cardOf = (page: Page, id: string) => page.locator(`#tree-canvas .person-card[data-id="${id}"]`);
const partnersPill = (page: Page, id: string) => cardOf(page, id).locator('.edge-bottom-left .hidden-partners-btn');
const shownCount = (page: Page) => page.evaluate(() => window.Strom.TreeRenderer.shownChildrenCount());

async function setup(page: Page): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    const data = JSON.parse(readFileSync(join(process.cwd(), 'test', 'edge-childless-partners.json'), 'utf-8'));
    await page.evaluate(async ([tree, f]) => {
        await window.Strom.DataManager.importAsNewTree(tree as never, 'Partners');
        await window.Strom.TreeRenderer.setFocus(f as never);
    }, [data, FOCUS] as const);
    await expect(cardOf(page, PERSON)).toBeVisible();
    await expect(cardOf(page, PARTNER)).toHaveCount(0);
    await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), PERSON);
}

/** Every drawn card's centre on the screen, by id (to a pixel). */
async function screenCenters(page: Page): Promise<Record<string, [number, number]>> {
    return page.evaluate(() => {
        const out: Record<string, [number, number]> = {};
        for (const c of document.querySelectorAll<HTMLElement>('#tree-canvas .person-card[data-id]')) {
            const r = c.getBoundingClientRect();
            out[c.dataset.id!] = [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)];
        }
        return out;
    });
}

const near = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1;

/** The layout's positions (world coordinates), by id. */
async function positions(page: Page): Promise<Record<string, [number, number]>> {
    return page.evaluate(() => {
        const r = window.Strom.TreeRenderer as unknown as { positions: Map<string, { x: number; y: number }> };
        return Object.fromEntries([...r.positions.entries()].map(([id, p]) => [id, [p.x, p.y] as [number, number]]));
    });
}

test('"▸ ∞" shows the other partners in place; the card stays; a second click gives the layout back', async ({ page }) => {
    await setup(page);
    await page.mouse.move(5, 500);
    // No ⌂ anywhere any more
    await expect(page.locator('.hidden-families-btn')).toHaveCount(0);
    const pill = partnersPill(page, PERSON);
    await expect(pill).toHaveClass(/kind-place/);
    await expect(pill).not.toHaveClass(/kind-focus/);
    await expect(pill.locator('.pill-glyph').first()).toHaveText('▸');
    await expect(pill.locator('.pill-count')).toHaveText('1');
    await expect(pill).toHaveAttribute('aria-pressed', 'false');
    await expect(pill).toHaveAttribute('aria-label', /^Show the other partners of .+ here$/);
    await expect(pill.locator('.badge-tooltip-header')).toHaveText('Other partners');
    // The partner with the marriage, numbered as the marriage-order pill counts (by date: the first)
    await expect(pill.locator('.badge-tooltip-item')).toHaveText(['GF-X CP 1st ∞ 1910']);
    await expect(pill.locator('.badge-tooltip-action')).toHaveText('A click shows them here; the view stays.');

    const layoutBefore = await positions(page);
    const before = await screenCenters(page);
    await pill.click();
    await expect(cardOf(page, PARTNER)).toBeVisible();
    await page.mouse.move(5, 500);
    expect(await page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId())).toBe(FOCUS);
    // The partner in the layout, with the hatch of the cards shown here; the card keeps its place
    expect(Object.keys(await positions(page))).toContain(PARTNER);
    await expect(cardOf(page, PARTNER)).toHaveClass(/shown-here/);
    await expect(cardOf(page, PERSON)).not.toHaveClass(/shown-here/);
    await expect.poll(async () => near((await screenCenters(page))[PERSON], before[PERSON])).toBe(true);
    const hide = partnersPill(page, PERSON);
    await expect(hide).toHaveClass(/active/);
    await expect(hide).toHaveAttribute('aria-pressed', 'true');
    await expect(hide.locator('.pill-glyph').first()).toHaveText('▾');
    await expect(hide).toHaveAttribute('aria-label', /^Hide the partners of .+ shown here$/);
    await expect(hide.locator('.badge-tooltip-header')).toHaveText('Partners shown here');
    await expect(hide.locator('.badge-tooltip-action')).toHaveText('A click on the tab hides them again.');
    expect(await shownCount(page)).toBe(1);
    await expect(page.locator('#hide-shown-children')).toBeVisible();

    await hide.click();
    await page.mouse.move(5, 500);
    await expect(cardOf(page, PARTNER)).toHaveCount(0);
    expect(await shownCount(page)).toBe(0);
    await expect(partnersPill(page, PERSON)).toHaveAttribute('aria-pressed', 'false');
    // Closing gives the original layout back
    expect(await positions(page)).toEqual(layoutBefore);
});

test('↩ after "▸ ∞" is one step back; ↪ brings the partners again; "Hide shown" closes them', async ({ page }) => {
    await setup(page);
    const couldGoBack = await page.evaluate(() => window.Strom.TreeRenderer.canGoBack());
    await partnersPill(page, PERSON).click();
    await expect(cardOf(page, PARTNER)).toBeVisible();
    await page.evaluate(() => window.Strom.TreeRenderer.goBack());
    await expect(cardOf(page, PARTNER)).toHaveCount(0);
    expect(await shownCount(page)).toBe(0);
    expect(await page.evaluate(() => window.Strom.TreeRenderer.canGoBack())).toBe(couldGoBack);
    await page.evaluate(() => window.Strom.TreeRenderer.goForward());
    await expect(cardOf(page, PARTNER)).toBeVisible();
    await expect(partnersPill(page, PERSON)).toHaveClass(/active/);
    await expect(cardOf(page, PARTNER)).toHaveClass(/shown-here/);
    expect(await shownCount(page)).toBe(1);

    await page.locator('#hide-shown-children').click();
    await expect(cardOf(page, PARTNER)).toHaveCount(0);
    expect(await shownCount(page)).toBe(0);
    // A new focus starts without the partners shown
    await partnersPill(page, PERSON).click();
    await expect(cardOf(page, PARTNER)).toBeVisible();
    await page.evaluate(() => window.Strom.TreeRenderer.setFocus('c1' as never));
    await expect.poll(() => shownCount(page)).toBe(0);
});

test('"▸ children" of a person with children of two marriages out of view: the bubble groups them by marriage', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await page.evaluate(async () => {
        const P = (id: string, o: Record<string, unknown>) => ({ id, firstName: id, lastName: 'Lind', gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...o });
        const persons = {
            karl: P('karl', { firstName: 'Karl', partnerships: ['ua', 'ub', 'uc'], childIds: ['a1', 'b1', 'c1'] }),
            anna: P('anna', { firstName: 'Anna', gender: 'female', partnerships: ['ua'], childIds: ['a1'] }),
            berta: P('berta', { firstName: 'Berta', gender: 'female', partnerships: ['ub'], childIds: ['b1'] }),
            cilka: P('cilka', { firstName: 'Cilka', gender: 'female', partnerships: ['uc'], childIds: ['c1'] }),
            a1: P('a1', { firstName: 'Arne', parentIds: ['karl', 'anna'], partnerships: ['ud'], childIds: ['g'] }),
            b1: P('b1', { firstName: 'Bo', parentIds: ['karl', 'berta'] }),
            c1: P('c1', { firstName: 'Cid', parentIds: ['karl', 'cilka'] }),
            dora: P('dora', { firstName: 'Dora', gender: 'female', partnerships: ['ud'], childIds: ['g'] }),
            g: P('g', { firstName: 'Gus', parentIds: ['a1', 'dora'] }),
        };
        const partnerships = {
            ua: { id: 'ua', person1Id: 'karl', person2Id: 'anna', childIds: ['a1'], status: 'married', startDate: '1880' },
            ub: { id: 'ub', person1Id: 'karl', person2Id: 'berta', childIds: ['b1'], status: 'married', startDate: '1890' },
            uc: { id: 'uc', person1Id: 'karl', person2Id: 'cilka', childIds: ['c1'], status: 'married', startDate: '1900' },
            ud: { id: 'ud', person1Id: 'a1', person2Id: 'dora', childIds: ['g'], status: 'married' },
        };
        await window.Strom.DataManager.importAsNewTree({ persons, partnerships } as never, 'Lind');
        await window.Strom.TreeRenderer.setFocus('g' as never);
    });
    const karl = cardOf(page, 'karl');
    await expect(karl).toBeVisible();
    await expect(cardOf(page, 'b1')).toHaveCount(0);
    await expect(cardOf(page, 'c1')).toHaveCount(0);
    // No ⌂ for the other families: "▸ children" promises them, with the partners
    await expect(page.locator('.hidden-families-btn')).toHaveCount(0);
    const tab = karl.locator('.edge-top-right .branch-tab.children-tab');
    await expect(tab).toHaveClass(/kind-place/);
    await expect(tab.locator('.badge-tooltip-group')).toHaveText(['∞ 2 · Berta Lind', '∞ 3 · Cilka Lind']);
    await expect(tab.locator('.badge-tooltip-item')).toHaveText(['Bo Lind', 'Cid Lind']);
    await expect(tab.locator('.badge-tooltip-action')).toHaveText('A click shows them here with the partners; the view stays.');
    await tab.click();
    for (const id of ['b1', 'c1', 'berta', 'cilka']) await expect(cardOf(page, id)).toBeVisible();
});
