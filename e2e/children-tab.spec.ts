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
    await expect(tab.locator('.badge-tooltip-action')).toHaveText('A click shows them here; the view stays.');

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
    // Its bubble stands beside it (rows of its own may follow)
    await expect(cardOf(page, ANCESTOR).locator('.children-bubble > .badge-tooltip-header')).toHaveText('Children shown here');
    await expect(cardOf(page, ANCESTOR).locator('.children-bubble > .badge-tooltip-action')).toHaveText('A click on the tab hides them again.');
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

test('the children shown in place wear the hatch, at every level, and lose it when hidden again', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setup(page);
    const marked = () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#tree-canvas .person-card.shown-here')]
        .map(c => c.dataset.id!).sort());
    const hatch = (id: string) => page.evaluate(pid => getComputedStyle(document.querySelector(`#tree-canvas .person-card[data-id="${pid}"]`)!).backgroundImage, id);
    expect(await marked()).toEqual([]);
    await tabOf(page, ANCESTOR).click();
    await expect(cardOf(page, SIBLINGS[0])).toBeVisible();
    // The children the click brought into view; not the father, not the focus's line drawn before
    await expect.poll(marked).toEqual([HALF, ...SIBLINGS].sort());
    expect(await hatch(SIBLINGS[0])).toContain('repeating-linear-gradient');
    expect(await hatch(ANCESTOR)).toBe('none');
    await expect(cardOf(page, 'focus')).not.toHaveClass(/shown-here/);
    // Not the look of a person linked in the view only: the card's own border stays
    const border = (id: string) => page.evaluate(pid => getComputedStyle(document.querySelector(`#tree-canvas .person-card[data-id="${pid}"]`)!).borderTopColor, id);
    expect(await border(SIBLINGS[0])).toBe(await border(ANCESTOR));
    // A level down: a shown child's own children, with the partner they come with
    // (every card in view only thanks to an expansion wears it)
    const nested = tabOf(page, SIBLINGS[0]);
    await nested.click();
    await expect(cardOf(page, 'nephew_1_1')).toBeVisible();
    await expect.poll(marked).toEqual([HALF, ...SIBLINGS, 'sibling_1_spouse', 'nephew_1_1', 'nephew_1_2', 'nephew_1_3'].sort());
    await tabOf(page, SIBLINGS[0]).click();
    await expect(cardOf(page, 'nephew_1_1')).toHaveCount(0);
    await expect.poll(marked).toEqual([HALF, ...SIBLINGS].sort());
    // Dark: the hatch is there too
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    expect(await hatch(SIBLINGS[0])).toContain('repeating-linear-gradient');
    await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
    await tabOf(page, ANCESTOR).click();
    await expect(cardOf(page, SIBLINGS[0])).toHaveCount(0);
    await expect.poll(marked).toEqual([]);
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
    await expect(page.locator('.context-menu .context-menu-item[data-action="toggle-children"]')).toHaveText('Hide the children shown here');
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

test('a grandfather at the edge of the depth with parents, a brother and a son of his second marriage out of view: parents, siblings and children in place, the tabs inside the card, the children shown in place', async ({ page }) => {
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
    // Out of view only because of the depth (§4): parents and brother are shown in place, no focus tab; the order goes by relation
    await expect(row.locator(':scope > .branch-tab')).toHaveCount(3);
    expect(await row.locator(':scope > .branch-tab').evaluateAll(tabs => tabs.map(t => t.className)))
        .toEqual([expect.stringContaining('parents-tab'), expect.stringContaining('siblings-tab'), expect.stringContaining('children-tab')]);
    await expect(row.locator('.branch-tab.kind-focus')).toHaveCount(0);
    await expect(row.locator('.children-tab')).toHaveAttribute('aria-label', /^Kinder von .+ hier zeigen$/);
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

/** Import a test fixture (invented data) and focus a person. */
async function setupFixture(page: Page, fixture: string, focus: string): Promise<void> {
    await openApp(page);
    const data = JSON.parse(readFileSync(join(process.cwd(), 'test', `${fixture}.json`), 'utf-8'));
    await page.evaluate(async ([tree, f]) => {
        await window.Strom.DataManager.importAsNewTree(tree as never, 'Chains');
        await window.Strom.TreeRenderer.setFocus(f as never);
    }, [data, focus] as const);
    await expect(cardOf(page, focus)).toBeVisible();
}

test('a "?" parent whose child hangs on a parent link alone: no children tab, no menu row', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // comprehensive's "Unknown Parent": the child has no family with it, the layout never draws it below
    await setupFixture(page, 'comprehensive', 'placeholder_h_1');
    await expect(tabOf(page, 'placeholder_h_1')).toHaveCount(0);
    expect(await page.evaluate(() => window.Strom.TreeRenderer.canToggleChildren('placeholder_h_1' as never))).toBe(false);
    await cardOf(page, 'placeholder_h_1').click({ position: { x: 60, y: 40 } });
    await expect(page.locator('.context-menu')).toBeVisible();
    await expect(page.locator('.context-menu .context-menu-item[data-action="toggle-children"]')).toHaveCount(0);
});

test('a great-great-grandfather with twelve hidden children: shown beside his direct-line child, no card over another', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // Six generations up the father's line (invented data)
    const gf = 'f_m_f_m_f_f';
    await setupFixture(page, 'edge-ancestor-children', 'focus');
    await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), gf);
    const before = await screenCenters(page);
    await tabOf(page, gf).click();
    for (let i = 0; i < 12; i++) await expect(cardOf(page, `f_m_f_m_f_sib${i}`)).toHaveCount(1);
    await page.mouse.move(5, 500);
    // The card keeps its place (its centre: the view may zoom out around it, §5)
    await expect.poll(async () => (await screenCenters(page))[gf]).toEqual(before[gf]);
    // No two drawn cards cover each other
    const overlaps = await page.evaluate(() => {
        const rects = [...document.querySelectorAll<HTMLElement>('#tree-canvas .person-card[data-id]')]
            .map(c => ({ id: c.dataset.id!, r: c.getBoundingClientRect() }));
        const out: string[] = [];
        for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i].r, b = rects[j].r;
            if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push(`${rects[i].id}/${rects[j].id}`);
        }
        return out;
    });
    expect(overlaps).toEqual([]);
    // The siblings stand in one row with the direct-line child
    const pos = await screenPositions(page);
    const kids = ['f_m_f_m_f', ...Array.from({ length: 12 }, (_, i) => `f_m_f_m_f_sib${i}`)];
    for (const k of kids) expect(pos[k][1]).toBe(pos.f_m_f_m_f[1]);
    // ... beside each other: no foreign card between them (a sibling's spouses may stand by)
    const lo = Math.min(...kids.map(k => pos[k][0])), hi = Math.max(...kids.map(k => pos[k][0]));
    const own = new Set([...kids, 'f_m_f_m_f_sib1_sp0', 'f_m_f_m_f_sib1_sp1', 'f_m_f_m_m']);
    const between = Object.entries(pos).filter(([id, [x, y]]) => !own.has(id) && y === pos.f_m_f_m_f[1] && x > lo && x < hi);
    expect(between.map(([id]) => id)).toEqual([]);
});

