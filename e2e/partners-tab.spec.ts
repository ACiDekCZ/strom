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

/**
 * Round 6 §42: in the standard display each name in the "▸ ∞" bubble is a
 * button of its own that shows that partner alone; the pill still shows them
 * all. edge-shown-sibling-marriages (invented): the focus Elsa's mother Nora
 * has a brother Teo out of view, married to Mira (1990, no children), Lena
 * (1996, their son Kai) and Zoe (2010, no children). At ancestor depth 1
 * Nora's "▸ siblings" brings her parents and Teo, with Mira.
 */
async function setupTeo(page: Page): Promise<void> {
    await openApp(page);
    const data = JSON.parse(readFileSync(join(process.cwd(), 'test', 'edge-shown-sibling-marriages.json'), 'utf-8'));
    await page.evaluate(async tree => {
        await window.Strom.DataManager.importAsNewTree(tree as never, 'Marriages');
        await window.Strom.TreeRenderer.setFocus('focus' as never);
    }, data);
    await expect(cardOf(page, 'focus')).toBeVisible();
    // The standard display (one union per person)
    await page.evaluate(() => window.Strom.TreeRenderer.toggleShowAllPartnerships());
    await page.evaluate(() => window.Strom.TreeRenderer.setFocusDepth(1, window.Strom.TreeRenderer.getFocusDepthDown()));
    await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), 'person');
    await page.evaluate(() => window.Strom.TreeRenderer.toggleSiblingsShown('person' as never));
    for (const id of ['sib', 'sib_w1']) await expect(cardOf(page, id), id).toBeVisible();
    for (const id of ['sib_w2', 'sib_w3', 'sib_c2']) await expect(cardOf(page, id), id).toHaveCount(0);
    await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), 'sib');
}

const partnersBubble = (page: Page, id: string) => cardOf(page, id).locator('.children-bubble[data-bubble="partners"]');
const pick = (page: Page, id: string, name: string) => partnersBubble(page, id).locator('.partner-pick', { hasText: name });

