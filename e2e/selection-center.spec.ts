/**
 * "◎ Focus on {name}" on the focused card outside the window's selection
 * (spec 098 §13): the button on the card's bottom edge offers the
 * selection's centre (a family line's founder, the person nearest to the
 * focus in a list); pressed, the focus goes there with "↩ Back"; none with
 * the focus inside the selection, none while the agent is followed, none in
 * the fan; the cards stay where they were with and without it; on a phone a
 * 44 px target. Invented names only (e2e/rods-fixture.ts).
 */

import { test, expect, Page, Locator } from '@playwright/test';
import { openApp } from './helpers.js';
import { rodsTree } from './rods-fixture.js';

async function setup(page: Page, focus: string): Promise<void> {
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
const center = (page: Page): Locator => page.locator('#tree-canvas .card-tag--center');
const focusId = (page: Page): Promise<string | null> => page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId() as string | null);

async function setFocus(page: Page, id: string): Promise<void> {
    await page.evaluate(async (f) => {
        window.Strom.TreeRenderer.setFocus(f as never);
        await window.Strom.TreeRenderer.renderAsync();
    }, id);
}

async function chooseRod(page: Page, name: string): Promise<void> {
    await host(page).locator('.sp-rodpick-btn').click();
    const pop = host(page).locator('.sp-rodpick-pop');
    await expect(pop).toBeVisible();
    await pop.locator('.sp-rodpick-rod', { hasText: name }).locator('button').click();
    await expect(pill(page).locator('.evidence-pill-label--pick')).toContainText(name);
}

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

/** Every card's place on the canvas (the button must move none). */
const places = (page: Page): Promise<Record<string, string>> => page.locator('#tree-canvas .person-card[data-id]').evaluateAll(els => {
    const out: Record<string, string> = {};
    for (const el of els) {
        const c = el as HTMLElement;
        out[c.dataset.id!] = `${c.style.left} ${c.style.top} ${c.offsetWidth} ${c.offsetHeight}`;
    }
    return out;
});

