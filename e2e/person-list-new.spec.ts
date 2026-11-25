/**
 * The dialog New list / Save as list (spec 084 §3, §6, §15d, §16c): the rule
 * as tiles with their counts, the name following the rule until typed over,
 * a taken name framed with the suggested "(2)" that Create takes, a fixed
 * and an automatic list, Edit rule… of an automatic list, Add from the rule
 * (then "The list is complete."), the custom period, a view saved as a list
 * (the people given, Keep up to date on for a family line), German on a low
 * notebook (the body scrolls, the footer stays), a read-only tree (nothing
 * opens), the phone (the whole screen) and the phone held sideways (a 560 px
 * sheet). Invented names only; the clock is fixed.
 */

import { test, expect, Page } from '@playwright/test';
import { openApp, seedTree } from './helpers';

const NOW = new Date('2026-11-16T10:30:00Z');

async function family(page: Page): Promise<void> {
    await page.clock.setFixedTime(NOW);
    await openApp(page);
    await seedTree(page, {
        q: { firstName: 'Quillon', lastName: 'Varnholm', parents: ['t', 'i'], birthDate: '1950' },
        t: { firstName: 'Tamsel', lastName: 'Varnholm', parents: ['c', 'y'], partners: ['i'], birthDate: '1921' },
        i: { firstName: 'Ilvara', lastName: 'Brannoc', gender: 'female', partners: ['t'], birthDate: '1925' },
        c: { firstName: 'Corvin', lastName: 'Varnholm', partners: ['y'], birthDate: '1890' },
        y: { firstName: 'Yselda', lastName: 'Fennick', gender: 'female', partners: ['c'], birthDate: '1894' },
        w: { firstName: 'Wendrel', lastName: 'Varnholm', parents: ['t', 'i'], birthDate: '1953' },
    }, 'Varnholm', 'q');
    await page.evaluate(() => {
        window.Strom.DataManager.createPersonList({ name: 'Letters to write', dynamic: false, personIds: ['t', 'c', 'y'] as never[], sort: 'old' });
    });
}

const lists = (page: Page) => page.locator('#person-lists-modal');
const form = (page: Page) => page.locator('#person-list-new');
const tile = (page: Page, opt: string) => form(page).locator(`.pln-opt[data-opt="${opt}"]`);
const people = (page: Page) => lists(page).locator('.pl-person .pl-pname');

async function openNew(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showPersonLists());
    await lists(page).locator('.pl-new').first().click();
    await expect(form(page)).toBeVisible();
}