test.describe('the standard display: a name in the "▸ ∞" bubble shows that partner alone (round 6 §42)', () => {
    test('mouse 1440: Zoe alone beside Mira, then Lena with Kai in place of Mira; ↩ retraces each step; closing gives the view back', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await setupTeo(page);
        await page.mouse.move(5, 500);
        const layoutBefore = await positions(page);
        const pill = partnersPill(page, 'sib');
        await expect(pill).toHaveText(/▸\s*∞\s*2/);
        await pill.hover();
        const bubble = partnersBubble(page, 'sib');
        await expect(bubble).toBeVisible();
        await expect(bubble.locator('.badge-tooltip-header')).toHaveText('Other partners');
        await expect(bubble.locator('.partner-pick .badge-tooltip-name')).toHaveText(['Lena Fross · 1 child', 'Zoe Arden']);
        await expect(pick(page, 'sib', 'Zoe')).toHaveAttribute('aria-label', /^Show only Zoe Arden here$/);
        await expect(pick(page, 'sib', 'Lena')).toHaveAttribute('aria-label', /^Show only Lena Fross here, with the children of this union$/);
        await expect(bubble.locator('.badge-tooltip-action')).toHaveText('A click shows them all here, a click on a name only that person; the view stays.');
        for (const b of await bubble.locator('.partner-pick').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(28);

        // Zoe alone: she comes beside the card, Mira stays, Lena and Kai stay out
        await pick(page, 'sib', 'Zoe').click();
        await page.mouse.move(5, 500);
        await expect(cardOf(page, 'sib_w3')).toBeVisible();
        await expect(cardOf(page, 'sib_w3')).toHaveClass(/shown-here/);
        await expect(cardOf(page, 'sib_w1')).toBeVisible();
        for (const id of ['sib_w2', 'sib_c2']) await expect(cardOf(page, id), id).toHaveCount(0);
        // The pill offers the rest: "▸ ∞ 1", half pressed
        await expect(pill).toHaveText(/▸\s*∞\s*1/);
        await expect(pill).toHaveClass(/partial/);
        await expect(pill).not.toHaveClass(/active/);
        await expect(pill).toHaveAttribute('aria-pressed', 'mixed');
        await expect(pill).toHaveAttribute('aria-label', /^Show the other partners of .+ here too$/);
        await pill.hover();
        await expect(bubble).toBeVisible();
        await expect(bubble.locator('.partner-pick .badge-tooltip-name')).toHaveText(['Lena Fross · 1 child']);
        await expect(bubble.locator('.badge-tooltip-group')).toHaveText(['Partners shown here']);
        await expect(bubble.locator('.partner-hide-row')).toHaveText(/Hide the partners shown here/);
        await expect(bubble.locator('.badge-tooltip-action')).toHaveText('A click shows the others here too; the view stays.');

        // Lena with Kai: she takes Mira's place, Zoe stays
        await pick(page, 'sib', 'Lena').click();
        await page.mouse.move(5, 500);
        for (const id of ['sib_w2', 'sib_c2', 'sib_w3']) await expect(cardOf(page, id), id).toBeVisible();
        await expect(cardOf(page, 'sib_w1')).toHaveCount(0);
        await expect(pill).toHaveText(/▾\s*∞\s*2/);
        await expect(pill).toHaveClass(/active/);
        await expect(pill).toHaveAttribute('aria-pressed', 'true');

        // ↩: Zoe alone again (Mira back), then the view before "▸ ∞"
        await page.evaluate(() => window.Strom.TreeRenderer.goBack());
        await expect(cardOf(page, 'sib_w1')).toBeVisible();
        await expect(cardOf(page, 'sib_w3')).toBeVisible();
        for (const id of ['sib_w2', 'sib_c2']) await expect(cardOf(page, id), id).toHaveCount(0);
        await expect(pill).toHaveText(/▸\s*∞\s*1/);
        await page.evaluate(() => window.Strom.TreeRenderer.goBack());
        for (const id of ['sib_w2', 'sib_c2', 'sib_w3']) await expect(cardOf(page, id), id).toHaveCount(0);
        await expect(pill).toHaveText(/▸\s*∞\s*2/);
        expect(await positions(page)).toEqual(layoutBefore);
        // ↪ twice: both picks again
        await page.evaluate(() => window.Strom.TreeRenderer.goForward());
        await expect(cardOf(page, 'sib_w3')).toBeVisible();
        await page.evaluate(() => window.Strom.TreeRenderer.goForward());
        await expect(cardOf(page, 'sib_w2')).toBeVisible();
        await expect(cardOf(page, 'sib_w1')).toHaveCount(0);
        // "▾ ∞": the view before "▸ ∞", position for position
        await pill.click();
        await page.mouse.move(5, 500);
        for (const id of ['sib_w2', 'sib_c2', 'sib_w3']) await expect(cardOf(page, id), id).toHaveCount(0);
        await expect(cardOf(page, 'sib_w1')).toBeVisible();
        expect(await positions(page)).toEqual(layoutBefore);
    });

    test('mouse 1440: after one name the bubble\'s last row hides the partners shown here; the layout as before', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await setupTeo(page);
        await page.mouse.move(5, 500);
        const layoutBefore = await positions(page);
        await partnersPill(page, 'sib').hover();
        await pick(page, 'sib', 'Lena').click();
        await page.mouse.move(5, 500);
        for (const id of ['sib_w2', 'sib_c2']) await expect(cardOf(page, id), id).toBeVisible();
        await expect(cardOf(page, 'sib_w1')).toHaveCount(0);
        await expect(cardOf(page, 'sib_w3')).toHaveCount(0);
        await expect(partnersPill(page, 'sib')).toHaveText(/▸\s*∞\s*1/);
        // Kai came with Lena: "▸ children" has nothing left to show (the two tabs never show one child twice)
        await expect(cardOf(page, 'sib').locator('.children-tab')).toHaveCount(0);
        // The keyboard reaches the rows: the pill's focus opens the bubble, Tab goes on to its buttons
        await partnersPill(page, 'sib').focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        const bubble = partnersBubble(page, 'sib');
        await expect(bubble).toBeVisible();
        await page.keyboard.press('Tab');
        await expect(pick(page, 'sib', 'Zoe')).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(bubble.locator('.partner-hide-row')).toBeFocused();
        await page.keyboard.press('Enter');
        await page.mouse.move(5, 500);
        for (const id of ['sib_w2', 'sib_c2', 'sib_w3']) await expect(cardOf(page, id), id).toHaveCount(0);
        await expect(cardOf(page, 'sib_w1')).toBeVisible();
        expect(await positions(page)).toEqual(layoutBefore);
        await expect(partnersPill(page, 'sib')).toHaveText(/▸\s*∞\s*2/);
    });

    test('mouse 1440: after "▸ children" (Lena with Kai in place of Mira) the bubble offers Mira and Zoe, not Lena again', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await setupTeo(page);
        await cardOf(page, 'sib').locator('.edge-top-right .branch-tab.children-tab').click();
        for (const id of ['sib_w2', 'sib_c2']) await expect(cardOf(page, id), id).toBeVisible();
        await expect(cardOf(page, 'sib_w1')).toHaveCount(0);
        await partnersPill(page, 'sib').hover();
        const names = partnersBubble(page, 'sib').locator('.partner-pick .badge-tooltip-name');
        await expect(names).toHaveCount(2);
        await expect(names.nth(1)).toHaveText('Zoe Arden');
        await expect(names.first()).not.toContainText('Lena');
        await pick(page, 'sib', 'Zoe').click();
        await page.mouse.move(5, 500);
        for (const id of ['sib_w2', 'sib_c2', 'sib_w3']) await expect(cardOf(page, id), id).toBeVisible();
        await expect(cardOf(page, 'sib_w1')).toHaveCount(0);
    });

    /**
     * Round 7 §49: the half state "▸ ∞ n" wears the outline of the tab's
     * other half state (the dashed "▸ parents", .folded), not a look of its
     * own; its bubble names only the partners this pill brought, and
     * "▾ Hide …" hides only those: a partner who stood at the card before
     * (Lena, brought with Kai by "▸ children") stays.
     */
    test('mouse 1440: "▸ ∞ n" dashed as the folded "▸ parents"; "▾ Hide …" hides only the partners it brought, not the one who stood there before (round 7 §49)', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await setupTeo(page);
        await cardOf(page, 'sib').locator('.edge-top-right .branch-tab.children-tab').click();
        for (const id of ['sib_w2', 'sib_c2']) await expect(cardOf(page, id), id).toBeVisible();
        const pill = partnersPill(page, 'sib');
        await pill.hover();
        await pick(page, 'sib', 'Zoe').click();
        await page.mouse.move(5, 500);
        await expect(cardOf(page, 'sib_w3')).toBeVisible();
        await expect(pill).toHaveClass(/partial/);
        await expect(pill).toHaveText(/▸\s*∞\s*1/);
        // The outline of the folded "▸ parents": dashed in the faint text colour, on the canvas's ground, no shadow
        const look = await pill.evaluate(el => {
            const cs = getComputedStyle(el);
            const probe = document.createElement('span');
            probe.style.color = 'var(--text-faint)';
            const bg = document.createElement('span');
            bg.style.color = 'var(--bg)';
            el.parentElement!.append(probe, bg);
            const faint = getComputedStyle(probe).color, ground = getComputedStyle(bg).color;
            probe.remove();
            bg.remove();
            return { style: cs.borderTopStyle, width: cs.borderTopWidth, color: cs.borderTopColor, faint, background: cs.backgroundColor, ground, shadow: cs.boxShadow };
        });
        expect(look.style).toBe('dashed');
        expect(look.width).toBe('1px');
        expect(look.color).toBe(look.faint);
        expect(look.background).toBe(look.ground);
        expect(look.shadow).toBe('none');
        // Its bubble: the rest offered, then only the partner this pill brought
        await pill.hover();
        const bubble = partnersBubble(page, 'sib');
        await expect(bubble).toBeVisible();
        await expect(bubble.locator('.partner-pick .badge-tooltip-name')).toHaveText(['Mira Holt']);
        await expect(bubble.locator('.badge-tooltip-group')).toHaveText(['Partners shown here']);
        await expect(bubble.locator('[data-name-group="1"] .badge-tooltip-name')).toHaveText(['Zoe Arden']);
        // "▾ Hide …": Zoe goes, Lena and Kai (there before the pill) stay
        await bubble.locator('.partner-hide-row').click();
        await page.mouse.move(5, 500);
        await expect(cardOf(page, 'sib_w3')).toHaveCount(0);
        for (const id of ['sib_w2', 'sib_c2']) await expect(cardOf(page, id), id).toBeVisible();
        expect(await page.evaluate(() => window.Strom.TreeRenderer.isChildrenShown('sib' as never))).toBe(true);
        await expect(pill).toHaveText(/▸\s*∞\s*2/);
        await expect(pill).not.toHaveClass(/partial/);
    });

    test.describe('touch 390 × 844', () => {
        test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

        test('a press held on the pill opens the bubble; a tap on Zoe brings only her, a tap on the pill then the rest', async ({ page }) => {
            await setupTeo(page);
            const pill = partnersPill(page, 'sib');
            await hold(page, pill);
            const bubble = partnersBubble(page, 'sib');
            await expect(bubble).toBeVisible();
            for (const b of await bubble.locator('.partner-pick').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
            await pick(page, 'sib', 'Zoe').tap();
            await expect(cardOf(page, 'sib_w3')).toBeVisible();
            await expect(cardOf(page, 'sib_w1')).toBeVisible();
            for (const id of ['sib_w2', 'sib_c2']) await expect(cardOf(page, id), id).toHaveCount(0);
            await expect(page.locator('.bottom-sheet-person')).toHaveCount(0);
            await expect(pill).toHaveText(/▸\s*∞\s*1/);
            await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), 'sib');
            await pill.tap();
            for (const id of ['sib_w2', 'sib_c2', 'sib_w3']) await expect(cardOf(page, id), id).toBeVisible();
            await expect(cardOf(page, 'sib_w1')).toHaveCount(0);
            await expect(pill).toHaveText(/▾\s*∞\s*2/);
            await page.evaluate(() => window.Strom.TreeRenderer.goBack());
            await expect(cardOf(page, 'sib_w1')).toBeVisible();
            for (const id of ['sib_w2', 'sib_c2']) await expect(cardOf(page, id), id).toHaveCount(0);
        });
    });
});

