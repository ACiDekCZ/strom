import { test, expect, Page } from '@playwright/test';
import { openApp, seedTree, seedSetting } from './helpers.js';

/**
 * Kinds of places on the map and town points (spec 031 §1–§3). Like the rest
 * of the map suite nothing reaches the internet: tiles are stubbed, the tiles
 * notice is pre-acknowledged and every coordinate comes from the tree's own
 * `places` (no geocoder).
 */

async function stubTiles(page: Page): Promise<void> {
    const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
    );
    await page.route('**://tile.openstreetmap.org/**', route =>
        route.fulfill({ status: 200, contentType: 'image/png', body: png }));
    await page.route('**://nominatim.openstreetmap.org/**', route => route.abort());
    await seedSetting(page, 'mapTiles', true);
}

/** Open the map on the whole tree once a tree is in place. */
async function openMap(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.setDisplayViewMode('map'));
    await page.locator('.map-scope button', { hasText: /^(Whole tree|Ganzer Stammbaum)$/ }).click();
    await expect(page.locator('.map-marker').first()).toBeVisible();
    await page.evaluate(() => {
        window.Strom.UI.dismissUndoToast();
        document.querySelectorAll('.toast, .family-offer').forEach(t => t.remove());
    });
}

/**
 * One place of each kind:
 *   Orwin — born Alpha 1850, died Delta 1900; married Ebba in Gamma 1875
 *   Brisa — Orwin's daughter, born Zeta 1880
 *   Ebba  — lived in Epsilon from 1890 (an "other event")
 */
async function seedKindsTree(page: Page): Promise<void> {
    await seedTree(page, {
        orwin: { firstName: 'Orwin', lastName: 'Halvek', birthDate: '1850', birthPlace: 'Alpha', deathDate: '1900', deathPlace: 'Delta', partners: ['ebba'] },
        ebba: { firstName: 'Ebba', lastName: 'Halvek', gender: 'female', birthDate: '1855', partners: ['orwin'] },
        brisa: { firstName: 'Brisa', lastName: 'Halvek', gender: 'female', birthDate: '1880', birthPlace: 'Zeta', parents: ['orwin', 'ebba'] },
    }, 'Halvek');
    await page.evaluate(async () => {
        const data = window.Strom.DataManager.getData();
        const union = Object.values(data.partnerships)[0];
        union.startPlace = 'Gamma';
        union.startDate = '1875';
        const ebba = Object.values(data.persons).find(p => p.firstName === 'Ebba')!;
        ebba.events = [{ id: 'ev1', type: 'residence', date: '1890', place: 'Epsilon' }];
        // Through the mutation path, so the tree (the facts above too) is saved.
        window.Strom.DataManager.setPlaceGeos(new Map(Object.entries({
            alpha: { lat: 50.0, lon: 14.0 },
            zeta: { lat: 49.0, lon: 16.0 },
            gamma: { lat: 49.5, lon: 15.0 },
            delta: { lat: 48.8, lon: 14.5 },
            epsilon: { lat: 50.2, lon: 15.6 },
        })));
        await window.Strom.TreeManager.flush();
        window.Strom.TreeRenderer.render();
    });
}

const markerKeys = (page: Page): Promise<string[]> =>
    page.locator('.map-marker').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.key ?? '').sort());

