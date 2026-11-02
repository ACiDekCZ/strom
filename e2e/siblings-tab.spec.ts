import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { openApp } from './helpers.js';

/**
 * Siblings shown in place (GitHub #4): a card whose parent is in view
 * carries "▸ siblings"; a click shows the children of the parents in view
 * (both, of every marriage) in one step — the card keeps its place, it turns
 * to "▾ siblings" and the parents' tabs to "▾ children"; any of them hides
 * them all again. The comprehensive fixture (invented data), focus on a
 * grandchild: "Focus Person" stands two rows up with both parents, the
 * siblings (and a half-sibling with the stepmother) out of view.
 */

const FOCUS = 'grandchild_1';
const PERSON = 'focus';
const PARENTS = ['father', 'mother'];
const SIBLINGS = ['sibling_1', 'sibling_2', 'halfsibling_1'];

const cardOf = (page: Page, id: string) => page.locator(`#tree-canvas .person-card[data-id="${id}"]`);
const siblingsTab = (page: Page, id: string) => cardOf(page, id).locator('.edge-top-right .branch-tab.siblings-tab');
const childrenTab = (page: Page, id: string) => cardOf(page, id).locator('.edge-top-right .branch-tab.children-tab');
const shownCount = (page: Page) => page.evaluate(() => window.Strom.TreeRenderer.shownChildrenCount());

async function setup(page: Page): Promise<void> {
    await openApp(page);
    const data = JSON.parse(readFileSync(join(process.cwd(), 'test', 'comprehensive.json'), 'utf-8'));
    await page.evaluate(async ([tree, f]) => {
        await window.Strom.DataManager.importAsNewTree(tree as never, 'Comprehensive');
        await window.Strom.TreeRenderer.setFocus(f as never);
    }, [data, FOCUS] as const);
    await expect(cardOf(page, PERSON)).toBeVisible();
    await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), PERSON);
}

/** Another invented fixture with its focus. */
async function setupFixture(page: Page, fixture: string, focus: string): Promise<void> {
    await openApp(page);
    const data = JSON.parse(readFileSync(join(process.cwd(), 'test', `${fixture}.json`), 'utf-8'));
    await page.evaluate(async ([tree, f]) => {
        await window.Strom.DataManager.importAsNewTree(tree as never, 'Elsewhere');
        await window.Strom.TreeRenderer.setFocus(f as never);
    }, [data, focus] as const);
    await expect(cardOf(page, focus)).toBeVisible();
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

test('"▸ siblings" shows the children of both parents in one step; the card stays; "▾ children" on the father hides them all', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setup(page);
    await page.mouse.move(5, 500);
    for (const id of SIBLINGS) await expect(cardOf(page, id)).toHaveCount(0);
    const tab = siblingsTab(page, PERSON);
    await expect(tab).toHaveCount(1);
    await expect(tab.locator('.pill-glyph')).toHaveText('▸');
    await expect(tab.locator('.pill-text')).toHaveText('siblings');
    await expect(tab).toHaveAttribute('aria-pressed', 'false');
    await expect(tab).toHaveAttribute('aria-label', /^Show the siblings of .+ here$/);
    // The bubble: the siblings by group, the same people as the parents' "▸ children", what a click does
    await expect(tab.locator('.badge-tooltip-header')).toHaveText('Siblings');
    await expect(tab.locator('.badge-tooltip-group')).toHaveText(['Full siblings', /^Half siblings · Father.* and Stepmother.*$/]);
    await expect(tab.locator('.badge-tooltip-item')).toHaveCount(3);
    await expect(tab.locator('.badge-tooltip-body')).toHaveText('The same people as “▸ children” on the parents.');
    await expect(tab.locator('.badge-tooltip-action')).toHaveText('A click shows them here; the view stays.');

    const before = await screenCenters(page);
    await tab.click();
    for (const id of SIBLINGS) await expect(cardOf(page, id)).toBeVisible();
    await page.mouse.move(5, 500);
    expect(await page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId())).toBe(FOCUS);
    // The clicked card keeps its place on the screen
    await expect.poll(async () => near((await screenCenters(page))[PERSON], before[PERSON])).toBe(true);
    // One state: the person's "▾ siblings", both parents' "▾ children", one step to hide
    const hide = siblingsTab(page, PERSON);
    await expect(hide).toHaveClass(/active/);
    await expect(hide).toHaveAttribute('aria-pressed', 'true');
    await expect(hide.locator('.pill-glyph')).toHaveText('▾');
    for (const id of PARENTS) await expect(childrenTab(page, id)).toHaveClass(/active/);
    expect(await shownCount(page)).toBe(1);
    await expect(page.locator('#hide-shown-children')).toHaveText('▾Hide shown · 1');
    expect(await page.evaluate(id => window.Strom.TreeRenderer.isSiblingsShown(id as never), PERSON)).toBe(true);
    // The bubble beside the tab: who was shown, through which parents, what a click does
    const bubble = cardOf(page, PERSON).locator('.siblings-bubble');
    await expect(bubble.locator('> .badge-tooltip-header')).toHaveText('Siblings shown here');
    await expect(bubble.locator('.badge-tooltip-item')).toHaveCount(3);
    await expect(bubble.locator('.badge-tooltip-body')).toHaveText(/^Shown as the children of the parents: Father .+, Mother .+\.$/);
    await expect(bubble.locator('.badge-tooltip-action')).toHaveText('A click on the tab hides them again, on the parents too.');
    // The active tabs glow for a moment after the transition
    await expect(hide).toHaveClass(/tab-glow/);
    await expect(childrenTab(page, 'father')).toHaveClass(/tab-glow/);

    // The father's "▾ children" closes the whole step, the mother's too
    await childrenTab(page, 'father').click();
    await page.mouse.move(5, 500);
    for (const id of SIBLINGS) await expect(cardOf(page, id)).toHaveCount(0);
    expect(await shownCount(page)).toBe(0);
    await expect(page.locator('#tree-canvas .branch-tab.active')).toHaveCount(0);
    await expect(siblingsTab(page, PERSON)).toHaveAttribute('aria-pressed', 'false');
    // The view as it was: every card where it stood (the father kept his place)
    const after = await screenCenters(page);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    const dx = after.father[0] - before.father[0], dy = after.father[1] - before.father[1];
    for (const [id, at] of Object.entries(before)) expect(near(after[id], [at[0] + dx, at[1] + dy]), id).toBe(true);
});

/**
 * At ancestor depth 1 (focus "Focus Person") the grandparents lie beyond the
 * depth: the father's "▸ siblings" shows them with their children, the aunt
 * and the uncle, and these come as every child shown in place comes, with
 * their partners (hatched, in view only thanks to the step) and without
 * their children: the cousins wait for the uncle's own "▸ children".
 */
test('at depth 1 "▸ siblings" on the father brings the aunt and the uncle with their partners, hatched, not the cousins; closing gives the view back', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    const data = JSON.parse(readFileSync(join(process.cwd(), 'test', 'comprehensive.json'), 'utf-8'));
    await page.evaluate(async ([tree, f]) => {
        await window.Strom.DataManager.importAsNewTree(tree as never, 'Comprehensive');
        await window.Strom.TreeRenderer.setFocus(f as never);
        window.Strom.TreeRenderer.setFocusDepth(1, window.Strom.TreeRenderer.getFocusDepthDown());
    }, [data, 'focus'] as const);
    await expect(cardOf(page, 'father')).toBeVisible();
    await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), 'father');
    const auntsAndUncles = ['uncle_h_1', 'aunt_h_1'];
    const partners = ['aunt_h_1_spouse', 'uncle_h_1_husband'];
    const cousins = ['cousin_h_1', 'cousin_h_2', 'cousin_h_3', 'cousin_h_4'];
    for (const id of [...auntsAndUncles, ...partners, ...cousins]) await expect(cardOf(page, id)).toHaveCount(0);
    await page.mouse.move(5, 500);
    const before = await screenCenters(page);

    await siblingsTab(page, 'father').click();
    for (const id of [...auntsAndUncles, ...partners]) await expect(cardOf(page, id), id).toBeVisible();
    await page.mouse.move(5, 500);
    for (const id of [...auntsAndUncles, ...partners]) await expect(cardOf(page, id), id).toHaveClass(/shown-here/);
    for (const id of cousins) await expect(cardOf(page, id), id).toHaveCount(0);
    expect(await shownCount(page)).toBe(1);

    // One click closes the step: the partners leave with the aunt and the uncle, every card back in its place
    await siblingsTab(page, 'father').click();
    await page.mouse.move(5, 500);
    for (const id of [...auntsAndUncles, ...partners]) await expect(cardOf(page, id), id).toHaveCount(0);
    expect(await shownCount(page)).toBe(0);
    const after = await screenCenters(page);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    const dx = after.father[0] - before.father[0], dy = after.father[1] - before.father[1];
    for (const [id, at] of Object.entries(before)) expect(near(after[id], [at[0] + dx, at[1] + dy]), id).toBe(true);
});

