import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { openApp } from './helpers.js';

/**
 * Parents shown in place beyond the depth (GitHub #4, §4): an ancestor of
 * the line at the edge of the depth carries "▸ parents" in place (not a
 * focus); a click draws one generation more above that branch alone — the
 * card keeps its place, the parents carry the hatch of the cards shown here,
 * the tab turns to "▾ parents" — and a second click gives the view back.
 * Its "▸ siblings" shows the parents with their children in one step. The
 * comprehensive fixture (invented data), focus on a child of "Focus Person"
 * at an ancestor depth of 2: the grandparents' parents are out of view only
 * because of the depth.
 */

const FOCUS = 'child_1';
const PERSON = 'father';
const PARENTS = ['gp_h_h', 'gp_h_w'];
const SIBLINGS = ['uncle_h_1', 'aunt_h_1'];
const OTHER_SIDE = ['gp_w_h', 'gp_w_w'];

const cardOf = (page: Page, id: string) => page.locator(`#tree-canvas .person-card[data-id="${id}"]`);
const parentsTab = (page: Page, id: string) => cardOf(page, id).locator('.edge-top-right .branch-tab.parents-tab');
const siblingsTab = (page: Page, id: string) => cardOf(page, id).locator('.edge-top-right .branch-tab.siblings-tab');
const childrenTab = (page: Page, id: string) => cardOf(page, id).locator('.edge-top-right .branch-tab.children-tab');
const shownCount = (page: Page) => page.evaluate(() => window.Strom.TreeRenderer.shownChildrenCount());

async function setup(page: Page): Promise<void> {
    await openApp(page);
    const data = JSON.parse(readFileSync(join(process.cwd(), 'test', 'comprehensive.json'), 'utf-8'));
    await page.evaluate(async ([tree, f]) => {
        await window.Strom.DataManager.importAsNewTree(tree as never, 'Comprehensive');
        await window.Strom.TreeRenderer.setFocus(f as never);
        window.Strom.TreeRenderer.setFocusDepth(2, window.Strom.TreeRenderer.getFocusDepthDown());
    }, [data, FOCUS] as const);
    await expect(cardOf(page, PARENTS[0])).toHaveCount(0);
    await expect(parentsTab(page, PERSON)).toHaveCount(1);
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

/** The view as it was: every card where it stood, up to the shift of the anchor's card. */
async function expectViewBack(page: Page, before: Record<string, [number, number]>, anchor: string): Promise<void> {
    await expect.poll(async () => Object.keys(await screenCenters(page)).sort()).toEqual(Object.keys(before).sort());
    const after = await screenCenters(page);
    const dx = after[anchor][0] - before[anchor][0], dy = after[anchor][1] - before[anchor][1];
    for (const [id, at] of Object.entries(before)) expect(near(after[id], [at[0] + dx, at[1] + dy]), id).toBe(true);
}

test('"▸ parents" on an ancestor at the edge of the depth shows them in place; the card stays; a second click gives the view back', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setup(page);
    await page.mouse.move(5, 500);
    const tab = parentsTab(page, PERSON);
    // In place, not a focus: no "◎ family" on the edge ancestor
    await expect(tab).toHaveClass(/kind-place/);
    await expect(cardOf(page, PERSON).locator('.branch-tab.kind-focus')).toHaveCount(0);
    await expect(tab.locator('.pill-glyph')).toHaveText('▸');
    await expect(tab).toHaveAttribute('aria-pressed', 'false');
    await expect(tab).toHaveAttribute('aria-label', /^Show the parents of .+ here$/);
    await expect(tab.locator('.badge-tooltip-header')).toHaveText('Parents');
    await expect(tab.locator('.badge-tooltip-item')).toHaveCount(2);
    await expect(tab.locator('.badge-tooltip-action')).toHaveText('A click shows them here; the view stays.');

    const before = await screenCenters(page);
    await tab.click();
    for (const id of PARENTS) await expect(cardOf(page, id)).toBeVisible();
    await page.mouse.move(5, 500);
    expect(await page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId())).toBe(FOCUS);
    // One generation above that branch alone: the other grandparent's parents (and the siblings) stay out of view
    for (const id of [...OTHER_SIDE, ...SIBLINGS]) await expect(cardOf(page, id)).toHaveCount(0);
    // The clicked card keeps its place on the screen
    await expect.poll(async () => near((await screenCenters(page))[PERSON], before[PERSON])).toBe(true);
    // The parents carry the hatch of the cards shown here; the tab is "▾ parents"
    for (const id of PARENTS) await expect(cardOf(page, id)).toHaveClass(/shown-here/);
    await expect(cardOf(page, PERSON)).not.toHaveClass(/shown-here/);
    const hide = parentsTab(page, PERSON);
    await expect(hide).toHaveClass(/active/);
    await expect(hide).toHaveAttribute('aria-pressed', 'true');
    await expect(hide.locator('.pill-glyph')).toHaveText('▾');
    await expect(hide).toHaveAttribute('aria-label', /^Hide the parents of .+ shown here$/);
    await expect(hide.locator('.badge-tooltip-header')).toHaveText('Parents shown here');
    await expect(hide.locator('.badge-tooltip-action')).toHaveText('A click on the tab hides them again.');
    expect(await shownCount(page)).toBe(1);
    await expect(page.locator('#hide-shown-children')).toBeVisible();
    // The parents in view: the siblings tab is now the one of a parent in view (§1, nested)
    await expect(siblingsTab(page, PERSON).locator('.badge-tooltip-body')).toHaveText('The same people as “▸ children” on the parents.');

    await hide.click();
    await page.mouse.move(5, 500);
    for (const id of PARENTS) await expect(cardOf(page, id)).toHaveCount(0);
    expect(await shownCount(page)).toBe(0);
    await expect(parentsTab(page, PERSON)).toHaveAttribute('aria-pressed', 'false');
    await expectViewBack(page, before, PERSON);
});

