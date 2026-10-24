import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { openApp } from './helpers.js';

/**
 * "▸ children" on a card that is itself shown in place (GitHub #4, §6): the
 * partner a shown child comes with has children of their own out of view, and
 * the tab on the partner's card shows them in place, as the child's own tab
 * does. edge-shown-child-family (invented): the focus Ilse's ancestor g5
 * (five rows up) has two sons out of view; s4a is married twice (s4aw1 with
 * s4a1 and s4a2, s4aw2 with s4a3 and s4a4). g5's "▸ children" brings the
 * sons with their wives; s4aw1's "▸ children" then shows her two children,
 * and hiding them gives back the view of the first click.
 */

const OUTER = 'g5';
const PARTNER = 's4aw1';
const HER_CHILDREN = ['s4a1', 's4a2'];
const OTHER_MARRIAGE = ['s4a3', 's4a4'];

const cardOf = (page: Page, id: string) => page.locator(`#tree-canvas .person-card[data-id="${id}"]`);
const tabOf = (page: Page, id: string) => cardOf(page, id).locator('.edge-top-right .branch-tab.children-tab');

async function setup(page: Page): Promise<void> {
    await openApp(page);
    const data = JSON.parse(readFileSync(join(process.cwd(), 'test', 'edge-shown-child-family.json'), 'utf-8'));
    await page.evaluate(async tree => {
        await window.Strom.DataManager.importAsNewTree(tree as never, 'Nested');
        await window.Strom.TreeRenderer.setFocus('focus' as never);
    }, data);
    await expect(cardOf(page, OUTER)).toBeVisible();
    await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), OUTER);
}

/** Every drawn card's centre on the screen, by id (a zoom around a card keeps its centre). */
async function screenPositions(page: Page): Promise<Record<string, [number, number]>> {
    return page.evaluate(() => {
        const out: Record<string, [number, number]> = {};
        for (const c of document.querySelectorAll<HTMLElement>('#tree-canvas .person-card[data-id]')) {
            const r = c.getBoundingClientRect();
            out[c.dataset.id!] = [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)];
        }
        return out;
    });
}

test('a shown child\'s wife: her "▸ children" shows her children in place, the tab stays, hiding gives back the view', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setup(page);
    const start = await screenPositions(page);
    const startScale = await page.evaluate(() => window.Strom.ZoomPan.getScale());
    await tabOf(page, OUTER).click();
    await page.mouse.move(5, 500);
    await expect(cardOf(page, PARTNER)).toBeVisible();
    await expect(cardOf(page, PARTNER)).toHaveClass(/shown-here/);
    for (const id of [...HER_CHILDREN, ...OTHER_MARRIAGE]) await expect(cardOf(page, id), id).toHaveCount(0);
    const firstStep = await screenPositions(page);

    // The wife's tab promises her children; a click draws them, it never just goes away
    const tab = tabOf(page, PARTNER);
    await expect(tab).toHaveCount(1);
    await expect(tab.locator('.pill-glyph')).toHaveText('▸');
    await expect(tab.locator('.badge-tooltip-item')).toHaveCount(HER_CHILDREN.length);
    await tab.click();
    await page.mouse.move(5, 500);
    for (const id of HER_CHILDREN) {
        await expect(cardOf(page, id), id).toBeVisible();
        await expect(cardOf(page, id), id).toHaveClass(/shown-here/);
    }
    for (const id of OTHER_MARRIAGE) await expect(cardOf(page, id), id).toHaveCount(0);
    // Each child hangs on a line from its parents
    const drops = await page.evaluate(() => (window.Strom.TreeRenderer as unknown as { connections: { drops: { personId: string }[] }[] }).connections.flatMap(c => c.drops.map(d => d.personId)));
    for (const id of HER_CHILDREN) expect(drops).toContain(id);
    // Her card keeps its place (the view may zoom out around it); the tab is now the hide control of a nested expansion (§6: "◎ Focus on …" in its bubble)
    await expect.poll(async () => (await screenPositions(page))[PARTNER]).toEqual(firstStep[PARTNER]);
    const hide = tabOf(page, PARTNER);
    await expect(hide).toHaveAttribute('aria-pressed', 'true');
    await expect(hide.locator('.pill-glyph')).toHaveText('▾');
    await expect(cardOf(page, PARTNER).locator('.children-bubble .nested-focus-row')).toHaveCount(1);

    // Hiding gives back the view of the first click; the tab stays on offer
    await hide.click();
    await page.mouse.move(5, 500);
    for (const id of HER_CHILDREN) await expect(cardOf(page, id), id).toHaveCount(0);
    await expect.poll(() => screenPositions(page)).toEqual(firstStep);
    await expect(tabOf(page, PARTNER)).toHaveAttribute('aria-pressed', 'false');

    // Shown again, then the outer tab closes both: the layout and the scale
    // of the start (the outer card keeps its place on the screen, so the
    // cards stand as at the start around it)
    await tabOf(page, PARTNER).click();
    await expect(cardOf(page, HER_CHILDREN[0])).toBeVisible();
    await tabOf(page, OUTER).click();
    await page.mouse.move(5, 500);
    for (const id of [PARTNER, ...HER_CHILDREN]) await expect(cardOf(page, id), id).toHaveCount(0);
    expect(await page.evaluate(() => window.Strom.ZoomPan.getScale())).toBe(startScale);
    const around = (all: Record<string, [number, number]>) => Object.fromEntries(Object.entries(all)
        .map(([id, [x, y]]) => [id, [x - all[OUTER][0], y - all[OUTER][1]]]));
    await expect.poll(async () => around(await screenPositions(page))).toEqual(around(start));

    // And with both shown, "Hide shown" gives back the view before them, every card where it stood
    const closed = await screenPositions(page);
    await tabOf(page, OUTER).click();
    await expect(cardOf(page, PARTNER)).toBeVisible();
    await tabOf(page, PARTNER).click();
    await expect(cardOf(page, HER_CHILDREN[0])).toBeVisible();
    await page.evaluate(() => window.Strom.TreeRenderer.hideAllShownChildren());
    await page.mouse.move(5, 500);
    for (const id of [PARTNER, ...HER_CHILDREN]) await expect(cardOf(page, id), id).toHaveCount(0);
    await expect.poll(() => screenPositions(page)).toEqual(closed);
});

test.describe('phone 390 × 844', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('a shown child\'s wife: her tab shows her children by touch and hides them again', async ({ page }) => {
        await setup(page);
        await tabOf(page, OUTER).tap();
        await expect(cardOf(page, PARTNER)).toBeVisible();
        await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), PARTNER);
        const firstStep = await screenPositions(page);
        await tabOf(page, PARTNER).tap();
        for (const id of HER_CHILDREN) await expect(cardOf(page, id), id).toBeVisible();
        await expect(tabOf(page, PARTNER)).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(async () => (await screenPositions(page))[PARTNER]).toEqual(firstStep[PARTNER]);
        await tabOf(page, PARTNER).tap();
        for (const id of HER_CHILDREN) await expect(cardOf(page, id), id).toHaveCount(0);
        await expect(tabOf(page, PARTNER)).toHaveAttribute('aria-pressed', 'false');
        await expect.poll(() => screenPositions(page)).toEqual(firstStep);
    });
});