test('↩ after "▸ siblings" is one step back; ↪ brings the siblings step again', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setup(page);
    const couldGoBack = await page.evaluate(() => window.Strom.TreeRenderer.canGoBack());
    await siblingsTab(page, PERSON).click();
    for (const id of SIBLINGS) await expect(cardOf(page, id)).toBeVisible();
    await page.evaluate(() => window.Strom.TreeRenderer.goBack());
    for (const id of SIBLINGS) await expect(cardOf(page, id)).toHaveCount(0);
    expect(await shownCount(page)).toBe(0);
    expect(await page.evaluate(() => window.Strom.TreeRenderer.canGoBack())).toBe(couldGoBack);
    await page.evaluate(() => window.Strom.TreeRenderer.goForward());
    for (const id of SIBLINGS) await expect(cardOf(page, id)).toBeVisible();
    await expect(siblingsTab(page, PERSON)).toHaveClass(/active/);
    expect(await shownCount(page)).toBe(1);
    // Still one step: the person's tab closes both parents
    await siblingsTab(page, PERSON).click();
    for (const id of SIBLINGS) await expect(cardOf(page, id)).toHaveCount(0);
    expect(await shownCount(page)).toBe(0);
});

test('the father\'s own "▸ children" turns the person\'s tab to "▾ siblings"; it hides them again', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setup(page);
    await childrenTab(page, 'father').click();
    for (const id of SIBLINGS) await expect(cardOf(page, id)).toBeVisible();
    await expect(siblingsTab(page, PERSON)).toHaveClass(/active/);
    await expect(siblingsTab(page, PERSON).locator('.pill-glyph')).toHaveText('▾');
    await siblingsTab(page, PERSON).click();
    for (const id of SIBLINGS) await expect(cardOf(page, id)).toHaveCount(0);
    expect(await shownCount(page)).toBe(0);
});

test('the person menu: "Show siblings here" with the count above the children row, then "Hide the siblings shown here"', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setup(page);
    await cardOf(page, PERSON).click({ position: { x: 60, y: 40 } });
    const items = page.locator('.context-menu .context-menu-item');
    const show = page.locator('.context-menu .context-menu-item[data-action="toggle-siblings"]');
    await expect(show).toContainText('Show siblings here');
    await expect(show.locator('.menu-item-meta')).toHaveText('3');
    const actions = await items.evaluateAll(els => els.map(e => (e as HTMLElement).dataset.action));
    if (actions.includes('toggle-children')) expect(actions.indexOf('toggle-siblings')).toBeLessThan(actions.indexOf('toggle-children'));
    await show.click();
    for (const id of SIBLINGS) await expect(cardOf(page, id)).toBeVisible();
    // Back to the scale of 1 (the step zoomed out as far as the siblings needed, §5), the card in the middle
    await page.evaluate(async id => {
        window.Strom.ZoomPan.reset();
        await new Promise(r => setTimeout(r, 0));
        window.Strom.ZoomPan.centerOnPerson(id as never);
    }, PERSON);
    await cardOf(page, PERSON).click({ position: { x: 60, y: 40 } });
    const hide = page.locator('.context-menu .context-menu-item[data-action="toggle-siblings"]');
    await expect(hide).toHaveText('Hide the siblings shown here');
    await hide.click();
    for (const id of SIBLINGS) await expect(cardOf(page, id)).toHaveCount(0);
});

/**
 * A sibling drawn elsewhere in the tree (edge-children-elsewhere, invented:
 * the mother's sister Ilse married the father's brother and stands by him):
 * the mother's menu names her under "Already in the tree elsewhere" as it
 * names a child drawn elsewhere, a row that moves the view to her card.
 */
test('the person menu: a sibling drawn elsewhere is a row of "Already in the tree elsewhere" that moves the view', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setupFixture(page, 'edge-children-elsewhere', 'focus');
    await expect(siblingsTab(page, 'mother')).toHaveCount(1);
    await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), 'mother');
    await cardOf(page, 'mother').click({ position: { x: 60, y: 40 } });
    const row = page.locator('.context-menu [data-action="child-elsewhere:aunt"]');
    await expect(row).toHaveText(/Ilse Varnhag \*1951/);
    await expect(row).toHaveAttribute('aria-label', 'Move the view to the card of Ilse Varnhag');
    await expect(page.locator('.context-menu .menu-section-header')).toContainText(['Already in the tree elsewhere']);
    // Under the siblings row
    const actions = await page.locator('.context-menu .context-menu-item').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.action));
    expect(actions.indexOf('child-elsewhere:aunt')).toBeGreaterThan(actions.indexOf('toggle-siblings'));
    await row.click();
    await expect(cardOf(page, 'aunt')).toHaveClass(/children-glow/);
    await expect.poll(() => page.evaluate(() => {
        const c = document.querySelector<HTMLElement>('#tree-canvas .person-card[data-id="aunt"]')!.getBoundingClientRect();
        const t = document.getElementById('tree-container')!.getBoundingClientRect();
        return Math.abs(c.left + c.width / 2 - (t.left + t.width / 2)) <= 3;
    })).toBe(true);
});

/** The lowest bar over the tree (the toolbar, the focus bar), as a function source for page.evaluate. */
const barsBottom = (): number => Math.max(0, ...['.toolbar', '#focus-controls']
    .map(s => document.querySelector<HTMLElement>(s))
    .filter((e): e is HTMLElement => !!e && e.getClientRects().length > 0)
    .map(e => e.getBoundingClientRect().bottom));

/** Pan the tree so the person's card stands `below` px under the bars, `x` its left edge on the screen (unchanged when null). */
async function cardUnderBars(page: Page, id: string, below: number, x: number | null = null): Promise<void> {
    await page.evaluate(([fn, pid, b, left]) => {
        const bars = new Function(`return (${fn})()`)() as number;
        const card = document.querySelector<HTMLElement>(`#tree-canvas .person-card[data-id="${pid}"]`)!.getBoundingClientRect();
        const zp = window.Strom.ZoomPan;
        zp.shiftWorld(left === null ? 0 : (card.left - (left as number)) / zp.getScale(), (card.top - (bars + (b as number))) / zp.getScale());
    }, [barsBottom.toString(), id, below, x] as const);
}

/** The card's hover growth (or its shrinking back) has ended. */
async function settled(page: Page, id: string): Promise<void> {
    await cardOf(page, id).evaluate(c => Promise.all(c.getAnimations().map(a => a.finished)));
}

/** The person's card and the open bubble of its siblings tab, on the screen. */
async function cardAndBubble(page: Page, id: string) {
    return page.evaluate(([fn, pid]) => {
        const card = document.querySelector<HTMLElement>(`#tree-canvas .person-card[data-id="${pid}"]`)!;
        const b = card.querySelector<HTMLElement>('.siblings-tab > .badge-tooltip')!.getBoundingClientRect();
        const c = card.getBoundingClientRect();
        const t = document.getElementById('tree-container')!.getBoundingClientRect();
        const bars = new Function(`return (${fn})()`)() as number;
        return { card: { left: c.left, right: c.right, top: c.top }, bubble: { left: b.left, right: b.right, top: b.top, bottom: b.bottom }, tree: { left: t.left, right: t.right, bottom: t.bottom }, bars, innerHeight: window.innerHeight };
    }, [barsBottom.toString(), id] as const);
}

