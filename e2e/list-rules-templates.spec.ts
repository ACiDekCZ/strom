/**
 * Templates, Add condition, Freeze and Keep by the rule, the person menu
 * (spec 136 §7, §9, §10, §12). A new list started from a built-in template
 * that needs a person or a place (with its surroundings); a custom rule saved
 * as a template on the device without its people, used again, renamed (a
 * taken name suggests the next free one) and deleted with Undo. "Add
 * condition…" of an automatic list: a one-condition rule becomes a custom one
 * with the new condition; Escape takes the row for a while away. "Edit rule…"
 * from the detail. Freeze, then "Keep by the rule" at once without changes by
 * hand and with a question when there are some, both with Undo; a checklist
 * offers it disabled with the reason. The person menu's "List from this
 * person's family…". English, one pass in German, the phone's ⋯. Invented
 * names only; the clock is fixed.
 */

import { test, expect, Page } from '@playwright/test';
import { openApp, card } from './helpers';

const NOW = new Date('2026-11-16T10:30:00Z');

interface Seed { firstName: string; lastName: string; gender?: 'male' | 'female'; parents?: string[]; partners?: string[]; [k: string]: unknown }

/**
 * Arvid Quellmayer (born in Mlýnky) and Dorota Talvanen (born in Vrbatín,
 * 6 km away) have a son born in Mlýnky, a daughter born in Horní Vranice (a place
 * without a location) and a son born in Dolní Krsovec, 40 km away.
 * The first son and his wife Ostrovid have a son.
 */
const PEOPLE: Record<string, Seed> = {
    b: { firstName: 'Benedikt', lastName: 'Quellmayer', parents: ['a', 'd'], partners: ['e'], birthDate: '1850', birthPlace: 'Mlýnky' },
    a: { firstName: 'Arvid', lastName: 'Quellmayer', partners: ['d'], birthDate: '1820', deathDate: '1880', birthPlace: 'Mlýnky' },
    d: { firstName: 'Dorota', lastName: 'Talvanen', gender: 'female', partners: ['a'], birthDate: '1825', deathDate: '1890', birthPlace: 'Vrbatín' },
    c: { firstName: 'Cilka', lastName: 'Quellmayer', gender: 'female', parents: ['a', 'd'], birthDate: '1852', birthPlace: 'Horní Vranice' },
    v: { firstName: 'Edvin', lastName: 'Quellmayer', parents: ['a', 'd'], birthDate: '1855', birthPlace: 'Dolní Krsovec' },
    e: { firstName: 'Eliška', lastName: 'Ostrovid', gender: 'female', partners: ['b'], birthDate: '1853' },
    g: { firstName: 'Gustav', lastName: 'Quellmayer', parents: ['b', 'e'], birthDate: '1880' },
};

const PLACES = {
    'mlynky': { lat: 49.5, lon: 15.0 },
    'vrbatin': { lat: 49.554, lon: 15.0 },
    'dolni krsovec': { lat: 49.86, lon: 15.0 },
};

async function family(page: Page, lang: 'en' | 'de' = 'en'): Promise<void> {
    await page.clock.setFixedTime(NOW);
    await openApp(page);
    const persons: Record<string, Record<string, unknown> & { partnerships: string[]; parentIds: string[]; childIds: string[] }> = {};
    for (const [id, { parents, partners: _p, ...rest }] of Object.entries(PEOPLE)) {
        persons[id] = { id, gender: 'male', isPlaceholder: false, ...rest, partnerships: [], parentIds: [...(parents ?? [])], childIds: [] };
    }
    for (const [id, p] of Object.entries(persons)) for (const parent of p.parentIds) persons[parent].childIds.push(id);
    const partnerships: Record<string, { id: string; person1Id: string; person2Id: string; childIds: string[]; status: string }> = {};
    for (const [id, { partners }] of Object.entries(PEOPLE)) {
        for (const other of partners ?? []) {
            const uid = `u_${[id, other].sort().join('_')}`;
            if (partnerships[uid]) continue;
            const childIds = Object.keys(persons).filter(c => persons[c].parentIds.includes(id) && persons[c].parentIds.includes(other));
            partnerships[uid] = { id: uid, person1Id: id, person2Id: other, childIds, status: 'married' };
            persons[id].partnerships.push(uid);
            persons[other].partnerships.push(uid);
        }
    }
    await page.evaluate(async ({ persons, partnerships, places, lang }) => {
        await window.Strom.DataManager.importAsNewTree({ persons, partnerships, places } as never, 'Quellmayer');
        await window.Strom.TreeRenderer.setFocus('b' as never);
        if (lang !== 'en') window.Strom.UI.setLanguage(lang as never);
    }, { persons, partnerships, places: PLACES, lang });
    await expect(card(page, 'Benedikt')).toBeVisible();
}

