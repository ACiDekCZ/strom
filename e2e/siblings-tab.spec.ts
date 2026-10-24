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
    await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), PERSON);
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

/** The person's card and the open bubble of its siblings tab, on the screen. */
async function cardAndBubble(page: Page, id: string) {
    return page.evaluate(([fn, pid]) => {
        const card = document.querySelector<HTMLElement>(`#tree-canvas .person-card[data-id="${pid}"]`)!;
        const b = card.querySelector<HTMLElement>('.siblings-tab > .badge-tooltip')!.getBoundingClientRect();
        const c = card.getBoundingClientRect();
        const t = document.getElementById('tree-container')!.getBoundingClientRect();
        const bars = new Function(`return (${fn})()`)() as number;
        return { card: { left: c.left, right: c.right, top: c.top }, bubble: { left: b.left, right: b.right, top: b.top, bottom: b.bottom }, tree: { left: t.left, right: t.right, bottom: t.bottom }, bars };
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
    await tab.hover();
    await expect(bubble).toHaveClass(/\bbeside-right\b/);
    const g = await cardAndBubble(page, PERSON);
    expect(g.bubble.left).toBeGreaterThan(g.card.right);
    expect(g.bubble.top).toBeGreaterThanOrEqual(g.bars - 1);
    expect(g.bubble.bottom).toBeLessThanOrEqual(g.tree.bottom + 1);
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
    // No scrollbar: the bubble is as tall as its content
    expect(await bubble.evaluate(b => b.scrollHeight <= b.clientHeight + 1 && getComputedStyle(b).maxHeight === 'none')).toBe(true);
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
    await expect(page.locator('#tree-container')).not.toHaveClass(/bubble-over-controls/);
    expect(await topAt()).toBe('controls');
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
