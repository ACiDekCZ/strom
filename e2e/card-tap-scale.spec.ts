import { test, expect, Page, Locator } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { openApp } from './helpers.js';

/**
 * A tap on a card by touch is the card's (GitHub #4): its person sheet, at
 * any zoom, also beside the pills on the card's edges (branch tabs, line
 * links, the dashed "▸ parents", "▸ ∞" other partners). The browser
 * moves a finger's tap onto the nearest button within the finger's area
 * (touch adjustment), and the card holding the pills was never a candidate:
 * zoomed out to 0.3 a tap in the middle of the 56 × 19 px card hid its
 * shown children or set the focus. A pill takes the taps beside it off the
 * card and, from 0.6 on, the ones on itself; a tap on the card beside it (and
 * zoomed out, on its few pixels over the card) stays the card's (src/card-tap.ts).
 * Invented fixtures only.
 */

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const cardOf = (page: Page, id: string) => page.locator(`#tree-canvas .person-card[data-id="${id}"]`);

async function setupFixture(page: Page, fixture: string, focus: string): Promise<void> {
    await openApp(page);
    const data = JSON.parse(readFileSync(join(process.cwd(), 'test', `${fixture}.json`), 'utf-8'));
    await page.evaluate(async ([tree, f]) => {
        await window.Strom.DataManager.importAsNewTree(tree as never, 'Taps');
        await window.Strom.TreeRenderer.setFocus(f as never);
    }, [data, focus] as const);
    await expect(cardOf(page, focus)).toBeVisible();
}

/** Show a person's children in place by its tab (a tap at the readable zoom). */
async function showChildren(page: Page, id: string): Promise<void> {
    await page.evaluate(pid => window.Strom.ZoomPan.glideToPerson(pid as never, 1, 0), id);
    const before = await page.evaluate(() => window.Strom.TreeRenderer.shownChildrenCount());
    await cardOf(page, id).locator('.edge-top-right .branch-tab.children-tab').tap();
    await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.shownChildrenCount())).toBe(before + 1);
}

async function zoomTo(page: Page, id: string, scale: number): Promise<void> {
    await page.evaluate(([pid, s]) => window.Strom.ZoomPan.glideToPerson(pid as never, s as number, 0), [id, scale] as const);
    await expect.poll(() => page.evaluate(() => window.Strom.ZoomPan.getScale())).toBeCloseTo(scale, 2);
}

/** What a tap changed: the focus, the children shown, the zoom and the open sheet's person. */
async function state(page: Page): Promise<{ focus: string | null; shown: number; scale: number; sheet: string | null }> {
    return page.evaluate(() => ({
        focus: window.Strom.TreeRenderer.getFocusPersonId() as string | null,
        shown: window.Strom.TreeRenderer.shownChildrenCount(),
        scale: Math.round(window.Strom.ZoomPan.getScale() * 1000) / 1000,
        sheet: document.querySelector('.bottom-sheet-person')?.getAttribute('aria-label') ?? null,
    }));
}

async function nameOf(page: Page, id: string): Promise<string> {
    return page.evaluate(pid => window.Strom.DataManager.getPerson(pid as never)!.firstName, id);
}

/**
 * The point on the card beside a pill: zoomed out, on the pill's part over
 * the card (a few pixels, the card's); from 0.6 on, 3 px inside the card
 * past the pill's inner edge.
 */
async function pointsBeside(card: Locator, pill: Locator, scale: number): Promise<Array<{ x: number; y: number }>> {
    const c = (await card.boundingBox())!;
    const p = (await pill.boundingBox())!;
    const x = Math.min(Math.max(p.x + p.width / 2, c.x + 2), c.x + c.width - 2) - c.x;
    const top = p.y + p.height / 2 < c.y + c.height / 2;
    if (scale < 0.6) return [{ x, y: top ? 1.5 : c.height - 1.5 }];
    return [{ x, y: top ? p.y + p.height - c.y + 3 : p.y - c.y - 3 }];
}

/** Tap the card in the middle and beside each pill: each time the card's sheet, nothing else changes. */
async function expectCardTaps(page: Page, id: string, pills: string[], scale: number): Promise<void> {
    await zoomTo(page, id, scale);
    const card = cardOf(page, id);
    const name = await nameOf(page, id);
    const before = await state(page);
    const box = (await card.boundingBox())!;
    const spots: Array<{ label: string; x: number; y: number }> = [{ label: 'middle', x: box.width / 2, y: box.height / 2 }];
    for (const sel of pills) {
        const pill = card.locator(sel);
        await expect(pill, `${id} ${sel}`).toHaveCount(1);
        for (const pt of await pointsBeside(card, pill, scale)) spots.push({ label: sel, ...pt });
    }
    for (const spot of spots) {
        await card.tap({ position: { x: spot.x, y: spot.y } });
        const label = `${id} at ${scale}, ${spot.label} (${spot.x.toFixed(1)}, ${spot.y.toFixed(1)})`;
        await expect.poll(async () => (await state(page)).sheet, label).toContain(name);
        expect(await state(page), label).toEqual({ ...before, sheet: expect.stringContaining(name) });
        await page.evaluate(() => window.Strom.UI.hideBottomSheet());
        await expect(page.locator('.bottom-sheet-person')).toHaveCount(0);
    }
}

