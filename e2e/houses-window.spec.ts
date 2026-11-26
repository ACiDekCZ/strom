import { test, expect, Page, Locator } from '@playwright/test';
import { openApp, seedTree, seedSetting, SeedPerson } from './helpers.js';
import { chooseMapWholeTree } from './map-scope-helpers.js';

/**
 * The Houses window (spec 030 §1, K1.1, K1.2): offered in the tree's menu only
 * for a tree with a numbered house; towns with their houses, the search, a row
 * opened in place with its people (a click goes to the person), "Houses in
 * this town ›" from the Places dialog and from the town's bubble on the map,
 * and a phone of 390 px without a sideways scroll.
 *
 * Invented villages: Bělokamen with čp. 16 (numbered 9 before a renumbering)
 * where Dobromil Kvitelka married in, čp. 7 of the Trnovec family and čp. 40
 * below the threshold; Hvozdnice with čp. 3, čp. 5 and a street with a number,
 * Kopřivná 12.
 */

const PEOPLE: Record<string, SeedPerson> = {
    svatobor: { firstName: 'Svatobor', lastName: 'Prouzal', birthPlace: 'Bělokamen', birthAddress: 'čp. 9', birthDate: '1820', partners: ['radegunda'] },
    radegunda: {
        firstName: 'Radegunda', lastName: 'Prouzalová', gender: 'female', birthPlace: 'Mlýnkovice', birthDate: '1824',
        deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1890', partners: ['svatobor'],
    },
    hostivit: {
        firstName: 'Hostivít', lastName: 'Prouzal', birthPlace: 'Bělokamen', birthAddress: 'čp. 9', birthDate: '1848',
        deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1910', parents: ['svatobor', 'radegunda'],
    },
    dobroslava: {
        firstName: 'Dobroslava', lastName: 'Prouzalová', gender: 'female', birthPlace: 'Bělokamen', birthAddress: 'čp. 9', birthDate: '1850',
        deathDate: '1920', parents: ['svatobor', 'radegunda'], partners: ['dobromil'],
    },
    dobromil: {
        firstName: 'Dobromil', lastName: 'Kvitelka', birthPlace: 'Mlýnkovice', birthDate: '1847',
        deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1915', partners: ['dobroslava'],
    },
    radhost: {
        firstName: 'Radhost', lastName: 'Kvitelka', birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1875', deathDate: '1940',
        parents: ['dobroslava', 'dobromil'],
        events: [{ id: 'e-radhost-res', type: 'residence', place: 'Hvozdnice', address: 'čp. 5', date: '1900' }],
    },
    lubomir: { firstName: 'Lubomír', lastName: 'Trnovec', birthPlace: 'Bělokamen', birthAddress: 'čp. 7', birthDate: '1830', deathDate: '1890' },
    kresomysl: {
        firstName: 'Křesomysl', lastName: 'Trnovec', birthPlace: 'Bělokamen', birthAddress: 'čp. 7', birthDate: '1862', deathDate: '1930',
        parents: ['lubomir'],
    },
    hroznata: { firstName: 'Hroznata', lastName: 'Trnovec', birthPlace: 'Bělokamen', birthAddress: 'čp. 40', birthDate: '1900', deathDate: '1970' },
    kapradin: {
        firstName: 'Kapradin', lastName: 'Kvitelka', birthPlace: 'Hvozdnice', birthAddress: 'čp. 3', birthDate: '1840', deathDate: '1900',
        events: [{ id: 'e-kapradin-res', type: 'residence', place: 'Hvozdnice', address: 'Kopřivná 12', date: '1880' }],
    },
    lubomira: {
        firstName: 'Lubomíra', lastName: 'Kvitelková', gender: 'female', birthPlace: 'Hvozdnice', birthAddress: 'čp. 3', birthDate: '1871',
        deathDate: '1950', parents: ['kapradin'],
    },
};

