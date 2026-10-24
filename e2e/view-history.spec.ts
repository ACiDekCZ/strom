import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { openApp } from './helpers.js';

/**
 * The view's back/forward history (↩ / ↪, Alt+← / Alt+→, GitHub #4): showing
 * children in place, hiding them (the tab, "Hide shown", the dashed
 * "▸ parents") and a jump to a card elsewhere are steps like a new focus.
 * Back restores the view before the step — within the focus through the
 * transition, the step's card in place; with another focus the focus and the
 * children it showed. Invented data: the comprehensive fixture, focus on a
 * grandchild; the father's other children are out of view, and so are the
 * children of his daughter sibling_1.
 */

const FOCUS = 'grandchild_1';
const FATHER = 'father';
const SIBLINGS = ['sibling_1', 'sibling_2'];
const NEPHEWS = ['nephew_1_1', 'nephew_1_2', 'nephew_1_3'];

const cardOf = (page: Page, id: string) => page.locator(`#tree-canvas .person-card[data-id="${id}"]`);
const tabOf = (page: Page, id: string) => cardOf(page, id).locator('.edge-top-right .branch-tab.children-tab');
const back = (page: Page) => page.locator('#focus-back-btn');
const fwd = (page: Page) => page.locator('#focus-forward-btn');
const focusOf = (page: Page) => page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId());

async function setupFixture(page: Page, fixture: string, focus: string, center?: string): Promise<void> {
    await openApp(page);
    await page.evaluate(() => window.Strom.SettingsManager.setOnThisDay(false));
    const data = JSON.parse(readFileSync(join(process.cwd(), 'test', `${fixture}.json`), 'utf-8'));
    await page.evaluate(async ([tree, f]) => {
        await window.Strom.DataManager.importAsNewTree(tree as never, 'History');
        await window.Strom.TreeRenderer.setFocus(f as never);
        window.Strom.TreeRenderer.resetFocusHistory();
    }, [data, focus] as const);
    await expect(cardOf(page, focus)).toBeVisible();
    if (center) await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), center);
    await expect(back(page)).toBeHidden();
    await expect(fwd(page)).toBeHidden();
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

/** A drawn card's centre on the screen. */
async function centerOf(page: Page, id: string): Promise<[number, number]> {
    const r = (await cardOf(page, id).boundingBox())!;
    return [r.x + r.width / 2, r.y + r.height / 2];
}

/** Whether two screen points are the same to a pixel. */
const near = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1;

/** Whether two views draw the same cards, each where it stood to a pixel (positions round to whole pixels). */
const sameView = (a: Record<string, [number, number]>, b: Record<string, [number, number]>) =>
    Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(id => !!b[id] && near(a[id], b[id]));

async function settled(page: Page): Promise<void> {
    await expect.poll(() => page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length)).toBe(0);
}

async function expectShown(page: Page, ids: readonly string[], present: boolean): Promise<void> {
    for (const id of ids) await expect(cardOf(page, id)).toHaveCount(present ? 1 : 0);
}