for (const scale of [0.3, 0.5, 1]) {
    test.describe(`zoomed to ${scale}`, () => {
        test('an ancestor with children shown: a tap on the card opens its sheet, in the middle and beside its tabs', async ({ page }) => {
            // comprehensive: the father of the focus's parent, "▸ siblings" (his parents in view) and "▾ children"
            await setupFixture(page, 'comprehensive', 'grandchild_1');
            await showChildren(page, 'father');
            await expectCardTaps(page, 'father', ['.branch-tab.siblings-tab', '.branch-tab.children-tab.active'], scale);
            // A grandfather with another partner (no children) on the bottom edge: "▸ ∞ 1"
            await setupFixture(page, 'edge-childless-partners', 'f');
            await expectCardTaps(page, 'gf', ['.hidden-partners-btn'], scale);
        });

        test('line links: a tap on the card beside "child ↗" or "parents ↗" is the card\'s', async ({ page }) => {
            await setupFixture(page, 'edge-children-elsewhere', 'focus');
            await expectCardTaps(page, 'v_mo', ['.branch-tab.children-tab', '.branch-tab.line-link[data-action="jump-child"]'], scale);
            await expectCardTaps(page, 'aunt', ['.branch-tab.line-link[data-action="jump-parents"]'], scale);
        });

        test('the dashed "▸ parents": a tap on the card beside it is the card\'s', async ({ page }) => {
            await setupFixture(page, 'edge-ancestor-inner-siblings', 'focus');
            await showChildren(page, 'f_m_f');
            await expectCardTaps(page, 'f_f', ['.branch-tab.folded'], scale);
        });
    });
}

test.describe('at 1 the pills work by touch', () => {
    /**
     * Tap a pill on its middle, on its part over the card, 6 px off the card
     * past its outer edge, or 15 px past it (§6: the pill stays 18 px, its
     * touch area reaches 44 px beyond the card).
     */
    async function tapPill(page: Page, pill: Locator, where: 'middle' | 'inner' | 'outside' | 'far'): Promise<void> {
        const p = (await pill.boundingBox())!;
        const card = (await pill.locator('xpath=ancestor::div[contains(@class, "person-card")][1]').boundingBox())!;
        const top = p.y + p.height / 2 < card.y + card.height / 2;
        const y = where === 'middle' ? p.y + p.height / 2
            : where === 'inner' ? (top ? p.y + p.height - 3 : p.y + 3)
            : where === 'outside' ? (top ? p.y - 6 : p.y + p.height + 6)
            : top ? p.y - 15 : p.y + p.height + 15;
        await page.touchscreen.tap(p.x + p.width / 2, y);
    }

    for (const where of ['middle', 'inner', 'outside', 'far'] as const) {
        const words = { middle: 'on', inner: 'on the part over the card of', outside: 'just off the card beside', far: '15 px off the card beside' }[where];
        test(`a tap ${words} each tab does what the tab does`, async ({ page }) => {
            await setupFixture(page, 'comprehensive', 'grandchild_1');
            await showChildren(page, 'father');
            // "▾ children" hides them
            await zoomTo(page, 'father', 1);
            await tapPill(page, cardOf(page, 'father').locator('.branch-tab.children-tab'), where);
            await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.shownChildrenCount())).toBe(0);
            await expect(page.locator('.bottom-sheet-person')).toHaveCount(0);
            // "▸ siblings" shows the father's siblings in place (his parents' children, one step)
            await zoomTo(page, 'father', 1);
            await tapPill(page, cardOf(page, 'father').locator('.branch-tab.siblings-tab'), where);
            await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.isSiblingsShown('father' as never))).toBe(true);
            await expect(page.locator('.bottom-sheet-person')).toHaveCount(0);

            // "child ↗" jumps to the child drawn elsewhere: the view moves, no sheet
            await setupFixture(page, 'edge-children-elsewhere', 'focus');
            await zoomTo(page, 'v_mo', 1);
            const at = await cardOf(page, 'v_mo').boundingBox();
            await tapPill(page, cardOf(page, 'v_mo').locator('.branch-tab.line-link[data-action="jump-child"]'), where);
            await expect.poll(async () => (await cardOf(page, 'v_mo').boundingBox())?.x).not.toBe(at!.x);
            await expect(page.locator('.bottom-sheet-person')).toHaveCount(0);
            // "▸ ∞" (bottom edge) shows the other partners in place, the focus stays
            await setupFixture(page, 'edge-childless-partners', 'f');
            await zoomTo(page, 'gf', 1);
            await tapPill(page, cardOf(page, 'gf').locator('.hidden-partners-btn'), where);
            await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.isPartnersShown('gf' as never))).toBe(true);
            expect(await page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId())).toBe('f');
            await expect(page.locator('.bottom-sheet-person')).toHaveCount(0);

            // The dashed "▸ parents" hides the children that folded them
            await setupFixture(page, 'edge-ancestor-inner-siblings', 'focus');
            await showChildren(page, 'f_m_f');
            await zoomTo(page, 'f_f', 1);
            await tapPill(page, cardOf(page, 'f_f').locator('.branch-tab.folded'), where);
            await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.shownChildrenCount())).toBe(0);
        });
    }
});