test('at 1024 × 768 the tall "▸ siblings" bubble of a card just under the bars opens beside the card, its top at the card\'s top', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await setup(page);
    await cardUnderBars(page, PERSON, 60, 300);
    const tab = siblingsTab(page, PERSON);
    await tab.hover();
    const bubble = tab.locator(':scope > .badge-tooltip');
    await expect(bubble).toBeVisible();
    await expect(bubble).toHaveClass(/\bbeside-right\b/);
    await expect(bubble).not.toHaveClass(/\bbelow\b/);
    const g = await cardAndBubble(page, PERSON);
    expect(Math.abs(g.bubble.top - g.card.top)).toBeLessThanOrEqual(2);
    expect(g.bubble.left).toBeGreaterThan(g.card.right);
    expect(g.bubble.right).toBeLessThanOrEqual(g.tree.right);
    expect(g.bubble.bottom).toBeLessThanOrEqual(g.tree.bottom);
});

test('beside the card on the left where the right has no room for the bubble', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await setup(page);
    // the card's right edge 60 px from the tree's right edge
    await cardUnderBars(page, PERSON, 60, 1024 - 60 - 194);
    const tab = siblingsTab(page, PERSON);
    await tab.hover();
    const bubble = tab.locator(':scope > .badge-tooltip');
    await expect(bubble).toHaveClass(/\bbeside-left\b/);
    const g = await cardAndBubble(page, PERSON);
    expect(Math.abs(g.bubble.top - g.card.top)).toBeLessThanOrEqual(2);
    expect(g.bubble.right).toBeLessThan(g.card.left);
    expect(g.bubble.left).toBeGreaterThanOrEqual(g.tree.left);
});

test('below the tab only where it fits beside the card on neither side', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 900 });
    await setup(page);
    // zoomed in: the card wider than the room beside it on either side
    for (let i = 0; i < 3; i++) await page.evaluate(() => { window.Strom.ZoomPan.zoomIn(); window.Strom.ZoomPan.finishAnimation(); });
    await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), PERSON);
    await cardUnderBars(page, PERSON, 60);
    const tab = siblingsTab(page, PERSON);
    await tab.hover();
    const bubble = tab.locator(':scope > .badge-tooltip');
    await expect(bubble).toBeVisible();
    await expect(bubble).toHaveClass(/\bbelow\b/);
    await expect(bubble).not.toHaveClass(/beside/);
    const g = await cardAndBubble(page, PERSON);
    expect(g.bubble.top).toBeGreaterThanOrEqual(g.bars);
});

/**
 * A low screen (a window 390 px tall): a tall bubble fits whole neither
 * above nor below the tab nor beside the card at its top; it goes beside the
 * card all the same, moved up just enough to stand whole in the tree (it
 * opened above the tab and went under the bar).
 */
test('at 844 × 390 a bubble that fits nowhere whole opens beside the card, moved up into the tree', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await setup(page);
    const tab = siblingsTab(page, PERSON);
    const bubble = tab.locator(':scope > .badge-tooltip');
    await tab.hover();
    await expect(bubble).toBeVisible();
    const h = (await bubble.boundingBox())!.height;
    await page.mouse.move(5, 200);
    await expect(bubble).toBeHidden();
    const tree = (await page.locator('#tree-container').boundingBox())!;
    const bars = await page.evaluate(fn => new Function(`return (${fn})()`)() as number, barsBottom.toString());
    // the card's top 20 px lower than the bubble would fit beside it: too little room above, below and beside at its top
    const below = tree.y + tree.height - h + 20 - bars;
    expect(h + 12).toBeGreaterThan(below - 9);
    await cardUnderBars(page, PERSON, below, 150);
    await settled(page, PERSON);
    await tab.hover();
    await expect(bubble).toHaveClass(/\bbeside-right\b/);
    const g = await cardAndBubble(page, PERSON);
    expect(g.bubble.left).toBeGreaterThan(g.card.right);
    expect(g.bubble.top).toBeGreaterThanOrEqual(g.bars - 1);
    expect(g.bubble.bottom).toBeLessThanOrEqual(g.tree.bottom + 1);
    // whole in the window (#tree-container reaches under its bottom edge)
    expect(g.bubble.bottom).toBeLessThanOrEqual(g.innerHeight);
    expect(g.bubble.top).toBeLessThan(g.card.top);
    // the arrow still at the card's top
    const arrow = await bubble.evaluate(b => {
        const r = b.getBoundingClientRect();
        const ratio = r.width / b.offsetWidth;
        return { top: r.top + parseFloat(getComputedStyle(b, '::after').top) * ratio, ratio };
    });
    expect(Math.abs(arrow.top - (g.card.top + 14 * arrow.ratio))).toBeLessThanOrEqual(3);
});

/**
 * The card grows under the pointer (1.03); its bubble no longer grows with it
 * (round 3 §25) and stands whole in the window, 8 px from its edges, wherever
 * the card is (§24): edge-ancestor-children (invented), 844 × 390, the card
 * low in the tree, its 13-children bubble taller than the tree itself.
 */
test('at 844 × 390 a bubble taller than the tree stays whole in the window, 8 px from its edges, the card grown or not', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await setupFixture(page, 'edge-ancestor-children', 'focus');
    const person = 'f_m_f_m_f';
    await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), person);
    const tab = siblingsTab(page, person);
    const bubble = tab.locator(':scope > .badge-tooltip');
    await tab.hover();
    await expect(bubble).toBeVisible();
    const first = (await bubble.boundingBox())!;
    await page.mouse.move(5, 200);
    await expect(bubble).toBeHidden();
    const tree = (await page.locator('#tree-container').boundingBox())!;
    const bars = await page.evaluate(fn => new Function(`return (${fn})()`)() as number, barsBottom.toString());
    expect(first.height).toBeGreaterThan(tree.y + tree.height - bars);
    // the card near the tree's bottom
    await cardUnderBars(page, person, tree.y + tree.height - bars - 120, 100);
    await settled(page, person);
    await tab.hover();
    await expect(bubble).toBeVisible();
    await settled(page, person);
    const b = (await bubble.boundingBox())!;
    const vh = await page.evaluate(() => window.innerHeight);
    const vw = await page.evaluate(() => window.innerWidth);
    expect(b.y).toBeGreaterThanOrEqual(8 - 0.5);
    expect(b.y + b.height).toBeLessThanOrEqual(vh - 8 + 0.5);
    expect(b.x).toBeGreaterThanOrEqual(8 - 0.5);
    expect(b.x + b.width).toBeLessThanOrEqual(vw - 8 + 0.5);
    // the same size as before, wherever the card stands and however it has grown
    expect(Math.abs(b.width - first.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.height - first.height)).toBeLessThanOrEqual(1);
});

/**
 * More names than a bubble lists (§17 of round 2): edge-ancestor-children
 * (invented), an ancestor at the edge of the depth with 13 children: its
 * bubble names 8 and says "and 4 more" (the person's own card in view), the
 * line of what a click does stays last; the menu names them by the count.
 */
test('a bubble names 8 at most, then "and n more"; what the click does stays its last line', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setupFixture(page, 'edge-ancestor-children', 'focus');
    const person = 'f_m_f_m_f';
    await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), person);
    const tab = siblingsTab(page, person);
    await tab.hover();
    const bubble = tab.locator(':scope > .badge-tooltip');
    await expect(bubble).toBeVisible();
    await expect(bubble.locator('.badge-tooltip-item')).toHaveCount(8);
    await expect(bubble.locator('.badge-tooltip-more')).toHaveText('and 4 more');
    await expect(bubble.locator(':scope > :last-child')).toHaveClass(/badge-tooltip-action/);
    // No scrollbar: the bubble is as tall as its content, at most the window less 8 px above and below
    expect(await bubble.evaluate(b => b.scrollHeight <= b.clientHeight + 1 && getComputedStyle(b).overflowY !== 'auto' && getComputedStyle(b).overflowY !== 'scroll')).toBe(true);
    expect(await bubble.evaluate(b => parseFloat(getComputedStyle(b).maxHeight))).toBeCloseTo(900 - 16, 0);
    // The parent's "▸ children" too
    const children = cardOf(page, 'f_m_f_m_f_m').locator('.branch-tab.children-tab > .badge-tooltip');
    await expect(children.locator('.badge-tooltip-item')).toHaveCount(8);
    await expect(children.locator('.badge-tooltip-more')).toHaveText('and 4 more');
});