test.describe('kinds of places', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('the chips switch markers and the status count, the last one cannot go off, the choice survives a reload', async ({ page }) => {
        await stubTiles(page);
        await openApp(page);
        await seedKindsTree(page);
        await openMap(page);

        const chip = (name: string) => page.locator('.map-kinds .map-kind', { hasText: name });
        const status = page.locator('#map-status .map-status-text');
        expect(await markerKeys(page)).toEqual(['alpha', 'delta', 'epsilon', 'gamma', 'zeta']);
        await expect(status).toHaveText('5 places on the map.');
        for (const name of ['Births', 'Deaths', 'Marriages', 'Other events']) {
            await expect(chip(name)).toHaveAttribute('aria-pressed', 'true');
        }

        await chip('Births').click();
        await expect(chip('Births')).toHaveAttribute('aria-pressed', 'false');
        await expect.poll(() => markerKeys(page)).toEqual(['delta', 'epsilon', 'gamma']);
        await expect(status).toHaveText('3 places on the map.');

        await chip('Marriages').click();
        await chip('Other events').click();
        await expect.poll(() => markerKeys(page)).toEqual(['delta']);
        await expect(status).toHaveText('1 place on the map.');

        // Deaths is the last one on: it is locked and says why on a click.
        await expect(chip('Deaths')).toHaveAttribute('aria-disabled', 'true');
        // aria-disabled, yet still clickable (to explain itself).
        await chip('Deaths').click({ force: true });
        await expect(chip('Deaths')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('.map-kind-tip')).toContainText('At least one kind stays on.');
        expect(await markerKeys(page)).toEqual(['delta']);

        // The bubble names the filter.
        await page.locator('.map-marker[data-key="delta"]').click();
        await expect(page.locator('.map-popup-summary')).toHaveText('1 person · Deaths only');
        await expect(page.locator('.map-popup-person')).toHaveText('†Orwin Halvek');

        await page.reload();
        await expect(page.locator('html')).not.toHaveClass(/app-loading/);
        await openMap(page);
        expect(await markerKeys(page)).toEqual(['delta']);
        await expect(chip('Deaths')).toHaveAttribute('aria-pressed', 'true');
        await expect(chip('Births')).toHaveAttribute('aria-pressed', 'false');
    });

    test('time mode shows only the kinds on, and says the family path needs Births', async ({ page }) => {
        await stubTiles(page);
        await openApp(page);
        await seedKindsTree(page);
        await openMap(page);
        await page.getByRole('button', { name: 'Migration over time' }).click();
        await page.locator('.map-time-range').evaluate(el => {
            const input = el as HTMLInputElement;
            input.value = input.max;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        // All kinds: the family path Alpha → Zeta is drawn.
        await expect(page.locator('.map-lines line')).toHaveCount(1);
        await expect(page.locator('#map-status')).not.toContainText('The family path');

        const chip = (name: string) => page.locator('.map-kinds .map-kind', { hasText: name });
        await chip('Births').click();
        await chip('Marriages').click();
        await expect.poll(() => markerKeys(page)).toEqual(['delta', 'epsilon']);
        await expect(page.locator('.map-lines line')).toHaveCount(0);
        await expect(page.locator('#map-status')).toContainText('The family path shows only with Births.');

        await chip('Births').click();
        await expect.poll(() => markerKeys(page)).toEqual(['alpha', 'delta', 'epsilon', 'zeta']);
        await expect(page.locator('.map-lines line')).toHaveCount(1);
        await expect(page.locator('#map-status')).not.toContainText('The family path');
    });
});

test.describe('kinds on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('one button with a menu: it opens, filters, closes on a tap outside; the bubble is a bottom sheet', async ({ page }) => {
        await stubTiles(page);
        await openApp(page);
        await seedKindsTree(page);
        await openMap(page);

        await expect(page.locator('.map-kinds')).toBeHidden();
        const btn = page.locator('.map-kinds-btn');
        await expect(btn).toBeVisible();
        await expect(btn).toContainText('Kinds: all');
        await expect(btn).toHaveAttribute('aria-expanded', 'false');

        await btn.tap();
        const menu = page.locator('.map-kinds-menu');
        await expect(menu).toBeVisible();
        await expect(btn).toHaveAttribute('aria-expanded', 'true');
        const rows = menu.getByRole('checkbox');
        await expect(rows).toHaveCount(4);
        const box = (await menu.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        for (const r of await rows.all()) expect((await r.boundingBox())!.height).toBeGreaterThanOrEqual(44);

        const births = menu.getByRole('checkbox', { name: /Births/ });
        await births.tap();
        await expect(births).toHaveAttribute('aria-checked', 'false');
        await expect.poll(() => markerKeys(page)).toEqual(['delta', 'epsilon', 'gamma']);
        await expect(btn).toContainText('Kinds: 3 of 4');
        await expect(btn).toHaveClass(/filtered/);
        await expect(menu).toBeVisible();   // stays open for more choices

        // A tap on the map closes it.
        await page.locator('#map-container').tap({ position: { x: 200, y: 600 } });
        await expect(menu).toBeHidden();
        await expect(btn).toHaveAttribute('aria-expanded', 'false');

        // A marker opens its bubble as a sheet along the bottom.
        await page.locator('.map-marker[data-key="gamma"] .map-marker-dot').tap();
        const popup = page.locator('.map-popup');
        await expect(popup).toBeVisible();
        await expect(popup).toHaveClass(/map-popup--sheet/);
        const map = (await page.locator('#map-container').boundingBox())!;
        const sheet = (await popup.boundingBox())!;
        expect(Math.abs(sheet.x - map.x)).toBeLessThan(1);
        expect(Math.abs(sheet.width - map.width)).toBeLessThan(1);
        expect(Math.abs(sheet.y + sheet.height - (map.y + map.height))).toBeLessThan(1);
        const people = popup.locator('.map-popup-person');
        await expect(people).toHaveCount(2);
        for (const p of await people.all()) await expect(p.locator('.map-popup-marks')).toHaveText('⚭');
    });
});