const lists = (page: Page) => page.locator('#person-lists-modal');
const form = (page: Page) => page.locator('#person-list-new');
const tile = (page: Page, opt: string) => form(page).locator(`.pln-opt[data-opt="${opt}"]`);
const row = (page: Page, path: string) => form(page).locator(`.plr-row[data-path="${path}"]`);
const menu = (page: Page) => page.locator('.plr-menu');
const item = (page: Page, id: string) => menu(page).locator(`.pl-menu-item[data-id="${id}"]`);
const total = (page: Page) => form(page).locator('.pln-total');
const ctl = (page: Page, path: string, pc: string, v?: string) =>
    row(page, path).locator(`> .plr-m [data-pc="${pc}"]${v !== undefined ? `[data-v="${v}"]` : ''}`);
const nameDlg = (page: Page) => page.locator('#person-list-template');
const pop = (page: Page) => page.locator('.tov-pop');

async function openNew(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showPersonLists());
    await lists(page).locator('.pl-new').first().click();
    await expect(form(page)).toBeVisible();
}

async function addCond(page: Page, c: string): Promise<void> {
    await form(page).locator('.plr > .plr-add [data-rb="add"]').click();
    await item(page, c).click();
}

/** The person popover of a rule's condition: a search and the row picked. */
async function pickPerson(page: Page, search: string, id: string): Promise<void> {
    await expect(pop(page)).toBeVisible();
    await pop(page).locator('.tov-pop-search').fill(search);
    await pop(page).locator(`.tov-pop-row[data-id="${id}"]`).click();
    await expect(pop(page)).toHaveCount(0);
}

const listOf = (page: Page, name: string) => page.evaluate((n) => {
    const l = window.Strom.DataManager.getPersonLists().find(x => x.name === n);
    return l ? JSON.parse(JSON.stringify(l)) as Record<string, unknown> & { custom?: { auto: boolean; root: { op: string; items: Array<{ t: string; c?: string; p?: Record<string, unknown> }> } } } : null;
}, name);

const templates = (page: Page) => page.evaluate(() => window.Strom.SettingsManager.getListTemplates().map(t => ({ name: t.name, root: t.root })));

const ownIds = (page: Page) => menu(page).locator('.pl-menu-item[data-id^="own:"]');