/**
 * A bubble over the zoom buttons (§18 of round 2): it lies over them while
 * it is open, the buttons stay where they are; with the bubble closed they
 * are on top again.
 */
test('a bubble over the zoom buttons lies above them; they do not move', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setup(page);
    const block = await page.locator('.control-block').boundingBox();
    expect(block).not.toBeNull();
    // the tab just left of the block, a little lower than its top: its bubble reaches over the block's corner
    await page.evaluate(([pid, x, y]) => {
        const t = document.querySelector<HTMLElement>(`#tree-canvas .person-card[data-id="${pid}"] .siblings-tab`)!.getBoundingClientRect();
        const zp = window.Strom.ZoomPan;
        zp.shiftWorld((t.left + t.width / 2 - (x as number)) / zp.getScale(), (t.top - (y as number)) / zp.getScale());
    }, [PERSON, block!.x - 40, block!.y + 30] as const);
    const tab = siblingsTab(page, PERSON);
    await tab.hover();
    const bubble = tab.locator(':scope > .badge-tooltip');
    await expect(bubble).toBeVisible();
    const b = (await bubble.boundingBox())!;
    // a point inside both the bubble and the block
    const px = Math.min(b.x + b.width, block!.x + block!.width) - 6;
    const py = Math.max(b.y, block!.y) + 6;
    expect(px).toBeGreaterThan(block!.x);
    expect(py).toBeLessThan(Math.min(b.y + b.height, block!.y + block!.height));
    const topAt = () => page.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return el?.closest('.badge-tooltip') ? 'bubble' : el?.closest('.control-block') ? 'controls' : el?.tagName ?? null;
    }, [px, py] as const);
    expect(await topAt()).toBe('bubble');
    expect(await page.locator('.control-block').boundingBox()).toEqual(block);
    // Closed: the buttons on top again
    await page.mouse.move(5, 500);
    await expect(bubble).toBeHidden();
    expect(await topAt()).toBe('controls');
});

/** What lies on top at a point: the bubble, the zoom buttons, a card or something else. */
const layerAt = (page: Page, x: number, y: number) => page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py);
    return el?.closest('.badge-tooltip') ? 'bubble' : el?.closest('.control-block') ? 'controls' : el?.closest('.person-card') ? 'card' : el?.tagName ?? null;
}, [x, y] as const);

/**
 * The layers (round 3 §23): tree < zoom buttons < bubble. A card under the
 * buttons never lies over them, with a bubble open or not (the whole tree
 * rose over the buttons while a bubble lay over them).
 */
test('a card under the zoom buttons stays under them, a bubble open or not', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setup(page);
    const button = (await page.locator('.control-block button:visible').first().boundingBox())!;
    const bx = button.x + button.width / 2, by = button.y + button.height / 2;
    // the card's lower half under the button's centre, its tab clear of the block
    await page.evaluate(([pid, x, y]) => {
        const c = document.querySelector<HTMLElement>(`#tree-canvas .person-card[data-id="${pid}"]`)!.getBoundingClientRect();
        const zp = window.Strom.ZoomPan;
        zp.shiftWorld((c.left + c.width / 2 - (x as number)) / zp.getScale(), (c.top + c.height * 0.75 - (y as number)) / zp.getScale());
    }, [PERSON, bx, by] as const);
    const card = (await cardOf(page, PERSON).boundingBox())!;
    expect(bx).toBeGreaterThan(card.x);
    expect(by).toBeLessThan(card.y + card.height);
    expect(await layerAt(page, bx, by)).toBe('controls');
    // a bubble open: the card still under the buttons
    await page.keyboard.press('Shift');
    await siblingsTab(page, PERSON).focus();
    const bubble = siblingsTab(page, PERSON).locator(':scope > .badge-tooltip');
    await expect(bubble).toBeVisible();
    expect(['controls', 'bubble']).toContain(await layerAt(page, bx, by));
    const b = (await bubble.boundingBox())!;
    if (bx < b.x || bx > b.x + b.width || by < b.y || by > b.y + b.height) expect(await layerAt(page, bx, by)).toBe('controls');
});

/**
 * The bubble stands outside the canvas (§25): the same size on the screen
 * at every zoom, the arrow at its tab.
 */
test('a bubble keeps its size on the screen at zoom 0.3, 1 and 3', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setup(page);
    const sizes: { scale: number; w: number; h: number }[] = [];
    for (const scale of [0.3, 1, 3]) {
        await page.mouse.move(5, 500);
        await page.evaluate(([pid, k]) => { window.Strom.ZoomPan.glideToPerson(pid as never, k as number, 1); window.Strom.ZoomPan.finishAnimation(); }, [PERSON, scale] as const);
        await expect.poll(() => page.evaluate(() => window.Strom.ZoomPan.getScale())).toBeCloseTo(scale, 2);
        const tab = siblingsTab(page, PERSON);
        await tab.hover();
        const bubble = tab.locator(':scope > .badge-tooltip');
        await expect(bubble).toBeVisible();
        await settled(page, PERSON);
        const b = (await bubble.boundingBox())!;
        sizes.push({ scale, w: b.width, h: b.height });
        // whole in the window
        expect(b.y).toBeGreaterThanOrEqual(7.5);
        expect(b.y + b.height).toBeLessThanOrEqual(900 - 7.5);
    }
    for (const s of sizes.slice(1)) {
        expect(Math.abs(s.w - sizes[0].w), `width at ${s.scale}`).toBeLessThanOrEqual(1);
        expect(Math.abs(s.h - sizes[0].h), `height at ${s.scale}`).toBeLessThanOrEqual(1);
    }
});

test('the keyboard opens a bubble on the tab, Escape closes it and leaves the focus on the tab; a pan closes it', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setup(page);
    const tab = siblingsTab(page, PERSON);
    const bubble = tab.locator(':scope > .badge-tooltip');
    await page.keyboard.press('Shift');
    await tab.focus();
    await expect(bubble).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(bubble).toBeHidden();
    await expect(tab).toBeFocused();
    // the pointer on the tab, then the tree moves under the still bubble: it closes
    await tab.hover();
    await expect(bubble).toBeVisible();
    await page.evaluate(() => window.Strom.ZoomPan.shiftWorld(30, 0));
    await expect(bubble).toBeHidden();
});

/** A finger held at a point of the element (fraction of its box) for 700 ms, then lifted. */
async function hold(page: Page, el: ReturnType<Page['locator']>, fx = 0.5, fy = 0.5): Promise<void> {
    await el.evaluate((e: HTMLElement, [ax, ay]) => {
        const r = e.getBoundingClientRect();
        const t = new Touch({ identifier: 1, target: e, clientX: r.x + r.width * ax, clientY: r.y + r.height * ay });
        e.dispatchEvent(new TouchEvent('touchstart', { touches: [t], targetTouches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
    }, [fx, fy] as const);
    await page.waitForTimeout(700);
    await el.evaluate((e: HTMLElement, [ax, ay]) => {
        const r = e.getBoundingClientRect();
        const t = new Touch({ identifier: 1, target: e, clientX: r.x + r.width * ax, clientY: r.y + r.height * ay });
        e.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [t], bubbles: true, cancelable: true }));
    }, [fx, fy] as const);
}

/** Pan the tree so the person's card has its top edge at `top` on the screen, its left at `left`. */
async function cardAt(page: Page, id: string, top: number, left = 300): Promise<void> {
    await page.evaluate(([pid, y, x]) => {
        const zp = window.Strom.ZoomPan;
        zp.finishAnimation();
        const c = document.querySelector<HTMLElement>(`#tree-canvas .person-card[data-id="${pid}"]`)!.getBoundingClientRect();
        zp.shiftWorld((c.left - (x as number)) / zp.getScale(), (c.top - (y as number)) / zp.getScale());
    }, [id, top, left] as const);
}

