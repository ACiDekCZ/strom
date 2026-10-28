import { test, expect, type Page } from '@playwright/test';
import { openApp, createFirstPerson, card, cardAction, personModal } from './helpers.js';

/**
 * Places registry (K5): suggestions come from the tree's own places (nothing is
 * downloaded), and a place written several ways is flagged and can be unified
 * in one click.
 */
test('place suggestions come from the tree, most used first', async ({ page }) => {
    // Built from scratch rather than from the demo, which carries places of its
    // own — this is about the suggestions coming from THIS tree's places.
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1900' });
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const jan = dm.getAllPersons()[0];
        dm.updatePerson(jan.id, { birthPlace: 'Kolín', deathPlace: 'Kolín' });
        const marie = dm.createPerson({ firstName: 'Marie', lastName: 'Novakova', gender: 'female' });
        dm.updatePerson(marie.id, { birthPlace: 'Beroun' });
        window.Strom.TreeRenderer.render();
    });
    // Most used first: Kolín (2×) before Beroun (1×).
    await expect.poll(() => page.evaluate(() =>
        [...document.querySelectorAll('#places-datalist option')].map(o => (o as HTMLOptionElement).value)
    )).toEqual(['Kolín', 'Beroun']);

    // The birth-place field offers them.
    await cardAction(page, 'Jan', 'edit');
    await expect(personModal(page).locator('#input-birthplace')).toHaveAttribute('list', 'places-datalist');
});

test('a place written two ways is flagged and unified by the Fix button', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1900' });
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const jan = dm.getAllPersons()[0];
        dm.updatePerson(jan.id, { birthPlace: 'Děčín', deathPlace: 'decin' });
    });

    const treeId = await page.evaluate(() => window.Strom.TreeManager.getActiveTreeId());
    await page.evaluate((id) => window.Strom.UI.showTreeValidationDialog(id), treeId);
    const modal = page.locator('#tree-validation-modal');
    await expect(modal).toBeVisible();
    // A lead (Leads, its group closed until opened) named after the type.
    const group = modal.locator('.vq-group[data-type="placeSpelling"]');
    await expect(group.locator('.vq-group-name')).toContainText('written several ways');
    await group.locator('.vq-group-head').click();
    const issue = group.locator('.validation-issue');
    await expect(issue).toBeVisible();

    // One click unifies every spelling to the most-used one.
    await issue.locator('.validation-fix-btn').click();
    await expect(modal.locator('.vq-group[data-type="placeSpelling"]')).toHaveCount(0);
    const places = await page.evaluate(() => {
        const p = window.Strom.DataManager.getAllPersons()[0];
        return [p.birthPlace, p.deathPlace];
    });
    expect(places[0]).toBe(places[1]);   // same spelling now
});

test('the places manager cleans up orphaned coordinates (undoable)', async ({ page }) => {
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak');
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const jan = dm.getAllPersons()[0];
        dm.updatePerson(jan.id, { birthPlace: 'Kolín' });
        // One live pin (Kolín, Jan's birthplace) + one orphan pin (Praha —
        // nobody in the tree writes Praha any more).
        dm.setPlaceGeos(new Map([
            ['kolin', { lat: 50.0, lon: 15.2, label: 'Kolín' }],
            ['praha', { lat: 50.08, lon: 14.42, label: 'Praha' }],
        ]));
        window.Strom.TreeRenderer.render();
    });

    await page.evaluate(() => window.Strom.UI.showPlacesManager());
    const modal = page.locator('#places-modal');
    await expect(modal).toBeVisible();

    // The footer offers the cleanup with the orphan count.
    const cleanBtn = page.locator('#places-clean-orphans');
    await expect(cleanBtn).toBeEnabled();
    await expect(cleanBtn).toContainText('(1)');

    await cleanBtn.click();
    await page.locator('#confirmation-modal #confirm-ok-btn').click();

    // Only the orphan is gone; the live pin stays.
    await expect.poll(() => page.evaluate(() =>
        Object.keys(window.Strom.DataManager.getData().places || {}).sort()
    )).toEqual(['kolin']);

    // Undo restores the orphan (it went through the normal mutation path).
    await page.evaluate(() => window.Strom.DataManager.undo());
    await expect.poll(() => page.evaluate(() =>
        Object.keys(window.Strom.DataManager.getData().places || {}).sort()
    )).toEqual(['kolin', 'praha']);
});