test.describe('partner chains through several people', () => {
    test('a widow remarried twice: her other families stand in view already, her card promises nothing', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        // adam, married to dana and to bea; bea also to cyril and to emil
        await setupFixture(page, 'edge-remarriage-web', 'adam');
        for (const id of ['bea', 'cyril', 'emil', 'k_ab1', 'k_ab2', 'k_ad1', 'k_cb1', 'k_eb1']) await expect(cardOf(page, id)).toBeVisible();
        await expect(tabOf(page, 'bea')).toHaveCount(0);
        await cardOf(page, 'bea').click({ position: { x: 60, y: 40 } });
        await expect(page.locator('.context-menu')).toBeVisible();
        await expect(page.locator('.context-menu .context-menu-item[data-action="toggle-children"]')).toHaveCount(0);
    });

    test('a marriage cascade: the tab shows the promised child, and the shown bubble names only that child', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        // b-c, c-d, d-e; focus d: b's first family (with a) is out of view
        await setupFixture(page, 'edge-marriage-cascade', 'd');
        await expect(cardOf(page, 'k_bc')).toBeVisible();
        await expect(cardOf(page, 'k_ab')).toHaveCount(0);
        const tab = tabOf(page, 'b');
        await expect(tab).toHaveCount(1);
        await expect(tab.locator('.badge-tooltip-item')).toHaveCount(1);
        await expect(tab.locator('.badge-tooltip-name')).toHaveText('Kid AB');
        await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), 'b');
        await tab.click();
        await expect(cardOf(page, 'k_ab')).toBeVisible();
        await expect(cardOf(page, 'a')).toBeVisible();
        const hide = tabOf(page, 'b');
        await expect(hide).toHaveAttribute('aria-pressed', 'true');
        // Kid BC stood in view before the click: the bubble leaves it out
        await expect(cardOf(page, 'b').locator('.children-bubble .badge-tooltip-name')).toHaveText(['Kid AB']);
    });
});

test('two expansions: the focus bar hides both at once, every card back where it stood', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setup(page);
    await page.mouse.move(5, 500);
    const before = await screenPositions(page);
    const button = page.locator('#hide-shown-children');
    await expect(button).toBeHidden();
    await tabOf(page, ANCESTOR).click();
    await expect(cardOf(page, SIBLINGS[0])).toBeVisible();
    await expect(button).toBeVisible();
    await expect(button).toHaveText('▾Hide shown · 1');
    await expect(button).toHaveAttribute('aria-label', 'Hide everything shown here (1 expansion)');
    // Just shown: the father's children in view glow for a moment
    await expect(cardOf(page, SIBLINGS[0])).toHaveClass(/children-glow/);
    // A second card with children out of view (the view moves to keep it in place)
    const second = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#tree-canvas .person-card[data-id]')]
        .find(c => c.querySelector('.children-tab:not(.active)'))?.dataset.id ?? null);
    expect(second).not.toBeNull();
    await page.evaluate(id => window.Strom.TreeRenderer.toggleChildrenShown(id as never), second);
    await expect(cardOf(page, second!).locator('.children-tab')).toHaveAttribute('aria-pressed', 'true');
    await expect(button).toHaveText('▾Hide shown · 2');
    await expect(button).toHaveAttribute('aria-label', 'Hide everything shown here (2 expansions)');
    // The bar's order: after the depth steppers
    expect(await page.evaluate(() => {
        const b = document.getElementById('hide-shown-children')!;
        return b.previousElementSibling?.classList.contains('focus-depth') ?? false;
    })).toBe(true);
    await button.click();
    await page.mouse.move(5, 500);
    await expect(page.locator('#tree-canvas .children-tab.active')).toHaveCount(0);
    await expect(button).toBeHidden();
    for (const id of SIBLINGS) await expect(cardOf(page, id)).toHaveCount(0);
    await expect.poll(() => screenPositions(page)).toEqual(before);
});

