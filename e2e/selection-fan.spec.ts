/**
 * The window's selection in the Fan (spec 098 §11b): "Hide others" only for
 * a selection of ancestors — the sectors of the others empty dashed outlines
 * in their places, the selection's sectors where they were, the centre always
 * drawn; any other selection keeps no switch in the Fan and its "Hide others"
 * of the Family view has no effect there (the state stays).
 * Invented names only (e2e/rods-fixture.ts).
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
const fan = (page: Page): Locator => page.locator('#fan-chart svg.fan-svg');

async function openPicker(page: Page): Promise<Locator> {
    await host(page).locator('.sp-rodpick-btn').click();
    const pop = host(page).locator('.sp-rodpick-pop');
    await expect(pop).toBeVisible();
    return pop;
}

/** The sectors' shapes by person (the selection's must not move). */
const shapes = (page: Page): Promise<Record<string, string>> => page.locator('#fan-chart [data-fan-person]').evaluateAll(els => {
    const out: Record<string, string> = {};
    for (const el of els) {
        const shape = el.querySelector<SVGGraphicsElement>('.fan-fill, .fan-focus-disc');
        if (!shape) continue;
        const b = shape.getBBox();
        out[(el as SVGElement).dataset.fanPerson!] = [b.x, b.y, b.width, b.height].map(v => v.toFixed(2)).join(' ');
    }
    return out;
});

test.describe('the selection in the Fan', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('ancestors: Hide others leaves the others as empty outlines in their places, the centre drawn', async ({ page }) => {
        // Axel in focus; the ancestors of his mother Dagny (Ostrander, Kvarnby).
        await setup(page, 'b13');
        const pop = await openPicker(page);
        await pop.locator('.sp-rodpick-q').fill('dagny');
        await expect(pop.locator('button.sp-rodpick-first')).toContainText('Ancestors: Dagny');
        await pop.locator('.sp-rodpick-q').press('Enter');
        await expect(pill(page).locator('.evidence-pill-label--pick')).toContainText('Ancestors: Dagny');

        await page.locator('#view-mode-fan').click();
        await expect(fan(page)).toBeVisible();
        await expect(hide(page)).toBeVisible();
        await expect(hide(page)).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('#fan-chart .fan-sector--off')).toHaveCount(0);
        const before = await shapes(page);
        for (const id of ['b12', 'b12w', 'o1', 'o1w', 'b13']) expect(before[id]).toBeTruthy();

        await hide(page).click();
        await expect(hide(page)).toHaveAttribute('aria-pressed', 'true');
        // Viktor (the father) and his ancestors: outlines without a person, a name or years, out of reach.
        await expect(page.locator('#fan-chart [data-fan-person="b12"]')).toHaveCount(0);
        await expect(page.locator('#fan-chart [data-fan-person="b10"]')).toHaveCount(0);
        const off = page.locator('#fan-chart .fan-sector--off');
        expect(await off.count()).toBeGreaterThanOrEqual(3);
        await expect(off.locator('text')).toHaveCount(0);
        await expect(off.first()).toHaveAttribute('aria-hidden', 'true');
        expect(await off.first().evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none');
        await expect(off.first().locator('.fan-empty-edge')).toHaveAttribute('stroke-dasharray', '4 3');
        await expect(page.locator('#fan-chart .fan-sector--off .fan-plus')).toHaveCount(0);
        // The selection's sectors and the centre where they were.
        const after = await shapes(page);
        for (const id of ['b12w', 'o1', 'o1w', 'b13']) expect(after[id]).toBe(before[id]);
        await expect(page.locator('#fan-chart .fan-focus[data-fan-person="b13"]')).toBeVisible();

        // Off again: everyone back.
        await hide(page).click();
        await expect(page.locator('#fan-chart .fan-sector--off')).toHaveCount(0);
        await expect(page.locator('#fan-chart [data-fan-person="b12"]')).toHaveCount(1);
    });

    test('a family line: no switch in the Fan; its Hide others of the Family view has no effect there and stays', async ({ page }) => {
        // Axel in focus: his mother's father Anton Ostrander is no Brandvold.
        await setup(page, 'b13');
        const pop = await openPicker(page);
        await pop.locator('.sp-rodpick-rod', { hasText: 'Brandvold' }).locator('button').click();
        await expect(pill(page).locator('.evidence-pill-label--pick')).toContainText('Brandvold');
        await expect(page.locator('#tree-canvas .person-card[data-id="o1"]')).toHaveCount(1);
        await hide(page).click();
        await expect(hide(page)).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#tree-canvas .person-card[data-id="o1"]')).toHaveCount(0);

        await page.locator('#view-mode-fan').click();
        await expect(fan(page)).toBeVisible();
        await expect(pill(page)).toBeVisible();
        await expect(pill(page)).toHaveClass(/evidence-pill--no-hide/);
        await expect(hide(page)).toBeHidden();
        await expect(page.locator('#fan-chart .fan-sector--off')).toHaveCount(0);
        // Anton drawn in the fan, only dimmed.
        await expect(page.locator('#fan-chart [data-fan-person="o1"]')).toHaveCount(1);
        await expect(page.locator('#fan-chart [data-fan-person="o1"]')).toHaveClass(/evidence-dim/);

        await page.locator('#view-mode-family').click();
        await expect(hide(page)).toBeVisible();
        await expect(hide(page)).toHaveAttribute('aria-pressed', 'true');
        await expect(pill(page)).not.toHaveClass(/evidence-pill--no-hide/);
        await expect(page.locator('#tree-canvas .person-card[data-id="o1"]')).toHaveCount(0);
    });
});