/**
 * The Places dialog (1028): alphabetical as the UI language sorts, a search over
 * the list (no diacritics needed), a "No location" chip so places without
 * coordinates do not get lost, and opening on a place still works with a filter.
 */
test.describe('the Places dialog: order, search and the "No location" chip', () => {
    async function setup(page: Page): Promise<void> {
        await openApp(page);
        await createFirstPerson(page, 'Jan', 'Lhoták');
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const jan = dm.getAllPersons()[0];
            dm.updatePerson(jan.id, { birthPlace: 'Chotěboř', deathPlace: 'Hlinsko' });
            for (const [firstName, birthPlace] of [['Marie', 'Čáslav'], ['Petra', 'Cerhenice'], ['Anna', 'Ivančice'], ['Hana', 'Chrudim']]) {
                const p = dm.createPerson({ firstName, lastName: 'Lhotáková', gender: 'female' });
                dm.updatePerson(p.id, { birthPlace });
            }
            dm.setPlaceGeos(new Map([
                ['hlinsko', { lat: 49.76, lon: 15.9, label: 'Hlinsko' }],
                ['cerhenice', { lat: 50.07, lon: 15.07, label: 'Cerhenice' }],
            ]));
            window.Strom.UI.setLanguage('cs' as never);
            window.Strom.TreeRenderer.render();
        });
    }
    const modal = (page: Page) => page.locator('#places-modal');
    const shownKeys = (page: Page) => page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('#places-modal .place-row')].filter(r => !r.hidden).map(r => r.dataset.key));
    const open = (page: Page, focusKey?: string) =>
        page.evaluate((k) => window.Strom.UI.showPlacesManager(k, undefined, 'tree'), focusKey);

    test('alphabetical in Czech ("Ch" after "H"), not the places without coordinates first', async ({ page }) => {
        await setup(page);
        await open(page);
        await expect(modal(page)).toBeVisible();
        expect(await shownKeys(page)).toEqual(['cerhenice', 'caslav', 'hlinsko', 'chotebor', 'chrudim', 'ivancice']);
        // Without coordinates still marked.
        await expect(modal(page).locator('.place-row-unplaced')).toHaveCount(4);
        await expect(modal(page).locator('.place-row[data-key="caslav"] .place-hint')).toHaveText('Zatím není na mapě');
    });

    test('the search finds a place without diacritics, counts and says when nothing matches', async ({ page }) => {
        await setup(page);
        await open(page);
        const search = modal(page).locator('#places-filter');
        await expect(search).toHaveAttribute('placeholder', 'Hledat místo');
        await search.fill('caslav');
        await expect.poll(() => shownKeys(page)).toEqual(['caslav']);
        await expect(modal(page).locator('#places-filter-count')).toHaveText('1 ze 6');
        await expect(modal(page).locator('#places-filter-none')).toBeHidden();

        await search.fill('lhota u nikde');
        await expect.poll(() => shownKeys(page)).toEqual([]);
        await expect(modal(page).locator('#places-filter-none')).toHaveText('Žádné místo neodpovídá.');
        await expect(modal(page).locator('#places-filter-none')).toBeVisible();

        // × empties it: the whole list again.
        await modal(page).locator('#places-filter-clear').click();
        await expect.poll(() => shownKeys(page)).toHaveLength(6);
        await expect(modal(page).locator('#places-filter-count')).toHaveText('');

        // Escape empties the search first and the dialog stays; the next one closes it.
        await search.fill('ch');
        await expect.poll(() => shownKeys(page)).toEqual(['chotebor', 'chrudim']);
        await search.press('Escape');
        await expect(search).toHaveValue('');
        await expect(modal(page)).toBeVisible();
        await expect.poll(() => shownKeys(page)).toHaveLength(6);
        await search.press('Escape');
        await expect(modal(page)).toHaveCount(0);
    });

    test('the "No location" chip shows only the places without coordinates, with their count', async ({ page }) => {
        await setup(page);
        await open(page);
        const chip = modal(page).locator('#places-unplaced');
        await expect(chip).toHaveText('Bez polohy 4');
        await expect(chip).toHaveAttribute('aria-pressed', 'false');
        await chip.click();
        await expect(chip).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(() => shownKeys(page)).toEqual(['caslav', 'chotebor', 'chrudim', 'ivancice']);
        await expect(modal(page).locator('#places-filter-count')).toHaveText('4 ze 6');
        // Together with the search.
        await modal(page).locator('#places-filter').fill('ch');
        await expect.poll(() => shownKeys(page)).toEqual(['chotebor', 'chrudim']);
    });

    test('a redraw keeps the filter; opening on a place the filter hides shows the whole list', async ({ page }) => {
        await setup(page);
        await open(page);
        await modal(page).locator('#places-unplaced').click();
        await modal(page).locator('#places-filter').fill('caslav');
        await expect.poll(() => shownKeys(page)).toEqual(['caslav']);

        // A rename or a pin redraws the dialog: the filter stays.
        await page.evaluate(() => window.Strom.UI.refreshPlacesManager());
        await expect(modal(page).locator('#places-filter')).toHaveValue('caslav');
        await expect(modal(page).locator('#places-unplaced')).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(() => shownKeys(page)).toEqual(['caslav']);

        // Opened on Hlinsko (it has coordinates and the search hides it): the filter goes, its row is open.
        await page.evaluate(() => window.Strom.UI.refreshPlacesManager('hlinsko'));
        const row = modal(page).locator('.place-row[data-key="hlinsko"]');
        await expect(row).toBeVisible();
        await expect(row.locator('.place-search')).toBeVisible();
        await expect(modal(page).locator('#places-filter')).toHaveValue('');
        await expect(modal(page).locator('#places-unplaced')).toHaveAttribute('aria-pressed', 'false');
        await expect.poll(() => shownKeys(page)).toHaveLength(6);

        // A fresh open on a place starts with the whole list too.
        await modal(page).locator('#places-filter').fill('ivan');
        await page.evaluate(() => window.Strom.UI.closePlacesManager());
        await open(page, 'chrudim');
        await expect(modal(page).locator('.place-row[data-key="chrudim"] .place-search')).toBeVisible();
        await expect(modal(page).locator('#places-filter')).toHaveValue('');
        await expect.poll(() => shownKeys(page)).toHaveLength(6);
    });

    test.describe('phone', () => {
        test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
        test('the search and the chip share one row inside the screen, 44 px to tap', async ({ page }) => {
            await setup(page);
            await open(page);
            await expect(modal(page).locator('#places-unplaced')).toBeVisible();
            const box = await page.evaluate(() => {
                const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
                const search = r('#places-modal .hm-search'), chip = r('#places-unplaced');
                return { searchTop: search.top, chipTop: chip.top, chipRight: chip.right, chipH: chip.height, searchH: search.height, vw: window.innerWidth };
            });
            expect(Math.abs(box.searchTop - box.chipTop)).toBeLessThan(6);
            expect(box.chipRight).toBeLessThanOrEqual(box.vw);
            expect(box.chipH).toBeGreaterThanOrEqual(44);
            expect(box.searchH).toBeGreaterThanOrEqual(44);
        });
    });
});
