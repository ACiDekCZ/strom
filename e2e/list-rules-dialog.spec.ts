/**
 * The custom rule of a list (spec 136 §1, §2, §5): the last tile Custom rule
 * opens the builder; two conditions put into a group of "any applies" and an
 * except at the end of the rule give the people in the footer's count; the
 * list keeps the rule (`custom`) and Edit the rule opens the same builder.
 * "More options: family of a person…" gives one Family of a person, which is
 * saved as the tile's rule. Closing an unfinished rule asks first. The phone:
 * the builder fits the screen with 44 px targets. Invented names only; the
 * clock is fixed.
 */

import { test, expect, Page } from '@playwright/test';
import { openApp, seedTree } from './helpers';

const NOW = new Date('2026-11-16T10:30:00Z');

async function family(page: Page): Promise<void> {
    await page.clock.setFixedTime(NOW);
    await openApp(page);
    await seedTree(page, {
        t: { firstName: 'Tobiah', lastName: 'Quellmayer', parents: ['r', 's'], birthDate: '1945' },
        o: { firstName: 'Oswin', lastName: 'Quellmayer', partners: ['h'], birthDate: '1880', deathDate: '1950' },
        h: { firstName: 'Hedla', lastName: 'Ostrovid', gender: 'female', partners: ['o'], birthDate: '1885', deathDate: '1960' },
        r: { firstName: 'Ruprecht', lastName: 'Quellmayer', parents: ['o', 'h'], partners: ['s'], birthDate: '1912', deathDate: '1990' },
        s: { firstName: 'Selka', lastName: 'Talvanen', gender: 'female', partners: ['r'], birthDate: '1915', deathDate: '1995' },
        m: { firstName: 'Mirella', lastName: 'Quellmayer', gender: 'female', parents: ['r', 's'], birthDate: '1940' },
        v: { firstName: 'Vilma', lastName: 'Quellmayer', gender: 'female', parents: ['t'], birthDate: '2001' },
        k: { firstName: 'Kasimir', lastName: 'Quellmayer', parents: ['t'], birthDate: '2003' },
    }, 'Quellmayer', 't');
}

const lists = (page: Page) => page.locator('#person-lists-modal');
const form = (page: Page) => page.locator('#person-list-new');
const tile = (page: Page, opt: string) => form(page).locator(`.pln-opt[data-opt="${opt}"]`);
const row = (page: Page, path: string) => form(page).locator(`.plr-row[data-path="${path}"]`);
const menu = (page: Page) => page.locator('.plr-menu');

async function openNew(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showPersonLists());
    await lists(page).locator('.pl-new').first().click();
    await expect(form(page)).toBeVisible();
}

/** Add a condition from the catalog into the group at `group` ('' = the rule). */
async function addCond(page: Page, group: string, c: string): Promise<void> {
    const add = group === '' ? form(page).locator('.plr > .plr-add [data-rb="add"]')
        : row(page, group).locator('> .plr-kids > .plr-add [data-rb="add"]');
    await add.click();
    await menu(page).locator(`.pl-menu-item[data-id="${c}"]`).click();
    await expect(menu(page)).toHaveCount(0);
}

async function rowAction(page: Page, path: string, id: string): Promise<void> {
    await row(page, path).locator('> .plr-d').click();
    await menu(page).locator(`.pl-menu-item[data-id="${id}"]`).click();
}

const customOf = (page: Page, name: string) => page.evaluate((n) => {
    const l = window.Strom.DataManager.getPersonLists().find(x => x.name === n);
    return l ? { id: l.id, rule: l.rule ?? null, custom: l.custom ?? null } : null;
}, name);