test('a child drawn elsewhere in the tree: counted before the click, after it a row that moves the view to the card', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // Invented: the mother's sister Ilse married the father's brother and stands by him
    await setupFixture(page, 'edge-children-elsewhere', 'focus');
    const grandma = 'v_mo';
    await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), grandma);
    const tab = tabOf(page, grandma);
    await expect(tab.locator('.badge-tooltip-item')).toHaveCount(1);
    await expect(tab.locator('.badge-tooltip-elsewhere')).toHaveText('More elsewhere in the tree: 1');
    // The menu offers the card under its children row
    await cardOf(page, grandma).click({ position: { x: 60, y: 40 } });
    const menuRow = page.locator('.context-menu [data-action="child-elsewhere:aunt"]');
    await expect(menuRow).toHaveText(/Ilse Varnhag \*1951/);
    await expect(page.locator('.context-menu .menu-section-header')).toContainText(['Already in the tree elsewhere']);
    await page.keyboard.press('Escape');

    await tab.click();
    await expect(cardOf(page, 'half_v')).toBeVisible();
    const hide = tabOf(page, grandma);
    await expect(hide).toHaveAttribute('aria-pressed', 'true');
    // Over the tab the bubble opens; the pointer reaches its rows
    await hide.hover();
    const bubble = cardOf(page, grandma).locator('.children-bubble');
    await expect(bubble).toBeVisible();
    await expect(bubble.locator('.badge-tooltip-name').first()).toHaveText('Gero Ostrel');
    const row = bubble.locator('.children-elsewhere-row');
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute('aria-label', 'Move the view to the card of Ilse Varnhag');
    await expect(bubble.locator('.badge-tooltip-action')).toHaveText('A click on the tab hides them again.');
    // While it is open the grandmother's children glow
    await expect(cardOf(page, 'mother')).toHaveClass(/children-glow/);
    await row.click();
    await expect(bubble).toBeHidden();
    // The card stands in the middle of the tree, the children stay shown
    await expect.poll(() => page.evaluate(() => {
        const c = document.querySelector<HTMLElement>('#tree-canvas .person-card[data-id="aunt"]')!.getBoundingClientRect();
        const t = document.getElementById('tree-container')!.getBoundingClientRect();
        return [Math.round(c.left + c.width / 2 - (t.left + t.width / 2)), Math.round(c.top + c.height / 2 - (t.top + t.height / 2))]
            .every(d => Math.abs(d) <= 3);
    })).toBe(true);
    await expect(cardOf(page, 'aunt')).toHaveClass(/children-glow/);
    await expect(cardOf(page, 'half_v')).toBeVisible();
});

/** The child drawn elsewhere lands in the middle of the tree at a readable scale (75 % or more, src/jump-view.ts). */
async function expectElsewhereLanding(page: Page): Promise<void> {
    await expect.poll(() => page.evaluate(() => window.Strom.ZoomPan.getScale())).toBeGreaterThanOrEqual(0.75);
    await expect.poll(() => page.evaluate(() => {
        const c = document.querySelector<HTMLElement>('#tree-canvas .person-card[data-id="aunt"]')!.getBoundingClientRect();
        const t = document.getElementById('tree-container')!.getBoundingClientRect();
        return Math.hypot(c.left + c.width / 2 - (t.left + t.width / 2), c.top + c.height / 2 - (t.top + t.height / 2)) <= 3;
    })).toBe(true);
    await expect(cardOf(page, 'aunt')).toHaveClass(/children-glow/);
}

/** Zoom far out around a card (its controls still there to press). */
async function zoomFarOut(page: Page, id: string): Promise<void> {
    await page.evaluate(pid => window.Strom.ZoomPan.glideToPerson(pid as never, 0.3, 0), id);
    await expect.poll(() => page.evaluate(() => window.Strom.ZoomPan.getScale())).toBeCloseTo(0.3, 2);
}

test('a child drawn elsewhere from a view zoomed far out: the row lands on the card readable', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setupFixture(page, 'edge-children-elsewhere', 'focus');
    const grandma = 'v_mo';
    await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), grandma);
    await tabOf(page, grandma).click();
    await expect(cardOf(page, 'half_v')).toBeVisible();
    await zoomFarOut(page, grandma);
    await tabOf(page, grandma).hover();
    const row = cardOf(page, grandma).locator('.children-bubble .children-elsewhere-row');
    await expect(row).toBeVisible();
    await row.click();
    await expectElsewhereLanding(page);
});

/**
 * A pointer that stays still while the page under it changes: Chrome hit-tests
 * it again after every layout, so a bubble that moves when its card loses the
 * hover shows and hides in a loop (Milan, beta.6). The headless browser
 * hit-tests only on input, so moves to the same point every 20 ms stand in for
 * it. Returns how often, after the first `settleMs`, the bubble (or the tab's
 * own bubble) changed: opened or closed, moved, or came under the pointer or
 * left it.
 */