test.describe('Templates: a computer', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('a template with a person: its groups and needs; the person chosen names the list; Drop the template; the origin kept', async ({ page }) => {
        await family(page);
        await openNew(page);
        const f = form(page);
        const btn = f.locator('.pln-tbtn');
        await expect(btn).toHaveText('Start from a template▾');
        await btn.click();
        await expect(menu(page)).toBeVisible();
        await expect(btn).toHaveAttribute('aria-expanded', 'true');
        // No own templates yet; the research's ones are not in an ordinary tree.
        await expect(menu(page).locator('.pl-mh')).toHaveText(['What research lacks', 'Family and lines', 'Stories and sharing']);
        await expect(ownIds(page)).toHaveCount(0);
        for (const id of ['conflicts', 'inProgress']) await expect(item(page, id)).toHaveCount(0);
        await expect(item(page, 'descendantsN').locator('.pl-menu-sub')).toHaveText('3 generations by default · needs a person');
        await expect(item(page, 'nearPlace').locator('.plr-need')).toHaveText('needs a place');
        await expect(item(page, 'living').locator('.plr-need')).toHaveCount(0);

        // Descendants to N generations: the person's choice opens at once.
        await item(page, 'descendantsN').click();
        await expect(menu(page)).toHaveCount(0);
        await expect(f.locator('.pln-bybtn')).toContainText('Custom rule');
        await expect(f.locator('.pln-from')).toHaveText('From template: Descendants to N generationsDrop the template');
        await expect(total(page)).toHaveText('Condition 1 is incomplete');
        await expect(f.locator('[data-act="create"]')).toBeDisabled();
        await pickPerson(page, 'arvid', 'a');
        await expect(ctl(page, '0', 'person')).toContainText('Arvid Quellmayer');
        await expect(f.locator('#pln-name')).toHaveValue('Descendants to N generations – Arvid Quellmayer');
        // Arvid, his three children and Gustav: three generations down.
        await expect(total(page)).toHaveText('5 people match');

        // Drop the template: an empty rule, no "From template", the name empty again.
        await f.locator('[data-act="template-drop"]').click();
        await expect(f.locator('.pln-from')).toHaveCount(0);
        await expect(f.locator('.plr-row')).toHaveCount(0);
        await expect(f.locator('#pln-name')).toHaveValue('');
        await expect(total(page)).toHaveText('No condition yet');

        // Again, created: the list keeps the template as its origin and the person in its rule.
        await f.locator('.pln-tbtn').click();
        await item(page, 'descendantsN').click();
        await pickPerson(page, 'arvid', 'a');
        await f.locator('[data-act="create"]').click();
        await expect(f).toBeHidden();
        const made = await listOf(page, 'Descendants to N generations – Arvid Quellmayer');
        expect(made?.origin).toMatchObject({ by: 'template', template: 'descendantsN' });
        // One Family of a person down only is the tile's rule: Descendants, three generations.
        expect(made?.custom).toBeUndefined();
        expect(made?.rule).toMatchObject({ kind: 'descendants', personId: 'a', generations: 3 });
    });

    test('a template with a place and surroundings: the place\'s choice at once, 10 km, the name with the place', async ({ page }) => {
        await family(page);
        await openNew(page);
        const f = form(page);
        await f.locator('.pln-tbtn').click();
        await item(page, 'nearPlace').click();
        // The place's choice of the condition (not the template menu) is open.
        await expect(menu(page)).toHaveAttribute('aria-label', 'Place');
        await menu(page).locator('.pl-msearch').fill('mlyn');
        await menu(page).locator('.pl-msearch').press('Enter');
        await expect(menu(page)).toHaveCount(0);
        await expect(ctl(page, '0', 'place')).toContainText('Mlýnky');
        await expect(ctl(page, '0', 'km', '10')).toHaveAttribute('aria-pressed', 'true');
        // Arvid and Benedikt born in Mlýnky, Dorota in Vrbatín 6 km away.
        await expect(total(page)).toHaveText('3 people match');
        await expect(f.locator('#pln-name')).toHaveValue('From a place and surroundings – Mlýnky');
        await f.locator('[data-act="create"]').click();
        await expect(f).toBeHidden();
        const made = await listOf(page, 'From a place and surroundings – Mlýnky');
        expect(made?.origin).toMatchObject({ by: 'template', template: 'nearPlace' });
        expect(made?.custom?.root.items[0]).toMatchObject({ c: 'near', p: { placeKey: 'mlynky', km: 10 } });
    });

    test('Save as template without the person, used again with another one; a taken name; Rename; Delete with Undo', async ({ page }) => {
        await family(page);
        await openNew(page);
        const f = form(page);
        await tile(page, 'custom').locator('.pln-opt-label').click();
        // Family of Benedikt (in focus), men only.
        await addCond(page, 'family');
        await ctl(page, '0', 'preset', 'closest').click();
        await addCond(page, 'gender');
        await ctl(page, '1', 'value', 'male').click();
        await f.locator('#pln-name').fill('Men round Benedikt');

        // ⋯ Save as template…: the list's name, the note; saved on the device without Benedikt.
        await f.locator('.pln-more').click();
        await expect(item(page, 'save-template')).toHaveText('Save as template…');
        await item(page, 'save-template').click();
        const dlg = nameDlg(page);
        await expect(dlg).toBeVisible();
        await expect(dlg.locator('#plt-title')).toHaveText('Save as template');
        await expect(dlg.locator('#plt-name')).toHaveValue('Men round Benedikt');
        await expect(dlg.locator('.plt-note')).toHaveText('People, places and lists are not saved in a template – they are filled in when it is used. The template is saved on this device and works in other trees too.');
        await dlg.locator('#plt-name').fill('Men of a family');
        await dlg.locator('[data-act="tpl-save"]').click();
        await expect(dlg).toHaveCount(0);
        await expect(f.locator('.pln-more')).toBeFocused();
        let saved = await templates(page);
        expect(saved.map(t => t.name)).toEqual(['Men of a family']);
        expect(JSON.stringify(saved[0].root)).not.toContain('"b"');
        expect(JSON.stringify(saved[0].root)).not.toContain('Benedikt');

        // The same name again: framed, the next free one suggested and taken by Save.
        await f.locator('.pln-more').click();
        await item(page, 'save-template').click();
        await dlg.locator('#plt-name').fill('men of a family');
        await expect(dlg.locator('#plt-name')).toHaveAttribute('aria-invalid', 'true');
        await expect(dlg.locator('#plt-err')).toHaveText('A template with this name exists. Suggested: “men of a family (2)”.');
        await dlg.locator('#plt-name').press('Enter');
        await expect(dlg).toHaveCount(0);
        saved = await templates(page);
        expect(saved.map(t => t.name)).toEqual(['Men of a family', 'men of a family (2)']);

        // Own templates first, with what they need; used with Gustav.
        await f.locator('.pln-tbtn').click();
        await expect(menu(page).locator('.pl-mh').first()).toHaveText('Own');
        await expect(ownIds(page).locator('.pl-menu-label > :first-child')).toHaveCount(2);
        await expect(ownIds(page).first().locator('.plr-need')).toHaveText('needs a person');
        await ownIds(page).first().click();
        await pickPerson(page, 'gustav', 'g');
        await expect(f.locator('.pln-from')).toContainText('From template: Men of a family');
        await expect(f.locator('.plr-row')).toHaveCount(2);
        await expect(ctl(page, '0', 'person')).toContainText('Gustav Quellmayer');
        await expect(ctl(page, '0', 'preset', 'closest')).toHaveAttribute('aria-pressed', 'true');
        await expect(ctl(page, '1', 'value', 'male')).toHaveAttribute('aria-pressed', 'true');
        // Gustav, his father Benedikt and Benedikt's brother Edvin (the siblings of every ancestor in range).
        await expect(total(page)).toHaveText('3 people match');

        // ⋯ of an own template: Rename… to a free name.
        await f.locator('.pln-tbtn').click();
        const second = menu(page).locator('.plr-mrow', { has: page.locator('.pl-menu-item', { hasText: 'men of a family (2)' }) });
        await second.locator('.plr-mdots').click();
        await expect(menu(page).locator('.pl-menu-item')).toHaveText(['Rename…', 'Delete']);
        await item(page, 'rename').click();
        await expect(dlg.locator('#plt-title')).toHaveText('Rename template');
        await expect(dlg.locator('.plt-note')).toHaveCount(0);
        await expect(dlg.locator('#plt-name')).toHaveValue('men of a family (2)');
        await dlg.locator('#plt-name').fill('Men of a line');
        await dlg.locator('[data-act="tpl-save"]').click();
        await expect(dlg).toHaveCount(0);
        expect((await templates(page)).map(t => t.name)).toEqual(['Men of a family', 'Men of a line']);

        // Delete with Undo: back at its place.
        await f.locator('.pln-tbtn').click();
        await menu(page).locator('.plr-mrow', { has: page.locator('.pl-menu-item', { hasText: 'Men of a family' }) }).locator('.plr-mdots').click();
        await item(page, 'delete').click();
        expect((await templates(page)).map(t => t.name)).toEqual(['Men of a line']);
        // The app's toast (not the tree's undo toast: the templates are on the device, not in the tree).
        const toast = page.locator('.toast', { hasText: 'Template “Men of a family” deleted.' });
        await expect(toast).toBeVisible();
        await toast.locator('.toast-action', { hasText: 'Undo' }).click();
        expect((await templates(page)).map(t => t.name)).toEqual(['Men of a family', 'Men of a line']);
        await f.locator('.pln-tbtn').click();
        await expect(ownIds(page)).toHaveCount(2);
    });

    test('Add condition… of an automatic list: the row for a while, Escape; a new condition makes the rule custom; Edit rule…', async ({ page }) => {
        await family(page);
        await page.evaluate(() => {
            window.Strom.DataManager.createPersonList({ name: 'Ancestors – Gustav', dynamic: true, rule: { kind: 'ancestors', personId: 'g' as never } });
            window.Strom.UI.showPersonLists();
        });
        const d = lists(page);
        await d.locator('.pl-row', { hasText: 'Ancestors – Gustav' }).click();
        await expect(d.locator('.pl-rule .pl-link')).toHaveText(['Edit rule…', 'Add condition…']);

        // From the detail: the builder with the rule's one condition, a row "and choose a condition…", the catalog open.
        await d.locator('.pl-rule [data-act="add-condition"]').click();
        const f = form(page);
        await expect(f).toBeVisible();
        await expect(f.locator('.plr-row:not(.plr-temp)')).toHaveCount(1);
        const temp = f.locator('.plr-temp');
        await expect(temp).toHaveAttribute('aria-label', 'and choose a condition…');
        await expect(temp.locator('.plr-pickn')).toHaveText('choose a condition…');
        await expect(menu(page)).toBeVisible();
        await expect(menu(page).locator('.pl-msearch')).toBeFocused();
        // Escape takes the catalog and the row away; the dialog stays, the focus on + Add condition.
        await page.keyboard.press('Escape');
        await expect(menu(page)).toHaveCount(0);
        await expect(temp).toHaveCount(0);
        await expect(f).toBeVisible();
        await expect(f.locator('.plr > .plr-add [data-rb="add"]')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(f).toBeHidden();

        // From ⋯: Add condition… before Freeze; women only.
        await d.locator('.pl-more').click();
        await expect(d.locator('.pl-menu [data-run="add-condition"]')).toHaveText('Add condition…');
        await d.locator('.pl-menu [data-run="add-condition"]').click();
        await expect(menu(page)).toBeVisible();
        await item(page, 'gender').click();
        await expect(f.locator('.plr-temp')).toHaveCount(0);
        await expect(f.locator('.plr-row')).toHaveCount(2);
        await ctl(page, '1', 'value', 'female').click();
        // A row removed comes back by the toast's Undo, pressed over the dialog.
        await row(page, '1').locator('> .plr-d').click();
        await item(page, 'remove').click();
        await expect(f.locator('.plr-row')).toHaveCount(1);
        await page.locator('.toast', { hasText: 'Condition removed' }).locator('.toast-action', { hasText: 'Undo' }).click();
        await expect(f.locator('.plr-row')).toHaveCount(2);
        await expect(ctl(page, '1', 'value', 'female')).toHaveAttribute('aria-pressed', 'true');
        // Gustav's ancestors: Benedikt, Eliška, Arvid, Dorota and Gustav himself; the women of them.
        await expect(total(page)).toHaveText('2 people match');
        await f.locator('.pln-foot button.primary').click();
        await expect(f).toBeHidden();
        const list = await listOf(page, 'Ancestors – Gustav');
        expect(list?.custom?.auto).toBe(true);
        expect(list?.custom?.root.items.map(x => x.c)).toEqual([expect.any(String), 'gender']);
        await expect(d.locator('.pl-badge')).toHaveText('Automatic list');
        await expect(d.locator('.pl-person')).toHaveCount(2);

        // The detail says the custom rule in words; Edit rule… opens it with both conditions.
        await expect(d.locator('.pl-rule .pl-rule-v')).toContainText('women');
        await expect(d.locator('.pl-rule .pl-link')).toHaveText(['Edit rule…', 'Add condition…']);
        await d.locator('.pl-rule [data-act="edit-rule"]').click();
        await expect(f).toBeVisible();
        await expect(f.locator('.plr-row')).toHaveCount(2);
        await expect(f.locator('.plr-temp')).toHaveCount(0);
        await expect(menu(page)).toHaveCount(0);
        await expect(ctl(page, '1', 'value', 'female')).toHaveAttribute('aria-pressed', 'true');
    });

    test('Freeze and Keep by the rule: at once without changes by hand, asked with them, both with Undo; a checklist disables it', async ({ page }) => {
        await family(page);
        await page.evaluate(() => {
            window.Strom.DataManager.createCustomPersonList({
                name: 'Quellmayer men',
                custom: { v: 1, auto: true, root: { t: 'group', op: 'all', items: [
                    { t: 'cond', c: 'gender', p: { value: 'male' } },
                    { t: 'cond', c: 'born', p: { from: 1800, to: 1860 } },
                ] } } as never,
            });
            window.Strom.UI.showPersonLists();
        });
        const d = lists(page);
        const people = d.locator('.pl-person .pl-pname');
        await d.locator('.pl-row', { hasText: 'Quellmayer men' }).click();
        await expect(d.locator('.pl-person')).toHaveCount(3);

        // Freeze: fixed; its ⋯ has Add condition…, Tick off done and Keep by the rule.
        await d.locator('.pl-more').click();
        await d.locator('.pl-menu [data-run="freeze"]').click();
        await expect(d.locator('.pl-badge')).toHaveText('Fixed list');
        await expect(d.locator('.pl-rule .pl-rule-k')).toHaveText('Created from');
        await expect(d.locator('.pl-rule .pl-link')).toHaveText(['Add from the rule', 'Add condition…']);
        await d.locator('.pl-more').click();
        await expect(d.locator('.pl-menu [data-act="menu-run"]').filter({ hasText: /Add condition|Tick off done|Keep by the rule/ }))
            .toHaveText(['Add condition…', 'Tick off done', 'Keep by the ruleWorked out again from the rule']);
        // Nothing changed by hand: at once, a toast with Undo.
        await d.locator('.pl-menu [data-run="keep-by-rule"]').click();
        await expect(page.locator('#confirmation-modal')).not.toHaveClass(/active/);
        await expect(d.locator('.pl-badge')).toHaveText('Automatic list');
        const toast = page.locator('.undo-toast', { hasText: 'The list follows the rule now.' });
        await expect(toast).toBeVisible();
        await toast.locator('.undo-toast-btn').click();
        await expect(d.locator('.pl-badge')).toHaveText('Fixed list');

        // One taken out, one added by hand: asked first.
        await d.locator('.pl-person', { hasText: 'Edvin' }).hover();
        await d.locator('.pl-person', { hasText: 'Edvin' }).locator('.pl-x').click();
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            dm.addPersonsToList(dm.getPersonLists().find(l => l.name === 'Quellmayer men')!.id, ['c' as never]);
        });
        await expect(d.locator('.pl-person')).toHaveCount(3);
        await d.locator('.pl-more').click();
        await d.locator('.pl-menu [data-run="keep-by-rule"]').click();
        const confirm = page.locator('#confirmation-modal');
        await expect(confirm).toHaveClass(/active/);
        await expect(confirm.locator('#confirm-title')).toHaveText('Keep by the rule?');
        await expect(confirm.locator('#confirm-message')).toHaveText('The list will be worked out from the rule. People added (1) and removed (1) by hand are dropped.');
        await expect(confirm.locator('#confirm-ok-btn')).toHaveText('Keep by the rule');
        await confirm.locator('#confirm-ok-btn').click();
        await expect(d.locator('.pl-badge')).toHaveText('Automatic list');
        await expect(people).toHaveText(['Arvid Quellmayer', 'Benedikt Quellmayer', 'Edvin Quellmayer']);
        await page.locator('.undo-toast', { hasText: 'The list follows the rule now.' }).locator('.undo-toast-btn').click();
        await expect(d.locator('.pl-badge')).toHaveText('Fixed list');
        await expect(d.locator('.pl-person', { hasText: 'Cilka' })).toHaveCount(1);
        await expect(d.locator('.pl-person', { hasText: 'Edvin' })).toHaveCount(0);

        // A checklist: Keep by the rule disabled with the reason.
        await d.locator('.pl-more').click();
        await d.locator('.pl-menu [data-run="work"]').click();
        await expect(d.locator('.pl-badge')).toHaveText('Checklist');
        await d.locator('.pl-more').click();
        const keep = d.locator('.pl-menu [data-run="keep-by-rule"]');
        await expect(keep).toHaveAttribute('aria-disabled', 'true');
        await expect(keep).toHaveAttribute('title', 'First switch off Tick off done');
        await expect(keep).toContainText('First switch off Tick off done');
        await keep.click({ force: true });
        await expect(page.locator('#confirmation-modal')).not.toHaveClass(/active/);
        await expect(d.locator('.pl-badge')).toHaveText('Checklist');
    });

    test('the person menu: List from this person\'s family… opens the closest family of the person', async ({ page }) => {
        await family(page);
        await card(page, 'Benedikt').click();
        await page.locator('.context-menu [data-menu="add-to-list"]').click();
        const sub = page.locator('.context-submenu');
        const fromFamily = sub.locator('[data-action="list-from-family"]');
        await expect(fromFamily).toHaveText('List from this person’s family…');
        // Right after New list with this person…, with no research mark.
        const actions = await sub.locator('[data-action]').evaluateAll(els => els.map(e => e.getAttribute('data-action')));
        expect(actions[actions.indexOf('list-from-family') - 1]).toBe('list-new-with');
        await expect(fromFamily.locator('.research-open-mark, .ai-badge')).toHaveCount(0);
        await fromFamily.click();
        const f = form(page);
        await expect(f).toBeVisible();
        await expect(f.locator('.pln-bybtn')).toContainText('Custom rule');
        await expect(f.locator('.plr-row')).toHaveCount(1);
        await expect(ctl(page, '0', 'person')).toContainText('Benedikt Quellmayer');
        await expect(ctl(page, '0', 'preset', 'closest')).toHaveAttribute('aria-pressed', 'true');
        // Parents, siblings, spouse and child of Benedikt, and he himself.
        await expect(total(page)).toHaveText('7 people match');
        await f.locator('[data-act="create"]').click();
        await expect(f).toBeHidden();
        const made = await listOf(page, 'Family – Benedikt Quellmayer');
        expect(made?.custom?.root.items).toEqual([expect.objectContaining({ c: 'family', p: expect.objectContaining({ personId: 'b', up: 1, down: 1, width: 'siblings', spouses: 'spouses' }) })]);
    });
});