/** Pan the tree so the bottom edge of the person's siblings tab stands at `bottom` on the screen. */
async function tabBottomAt(page: Page, id: string, bottom: number, left = 300): Promise<void> {
    const card = (await cardOf(page, id).boundingBox())!;
    const t = (await siblingsTab(page, id).boundingBox())!;
    await cardAt(page, id, bottom - (t.y + t.height - card.y), left);
}

/**
 * Where a bubble opened by touch may reach down to (round 5 §34): 8 px over
 * the bottom navigation's top edge where it runs along the window's bottom
 * (its safe area included), else 8 px over the window's bottom.
 */
async function bubbleFloor(page: Page): Promise<number> {
    return page.evaluate(() => {
        const nav = document.querySelector<HTMLElement>('.bottom-bar');
        const r = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect() : null;
        return (r && r.width >= r.height ? Math.min(r.top, window.innerHeight) : window.innerHeight) - 8;
    });
}

/**
 * The open bubble by touch on its side of the tab (round 5 §33): below it
 * (its arrow on its top edge) or above it (its arrow on its bottom edge),
 * 8 px from the tab, the arrow on the tab; never over the top bar nor the
 * bottom navigation; nothing in it cut: its header, one name at least and
 * its last line (what a click does) whole.
 */
async function expectTouchBubble(page: Page, tab: ReturnType<Page['locator']>, bubble: ReturnType<Page['locator']>, side: 'below' | 'above'): Promise<void> {
    await expect(bubble).toBeVisible();
    if (side === 'below') await expect(bubble).toHaveClass(/\bbelow\b/);
    else await expect(bubble).not.toHaveClass(/\bbelow\b/);
    await expect(bubble).not.toHaveClass(/\bno-arrow\b/);
    await expect(bubble).not.toHaveClass(/\bbubble-clipped\b/);
    expect(await bubble.evaluate(b => getComputedStyle(b, '::after').display)).not.toBe('none');
    const t = (await tab.boundingBox())!;
    const b = (await bubble.boundingBox())!;
    if (side === 'below') expect(Math.abs(b.y - (t.y + t.height + 8))).toBeLessThan(1);
    else expect(Math.abs(b.y + b.height - (t.y - 8))).toBeLessThan(1);
    // the arrow on the tab
    const arrowX = await bubble.evaluate(el => parseFloat(getComputedStyle(el).getPropertyValue('--arrow-x')));
    expect(b.x + arrowX).toBeGreaterThanOrEqual(t.x);
    expect(b.x + arrowX).toBeLessThanOrEqual(t.x + t.width);
    const bar = await page.evaluate(() => document.querySelector('.toolbar')!.getBoundingClientRect().bottom);
    expect(b.y).toBeGreaterThanOrEqual(bar);
    expect(b.y + b.height).toBeLessThanOrEqual(await bubbleFloor(page) + 0.5);
    // nothing cut: every line it shows inside its box (the arrow stands out of it above it)
    expect(await bubble.evaluate(el => {
        const box = el.getBoundingClientRect();
        return [...el.children].filter(c => !(c as HTMLElement).hidden).every(c => {
            const r = c.getBoundingClientRect();
            return r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5;
        });
    })).toBe(true);
    await expect(bubble.locator(':scope > .badge-tooltip-header')).toBeVisible();
    expect(await bubble.locator('.badge-tooltip-item:visible').count()).toBeGreaterThanOrEqual(1);
    const action = bubble.locator(':scope > .badge-tooltip-action');
    await expect(action).toBeVisible();
    const a = (await action.boundingBox())!;
    expect(a.y).toBeGreaterThanOrEqual(b.y);
    expect(a.y + a.height).toBeLessThanOrEqual(b.y + b.height + 0.5);
}

/** A press elsewhere (on the tree, at its top left corner) closes an open bubble. */
async function pressElsewhere(page: Page): Promise<void> {
    const at = await page.evaluate(() => {
        const r = document.getElementById('tree-container')!.getBoundingClientRect();
        return { x: r.left + 4, y: r.top + 4 };
    });
    await page.locator('#tree-container').dispatchEvent('pointerdown', { clientX: at.x, clientY: at.y, pointerType: 'touch' });
}

/**
 * Touch (round 3 §22, round 5 §33, §34): a press held on a tab opens its
 * bubble below the tab (never beside the card), not the person's sheet; a
 * press elsewhere closes it. A press held on the card off its tabs still
 * opens the sheet. The bottom navigation bounds it: the bubble stays 8 px
 * over its top edge, above the tab where it fits only there.
 */
test.describe('touch, tablet 1024 × 768', () => {
    test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true });

    test('a press held on a tab opens its bubble below the tab; a press elsewhere closes it; on the card the sheet', async ({ page }) => {
        await setup(page);
        // the card just under the bars: with a mouse its tall bubble would open beside the card
        await cardUnderBars(page, PERSON, 60, 300);
        const tab = siblingsTab(page, PERSON);
        const bubble = tab.locator(':scope > .badge-tooltip');
        await hold(page, tab);
        await expect(bubble).toBeVisible();
        await expect(bubble).not.toHaveClass(/beside/);
        await expectTouchBubble(page, tab, bubble, 'below');
        await expect(page.locator('.bottom-sheet')).toHaveCount(0);
        // a press elsewhere closes it
        await page.locator('#tree-container').dispatchEvent('pointerdown', { clientX: 5, clientY: 700, pointerType: 'touch' });
        await expect(bubble).toBeHidden();
        // held on the card off its tabs: the person's sheet
        await hold(page, cardOf(page, PERSON), 0.3, 0.6);
        await expect(page.locator('.bottom-sheet')).toBeVisible();
        await expect(bubble).toBeHidden();
    });

    test('the bottom navigation bounds the bubble: 8 px over its top edge, above the tab where the room below is too small', async ({ page }) => {
        await setup(page);
        const tab = siblingsTab(page, PERSON);
        const bubble = tab.locator(':scope > .badge-tooltip');
        const nav = await page.evaluate(() => document.querySelector('.bottom-bar')!.getBoundingClientRect().top);
        expect(nav).toBeLessThan(768);
        // the tab 40 px over the navigation: above it, whole
        await tabBottomAt(page, PERSON, nav - 40);
        await hold(page, tab);
        await expectTouchBubble(page, tab, bubble, 'above');
        await pressElsewhere(page);
        await expect(bubble).toBeHidden();
        // the tab higher: below it, its bottom edge over the navigation
        await tabBottomAt(page, PERSON, nav - 300);
        await hold(page, tab);
        await expectTouchBubble(page, tab, bubble, 'below');
    });
});

/**
 * A phone held upright by touch (round 5 §33, §34): the bottom navigation
 * runs along the window's bottom; the bubble never covers it (8 px over its
 * top edge, its safe area included): above its tab where it fits only there.
 */
