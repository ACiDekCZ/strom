/**
 * The "Family line" row at a person (package 1031 §3): the last row of the
 * person card's header and of the person page's facts, the lineage names
 * opening the tree overview at that lineage, the card's ⋯ menu (enabled in
 * an open tree, Edit and Start disabled in a followed one) and no row for a
 * person without a lineage. Invented names only (e2e/rods-fixture.ts).
 */

import { test, expect, Page, Locator } from '@playwright/test';
import { openApp } from './helpers';
import { rodsTree, RodsTree } from './rods-fixture';

/** The Brandvold tree, plus Tora Ekdahl: one person alone, no lineage. */
function tree(): RodsTree {
    const t = rodsTree();
    t.persons.z1 = {
        id: 'z1', firstName: 'Tora', lastName: 'Ekdahl', gender: 'female', isPlaceholder: false,
        birthDate: '1901', partnerships: [], parentIds: [], childIds: [],
    };
    return t;
}

async function setup(page: Page, width = 1440, height = 900): Promise<string> {
    await page.setViewportSize({ width, height });
    await openApp(page);
    return page.evaluate(async (data) => {
        const S = window.Strom;
        const id = await S.DataManager.importAsNewTree(data, 'Brandvold');
        S.UI.updateTreeSwitcher?.();
        S.TreeRenderer.setFocus(data.defaultPersonId);
        await S.TreeRenderer.renderAsync();
        return id as string;
    }, tree());
}

async function openCard(page: Page, id: string): Promise<Locator> {
    await page.evaluate((pid) => window.Strom.UI.showEditPersonModal(pid as never), id);
    await expect(page.locator('#person-modal')).toHaveClass(/active/);
    return page.locator('#pm-rod');
}

const rods = (page: Page): Locator => page.locator('#tree-overview-modal .tov-sec[data-section="rods"]');

