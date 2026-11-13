import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { openApp } from './helpers.js';

/**
 * Children and siblings at once from the person menu (a): the row counts
 * the people the step adds ("+n", the same number of new cards), the step is
 * one layout, one render and one step of "Hide shown · n"; the card keeps
 * its place, Back gives the view as it was. Over 150 people a bubble asks
 * first; Cancel leaves everything as it was. Invented data only: the
 * edge-ancestor-children fixture (13 children of an ancestor, 6
 * generations) and a generated tree with many children per ancestor.
 */

const cardOf = (page: Page, id: string) => page.locator(`#tree-canvas .person-card[data-id="${id}"]`);
const shownCount = (page: Page) => page.evaluate(() => window.Strom.TreeRenderer.shownChildrenCount());

async function setupData(page: Page, data: unknown, focus: string, up: number, down: number): Promise<void> {
    await openApp(page);
    await page.evaluate(async ([tree, f, u, d]) => {
        await window.Strom.DataManager.importAsNewTree(tree as never, 'Bulk');
        await window.Strom.TreeRenderer.setFocus(f as never);
        window.Strom.TreeRenderer.setFocusDepth(u as number, d as number);
    }, [data, focus, up, down] as const);
    await expect(cardOf(page, focus)).toBeVisible();
    await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), focus);
}

/** Every drawn card's centre and size on the screen, by id (to a pixel). */
async function screenRects(page: Page): Promise<Record<string, [number, number, number, number]>> {
    return page.evaluate(() => {
        const out: Record<string, [number, number, number, number]> = {};
        for (const c of document.querySelectorAll<HTMLElement>('#tree-canvas .person-card[data-id]')) {
            const r = c.getBoundingClientRect();
            out[c.dataset.id!] = [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2), Math.round(r.width), Math.round(r.height)];
        }
        return out;
    });
}

const near = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1;

/** Cards whose rectangles overlap (the layout's first invariant). */
function overlaps(rects: Record<string, [number, number, number, number]>): string[] {
    const ids = Object.keys(rects);
    const out: string[] = [];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const [acx, acy, aw, ah] = rects[ids[i]], [bcx, bcy, bw, bh] = rects[ids[j]];
        const ax = acx - aw / 2, ay = acy - ah / 2, bx = bcx - bw / 2, by = bcy - bh / 2;
        if (ax < bx + bw - 1 && bx < ax + aw - 1 && ay < by + bh - 1 && by < ay + ah - 1) out.push(`${ids[i]}×${ids[j]}`);
    }
    return out;
}

/** Count the layouts of the view (the outputs' own layouts, debug === false, left out). */
async function spyLayouts(page: Page): Promise<void> {
    await page.evaluate(() => {
        const r = window.Strom.TreeRenderer as unknown as Record<string, unknown> & { __layouts?: number };
        const orig = r.computeTreeLayout as (...a: unknown[]) => unknown;
        r.__layouts = 0;
        r.computeTreeLayout = function (this: unknown, ...a: unknown[]) {
            if (a[2] !== false) r.__layouts! += 1;
            return orig.apply(this, a);
        };
    });
}
const layoutCalls = (page: Page) => page.evaluate(() => (window.Strom.TreeRenderer as unknown as { __layouts: number }).__layouts);

/**
 * An invented tree: the focus with a wife and three children; every
 * ancestor couple up to four generations has `extra` children besides the
 * one on the focus's line.
 */