test.describe('touch, phone 390 × 844', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('a tab near the bottom navigation: the bubble above the tab, its arrow at its bottom on the tab, whole over the navigation', async ({ page }) => {
        await setup(page);
        const tab = siblingsTab(page, PERSON);
        const bubble = tab.locator(':scope > .badge-tooltip');
        const nav = await page.evaluate(() => document.querySelector('.bottom-bar')!.getBoundingClientRect().top);
        expect(nav).toBeLessThan(844);
        await tabBottomAt(page, PERSON, nav - 20, 150);
        await hold(page, tab);
        await expectTouchBubble(page, tab, bubble, 'above');
        await pressElsewhere(page);
        await expect(bubble).toBeHidden();
        // higher up: below the tab, down to 8 px over the navigation at most
        await tabBottomAt(page, PERSON, nav - 300, 150);
        await hold(page, tab);
        await expectTouchBubble(page, tab, bubble, 'below');
    });

    /**
     * ↩ and ⛶ float over the tree; a bubble opened by touch may cover them
     * (round 6 §47). Once it is closed (a tap on it, a tap elsewhere) the
     * very next tap on them does what they do: nothing left over them (a
     * layer, a fading bubble) takes it.
     */
    test('↩ and ⛶ under a bubble: right after it closes the next tap on them works (§47)', async ({ page }) => {
        await setup(page);
        // a step to go back to: ↩ shows
        await page.evaluate(async f => {
            await window.Strom.TreeRenderer.setFocus('father' as never);
            await window.Strom.TreeRenderer.setFocus(f as never);
        }, FOCUS);
        const back = page.locator('#focus-back-btn');
        const fit = page.locator('.zoom-controls button[onclick*="fitToScreen"]');
        await expect(back).toBeVisible();
        await expect(fit).toBeVisible();
        await page.evaluate(() => {
            const zp = window.Strom.ZoomPan as unknown as { fitToScreen: () => void };
            const real = zp.fitToScreen.bind(zp);
            (window as unknown as { __fits: number }).__fits = 0;
            zp.fitToScreen = () => { (window as unknown as { __fits: number }).__fits++; real(); };
        });
        const tab = siblingsTab(page, PERSON);
        const bubble = tab.locator(':scope > .badge-tooltip');
        const nav = await page.evaluate(() => document.querySelector('.bottom-bar')!.getBoundingClientRect().top);
        /** Open the bubble low in the window over the control (its tab `left` px from the card's left), checked to cover it. */
        const openOver = async (control: ReturnType<Page['locator']>, left: number): Promise<{ x: number; y: number }> => {
            await page.evaluate(id => window.Strom.ZoomPan.glideToPerson(id as never, 1, 0), PERSON);
            await expect.poll(() => page.evaluate(() => window.Strom.ZoomPan.getScale())).toBeCloseTo(1, 2);
            await tabBottomAt(page, PERSON, nav - 280, left);
            await hold(page, tab);
            await expect(bubble).toBeVisible();
            const c = (await control.boundingBox())!;
            const at = { x: c.x + c.width / 2, y: c.y + c.height / 2 };
            expect(await bubble.evaluate((el, p) => el.contains(document.elementFromPoint(p.x, p.y)), at), 'the bubble covers the control').toBe(true);
            return at;
        };
        /** A tap on the bare tree (no card, no button, not the bubble), away from the controls. */
        const tapElsewhere = async (): Promise<void> => {
            const spot = await page.evaluate(() => {
                const tree = document.getElementById('tree-container')!.getBoundingClientRect();
                for (let y = tree.top + 40; y < tree.top + 400; y += 9) {
                    for (let x = tree.left + 100; x < tree.right - 100; x += 9) {
                        const el = document.elementFromPoint(x, y);
                        if (el && (el.id === 'tree-container' || el.id === 'tree-canvas')) return { x, y };
                    }
                }
                return null;
            });
            expect(spot, 'a bare spot of the tree').not.toBeNull();
            await page.touchscreen.tap(spot!.x, spot!.y);
        };

        // ↩: the bubble closed by a tap on it, then a tap on ↩ goes back
        let at = await openOver(back, -20);
        await page.touchscreen.tap(at.x, at.y);
        await expect(bubble).toBeHidden();
        await page.touchscreen.tap(at.x, at.y);
        await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId())).toBe('father');
        await page.evaluate(() => window.Strom.TreeRenderer.goForward());
        await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId())).toBe(FOCUS);

        // ↩: the bubble closed by a tap elsewhere on the tree
        at = await openOver(back, -20);
        await tapElsewhere();
        await expect(bubble).toBeHidden();
        await page.touchscreen.tap(at.x, at.y);
        await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId())).toBe('father');
        await page.evaluate(() => window.Strom.TreeRenderer.goForward());
        await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId())).toBe(FOCUS);

        // ⛶: the same
        at = await openOver(fit, 150);
        await page.touchscreen.tap(at.x, at.y);
        await expect(bubble).toBeHidden();
        await page.touchscreen.tap(at.x, at.y);
        await expect.poll(() => page.evaluate(() => (window as unknown as { __fits: number }).__fits)).toBe(1);
        at = await openOver(fit, 150);
        await tapElsewhere();
        await expect(bubble).toBeHidden();
        await page.touchscreen.tap(at.x, at.y);
        await expect.poll(() => page.evaluate(() => (window as unknown as { __fits: number }).__fits)).toBe(2);
    });

    test('a bubble shown whole has no "More in the person menu" (§41)', async ({ page }) => {
        await setup(page);
        const tab = siblingsTab(page, PERSON);
        const bubble = tab.locator(':scope > .badge-tooltip');
        await cardUnderBars(page, PERSON, 8, 150);
        await hold(page, tab);
        await expectTouchBubble(page, tab, bubble, 'below');
        expect(await bubble.evaluate(el => [...el.children].filter(c => (c as HTMLElement).hidden).map(c => c.className))).toEqual(['badge-tooltip-more']);
        await expect(bubble.locator('.bubble-menu-more')).toHaveCount(0);
    });

    /**
     * Round 7 §54: a bubble cut by the cap of 8 names ("and n more"), with
     * room for all 8 of them, also carries "More in the person menu", as
     * one cut by the room or by the 4 names of a low window does.
     */
    test('8 names of 12 with room for them: "and 4 more" and "More in the person menu" under it (round 7 §54)', async ({ page }) => {
        await setupFixture(page, 'edge-ancestor-children', 'focus');
        await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), 'f_m_f_m_f');
        await page.evaluate(() => window.Strom.ZoomPan.finishAnimation());
        await cardUnderBars(page, 'f_m_f_m_f', 8, 150);
        const tab = siblingsTab(page, 'f_m_f_m_f');
        const bubble = tab.locator(':scope > .badge-tooltip');
        await hold(page, tab);
        await expectTouchBubble(page, tab, bubble, 'below');
        // All 8 names it lists, none hidden by the room
        expect(await bubble.evaluate(el => [...el.querySelectorAll<HTMLElement>('[data-name-group]')].filter(c => c.hidden).length)).toBe(0);
        await expect(bubble.locator('.badge-tooltip-item:visible')).toHaveCount(8);
        await expect(bubble.locator(':scope > .badge-tooltip-more')).toHaveText('and 4 more');
        const more = bubble.locator(':scope > .badge-tooltip-more + .bubble-menu-more');
        await expect(more).toHaveText('More in the person menu');
        await expect(more).toBeVisible();
        await more.tap();
        await expect(bubble).toBeHidden();
        await expect(page.locator('.bottom-sheet-person')).toBeVisible();
    });
});

/**
 * A phone held sideways, by touch (round 4 §30, round 5 §33, §38): a bubble
 * opens whole below its tab where it fits there, else whole above it, else
 * on the side with more room listing fewer names, one at least; its arrow
 * on the tab, never over the tab or the top bar, nothing in it cut (its last
 * line, what a click does, whole); 4 names at most in a low window. Where
 * not even one name fits on either side: the person's menu, no bubble.
 */