test.describe('New list: a computer', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('a fixed list of ancestors: the rule\'s tiles and counts, the name follows the rule, a taken name takes "(2)"', async ({ page }) => {
        await family(page);
        await openNew(page);
        const f = form(page);
        await expect(f.locator('#pln-title')).toHaveText('New list of people');
        await expect(f.locator('#pln-name')).toBeFocused();
        await expect(f.locator('#pln-name')).toHaveValue('');
        // Empty is chosen: no rule, no automatic list, Create waits for a name.
        await expect(f.locator('.pln-opt')).toHaveCount(6);
        await expect(f.locator('.pln-opt-label')).toHaveText(['Empty', 'Family line', 'Ancestors of a person', 'Descendants of a person', 'Added in a period', 'Custom rule']);
        await expect(tile(page, 'empty')).toHaveClass(/is-on/);
        await expect(tile(page, 'ancestors').locator('.pln-count')).toHaveText('5 people');
        await expect(tile(page, 'descendants').locator('.pln-count')).toHaveText('1 person');
        await expect(f.locator('.pln-switch')).toHaveAttribute('aria-disabled', 'true');
        await expect(f.locator('[data-act="create"]')).toBeDisabled();
        // Only the chosen tile has controls.
        await expect(f.locator('.pln-ctls')).toHaveCount(0);

        // Ancestors: the person in focus, all generations; the name follows.
        await tile(page, 'ancestors').locator('.pln-opt-label').click();
        await expect(tile(page, 'ancestors')).toHaveClass(/is-on/);
        await expect(f.locator('.pln-ctls')).toHaveCount(1);
        await expect(f.locator('.pln-person')).toContainText('Quillon Varnholm · * 1950');
        await expect(f.locator('#pln-name')).toHaveValue('Ancestors – Quillon Varnholm');
        await expect(f.locator('.pln-keep-s')).toHaveText('Fixed list: the people are chosen now and change only by hand. The rule is kept for “Add from the rule”.');
        await f.locator('[data-ctl="gens"]').selectOption({ label: 'up to 1 generation' });
        await expect(tile(page, 'ancestors').locator('.pln-count')).toHaveText('3 people');

        // Another person through the person choice.
        await f.locator('.pln-person').click();
        const pop = f.locator('.tov-pop');
        await expect(pop).toBeVisible();
        await pop.locator('.tov-pop-search').fill('Tamsel');
        await pop.locator('.tov-pop-row', { hasText: 'Tamsel Varnholm' }).click();
        await expect(pop).toHaveCount(0);
        await expect(f.locator('.pln-person')).toContainText('Tamsel Varnholm');
        await expect(f.locator('#pln-name')).toHaveValue('Ancestors – Tamsel Varnholm');
        await expect(tile(page, 'ancestors').locator('.pln-count')).toHaveText('3 people');

        // A taken name: framed, the sentence suggests "(2)", Create takes it.
        await f.locator('#pln-name').fill('letters TO write');
        await expect(f.locator('#pln-name')).toHaveAttribute('aria-invalid', 'true');
        await expect(f.locator('#pln-name-err')).toHaveText('A list with this name exists. Suggested: “letters TO write (2)”.');
        const border = await f.locator('#pln-name').evaluate(el => getComputedStyle(el).borderTopWidth);
        expect(border).toBe('2px');
        // A typed name no longer follows the rule.
        await tile(page, 'descendants').locator('.pln-opt-label').click();
        await expect(f.locator('#pln-name')).toHaveValue('letters TO write');
        await tile(page, 'ancestors').locator('.pln-opt-label').click();
        await f.locator('[data-act="create"]').click();
        await expect(form(page)).toHaveCount(0);
        await expect(page.locator('.undo-toast', { hasText: 'List “letters TO write (2)” saved.' })).toBeVisible();
        const d = lists(page);
        await expect(d.locator('.pl-row[aria-selected="true"] .pl-row-name')).toHaveText('letters TO write (2)');
        await expect(d.locator('.pl-badge')).toHaveText('Fixed list');
        await expect(d.locator('.pl-rule')).toContainText('Created from Ancestors: Tamsel Varnholm, up to 1 generation');
        await expect(people(page)).toHaveText(['Tamsel Varnholm', 'Corvin Varnholm', 'Yselda Fennick']);
    });

    test('an automatic list of descendants, Edit rule…; Escape closes only the dialog', async ({ page }) => {
        await family(page);
        await openNew(page);
        const f = form(page);
        await tile(page, 'descendants').click();
        await f.locator('.pln-person').click();
        await f.locator('.tov-pop-search').fill('Corvin');
        await f.locator('.tov-pop-search').press('Enter');
        await expect(tile(page, 'descendants').locator('.pln-count')).toHaveText('4 people');
        await f.locator('.pln-switch').click();
        await expect(f.locator('.pln-switch')).toHaveAttribute('aria-checked', 'true');
        await expect(f.locator('.pln-keep-s')).toHaveText('Automatic list: the content is worked out again from the rule each time.');
        // Empty cannot be automatic: choosing it switches Keep up to date off.
        await tile(page, 'empty').click();
        await expect(f.locator('.pln-switch')).toHaveAttribute('aria-checked', 'false');
        await tile(page, 'descendants').click();
        await f.locator('.pln-switch').click();
        await f.locator('#pln-name').press('Enter');
        await expect(form(page)).toHaveCount(0);
        const d = lists(page);
        await expect(d.locator('.pl-name')).toHaveText('Descendants – Corvin Varnholm');
        await expect(d.locator('.pl-badge')).toHaveText('Automatic list');
        await expect(people(page)).toHaveCount(4);

        // Edit rule…: the same choice without the name and Empty; up to 1 generation.
        await d.locator('.pl-link[data-act="edit-rule"]').click();
        await expect(f.locator('#pln-title')).toHaveText('Edit the rule');
        await expect(f.locator('#pln-name')).toHaveCount(0);
        await expect(tile(page, 'empty')).toHaveCount(0);
        await expect(tile(page, 'descendants')).toHaveClass(/is-on/);
        await expect(f.locator('.pln-radio:checked')).toBeFocused();
        await expect(f.locator('.pln-person')).toContainText('Corvin Varnholm');
        await expect(f.locator('.pln-switch')).toHaveAttribute('aria-checked', 'true');
        await f.locator('[data-ctl="gens"]').selectOption('1');
        await expect(tile(page, 'descendants').locator('.pln-count')).toHaveText('2 people');
        await f.locator('[data-act="create"]').click();
        await expect(form(page)).toHaveCount(0);
        await expect(d.locator('.pl-rule')).toContainText('Based on Descendants: Corvin Varnholm, up to 1 generation');
        await expect(people(page)).toHaveText(['Corvin Varnholm', 'Tamsel Varnholm']);

        // Escape: the person choice first, then the dialog; Lists of people stays.
        await d.locator('.pl-link[data-act="edit-rule"]').click();
        await f.locator('.pln-person').click();
        await expect(f.locator('.tov-pop')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(f.locator('.tov-pop')).toHaveCount(0);
        await expect(f).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(form(page)).toHaveCount(0);
        await expect(d).toBeVisible();
        await expect(d.locator('.pl-rule')).toContainText('up to 1 generation');
    });

    test('Add from the rule adds the new people with Undo, then the list is complete; the period of days', async ({ page }) => {
        await family(page);
        await page.evaluate(() => {
            window.Strom.DataManager.createPersonList({
                name: 'Line of Quillon', dynamic: false, rule: { kind: 'ancestors', personId: 'q' as never }, personIds: ['q', 't'] as never[],
            });
            window.Strom.UI.showPersonLists();
        });
        const d = lists(page);
        await d.locator('.pl-row', { hasText: 'Line of Quillon' }).click();
        await expect(people(page)).toHaveCount(2);
        await d.locator('.pl-link[data-act="fill"]').click();
        await expect(page.locator('.undo-toast', { hasText: '3 people added from the rule.' })).toBeVisible();
        await expect(people(page)).toHaveCount(5);
        await d.locator('.pl-link[data-act="fill"]').click();
        // The message waits for its turn after the Undo toast.
        await expect(page.locator('.toast', { hasText: 'The list is complete.' })).toBeVisible({ timeout: 15000 });
        await expect(people(page)).toHaveCount(5);

        // Added in a period: 30 days by default; the ready-made list has the name, so "(2)" is suggested.
        await d.locator('.pl-new').first().click();
        const f = form(page);
        await tile(page, 'added').click();
        await expect(f.locator('[data-ctl="period"]')).toHaveValue('30');
        await expect(f.locator('#pln-name')).toHaveValue('Added in the last 30 days');
        await expect(f.locator('#pln-name-err')).toHaveText('A list with this name exists. Suggested: “Added in the last 30 days (2)”.');
        await expect(tile(page, 'added').locator('.pln-count')).toHaveText('0 people');
        await f.locator('[data-ctl="period"]').selectOption('custom');
        await expect(f.locator('.pln-days')).toBeFocused();
        await f.locator('.pln-days').fill('12');
        await expect(f.locator('#pln-name')).toHaveValue('Added in the last 12 days');
        await expect(f.locator('#pln-name-err')).toBeHidden();
        await f.locator('[data-act="create"]').click();
        await expect(d.locator('.pl-name')).toHaveText('Added in the last 12 days');
        await expect(d.locator('.pl-rule')).toContainText('Added in the last 12 days');
    });

    test('a view saved as a list: the people given in their order; a family line keeps up to date', async ({ page }) => {
        await family(page);
        // The results of a search: a fixed list only, no switch.
        await page.evaluate(() => window.Strom.UI.showNewPersonList({ source: 'search', personIds: ['w', 'q'] as never[], name: 'Search: Varnholm', openLists: false }));
        const s = page.locator('#person-list-save');
        await expect(s.locator('#pln-title')).toHaveText('New list from the results');
        await expect(s.locator('.pln-sentence')).toHaveText('2 people');
        await expect(s.locator('.pln-switch')).toHaveCount(0);
        await expect(s.locator('.pln-opt')).toHaveCount(0);
        const w = (await s.locator('.pln-modal').boundingBox())!.width;
        expect(Math.round(w)).toBe(480);
        await s.locator('[data-act="create"]').click();
        await expect(s).toHaveCount(0);
        await expect(lists(page)).toHaveCount(0);
        const saved = await page.evaluate(() => {
            const l = window.Strom.DataManager.getPersonLists().find(x => x.name === 'Search: Varnholm');
            return l ? { dynamic: l.dynamic, ids: l.personIds, sort: l.sort } : null;
        });
        expect(saved).toEqual({ dynamic: false, ids: ['w', 'q'], sort: 'manual' });

        // A family line: Keep up to date on, the name from the line.
        await page.evaluate(() => {
            const index = window.Strom.DataManager.getLineageIndex();
            const rod = [...index.rods.values()].find(r => r.surname === 'Varnholm')!;
            window.Strom.UI.showNewPersonList({ source: 'rod', rule: { kind: 'rods', rodIds: [rod.id] } });
        });
        await expect(s.locator('#pln-title')).toHaveText('Save the family line as a list');
        await expect(s.locator('#pln-name')).toHaveValue('Varnholm family line');
        await expect(s.locator('.pln-switch')).toHaveAttribute('aria-checked', 'true');
        await s.locator('[data-act="create"]').click();
        await expect(lists(page).locator('.pl-badge')).toHaveText('Automatic list');
        await expect(lists(page).locator('.pl-name')).toHaveText('Varnholm family line');
    });

    test('a read-only tree opens no dialog', async ({ page }) => {
        await family(page);
        await page.evaluate(() => { (window.Strom.DataManager as unknown as { viewMode: boolean }).viewMode = true; });
        await page.evaluate(() => window.Strom.UI.showNewPersonList());
        await expect(form(page)).toHaveCount(0);
    });
});