test('↩ after "▸ parents" is one step back; ↪ brings the parents again', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setup(page);
    const couldGoBack = await page.evaluate(() => window.Strom.TreeRenderer.canGoBack());
    await parentsTab(page, PERSON).click();
    for (const id of PARENTS) await expect(cardOf(page, id)).toBeVisible();
    await page.evaluate(() => window.Strom.TreeRenderer.goBack());
    for (const id of PARENTS) await expect(cardOf(page, id)).toHaveCount(0);
    expect(await shownCount(page)).toBe(0);
    expect(await page.evaluate(() => window.Strom.TreeRenderer.canGoBack())).toBe(couldGoBack);
    await page.evaluate(() => window.Strom.TreeRenderer.goForward());
    for (const id of PARENTS) await expect(cardOf(page, id)).toBeVisible();
    await expect(parentsTab(page, PERSON)).toHaveClass(/active/);
    expect(await shownCount(page)).toBe(1);
});

test('"▸ siblings" on an ancestor at the edge of the depth shows the parents and the siblings in one step; "Hide shown children" closes it all', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setup(page);
    await page.mouse.move(5, 500);
    const tab = siblingsTab(page, PERSON);
    await expect(tab).toHaveClass(/kind-place/);
    await expect(tab.locator('.pill-glyph')).toHaveText('▸');
    await expect(tab.locator('.badge-tooltip-item')).toHaveCount(SIBLINGS.length);
    await expect(tab.locator('.badge-tooltip-body')).toHaveText('The parents come into view with them.');

    const before = await screenCenters(page);
    const couldGoBack = await page.evaluate(() => window.Strom.TreeRenderer.canGoBack());
    await tab.click();
    for (const id of [...PARENTS, ...SIBLINGS]) await expect(cardOf(page, id)).toBeVisible();
    await page.mouse.move(5, 500);
    await expect.poll(async () => near((await screenCenters(page))[PERSON], before[PERSON])).toBe(true);
    // One state as §1: the person's "▾ siblings" (no "▾ parents" of its own), the parents' "▾ children", one step
    await expect(siblingsTab(page, PERSON)).toHaveClass(/active/);
    await expect(parentsTab(page, PERSON)).toHaveCount(0);
    for (const id of PARENTS) await expect(childrenTab(page, id)).toHaveClass(/active/);
    for (const id of [...PARENTS, ...SIBLINGS]) await expect(cardOf(page, id)).toHaveClass(/shown-here/);
    expect(await shownCount(page)).toBe(1);
    // ↩ is one step back: parents and siblings go together
    await page.evaluate(() => window.Strom.TreeRenderer.goBack());
    for (const id of [...PARENTS, ...SIBLINGS]) await expect(cardOf(page, id)).toHaveCount(0);
    expect(await page.evaluate(() => window.Strom.TreeRenderer.canGoBack())).toBe(couldGoBack);
    await page.evaluate(() => window.Strom.TreeRenderer.goForward());
    for (const id of [...PARENTS, ...SIBLINGS]) await expect(cardOf(page, id)).toBeVisible();

    await page.locator('#hide-shown-children').click();
    await page.mouse.move(5, 500);
    for (const id of [...PARENTS, ...SIBLINGS]) await expect(cardOf(page, id)).toHaveCount(0);
    expect(await shownCount(page)).toBe(0);
    await expectViewBack(page, before, PERSON);
});