/** The villages, with čp. 9 joined into čp. 16 (a renumbering) and the map's point of Bělokamen. */
async function seedVillages(page: Page): Promise<void> {
    await seedTree(page, PEOPLE, 'Prouzal', 'hostivit');
    await page.evaluate(async () => {
        const S = window.Strom;
        S.DataManager.setHouseUserData('belokamen|16' as never, { name: 'U Prouzalů', merged: ['belokamen|9' as never] }, 'čp. 16');
        S.DataManager.setPlaceGeos(new Map(Object.entries({ belokamen: { lat: 49.61, lon: 15.42 }, hvozdnice: { lat: 49.7, lon: 15.6 }, mlynkovice: { lat: 49.4, lon: 15.1 } })));
        await S.TreeManager.flush();
        S.UI.dismissUndoToast();
        document.querySelectorAll('.toast, .family-offer').forEach(t => t.remove());
    });
}

const win = (page: Page): Locator => page.locator('#houses-modal');
const town = (page: Page, key: string): Locator => win(page).locator(`.house-town[data-town="${key}"]`);
const row = (page: Page, id: string): Locator => win(page).locator(`.house-row[data-house="${id}"]`);

/** The tree's own menu (the toolbar's ⋯ → the tree's row). */
async function openTreeMenu(page: Page): Promise<Locator> {
    await page.locator('.actions-menu-btn').click();
    const submenu = page.locator('#actions-tree-submenu');
    await page.locator('#actions-tree-row').hover();
    await expect(submenu).toBeVisible();
    return submenu;
}

