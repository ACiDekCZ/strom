import { test, expect, Page } from '@playwright/test';
import { openApp, seedTree } from './helpers.js';

/**
 * The kinds of a card's tabs (GitHub #4, round 2): the look says what a
 * click does — in place (▸/▾, round), focus (◎, squarer, a toast with ↩
 * after it), jump (↗ after the word, no shadow). A sister's husband (married
 * in) whose parents and brother are out of view carries one "◎ family" tab;
 * the menu marks its rows the same way. (An ancestor of the line at the edge
 * of the depth shows them in place instead: e2e/parents-tab.spec.ts.)
 * Invented data.
 */

const cardOf = (page: Page, id: string) => page.locator(`#tree-canvas .person-card[data-id="${id}"]`);
const rowOf = (page: Page, id: string) => cardOf(page, id).locator(':scope > .edge-top-right');
const focusOf = (page: Page) => page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId());

async function setup(page: Page): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await seedTree(page, {
        c: { firstName: 'Quirin', lastName: 'Morquist', parents: ['p', 'm'] },
        p: { firstName: 'Pirmin', lastName: 'Morquist', partners: ['m'] },
        m: { firstName: 'Ilvana', lastName: 'Morquist', gender: 'female', partners: ['p'] },
        d: { firstName: 'Dorothea', lastName: 'Morquist', gender: 'female', parents: ['p', 'm'], partners: ['g1'] },
        g1: { firstName: 'Wolfbrecht', lastName: 'Zwolbrack', parents: ['gg1', 'gg2'], partners: ['d'] },
        s: { firstName: 'Sigwulf', lastName: 'Zwolbrack', parents: ['gg1', 'gg2'] },
        gg1: { firstName: 'Arbogast', lastName: 'Zwolbrack', partners: ['gg2'] },
        gg2: { firstName: 'Adelgunde', lastName: 'Zwolbrack', gender: 'female', partners: ['gg1'] },
    }, 'Zwolbrack', 'c');
    await startView(page);
}

/** Quirin in focus, two generations up: his sister's husband is in view, the husband's parents and brother are not. */
async function startView(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.TreeRenderer.setFocus('c' as never));
    await page.evaluate(() => window.Strom.TreeRenderer.setFocusDepth(2, 1));
    await expect(cardOf(page, 'g1')).toBeVisible();
    await expect(cardOf(page, 'gg1')).toHaveCount(0);
    await page.evaluate(() => window.Strom.ZoomPan.centerOnPerson('g1' as never));
    await page.waitForTimeout(400);
}

test('parents and a brother out of view: one "◎ family" tab in the focus look, its bubble by group and what a click does', async ({ page }) => {
    await setup(page);
    const family = rowOf(page, 'g1').locator('.branch-tab.kind-focus');
    await expect(family).toHaveCount(1);
    await expect(family).toHaveAttribute('data-tab', 'family');
    await expect(family.locator('.pill-glyph')).toHaveText('◎');
    await expect(family.locator('.pill-text')).toHaveText('family');
    await expect(family).toHaveAttribute('aria-label', 'Focus on Wolfbrecht Zwolbrack and show the family');
    // No separate parents or siblings tab beside it
    await expect(rowOf(page, 'g1').locator('.branch-tab')).toHaveCount(1);
    // The squarer shape of a focus
    expect(await family.evaluate(el => getComputedStyle(el).borderTopLeftRadius)).toBe('4px');
    await family.hover();
    const bubble = family.locator('.badge-tooltip');
    await expect(bubble).toBeVisible();
    await expect(bubble.locator('.badge-tooltip-header')).toHaveText('Family');
    await expect(bubble.locator('.badge-tooltip-group')).toHaveText(['Parents', 'Siblings']);
    await expect(bubble.locator('.badge-tooltip-name')).toHaveText(['Arbogast Zwolbrack', 'Adelgunde Zwolbrack', 'Sigwulf Zwolbrack']);
    await expect(bubble.locator('.badge-tooltip-body')).toHaveText('Family of origin: outside this view.');
    await expect(bubble.locator('.badge-tooltip-action')).toHaveText('A click rebuilds the tree around Wolfbrecht Zwolbrack; ↩ returns to the previous view.');
});

