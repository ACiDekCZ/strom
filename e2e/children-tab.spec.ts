import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { openApp, seedTree } from './helpers.js';

/**
 * The children tab (GitHub #4): a card whose person has children out of view
 * carries "▸ children" on its top edge; a click shows the children in place
 * (the focus, depth and zoom stay, the card keeps its place on the screen),
 * the tab turns into "▾ children" and a second click hides them again — the
 * view as it was. The person menu offers the same (the bottom sheet on a
 * phone). The comprehensive fixture (invented data), focus on a grandchild:
 * the focus's father stands three rows up, his other children (the focus's
 * siblings and a half-sibling with the stepmother) out of view.
 */

const FOCUS = 'grandchild_1';
const ANCESTOR = 'father';
const SIBLINGS = ['sibling_1', 'sibling_2'];
const HALF = 'halfsibling_1';
const STEP = 'stepmother';

const cardOf = (page: Page, id: string) => page.locator(`#tree-canvas .person-card[data-id="${id}"]`);
const tabOf = (page: Page, id: string) => cardOf(page, id).locator('.edge-top-right .branch-tab.children-tab');

async function setup(page: Page, focus = FOCUS): Promise<void> {
    await openApp(page);
    const data = JSON.parse(readFileSync(join(process.cwd(), 'test', 'comprehensive.json'), 'utf-8'));
    await page.evaluate(async ([tree, f]) => {
        await window.Strom.DataManager.importAsNewTree(tree as never, 'Comprehensive');
        await window.Strom.TreeRenderer.setFocus(f as never);
    }, [data, focus] as const);
    await expect(cardOf(page, ANCESTOR)).toBeVisible();
    // The father stands three rows up, under the toolbar: bring him to the middle
    await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), ANCESTOR);
}

/** Every drawn card's position on the screen, by id. */
async function screenPositions(page: Page): Promise<Record<string, [number, number]>> {
    return page.evaluate(() => {
        const out: Record<string, [number, number]> = {};
        for (const c of document.querySelectorAll<HTMLElement>('#tree-canvas .person-card[data-id]')) {
            const r = c.getBoundingClientRect();
            out[c.dataset.id!] = [Math.round(r.left), Math.round(r.top)];
        }
        return out;
    });
}

test('a direct-line ancestor: children shown in place, the card stays, a second click returns the view', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setup(page);
    // The expanded display (the default) draws the father's second wife; their child stays out of view
    await expect(cardOf(page, STEP)).toBeVisible();
    for (const id of [...SIBLINGS, HALF]) await expect(cardOf(page, id)).toHaveCount(0);
    const tab = tabOf(page, ANCESTOR);
    await expect(tab).toHaveCount(1);
    await expect(tab.locator('.pill-glyph')).toHaveText('▸');
    await expect(tab.locator('.pill-text')).toHaveText('children');
    await expect(tab).toHaveAttribute('aria-pressed', 'false');
    await expect(tab).toHaveAttribute('aria-label', /^Show the children of .+ here$/);
    // The bubble names the children out of view and what a click does
    await expect(tab.locator('.badge-tooltip-item')).toHaveCount(3);
    await expect(tab.locator('.badge-tooltip-hint')).toHaveText('A click shows them here; the view stays.');

    const before = await screenPositions(page);
    const scale = await page.evaluate(() => window.Strom.ZoomPan.getScale());
    await tab.click();
    for (const id of [...SIBLINGS, HALF]) await expect(cardOf(page, id)).toBeVisible();
    // Off the card: the hover lift would move its rectangle
    await page.mouse.move(5, 500);
    // The focus and zoom stay; the clicked card keeps its place on the screen
    expect(await page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId())).toBe(FOCUS);
    expect(await page.evaluate(() => window.Strom.ZoomPan.getScale())).toBe(scale);
    await expect.poll(async () => (await screenPositions(page))[ANCESTOR]).toEqual(before[ANCESTOR]);
    // The tab is now the hide control
    const hide = tabOf(page, ANCESTOR);
    await expect(hide).toHaveClass(/active/);
    await expect(hide).toHaveAttribute('aria-pressed', 'true');
    await expect(hide.locator('.pill-glyph')).toHaveText('▾');
    await expect(hide.locator('.badge-tooltip-header')).toHaveText('Children shown here');
    // Each shown child hangs on a line from its parents (no card left without one)
    const drops = await page.evaluate(() => (window.Strom.TreeRenderer as unknown as { connections: { drops: { personId: string }[] }[] }).connections.flatMap(c => c.drops.map(d => d.personId)));
    for (const id of [...SIBLINGS, HALF]) expect(drops).toContain(id);

    await hide.click();
    await page.mouse.move(5, 500);
    for (const id of [...SIBLINGS, HALF]) await expect(cardOf(page, id)).toHaveCount(0);
    await expect(tabOf(page, ANCESTOR)).toHaveAttribute('aria-pressed', 'false');
    // The view as it was: every card where it stood
    await expect.poll(() => screenPositions(page)).toEqual(before);
});

