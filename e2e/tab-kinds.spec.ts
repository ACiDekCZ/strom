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
        document.querySelector(s)?.getAnimations({ subtree: true }).length ?? -1, sel)).toBe(0);

    /** Move the open bubble so it covers the middle of the box. */
    const bubbleOver = (page: Page, sel: string) => page.evaluate(s => {
        const r = document.querySelector(s)!.getBoundingClientRect();
        const b = document.querySelector<HTMLElement>('.badge-tooltip:popover-open')!;
        const w = b.getBoundingClientRect();
        b.style.left = `${r.left + r.width / 2 - w.width / 2}px`;
        b.style.top = `${r.top + r.height / 2 - w.height / 2}px`;
    }, sel);

    /** The open bubble moved (and sized) so its bottom edge stands at `bottom`, its middle at the window's. */
    const bubbleTo = (page: Page, bottom: number, height?: number) => page.evaluate(([y, h]) => {
        const b = document.querySelector<HTMLElement>('.badge-tooltip:popover-open')!;
        if (h) { b.style.maxHeight = 'none'; b.style.height = `${h}px`; }
        const w = b.getBoundingClientRect();
        b.style.left = `${window.innerWidth / 2 - w.width / 2}px`;
        b.style.top = `${y - w.height}px`;
    }, [bottom, height ?? 0] as const);

    /** The box's rect once nothing on it glides any more. */
    const settledRect = async (page: Page, sel: string) => {
        await settledBox(page, sel);
        return page.evaluate(s => {
            const r = document.querySelector(s)!.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom };
        }, sel);
    };

    test('a toast coming while a bubble is open where it stands: above the bubble, 8 px over its top edge; the bubble open; back at its place when the bubble closes (round 6 §44)', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.UI.showToast('Saved', 800));
        const own = await settledRect(page, '.toast.show');
        await expect(page.locator('.toast')).toHaveCount(0, { timeout: 3000 });
        const family = rowOf(page, 'g1').locator('.branch-tab.kind-focus');
        await family.hover();
        const bubble = family.locator('.badge-tooltip');
        await expect(bubble).toBeVisible();
        // the bubble over the toast's place
        await bubbleTo(page, own.bottom - 10);
        const b = (await bubble.boundingBox())!;
        await page.evaluate(() => window.Strom.UI.showToast('Saved', 10000));
        const t = await settledRect(page, '.toast.show');
        expect(Math.abs(t.bottom - (b.y - 8))).toBeLessThanOrEqual(1.5);
        await expect(bubble).toBeVisible();
        expect(await hitAtMiddle(page, '.toast')).toBe(true);
        // the bubble closes: the toast glides back to its place
        await page.mouse.move(8, 450);
        await expect(bubble).toBeHidden();
        await expect.poll(async () => Math.round((await settledRect(page, '.toast.show')).bottom)).toBe(Math.round(own.bottom));
        await expect(page.locator('.toast')).not.toHaveAttribute('style', /bottom/);
    });

    test('reduced motion: the toast stands over the bubble and back at once, no glide (round 6 §44)', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await setup(page);
        await page.evaluate(() => window.Strom.UI.showToast('Saved', 800));
        const own = await settledRect(page, '.toast.show');
        await expect(page.locator('.toast')).toHaveCount(0, { timeout: 3000 });
        const family = rowOf(page, 'g1').locator('.branch-tab.kind-focus');
        await family.hover();
        const bubble = family.locator('.badge-tooltip');
        await expect(bubble).toBeVisible();
        await bubbleTo(page, own.bottom - 10);
        await page.evaluate(() => window.Strom.UI.showToast('Saved', 10000));
        await settledRect(page, '.toast.show');
        /** Whether the toast's `bottom` glides now. */
        const glides = () => page.evaluate(() => document.querySelector('.toast')!.getAnimations()
            .some(a => (a as CSSTransition).transitionProperty === 'bottom'));
        await expect(page.locator('.toast')).toHaveAttribute('style', /bottom/);
        await page.mouse.move(8, 450);
        await expect(bubble).toBeHidden();
        expect(await glides()).toBe(false);
        expect(Math.round((await page.locator('.toast').boundingBox())!.y + (await page.locator('.toast').boundingBox())!.height)).toBe(Math.round(own.bottom));
    });

    test('no room above the bubble (8 px under the bars): the toast coming closes the bubble and stands at its place (round 6 §44)', async ({ page }) => {
        await setup(page);
        const family = rowOf(page, 'g1').locator('.branch-tab.kind-focus');
        await family.hover();
        const bubble = family.locator('.badge-tooltip');
        await expect(bubble).toBeVisible();
        // a bubble from just under the bars down over the toast's place
        await bubbleTo(page, 880, 800);
        await page.evaluate(() => window.Strom.UI.showToast('Saved', 10000));
        await expect(bubble).toBeHidden();
        const t = await settledRect(page, '.toast.show');
        expect(Math.round(900 - t.bottom)).toBe(24);
    });

    test('a toast coming while a bubble is open elsewhere stays at its place, the bubble open', async ({ page }) => {
        await setup(page);
        const family = rowOf(page, 'g1').locator('.branch-tab.kind-focus');
        await family.hover();
        const bubble = family.locator('.badge-tooltip');
        await expect(bubble).toBeVisible();
        await bubbleTo(page, 500);
        await page.evaluate(() => window.Strom.UI.showToast('Saved', 10000));
        const t = await settledRect(page, '.toast.show');
        expect(Math.round(900 - t.bottom)).toBe(24);
        await expect(bubble).toBeVisible();
    });

    /**
     * A standing toast (a long one, wide across the middle) right above the
     * "◎ family" tab of Wolfbrecht: the tab's bubble opens above the tab, over it.
     */
    async function toastUnderTab(page: Page, ms: number) {
        await setup(page);
        await page.evaluate(t => window.Strom.UI.showToast('Saved to the tree file, the next copy goes out with the research changes', t), ms);
        const own = await settledRect(page, '.toast.show');
        const family = rowOf(page, 'g1').locator('.branch-tab.kind-focus');
        const tab = (await family.boundingBox())!;
        await page.evaluate(([dy]) => window.Strom.ZoomPan.shiftWorld(0, -dy / window.Strom.ZoomPan.getScale()),
            [own.bottom + 4 - tab.y] as const);
        await page.waitForTimeout(100);
        return { own, family, bubble: family.locator('.badge-tooltip') };
    }

    /** Whether the toast is seen (not hidden). */
    const seen = (page: Page, sel: string) => page.evaluate(s => {
        const el = document.querySelector(s);
        return !!el && getComputedStyle(el).visibility !== 'hidden' && Number(getComputedStyle(el).opacity) > 0;
    }, sel);

    test('a bubble opened over a standing toast hides it while it is open; the toast comes back when it closes (round 7 §52)', async ({ page }) => {
        const { family, bubble } = await toastUnderTab(page, 10000);
        expect(await seen(page, 'body > .toast')).toBe(true);
        await family.hover();
        await expect(bubble).toBeVisible();
        await expect.poll(() => seen(page, 'body > .toast')).toBe(false);
        expect(await hitAtMiddle(page, '.badge-tooltip')).toBe(true);
        // the bubble closes: the toast is back, at its place
        await page.mouse.move(8, 450);
        await expect(bubble).toBeHidden();
        await expect.poll(() => seen(page, 'body > .toast')).toBe(true);
        await expect(page.locator('body > .toast')).not.toHaveAttribute('style', /bottom/);
    });

    test('the time of a toast hidden under a bubble runs on: over meanwhile, the toast does not come back (round 7 §52)', async ({ page }) => {
        const { family, bubble } = await toastUnderTab(page, 2500);
        await family.hover();
        await expect(bubble).toBeVisible();
        await expect.poll(() => seen(page, 'body > .toast')).toBe(false);
        await expect(page.locator('body > .toast')).toHaveCount(0, { timeout: 4000 });
        await page.mouse.move(8, 450);
        await expect(bubble).toBeHidden();
        await expect(page.locator('body > .toast')).toHaveCount(0);
    });

    test('a press on the toast over the bubble leaves the bubble open: the toast stays under the finger', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.UI.showToast('Saved', 800));
        const own = await settledRect(page, '.toast.show');
        await expect(page.locator('.toast')).toHaveCount(0, { timeout: 3000 });
        const family = rowOf(page, 'g1').locator('.branch-tab.kind-focus');
        await family.hover();
        const bubble = family.locator('.badge-tooltip');
        await expect(bubble).toBeVisible();
        await bubbleTo(page, own.bottom - 10);
        await page.evaluate(() => window.Strom.UI.showToast('Saved', 10000));
        await settledRect(page, '.toast.show');
        await page.locator('.toast').dispatchEvent('pointerdown');
        await expect(bubble).toBeVisible();
    });

    test.describe('touch, phone 390 × 844', () => {
        test.use({ hasTouch: true, isMobile: true });

        /** A long press on the element (a tab: its bubble). */
        async function hold(page: Page, el: ReturnType<Page['locator']>): Promise<void> {
            for (const type of ['touchstart', 'touchend'] as const) {
                if (type === 'touchend') await page.waitForTimeout(700);
                await el.evaluate((e: HTMLElement, kind) => {
                    const r = e.getBoundingClientRect();
                    const t = new Touch({ identifier: 1, target: e, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 });
                    const on = kind === 'touchstart' ? [t] : [];
                    e.dispatchEvent(new TouchEvent(kind, { touches: on, targetTouches: on, changedTouches: [t], bubbles: true, cancelable: true }));
                }, type);
            }
        }

        async function phoneBubble(page: Page) {
            await setup(page);
            await page.setViewportSize({ width: 390, height: 844 });
            await page.evaluate(() => window.Strom.ZoomPan.centerOnPerson('g1' as never));
            await page.waitForTimeout(400);
            await page.evaluate(() => window.Strom.UI.showToast('Saved', 800));
            const own = await settledRect(page, '.toast.show');
            await expect(page.locator('.toast')).toHaveCount(0, { timeout: 3000 });
            const family = rowOf(page, 'g1').locator('.branch-tab.kind-focus');
            await hold(page, family);
            const bubble = family.locator('.badge-tooltip');
            await expect(bubble).toBeVisible();
            return { own, bubble };
        }

        test('a toast coming while a bubble opened by a long press is open where it stands: above the bubble, the bubble open (round 6 §44)', async ({ page }) => {
            const { own, bubble } = await phoneBubble(page);
            // a low bubble: the toast raised above it stays clear of the bubble's tab (round 7 §55)
            await bubbleTo(page, own.bottom - 10, 150);
            const b = (await bubble.boundingBox())!;
            await page.evaluate(() => window.Strom.UI.showToast('Saved', 10000));
            const t = await settledRect(page, '.toast.show');
            expect(Math.abs(t.bottom - (b.y - 8))).toBeLessThanOrEqual(1.5);
            await expect(bubble).toBeVisible();
            expect(await hitAtMiddle(page, '.toast')).toBe(true);
        });

        test('no room above it: the toast closes the bubble and stands at its place (round 6 §44)', async ({ page }) => {
            const { own, bubble } = await phoneBubble(page);
            await bubbleTo(page, own.bottom - 10, 700);
            await page.evaluate(() => window.Strom.UI.showToast('Saved', 10000));
            await expect(bubble).toBeHidden();
            const t = await settledRect(page, '.toast.show');
            expect(Math.abs(t.bottom - own.bottom)).toBeLessThanOrEqual(1);
        });

        test('raised above the bubble it would cover the bubble\'s own tab: the toast closes the bubble and stands at its place (round 7 §55)', async ({ page }) => {
            const { own, bubble } = await phoneBubble(page);
            const tab = (await rowOf(page, 'g1').locator('.branch-tab.kind-focus').boundingBox())!;
            // the bubble right under its tab, down over the toast's place: raised above it, a toast
            // as wide as the phone would lie on the tab
            const top = tab.y + tab.height + 4;
            await bubbleTo(page, own.bottom - 10, own.bottom - 10 - top);
            await page.evaluate(() => window.Strom.UI.showToast('Saved to the tree file, the next copy goes out with the research changes', 10000));
            await expect(bubble).toBeHidden();
            const t = await settledRect(page, '.toast.show');
            expect(Math.abs(t.bottom - own.bottom)).toBeLessThanOrEqual(1);
            await expect(page.locator('.toast')).not.toHaveAttribute('style', /bottom/);
        });
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

    test('a phone held sideways: the focus toast at the bottom of the tree beside the side bar, clear of ↩ ↪ and the zoom stack (round 5 §39)', async ({ page }) => {
        await setup(page);
        await page.setViewportSize({ width: 844, height: 390 });
        await page.evaluate(() => window.Strom.ZoomPan.centerOnPerson('g1' as never));
        await page.waitForTimeout(400);
        await rowOf(page, 'g1').locator('.branch-tab.kind-focus').click();
        await expect.poll(() => focusOf(page)).toBe('g1');
        const toast = page.locator('#focus-toast .focus-toast-box');
        await expect(toast).toBeVisible();
        await settledBox(page, '#focus-toast .focus-toast-box');
        const t = (await toast.boundingBox())!;
        // At the bottom: a gap of 16 px to the window's bottom edge (no bottom bar sideways)
        expect(390 - (t.y + t.height)).toBeGreaterThanOrEqual(12);
        expect(390 - (t.y + t.height)).toBeLessThanOrEqual(24);
        // Beside the side bar (the bottom bar of the other regimes), clear of ↩ ↪ and the zoom stack
        const rects = await page.evaluate(() => ['.bottom-bar', '#focus-back-btn', '#focus-forward-btn', '.zoom-controls']
            .map(s => document.querySelector(s)!.getBoundingClientRect())
            .filter(r => r.width > 0 && r.height > 0)
            .map(r => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })));
        expect(rects.length).toBeGreaterThanOrEqual(3);
        for (const r of rects) {
            const apart = t.x >= r.right || t.x + t.width <= r.left || t.y >= r.bottom || t.y + t.height <= r.top;
            expect(apart, JSON.stringify(r)).toBe(true);
        }
    });
});