test('closing "▾ parents" closes the siblings shown under them too (nested)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setup(page);
    await parentsTab(page, PERSON).click();
    for (const id of PARENTS) await expect(cardOf(page, id)).toBeVisible();
    await page.mouse.move(5, 500);
    await siblingsTab(page, PERSON).click();
    for (const id of SIBLINGS) await expect(cardOf(page, id)).toBeVisible();
    await page.mouse.move(5, 500);
    expect(await shownCount(page)).toBe(2);
    await parentsTab(page, PERSON).click();
    for (const id of [...PARENTS, ...SIBLINGS]) await expect(cardOf(page, id)).toHaveCount(0);
    expect(await shownCount(page)).toBe(0);
});

/**
 * Nested expansion (§6, frame 6b): the children of a sibling shown here are
 * a second level; the "▾" bubble of that card offers "◎ Focus on …" (a new
 * centre with all branches), which sets the focus without the toast of the
 * focus tabs. The one step's own tabs (the father's siblings, the parents'
 * children brought in with them) offer nothing of the kind.
 */
test('children of a sibling shown here: the "▾" bubble offers a focus on the sibling, without the toast', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setup(page);
    await siblingsTab(page, PERSON).click();
    await expect(cardOf(page, SIBLINGS[0])).toBeVisible();
    await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), SIBLINGS[0]);
    await childrenTab(page, SIBLINGS[0]).click();
    await expect(cardOf(page, 'cousin_h_1')).toBeVisible();
    // A shown (hatched) card keeps its own tabs, on a solid ground in the light and the dark theme (frames 6c/6d)
    await expect(cardOf(page, SIBLINGS[0])).toHaveClass(/shown-here/);
    for (const theme of ['light', 'dark']) {
        await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
        const grounds = await cardOf(page, SIBLINGS[0]).locator('.card-edge > *').evaluateAll(els => els.map(e => getComputedStyle(e).backgroundColor));
        expect(grounds.length, theme).toBeGreaterThan(0);
        for (const g of grounds) expect(g, theme).toMatch(/^rgb\(/);
    }
    await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
    // One step is not nested: no row on the father's siblings nor on the parents' children
    await expect(cardOf(page, PERSON).locator('.nested-focus-row')).toHaveCount(0);
    await expect(cardOf(page, PARENTS[0]).locator('.nested-focus-row')).toHaveCount(0);
    expect(await page.evaluate(id => window.Strom.TreeRenderer.nestedFocusOffered(id as never), PERSON)).toBe(false);

    await page.mouse.move(5, 500);
    await childrenTab(page, SIBLINGS[0]).hover();
    const bubble = cardOf(page, SIBLINGS[0]).locator('.children-bubble[data-bubble="children"]');
    const row = bubble.locator('.nested-focus-row');
    await expect(row).toBeVisible();
    await expect(row).toHaveText('◎Focus on Uncle H1');
    await expect(bubble.locator('.badge-tooltip-nested .badge-tooltip-body')).toHaveText('A new centre of the tree with all its branches.');
    const h = (await row.boundingBox())!.height;
    expect(h).toBeGreaterThanOrEqual(28);
    await row.click();
    await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId())).toBe(SIBLINGS[0]);
    await expect(page.locator('#focus-toast .focus-toast-box')).toHaveCount(0);
    await page.waitForTimeout(300);
    await expect(page.locator('#focus-toast .focus-toast-box')).toHaveCount(0);
});

test('the sheet offers the nested focus under the hide row; the context menu does not', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setup(page);
    await siblingsTab(page, PERSON).click();
    await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), SIBLINGS[0]);
    await childrenTab(page, SIBLINGS[0]).click();
    await expect(cardOf(page, 'cousin_h_1')).toBeVisible();
    // Desktop: the context menu leaves it out (the bubble has it)
    await cardOf(page, SIBLINGS[0]).click();
    const menu = page.locator('.context-menu:not(.context-submenu)');
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-action="toggle-children"]')).toHaveCount(1);
    await expect(menu.locator('[data-action="nested-focus"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    // The sheet (≤ 1024 px): the row stands right under "Hide the children shown here"
    await page.setViewportSize({ width: 800, height: 900 });
    await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), SIBLINGS[0]);
    await cardOf(page, SIBLINGS[0]).click();
    const sheet = page.locator('.bottom-sheet-person');
    await expect(sheet).toBeVisible();
    const actions = await sheet.locator('.bottom-sheet-item[data-action]').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.action));
    const i = actions.indexOf('nested-focus');
    expect(i).toBeGreaterThan(0);
    expect(actions[i - 1]).toBe('toggle-children');
    const row = sheet.locator('.bottom-sheet-item[data-action="nested-focus"]');
    await expect(row).toContainText('Focus on Uncle H1');
    await expect(row.locator('xpath=following-sibling::*[1]')).toHaveText('A new centre of the tree with all its branches.');
    await row.click();
    await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId())).toBe(SIBLINGS[0]);
    await expect(page.locator('#focus-toast .focus-toast-box')).toHaveCount(0);
});

