import { test, expect, Page } from '@playwright/test';
import { openApp, seedTree, seedSetting } from './helpers.js';
import { chooseMapWholeTree } from './map-scope-helpers.js';

/**
 * The Family houses layer of the Map tab (spec 030 §9): its switch after the
 * kinds, a house with a point of its own as a pill with its number, the town
 * point's "⌂ N" counting only the houses without one, the house bubble with
 * House page › and Move the point, and "On the map" in the house page's ⋯ menu.
 * Invented data: the Prouzal family of Bělokamen, čp. 16 placed by hand.
 */

const KEY = 'belokamen|16';
const pill = (page: Page) => page.locator(`#map-container .map-house-pt[data-house="${KEY}"]`);
const townTag = (page: Page) => page.locator('#map-container .map-marker[data-key="belokamen"] .map-marker-houses');
const chip = (page: Page) => page.locator('#map-container .map-kind-houses');
const popup = (page: Page) => page.locator('.map-popup');
const pageWin = (page: Page) => page.locator('#house-page-modal');

/** Today's tiles answered here: nothing reaches a map server. */
async function stubTiles(page: Page): Promise<void> {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await page.route('**://tile.openstreetmap.org/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: png }));
    await page.route('**://nominatim.openstreetmap.org/**', route => route.abort());
    await seedSetting(page, 'mapTiles', true);
}

/** Three houses of Bělokamen (čp. 4, 16, 31), the town on the map, čp. 16 placed by hand. */
async function seedHouses(page: Page, opts: { placed?: boolean } = {}): Promise<void> {
    await seedTree(page, {
        kvido: { firstName: 'Kvido', lastName: 'Prouzal', birthDate: '1820', birthPlace: 'Bělokamen', birthAddress: 'čp. 16',
            deathDate: '1880', deathPlace: 'Bělokamen', deathAddress: 'čp. 16', partners: ['vlasta'] },
        vlasta: { firstName: 'Vlasta', lastName: 'Kvitelková', gender: 'female', birthDate: '1825', birthPlace: 'Bělokamen',
            birthAddress: 'čp. 4', partners: ['kvido'] },
        bohumil: { firstName: 'Bohumil', lastName: 'Prouzal', birthDate: '1850', birthPlace: 'Bělokamen', birthAddress: 'čp. 16',
            deathPlace: 'Bělokamen', deathAddress: 'čp. 31', deathDate: '1911', parents: ['kvido', 'vlasta'] },
    }, 'Prouzal');
    await page.evaluate(async (placed) => {
        const dm = window.Strom.DataManager;
        dm.setPlaceGeos(new Map([['belokamen', { lat: 49.5, lon: 15.2 }]]));
        if (placed) dm.setHouseUserData('belokamen|16' as never, { location: { lat: 49.503, lng: 15.204, how: 'manual' } }, 'seed');
        await window.Strom.TreeManager.flush();
        window.Strom.TreeRenderer.render();
    }, opts.placed ?? true);
}

/** The Map tab on the whole tree; `zoomIn`: steps in from the town's zoom (11), where čp. 16 (~440 m off) stands apart. */
async function openMap(page: Page, zoomIn = 4): Promise<void> {
    await page.evaluate(() => window.Strom.UI.setDisplayViewMode('map'));
    await chooseMapWholeTree(page);
    await expect(page.locator('.map-marker').first()).toBeVisible();
    await page.evaluate(() => {
        window.Strom.UI.dismissUndoToast();
        document.querySelectorAll('.toast, .family-offer').forEach(t => t.remove());
    });
    for (let i = 0; i < zoomIn; i++) await page.locator('#map-container .map-zoom-in').click();
}

test.describe('Family houses on the map', () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test.beforeEach(async ({ page }) => {
        await page.clock.setFixedTime(new Date('2027-03-20T10:30:00Z'));
        await stubTiles(page);
        await openApp(page);
    });

    test('no switch while no house has a point', async ({ page }) => {
        await seedHouses(page, { placed: false });
        await openMap(page);
        await expect(chip(page)).toBeHidden();
        await expect(page.locator('#map-container .map-house-pt')).toHaveCount(0);
        await expect(townTag(page)).toHaveText(/3$/);
    });

    test('the switch on by default: the house as a pill, the town counts the others; off hides it and survives a reload', async ({ page }) => {
        await seedHouses(page);
        await openMap(page);
        await expect(chip(page)).toBeVisible();
        await expect(chip(page)).toHaveText(/Family houses/);
        await expect(chip(page)).toHaveAttribute('aria-pressed', 'true');
        await expect(pill(page)).toHaveText('16');
        await expect(pill(page)).toHaveAttribute('aria-label', 'House 16 · Bělokamen čp.\u00a016');
        await expect(townTag(page)).toHaveText(/2$/);
        await chip(page).click();
        await expect(chip(page)).toHaveAttribute('aria-pressed', 'false');
        await expect(pill(page)).toHaveCount(0);
        await expect(townTag(page)).toHaveText(/3$/);
        await page.reload();
        await expect(page.locator('html')).not.toHaveClass(/app-loading/);
        await openMap(page);
        await expect(chip(page)).toBeVisible();
        await expect(chip(page)).toHaveAttribute('aria-pressed', 'false');
        await expect(pill(page)).toHaveCount(0);
    });

    test('a house over its town\'s point stays in the town (its ⌂ counts it, the town clickable) until zoomed in', async ({ page }) => {
        await seedHouses(page);
        await openMap(page, 0);
        // Zoom 11: čp. 16 lies ~9 px from the town's dot — no pill over it, the town counts all three houses.
        await expect(chip(page)).toBeVisible();
        await expect(pill(page)).toHaveCount(0);
        await expect(townTag(page)).toHaveText(/3$/);
        await page.locator('#map-container .map-marker[data-key="belokamen"] .map-marker-dot').click();
        await expect(popup(page)).toBeVisible();
        await page.keyboard.press('Escape');
        // One step in (~18 px) still over the dot; the second (~36 px) draws it.
        await page.locator('#map-container .map-zoom-in').click();
        await expect(townTag(page)).toHaveText(/3$/);
        await expect(pill(page)).toHaveCount(0);
        await page.locator('#map-container .map-zoom-in').click();
        await expect(pill(page)).toHaveText('16');
        await expect(townTag(page)).toHaveText(/2$/);
        const dot = (await page.locator('#map-container .map-marker[data-key="belokamen"] .map-marker-dot').boundingBox())!;
        const at = (await pill(page).boundingBox())!;
        const apart = at.y + at.height <= dot.y || at.y >= dot.y + dot.height || at.x >= dot.x + dot.width || at.x + at.width <= dot.x;
        expect(apart).toBe(true);
    });

    test('the bubble: years, surnames, House page › opens the house page; Move the point starts moving there', async ({ page }) => {
        await seedHouses(page);
        await openMap(page);
        await pill(page).click();
        await expect(pill(page)).toHaveClass(/is-open/);
        await expect(popup(page).locator('.map-popup-head strong')).toHaveText('Bělokamen čp. 16');
        await expect(popup(page).locator('.map-popup-summary')).toHaveText('1820–1880 · Prouzal · 2 people');
        await expect(popup(page).locator('.map-popup-town-houses')).toHaveText('Houses in this town ›');
        await popup(page).locator('.map-popup-house-page').click();
        await expect(pageWin(page).locator('#hp-title')).toHaveText('Bělokamen čp. 16');
        await expect(pill(page)).not.toHaveClass(/is-open/);
        // Escape: back to the map (the page was opened from there, not from the Houses window).
        await page.keyboard.press('Escape');
        await expect(pageWin(page)).toHaveCount(0);
        await expect(page.locator('#houses-modal')).toHaveCount(0);

        await pill(page).click();
        await popup(page).locator('.map-popup-house-move').click();
        const pin = pageWin(page).locator('#hp-sec-map .hpt');
        await expect(pin).toHaveClass(/drag/);
        await expect(pin).toBeFocused();
    });

    test('a long house name in the bubble wraps as a whole under the number, not word by word after it', async ({ page }) => {
        await seedHouses(page);
        await page.evaluate(() => window.Strom.DataManager.setHouseUserData('belokamen|16' as never,
            { name: 'U Prouzalů pod Kvitelkovým vrchem za Zálesnou', location: { lat: 49.503, lng: 15.204, how: 'manual' } }, 'seed'));
        await openMap(page);
        await pill(page).click();
        const name = popup(page).locator('.map-popup-hname');
        await expect(name).toHaveText('U Prouzalů pod Kvitelkovým vrchem za Zálesnou');
        // One box: the name moved to its own line whole (a word-by-word wrap leaves "U" after the number).
        expect(await name.evaluate(el => el.getClientRects().length)).toBe(1);
        const title = (await popup(page).locator('.map-popup-head strong').boundingBox())!;
        const box = (await name.boundingBox())!;
        expect(box.y).toBeGreaterThan(title.y + 4);
    });

    test('On the map from the house page\'s ⋯ menu: the house selected beside its open bubble, never under it', async ({ page }) => {
        await seedHouses(page);
        // Switched off earlier: On the map turns the layer on again.
        await page.evaluate(() => window.Strom.SettingsManager.setMapHouses(false));
        await page.evaluate((id) => window.Strom.UI.openHouse(id as never), KEY);
        const win = pageWin(page);
        await expect(win.locator('#hp-title')).toHaveText('Bělokamen čp. 16');
        await win.locator('.pp-more').click();
        await win.locator('.pp-menu [data-hp-menu="map"]').click();
        await expect(win).toHaveCount(0);
        await expect(pill(page)).toHaveClass(/is-open/);
        await expect(popup(page).locator('.map-popup-head strong')).toHaveText('Bělokamen čp. 16');
        await expect(chip(page)).toHaveAttribute('aria-pressed', 'true');
        // Selected (ringed, Milan 27 Nov 2026) and not under the bubble: left of it, at its height.
        await expect(pill(page)).toHaveCSS('box-shadow', /rgb/);
        const bubble = (await popup(page).boundingBox())!;
        const at = (await pill(page).boundingBox())!;
        expect(at.x + at.width).toBeLessThanOrEqual(bubble.x);
        expect(at.y + at.height / 2).toBeGreaterThan(bubble.y);
        expect(at.y + at.height / 2).toBeLessThan(bubble.y + bubble.height);
        // Its own point elsewhere: four links in a new window, "today's view".
        const elsewhere = popup(page).locator('.map-popup-else');
        await expect(elsewhere.locator('a')).toHaveText(['OpenStreetMap ↗', 'Mapy.com ↗', 'Google Maps ↗', 'Street View ↗']);
        await expect(elsewhere.locator('a[data-else="mapy"]')).toHaveAttribute('href', 'https://mapy.com/fnc/v1/showmap?mapset=basic&center=15.20400,49.50300&zoom=18&marker=true');
        await expect(elsewhere.locator('a[target="_blank"][rel="noopener noreferrer"]')).toHaveCount(4);
        await expect(elsewhere).toContainText('today’s view');
    });

    test('On the map from a row\'s ⋯ in the Houses window (after House page); a house without a point has no links elsewhere', async ({ page }) => {
        await seedHouses(page);
        await page.evaluate(() => window.Strom.UI.showHousesWindow());
        await page.locator(`#houses-modal .house-row[data-house="${KEY}"] .house-more-btn`).click();
        const items = page.locator('.houses-menu [role="menuitem"]');
        await expect(items.nth(0)).toHaveText('House page');
        await expect(items.nth(1)).toHaveText('On the map');
        await items.nth(1).click();
        await expect(page.locator('#houses-modal')).toBeHidden();
        await expect(pill(page)).toHaveClass(/is-open/);
        await expect(popup(page).locator('.map-popup-head strong')).toHaveText('Bělokamen čp. 16');
        // čp. 4 has no point of its own: its town's point, no links elsewhere.
        await page.evaluate(() => window.Strom.UI.openHouse('belokamen|4' as never));
        await expect(pageWin(page).locator('.hmap')).toBeVisible();
        await expect(pageWin(page).locator('.hmap-else')).toHaveCount(0);
    });

    test('a house without a point: On the map shows its town', async ({ page }) => {
        await seedHouses(page, { placed: false });
        await page.evaluate((id) => window.Strom.UI.openHouse(id as never), KEY);
        const win = pageWin(page);
        await win.locator('.pp-more').click();
        await win.locator('.pp-menu [data-hp-menu="map"]').click();
        await expect(win).toHaveCount(0);
        await expect(popup(page)).toBeVisible();
        await expect(page.locator('#map-container .map-house-pt')).toHaveCount(0);
    });
});

// "On the map" before the map's background is allowed (1127 N2): the notice card stays in sight, no bubble over it;
// once allowed, the house is chosen beside its open bubble.
test.describe('On the map before the background is allowed', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the notice card first, the house chosen after "Show map"', async ({ page }) => {
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
        await page.route('**://tile.openstreetmap.org/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: png }));
        await page.route('**://nominatim.openstreetmap.org/**', route => route.abort());
        await openApp(page);
        await seedHouses(page);
        await page.evaluate(() => window.Strom.UI.showHousesWindow());
        await page.locator(`#houses-modal .house-row[data-house="${KEY}"] .house-more-btn`).click();
        await page.locator('.houses-menu [role="menuitem"][data-action="map"]').click();
        const notice = page.locator('#map-container .map-tiles-notice');
        await expect(notice.locator('button')).toBeVisible();
        await expect(popup(page)).toBeHidden();
        await notice.locator('button').click();
        await expect(notice).toHaveCount(0);
        await expect(pill(page)).toHaveClass(/is-open/);
        await expect(popup(page).locator('.map-popup-head strong')).toHaveText('Bělokamen čp. 16');
    });
});