test.describe('the Houses window', () => {
    test.use({ viewport: { width: 1280, height: 860 } });

    test('the tree menu offers Houses… only for a tree with a numbered house', async ({ page }) => {
        await openApp(page);
        await seedTree(page, { orwin: { firstName: 'Orwin', lastName: 'Halvek', birthPlace: 'Hvozdnice', birthDate: '1850' } }, 'Halvek');
        let submenu = await openTreeMenu(page);
        await expect(submenu.locator('[data-action="places"]')).toBeVisible();
        await expect(submenu.locator('[data-action="houses"]')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');

        await seedVillages(page);
        submenu = await openTreeMenu(page);
        const item = submenu.locator('[data-action="houses"]');
        await expect(item).toHaveText(/Houses…/);
        await item.click();
        await expect(win(page)).toBeVisible();
        await expect(win(page).locator('#houses-title')).toHaveText('Houses');
    });

    test('towns, a renumbered house, the search, a row opened in place and a person in the tree', async ({ page }) => {
        await openApp(page);
        await seedVillages(page);
        await page.evaluate(() => window.Strom.UI.showHousesWindow());
        await expect(win(page)).toBeVisible();

        // Bělokamen has the most houses: first; its house below the threshold is under "More houses".
        await expect(win(page).locator('.house-town .house-town-h .t')).toHaveText(['Bělokamen', 'Hvozdnice']);
        await expect(win(page).locator('#houses-count')).toHaveText('6 houses in 2 towns');
        const cp16 = row(page, 'belokamen|16');
        await expect(cp16.locator('.house-no')).toContainText('čp. 16');
        await expect(cp16.locator('.house-no .was')).toHaveText('(formerly 9)');
        await expect(cp16.locator('.house-no .hn')).toHaveText('U Prouzalů');
        await expect(cp16.locator('.seq')).toHaveText('Prouzal → Kvitelka');
        // Both came from elsewhere to a partner born in the house (čp. 9 counts as čp. 16).
        await expect(cp16.locator('.house-tag')).toHaveText([/^married in Radegunda/, 'married in Dobromil Kvitelka']);
        await expect(row(page, 'belokamen|40')).toHaveCount(0);
        const more = town(page, 'belokamen').locator('.house-more-h');
        await expect(more).toContainText('More houses (1)');
        await more.click();
        await expect(row(page, 'belokamen|40')).toBeVisible();

        // The search: a surname, the count in the field; nothing found says so and clears.
        const search = win(page).locator('#houses-filter');
        await search.fill('Trnovec');
        await expect(win(page).locator('#houses-filter-count')).toHaveText('2 of 6');
        await expect(row(page, 'belokamen|7')).toBeVisible();
        await expect(cp16).toHaveCount(0);
        await expect(town(page, 'hvozdnice')).toHaveCount(0);
        await search.fill('Zzyzx');
        await expect(win(page).locator('.houses-empty')).toContainText('No house matches “Zzyzx”.');
        await win(page).locator('.houses-empty-clear').click();
        await expect(search).toHaveValue('');
        await expect(cp16).toBeVisible();

        // A row opens in place: the facts, the people by year; a name goes to that person in the tree.
        await cp16.locator('.house-main').click();
        await expect(cp16).toHaveClass(/open/);
        await expect(cp16.locator('.house-chev')).toHaveAttribute('aria-expanded', 'true');
        const detail = win(page).locator('.house-detail[data-house="belokamen|16"]');
        await expect(detail).toBeVisible();
        await expect(detail.locator('.house-person').first().locator('.y')).toHaveText('1820');
        await detail.locator('button.p', { hasText: 'Radhost Kvitelka' }).click();
        await expect(win(page)).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId())).toBe('radhost');
    });

    test('a long name after the farm shows whole in two lines of the number\'s column', async ({ page }) => {
        await openApp(page);
        await seedVillages(page);
        await page.evaluate(() => window.Strom.DataManager.setHouseUserData('belokamen|16' as never,
            { name: 'U Starého Prouzala pod Lesem', merged: ['belokamen|9' as never] }, 'čp. 16'));
        await page.evaluate(() => window.Strom.UI.showHousesWindow());
        const hn = row(page, 'belokamen|16').locator('.house-no .hn');
        await expect(hn).toHaveText('U Starého Prouzala pod Lesem');
        const fit = await hn.evaluate(el => ({ cut: el.scrollHeight > el.clientHeight + 1, lines: Math.round(el.clientHeight / parseFloat(getComputedStyle(el).lineHeight)) }));
        expect(fit).toEqual({ cut: false, lines: 2 });
    });

    test('"Houses in this town ›" in the Places dialog opens the window on that town and Close goes back', async ({ page }) => {
        await openApp(page);
        await seedVillages(page);
        await page.evaluate(() => window.Strom.UI.showPlacesManager(undefined, undefined, 'tree'));
        const places = page.locator('#places-modal');
        await expect(places).toBeVisible();
        const link = places.locator('.place-town-houses[data-town="Bělokamen"]');
        await expect(link).toHaveText('Houses in this town ›');
        // A town without a numbered house has no link.
        await expect(places.locator('.place-town-houses[data-town="Mlýnkovice"]')).toHaveCount(0);
        await link.click();
        await expect(win(page)).toBeVisible();
        await expect(places).toBeHidden();
        await expect(win(page).locator('.houses-town-chip')).toContainText('Town: Bělokamen');
        await expect(win(page).locator('.house-town')).toHaveCount(1);
        // The chip lets all towns back.
        await win(page).locator('.houses-town-chip').click();
        await expect(win(page).locator('.house-town')).toHaveCount(2);
        await win(page).locator('#houses-close').click();
        await expect(win(page)).toHaveCount(0);
        await expect(places).toBeVisible();
    });

    test('"Houses in this town ›" in the town\'s bubble on the map', async ({ page }) => {
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
        await page.route('**://tile.openstreetmap.org/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: png }));
        await page.route('**://nominatim.openstreetmap.org/**', route => route.abort());
        await seedSetting(page, 'mapTiles', true);
        await openApp(page);
        await seedVillages(page);
        await page.evaluate(() => window.Strom.UI.setDisplayViewMode('map'));
        await chooseMapWholeTree(page);
        await page.evaluate(() => window.Strom.UI.showMapPlace('belokamen'));
        const popup = page.locator('.map-popup');
        const link = popup.locator('.map-popup-town-houses');
        await expect(link).toHaveText('Houses in this town ›');
        await page.evaluate(() => window.Strom.UI.showMapPlace('mlynkovice'));
        await expect(popup.locator('.map-popup-fix')).toHaveAttribute('data-key', /mlynkovice/);
        await expect(popup.locator('.map-popup-town-houses')).toHaveCount(0);
        await page.evaluate(() => window.Strom.UI.showMapPlace('belokamen'));
        await popup.locator('.map-popup-town-houses').click();
        await expect(win(page)).toBeVisible();
        await expect(win(page).locator('.houses-town-chip')).toContainText('Town: Bělokamen');
    });
});