function bigTree(extra: number): unknown {
    const persons: Record<string, Record<string, unknown>> = {};
    const partnerships: Record<string, Record<string, unknown>> = {};
    const person = (id: string, gender: 'male' | 'female', parentIds: string[] = []) => {
        persons[id] = { id, firstName: `Q${Object.keys(persons).length}`, lastName: 'Quillborn', gender, isPlaceholder: false, partnerships: [], parentIds, childIds: [] };
    };
    const union = (id: string, a: string, b: string, childIds: string[]) => {
        partnerships[id] = { id, person1Id: a, person2Id: b, childIds, status: 'married' };
        for (const p of [a, b]) {
            (persons[p].partnerships as string[]).push(id);
            (persons[p].childIds as string[]).push(...childIds);
        }
    };
    // The couple of `child`'s parents, `gen` generations above the focus, and theirs up to four
    const parentsOf = (child: string, prefix: string, gen: number) => {
        const f = `${prefix}f`, m = `${prefix}m`;
        person(f, 'male'); person(m, 'female');
        persons[child].parentIds = [f, m];
        const kids = [child];
        for (let i = 0; i < extra; i++) { const k = `${prefix}k${i}`; person(k, i % 2 ? 'female' : 'male', [f, m]); kids.push(k); }
        union(`u_${prefix}`, f, m, kids);
        if (gen < 4) { parentsOf(f, `${prefix}f`, gen + 1); parentsOf(m, `${prefix}m`, gen + 1); }
    };
    person('q', 'male'); person('q_w', 'female');
    for (const k of ['q_c1', 'q_c2', 'q_c3']) person(k, 'female', ['q', 'q_w']);
    union('u_q', 'q', 'q_w', ['q_c1', 'q_c2', 'q_c3']);
    parentsOf('q', 'p', 1);
    return { persons, partnerships };
}

test('the menu row expands children and siblings in one step: +n new cards, one layout, the card stays, Back gives the view back', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const data = JSON.parse(readFileSync(join(process.cwd(), 'test', 'edge-ancestor-children.json'), 'utf-8'));
    await setupData(page, data, 'focus', 6, 1);
    await page.mouse.move(5, 500);

    const n = await page.evaluate(() => window.Strom.TreeRenderer.bulkFamilyCount('focus' as never));
    expect(n).toBeGreaterThan(0);
    await cardOf(page, 'focus').click();
    const menu = page.locator('.context-menu');
    const row = menu.locator('[data-action="bulk-family"]');
    await expect(row).toBeVisible();
    await expect(row).toContainText('Expand children and siblings');
    await expect(row).toContainText(`+${n}`);
    await expect(row).toHaveAttribute('aria-label', `Expand children and siblings, ${n} people to add`);
    // Under both single rows: the children row stands before it
    const order = await menu.locator('[data-action]').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.action));
    expect(order.indexOf('bulk-family')).toBeGreaterThan(order.findIndex(a => /children/.test(a ?? '')));

    const before = await screenRects(page);
    const stepsBefore = await shownCount(page);
    await spyLayouts(page);
    await row.click();
    await expect(menu).toHaveCount(0);
    await expect.poll(async () => Object.keys(await screenRects(page)).length).toBeGreaterThan(Object.keys(before).length);
    await page.waitForTimeout(700);
    const after = await screenRects(page);
    const fresh = Object.keys(after).filter(id => !(id in before));
    expect(fresh.length).toBe(n);
    expect(await layoutCalls(page)).toBe(1);
    expect(await shownCount(page)).toBe(stepsBefore + 1);
    expect(near(after.focus, before.focus)).toBe(true);
    expect(overlaps(after)).toEqual([]);
    // Nothing more to add: the row takes the step back
    expect(await page.evaluate(() => window.Strom.TreeRenderer.bulkFamilyState('focus' as never).state)).toBe('on');
    await cardOf(page, 'focus').click();
    await expect(menu.locator('[data-action="bulk-family-off"]')).toHaveText(/Collapse children and siblings/);
    await page.keyboard.press('Escape');

    // Back: the layout as it was, every card where it stood
    await page.evaluate(() => window.Strom.TreeRenderer.goBack());
    await expect.poll(async () => Object.keys(await screenRects(page)).sort()).toEqual(Object.keys(before).sort());
    await page.waitForTimeout(700);
    const back = await screenRects(page);
    for (const id of Object.keys(before)) expect(near(back[id], before[id]), id).toBe(true);
    expect(await shownCount(page)).toBe(stepsBefore);
});

test('another depth: the step stays drawn, the row offers again', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const data = JSON.parse(readFileSync(join(process.cwd(), 'test', 'edge-ancestor-children.json'), 'utf-8'));
    await setupData(page, data, 'focus', 6, 1);
    await page.evaluate(() => window.Strom.TreeRenderer.showBulkFamily('focus' as never, 'b'));
    expect(await page.evaluate(() => window.Strom.TreeRenderer.bulkStepOf('focus' as never)?.source)).toBe('b');
    await page.evaluate(() => window.Strom.TreeRenderer.setFocusDepth(5, 1));
    await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.bulkStepOf('focus' as never))).toBeNull();
});