test('a click on "◎ family" focuses with a toast; "↩ Back" returns to the previous focus and view', async ({ page }) => {
    await setup(page);
    const before = await page.evaluate(() => ({ scale: window.Strom.ZoomPan.getScale() }));
    await rowOf(page, 'g1').locator('.branch-tab.kind-focus').click();
    await expect.poll(() => focusOf(page)).toBe('g1');
    const toast = page.locator('#focus-toast .focus-toast-box');
    await expect(toast).toBeVisible();
    await expect(toast.locator('.focus-toast-msg')).toHaveText('Focused on Wolfbrecht Zwolbrack');
    await expect(toast.locator('.focus-toast-name')).toHaveText('Wolfbrecht Zwolbrack');
    await expect(page.locator('#focus-toast')).toHaveAttribute('aria-live', 'polite');
    const back = toast.getByRole('button', { name: 'Return to the previous view' });
    await expect(back).toHaveText('↩ Back');
    await back.click();
    await expect.poll(() => focusOf(page)).toBe('c');
    await expect(toast).toHaveCount(0);
    expect(await page.evaluate(() => window.Strom.ZoomPan.getScale())).toBeCloseTo(before.scale, 2);
});

test('the toast goes at the next click in the tree, and after 5 s', async ({ page }) => {
    await setup(page);
    await rowOf(page, 'g1').locator('.branch-tab.kind-focus').click();
    const toast = page.locator('#focus-toast .focus-toast-box');
    await expect(toast).toBeVisible();
    await page.mouse.click(8, 450);
    await expect(toast).toHaveCount(0);
    // Again, then the time runs out (5 s)
    await startView(page);
    await rowOf(page, 'g1').locator('.branch-tab.kind-focus').click();
    await expect(toast).toBeVisible();
    await page.mouse.move(8, 450);
    await page.waitForTimeout(3000);
    await expect(toast).toBeVisible();
    await expect(toast).toHaveCount(0, { timeout: 5000 });
});

test('"Focus" in the menu focuses without the toast; the menu marks its rows by kind', async ({ page }) => {
    await setup(page);
    await cardOf(page, 'g1').click();
    const menu = page.locator('.context-menu');
    const focusRow = menu.locator('[data-action="focus"]');
    await expect(focusRow.locator('.menu-item-kind')).toHaveAttribute('data-kind', 'focus');
    expect(await focusRow.locator('.menu-item-kind').evaluate(el => getComputedStyle(el, '::before').content)).toBe('"◎"');
    await expect(focusRow).toHaveText('Focus');
    await focusRow.click();
    await expect.poll(() => focusOf(page)).toBe('g1');
    await page.waitForTimeout(300);
    await expect(page.locator('#focus-toast .focus-toast-box')).toHaveCount(0);
});

/**
 * The order of the relation (§3) on a married-in card with children out of
 * view: "◎ family" (parents and siblings) stands before "▸ children".
 */
test('a married-in husband with children out of view: "◎ family" before "▸ children"', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await seedTree(page, {
        c: { firstName: 'Quirin', lastName: 'Morquist', parents: ['p', 'm'] },
        p: { firstName: 'Pirmin', lastName: 'Morquist', partners: ['m'] },
        m: { firstName: 'Ilvana', lastName: 'Morquist', gender: 'female', partners: ['p'] },
        d: { firstName: 'Dorothea', lastName: 'Morquist', gender: 'female', parents: ['p', 'm'], partners: ['g1'] },
        g1: { firstName: 'Wolfbrecht', lastName: 'Zwolbrack', parents: ['gg1', 'gg2'], partners: ['d'] },
        k: { firstName: 'Odalric', lastName: 'Zwolbrack', parents: ['g1', 'd'] },
        s: { firstName: 'Sigwulf', lastName: 'Zwolbrack', parents: ['gg1', 'gg2'] },
        gg1: { firstName: 'Arbogast', lastName: 'Zwolbrack', partners: ['gg2'] },
        gg2: { firstName: 'Adelgunde', lastName: 'Zwolbrack', gender: 'female', partners: ['gg1'] },
    }, 'Zwolbrack', 'c');
    await page.evaluate(() => window.Strom.TreeRenderer.setFocus('c' as never));
    await page.evaluate(() => window.Strom.TreeRenderer.setFocusDepth(2, 0));
    await expect(cardOf(page, 'g1')).toBeVisible();
    await expect(cardOf(page, 'k')).toHaveCount(0);
    const tabs = rowOf(page, 'g1').locator('.branch-tab');
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(0)).toHaveAttribute('data-tab', 'family');
    await expect(tabs.nth(0)).toHaveClass(/kind-focus/);
    await expect(tabs.nth(1)).toHaveClass(/children-tab/);
    await expect(tabs.nth(1)).toHaveClass(/kind-place/);
    await expect(tabs.nth(1).locator('.pill-glyph')).toHaveText('▸');
});