test.describe('person family line row', () => {
    test('the card: the row per case, a name opens the overview at that lineage @smoke', async ({ page }) => {
        await setup(page);
        let row = await openCard(page, 'b16');
        await expect(row).toBeVisible();
        await expect(row.locator('.pm-rod-label')).toHaveText('Family line');
        await expect(row.locator('.pm-rod-value')).toHaveText('Brandvold');

        // A daughter of a line married into another: her line and "married into".
        await page.evaluate(() => window.Strom.UI.forceCloseModal());
        row = await openCard(page, 'b4');
        await expect(row.locator('.pm-rod-value')).toHaveText('Brandvold · married into Tallqvist');

        // A wife without parents recorded: wife in the line, no birth line.
        await page.evaluate(() => window.Strom.UI.forceCloseModal());
        row = await openCard(page, 'b2w');
        await expect(row.locator('.pm-rod-value')).toHaveText('wife in Brandvold line');

        // A wife from a small family: both names are links.
        await page.evaluate(() => window.Strom.UI.forceCloseModal());
        row = await openCard(page, 'b12w');
        await expect(row.locator('.pm-rod-value')).toHaveText('wife in Brandvold line · born into Ostrander');
        await expect(row.locator('.pm-rod-link')).toHaveText(['Brandvold', 'Ostrander']);

        // The small family: Other families open, the family marked; the card closed.
        await row.locator('.pm-rod-link', { hasText: 'Ostrander' }).click();
        await expect(page.locator('#person-modal')).not.toHaveClass(/active/);
        await expect(rods(page).locator('.tov-rod-other')).toHaveAttribute('aria-expanded', 'true');
        await expect(rods(page).locator('.tov-rod-small-item.is-marked')).toContainText('Ostrander');
        await page.keyboard.press('Escape');
        await expect(page.locator('#tree-overview-modal')).toHaveCount(0);

        // A lineage over the threshold: its detail expanded.
        row = await openCard(page, 'b12w');
        await row.locator('.pm-rod-link', { hasText: 'Brandvold' }).click();
        await expect(rods(page).locator('.tov-rod.is-open .tov-rod-label')).toHaveText('Brandvold');
    });

    test('no lineage, no row; a new person has none either', async ({ page }) => {
        await setup(page);
        const row = await openCard(page, 'z1');
        await expect(row).toBeHidden();
        await expect(row.locator('.pm-rod-link')).toHaveCount(0);
    });

    test('the ⋯ menu: its four actions, Escape closes only the menu, Show in tree highlights the line', async ({ page }) => {
        await setup(page);
        const row = await openCard(page, 'b16');
        const more = row.locator('.pm-rod-more-btn');
        await expect(more).toHaveAttribute('aria-label', 'Family line actions');
        await more.click();
        const menu = row.locator('.pm-rod-menu');
        await expect(menu).toBeVisible();
        await expect(more).toHaveAttribute('aria-expanded', 'true');
        await expect(menu.getByRole('menuitem')).toHaveText([
            'Show family line in tree', 'Edit family line…', 'Start a family line from this person…', 'Family line book…',
        ]);
        await expect(menu.locator('[aria-disabled="true"]')).toHaveCount(0);
        await expect(menu.locator('.pm-rod-menu-note')).toHaveCount(0);
        await expect(menu.getByRole('menuitem').first()).toBeFocused();

        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();
        await expect(page.locator('#person-modal')).toHaveClass(/active/);
        await expect(more).toBeFocused();

        // A click elsewhere closes it too.
        await more.click();
        await expect(menu).toBeVisible();
        await page.locator('#pm-name').click();
        await expect(menu).toBeHidden();

        await more.click();
        await menu.getByRole('menuitem', { name: 'Show family line in tree' }).click();
        await expect(page.locator('#person-modal')).not.toHaveClass(/active/);
        await expect(page.locator('#evidence-pill')).toContainText('Brandvold family line: 16 people');
        await expect(page.locator('.person-card[data-id="b16"]')).toHaveClass(/evidence-hit/);
        await expect(page.locator('.person-card[data-id="b14w"]')).toHaveClass(/evidence-faint/);
    });

    test('a followed tree: Edit and Start disabled with the hint; Show and Book stay', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.DataManager.setLiveTree(window.Strom.DataManager.getCurrentTreeId()));
        const row = await openCard(page, 'b16');
        await row.locator('.pm-rod-more-btn').click();
        const menu = row.locator('.pm-rod-menu');
        const hint = 'A followed tree is read-only. The family line can be viewed, not edited.';
        await expect(menu.locator('[data-rod-act="edit"]')).toHaveAttribute('aria-disabled', 'true');
        await expect(menu.locator('[data-rod-act="split"]')).toHaveAttribute('aria-disabled', 'true');
        await expect(menu.locator('[data-rod-act="edit"]')).toHaveAttribute('title', hint);
        await expect(menu.locator('[data-rod-act="show"]')).not.toHaveAttribute('aria-disabled', 'true');
        await expect(menu.locator('[data-rod-act="book"]')).not.toHaveAttribute('aria-disabled', 'true');
        await expect(menu.locator('.pm-rod-menu-note')).toHaveText(hint);
        // A disabled item does nothing: the menu and the card stay.
        await menu.locator('[data-rod-act="edit"]').click({ force: true });
        await expect(menu).toBeVisible();
        await expect(page.locator('#person-modal')).toHaveClass(/active/);
    });

    test('the person page: the last fact, a name opens the overview at that lineage', async ({ page }) => {
        await setup(page);
        await page.evaluate(() => window.Strom.UI.showPersonPage('b12w' as never));
        const win = page.locator('#person-page-modal');
        const dd = win.locator('.pp-facts dd.pp-fact-rod');
        await expect(win.locator('.pp-facts dt').last()).toHaveText('Family line');
        await expect(dd).toHaveText('wife in Brandvold line · born into Ostrander');
        await expect(dd.locator('[data-pp-rod]')).toHaveText(['Brandvold', 'Ostrander']);
        await dd.locator('[data-pp-rod]', { hasText: 'Brandvold' }).click();
        await expect(rods(page).locator('.tov-rod.is-open .tov-rod-label')).toHaveText('Brandvold');
        await expect(page.locator('#person-page-modal')).toHaveCount(0);
    });

    test('phone: the card row wraps under its label, nothing overflows', async ({ page }) => {
        await setup(page, 390, 844);
        const row = await openCard(page, 'b12w');
        await expect(row).toBeVisible();
        const box = await row.evaluate((el) => {
            const label = el.querySelector('.pm-rod-label')!.getBoundingClientRect();
            const value = el.querySelector('.pm-rod-value')!.getBoundingClientRect();
            return { above: label.bottom <= value.top + 1, overflow: el.scrollWidth > el.clientWidth };
        });
        expect(box).toEqual({ above: true, overflow: false });
    });
});