/** A finger held at the middle of the element for 700 ms, then lifted. */
async function hold(page: Page, el: ReturnType<Page['locator']>): Promise<void> {
    const touch = (type: 'touchstart' | 'touchend') => el.evaluate((e: HTMLElement, kind) => {
        const r = e.getBoundingClientRect();
        const t = new Touch({ identifier: 1, target: e, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 });
        const live = kind === 'touchstart' ? [t] : [];
        e.dispatchEvent(new TouchEvent(kind, { touches: live, targetTouches: live, changedTouches: [t], bubbles: true, cancelable: true }));
    }, type);
    await touch('touchstart');
    await page.waitForTimeout(700);
    await touch('touchend');
}

/**
 * Round 6 §46: in the standard display "▸ ∞" offers every marriage of a
 * person in the plain depth, not only of one shown in place. comprehensive
 * (invented), focus on the "focus" person: the father stands with the
 * mother; his second marriage, the stepmother with a half-sibling, is out
 * of view. A click on that name brings both; the mother stays.
 */
test('the standard display: "▸ ∞" on a person in the plain depth offers a marriage with children, with its count; a click on it brings the partner with the children, the partner beside stays', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    const data = JSON.parse(readFileSync(join(process.cwd(), 'test', 'comprehensive.json'), 'utf-8'));
    await page.evaluate(async tree => {
        await window.Strom.DataManager.importAsNewTree(tree as never, 'Comprehensive');
        await window.Strom.TreeRenderer.setFocus('focus' as never);
    }, data);
    await page.evaluate(() => window.Strom.TreeRenderer.toggleShowAllPartnerships());
    await page.evaluate(() => window.Strom.TreeRenderer.setFocusDepth(2, 2));
    for (const id of ['father', 'mother']) await expect(cardOf(page, id), id).toBeVisible();
    for (const id of ['stepmother', 'halfsibling_1']) await expect(cardOf(page, id), id).toHaveCount(0);
    await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), 'father');
    await page.mouse.move(5, 500);
    const layoutBefore = await positions(page);
    const pill = partnersPill(page, 'father');
    await expect(pill).toHaveCount(1);
    await pill.hover();
    const bubble = partnersBubble(page, 'father');
    await expect(bubble).toBeVisible();
    const names = await page.evaluate(() => {
        const p = window.Strom.DataManager.getPerson('stepmother' as never)!;
        return `${p.firstName} ${p.lastName} · 1 child`;
    });
    await expect(bubble.locator('.partner-pick .badge-tooltip-name')).toContainText([names]);
    await bubble.locator('.partner-pick', { hasText: names }).click();
    await page.mouse.move(5, 500);
    for (const id of ['stepmother', 'halfsibling_1']) {
        await expect(cardOf(page, id), id).toBeVisible();
        await expect(cardOf(page, id), id).toHaveClass(/shown-here/);
    }
    for (const id of ['father', 'mother', 'focus']) await expect(cardOf(page, id), id).toBeVisible();
    // Nothing in view before left it
    const after = await positions(page);
    expect(Object.keys(layoutBefore).filter(id => !(id in after))).toEqual([]);
    // Closing: the layout as before
    await page.locator('#hide-shown-children').click();
    for (const id of ['stepmother', 'halfsibling_1']) await expect(cardOf(page, id), id).toHaveCount(0);
    expect(await positions(page)).toEqual(layoutBefore);
});