/** Houses of one town, each a place "Town N" located by the town (byTown). */
async function seedTown(page: Page, town: string, houses: Record<string, { firstName: string; birth?: boolean; death?: boolean }[]>, own: string[] = []): Promise<void> {
    const people: Record<string, Record<string, unknown>> = {};
    let n = 0;
    for (const [house, list] of Object.entries(houses)) {
        for (const p of list) {
            const place = `${town} ${house}`;
            people[`p${++n}`] = {
                firstName: p.firstName, lastName: 'Tesk',
                ...(p.birth !== false ? { birthPlace: place } : {}),
                ...(p.death ? { deathPlace: place } : {}),
            };
        }
    }
    for (const name of own) people[`p${++n}`] = { firstName: name, lastName: 'Tesk', birthPlace: town };
    await seedTree(page, people as never, 'Tesk');
    await page.evaluate(({ town, houses, hasOwn }) => {
        const S = window.Strom;
        const key = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
        const data = S.DataManager.getData();
        data.places = {};
        if (hasOwn) data.places[key(town)] = { lat: 49.6, lon: 15.4 };
        houses.forEach((h, i) => {
            data.places![key(`${town} ${h}`)] = { lat: 49.6 + i * 0.0001, lon: 15.4, byTown: town };
        });
        S.TreeRenderer.render();
    }, { town, houses: Object.keys(houses), hasOwn: own.length > 0 });
}

const BIG_TOWN = 'Zálesí u Brodku nad Křemenným potokem';

/** 35 houses; house 3 has five people, the rest one each. */
function bigTown(): Record<string, { firstName: string }[]> {
    const houses: Record<string, { firstName: string }[]> = {};
    for (let i = 1; i <= 35; i++) houses[String(i)] = [{ firstName: `Ilvar${i}` }];
    houses['3'].push(...['Zorbin', 'Quilla', 'Yarek', 'Vendel'].map(firstName => ({ firstName })));
    return houses;
}