async function restingChanges(page: Page, cardId: string, bubbleSel: string, x: number, y: number, settleMs = 300, countMs = 900): Promise<number> {
    await page.evaluate(([id, sel, px, py]) => {
        const w = window as unknown as { __rest: { n: number; on: boolean; stop: boolean } };
        w.__rest = { n: 0, on: false, stop: false };
        const card = document.querySelector<HTMLElement>(`#tree-canvas .person-card[data-id="${id}"]`)!;
        const bubble = card.querySelector<HTMLElement>(sel as string)!;
        const state = (): string => {
            const shown = getComputedStyle(bubble).display !== 'none';
            const r = bubble.getBoundingClientRect();
            const under = document.elementFromPoint(px as number, py as number);
            return `${shown}|${Math.round(r.left)}|${Math.round(r.top)}|${!!under && bubble.contains(under)}`;
        };
        let last = state();
        const tick = (): void => {
            const s = state();
            if (s !== last && w.__rest.on) w.__rest.n++;
            last = s;
            if (!w.__rest.stop) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }, [cardId, bubbleSel, x, y] as const);
    const t0 = Date.now();
    let counting = false;
    while (Date.now() - t0 < settleMs + countMs) {
        if (!counting && Date.now() - t0 >= settleMs) {
            counting = true;
            await page.evaluate(() => { (window as unknown as { __rest: { on: boolean } }).__rest.on = true; });
        }
        await page.mouse.move(x, y);
        await page.waitForTimeout(20);
    }
    return page.evaluate(() => {
        const r = (window as unknown as { __rest: { n: number; stop: boolean } }).__rest;
        r.stop = true;
        return r.n;
    });
}

test.describe('a still pointer by a tab or its bubble (mouse)', () => {
    test('"▾ children": at the bubble\'s edge, in the way to the tab and on the tab the bubble neither blinks nor moves', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await setup(page);
        await tabOf(page, ANCESTOR).click();
        await expect(cardOf(page, SIBLINGS[0])).toBeVisible();
        await page.mouse.move(5, 500);
        const tab = tabOf(page, ANCESTOR);
        const bubble = cardOf(page, ANCESTOR).locator('.children-bubble');
        const t = (await tab.boundingBox())!;
        const cx = t.x + t.width / 2;
        await tab.hover();
        await expect(bubble).toBeVisible();
        const b = (await bubble.boundingBox())!;
        // The arrow points at the tab's middle
        expect(Math.abs(b.x + b.width / 2 - cx)).toBeLessThanOrEqual(2);
        // Just inside and just outside the bubble's edges (sides at the header, the bottom by the tab)
        const spots: [string, number, number][] = [
            ['right edge, inside', b.x + b.width - 2, b.y + 12],
            ['right edge, outside', b.x + b.width + 4, b.y + 12],
            ['right edge, further out', b.x + b.width + 12, b.y + 12],
            ['left edge, inside', b.x + 2, b.y + 12],
            ['left edge, outside', b.x - 4, b.y + 12],
            ['bottom edge, inside', b.x + 20, b.y + b.height - 2],
            ['bottom edge, outside', b.x + 20, b.y + b.height + 1],
            ['the way to the tab', cx, (b.y + b.height + t.y) / 2],
            ['the tab', cx, t.y + t.height / 2],
        ];
        const moved: string[] = [];
        for (const [name, x, y] of spots) {
            await page.mouse.move(5, 500);
            await page.waitForTimeout(250);
            await tab.hover();
            await expect(bubble).toBeVisible();
            await page.mouse.move(cx, b.y + b.height / 2, { steps: 4 });
            await page.mouse.move(x, y, { steps: 4 });
            const n = await restingChanges(page, ANCESTOR, '.children-bubble', x, y);
            if (n > 0) moved.push(`${name}: ${n}`);
        }
        expect(moved).toEqual([]);
        // Out of both the bubble closes; from the tab into the bubble it stays
        await page.mouse.move(5, 500);
        await expect(bubble).toBeHidden();
        await tab.hover();
        await page.mouse.move(cx, b.y + b.height / 2, { steps: 6 });
        await expect(bubble).toBeVisible();
    });

    test('the tab\'s own bubble ("▸ children"): a pointer on the tab\'s lower edge does not make it blink', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await setup(page);
        const tab = tabOf(page, ANCESTOR);
        await page.mouse.move(5, 500);
        // The card is under the pointer (it grows a little): the tab as it stands then
        await cardOf(page, ANCESTOR).hover({ position: { x: 40, y: 40 } });
        const t = (await tab.boundingBox())!;
        const cx = t.x + t.width / 2;
        const blinks: string[] = [];
        for (let dy = -3; dy <= 0.5; dy += 0.5) {
            const y = t.y + t.height + dy;
            await page.mouse.move(cx, t.y + t.height + 20, { steps: 2 });
            await page.waitForTimeout(100);
            await page.mouse.move(cx, y, { steps: 3 });
            const n = await restingChanges(page, ANCESTOR, '.children-tab .badge-tooltip', cx, y, 200, 600);
            if (n > 0) blinks.push(`${dy}: ${n}`);
        }
        expect(blinks).toEqual([]);
    });
});

