/**
 * "Hide others" of the window's selection and the focused person outside it
 * (spec 098 §8, §9): the switch in the pill and its memory across a reload,
 * the tree laid out from the selection's people alone, the tabs of hidden
 * relatives counting only them, the focus bar's count, the tag "outside the
 * selection" on the focused card (with and without Hide others), none in the
 * fan, and a selection with nobody drawn moving the focus with ↩ Back.
 * Invented names only (e2e/rods-fixture.ts).
 */

import { test, expect, Page, Locator } from '@playwright/test';
import { openApp, reloadApp } from './helpers.js';
import { rodsTree } from './rods-fixture.js';

async function setup(page: Page, focus = 'b16'): Promise<void> {
    await openApp(page);
    await page.evaluate(async ([data, f]) => {
        const S = window.Strom;
        await S.DataManager.importAsNewTree(data, 'Brandvold');
        S.UI.updateTreeSwitcher?.();
        S.TreeRenderer.setFocus(f as never);
        await S.TreeRenderer.renderAsync();
    }, [rodsTree(), focus] as const);
}

const host = (page: Page): Locator => page.locator('#view-rod-picker');
const pill = (page: Page): Locator => page.locator('#evidence-pill');
const hide = (page: Page): Locator => pill(page).locator('.evidence-pill-hide');
const cardOf = (page: Page, id: string): Locator => page.locator(`#tree-canvas .person-card[data-id="${id}"]`);
const drawn = (page: Page): Promise<string[]> =>
    page.locator('#tree-canvas .person-card[data-id]').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.id!).sort());
const focusId = (page: Page): Promise<string | null> => page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId() as string | null);

/** A list of people chosen as the window's selection from the toolbar's choice. */
async function chooseList(page: Page, name: string, ids: string[]): Promise<void> {
    await page.evaluate(([n, p]) => {
        window.Strom.DataManager.createPersonList({ name: n, dynamic: false, personIds: p as never[], sort: 'manual' });
    }, [name, ids] as const);
    await host(page).locator('.sp-rodpick-btn').click();
    const pop = host(page).locator('.sp-rodpick-pop');
    await expect(pop).toBeVisible();
    await pop.locator('li.sp-selpick-row[data-sec="lists"]', { hasText: name }).locator('button').click();
    await expect(pill(page).locator('.evidence-pill-label--pick')).toContainText(name);
}