test.describe('town points', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test('houses of a town are one point "⌂ N"; its bubble lists the houses in natural order with their people', async ({ page }) => {
        await stubTiles(page);
        await openApp(page);
        await seedTown(page, 'Bělokamen', {
            '10': [{ firstName: 'Quilla' }],
            '2': [{ firstName: 'Yarek', death: true }],
            '16': [{ firstName: 'Vendel' }],
            'čp. 4': [{ firstName: 'Ostra', birth: false, death: true }],
        }, ['Zorbin']);
        await openMap(page);

        const marker = page.locator('.map-marker');
        await expect(marker).toHaveCount(1);
        // A town that is a place of its own keeps that place's key.
        await expect(marker).toHaveAttribute('data-key', 'belokamen');
        await expect(marker.locator('.map-marker-houses')).toHaveText('⌂ 4');

        await marker.locator('.map-marker-dot').click();
        const popup = page.locator('.map-popup');
        await expect(popup.locator('.map-popup-head strong')).toHaveText('Bělokamen');
        await expect(popup.locator('.map-popup-summary')).toHaveText('4 houses · 5 people');
        await expect(popup.locator('.map-popup-house-no')).toHaveText(['2', '4', '10', '16']);
        await expect(popup.locator('.map-popup-house').first().locator('.map-popup-person')).toHaveText('* †Yarek Tesk');
        await expect(popup.locator('.map-popup-house').nth(1).locator('.map-popup-person')).toHaveText('†Ostra Tesk');
        await expect(popup.locator('.map-popup-nohouse-title')).toContainText('No house number');
        await expect(popup.locator('.map-popup-nohouse .map-popup-person')).toHaveText('*Zorbin Tesk');
        // A small town: no search, everybody shown.
        await expect(popup.locator('.map-popup-search')).toHaveCount(0);
        await expect(popup.locator('.map-popup-more')).toHaveCount(0);

        // A tap on a person goes to them in the family view.
        await popup.locator('.map-popup-person', { hasText: 'Vendel' }).click();
        await expect(page.locator('#map-container')).toBeHidden();
    });

    test('a town point with one house has no "⌂" count; its bubble still lists the house', async ({ page }) => {
        await stubTiles(page);
        await openApp(page);
        await seedTown(page, 'Bělokamen', { 'čp. 4': [{ firstName: 'Quilla' }] });
        await openMap(page);
        const marker = page.locator('.map-marker');
        await expect(marker).toHaveCount(1);
        await expect(marker.locator('.map-marker-houses')).toHaveCount(0);
        await marker.locator('.map-marker-dot').click();
        await expect(page.locator('.map-popup .map-popup-house-no')).toHaveText(['4']);
    });

    test('above 30 houses the bubble has a house search, and "+ N more" shows the rest of a house', async ({ page }) => {
        await stubTiles(page);
        await openApp(page);
        await seedTown(page, BIG_TOWN, bigTown());
        await openMap(page);

        await expect(page.locator('.map-marker-houses')).toHaveText('⌂ 35');
        await page.locator('.map-marker .map-marker-dot').click();
        const popup = page.locator('.map-popup');
        await expect(popup.locator('.map-popup-house')).toHaveCount(35);
        const third = popup.locator('.map-popup-house', { has: page.locator('.map-popup-house-no', { hasText: /^3$/ }) });
        await expect(third.locator('.map-popup-person')).toHaveCount(3);
        await expect(third.locator('.map-popup-more')).toHaveText('+ 2 more');

        const search = popup.getByRole('searchbox', { name: 'Find a house number' });
        await search.fill('3');
        await expect(popup.locator('.map-popup-house-no')).toHaveText(['3', '30', '31', '32', '33', '34', '35']);
        await expect(popup.locator('.map-popup-search-count')).toHaveText('7 houses');

        await third.locator('.map-popup-more').click();
        await expect(third.locator('.map-popup-person')).toHaveCount(5);
        await expect(third.locator('.map-popup-more')).toHaveCount(0);
        await expect(search).toHaveValue('3');

        await search.fill('99');
        await expect(popup.locator('.map-popup-house')).toHaveCount(0);
        await expect(popup.locator('.map-popup-none')).toHaveText('No such house number here.');

        // The list scrolls inside the bubble; the bubble stays within the map.
        await search.fill('');
        const map = (await page.locator('#map-container').boundingBox())!;
        const box = (await popup.boundingBox())!;
        expect(box.height).toBeLessThanOrEqual(map.height * 0.66 + 1);
        await expect(popup.locator('.map-popup-fix')).toHaveAttribute('data-key', 'town:zalesi u brodku nad kremennym potokem');

        // Only births here: with Births off the map is empty and says why.
        await page.locator('.map-kinds .map-kind', { hasText: 'Births' }).click();
        await expect(page.locator('.map-marker')).toHaveCount(0);
        await expect(popup).toBeHidden();
        await expect(page.locator('#map-status .map-status-text')).toHaveText('No places of the kinds switched on.');
        await page.locator('.map-kinds .map-kind', { hasText: 'Births' }).click();

        // "Wrong spot?" of a group of houses opens the Places dialog.
        await page.locator('.map-marker .map-marker-dot').click();
        await popup.locator('.map-popup-fix').click();
        await expect(page.locator('#places-modal')).toBeVisible();
    });
});