test.describe('desktop 1440 × 900', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('children shown, then a shown child\'s children: back twice, forward twice, each view as it was', async ({ page }) => {
        await setupFixture(page, 'comprehensive', FOCUS, FATHER);
        await page.mouse.move(5, 500);
        const start = await screenPositions(page);

        await tabOf(page, FATHER).click();
        await expectShown(page, SIBLINGS, true);
        await expect(back(page)).toBeVisible();
        await expect(fwd(page)).toBeHidden();
        await expect(tabOf(page, FATHER)).toHaveAttribute('aria-pressed', 'true');
        await settled(page);
        await page.mouse.move(5, 500);
        // The hover lift of the clicked card goes back first
        await settled(page);
        const afterFirst = await screenPositions(page);

        // Nested: the shown daughter's own children
        await tabOf(page, SIBLINGS[0]).click();
        await expectShown(page, NEPHEWS, true);
        await expect(tabOf(page, SIBLINGS[0])).toHaveAttribute('aria-pressed', 'true');
        await expect(fwd(page)).toBeHidden();
        await page.mouse.move(5, 500);
        await settled(page);
        const daughterAt = await centerOf(page, SIBLINGS[0]);

        // Back: the nephews go, the daughter's card stays where it stood
        await back(page).click();
        await page.mouse.move(5, 500);
        await expectShown(page, NEPHEWS, false);
        await expectShown(page, SIBLINGS, true);
        await expect(tabOf(page, SIBLINGS[0])).toHaveAttribute('aria-pressed', 'false');
        await expect(tabOf(page, FATHER)).toHaveAttribute('aria-pressed', 'true');
        await expect(back(page)).toBeVisible();
        await expect(fwd(page)).toBeVisible();
        // (the zoom of §5 comes back around its centre)
        await expect.poll(async () => near(await centerOf(page, SIBLINGS[0]), daughterAt)).toBe(true);
        await expect.poll(async () => sameView(await screenPositions(page), afterFirst)).toBe(true);
        expect(await focusOf(page)).toBe(FOCUS);

        // Back again: the view before the first click, every card where it stood
        await back(page).click();
        await page.mouse.move(5, 500);
        await expectShown(page, SIBLINGS, false);
        await expect(tabOf(page, FATHER)).toHaveAttribute('aria-pressed', 'false');
        await expect(back(page)).toBeHidden();
        await expect(fwd(page)).toBeVisible();
        await expect.poll(async () => sameView(await screenPositions(page), start)).toBe(true);

        // Forward twice: both expansions again
        await fwd(page).click();
        await expectShown(page, SIBLINGS, true);
        await expectShown(page, NEPHEWS, false);
        await expect(back(page)).toBeVisible();
        await fwd(page).click();
        await expectShown(page, NEPHEWS, true);
        await expect(tabOf(page, SIBLINGS[0])).toHaveAttribute('aria-pressed', 'true');
        await expect(fwd(page)).toBeHidden();
        await page.mouse.move(5, 500);
        await expect.poll(async () => near(await centerOf(page, SIBLINGS[0]), daughterAt)).toBe(true);

        // What closing needs came back with the view: hiding the father's children hides the nephews too
        await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), FATHER);
        await tabOf(page, FATHER).click();
        await expectShown(page, [...SIBLINGS, ...NEPHEWS], false);
        expect(await page.evaluate(() => window.Strom.TreeRenderer.shownChildrenCount())).toBe(0);
        // ...and is a step of its own: back brings both expansions
        await back(page).click();
        await expectShown(page, [...SIBLINGS, ...NEPHEWS], true);
    });

    test('"Hide shown": back brings every expansion at once, forward hides them again', async ({ page }) => {
        await setupFixture(page, 'comprehensive', FOCUS, FATHER);
        await tabOf(page, FATHER).click();
        await expectShown(page, SIBLINGS, true);
        await tabOf(page, SIBLINGS[0]).click();
        await expectShown(page, NEPHEWS, true);
        await page.mouse.move(5, 500);
        await settled(page);
        const fatherAt = await centerOf(page, FATHER);
        const scaleShown = await page.evaluate(() => window.Strom.ZoomPan.getScale());
        const button = page.locator('#hide-shown-children');
        await expect(button).toHaveText('▾Hide shown · 2');
        await button.click();
        await expectShown(page, [...SIBLINGS, ...NEPHEWS], false);
        await expect(button).toBeHidden();
        await expect(fwd(page)).toBeHidden();

        await back(page).click();
        await expectShown(page, [...SIBLINGS, ...NEPHEWS], true);
        await expect(button).toHaveText('▾Hide shown · 2');
        await expect(tabOf(page, FATHER)).toHaveAttribute('aria-pressed', 'true');
        await expect(tabOf(page, SIBLINGS[0])).toHaveAttribute('aria-pressed', 'true');
        await expect(fwd(page)).toBeVisible();
        // The view before hide all: the father's card where it stood, the scale it had
        await page.mouse.move(5, 500);
        await expect.poll(async () => near(await centerOf(page, FATHER), fatherAt)).toBe(true);
        await expect.poll(() => page.evaluate(() => window.Strom.ZoomPan.getScale())).toBeCloseTo(scaleShown, 6);

        await fwd(page).click();
        await expectShown(page, [...SIBLINGS, ...NEPHEWS], false);
        await expect(button).toBeHidden();
        await expect(fwd(page)).toBeHidden();
    });

    test('a new focus: back (Alt+←) returns the focus with its children shown, forward (Alt+→) the new one', async ({ page }) => {
        await setupFixture(page, 'comprehensive', FOCUS, FATHER);
        await tabOf(page, FATHER).click();
        await expectShown(page, SIBLINGS, true);
        await page.evaluate(() => window.Strom.TreeRenderer.setFocus('child_1' as never));
        await expect.poll(() => focusOf(page)).toBe('child_1');
        expect(await page.evaluate(() => window.Strom.TreeRenderer.shownChildrenCount())).toBe(0);
        await expect(back(page)).toBeVisible();

        await page.keyboard.press('Alt+ArrowLeft');
        await expect.poll(() => focusOf(page)).toBe(FOCUS);
        await expectShown(page, SIBLINGS, true);
        await expect(tabOf(page, FATHER)).toHaveAttribute('aria-pressed', 'true');
        await expect(fwd(page)).toBeVisible();
        // Back once more: the father's children hide (same focus)
        await page.keyboard.press('Alt+ArrowLeft');
        await expectShown(page, SIBLINGS, false);
        await expect(back(page)).toBeHidden();
        expect(await focusOf(page)).toBe(FOCUS);

        await page.keyboard.press('Alt+ArrowRight');
        await expectShown(page, SIBLINGS, true);
        await page.keyboard.press('Alt+ArrowRight');
        await expect.poll(() => focusOf(page)).toBe('child_1');
        expect(await page.evaluate(() => window.Strom.TreeRenderer.shownChildrenCount())).toBe(0);
        await expect(fwd(page)).toBeHidden();
        // A new step after going back clears forward
        await back(page).click();
        await expect.poll(() => focusOf(page)).toBe(FOCUS);
        await expect(fwd(page)).toBeVisible();
        await tabOf(page, SIBLINGS[1]).click();
        await expect(fwd(page)).toBeHidden();
    });

    test('the dashed "▸ parents": back shows the children again with the parents folded', async ({ page }) => {
        // Invented: Horace's (f_m_f) children belong on the inner side; his son-in-law's (f_f) parents fold
        await setupFixture(page, 'edge-ancestor-inner-siblings', 'focus', 'f_m_f');
        await tabOf(page, 'f_m_f').click();
        await expect(cardOf(page, 'f_m_s1')).toBeVisible();
        await expect(cardOf(page, 'f_f_f')).toHaveCount(0);
        const folded = cardOf(page, 'f_f').locator('.edge-top-right .branch-tab.folded');
        await folded.click();
        await expect(cardOf(page, 'f_f_f')).toBeVisible();
        await expect(cardOf(page, 'f_m_s1')).toHaveCount(0);

        await back(page).click();
        await expect(cardOf(page, 'f_m_s1')).toBeVisible();
        await expect(cardOf(page, 'f_f_f')).toHaveCount(0);
        await expect(cardOf(page, 'f_f').locator('.edge-top-right .branch-tab.folded')).toHaveCount(1);
        await fwd(page).click();
        await expect(cardOf(page, 'f_f_f')).toBeVisible();
        await expect(cardOf(page, 'f_m_s1')).toHaveCount(0);
    });

    test('a jump to a card elsewhere ("child ↗"): back returns the pan and zoom before it, forward the jump', async ({ page }) => {
        // Etalon J (invented): the line of the partner's parents to his sibling is left out
        await setupFixture(page, 'etalon-inlaw-loop', 'eJ_focus_kid');
        await page.evaluate(id => window.Strom.ZoomPan.glideToPerson(id as never, 2.5, 0), 'eJ_p_mo');
        const transform = () => page.evaluate(() => window.Strom.ZoomPan.getTransform());
        const before = await transform();
        await cardOf(page, 'eJ_p_mo').locator('.branch-tab.line-link[data-action="jump-child"]').click();
        await expect(cardOf(page, 'eJ_partner_sib')).toHaveClass(/highlighted/);
        await expect.poll(async () => (await transform()).tx).not.toBeCloseTo(before.tx, 0);
        await expect(back(page)).toBeVisible();
        const jumped = await transform();

        await back(page).click();
        const t = await transform();
        expect(t.scale).toBeCloseTo(before.scale, 6);
        expect(t.tx).toBeCloseTo(before.tx, 0);
        expect(t.ty).toBeCloseTo(before.ty, 0);
        await expect(fwd(page)).toBeVisible();
        expect(await focusOf(page)).toBe('eJ_focus_kid');

        await fwd(page).click();
        const f = await transform();
        expect(f.scale).toBeCloseTo(jumped.scale, 6);
        expect(f.tx).toBeCloseTo(jumped.tx, 0);
        expect(f.ty).toBeCloseTo(jumped.ty, 0);
        await expect(fwd(page)).toBeHidden();
    });

    test('a jump, then a new focus: back twice, forward retraces the jump (its pan and zoom), not the view before it', async ({ page }) => {
        await setupFixture(page, 'etalon-inlaw-loop', 'eJ_focus_kid');
        await page.evaluate(id => window.Strom.ZoomPan.glideToPerson(id as never, 2.5, 0), 'eJ_p_mo');
        const transform = () => page.evaluate(() => window.Strom.ZoomPan.getTransform());
        const expectTransform = async (want: { scale: number; tx: number; ty: number }, label: string) => {
            await expect.poll(async () => (await transform()).tx, label).toBeCloseTo(want.tx, 0);
            const t = await transform();
            expect(t.scale, label).toBeCloseTo(want.scale, 6);
            expect(t.tx, label).toBeCloseTo(want.tx, 0);
            expect(t.ty, label).toBeCloseTo(want.ty, 0);
        };
        const before = await transform();
        await cardOf(page, 'eJ_p_mo').locator('.branch-tab.line-link[data-action="jump-child"]').click();
        await expect(cardOf(page, 'eJ_partner_sib')).toHaveClass(/highlighted/);
        await expect.poll(async () => (await transform()).tx).not.toBeCloseTo(before.tx, 0);
        await settled(page);
        const jumped = await transform();
        await page.evaluate(() => window.Strom.TreeRenderer.setFocus('eJ_p_mo' as never));
        await expect.poll(() => focusOf(page)).toBe('eJ_p_mo');

        for (const round of [1, 2]) {
            // Back over the new focus: centred on the focus (the view of a new focus)
            await page.keyboard.press('Alt+ArrowLeft');
            await expect.poll(() => focusOf(page)).toBe('eJ_focus_kid');
            // Back over the jump: the pan and zoom before it
            await page.keyboard.press('Alt+ArrowLeft');
            await expect(back(page)).toBeHidden();
            await expectTransform(before, `round ${round}: back over the jump`);
            // Forward over the jump: where the jump landed
            await page.keyboard.press('Alt+ArrowRight');
            await expectTransform(jumped, `round ${round}: forward over the jump`);
            // Forward over the new focus
            await page.keyboard.press('Alt+ArrowRight');
            await expect.poll(() => focusOf(page)).toBe('eJ_p_mo');
            await expect(fwd(page)).toBeHidden();
        }
    });
});

