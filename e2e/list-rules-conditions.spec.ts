/**
 * The conditions of a custom list rule (spec 136 §3, §3.3, §4, §6): the
 * catalog with its group headings and search (conditions without data in the
 * tree are not offered); the choice of an occupation (several at once) and of
 * a place with a search; Place and surroundings with located places and one
 * without a location (the distances disabled with the reason); Family of a
 * person with its quick choices and axes; the counts of the rows and the
 * footer, "0 here" where the people ran out, "Show in the tree" and back by
 * Back to the rule, × and Escape (the dialog returns with the rule, the view
 * as it was); added / changed in a period on a fixed clock. English, one pass
 * in German, the phone (Show in the tree from ⋯). Invented names only.
 */

import { test, expect, Page } from '@playwright/test';
import { openApp, card } from './helpers';

/** Away from midnight UTC: the periods "24 hours" and "since a day" do not split. */
const NOW = new Date('2026-11-16T10:30:00Z');

interface Seed { firstName: string; lastName: string; gender?: 'male' | 'female'; parents?: string[]; partners?: string[]; [k: string]: unknown }

const occ = (who: string, note: string) => ({ events: [{ id: `o-${who}`, type: 'occupation', note }] });

/**
 * Arvid Quellmayer (a "Mlynář", born in Mlýnky) and Dorota Talvanen (born in
 * Vrbatín, 6 km away) have Benedikt (a "mlynář", born in Mlýnky), Cilka (born
 * in Horní Vranice, without a location) and Edvin (a teacher, born in Dolní
 * Krsovec, 40 km away). Benedikt and Eliška Ostrovid have Gustav (a "Mlynář"). Added at
 * different times before NOW; Dorota changed an hour ago; Gustav without a
 * date added (an older tree).
 */
const PEOPLE: Record<string, Seed> = {
    b: { firstName: 'Benedikt', lastName: 'Quellmayer', parents: ['a', 'd'], partners: ['e'], birthDate: '1850', birthPlace: 'Mlýnky', ...occ('b', 'mlynář'), addedAt: '2026-11-12T09:00:00.000Z' },
    a: { firstName: 'Arvid', lastName: 'Quellmayer', partners: ['d'], birthDate: '1820', deathDate: '1880', birthPlace: 'Mlýnky', ...occ('a', 'Mlynář'), addedAt: '2026-11-16T08:00:00.000Z' },
    d: { firstName: 'Dorota', lastName: 'Talvanen', gender: 'female', partners: ['a'], birthDate: '1825', deathDate: '1890', birthPlace: 'Vrbatín', addedAt: '2026-01-05T09:00:00.000Z', changedAt: '2026-11-16T09:30:00.000Z' },
    c: { firstName: 'Cilka', lastName: 'Quellmayer', gender: 'female', parents: ['a', 'd'], birthDate: '1852', birthPlace: 'Horní Vranice', addedAt: '2026-10-25T09:00:00.000Z' },
    v: { firstName: 'Edvin', lastName: 'Quellmayer', parents: ['a', 'd'], birthDate: '1855', birthPlace: 'Dolní Krsovec', ...occ('v', 'Učitel'), addedAt: '2026-01-05T09:00:00.000Z' },
    e: { firstName: 'Eliška', lastName: 'Ostrovid', gender: 'female', partners: ['b'], birthDate: '1853', addedAt: '2026-01-05T09:00:00.000Z' },
    g: { firstName: 'Gustav', lastName: 'Quellmayer', parents: ['b', 'e'], birthDate: '1880', ...occ('g', 'Mlynář') },
};

/** Mlýnky and Vrbatín 6 km apart, Dolní Krsovec 40 km away; Horní Vranice without a location. */
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
/** A row's own count (not its group's rows). */
const count = (page: Page, path: string) => row(page, path).locator('> .plr-k');
const ctl = (page: Page, path: string, pc: string, v?: string) =>
    row(page, path).locator(`> .plr-m [data-pc="${pc}"]${v !== undefined ? `[data-v="${v}"]` : ''}`);

/** The new list dialog on the custom rule. */
async function openCustom(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.showPersonLists());
    await lists(page).locator('.pl-new').first().click();
    await expect(form(page)).toBeVisible();
    await tile(page, 'custom').locator('.pln-opt-label').click();
    await expect(form(page).locator('.pln-modal')).toHaveClass(/pln-modal--rule/);
}

/** "+ Add condition" of the rule: the catalog. */
async function openCatalog(page: Page): Promise<void> {
    await form(page).locator('.plr > .plr-add [data-rb="add"]').click();
    await expect(menu(page)).toBeVisible();
}