/**
 * One toast at a time (round 5 §39): a message coming while the focus toast
 * stands takes its place and carries its "↩ Back" while the focus toast's
 * time runs (5 s); then "↩ Back" goes and the message runs its own time. A
 * message gone sooner gives the focus toast back.
 */
test.describe('one toast at a time', () => {
    /** The toasts a person sees now (a message, the undo pill, the focus toast's box). */
    const toastsOnScreen = (page: Page) => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('body > .toast, body > .undo-toast, #focus-toast .focus-toast-box')]
        .filter(el => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && Number(getComputedStyle(el).opacity) > 0;
        }).length);

    async function focusWithToast(page: Page): Promise<void> {
        await setup(page);
        await rowOf(page, 'g1').locator('.branch-tab.kind-focus').click();
        await expect.poll(() => focusOf(page)).toBe('g1');
        await expect(page.locator('#focus-toast .focus-toast-box')).toBeVisible();
        await page.mouse.move(8, 450);
    }

    test('a message while the focus toast stands: one toast, the message with "↩ Back", which works', async ({ page }) => {
        await focusWithToast(page);
        const box = page.locator('#focus-toast .focus-toast-box');
        const boxRect = (await box.boundingBox())!;
        await page.evaluate(() => window.Strom.UI.showToast('Saved', 10000));
        const message = page.locator('body > .toast');
        await expect(message).toBeVisible();
        await expect(box).toBeHidden();
        await expect(message).toContainText('Saved');
        const back = message.getByRole('button', { name: 'Return to the previous view' });
        await expect(back).toHaveText('↩ Back');
        await expect.poll(() => toastsOnScreen(page)).toBe(1);
        // At the focus toast's place (its bottom edge)
        await expect.poll(async () => {
            const m = (await message.boundingBox())!;
            return Math.abs((m.y + m.height) - (boxRect.y + boxRect.height));
        }).toBeLessThanOrEqual(2);
        await back.click();
        await expect.poll(() => focusOf(page)).toBe('c');
        await expect(back).toHaveCount(0);
        await expect(box).toHaveCount(0);
    });

    test('the undo pill takes the focus toast\'s place as well', async ({ page }) => {
        await focusWithToast(page);
        await page.evaluate(() => window.Strom.UI.showUndoToast('adding Wolfbrecht'));
        const pill = page.locator('body > .undo-toast');
        await expect(pill.locator('.focus-toast-back')).toHaveText('↩ Back');
        await expect(page.locator('#focus-toast .focus-toast-box')).toBeHidden();
        await expect.poll(() => toastsOnScreen(page)).toBe(1);
    });

    test('a message over the undo pill and the focus toast carries both: "Undo" first, then "↩ Back" (round 6 §43)', async ({ page }) => {
        await focusWithToast(page);
        await page.evaluate(() => window.Strom.UI.showUndoToast('adding Wolfbrecht'));
        await page.evaluate(() => window.Strom.UI.showToast('Saved', 10000));
        const message = page.locator('body > .toast');
        await expect(message.locator('.undo-toast-btn, .focus-toast-back')).toHaveText(['Undo', '↩ Back']);
        await expect(page.locator('body > .undo-toast')).toBeHidden();
        await expect.poll(() => toastsOnScreen(page)).toBe(1);
    });

    test('"↩ Back" leaves the message when the focus toast\'s time runs out; the message runs its own time', async ({ page }) => {
        await focusWithToast(page);
        await page.evaluate(() => window.Strom.UI.showToast('Saved', 9000));
        const message = page.locator('body > .toast');
        await expect(message.locator('.focus-toast-back')).toHaveCount(1);
        await expect(message.locator('.focus-toast-back')).toHaveCount(0, { timeout: 6000 });
        await expect(message).toBeVisible();
        await expect(message).toHaveText('Saved');
        await expect(page.locator('#focus-toast .focus-toast-box')).toHaveCount(0);
    });

    test('a message gone before the focus toast\'s time gives the focus toast back with "↩ Back"', async ({ page }) => {
        await focusWithToast(page);
        await page.evaluate(() => window.Strom.UI.showToast('Saved', 800));
        await expect(page.locator('body > .toast .focus-toast-back')).toHaveCount(1);
        const box = page.locator('#focus-toast .focus-toast-box');
        await expect(box).toBeVisible({ timeout: 3000 });
        await expect(box.locator('.focus-toast-back')).toHaveText('↩ Back');
        await expect.poll(() => toastsOnScreen(page)).toBe(1);
    });

    test('a phone held sideways: the message carrying "↩ Back" stands at the focus toast\'s place at the bottom', async ({ page }) => {
        await setup(page);
        await page.setViewportSize({ width: 844, height: 390 });
        await page.evaluate(() => window.Strom.ZoomPan.centerOnPerson('g1' as never));
        await page.waitForTimeout(400);
        await rowOf(page, 'g1').locator('.branch-tab.kind-focus').click();
        await expect.poll(() => focusOf(page)).toBe('g1');
        await page.mouse.move(400, 200);
        const box = page.locator('#focus-toast .focus-toast-box');
        await expect(box).toBeVisible();
        const b = (await box.boundingBox())!;
        await page.evaluate(() => window.Strom.UI.showToast('Saved', 10000));
        const message = page.locator('body > .toast');
        await expect(message.locator('.focus-toast-back')).toHaveCount(1);
        await expect(message).toHaveClass(/at-focus-toast/);
        await expect.poll(() => toastsOnScreen(page)).toBe(1);
        await expect.poll(async () => {
            const m = (await message.boundingBox())!;
            return Math.round(m.y + m.height);
        }).toBe(Math.round(b.y + b.height));
    });
});
