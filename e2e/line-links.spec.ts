import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { openApp } from './helpers.js';

/**
 * Line links: a parent-child line the layout cannot draw without crossing
 * another family's line is left out (step 7), and the cards link to each
 * other instead — the child's card a "parents ↗" branch tab, each parent's
 * card a "child ↗" one. A click (or Enter) brings the other end into view
 * and highlights it; the focus stays. Etalon J (the in-law loop, invented
 * data), focus on the focus's child: the line of the partner's parents to
 * the partner's sibling is the one left out.
 */

const CHILD = 'eJ_partner_sib';
const PARENTS = ['eJ_p_fa', 'eJ_p_mo'];
const FOCUS = 'eJ_focus_kid';

const cardOf = (page: Page, id: string) => page.locator(`#tree-canvas .person-card[data-id="${id}"]`);

async function setup(page: Page): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    const data = JSON.parse(readFileSync(join(process.cwd(), 'test', 'etalon-inlaw-loop.json'), 'utf-8'));
    await page.evaluate(async ([tree, focus]) => {
        await window.Strom.DataManager.importAsNewTree(tree as never, 'Etalon J');
        window.Strom.TreeRenderer.setFocus(focus as never);
    }, [data, FOCUS] as const);
    await expect(cardOf(page, CHILD)).toBeVisible();
}

/** Whether a card lies wholly inside the tree's viewport. */
async function inView(page: Page, id: string): Promise<boolean> {
    return page.evaluate(cardId => {
        const c = document.querySelector(`#tree-canvas .person-card[data-id="${cardId}"]`)!.getBoundingClientRect();
        const v = document.getElementById('tree-container')!.getBoundingClientRect();
        return c.left >= v.left && c.right <= v.right && c.top >= v.top && c.bottom <= v.bottom;
    }, id);
}

/** Zoom in on one card, so the other end of its link is out of view. */
async function zoomOnto(page: Page, id: string): Promise<void> {
    await page.evaluate(cardId => window.Strom.ZoomPan.glideToPerson(cardId as never, 2.5, 0), id);
    await expect.poll(() => page.evaluate(() => window.Strom.ZoomPan.getScale())).toBeCloseTo(2.5, 1);
}

test('the left-out line: tabs on both ends, a jump that keeps the focus', async ({ page }) => {
    await setup(page);
    // The child's tab names its parents, each parent's tab names the child
    const toParents = cardOf(page, CHILD).locator('.edge-top-right .branch-tab.line-link[data-action="jump-parents"]');
    await expect(toParents).toHaveCount(1);
    await expect(toParents.locator('.pill-text')).toHaveText('parents ↗');
    await expect(toParents).toHaveAttribute('aria-label', /^Parents stand elsewhere in the tree: /);
    for (const id of PARENTS) {
        const toChild = cardOf(page, id).locator('.branch-tab.line-link[data-action="jump-child"]');
        await expect(toChild.locator('.pill-text')).toHaveText('child ↗');
    }

    // Click on the child's tab: both parents come into view, highlighted
    await zoomOnto(page, CHILD);
    expect(await inView(page, PARENTS[0]) && await inView(page, PARENTS[1])).toBe(false);
    await toParents.click();
    for (const id of PARENTS) {
        await expect(cardOf(page, id)).toHaveClass(/highlighted/);
        expect(await inView(page, id)).toBe(true);
    }
    expect(await page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId())).toBe(FOCUS);

    // From the keyboard on a parent's card: the child is centred and highlighted
    await zoomOnto(page, PARENTS[1]);
    expect(await inView(page, CHILD)).toBe(false);
    const toChild = cardOf(page, PARENTS[1]).locator('.branch-tab.line-link');
    await toChild.focus();
    await expect(toChild.locator('.badge-tooltip')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(cardOf(page, CHILD)).toHaveClass(/highlighted/);
    expect(await inView(page, CHILD)).toBe(true);
    expect(await page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId())).toBe(FOCUS);
    // The card's own menu did not open
    await expect(page.locator('#context-menu')).toBeHidden();
});

test('the poster labels both ends of the left-out line, without the arrow', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => window.Strom.UI.showPosterDialog());
    const poster = page.locator('#poster-modal');
    await expect(poster).toBeVisible();
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        poster.getByRole('button', { name: /SVG/ }).click(),
    ]);
    const svg = readFileSync(await download.path(), 'utf-8');
    expect(svg).toContain(`<g class="line-link-pill" data-person="${CHILD}"`);
    for (const id of PARENTS) expect(svg).toContain(`<g class="line-link-pill" data-person="${id}"`);
    expect(svg).toMatch(/>parents: [^<]+</);
    expect(svg).toMatch(/>child: [^<]+</);
    expect(svg).not.toContain('↗');
});