test.describe('the Houses window on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('full screen, a row in two lines, Terms in the header menu, no sideways scroll', async ({ page }) => {
        await openApp(page);
        await seedVillages(page);
        await page.evaluate(() => window.Strom.UI.showHousesWindow());
        const modal = win(page).locator('.houses-modal');
        await expect(modal).toBeVisible();
        const box = (await modal.boundingBox())!;
        expect(Math.round(box.width)).toBe(390);
        expect(Math.round(box.height)).toBe(844);
        // No footer on a phone: Terms is a text button in the header, left of ? (question 3).
        await expect(win(page).locator('.houses-footer')).toBeHidden();
        await row(page, 'belokamen|16').locator('.house-main .seq').click();
        await expect(win(page).locator('.house-detail[data-house="belokamen|16"]')).toBeVisible();
        const fits = await page.evaluate(() => {
            const els = [document.documentElement, ...document.querySelectorAll<HTMLElement>('#houses-modal .modal, #houses-modal .modal-content, #houses-modal .houses-bar')];
            return els.every(el => el.scrollWidth <= el.clientWidth);
        });
        expect(fits).toBe(true);
        // The period stands on the number's line, the surnames under it.
        const no = (await row(page, 'belokamen|16').locator('.house-no').boundingBox())!;
        const per = (await row(page, 'belokamen|16').locator('.per').boundingBox())!;
        const seq = (await row(page, 'belokamen|16').locator('.seq').boundingBox())!;
        expect(Math.abs(per.y - no.y)).toBeLessThan(no.height);
        expect(seq.y).toBeGreaterThanOrEqual(no.y + no.height - 1);
        const head = win(page).locator('#houses-head-terms');
        await expect(head).toHaveText('Terms');
        const headBox = (await head.boundingBox())!;
        const help = (await win(page).locator('.modal-header > .help-mark').boundingBox())!;
        expect(headBox.x + headBox.width).toBeLessThanOrEqual(help.x + 1);
        await head.click();
        await expect(head).toHaveAttribute('aria-expanded', 'true');
        await expect(win(page).locator('#houses-terms')).toBeVisible();
        const terms = (await win(page).locator('#houses-terms').boundingBox())!;
        expect(terms.x).toBeGreaterThanOrEqual(0);
        expect(terms.x + terms.width).toBeLessThanOrEqual(390);
    });

    test('a long name of a married-in keeps "married in" on the tag\'s one line; the search has one ring', async ({ page }) => {
        await openApp(page);
        await seedVillages(page);
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            dm.updatePerson('radegunda' as never, { lastName: 'Kvitelková-Prouzalovská-Trnovcová' } as never);
        });
        await page.evaluate(() => window.Strom.UI.showHousesWindow());
        const tags = row(page, 'belokamen|16').locator('.house-tag');
        await expect(tags.first()).toContainText('Kvitelková-Prouzalovská');
        // The name shortens, the words before it do not wrap.
        for (const tag of await tags.all()) expect((await tag.boundingBox())!.height).toBeLessThan(26);
        // The field's frame is the ring; the input inside draws no halo of its own.
        await win(page).locator('#houses-filter').focus();
        expect(await win(page).locator('#houses-filter').evaluate(el => getComputedStyle(el).boxShadow)).toBe('none');
    });
});