/**
 * A depth raised after "▸ parents" draws those parents at the plain depth:
 * the expansion has nothing left to show, so the tab no longer reads "▾"
 * and the shown count drops; the parents stay drawn.
 */
test('raising the depth over parents shown here ends that expansion; the parents stay drawn', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setup(page);
    await parentsTab(page, PERSON).click();
    await expect(cardOf(page, PARENTS[0])).toBeVisible();
    expect(await shownCount(page)).toBe(1);
    await page.evaluate(() => window.Strom.TreeRenderer.setFocusDepth(3, window.Strom.TreeRenderer.getFocusDepthDown()));
    await expect(cardOf(page, PARENTS[0])).toBeVisible();
    await expect.poll(() => page.evaluate(id => window.Strom.TreeRenderer.isParentsShown(id as never), PERSON)).toBe(false);
    expect(await shownCount(page)).toBe(0);
    await expect(cardOf(page, PERSON).locator('.branch-tab.parents-tab.active, .branch-tab.parents-tab[aria-pressed="true"]')).toHaveCount(0);
    await expect(cardOf(page, PARENTS[0])).not.toHaveClass(/shown-here/);
});

/** Open a fixture (invented data) with the focus on `focus` at the ancestor depth `depth`, the view centred on `center`. */
async function setupWith(page: Page, fixture: string, focus: string, depth: number, center: string): Promise<void> {
    await openApp(page);
    const data = JSON.parse(readFileSync(join(process.cwd(), 'test', `${fixture}.json`), 'utf-8'));
    await page.evaluate(async ([tree, f, d]) => {
        await window.Strom.DataManager.importAsNewTree(tree as never, 'Fixture');
        await window.Strom.TreeRenderer.setFocus(f as never);
        window.Strom.TreeRenderer.setFocusDepth(d as number, window.Strom.TreeRenderer.getFocusDepthDown());
    }, [data, focus, depth] as const);
    await expect(cardOf(page, center)).toBeVisible();
    await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), center);
}

/**
 * At depth 1 the selection holds the aunts and uncles already: "▸ parents"
 * on a focus parent still shows the parents alone (frame 4c), the siblings
 * come with "▸ siblings" (the parents with their children in one step).
 */
test('depth 1: "▸ parents" on a parent of the focus shows the grandparents alone; "▸ siblings" brings the aunts and uncles too', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setupWith(page, 'comprehensive', 'focus', 1, PERSON);
    for (const id of [...PARENTS, ...SIBLINGS]) await expect(cardOf(page, id)).toHaveCount(0);
    await parentsTab(page, PERSON).click();
    for (const id of PARENTS) await expect(cardOf(page, id)).toBeVisible();
    await page.mouse.move(5, 500);
    for (const id of [...SIBLINGS, 'cousin_h_1', 'cousin_h_4']) await expect(cardOf(page, id)).toHaveCount(0);
    await expect(parentsTab(page, PERSON)).toHaveClass(/active/);
    // The aunts and uncles are what the siblings tab now promises (the parents in view, §1)
    await expect(siblingsTab(page, PERSON)).toHaveClass(/kind-place/);
    await expect(siblingsTab(page, PERSON).locator('.badge-tooltip-item')).toHaveCount(SIBLINGS.length);
    await parentsTab(page, PERSON).click();
    for (const id of PARENTS) await expect(cardOf(page, id)).toHaveCount(0);
    await page.mouse.move(5, 500);

    await siblingsTab(page, PERSON).click();
    for (const id of [...PARENTS, ...SIBLINGS]) await expect(cardOf(page, id)).toBeVisible();
    for (const id of [...PARENTS, ...SIBLINGS]) await expect(cardOf(page, id)).toHaveClass(/shown-here/);
    // The siblings come as children shown in place do: without their families
    for (const id of ['cousin_h_1', 'cousin_h_4']) await expect(cardOf(page, id)).toHaveCount(0);
    expect(await shownCount(page)).toBe(1);
});