/**
 * A toast over a bubble (round 4 §29): the tree < the zoom buttons < a
 * bubble < a toast. A toast that comes while a bubble is open closes it; one
 * already on the screen stays over a bubble opened after it.
 */
test.describe('a toast over a bubble', () => {
    /** Whether the element on the screen at the middle of the box is the box's. */
    const hitAtMiddle = (page: Page, sel: string) => page.evaluate(s => {
        const r = document.querySelector(s)!.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!el?.closest(s);
    }, sel);

    /** Wait until the box has come in (its slide over). */
    const settledBox = (page: Page, sel: string) => expect.poll(() => page.evaluate(s =>
        document.querySelector(s)!.getAnimations({ subtree: true }).length, sel)).toBe(0);

    /** Move the open bubble so it covers the middle of the box. */
    const bubbleOver = (page: Page, sel: string) => page.evaluate(s => {
        const r = document.querySelector(s)!.getBoundingClientRect();
        const b = document.querySelector<HTMLElement>('.badge-tooltip:popover-open')!;
        const w = b.getBoundingClientRect();
        b.style.left = `${r.left + r.width / 2 - w.width / 2}px`;
        b.style.top = `${r.top + r.height / 2 - w.height / 2}px`;
    }, sel);

    test('a toast coming while a bubble is open closes the bubble', async ({ page }) => {
        await setup(page);
        const family = rowOf(page, 'g1').locator('.branch-tab.kind-focus');
        await family.hover();
        const bubble = family.locator('.badge-tooltip');
        await expect(bubble).toBeVisible();
        await page.evaluate(() => window.Strom.UI.showToast('Saved', 10000));
        await expect(page.locator('.toast')).toBeVisible();
        await expect(bubble).toBeHidden();
    });

    test('a message toast on the screen stays over a bubble opened after it', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.UI.showToast('Saved', 10000));
        await expect(page.locator('.toast.show')).toBeVisible();
        const family = rowOf(page, 'g1').locator('.branch-tab.kind-focus');
        await family.hover();
        const bubble = family.locator('.badge-tooltip');
        await expect(bubble).toBeVisible();
        await settledBox(page, '.toast');
        await bubbleOver(page, '.toast');
        expect(await hitAtMiddle(page, '.toast')).toBe(true);
        // the bubble closed, the toast is back in the page (under dialogs)
        await page.mouse.move(8, 450);
        await page.mouse.click(8, 450);
        await expect(bubble).toBeHidden();
        await expect(page.locator('.toast')).not.toHaveAttribute('popover');
    });

    test('the focus toast with "↩ Back" stays over a bubble opened after it', async ({ page }) => {
        await setup(page);
        await rowOf(page, 'g1').locator('.branch-tab.kind-focus').click();
        await expect.poll(() => focusOf(page)).toBe('g1');
        const toast = page.locator('#focus-toast .focus-toast-box');
        await expect(toast).toBeVisible();
        const tab = page.locator('#tree-canvas .branch-tab').first();
        await tab.hover();
        const bubble = tab.locator('.badge-tooltip');
        await expect(bubble).toBeVisible();
        await expect(toast).toBeVisible();
        await settledBox(page, '#focus-toast .focus-toast-box');
        await bubbleOver(page, '#focus-toast .focus-toast-box');
        expect(await hitAtMiddle(page, '#focus-toast .focus-toast-box')).toBe(true);
    });

    test('a phone held sideways: the focus toast at the top of the tree, under the top bar', async ({ page }) => {
        await setup(page);
        await page.setViewportSize({ width: 844, height: 390 });
        await page.evaluate(() => window.Strom.ZoomPan.centerOnPerson('g1' as never));
        await page.waitForTimeout(400);
        await rowOf(page, 'g1').locator('.branch-tab.kind-focus').click();
        await expect.poll(() => focusOf(page)).toBe('g1');
        const toast = page.locator('#focus-toast .focus-toast-box');
        await expect(toast).toBeVisible();
        const t = (await toast.boundingBox())!;
        const bar = await page.evaluate(() => document.querySelector('.toolbar')!.getBoundingClientRect().bottom);
        expect(t.y).toBeGreaterThanOrEqual(bar);
        expect(t.y + t.height).toBeLessThan(390 / 2);
    });
});
