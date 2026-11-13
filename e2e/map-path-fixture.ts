import { expect, Page } from '@playwright/test';
import { openApp, seedTree, type SeedPerson } from './helpers.js';

/**
 * The tree and helpers of the ancestors' path on the map (map-path*.spec.ts).
 * Tiles are stubbed and coordinates set directly on the tree, so nothing
 * reaches OpenStreetMap or a geocoder.
 */

export async function stubTiles(page: Page): Promise<void> {
    const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
    );
    await page.route('**://tile.openstreetmap.org/**', route =>
        route.fulfill({ status: 200, contentType: 'image/png', body: png }));
    await page.addInitScript(() => {
        const raw = localStorage.getItem('strom-settings');
        const settings = raw ? JSON.parse(raw) : {};
        settings.mapTiles = true;
        localStorage.setItem('strom-settings', JSON.stringify(settings));
    });
}

/**
 * Three generations above Tamsin (born Zeta 1950):
 *   parents      Orrin Quillfen (Eta 1920), Maelis Ostrowbek (Theta 1922)
 *   grandparents Corwen Quillfen (Iota 1890), Ysolde Zandmeer (Kappa 1893)
 *   great-grand  Ansel Quillfen (Lambda 1860) → quarter 0, Ivar Zandmeer (Mu 1865) → quarter 1
 * Bram Pellwick (Zeta 1960) has no ancestors at all; Elowen Yarrowby has no
 * place of her own, her father Fennick (Eta 1900) has one.
 * The path to Tamsin therefore runs 1860 → 1950. `extra` adds or replaces people;
 * `timeOn: false` leaves Migration over time off, `mapTimeTip` keeps its offer unspent.
 */
export async function seedPathTree(
    page: Page, extra: Record<string, SeedPerson> = {},
    opts: { timeOn?: boolean; mapTimeTip?: boolean } = {},
): Promise<void> {
    await openApp(page, { mapTimeTip: opts.mapTimeTip });
    await seedTree(page, {
        tamsin: { firstName: 'Tamsin', lastName: 'Quillfen', gender: 'female', birthDate: '1950', birthPlace: 'Zeta', parents: ['orrin', 'maelis'] },
        orrin: { firstName: 'Orrin', lastName: 'Quillfen', gender: 'male', birthDate: '1920', birthPlace: 'Eta', parents: ['corwen', 'ysolde'], partners: ['maelis'] },
        maelis: { firstName: 'Maelis', lastName: 'Ostrowbek', gender: 'female', birthDate: '1922', birthPlace: 'Theta' },
        corwen: { firstName: 'Corwen', lastName: 'Quillfen', gender: 'male', birthDate: '1890', birthPlace: 'Iota', parents: ['ansel'], partners: ['ysolde'] },
        ysolde: { firstName: 'Ysolde', lastName: 'Zandmeer', gender: 'female', birthDate: '1893', birthPlace: 'Kappa', parents: ['ivar'] },
        ansel: { firstName: 'Ansel', lastName: 'Quillfen', gender: 'male', birthDate: '1860', birthPlace: 'Lambda' },
        ivar: { firstName: 'Ivar', lastName: 'Zandmeer', gender: 'male', birthDate: '1865', birthPlace: 'Mu' },
        bram: { firstName: 'Bram', lastName: 'Pellwick', gender: 'male', birthDate: '1960', birthPlace: 'Zeta' },
        elowen: { firstName: 'Elowen', lastName: 'Yarrowby', gender: 'female', birthDate: '1930', parents: ['fennick'] },
        fennick: { firstName: 'Fennick', lastName: 'Yarrowby', gender: 'male', birthDate: '1900', birthPlace: 'Eta' },
        ...extra,
    });

    await page.evaluate(() => {
        window.Strom.DataManager.getData().places = {
            zeta: { lat: 50.0, lon: 14.0 },
            eta: { lat: 49.5, lon: 15.0 },
            theta: { lat: 50.4, lon: 13.0 },
            iota: { lat: 49.0, lon: 16.0 },
            kappa: { lat: 48.8, lon: 14.5 },
            lambda: { lat: 48.5, lon: 17.0 },
            mu: { lat: 48.2, lon: 13.5 },
        };
        window.Strom.TreeRenderer.render();
    });

    await page.evaluate(() => window.Strom.UI.setDisplayViewMode('map'));
    await page.getByRole('button', { name: 'Whole tree' }).click();
    await expect(page.locator('.map-marker').first()).toBeVisible();
    if (opts.timeOn === false) return;
    await page.getByRole('button', { name: 'Migration over time' }).click();
    await expect(page.locator('#map-timebar')).toBeVisible();
}

export async function setYear(page: Page, year: number): Promise<void> {
    await page.locator('.map-time-range').evaluate((el, val) => {
        const input = el as HTMLInputElement;
        input.value = String(val);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }, year);
}

export async function choosePerson(page: Page, query: string, name: RegExp): Promise<void> {
    await page.locator('.map-path-btn').click();
    const picker = page.locator('.map-path-picker');
    await expect(picker).toBeVisible();
    await picker.locator('.path-picker-input').fill(query);
    await picker.locator('.path-picker-row', { hasText: name }).click();
    await expect(picker).toHaveCount(0);
}