test.describe('Custom rule: a computer', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('two conditions in a group of "any", an except, saved as the list\'s rule and opened again the same', async ({ page }) => {
        await family(page);
        await openNew(page);
        const f = form(page);
        await f.locator('#pln-name').fill('Chosen Quellmayers');
        await tile(page, 'custom').locator('.pln-opt-label').click();
        await expect(f.locator('.pln-modal')).toHaveClass(/pln-modal--rule/);
        await expect(f.locator('.pln-bybtn')).toContainText('Custom rule');
        await expect(f.locator('.pln-total')).toHaveText('No condition yet');
        await expect(f.locator('[data-act="create"]')).toBeDisabled();
        await expect(f.locator('[data-act="create"]')).toHaveAttribute('title', 'No condition yet');

        // Women; then born 1900–1999 (an incomplete period first: Create waits).
        await addCond(page, '', 'gender');
        await expect(row(page, '0').locator('button[data-pc="value"][data-v="female"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(f.locator('.pln-total')).toHaveText('4 people match');
        await addCond(page, '', 'born');
        await expect(row(page, '1').locator('input[data-pc="from"]')).toBeFocused();
        await expect(f.locator('[data-act="create"]')).toBeDisabled();
        await row(page, '1').locator('input[data-pc="from"]').fill('1900');
        await row(page, '1').locator('input[data-pc="to"]').fill('1999');
        await row(page, '1').locator('input[data-pc="to"]').press('Enter');
        await expect(f.locator('.pln-total')).toHaveText('2 people match');
        await expect(f.locator('[data-act="create"]')).toBeEnabled();

        // The two into a group, "any applies".
        await rowAction(page, '0', 'group');
        await expect(row(page, '0')).toHaveClass(/plr-grp/);
        await expect(row(page, '0.1').locator('input[data-pc="from"]')).toHaveValue('1900');
        await row(page, '0').locator('[data-rb="op"][data-op="any"]').first().click();
        await expect(row(page, '0').locator('[data-rb="op"][data-op="any"]').first()).toHaveAttribute('aria-pressed', 'true');
        await expect(f.locator('.pln-total')).toHaveText('6 people match');

        // Except the deceased: the first item cannot be an except, the second can.
        await addCond(page, '', 'alive');
        await row(page, '1').locator('button[data-pc="value"][data-v="deceased"]').click();
        await row(page, '0.0').locator('> .plr-d').click();
        await expect(menu(page).locator('.pl-menu-item[data-id="except"]')).toHaveAttribute('aria-disabled', 'true');
        await page.keyboard.press('Escape');
        await expect(menu(page)).toHaveCount(0);
        await expect(f).toBeVisible();
        await rowAction(page, '1', 'except');
        await expect(row(page, '1')).toHaveAttribute('data-not', '1');
        await expect(row(page, '1').locator('> .plr-c')).toHaveClass(/ex/);
        await expect(f.locator('.pln-total')).toHaveText('3 people match');

        await f.locator('[data-act="create"]').click();
        await expect(f).toHaveCount(0);
        await expect(lists(page).locator('.pl-name')).toHaveText('Chosen Quellmayers');
        const names = lists(page).locator('.pl-person .pl-pname');
        await expect(names).toHaveCount(3);
        for (const n of ['Mirella', 'Tobiah', 'Vilma']) await expect(names.filter({ hasText: n })).toHaveCount(1);
        const saved = (await customOf(page, 'Chosen Quellmayers'))!;
        expect(saved.rule).toBeNull();
        expect(saved.custom).toMatchObject({
            v: 1, auto: false, root: {
                t: 'group', op: 'all', items: [
                    { t: 'group', op: 'any', items: [{ t: 'cond', c: 'gender', p: { value: 'female' } }, { t: 'cond', c: 'born', p: { from: 1900, to: 1999 } }] },
                    { t: 'cond', c: 'alive', p: { value: 'deceased' }, not: true },
                ],
            },
        });

        // Edit the rule: the same builder, nothing to ask on Cancel.
        await page.evaluate((id) => window.Strom.UI.showNewPersonList({ listId: id as never }), saved.id);
        await expect(f.locator('#pln-title')).toHaveText('Edit the rule');
        await expect(f.locator('.pln-bybtn')).toContainText('Custom rule');
        await expect(row(page, '0')).toHaveClass(/plr-grp/);
        await expect(row(page, '0').locator('[data-rb="op"][data-op="any"]').first()).toHaveAttribute('aria-pressed', 'true');
        await expect(row(page, '0.0').locator('button[data-pc="value"][data-v="female"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(row(page, '0.1').locator('input[data-pc="from"]')).toHaveValue('1900');
        await expect(row(page, '0.1').locator('input[data-pc="to"]')).toHaveValue('1999');
        await expect(row(page, '1')).toHaveAttribute('data-not', '1');
        await expect(row(page, '1').locator('button[data-pc="value"][data-v="deceased"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(f.locator('.pln-total')).toHaveText('3 people match');
        await f.locator('.pln-foot [data-act="cancel"]').click();
        await expect(f).toHaveCount(0);
    });

    test('one family of a person from "More options" is saved as the tile\'s rule', async ({ page }) => {
        await family(page);
        await openNew(page);
        const f = form(page);
        await tile(page, 'ancestors').locator('.pln-opt-label').click();
        await expect(f.locator('#pln-name')).toHaveValue('Ancestors – Tobiah Quellmayer');
        await f.locator('[data-act="family-more"]').click();
        await expect(f.locator('.plr-row')).toHaveCount(1);
        await expect(f.locator('#pln-name')).toHaveValue('Family – Tobiah Quellmayer');
        await expect(f.locator('.pln-total')).toHaveText('5 people match');
        // Back to the tiles: the same ancestors.
        await f.locator('.pln-bybtn').click();
        await menu(page).locator('.pl-menu-item[data-id="ancestors"]').click();
        await expect(tile(page, 'ancestors')).toHaveClass(/is-on/);
        await expect(tile(page, 'ancestors').locator('.pln-count')).toHaveText('5 people');
        await f.locator('[data-act="family-more"]').click();
        await f.locator('[data-act="create"]').click();
        await expect(f).toHaveCount(0);
        const saved = (await customOf(page, 'Family – Tobiah Quellmayer'))!;
        expect(saved.custom).toBeNull();
        expect(saved.rule).toMatchObject({ kind: 'ancestors', personId: 't' });
    });

    test('closing an unfinished rule of two conditions asks first', async ({ page }) => {
        await family(page);
        await openNew(page);
        const f = form(page);
        await tile(page, 'custom').locator('.pln-opt-label').click();
        await addCond(page, '', 'gender');
        // One condition: closes at once.
        await page.keyboard.press('Escape');
        await expect(f).toHaveCount(0);

        await page.evaluate(() => window.Strom.UI.showNewPersonList());
        await tile(page, 'custom').locator('.pln-opt-label').click();
        await addCond(page, '', 'gender');
        await addCond(page, '', 'alive');
        await row(page, '1').focus();
        await page.keyboard.press('Escape');
        await expect(page.locator('#confirm-title')).toHaveText('Discard the unfinished rule?');
        await page.locator('#confirm-cancel-btn').click();
        await expect(f).toBeVisible();
        await expect(f.locator('.plr-row')).toHaveCount(2);
        // Ctrl+Z inside the dialog: the builder's step back, not the tree's.
        await row(page, '1').focus();
        await page.keyboard.press('ControlOrMeta+z');
        await expect(f.locator('.plr-row')).toHaveCount(1);
        await addCond(page, '', 'alive');
        await f.locator('.pln-foot [data-act="cancel"]').click();
        await page.locator('#confirm-ok-btn').click();
        await expect(f).toHaveCount(0);
    });
});

test.describe('Custom rule: a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the builder fits the screen; 44 px targets; the joining word before the name', async ({ page }) => {
        await family(page);
        await page.evaluate(() => window.Strom.UI.showNewPersonList({
            custom: {
                t: 'group', op: 'all', items: [
                    { t: 'group', op: 'any', items: [{ t: 'cond', c: 'gender', p: { value: 'female' } }, { t: 'cond', c: 'born', p: { from: 1900, to: 1999 } }] },
                    { t: 'cond', c: 'alive', p: { value: 'deceased' }, not: true },
                ],
            },
        }));
        const f = form(page);
        const box = (await f.locator('.pln-modal').boundingBox())!;
        expect(box).toEqual({ x: 0, y: 0, width: 390, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
        await expect(f.locator('.pln-total')).toHaveText('3 people match');
        // "Show in the tree" is in ⋯ on a phone, not in the footer.
        await expect(f.locator('.pln-foot [data-act="show-tree"]')).toBeHidden();
        await expect(row(page, '1').locator('> .plr-m > .plr-ci')).toBeVisible();
        await expect(row(page, '1').locator('> .plr-c')).toBeHidden();
        for (const el of await f.locator('.plr-d, .pln-more, .plr-seg > .sel-opt, .pln-bybtn, .plr .pln-ctl, .pln-foot > button:visible').all()) {
            const b = (await el.boundingBox())!;
            expect(b.height).toBeGreaterThanOrEqual(44);
            expect(b.x + b.width).toBeLessThanOrEqual(390);
        }
        // The row's ⋯ opens a sheet.
        await row(page, '1').locator('> .plr-d').tap();
        const sheet = page.locator('.bottom-sheet-menu');
        await expect(sheet).toBeVisible();
        await expect(page.locator('.plr-menu')).toHaveCount(0);
        await sheet.locator('.bottom-sheet-item', { hasText: 'Include' }).tap();
        await expect(sheet).toHaveCount(0);
        await expect(row(page, '1')).toHaveAttribute('data-not', '0');
    });
});