test.describe('New list: German on a low notebook', () => {
    test.use({ viewport: { width: 1024, height: 640 } });

    test('560 px, the body scrolls and the footer stays', async ({ page }) => {
        await family(page);
        await page.evaluate(() => window.Strom.UI.setLanguage('de' as never));
        await page.evaluate(() => window.Strom.UI.showNewPersonList({ rule: { kind: 'ancestors', personId: 'q' as never } }));
        const f = form(page);
        await expect(f.locator('#pln-title')).toHaveText('Neue Personenliste');
        const box = (await f.locator('.pln-modal').boundingBox())!;
        expect(Math.round(box.width)).toBe(560);
        expect(box.y).toBeGreaterThanOrEqual(15);
        expect(box.y + box.height).toBeLessThanOrEqual(640 - 15);
        const foot = (await f.locator('.pln-foot').boundingBox())!;
        expect(foot.y + foot.height).toBeLessThanOrEqual(box.y + box.height + 1);
        const body = await f.locator('.pln-body').evaluate(el => ({ sh: el.scrollHeight, ch: el.clientHeight, ow: el.scrollWidth > el.clientWidth }));
        expect(body.ow).toBe(false);
        expect(body.sh).toBeGreaterThanOrEqual(body.ch);
    });
});

test.describe('New list: a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the whole screen; 44 px targets; Create on the right', async ({ page }) => {
        await family(page);
        await page.evaluate(() => window.Strom.UI.showNewPersonList({ rule: { kind: 'ancestors', personId: 'q' as never } }));
        const f = form(page);
        const box = (await f.locator('.pln-modal').boundingBox())!;
        expect(box).toEqual({ x: 0, y: 0, width: 390, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
        for (const el of await f.locator('.pln-opt, .pln-person, [data-ctl="gens"], .pln-foot > button, .close-btn').all()) {
            const b = (await el.boundingBox())!;
            expect(b.height).toBeGreaterThanOrEqual(44);
            expect(b.x + b.width).toBeLessThanOrEqual(390);
        }
        const cancel = (await f.locator('.pln-foot [data-dismiss]').boundingBox())!;
        const create = (await f.locator('.pln-foot [data-act="create"]').boundingBox())!;
        expect(Math.round(cancel.y)).toBe(Math.round(create.y));
        expect(create.x).toBeGreaterThan(cancel.x);
        await tile(page, 'descendants').tap();
        await expect(tile(page, 'descendants')).toHaveClass(/is-on/);
        await f.locator('[data-act="create"]').tap();
        await expect(form(page)).toHaveCount(0);
        await expect(lists(page).locator('.pl-title')).toHaveText('Descendants – Quillon Varnholm');
    });
});

test.describe('New list: a phone held sideways', () => {
    test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

    test('a 560 px sheet from below that scrolls', async ({ page }) => {
        await family(page);
        await page.evaluate(() => window.Strom.UI.showNewPersonList());
        const f = form(page);
        const box = (await f.locator('.pln-modal').boundingBox())!;
        expect(Math.round(box.width)).toBe(560);
        expect(Math.round(box.x)).toBe(142);
        expect(Math.round(box.y + box.height)).toBe(390);
        const foot = (await f.locator('.pln-foot').boundingBox())!;
        expect(Math.round(foot.y + foot.height)).toBe(390);
        const body = await f.locator('.pln-body').evaluate(el => el.scrollHeight > el.clientHeight);
        expect(body).toBe(true);
    });
});