async function addCond(page: Page, c: string): Promise<void> {
    await openCatalog(page);
    await item(page, c).click();
}

const visibleTexts = (page: Page, sel: string) => menu(page).locator(sel).evaluateAll(els =>
    els.filter(e => !(e as HTMLElement).hidden).map(e => (e.querySelector('.pl-menu-label')?.firstChild?.textContent ?? e.textContent ?? '').trim()));

test.describe('Conditions: a computer', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the catalog: group headings, a search over names and descriptions, no conditions without data', async ({ page }) => {
        await family(page);
        await openCustom(page);
        await openCatalog(page);
        const search = menu(page).locator('.pl-msearch');
        await expect(search).toBeFocused();
        await expect(search).toHaveAttribute('placeholder', 'Find a condition');
        expect(await visibleTexts(page, '.pl-mh')).toEqual(['Family and lines', 'Life in time', 'Places', 'Person', 'Facts', 'From the tree and the Table']);
        // The first group starts with Family of a person; occupations are in the tree.
        await expect(menu(page).locator('.pl-menu-item').first()).toHaveAttribute('data-id', 'family');
        await expect(item(page, 'occupation')).toHaveCount(1);
        await expect(item(page, 'family').locator('.pl-menu-sub')).toHaveText('ancestors, descendants, siblings, cousins, spouses');
        // No other list, no research line, no Table view: those are not offered.
        for (const c of ['list', 'line', 'tableFilter']) await expect(item(page, c)).toHaveCount(0);

        // The search goes through the descriptions too, without accents; headings over hidden rows go.
        await search.fill('residence');
        expect(await visibleTexts(page, '.pl-menu-item')).toEqual(['Place and surroundings']);
        expect(await visibleTexts(page, '.pl-mh')).toEqual(['Places']);
        await search.fill('COUSINS');
        expect(await visibleTexts(page, '.pl-menu-item')).toEqual(['Family of a person']);
        await search.fill('zzzz');
        expect(await visibleTexts(page, '.pl-menu-item')).toEqual([]);
        await expect(menu(page).locator('.pl-mnone')).toBeVisible();
        await expect(menu(page).locator('.pl-mnone')).toHaveText('No condition matches.');
        // Enter takes the first row shown.
        await search.fill('age at');
        await search.press('Enter');
        await expect(menu(page)).toHaveCount(0);
        await expect(row(page, '0').locator('> .plr-m > .plr-n')).toHaveText('Age at death');
        // Escape in the catalog closes only the catalog.
        await openCatalog(page);
        await page.keyboard.press('Escape');
        await expect(menu(page)).toHaveCount(0);
        await expect(form(page)).toBeVisible();
    });

    test('occupations several at once; a place with a search; surroundings disabled without a location, the counts of the rows', async ({ page }) => {
        await family(page);
        await openCustom(page);

        // Occupation: the choice opens at once, several rows ticked, saved when it closes.
        await addCond(page, 'occupation');
        await expect(menu(page)).toHaveAttribute('aria-label', 'Occupations');
        await expect(menu(page).locator('.pl-mlist')).toHaveAttribute('aria-multiselectable', 'true');
        const miller = menu(page).locator('.pl-menu-item').first();
        await expect(miller.locator('.pl-menu-label')).toContainText('Mlynář');
        await expect(miller.locator('.pl-menu-sub')).toHaveText('mlynář');
        await expect(miller.locator('.pl-menu-val')).toHaveText('3 people');
        await miller.click();
        await expect(miller).toHaveAttribute('aria-selected', 'true');
        await menu(page).locator('.pl-menu-item', { hasText: 'Učitel' }).click();
        await expect(menu(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(menu(page)).toHaveCount(0);
        await expect(ctl(page, '0', 'values')).toHaveText(/Mlynář, Učitel/);
        await expect(total(page)).toHaveText('4 people match');

        // Place and surroundings: the place's choice opens at once, most people first.
        await addCond(page, 'near');
        await expect(menu(page)).toHaveAttribute('aria-label', 'Place');
        const first = menu(page).locator('.pl-menu-item').first();
        await expect(first.locator('.pl-menu-label')).toHaveText('Mlýnky');
        await expect(first.locator('.pl-menu-val')).toHaveText('2 people');
        await expect(total(page)).toHaveText('Condition 2 is incomplete');
        await menu(page).locator('.pl-msearch').fill('vranice');
        await menu(page).locator('.pl-msearch').press('Enter');
        await expect(menu(page)).toHaveCount(0);
        await expect(ctl(page, '1', 'place')).toContainText('Horní Vranice');

        // Without a location: the place only; every distance disabled with the reason.
        const noCoords = 'The place has no location on the map – by name only.';
        await expect(ctl(page, '1', 'km', '0')).toHaveAttribute('aria-pressed', 'true');
        for (const v of ['5', '10', '25', '50', 'other']) {
            await expect(ctl(page, '1', 'km', v)).toHaveAttribute('aria-disabled', 'true');
            await expect(ctl(page, '1', 'km', v)).toHaveAttribute('title', noCoords);
        }
        await ctl(page, '1', 'km', '10').click({ force: true });
        await expect(ctl(page, '1', 'km', '0')).toHaveAttribute('aria-pressed', 'true');
        await expect(row(page, '1').locator('.plr-sx')).toContainText(noCoords);
        await expect(row(page, '1').locator('.plr-sx [data-pc="fixone"]')).toHaveText('Add the location on the Map ›');
        // Cilka was born there, she is no miller or teacher: nobody, "0 here" on the place.
        await expect(count(page, '1')).toHaveText('1 person');
        await expect(total(page)).toHaveText('Nobody matches');
        await expect(row(page, '1').locator('.plr-zero')).toHaveText('0 here');
        await expect(row(page, '0').locator('.plr-zero')).toHaveCount(0);
        await expect(form(page).locator('.pln-foot [data-act="show-tree"]')).toBeHidden();

        // Mlýnky has a location: the distances count, 10 km take Vrbatín in, 50 km Dolní Krsovec.
        await ctl(page, '1', 'place').click();
        await menu(page).locator('.pl-menu-item', { hasText: 'Mlýnky' }).click();
        await expect(ctl(page, '1', 'km', '10')).not.toHaveAttribute('aria-disabled', 'true');
        await expect(count(page, '1')).toHaveText('2 people');
        await expect(row(page, '1').locator('.plr-zero')).toHaveCount(0);
        await expect(total(page)).toHaveText('2 people match');
        await ctl(page, '1', 'km', '10').click();
        // The phone's one "within N km" control stays hidden beside the segments on a computer.
        await expect(ctl(page, '1', 'kmpick')).toBeHidden();
        await expect(count(page, '1')).toHaveText('3 people');
        await expect(row(page, '1').locator('.plr-sx')).toContainText('Within 10 km: 2 places');
        await row(page, '1').locator('.plr-sx [data-pc="unfold"]').click();
        await expect(row(page, '1').locator('.plr-places li .plr-pn')).toHaveText(['Mlýnky', 'Vrbatín']);
        await expect(row(page, '1').locator('.plr-places li .plr-pk')).toHaveText(['0 km', '6 km']);
        await ctl(page, '1', 'km', '50').click();
        await expect(count(page, '1')).toHaveText('4 people');
        await expect(count(page, '0')).toHaveText('4 people');
        await expect(total(page)).toHaveText('3 people match');
        // Other…: a field that starts at 100.
        await ctl(page, '1', 'km', 'other').click();
        await expect(row(page, '1').locator('input[data-pc="kmn"]')).toHaveValue('100');
        await form(page).locator('#pln-name').fill('Millers and teachers round Mlýnky');
        await expect(form(page).locator('[data-act="create"]')).toBeEnabled();
    });

    test('Family of a person: quick choices and axes agree, the count follows; "0 here"; Show in the tree and back by Back, × and Escape', async ({ page }) => {
        await family(page);
        await page.evaluate(() => window.Strom.TreeRenderer.setViewMode('descendants' as never));
        await openCustom(page);
        await addCond(page, 'family');
        // Benedikt in focus: two up and two down in the line.
        await expect(ctl(page, '0', 'person')).toContainText('Benedikt Quellmayer');
        await expect(count(page, '0')).toHaveText('4 people');
        await expect(row(page, '0').locator('[data-pc="preset"][aria-pressed="true"]')).toHaveCount(0);
        await ctl(page, '0', 'preset', 'closest').click();
        await expect(ctl(page, '0', 'preset', 'closest')).toHaveAttribute('aria-pressed', 'true');
        await expect(ctl(page, '0', 'width', 'siblings')).toHaveAttribute('aria-pressed', 'true');
        await expect(ctl(page, '0', 'spouses', 'spouses')).toHaveAttribute('aria-pressed', 'true');
        await expect(count(page, '0')).toHaveText('7 people');
        await ctl(page, '0', 'preset', 'ancestors').click();
        await expect(ctl(page, '0', 'preset', 'ancestors')).toHaveAttribute('aria-pressed', 'true');
        await expect(row(page, '0').locator('.plr-step').first().locator('.plr-sv')).toHaveText('all generations');
        await expect(ctl(page, '0', 'down', '-1')).toHaveAttribute('aria-disabled', 'true');
        await expect(count(page, '0')).toHaveText('3 people');
        // One more generation down: Gustav; the axes no longer match a quick choice.
        await ctl(page, '0', 'down', '1').click();
        await expect(row(page, '0').locator('[data-pc="preset"][aria-pressed="true"]')).toHaveCount(0);
        await expect(count(page, '0')).toHaveText('4 people');
        await expect(row(page, '0').locator('> .plr-m > .plr-s')).toHaveText(/Benedikt Quellmayer/);

        // Men of them: Arvid, Benedikt, Gustav.
        await addCond(page, 'gender');
        await ctl(page, '1', 'value', 'male').click();
        await expect(total(page)).toHaveText('3 people match');
        // Born 1900–1999: nobody is left, "0 here" on that row.
        await addCond(page, 'born');
        await row(page, '2').locator('input[data-pc="from"]').fill('1900');
        await row(page, '2').locator('input[data-pc="to"]').fill('1999');
        await row(page, '2').locator('input[data-pc="to"]').press('Enter');
        await expect(total(page)).toHaveText('Nobody matches');
        await expect(row(page, '2').locator('.plr-zero')).toHaveText('0 here');
        await expect(row(page, '1').locator('.plr-zero')).toHaveCount(0);
        await expect(form(page).locator('.pln-foot [data-act="show-tree"]')).toBeHidden();
        await row(page, '2').locator('input[data-pc="from"]').fill('1800');
        await row(page, '2').locator('input[data-pc="to"]').fill('1899');
        await row(page, '2').locator('input[data-pc="to"]').press('Enter');
        await expect(total(page)).toHaveText('3 people match');
        await expect(form(page).locator('.plr-zero')).toHaveCount(0);

        // Show in the tree: the dialogs hidden, the Family view, the three lit.
        const show = form(page).locator('.pln-foot [data-act="show-tree"]');
        const pill = page.locator('#evidence-pill');
        const viewMode = () => page.evaluate(() => window.Strom.TreeRenderer.getViewMode());
        const backToRule = async (how: 'back' | 'close' | 'escape'): Promise<void> => {
            await show.click();
            await expect(form(page)).toBeHidden();
            await expect(lists(page)).toBeHidden();
            await expect(pill).toBeVisible();
            await expect(pill.locator('.evidence-pill-label')).toContainText('Rule preview · 3 people');
            expect(await viewMode()).toBe('family');
            for (const n of ['Arvid', 'Benedikt', 'Gustav']) await expect(card(page, n)).toHaveClass(/evidence-hit/);
            await expect(card(page, 'Dorota')).toHaveClass(/evidence-dim/);
            if (how === 'back') {
                await expect(pill.locator('.evidence-pill-back')).toHaveText('Back to the rule');
                await pill.locator('.evidence-pill-back').click();
            } else if (how === 'close') await pill.locator('.evidence-pill-close').click();
            else await page.keyboard.press('Escape');
            // The dialog as it was, the view as it was, the focus on Show in the tree.
            await expect(pill).toHaveCount(0);
            await expect(form(page)).toBeVisible();
            await expect(lists(page)).toBeVisible();
            expect(await viewMode()).toBe('descendants');
            await expect(form(page).locator('.plr-row')).toHaveCount(3);
            await expect(row(page, '2').locator('input[data-pc="from"]')).toHaveValue('1800');
            await expect(total(page)).toHaveText('3 people match');
            await expect(show).toBeFocused();
        };
        await backToRule('back');
        await backToRule('escape');
        await backToRule('close');
    });

    test('added and changed in a period on a fixed clock', async ({ page }) => {
        await family(page);
        await openCustom(page);
        await addCond(page, 'added');
        await expect(ctl(page, '0', 'period', 'd7')).toHaveAttribute('aria-pressed', 'true');
        // Arvid two and a half hours ago, Benedikt four days ago, Cilka three weeks ago.
        await expect(total(page)).toHaveText('2 people match');
        // Gustav has no date added (part of the tree is older): from which version, without "Nothing yet" (§15).
        await expect(row(page, '0').locator('> .plr-m > .plr-s')).toHaveText('the date added is recorded from version 3.30 – people added earlier do not count');
        await ctl(page, '0', 'period', 'h24').click();
        await expect(total(page)).toHaveText('1 person matches');
        await ctl(page, '0', 'period', 'd30').click();
        await expect(total(page)).toHaveText('3 people match');
        await ctl(page, '0', 'period', 'since').click();
        const since = row(page, '0').locator('input[data-pc="since"]');
        await expect(since).toHaveValue('2026-11-16');
        await expect(since).toBeFocused();
        await expect(total(page)).toHaveText('1 person matches');
        await since.fill('2026-11-01');
        await expect(total(page)).toHaveText('2 people match');

        // Changed: Dorota an hour ago; the hint says from which version.
        await addCond(page, 'changed');
        await ctl(page, '1', 'period', 'h24').click();
        await expect(count(page, '1')).toHaveText('1 person');
        await expect(row(page, '1').locator('> .plr-m > .plr-s')).toHaveText('the change time is recorded from version 3.32 – older edits do not count');
        await expect(total(page)).toHaveText('Nobody matches');
        await expect(row(page, '1').locator('.plr-zero')).toHaveText('0 here');
    });

    test('German: the catalog, a place without a location, Show in the tree and back', async ({ page }) => {
        await family(page, 'de');
        await openCustom(page);
        await openCatalog(page);
        expect(await visibleTexts(page, '.pl-mh')).toEqual(['Familie und Linien', 'Leben in der Zeit', 'Orte', 'Person', 'Angaben', 'Aus dem Stammbaum und der Tabelle']);
        await item(page, 'near').click();
        await menu(page).locator('.pl-menu-item', { hasText: 'Horní Vranice' }).click();
        await expect(ctl(page, '0', 'km', '0')).toHaveText('nur der Ort');
        await expect(ctl(page, '0', 'km', '25')).toHaveAttribute('title', 'Der Ort hat keine Lage auf der Karte – nur nach Name.');
        await expect(total(page)).toHaveText('1 Person passt');
        await expect(row(page, '0').locator('.plr-zero')).toHaveCount(0);
        const show = form(page).locator('.pln-foot [data-act="show-tree"]');
        await expect(show).toHaveText('Im Stammbaum zeigen');
        await show.click();
        await expect(page.locator('#evidence-pill .evidence-pill-back')).toHaveText('Zurück zur Regel');
        await expect(card(page, 'Cilka')).toHaveClass(/evidence-hit/);
        await page.locator('#evidence-pill .evidence-pill-back').click();
        await expect(form(page)).toBeVisible();
        await expect(total(page)).toHaveText('1 Person passt');
    });
});

