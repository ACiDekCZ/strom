/**
 * The window's selection chosen from one list (spec 098 §2, §10): the
 * sections, the search over lines and people (without diacritics, Enter on
 * the first), a list of people highlighting its cards, the ancestors with the
 * generations' stepper, Save the selection as a list, the person menu's
 * Select › Ancestors, a tree without lines, and on a phone More → Selection
 * as a sheet. Invented names only (e2e/rods-fixture.ts).
 */

import { test, expect, Page, Locator } from '@playwright/test';
import { openApp, card } from './helpers.js';
import { rodsTree, subTree } from './rods-fixture.js';

async function setup(page: Page, focus = 'b16', tree = rodsTree()): Promise<void> {
    await openApp(page);
    await page.evaluate(async ([data, f]) => {
        const S = window.Strom;
        await S.DataManager.importAsNewTree(data, 'Brandvold');
        S.UI.updateTreeSwitcher?.();
        S.TreeRenderer.setFocus(f as never);
        await S.TreeRenderer.renderAsync();
    }, [tree, focus] as const);
}

const host = (page: Page): Locator => page.locator('#view-rod-picker');
const pill = (page: Page): Locator => page.locator('#evidence-pill');
const heads = (scope: Locator): Promise<string[]> => scope.locator('.sp-selpick-sh:visible > span').allTextContents();

async function openPicker(page: Page): Promise<Locator> {
    await host(page).locator('.sp-rodpick-btn').click();
    const pop = host(page).locator('.sp-rodpick-pop');
    await expect(pop).toBeVisible();
    return pop;
}