test.describe('Templates: German at 1440', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the template menu, a place template and Add condition… in German', async ({ page }) => {
        await family(page, 'de');
        await openNew(page);
        const f = form(page);
        await expect(f.locator('.pln-tbtn')).toHaveText('Mit Vorlage beginnen▾');
        await f.locator('.pln-tbtn').click();
        await expect(menu(page).locator('.pl-mh')).toHaveText(['Was in der Forschung fehlt', 'Familie und Linien', 'Erzählen und Teilen']);
        await expect(item(page, 'nearPlace').locator('.plr-need')).toHaveText('braucht einen Ort');
        await item(page, 'nearPlace').click();
        await menu(page).locator('.pl-msearch').fill('mlyn');
        await menu(page).locator('.pl-msearch').press('Enter');
        await expect(f.locator('.pln-from')).toHaveText('Aus Vorlage: Aus Ort und UmgebungVorlage verwerfen');
        await expect(f.locator('#pln-name')).toHaveValue('Aus Ort und Umgebung – Mlýnky');
        await f.locator('[data-act="create"]').click();
        await expect(f).toBeHidden();

        const d = lists(page);
        await d.locator('.pl-row', { hasText: 'Aus Ort und Umgebung – Mlýnky' }).click();
        await d.locator('.pl-more').click();
        await expect(d.locator('.pl-menu [data-run="add-condition"]')).toHaveText('Bedingung hinzufügen…');
        await d.locator('.pl-menu [data-run="add-condition"]').click();
        await expect(f.locator('.plr-temp .plr-pickn')).toHaveText('Bedingung wählen…');
        await page.keyboard.press('Escape');
        await expect(f.locator('.plr-temp')).toHaveCount(0);
        // Nothing past the edge.
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
    });
});