test.describe('Conditions: a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the distance as one control with the reason; Show in the tree from ⋯ and back', async ({ page }) => {
        await family(page);
        await page.evaluate(() => window.Strom.UI.showNewPersonList({
            custom: {
                t: 'group', op: 'all', items: [
                    { t: 'cond', c: 'near', p: { placeKey: 'horni vranice', placeName: 'Horní Vranice', events: ['birth', 'death', 'marriage', 'residence'], km: 0 } },
                ],
            },
        } as never));
        const f = form(page);
        await expect(total(page)).toHaveText('1 person matches');
        // One control "place only ▾" in place of the segment; its sheet disables the distances with the reason.
        await expect(ctl(page, '0', 'km', '0')).toBeHidden();
        const kmPick = ctl(page, '0', 'kmpick');
        await expect(kmPick).toBeVisible();
        await expect(kmPick).toContainText('place only');
        await kmPick.tap();
        const sheet = page.locator('.bottom-sheet-menu');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('.bottom-sheet-item', { hasText: 'within 10 km' })).toHaveAttribute('aria-disabled', 'true');
        await expect(sheet).toContainText('The place has no location on the map – by name only.');
        await sheet.locator('.bottom-sheet-item', { hasText: 'place only' }).tap();
        await expect(sheet).toHaveCount(0);

        // Show in the tree is in ⋯.
        await expect(f.locator('.pln-foot [data-act="show-tree"]')).toBeHidden();
        await f.locator('.pln-more').tap();
        await expect(sheet).toBeVisible();
        await sheet.locator('.bottom-sheet-item', { hasText: 'Show in the tree' }).tap();
        await expect(f).toBeHidden();
        const pill = page.locator('#evidence-pill');
        await expect(pill).toBeVisible();
        await expect(card(page, 'Cilka')).toHaveClass(/evidence-hit/);
        await pill.locator('.evidence-pill-back').tap();
        await expect(pill).toHaveCount(0);
        await expect(f).toBeVisible();
        await expect(total(page)).toHaveText('1 person matches');
    });
});