test('the sibling-order pill: on the direct-line card beside its siblings, clear of the card\'s other edge pills', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setup(page);
    await tabOf(page, ANCESTOR).click();
    await expect(cardOf(page, SIBLINGS[0])).toBeVisible();
    const pills = page.locator('#tree-canvas .sibling-order-pill');
    const marks = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#tree-canvas .sibling-order-pill')].map(p => {
        const card = p.closest<HTMLElement>('.person-card')!;
        const r = p.getBoundingClientRect(), c = card.getBoundingClientRect();
        const others = [...card.querySelectorAll<HTMLElement>('.card-edge > *')].filter(o => o !== p && !p.contains(o) && o.offsetWidth > 0)
            .map(o => o.getBoundingClientRect())
            .filter(o => o.left < r.right && r.left < o.right && o.top < r.bottom && r.top < o.bottom);
        return { id: card.dataset.id, text: p.querySelector('.so-text')?.textContent, inside: r.left >= c.left && r.right <= c.right, overlaps: others.length, height: r.height };
    }));
    // Each mark stands on a card of the father's children, within the card, over no other pill
    for (const m of marks) {
        expect(['focus', ...SIBLINGS, HALF]).toContain(m.id);
        expect(m.inside).toBe(true);
        expect(m.overlaps).toBe(0);
        expect(m.height).toBeGreaterThanOrEqual(15);
        expect(m.height).toBeLessThanOrEqual(17);
    }
    expect(await pills.count()).toBe(marks.length);
    // The focus's line: born second of three, drawn at the inner end of the row
    expect(marks.map(m => [m.id, m.text])).toEqual([['focus', '2 of 3']]);
    await expect(cardOf(page, 'focus')).toHaveAttribute('aria-label', /By birth 2 of 3\./);
});

test('tablet and a phone held sideways: the chip stands below the evidence pill, not under it', async ({ page }) => {
    for (const viewport of [{ width: 1024, height: 768 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(viewport);
        await setup(page);
        await tabOf(page, ANCESTOR).click();
        const chip = page.locator('#hide-shown-children-chip');
        await expect(chip).toBeVisible();
        const alone = (await chip.boundingBox())!;
        await page.evaluate(() => window.Strom.UI.showEvidenceLevels());
        const pill = page.locator('#evidence-pill');
        await expect(pill).toBeVisible();
        const p = (await pill.boundingBox())!;
        const c = (await chip.boundingBox())!;
        const label = `${viewport.width}×${viewport.height}`;
        expect(c.y, label).toBeGreaterThanOrEqual(p.y + p.height);
        expect(c.y + c.height, label).toBeLessThanOrEqual(viewport.height);
        // Still the top centre of the tree, and a click there reaches the chip
        expect(Math.abs(c.x + c.width / 2 - viewport.width / 2), label).toBeLessThanOrEqual(2);
        expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('#hide-shown-children-chip') !== null, [c.x + c.width / 2, c.y + c.height / 2])).toBe(true);
        await page.evaluate(() => window.Strom.UI.endEvidenceHighlight());
        await expect(pill).toHaveCount(0);
        expect((await chip.boundingBox())!.y, label).toBe(alone.y);
    }
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

    test('a chip at the top of the tree hides the shown children', async ({ page }) => {
        await setup(page);
        const chip = page.locator('#hide-shown-children-chip');
        await expect(chip).toBeHidden();
        await tabOf(page, ANCESTOR).tap();
        for (const id of SIBLINGS) await expect(cardOf(page, id)).toHaveCount(1);
        await expect(chip).toBeVisible();
        await expect(chip).toHaveText('▾Hide shown · 1');
        await expect(page.locator('#hide-shown-children')).toBeHidden();
        const box = (await chip.boundingBox())!;
        expect(box.height).toBe(36);
        // At the top centre of the tree, within the phone's width
        expect(Math.abs(box.x + box.width / 2 - 195)).toBeLessThanOrEqual(2);
        expect(box.x).toBeGreaterThanOrEqual(16);
        await chip.tap();
        for (const id of SIBLINGS) await expect(cardOf(page, id)).toHaveCount(0);
        await expect(chip).toBeHidden();
    });

    test('a child drawn elsewhere from a view zoomed far out: the sheet row lands on the card readable', async ({ page }) => {
        await setupFixture(page, 'edge-children-elsewhere', 'focus');
        const grandma = 'v_mo';
        await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), grandma);
        await tabOf(page, grandma).tap();
        await expect(cardOf(page, 'half_v')).toBeVisible();
        // The sheet opens on the readable card; the view then zooms far out behind it
        await cardOf(page, grandma).tap({ position: { x: 40, y: 30 } });
        const sheet = page.locator('.bottom-sheet-person');
        await expect(sheet).toBeVisible();
        await zoomFarOut(page, grandma);
        await sheet.locator('[data-action="child-elsewhere:aunt"]').tap();
        await expect(sheet).toHaveCount(0);
        await expectElsewhereLanding(page);
    });
});