test('over 150 people a bubble asks first; Cancel and Esc leave the view as it was, "Expand +n" adds them', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setupData(page, bigTree(14), 'q', 4, 1);
    await page.mouse.move(5, 500);
    const n = await page.evaluate(() => window.Strom.TreeRenderer.bulkFamilyCount('q' as never));
    const m = await page.evaluate(() => window.Strom.TreeRenderer.bulkFamilyCount('q' as never, 2));
    expect(n).toBeGreaterThan(150);
    expect(m).toBeLessThan(n);
    const before = await screenRects(page);
    const stepsBefore = await shownCount(page);

    await cardOf(page, 'q').click();
    const row = page.locator('.context-menu [data-action="bulk-family"]');
    await row.click();
    const bubble = page.locator('.bulk-bubble');
    await expect(bubble).toBeVisible();
    await expect(bubble).toHaveAttribute('role', 'dialog');
    await expect(bubble.locator('.bulk-bubble-title')).toHaveText(`${n} people will be added`);
    await expect(bubble.locator('.bulk-bubble-body')).toHaveText(/^The tree will grow to about \d+ screen widths?\. The zoom stays\.$/);
    await expect(bubble.locator('[data-pick="all"]')).toHaveText(`Expand +${n}`);
    await expect(bubble.locator('[data-pick="all"]')).toBeFocused();
    await expect(bubble.locator('[data-pick="two"]')).toHaveText(`Only 2 ancestor generations +${m}`);
    // The menu stays under it, its row marked
    await expect(row).toHaveClass(/is-asking/);
    const box = await bubble.boundingBox();
    const menuBox = await page.locator('.context-menu').boundingBox();
    expect(box!.x + box!.width <= menuBox!.x || box!.x >= menuBox!.x + menuBox!.width).toBe(true);

    await bubble.locator('[data-pick="cancel"]').click();
    await expect(bubble).toHaveCount(0);
    expect(Object.keys(await screenRects(page)).sort()).toEqual(Object.keys(before).sort());
    expect(await shownCount(page)).toBe(stepsBefore);

    // Esc cancels the bubble alone (the menu stays), a click beside it too
    await row.click();
    await expect(bubble).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(bubble).toHaveCount(0);
    await expect(page.locator('.context-menu')).toBeVisible();
    await row.click();
    await expect(bubble).toBeVisible();
    await page.mouse.click(700, 850);
    await expect(bubble).toHaveCount(0);
    expect(Object.keys(await screenRects(page)).length).toBe(Object.keys(before).length);
    expect(await shownCount(page)).toBe(stepsBefore);

    // "Only 2 ancestor generations" adds m people, the zoom stays
    const scale = await page.evaluate(() => window.Strom.ZoomPan.getScale());
    await cardOf(page, 'q').click();
    await page.locator('.context-menu [data-action="bulk-family"]').click();
    await bubble.locator('[data-pick="two"]').click();
    await expect(page.locator('.context-menu')).toHaveCount(0);
    await expect.poll(async () => Object.keys(await screenRects(page)).length).toBe(Object.keys(before).length + m);
    expect(await shownCount(page)).toBe(stepsBefore + 1);
    expect(await page.evaluate(() => window.Strom.ZoomPan.getScale())).toBe(scale);
});

test('phone: the person sheet has the row at 52px; a tap expands', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const data = JSON.parse(readFileSync(join(process.cwd(), 'test', 'edge-ancestor-children.json'), 'utf-8'));
    await setupData(page, data, 'focus', 6, 1);
    const n = await page.evaluate(() => window.Strom.TreeRenderer.bulkFamilyCount('focus' as never));
    const before = Object.keys(await screenRects(page)).length;
    await cardOf(page, 'focus').click();
    const sheet = page.locator('.bottom-sheet-person');
    await expect(sheet).toBeVisible();
    const row = sheet.locator('[data-action="bulk-family"]');
    await expect(row).toBeVisible();
    await expect(row).toContainText(`+${n}`);
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(52);
    await row.click();
    await expect(sheet).toHaveCount(0);
    await expect.poll(async () => Object.keys(await screenRects(page)).length).toBeGreaterThan(before);
    expect(await page.evaluate(() => window.Strom.TreeRenderer.bulkFamilyState('focus' as never).state)).toBe('on');
});