test.describe('touch, phone held sideways 844 × 390', () => {
    test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

    test('whole below the tab, else whole above it, else on the side with more room with fewer names, never over the tab or the top bar', async ({ page }) => {
        await setup(page);
        const tab = siblingsTab(page, PERSON);
        const bubble = tab.locator(':scope > .badge-tooltip');
        // the card just under the bars: whole below the tab
        await cardUnderBars(page, PERSON, 8, 300);
        await hold(page, tab);
        await expectTouchBubble(page, tab, bubble, 'below');
        const all = await bubble.locator('.badge-tooltip-item:visible').count();
        await pressElsewhere(page);
        await expect(bubble).toBeHidden();
        // the tab low in the window: whole above it (§33)
        await tabBottomAt(page, PERSON, 380);
        await hold(page, tab);
        await expectTouchBubble(page, tab, bubble, 'above');
        expect(await bubble.locator('.badge-tooltip-item:visible').count()).toBe(all);
        await pressElsewhere(page);
        await expect(bubble).toBeHidden();
        // whole on neither side: on the side with more room, shortened, one name at least
        const shortened = () => bubble.evaluate(el => [...el.children].some(c => (c as HTMLElement).hidden && !c.classList.contains('badge-tooltip-more')));
        await cardAt(page, PERSON, 175);
        await hold(page, tab);
        await expectTouchBubble(page, tab, bubble, 'below');
        expect(await shortened()).toBe(true);
        await pressElsewhere(page);
        await expect(bubble).toBeHidden();
        await cardAt(page, PERSON, 300);
        await hold(page, tab);
        await expectTouchBubble(page, tab, bubble, 'above');
        expect(await shortened()).toBe(true);
    });

    /**
     * A shortened bubble (fewer names, or lines left out) carries one line
     * more under its names, "More in the person menu" (round 6 §41), over
     * its last line, measured with the rest (the bubble still whole); a tap
     * on it closes the bubble and opens the person's menu. A bubble shown
     * whole has no such line, also when it opens again after a shortened one.
     */
    test('a shortened bubble: "More in the person menu" under its names opens the person\'s menu; a whole one has none (§41)', async ({ page }) => {
        await setup(page);
        const tab = siblingsTab(page, PERSON);
        const bubble = tab.locator(':scope > .badge-tooltip');
        const more = bubble.locator(':scope > .bubble-menu-more');
        const shortened = () => bubble.evaluate(el => [...el.children].some(c => (c as HTMLElement).hidden && !c.classList.contains('badge-tooltip-more'))
            || !(el.querySelector(':scope > .badge-tooltip-more') as HTMLElement).hidden);
        // whole below the tab: no such line
        await cardUnderBars(page, PERSON, 8, 300);
        await hold(page, tab);
        await expectTouchBubble(page, tab, bubble, 'below');
        expect(await shortened()).toBe(false);
        await expect(more).toHaveCount(0);
        await pressElsewhere(page);
        await expect(bubble).toBeHidden();
        // shortened on the side with more room: the line under the names, over the last line, the bubble whole
        await cardAt(page, PERSON, 175);
        await hold(page, tab);
        await expectTouchBubble(page, tab, bubble, 'below');
        expect(await shortened()).toBe(true);
        await expect(more).toHaveCount(1);
        await expect(more).toBeVisible();
        await expect(more).toHaveText('More in the person menu');
        expect(await more.evaluate(el => {
            const prev = [...el.parentElement!.children].slice(0, [...el.parentElement!.children].indexOf(el));
            return prev.some(p => p.matches('[data-name-group]')) && el.nextElementSibling !== null
                && [...el.parentElement!.children].indexOf(el) < [...el.parentElement!.children].findIndex(c => c.matches('.badge-tooltip-action'));
        })).toBe(true);
        expect((await more.boundingBox())!.height).toBeGreaterThanOrEqual(32);
        await more.tap();
        await expect(bubble).toBeHidden();
        const sheet = page.locator('.bottom-sheet-person');
        await expect(sheet).toBeVisible();
        const name = await page.evaluate(pid => window.Strom.DataManager.getPerson(pid as never)!.firstName, PERSON);
        await expect(sheet).toHaveAttribute('aria-label', new RegExp(name));
        // nothing else happened: the siblings were not shown
        expect(await page.evaluate(id => window.Strom.TreeRenderer.isSiblingsShown(id as never), PERSON)).toBe(false);
        await page.evaluate(() => window.Strom.UI.hideBottomSheet());
        await expect(sheet).toHaveCount(0);
        // whole again: the line goes
        await cardUnderBars(page, PERSON, 8, 300);
        await hold(page, tab);
        await expectTouchBubble(page, tab, bubble, 'below');
        await expect(more).toHaveCount(0);
    });

    test('4 names of 12 in a low window: shortened, "More in the person menu" (§41)', async ({ page }) => {
        await setupFixture(page, 'edge-ancestor-children', 'focus');
        await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), 'f_m_f_m_f');
        await page.evaluate(() => window.Strom.ZoomPan.finishAnimation());
        await cardUnderBars(page, 'f_m_f_m_f', 8, 300);
        const tab = siblingsTab(page, 'f_m_f_m_f');
        const bubble = tab.locator(':scope > .badge-tooltip');
        await hold(page, tab);
        await expectTouchBubble(page, tab, bubble, 'below');
        await expect(bubble.locator(':scope > .badge-tooltip-more + .bubble-menu-more')).toHaveText('More in the person menu');
        await bubble.locator('.bubble-menu-more').tap();
        await expect(page.locator('.bottom-sheet-person')).toBeVisible();
        await expect(bubble).toBeHidden();
    });

    test('a low window lists 4 names at most, "and n more" the rest', async ({ page }) => {
        await setupFixture(page, 'edge-ancestor-children', 'focus');
        await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), 'f_m_f_m_f');
        await page.evaluate(() => window.Strom.ZoomPan.finishAnimation());
        await cardUnderBars(page, 'f_m_f_m_f', 8, 300);
        const tab = siblingsTab(page, 'f_m_f_m_f');
        const bubble = tab.locator(':scope > .badge-tooltip');
        await hold(page, tab);
        await expectTouchBubble(page, tab, bubble, 'below');
        const shown = await bubble.locator('.badge-tooltip-item:visible').count();
        expect(shown).toBeGreaterThanOrEqual(1);
        expect(shown).toBeLessThanOrEqual(4);
        await expect(bubble.locator('.badge-tooltip-more')).toHaveText(`and ${12 - shown} more`);
    });

    test('4 names at most in every touch window 500 px high or less, whatever its width (§38): 1280 × 480', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 480 });
        await setupFixture(page, 'edge-ancestor-children', 'focus');
        await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), 'f_m_f_m_f');
        await page.evaluate(() => window.Strom.ZoomPan.finishAnimation());
        await cardUnderBars(page, 'f_m_f_m_f', 8, 300);
        const tab = siblingsTab(page, 'f_m_f_m_f');
        const bubble = tab.locator(':scope > .badge-tooltip');
        await hold(page, tab);
        await expectTouchBubble(page, tab, bubble, 'below');
        const shown = await bubble.locator('.badge-tooltip-item:visible').count();
        expect(shown).toBeLessThanOrEqual(4);
        await expect(bubble.locator('.badge-tooltip-more')).toHaveText(`and ${12 - shown} more`);
    });

    test('a tab at the window\'s bottom: the bubble above the tab with its arrow, whole in the window (§33)', async ({ page }) => {
        await setup(page);
        const tab = siblingsTab(page, PERSON);
        const bubble = tab.locator(':scope > .badge-tooltip');
        // the tab's bottom edge 4 px over the window's: no room under it
        await tabBottomAt(page, PERSON, 386);
        await hold(page, tab);
        await expectTouchBubble(page, tab, bubble, 'above');
    });

    test('a window too low for even one name on either side of the tab: the person\'s menu, no bubble (§38)', async ({ page }) => {
        await setup(page);
        await page.setViewportSize({ width: 844, height: 170 });
        const tab = siblingsTab(page, PERSON);
        const bubble = tab.locator(':scope > .badge-tooltip');
        const bar = await page.evaluate(() => document.querySelector('.toolbar')!.getBoundingClientRect().bottom);
        await tabBottomAt(page, PERSON, Math.round((bar + 170) / 2) + 9);
        await hold(page, tab);
        const sheet = page.locator('.bottom-sheet-person');
        await expect(sheet).toBeVisible();
        const name = await page.evaluate(pid => window.Strom.DataManager.getPerson(pid as never)!.firstName, PERSON);
        await expect(sheet).toHaveAttribute('aria-label', new RegExp(name));
        await expect(bubble).toBeHidden();
        // a taller window: the bubble again, one name at least
        await page.evaluate(() => window.Strom.UI.hideBottomSheet());
        await expect(sheet).toHaveCount(0);
        await page.setViewportSize({ width: 844, height: 390 });
        await cardUnderBars(page, PERSON, 8, 300);
        await hold(page, tab);
        await expectTouchBubble(page, tab, bubble, 'below');
    });
});

/**
 * Zoomed out by touch (round 4 §31): under 60 % a long press on a tab is the
 * card's, as a tap there is: the person's menu (the sheet), no bubble. From
 * 60 % the tab's bubble.
 */