/** The animations running on cards (and what is in them), the ghost of the lines, the layer of leaving cards. */
async function cardMotion(page: Page): Promise<{ cards: number; ghost: number; leaving: number }> {
    return page.evaluate(() => ({
        cards: document.getAnimations().filter(a => {
            const t = (a.effect as KeyframeEffect | null)?.target;
            return t instanceof Element && !!t.closest('.person-card');
        }).length,
        ghost: document.querySelectorAll('.tree-lines-ghost').length,
        leaving: document.querySelectorAll('.children-leaving').length,
    }));
}

test.describe('the transition (§1)', () => {
    test('the cards move from where they stood: the clicked card stays at the start and the end, a second click returns every card', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await setup(page);
        await page.mouse.move(5, 500);
        const before = await screenCenters(page);
        const scale = await page.evaluate(() => window.Strom.ZoomPan.getScale());
        // Right after the click: the transition runs, every card that stayed still stands where it stood
        const start = await page.evaluate(async id => {
            await window.Strom.TreeRenderer.toggleChildrenShown(id as never);
            const out: Record<string, [number, number]> = {};
            for (const c of document.querySelectorAll<HTMLElement>('#tree-canvas .person-card[data-id]')) {
                const r = c.getBoundingClientRect();
                out[c.dataset.id!] = [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)];
            }
            const running = document.getAnimations().filter(a => (a.effect as KeyframeEffect | null)?.target instanceof Element).length;
            return { out, running, ghost: document.querySelectorAll('.tree-lines-ghost').length };
        }, ANCESTOR);
        expect(start.running).toBeGreaterThan(0);
        expect(start.ghost).toBe(1);
        for (const [id, [x, y]] of Object.entries(before)) {
            if (!start.out[id]) continue;
            expect(Math.abs(start.out[id][0] - x), id).toBeLessThanOrEqual(1);
            expect(Math.abs(start.out[id][1] - y), id).toBeLessThanOrEqual(1);
        }
        // The new children start at their parents' stem, small and transparent
        const child = await cardOf(page, SIBLINGS[0]).evaluate(el => Number(getComputedStyle(el).opacity));
        expect(child).toBeLessThan(1);
        // At the end: nothing runs, the ghost is gone, the clicked card where it stood
        await expect.poll(() => cardMotion(page)).toEqual({ cards: 0, ghost: 0, leaving: 0 });
        const end = await screenCenters(page);
        expect(Math.abs(end[ANCESTOR][0] - before[ANCESTOR][0])).toBeLessThanOrEqual(1);
        expect(Math.abs(end[ANCESTOR][1] - before[ANCESTOR][1])).toBeLessThanOrEqual(1);
        // Once the cards stand the children glow (§6)
        await expect(cardOf(page, SIBLINGS[0])).toHaveClass(/children-glow/);

        // Back: the children shrink into the stem in a layer of their own, then every card where it stood
        const back = await page.evaluate(async id => {
            await window.Strom.TreeRenderer.toggleChildrenShown(id as never);
            return document.querySelectorAll('.children-leaving .person-card').length;
        }, ANCESTOR);
        expect(back).toBeGreaterThanOrEqual(SIBLINGS.length);
        for (const id of SIBLINGS) await expect(cardOf(page, id)).toHaveCount(0);
        await expect.poll(() => cardMotion(page)).toEqual({ cards: 0, ghost: 0, leaving: 0 });
        expect(await screenCenters(page)).toEqual(before);
        expect(await page.evaluate(() => window.Strom.ZoomPan.getScale())).toBe(scale);
    });

    test('a click during the transition ends it at once and starts the next', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await setup(page);
        await page.mouse.move(5, 500);
        const before = await screenCenters(page);
        await page.evaluate(async id => {
            await window.Strom.TreeRenderer.toggleChildrenShown(id as never);
            await window.Strom.TreeRenderer.toggleChildrenShown(id as never);
        }, ANCESTOR);
        // One transition at a time: one ghost, one layer of leaving cards
        expect((await cardMotion(page)).ghost).toBeLessThanOrEqual(1);
        await expect.poll(() => cardMotion(page)).toEqual({ cards: 0, ghost: 0, leaving: 0 });
        expect(await screenCenters(page)).toEqual(before);
    });

    test('reduced motion: the new view in one frame, no animation on any card', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await setup(page);
        await page.mouse.move(5, 500);
        const motion = await page.evaluate(async id => {
            await window.Strom.TreeRenderer.toggleChildrenShown(id as never);
            const open = document.getAnimations().filter(a => {
                const t = (a.effect as KeyframeEffect | null)?.target;
                return t instanceof Element && !!t.closest('.person-card');
            }).length;
            const layers = document.querySelectorAll('.tree-lines-ghost, .children-leaving').length;
            await window.Strom.TreeRenderer.toggleChildrenShown(id as never);
            const close = document.getAnimations().filter(a => {
                const t = (a.effect as KeyframeEffect | null)?.target;
                return t instanceof Element && !!t.closest('.person-card');
            }).length;
            return { open, close, layers: layers + document.querySelectorAll('.tree-lines-ghost, .children-leaving').length };
        }, ANCESTOR);
        expect(motion).toEqual({ open: 0, close: 0, layers: 0 });
    });

    test.describe('phone 390 × 844', () => {
        test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

        test('shorter, and no zoom', async ({ page }) => {
            await page.emulateMedia({ reducedMotion: 'no-preference' });
            await setup(page);
            const scale = await page.evaluate(() => window.Strom.ZoomPan.getScale());
            const longest = await page.evaluate(async id => {
                await window.Strom.TreeRenderer.toggleChildrenShown(id as never);
                return Math.max(...document.getAnimations()
                    .filter(a => (a.effect as KeyframeEffect | null)?.target instanceof Element && !!((a.effect as KeyframeEffect).target as Element).closest('.person-card'))
                    .map(a => Number((a.effect as KeyframeEffect).getTiming().duration)));
            }, ANCESTOR);
            expect(longest).toBe(280);
            await expect.poll(() => cardMotion(page)).toEqual({ cards: 0, ghost: 0, leaving: 0 });
            expect(await page.evaluate(() => window.Strom.ZoomPan.getScale())).toBe(scale);
        });
    });
});