test('the person menu shows and hides the children; a new focus starts without them', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setup(page);
    await cardOf(page, ANCESTOR).click({ position: { x: 60, y: 40 } });
    const show = page.locator('.context-menu .context-menu-item[data-action="toggle-children"]');
    await expect(show).toHaveText('Show children here');
    await show.click();
    for (const id of SIBLINGS) await expect(cardOf(page, id)).toBeVisible();
    await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), ANCESTOR);
    await cardOf(page, ANCESTOR).click({ position: { x: 60, y: 40 } });
    await expect(page.locator('.context-menu .context-menu-item[data-action="toggle-children"]')).toHaveText('Hide shown children');
    await page.keyboard.press('Escape');

    // Another focus: the shown children belong to the view they were shown in
    await page.evaluate(() => window.Strom.TreeRenderer.setFocus('child_1' as never));
    await page.evaluate(f => window.Strom.TreeRenderer.setFocus(f as never), FOCUS);
    for (const id of SIBLINGS) await expect(cardOf(page, id)).toHaveCount(0);
    await expect(tabOf(page, ANCESTOR)).toHaveAttribute('aria-pressed', 'false');
});

test('the keyboard: the tab is a button, Enter shows and hides', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setup(page);
    await tabOf(page, ANCESTOR).focus();
    await page.keyboard.press('Enter');
    await expect(cardOf(page, SIBLINGS[0])).toBeVisible();
    await tabOf(page, ANCESTOR).focus();
    await page.keyboard.press('Enter');
    await expect(cardOf(page, SIBLINGS[0])).toHaveCount(0);
});

test('a father of two families in the standard display: both families\' children, each under its own couple', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setup(page, 'focus');
    // The standard display draws one union per person: the stepmother's family is out of view
    await page.evaluate(() => window.Strom.TreeRenderer.toggleShowAllPartnerships());
    await expect(cardOf(page, HALF)).toHaveCount(0);
    await tabOf(page, ANCESTOR).click();
    await expect(cardOf(page, HALF)).toBeVisible();
    await expect(cardOf(page, STEP)).toBeVisible();
    // The half-sibling's line comes from the father's couple with the stepmother
    const parents = await page.evaluate(half => {
        const conns = (window.Strom.TreeRenderer as unknown as { connections: { drops: { personId: string }[] }[] }).connections;
        const conn = conns.find(c => c.drops.some(d => d.personId === half));
        const data = window.Strom.DataManager.getData();
        const union = Object.values(data.partnerships).find(u => u.childIds.includes(half as never))!;
        return { found: !!conn, parents: [union.person1Id, union.person2Id].sort() };
    }, HALF);
    expect(parents).toEqual({ found: true, parents: [ANCESTOR, STEP].sort() });
});