test.describe('Templates: a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the custom rule\'s ⋯ starts from a template and saves one; the name dialog fits the screen', async ({ page }) => {
        await family(page);
        await openNew(page);
        const f = form(page);
        await tile(page, 'custom').locator('.pln-opt-label').tap();
        // The template button is not in the line "Based on" on a phone: ⋯ has it, as a sheet.
        await expect(f.locator('.pln-tbtn')).toBeHidden();
        await f.locator('.pln-more').tap();
        const sheet = page.locator('.bottom-sheet-menu');
        const sheetItem = (id: string) => sheet.locator(`.bottom-sheet-item[data-id="${id}"]`);
        await expect(sheetItem('templates')).toHaveText('Start from a template…');
        await expect(sheetItem('save-template')).toBeDisabled();
        await expect(page.locator('.plr-menu')).toHaveCount(0);
        await sheetItem('templates').tap();
        await expect(sheetItem('living')).toBeVisible();
        expect((await sheetItem('living').boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await sheetItem('living').tap();
        await expect(f.locator('.pln-from')).toContainText('From template: Living people');
        await expect(f.locator('.plr-row')).toHaveCount(1);
        await f.locator('.pln-more').tap();
        await sheetItem('save-template').tap();
        const dlg = nameDlg(page);
        await expect(dlg).toBeVisible();
        const box = (await dlg.locator('.plt-modal').boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        expect((await dlg.locator('[data-act="tpl-save"]').boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await dlg.locator('[data-act="tpl-save"]').tap();
        await expect(dlg).toHaveCount(0);
        expect((await templates(page)).map(t => t.name)).toEqual(['Living people']);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    });
});