test.describe('ancestors folded for the children (§2)', () => {
    test('the partner\'s parents fold: a dashed "▸ parents" on the partner, a line in the bubble, a click on it returns the view', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        // Invented: Horace's (f_m_f) children belong on the inner side; his son-in-law's (f_f) parents fold
        await setupFixture(page, 'edge-ancestor-inner-siblings', 'focus');
        await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), 'f_m_f');
        await page.mouse.move(5, 500);
        const before = await screenPositions(page);
        await expect(cardOf(page, 'f_f_f')).toBeVisible();
        await tabOf(page, 'f_m_f').click();
        await page.mouse.move(5, 500);
        await expect(cardOf(page, 'f_m_s1')).toBeVisible();
        await expect(cardOf(page, 'f_f_f')).toHaveCount(0);
        await expect(cardOf(page, 'f_f_m')).toHaveCount(0);
        const folded = cardOf(page, 'f_f').locator('.edge-top-right .branch-tab.folded');
        await expect(folded).toHaveCount(1);
        await expect(folded.locator('.pill-glyph')).toHaveText('▸');
        const shownName = await page.evaluate(() => {
            const p = window.Strom.DataManager.getPerson('f_m_f' as never)!;
            return `${p.firstName} ${p.lastName}`;
        });
        await expect(folded).toHaveAttribute('aria-label', `Hide the children of ${shownName} and bring the parents back`);
        await expect(folded.locator('.badge-tooltip-header')).toHaveText('Parents hidden for now');
        await expect(folded.locator('.badge-tooltip-body')).toHaveText(`They make room for the children of ${shownName}.`);
        await expect(folded.locator('.badge-tooltip-action')).toHaveText('A click hides the children and brings the parents back.');
        // The dashed look
        expect(await folded.evaluate(el => getComputedStyle(el).borderTopStyle)).toBe('dashed');
        // The "▾ children" bubble names whose ancestors are folded
        const qName = await page.evaluate(() => {
            const p = window.Strom.DataManager.getPerson('f_f' as never)!;
            return `${p.firstName} ${p.lastName}`;
        });
        await expect(cardOf(page, 'f_m_f').locator('.children-bubble .badge-tooltip-folded')).toHaveText(`The ancestors of ${qName} are hidden for now.`);
        // Every card keeps its tabs within its width
        const outside = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#tree-canvas .person-card')].filter(card => {
            const c = card.getBoundingClientRect();
            return [...card.querySelectorAll(':scope > .edge-top-right > .branch-tab')].some(t => t.getBoundingClientRect().left < c.left);
        }).map(c => c.dataset.id));
        expect(outside).toEqual([]);

        // A click on the dashed tab hides the children: the parents back, the view as it was
        await folded.click();
        await page.mouse.move(5, 500);
        await expect(cardOf(page, 'f_f_f')).toBeVisible();
        await expect(cardOf(page, 'f_m_s1')).toHaveCount(0);
        await expect(page.locator('#tree-canvas .branch-tab.folded')).toHaveCount(0);
        expect(await page.evaluate(() => window.Strom.TreeRenderer.shownChildrenCount())).toBe(0);
        await expect.poll(() => screenPositions(page)).toEqual(before);
    });

    test('German: the dashed tab\'s bubble header wraps to lines of their own height, not pressed together', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await setupFixture(page, 'edge-ancestor-inner-siblings', 'focus');
        await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
        await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), 'f_m_f');
        await tabOf(page, 'f_m_f').click();
        const folded = cardOf(page, 'f_f').locator('.edge-top-right .branch-tab.folded');
        await expect(folded).toHaveCount(1);
        // The cards settle (the move of §1, the glow after it) before the bubble is opened
        await page.mouse.move(5, 500);
        await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
        await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), 'f_f');
        const header = folded.locator('.badge-tooltip-header');
        await folded.hover();
        await expect(header).toBeVisible();
        await expect(header).toHaveText('Eltern vorübergehend ausgeblendet');
        const m = await header.evaluate(el => {
            const cs = getComputedStyle(el);
            return { lineHeight: parseFloat(cs.lineHeight), fontSize: parseFloat(cs.fontSize), height: el.getBoundingClientRect().height };
        });
        // The words do not fit one line in the bubble; each line keeps room above and below
        expect(m.height).toBeGreaterThan(m.lineHeight * 1.5);
        expect(m.lineHeight).toBeGreaterThanOrEqual(m.fontSize * 1.25);
    });

    test('the clicked card with its own parents folded: "▸ parents" left of "▾ children", both within the card in every card type', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        // Invented: a great-grandmother whose line comes down far from her children
        await setupFixture(page, 'edge-ancestor-span', 'focus');
        const id = 'p_ffm';
        for (const density of ['normal', 'compact', 'detailed', 'register'] as const) {
            await page.evaluate(d => window.Strom.UI.setCardDensity(d as never), density);
            await page.evaluate(p => window.Strom.ZoomPan.centerOnPerson(p as never), id);
            if (!(await page.evaluate(p => window.Strom.TreeRenderer.isChildrenShown(p as never), id))) await tabOf(page, id).click();
            const row = cardOf(page, id).locator(':scope > .edge-top-right');
            await expect(row.locator(':scope > .branch-tab.folded')).toHaveCount(1);
            const tabs = await row.evaluate(r => {
                const card = r.closest<HTMLElement>('.person-card')!.getBoundingClientRect();
                return [...r.querySelectorAll<HTMLElement>(':scope > .branch-tab')].map(t => {
                    const b = t.getBoundingClientRect();
                    return { cls: t.className, left: b.left, right: b.right, inside: b.left >= card.left && b.right <= card.right };
                });
            });
            const folded = tabs.findIndex(t => t.cls.includes('folded'));
            const children = tabs.findIndex(t => t.cls.includes('children-tab'));
            expect(folded, density).toBeGreaterThanOrEqual(0);
            expect(folded, density).toBeLessThan(children);
            expect(tabs[folded].right, density).toBeLessThanOrEqual(tabs[children].left);
            expect(tabs.every(t => t.inside), `${density}: ${JSON.stringify(tabs)}`).toBe(true);
        }
    });
});