test.describe('phone 390 × 844', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('nested children by touch: back twice, forward, the tabs follow', async ({ page }) => {
        await setupFixture(page, 'comprehensive', FOCUS, FATHER);
        await tabOf(page, FATHER).tap();
        await expectShown(page, SIBLINGS, true);
        await expect(back(page)).toBeVisible();
        await page.evaluate(id => window.Strom.ZoomPan.centerOnPerson(id as never), SIBLINGS[0]);
        await tabOf(page, SIBLINGS[0]).tap();
        await expectShown(page, NEPHEWS, true);
        await settled(page);

        await back(page).tap();
        await expectShown(page, NEPHEWS, false);
        await expectShown(page, SIBLINGS, true);
        await expect(tabOf(page, FATHER)).toHaveAttribute('aria-pressed', 'true');
        await expect(fwd(page)).toBeVisible();
        await back(page).tap();
        await expectShown(page, SIBLINGS, false);
        await expect(back(page)).toBeHidden();
        await expect(page.locator('#hide-shown-children-chip')).toBeHidden();

        await fwd(page).tap();
        await expectShown(page, SIBLINGS, true);
        await expect(page.locator('#hide-shown-children-chip')).toHaveText('▾Hide shown · 1');
        await expect(back(page)).toBeVisible();
        await expect(fwd(page)).toBeVisible();
    });
});