/**
 * Layout self-check in German (the longest texts) at every size, light and
 * dark, with a long town name: nothing overflows the top-left controls, the
 * bubble or the status bar, and the top-left box stays clear of the zoom buttons.
 */
const SIZES = [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
];
for (const theme of ['light', 'dark'] as const) {
    for (const size of SIZES) {
        test(`layout in German at ${size.width}×${size.height}, ${theme}`, async ({ browser }) => {
            const touch = size.width < 1024;
            const context = await browser.newContext({ viewport: size, hasTouch: touch, isMobile: touch, locale: 'de-DE' });
            const page = await context.newPage();
            try {
                await stubTiles(page);
                await seedSetting(page, 'language', 'de');
                await seedSetting(page, 'theme', theme);
                await openApp(page);
                await seedTown(page, BIG_TOWN, bigTown());
                await openMap(page);
                const marker = page.locator('.map-marker .map-marker-dot');
                if (touch) await marker.tap(); else await marker.click();
                await expect(page.locator('.map-popup')).toBeVisible();

                const m = await page.evaluate(() => {
                    const q = (s: string) => document.querySelector(s) as HTMLElement;
                    const over = (s: string) => { const e = q(s); return e.scrollWidth - e.clientWidth; };
                    const topleft = q('.map-topleft').getBoundingClientRect();
                    const controls = q('.map-controls').getBoundingClientRect();
                    const map = q('#map-container').getBoundingClientRect();
                    const kids = [...q('.map-topleft').children].filter(e => (e as HTMLElement).offsetParent)
                        .map(e => e.getBoundingClientRect().right);
                    const popup = q('.map-popup').getBoundingClientRect();
                    return {
                        topleftOver: over('.map-topleft'),
                        popupOver: over('.map-popup'),
                        headOver: over('.map-popup-top'),
                        statusOver: over('#map-status'),
                        gapToRight: map.right - topleft.right,
                        kidsRight: Math.max(...kids),
                        controlsLeft: controls.left,
                        popupIn: popup.left >= map.left - 0.5 && popup.right <= map.right + 0.5 && popup.bottom <= map.bottom + 0.5,
                    };
                });
                expect(m.topleftOver, 'top left overflows').toBeLessThanOrEqual(0);
                expect(m.popupOver, 'bubble overflows').toBeLessThanOrEqual(0);
                expect(m.headOver, 'bubble head overflows').toBeLessThanOrEqual(0);
                expect(m.statusOver, 'status overflows').toBeLessThanOrEqual(0);
                expect(m.gapToRight, 'top left ends before the zoom column').toBeGreaterThanOrEqual(52);
                expect(m.kidsRight, 'top-left controls clear of the zoom buttons').toBeLessThanOrEqual(m.controlsLeft);
                expect(m.popupIn, 'bubble inside the map').toBe(true);
            } finally {
                await context.close();
            }
        });
    }
}