test.describe('zoom out for many children (§5)', () => {
    test('thirteen children: in view or zoomed to 0.6 × the scale before, around the clicked card; hiding them brings the scale back', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await setupFixture(page, 'edge-ancestor-children', 'focus');
        const gf = 'f_m_f_m_f_f';
        await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), gf);
        await page.mouse.move(5, 500);
        const scaleBefore = await page.evaluate(() => window.Strom.ZoomPan.getScale());
        const before = await screenCenters(page);
        await tabOf(page, gf).click();
        await page.mouse.move(5, 500);
        await expect(cardOf(page, 'f_m_f_m_f_sib11')).toHaveCount(1);
        const scale = await page.evaluate(() => window.Strom.ZoomPan.getScale());
        expect(scale).toBeLessThan(scaleBefore);
        const kids = ['f_m_f_m_f', ...Array.from({ length: 12 }, (_, i) => `f_m_f_m_f_sib${i}`)];
        const allIn = await page.evaluate(ids => {
            const t = document.getElementById('tree-container')!.getBoundingClientRect();
            return ids.every(id => {
                const r = document.querySelector(`#tree-canvas .person-card[data-id="${id}"]`)!.getBoundingClientRect();
                return r.left >= t.left && r.right <= t.right && r.top >= t.top && r.bottom <= t.bottom;
            });
        }, kids);
        expect(allIn || Math.abs(scale - 0.6 * scaleBefore) < 1e-9).toBe(true);
        // The clicked card stays on its point
        const mid = (await screenCenters(page))[gf];
        expect(Math.abs(mid[0] - before[gf][0])).toBeLessThanOrEqual(1);
        expect(Math.abs(mid[1] - before[gf][1])).toBeLessThanOrEqual(1);

        await tabOf(page, gf).click();
        await page.mouse.move(5, 500);
        await expect(cardOf(page, 'f_m_f_m_f_sib11')).toHaveCount(0);
        expect(await page.evaluate(() => window.Strom.ZoomPan.getScale())).toBe(scaleBefore);
        await expect.poll(() => screenCenters(page)).toEqual(before);
    });

    test('a zoom by hand meanwhile: hiding the children keeps the scale', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await setupFixture(page, 'edge-ancestor-children', 'focus');
        const gf = 'f_m_f_m_f_f';
        await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), gf);
        await tabOf(page, gf).click();
        await expect(cardOf(page, 'f_m_f_m_f_sib11')).toHaveCount(1);
        await page.evaluate(() => window.Strom.ZoomPan.zoomIn());
        await page.waitForTimeout(400);
        const scale = await page.evaluate(() => window.Strom.ZoomPan.getScale());
        await page.evaluate(() => window.Strom.TreeRenderer.hideAllShownChildren());
        await expect(cardOf(page, 'f_m_f_m_f_sib11')).toHaveCount(0);
        expect(await page.evaluate(() => window.Strom.ZoomPan.getScale())).toBe(scale);
    });

    test.describe('tablet 820 × 1180', () => {
        test.use({ viewport: { width: 820, height: 1180 } });

        test('no zoom below the desktop', async ({ page }) => {
            await setupFixture(page, 'edge-ancestor-children', 'focus');
            const gf = 'f_m_f_m_f_f';
            await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), gf);
            const scale = await page.evaluate(() => window.Strom.ZoomPan.getScale());
            await page.evaluate(id => window.Strom.TreeRenderer.toggleChildrenShown(id as never), gf);
            await expect(cardOf(page, 'f_m_f_m_f_sib11')).toHaveCount(1);
            expect(await page.evaluate(() => window.Strom.ZoomPan.getScale())).toBe(scale);
        });
    });
});