test.describe('Hide others on a computer', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the switch lays the tree out from the selection; remembered after a reload; tabs and count see only the selection @smoke', async ({ page }) => {
        await setup(page);
        // Karl (the father) and Lena (the sister); Mikael in focus is not in the list.
        await chooseList(page, 'Letters', ['b14', 'b15']);
        await expect(hide(page)).toHaveAttribute('aria-pressed', 'false');
        await expect(hide(page)).toHaveText('✓Hide others');
        await expect(hide(page)).toHaveAttribute('title', 'The tree is laid out from the selection only');
        expect((await hide(page).boundingBox())!.height).toBeCloseTo(28, 0);
        await expect(cardOf(page, 'b14w')).toHaveClass(/evidence-dim/);
        const before = await drawn(page);
        expect(before).toContain('b13');

        await hide(page).click();
        await expect(hide(page)).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(() => drawn(page)).toEqual(['b14', 'b15', 'b16']);
        // No tab offers the relatives left out: Karl's parents, Mikael's mother.
        await expect(page.locator('#tree-canvas .parents-tab')).toHaveCount(0);
        await expect(page.locator('#tree-canvas .siblings-tab')).toHaveCount(0);
        await expect(page.locator('#tree-canvas .children-tab')).toHaveCount(0);
        await expect(page.locator('#focus-person-count')).toContainText('3');
        // The focus outside the list: undimmed, tagged.
        await expect(cardOf(page, 'b16')).not.toHaveClass(/evidence-dim/);
        await expect(cardOf(page, 'b16')).toHaveClass(/sel-outside/);
        await expect(cardOf(page, 'b16').locator('.card-tag--outside')).toHaveText('outside the selection');
        await expect(cardOf(page, 'b16')).toHaveAttribute('aria-label', /– outside the selection$/);

        await reloadApp(page);
        await expect(hide(page)).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(() => drawn(page)).toEqual(['b14', 'b15', 'b16']);

        // Off again: the whole view comes back.
        await hide(page).click();
        await expect(hide(page)).toHaveAttribute('aria-pressed', 'false');
        await expect.poll(() => drawn(page)).toEqual(before);
    });

    test('laid out anew, no card stays under the pill: the view pans the least it takes (098)', async ({ page }) => {
        await setup(page);
        await chooseList(page, 'Letters', ['b14', 'b15']);
        // Karl's card 10 px under the pill's lower edge, as a pan may leave it.
        await page.evaluate(() => {
            const pill = document.getElementById('evidence-pill')!.getBoundingClientRect();
            const card = document.querySelector('#tree-canvas .person-card[data-id="b14"]')!.getBoundingClientRect();
            const zoom = window.Strom.ZoomPan;
            zoom.shiftWorld(0, -((pill.bottom - 10) - card.top) / zoom.getScale());
        });
        const underPill = (): Promise<string[]> => page.evaluate(() => {
            const p = document.getElementById('evidence-pill')!.getBoundingClientRect();
            return [...document.querySelectorAll<HTMLElement>('#tree-canvas .person-card[data-id]')].filter(c => {
                const r = c.getBoundingClientRect();
                return r.right > p.left && r.left < p.right && r.bottom > p.top && r.top < p.bottom;
            }).map(c => c.dataset.id!);
        });
        expect(await underPill()).toContain('b14');
        await hide(page).click();
        await expect.poll(() => drawn(page)).toEqual(['b14', 'b15', 'b16']);
        await expect.poll(underPill).toEqual([]);
        await expect(cardOf(page, 'b16')).toBeInViewport();
    });

    test('a focus moved outside the selection keeps its tag, with and without Hide others; none in the fan', async ({ page }) => {
        await setup(page);
        await chooseList(page, 'Letters', ['b14', 'b15', 'b16']);
        await expect(cardOf(page, 'b16')).toHaveClass(/evidence-hit/);
        await expect(page.locator('#tree-canvas .card-tag--outside')).toHaveCount(0);

        // Ester, the mother, is not in the list.
        await page.evaluate(async () => {
            window.Strom.TreeRenderer.setFocus('b14w' as never);
            await window.Strom.TreeRenderer.renderAsync();
        });
        await expect(cardOf(page, 'b14w')).toHaveClass(/sel-outside/);
        await expect(cardOf(page, 'b14w')).not.toHaveClass(/evidence-dim/);
        await expect(cardOf(page, 'b14w').locator('.card-tag--outside')).toBeVisible();
        await expect(page.locator('#tree-canvas .card-tag--outside')).toHaveCount(1);

        await hide(page).click();
        await expect.poll(() => drawn(page)).toEqual(['b14', 'b14w', 'b15', 'b16']);
        await expect(cardOf(page, 'b14w').locator('.card-tag--outside')).toBeVisible();

        // Back into the selection: the tag goes.
        await page.evaluate(async () => {
            window.Strom.TreeRenderer.setFocus('b14' as never);
            await window.Strom.TreeRenderer.renderAsync();
        });
        await expect(page.locator('#tree-canvas .card-tag--outside')).toHaveCount(0);

        // The fan: no switch, its centre never dimmed.
        await page.evaluate(async () => {
            window.Strom.TreeRenderer.setFocus('b14w' as never);
            await window.Strom.TreeRenderer.renderAsync();
        });
        await page.locator('#view-mode-fan').click();
        await expect(page.locator('#fan-chart svg.fan-svg')).toBeVisible();
        await expect(hide(page)).toBeHidden();
        await expect(page.locator('#fan-chart .fan-focus')).not.toHaveClass(/evidence-dim/);
    });

    test('a selection with nobody drawn moves the focus to its nearest person; ↩ Back brings it back', async ({ page }) => {
        await setup(page);
        // Mats Hollberg stands far from Mikael (depth 2 draws neither him nor his parents).
        await chooseList(page, 'Rydsjö', ['h4', 'h5']);
        await expect.poll(() => focusId(page)).toBe('h4');
        const toast = page.locator('.focus-toast-box.show');
        await expect(toast).toContainText('selection');
        // "↩ Back" (in the message of the list saved just before, when that one is still up)
        await page.locator('.focus-toast-back:visible').first().click();
        await expect.poll(() => focusId(page)).toBe('b16');
    });
});

test.describe('Hide others on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the switch is 44 px tall and fits the pill', async ({ page }) => {
        await setup(page);
        await chooseListOnPhone(page);
        // The message "List saved" stands over the pill for a while
        await page.evaluate(() => document.querySelectorAll('.undo-toast').forEach(t => t.remove()));
        const box = (await hide(page).boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(43.5);
        const p = (await pill(page).boundingBox())!;
        expect(box.x + box.width).toBeLessThanOrEqual(p.x + p.width + 0.5);
        await hide(page).tap();
        await expect(hide(page)).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(() => drawn(page)).toEqual(['b14', 'b15', 'b16']);
    });
});

/** On a phone the list is chosen in the sheet (More → Selection). */
async function chooseListOnPhone(page: Page): Promise<void> {
    await page.evaluate(() => {
        window.Strom.DataManager.createPersonList({ name: 'Letters', dynamic: false, personIds: ['b14', 'b15'] as never[], sort: 'manual' });
    });
    await page.locator('#bb-view-more').click();
    await page.locator('#sheet-rod').click();
    const sheet = page.locator('.rod-pick-sheet');
    await expect(sheet).toBeVisible();
    await sheet.locator('li.sp-selpick-row[data-sec="lists"]', { hasText: 'Letters' }).locator('button').click();
    await expect(pill(page)).toBeVisible();
}