test('every card keeps its tabs within its own width (three tabs, German words): the glyphs alone where the words do not fit', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setup(page);
    for (const lang of ['en', 'de'] as const) {
        await page.evaluate(l => window.Strom.UI.setLanguage(l as never), lang);
        for (const focus of [FOCUS, 'focus', ANCESTOR]) {
            await page.evaluate(f => window.Strom.TreeRenderer.setFocus(f as never), focus);
            await page.evaluate(() => document.fonts.ready);
            const bad = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#tree-canvas .person-card')].flatMap(card => {
                const row = card.querySelector<HTMLElement>(':scope > .edge-top-right');
                const tabs = row ? [...row.querySelectorAll<HTMLElement>(':scope > .branch-tab')] : [];
                if (tabs.length === 0) return [];
                const c = card.getBoundingClientRect();
                const left = Math.min(...tabs.map(t => t.getBoundingClientRect().left));
                return left < c.left ? [`${card.dataset.id}: ${tabs.length} tabs start ${Math.round(c.left - left)}px left of the card`] : [];
            }));
            expect(bad, `${lang}, focus ${focus}`).toEqual([]);
        }
    }
});

test('a grandfather with parents, a brother and a son of his second marriage out of view: three tabs in glyphs alone, the children shown in place', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
    await seedTree(page, {
        c: { firstName: 'Quirin', lastName: 'Zwolbrack', parents: ['p', 'm'] },
        p: { firstName: 'Pirmin', lastName: 'Zwolbrack', parents: ['g1', 'g2'], partners: ['m'] },
        m: { firstName: 'Ilvana', lastName: 'Morquist', gender: 'female', partners: ['p'] },
        u: { firstName: 'Ulfried', lastName: 'Zwolbrack', parents: ['g1', 'g2'] },
        g1: { firstName: 'Wolfbrecht-Ottmund', lastName: 'Quabbenstedt-Zwolbrack', parents: ['gg1', 'gg2'], partners: ['g2', 'g3'] },
        g3: { firstName: 'Henrike', lastName: 'Vexholm', gender: 'female', partners: ['g1'] },
        h: { firstName: 'Hartwig', lastName: 'Vexholm', parents: ['g1', 'g3'] },
        g2: { firstName: 'Gerlinde', lastName: 'Zwolbrack', gender: 'female', partners: ['g1'] },
        s: { firstName: 'Sigwulf', lastName: 'Zwolbrack', parents: ['gg1', 'gg2'] },
        gg1: { firstName: 'Arbogast', lastName: 'Zwolbrack', partners: ['gg2'] },
        gg2: { firstName: 'Adelgunde', lastName: 'Zwolbrack', gender: 'female', partners: ['gg1'] },
    }, 'Zwolbrack', 'c');
    await page.evaluate(() => window.Strom.TreeRenderer.setFocusDepth(2, 1));
    const row = cardOf(page, 'g1').locator(':scope > .edge-top-right');
    await expect(row.locator(':scope > .branch-tab')).toHaveCount(3);
    await expect(row).toHaveClass(/tabs-glyph/);
    // The words stay for screen readers, the glyph alone on the screen
    await expect(row.locator('.children-tab')).toHaveAttribute('aria-label', /^Kinder von .+ hier zeigen$/);
    expect(await row.locator('.children-tab .pill-text').evaluate(el => el.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
    const inCard = await cardOf(page, 'g1').evaluate(card => {
        const c = card.getBoundingClientRect();
        return [...card.querySelectorAll(':scope > .edge-top-right > .branch-tab')].every(t => t.getBoundingClientRect().left >= c.left);
    });
    expect(inCard).toBe(true);
    await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), 'g1');
    await row.locator('.children-tab').click();
    await expect(cardOf(page, 'h')).toBeVisible();
    await expect(row.locator('.children-tab')).toHaveAttribute('aria-pressed', 'true');
});

test.describe('phone 390 × 844', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the bottom sheet offers the children right under the tiles; the tab works by touch', async ({ page }) => {
        await setup(page);
        await cardOf(page, ANCESTOR).tap({ position: { x: 40, y: 30 } });
        const sheet = page.locator('.bottom-sheet-person');
        await expect(sheet).toBeVisible();
        const row = sheet.locator('[data-action="toggle-children"]');
        await expect(row).toHaveText(/Show children here/);
        await row.tap();
        await expect(sheet).toHaveCount(0);
        for (const id of SIBLINGS) await expect(cardOf(page, id)).toHaveCount(1);
        await tabOf(page, ANCESTOR).tap();
        for (const id of SIBLINGS) await expect(cardOf(page, id)).toHaveCount(0);
    });
});