test.describe('touch, zoomed out, phone 390 × 844', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    for (const scale of [0.5, 0.57]) {
        test(`at ${scale} a press held on a tab opens the person's menu, not the bubble`, async ({ page }) => {
            await setup(page);
            await page.evaluate(([pid, s]) => window.Strom.ZoomPan.glideToPerson(pid as never, s as number, 0), [PERSON, scale] as const);
            await expect.poll(() => page.evaluate(() => window.Strom.ZoomPan.getScale())).toBeCloseTo(scale, 2);
            const tab = siblingsTab(page, PERSON);
            const bubble = tab.locator(':scope > .badge-tooltip');
            const name = await page.evaluate(pid => window.Strom.DataManager.getPerson(pid as never)!.firstName, PERSON);
            // on the tab's middle and on its part standing out of the card
            for (const fy of [0.5, 0.1]) {
                await hold(page, tab, 0.5, fy);
                const sheet = page.locator('.bottom-sheet-person');
                await expect(sheet).toBeVisible();
                await expect(sheet).toHaveAttribute('aria-label', new RegExp(name));
                await expect(bubble).toBeHidden();
                await page.evaluate(() => window.Strom.UI.hideBottomSheet());
                await expect(sheet).toHaveCount(0);
            }
        });
    }

    test('at 0.6 a press held on a tab opens its bubble', async ({ page }) => {
        await setup(page);
        await page.evaluate(pid => window.Strom.ZoomPan.glideToPerson(pid as never, 0.6, 0), PERSON);
        await expect.poll(() => page.evaluate(() => window.Strom.ZoomPan.getScale())).toBeCloseTo(0.6, 2);
        const tab = siblingsTab(page, PERSON);
        const bubble = tab.locator(':scope > .badge-tooltip');
        await hold(page, tab);
        await expect(bubble).toBeVisible();
        await expect(page.locator('.bottom-sheet-person')).toHaveCount(0);
    });
});

test.describe('phone 390 × 844', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the bottom sheet: the siblings row under the tiles, after the step with the parents under it', async ({ page }) => {
        await setup(page);
        await cardOf(page, PERSON).tap({ position: { x: 40, y: 30 } });
        const sheet = page.locator('.bottom-sheet-person');
        await expect(sheet).toBeVisible();
        const row = sheet.locator('[data-action="toggle-siblings"]');
        await expect(row).toContainText('Show siblings here');
        await row.tap();
        await expect(sheet).toHaveCount(0);
        for (const id of SIBLINGS) await expect(cardOf(page, id)).toHaveCount(1);
        await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), PERSON);
        await cardOf(page, PERSON).tap({ position: { x: 40, y: 30 } });
        await expect(sheet.locator('[data-action="toggle-siblings"]')).toHaveText('Hide the siblings shown here');
        await expect(sheet.locator('.bottom-sheet-row-note')).toHaveText(/^Shown as the children of the parents: Father .+, Mother .+\.$/);
        await sheet.locator('[data-action="toggle-siblings"]').tap();
        for (const id of SIBLINGS) await expect(cardOf(page, id)).toHaveCount(0);
    });

    test('the bottom sheet: a sibling drawn elsewhere under "Already in the tree elsewhere"', async ({ page }) => {
        await setupFixture(page, 'edge-children-elsewhere', 'focus');
        await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), 'mother');
        await cardOf(page, 'mother').tap({ position: { x: 40, y: 30 } });
        const sheet = page.locator('.bottom-sheet-person');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('.bottom-sheet-section')).toContainText(['Already in the tree elsewhere']);
        const row = sheet.locator('[data-action="child-elsewhere:aunt"]');
        await expect(row).toContainText('Ilse Varnhag');
        await row.tap();
        await expect(sheet).toHaveCount(0);
        await expect(cardOf(page, 'aunt')).toHaveClass(/children-glow/);
    });
});

/**
 * A bubble taller than the window (a phone held sideways, in German, two
 * long invented names): it lists fewer names, each group one at least, and
 * "and n more" counts the rest, so it stands whole in the window 8 px from
 * its edges with its header and its last line (what a click does) whole;
 * nothing is cut (round 3 §17, §25). With a mouse and by touch.
 */
test.describe('a bubble taller than a low window lists fewer names (de, 844 × 390)', () => {
    test.use({ locale: 'de-DE', viewport: { width: 844, height: 390 } });

    async function setupLong(page: Page): Promise<void> {
        await openApp(page);
        const data = JSON.parse(readFileSync(join(process.cwd(), 'test', 'edge-ancestor-children.json'), 'utf-8'));
        Object.assign(data.persons.f_m_f_m_f_sib0, { firstName: 'Zebulon', lastName: 'Quarrington-Holloway' });
        Object.assign(data.persons.f_m_f_m_f_sib1, { firstName: 'Bartholomäus', lastName: 'Kranichfeld-Oberau' });
        await page.evaluate(async tree => {
            await window.Strom.DataManager.importAsNewTree(tree as never, 'Niedrig');
            await window.Strom.TreeRenderer.setFocus('focus' as never);
        }, data);
        await expect(cardOf(page, 'focus')).toBeVisible();
        await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), 'f_m_f_m_f');
        await page.evaluate(() => window.Strom.ZoomPan.finishAnimation());
    }

    async function expectWhole(bubble: ReturnType<Page['locator']>): Promise<void> {
        const b = (await bubble.boundingBox())!;
        expect(b.y).toBeGreaterThanOrEqual(8 - 0.5);
        expect(b.y + b.height).toBeLessThanOrEqual(390 - 8 + 0.5);
        // nothing cut: its content as tall as the box, the last line (what a click does) inside it
        expect(await bubble.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
        await expect(bubble).not.toHaveClass(/\bbubble-clipped\b/);
        const action = bubble.locator(':scope > .badge-tooltip-action');
        await expect(action).toBeVisible();
        await expect(bubble.locator(':scope > :last-child')).toHaveClass(/badge-tooltip-action/);
        const a = (await action.boundingBox())!;
        expect(a.y + a.height).toBeLessThanOrEqual(b.y + b.height + 0.5);
        await expect(bubble.locator(':scope > .badge-tooltip-header')).toBeVisible();
        // fewer than 8 names, one at least, "and n more" counting the rest of the 12
        const shown = await bubble.locator('.badge-tooltip-item:visible').count();
        expect(shown).toBeGreaterThanOrEqual(1);
        expect(shown).toBeLessThan(8);
        await expect(bubble.locator('.badge-tooltip-more')).toHaveText(`und ${12 - shown} weitere`);
    }

    test('with a mouse', async ({ page }) => {
        await setupLong(page);
        const tab = siblingsTab(page, 'f_m_f_m_f');
        const bubble = tab.locator(':scope > .badge-tooltip');
        await tab.hover();
        await expect(bubble).toBeVisible();
        await settled(page, 'f_m_f_m_f');
        await expectWhole(bubble);
        // a taller window lists all 8 again
        await page.mouse.move(5, 200);
        await expect(bubble).toBeHidden();
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), 'f_m_f_m_f');
        await page.evaluate(() => window.Strom.ZoomPan.finishAnimation());
        await tab.hover();
        await expect(bubble).toBeVisible();
        await expect(bubble.locator('.badge-tooltip-item:visible')).toHaveCount(8);
        await expect(bubble.locator('.badge-tooltip-more')).toHaveText('und 4 weitere');
    });

    test.describe('by touch', () => {
        test.use({ hasTouch: true, isMobile: true });

        test('a finger held on the tab', async ({ page }) => {
            await setupLong(page);
            // below its tab by touch (round 4 §30): the card under the bars, the room below it
            await cardUnderBars(page, 'f_m_f_m_f', 8, 300);
            const tab = siblingsTab(page, 'f_m_f_m_f');
            const bubble = tab.locator(':scope > .badge-tooltip');
            await hold(page, tab);
            await expect(bubble).toBeVisible();
            await expectWhole(bubble);
            expect(await bubble.locator('.badge-tooltip-item:visible').count()).toBeLessThanOrEqual(4);
        });
    });
});