test.describe('the centre of the selection on a computer', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('a family line: the founder offered on the focused card; pressed, the focus goes there with ↩ Back @smoke', async ({ page }) => {
        // Anton Ostrander (Dagny's father) in focus; a Brandvold's wife would be shown faint, not outside.
        await setup(page, 'o1');
        await chooseRod(page, 'Brandvold');
        await expect(cardOf(page, 'o1')).toHaveClass(/sel-outside/);
        const btn = cardOf(page, 'o1').locator('.card-tag--center');
        await expect(btn).toBeVisible();
        await expect(btn).toHaveText('◎Focus on Arvid Brandvold');
        await expect(btn).toHaveAttribute('aria-label', 'Focus on Arvid Brandvold – the centre of the selection Line Brandvold');
        await expect(btn).toHaveAttribute('title', 'Focus on Arvid Brandvold – the centre of the selection Line Brandvold');
        await expect(center(page)).toHaveCount(1);
        // On the card's bottom edge, inside its width.
        const b = (await btn.boundingBox())!;
        const c = (await cardOf(page, 'o1').boundingBox())!;
        expect(b.y + b.height).toBeGreaterThan(c.y + c.height);
        expect(b.y).toBeLessThan(c.y + c.height);
        expect(b.x + b.width).toBeLessThanOrEqual(c.x + c.width + 0.5);

        await btn.click();
        await expect.poll(() => focusId(page)).toBe('b1');
        // The selection stays; the founder is in it: no tag, no button.
        await expect(pill(page).locator('.evidence-pill-label--pick')).toContainText('Brandvold');
        await expect(page.locator('#tree-canvas .card-tag--outside')).toHaveCount(0);
        await expect(center(page)).toHaveCount(0);
        const toast = page.locator('.focus-toast-box.show');
        await expect(toast).toContainText('Arvid Brandvold');
        await toast.locator('.focus-toast-back').click();
        await expect.poll(() => focusId(page)).toBe('o1');
        await expect(cardOf(page, 'o1').locator('.card-tag--center')).toBeVisible();
    });

    test('a list: the member nearest to the focus; none with the focus inside; the cards stay put', async ({ page }) => {
        await setup(page, 'b16');
        // Karl (the father, one step) and Lena (the sister, two steps).
        await chooseList(page, 'Letters', ['b14', 'b15']);
        const btn = cardOf(page, 'b16').locator('.card-tag--center');
        await expect(btn).toHaveText('◎Focus on Karl Brandvold');

        // While the agent is followed here: the tag alone, nothing else on the canvas moves.
        const withButton = await places(page);
        await page.evaluate(() => {
            const ui = window.Strom.UI as unknown as { agentFollowedHere: () => boolean };
            ui.agentFollowedHere = () => true;
            (window.Strom.TreeRenderer as unknown as { refreshSelectionCenter(): void }).refreshSelectionCenter();
        });
        await expect(center(page)).toHaveCount(0);
        await expect(cardOf(page, 'b16').locator('.card-tag--outside')).toBeVisible();
        expect(await places(page)).toEqual(withButton);
        await page.evaluate(() => {
            delete (window.Strom.UI as unknown as { agentFollowedHere?: unknown }).agentFollowedHere;
            (window.Strom.TreeRenderer as unknown as { refreshSelectionCenter(): void }).refreshSelectionCenter();
        });
        await expect(btn).toBeVisible();

        // Hide others: the button stays on the focused card.
        await hide(page).click();
        await expect(hide(page)).toHaveAttribute('aria-pressed', 'true');
        await expect(cardOf(page, 'b16').locator('.card-tag--center')).toHaveText('◎Focus on Karl Brandvold');

        // The focus inside the selection: no button.
        await setFocus(page, 'b15');
        await expect(center(page)).toHaveCount(0);
        await expect(page.locator('#tree-canvas .card-tag--outside')).toHaveCount(0);
    });

    test('a wide font: the "+ child" tab shown under the pointer stands beside the button, never over it', async ({ page }) => {
        await setup(page, 'o1');
        // A wider face than the default (CI's Linux fonts are wider than a Mac's).
        await page.addStyleTag({ content: '* { font-family: Verdana, "DejaVu Sans", sans-serif !important; }' });
        await chooseRod(page, 'Brandvold');
        const card = cardOf(page, 'o1');
        const btn = card.locator('.card-tag--center');
        await expect(btn).toBeVisible();
        await card.hover({ position: { x: 20, y: 20 } });
        const add = card.locator('.edge-bottom-center .add-btn');
        await expect(add).toBeVisible();
        const b = (await btn.boundingBox())!;
        const a = (await add.boundingBox())!;
        expect(a.x).toBeGreaterThanOrEqual(b.x + b.width);
        expect(a.x + a.width).toBeLessThanOrEqual((await card.boundingBox())!.x + (await card.boundingBox())!.width);
        // Every point of the button is the button's (its start, middle and end), with the pointer on it too.
        await btn.hover();
        const hits = await btn.evaluate((el) => {
            const r = el.getBoundingClientRect();
            const y = r.top + r.height / 2;
            return [r.left + 3, r.left + r.width / 2, r.right - 3].map(x => el.contains(document.elementFromPoint(x, y)));
        });
        expect(hits).toEqual([true, true, true]);
        await btn.click({ timeout: 5000 });
        await expect.poll(() => focusId(page)).toBe('b1');
    });

    test('none in the fan', async ({ page }) => {
        await setup(page, 'o1');
        await chooseRod(page, 'Brandvold');
        await expect(center(page)).toHaveCount(1);
        await page.locator('#view-mode-fan').click();
        await expect(page.locator('#fan-chart svg.fan-svg')).toBeVisible();
        await expect(page.locator('.card-tag--center:visible')).toHaveCount(0);
    });
});

test.describe('the centre of the selection on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('a 44 px target around the button; a tap focuses the centre', async ({ page }) => {
        await setup(page, 'b16');
        await page.evaluate(() => {
            window.Strom.DataManager.createPersonList({ name: 'Letters', dynamic: false, personIds: ['b14', 'b15'] as never[], sort: 'manual' });
        });
        await page.locator('#bb-view-more').click();
        await page.locator('#sheet-rod').click();
        const sheet = page.locator('.rod-pick-sheet');
        await expect(sheet).toBeVisible();
        await sheet.locator('li.sp-selpick-row[data-sec="lists"]', { hasText: 'Letters' }).locator('button').click();
        await expect(pill(page)).toBeVisible();
        await page.evaluate(() => document.querySelectorAll('.undo-toast').forEach(t => t.remove()));

        const btn = cardOf(page, 'b16').locator('.card-tag--center');
        await expect(btn).toBeVisible();
        // The unseen target reaches 44 px (in the canvas's scale) around the 17 px tag.
        const target = await btn.evaluate(el => {
            const r = el.getBoundingClientRect();
            const scale = r.height / (el as HTMLElement).offsetHeight;
            const before = getComputedStyle(el, '::before');
            return { h: (el as HTMLElement).offsetHeight - parseFloat(before.top) - parseFloat(before.bottom), scale, content: before.content };
        });
        expect(target.content).toBe('""');
        expect(target.h).toBeGreaterThanOrEqual(44);
        await btn.tap();
        await expect.poll(() => focusId(page)).toBe('b14');
    });
});