test.describe('the window\'s selection on a computer', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the sections; a search finds lines and people without diacritics, Enter picks the first @smoke', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => {
            window.Strom.DataManager.createPersonList({ name: 'Letters to write', dynamic: false, personIds: ['b14', 'b15'] as never[], sort: 'manual' });
        });
        const pop = await openPicker(page);
        await expect(pop.locator('.sp-rodpick-tree')).toContainText('No selection');
        expect(await heads(pop)).toEqual(['Family lines', 'Ancestors and descendants', 'Lists of people']);
        await expect(pop.locator('li[data-sec="focus"][data-sel^="anc:"]')).toContainText('Ancestors: Mikael');
        await expect(pop.locator('li.sp-selpick-row[data-sec="lists"]', { hasText: 'Letters to write' })).toBeVisible();
        await expect(pop.locator('.sp-selpick-manage')).toBeVisible();
        // Nothing chosen: nothing to save.
        await expect(pop.locator('.sp-selpick-save')).toHaveCount(0);

        const q = pop.locator('.sp-rodpick-q');
        await q.fill('holl');
        await expect(pop.locator('li.sp-rodpick-rod:visible')).toHaveText([/Hollberg/]);
        await expect(pop.locator('.sp-rodpick-tree')).toBeHidden();
        // People: at most five, each with Ancestors and Descendants.
        await expect(pop.locator('li[data-found]')).toHaveCount(10);
        await expect(pop.locator('li.sp-selpick-none[data-sec="lists"]')).toHaveText('No list of that name.');

        await q.fill('sjoquist');
        await expect(pop.locator('li[data-found]')).toHaveCount(2);
        await expect(pop.locator('li[data-found]').first()).toContainText('Kerstin');
        await expect(pop.locator('li.sp-selpick-none[data-sec="rods"]')).toHaveText('No line of that name.');
        await expect(pop.locator('button.sp-rodpick-first')).toContainText('Ancestors: Kerstin');
        await q.press('Enter');
        await expect(pop).toBeHidden();
        await expect(pill(page).locator('.evidence-pill-label--pick')).toContainText('Kerstin');
        await expect(host(page).locator('.sp-rodpick-btn')).toContainText('Kerstin');
    });

    test('a list of people highlights its cards; the list is not offered to be saved again', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => {
            window.Strom.DataManager.createPersonList({ name: 'Letters to write', dynamic: false, personIds: ['b14', 'b15'] as never[], sort: 'manual' });
        });
        const pop = await openPicker(page);
        await pop.locator('li.sp-selpick-row[data-sec="lists"]', { hasText: 'Letters to write' }).locator('button').click();
        await expect(pill(page).locator('.evidence-pill-label--pick')).toContainText('Letters to write');
        await expect(page.locator('#tree-canvas .person-card.evidence-hit[data-id="b14"]')).toBeVisible();
        await expect(page.locator('#tree-canvas .person-card.evidence-hit[data-id="b16"]')).toHaveCount(0);
        await openPicker(page);
        await expect(host(page).locator('li[data-sec="lists"][aria-current]')).toContainText('Letters to write');
        await expect(host(page).locator('.sp-selpick-save')).toHaveCount(0);
        // No selection again.
        await host(page).locator('.sp-rodpick-tree button').click();
        await expect(pill(page)).toBeHidden();
    });

    test('the ancestors: the block with the person and the generations; Save the selection as a list', async ({ page }) => {
        await setup(page);
        let pop = await openPicker(page);
        await pop.locator('li[data-sec="focus"][data-sel^="anc:"] button').click();
        await expect(pill(page).locator('.evidence-pill-label--pick')).toContainText('Ancestors: Mikael');

        pop = await openPicker(page);
        const block = pop.locator('.sp-selpick-cur');
        await expect(block).toContainText('Window selection');
        await expect(block.locator('b')).toContainText('Mikael');
        const value = block.locator('.depth-stepper-value');
        await expect(value).toHaveText('all');
        await expect(block.locator('button[data-gen="1"]')).toBeDisabled();
        await block.locator('button[data-gen="-1"]').click();
        await expect(value).toHaveText('10');
        await expect(pop).toBeVisible();
        for (let i = 0; i < 9; i++) await block.locator('button[data-gen="-1"]').click();
        await expect(value).toHaveText('1');
        await expect(block.locator('button[data-gen="-1"]')).toBeDisabled();
        // One generation: Mikael and his parents.
        await expect(block.locator('.sp-selpick-cur-c')).toHaveText('· 3 people');
        await block.locator('button[data-gen="1"]').click();
        await expect(value).toHaveText('2');

        // "Change…" offers another person.
        await block.locator('.sp-selpick-change').click();
        await expect(page.locator('.tov-pop')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.tov-pop')).toHaveCount(0);

        await pop.locator('.sp-selpick-save').click();
        await expect(pop).toBeHidden();
        const dialog = page.locator('.pln-modal');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('#pln-name')).toHaveValue(/^Ancestors – Mikael/);
    });

    test('the person menu: Select › Ancestors; Clear the selection', async ({ page }) => {
        await setup(page);
        await card(page, 'Mikael').click();
        const menu = page.locator('.context-menu.person-menu');
        await menu.locator('[data-menu="select"]').click();
        const sub = page.locator('.context-submenu');
        await expect(sub.locator('[data-action^="select:rod:"]')).toContainText('Brandvold line');
        const anc = sub.locator('[data-action^="select:anc:"]');
        await expect(anc).toHaveText(/Ancestors/);
        await expect(sub.locator('[data-action^="select:des:"]')).toHaveCount(0);
        await anc.click();
        await expect(pill(page).locator('.evidence-pill-label--pick')).toContainText('Ancestors: Mikael');
        await card(page, 'Mikael').click();
        await menu.locator('[data-action="select-clear"]').click();
        await expect(pill(page)).toBeHidden();
    });

    test('a tree without family lines: the choice is offered without the section', async ({ page }) => {
        await setup(page, 'o2', subTree(rodsTree(), ['o1', 'o1w', 'o2'], 'o2'));
        await expect(host(page)).toBeVisible();
        await expect(host(page).locator('.sp-rodpick-btn')).toHaveText(/^Selection/);
        const pop = await openPicker(page);
        expect(await heads(pop)).toEqual(['Ancestors and descendants', 'Lists of people']);
        await expect(pop.locator('li[data-sec="focus"][data-sel^="anc:"]')).toContainText('Ancestors: Albin');
    });
});

test.describe('the window\'s selection on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('More → Selection opens the sheet with the sections; a pick closes it', async ({ page }) => {
        await setup(page);
        await page.locator('#bb-view-more').click();
        const row = page.locator('#sheet-rod');
        await expect(row.locator('.more-rod-row-value')).toHaveText('No selection');
        await row.click();
        const sheet = page.locator('.rod-pick-sheet');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('.rod-pick-sheet-title')).toHaveText('Selection');
        expect(await heads(sheet)).toEqual(['Family lines', 'Ancestors and descendants', 'Lists of people']);
        const anc = sheet.locator('li[data-sec="focus"][data-sel^="anc:"] button');
        expect((await anc.boundingBox())!.height).toBeGreaterThanOrEqual(51.5);
        expect((await sheet.locator('.sp-selpick-manage').boundingBox())!.height).toBeGreaterThanOrEqual(47.5);
        await anc.click();
        await expect(sheet).toHaveCount(0);
        await expect(pill(page).locator('.evidence-pill-label--pick')).toContainText('Mikael');
        // The pill's label opens the sheet again with the block on top.
        await pill(page).locator('.evidence-pill-label--pick').click();
        await expect(page.locator('.rod-pick-sheet .sp-selpick-cur')).toBeVisible();
        const dec = page.locator('.rod-pick-sheet .sp-selpick-cur button[data-gen="-1"]');
        expect((await dec.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    });
});
