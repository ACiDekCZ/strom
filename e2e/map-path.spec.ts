import { test, expect, Page } from '@playwright/test';
import { openApp, seedTree } from './helpers.js';

/**
 * The ancestors' path to one person on the map (Migration over time with a
 * chosen person): the bar's "Path to a person…" button, the choice of the
 * person, the chip in the scope's place, the coloured lines, the target and
 * the bar's range. Tiles are stubbed and coordinates set directly on the tree,
 * so nothing reaches OpenStreetMap or a geocoder.
 */

async function stubTiles(page: Page): Promise<void> {
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
 * The path to Tamsin therefore runs 1860 → 1950.
 */
async function seedPathTree(page: Page): Promise<void> {
    await openApp(page);
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
    await page.getByRole('button', { name: 'Migration over time' }).click();
    await expect(page.locator('#map-timebar')).toBeVisible();
}

async function setYear(page: Page, year: number): Promise<void> {
    await page.locator('.map-time-range').evaluate((el, val) => {
        const input = el as HTMLInputElement;
        input.value = String(val);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }, year);
}

async function choosePerson(page: Page, query: string, name: RegExp): Promise<void> {
    await page.locator('.map-path-btn').click();
    const picker = page.locator('.map-path-picker');
    await expect(picker).toBeVisible();
    await picker.locator('.path-picker-input').fill(query);
    await picker.locator('.path-picker-row', { hasText: name }).click();
    await expect(picker).toHaveCount(0);
}

test('a person chosen from the bar draws the coloured path, the chip replaces the scope and the bar runs from the first ancestor to the target', async ({ page }) => {
    await stubTiles(page);
    await seedPathTree(page);

    await expect(page.locator('.map-path-btn')).toBeVisible();
    await expect(page.locator('.map-path-chip')).toBeHidden();
    await choosePerson(page, 'Quillfen', /Tamsin/);

    // The chip with the person's name stands where the scope stood; the bar's button is gone.
    const chip = page.locator('.map-path-chip');
    await expect(chip).toBeVisible();
    await expect(chip.locator('.map-path-chip-name')).toHaveText(/Tamsin Quillfen/);
    await expect(page.locator('.map-scope')).toBeHidden();
    await expect(page.locator('.map-path-btn')).toBeHidden();

    // The bar spans the first ancestor's year to the target's and starts at its beginning.
    const range = page.locator('.map-time-range');
    await expect(range).toHaveAttribute('min', '1860');
    await expect(range).toHaveAttribute('max', '1950');
    await expect(page.locator('.map-time-year')).toHaveText('1860');

    // Before the end: the target is a faint dashed ring with its label.
    const target = page.locator('.map-path-target');
    await expect(target).toHaveCount(1);
    await expect(target).not.toHaveClass(/is-reached/);
    await expect(target.locator('.map-path-target-ring')).toHaveCSS('border-top-style', 'dashed');

    // At the end every line is drawn: the trunk and the great-grandparents' quarters in their colours, each on a casing.
    await setYear(page, 1950);
    await expect(target).toHaveClass(/is-reached/);
    await expect(target.locator('.map-path-target-ring')).toHaveCSS('border-top-style', 'solid');
    const lines = page.locator('path.map-path-line');
    await expect(lines).toHaveCount(6);
    await expect(page.locator('path.map-path-line[data-cls="trunk"]')).toHaveCount(4);
    await expect(page.locator('path.map-path-line[data-cls="q0"]')).toHaveAttribute('stroke', 'var(--line-q0)');
    await expect(page.locator('path.map-path-line[data-cls="q1"]')).toHaveAttribute('stroke', 'var(--line-q1)');
    await expect(page.locator('.map-path-casing path')).toHaveCount(6);
    await expect(page.locator('.map-lines line')).toHaveCount(0);

    // The ancestors' points: each place of the path is one point (Zeta is the target's).
    await expect(page.locator('.map-path-point')).toHaveCount(6);
    await expect(page.locator('.map-path-point[data-key="lambda"]')).toHaveAttribute('data-classes', 'q0');

    // The ×: the scope and the ordinary migration lines come back.
    await chip.locator('.map-path-chip-clear').click();
    await expect(chip).toBeHidden();
    await expect(page.locator('.map-scope')).toBeVisible();
    await expect(page.locator('.map-path-btn')).toBeVisible();
    await expect(page.locator('path.map-path-line')).toHaveCount(0);
    await expect(page.locator('.map-path-target')).toHaveCount(0);
});

test('the choice greys out a person without ancestors on the map and says how many each one has', async ({ page }) => {
    await stubTiles(page);
    await seedPathTree(page);

    await page.locator('.map-path-btn').click();
    const picker = page.locator('.map-path-picker');
    await expect(picker).toBeVisible();
    await expect(picker.locator('.path-picker-input')).toBeFocused();

    await picker.locator('.path-picker-input').fill('Pellwick');
    const bram = picker.locator('.path-picker-row', { hasText: /Bram/ });
    await expect(bram).toHaveAttribute('aria-disabled', 'true');
    await expect(bram).toContainText('ancestors have no places on the map yet');
    await bram.click({ force: true });
    await expect(picker).toBeVisible();
    await expect(page.locator('.map-path-chip')).toBeHidden();

    await picker.locator('.path-picker-input').fill('Tamsin');
    const tamsin = picker.locator('.path-picker-row', { hasText: /Tamsin/ });
    await expect(tamsin).toHaveAttribute('aria-disabled', 'false');
    await expect(tamsin).toContainText('6 ancestors on the map');

    // Escape closes the choice and leaves the map as it was.
    await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);
    await expect(page.locator('#map-timebar')).toBeVisible();
    await expect(page.locator('.map-scope')).toBeVisible();
});

test('a target without a place ends the path at its parents and says so; a target without ancestors on the map offers another person', async ({ page }) => {
    await stubTiles(page);
    await seedPathTree(page);

    await choosePerson(page, 'Yarrowby', /Elowen/);
    await expect(page.locator('.map-path-chip-name')).toHaveText(/Elowen Yarrowby/);
    await setYear(page, 1930);
    await expect(page.locator('.map-path-target')).toHaveCount(0);
    await expect(page.locator('.map-time-caption')).toContainText('Elowen Yarrowby has no place on the map.');

    // A person whose ancestors have no place (set from another window's state, say): no lines, the slider off, another person offered.
    await page.evaluate(() => window.Strom.UI.setMapPathTarget('bram' as never));
    await expect(page.locator('.map-path-chip-name')).toHaveText(/Bram Pellwick/);
    await expect(page.locator('path.map-path-line')).toHaveCount(0);
    await expect(page.locator('.map-time-range')).toBeDisabled();
    const caption = page.locator('.map-time-caption');
    await expect(caption).toContainText('No ancestor has a place on the map yet.');
    await caption.getByRole('button', { name: 'Choose another person' }).click();
    await expect(page.locator('.map-path-picker')).toBeVisible();
});

test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the choice is a bottom sheet and the path button spans the bar', async ({ page }) => {
        await stubTiles(page);
        await seedPathTree(page);

        const btn = page.locator('.map-path-btn');
        await expect(btn).toBeVisible();
        const bar = await page.locator('#map-timebar').boundingBox();
        const box = await btn.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThan(bar!.width * 0.8);

        await btn.click();
        const picker = page.locator('.map-path-picker');
        await expect(picker).toHaveClass(/map-path-picker--sheet/);
        const sheet = await picker.boundingBox();
        expect(sheet!.x).toBeLessThanOrEqual(1);
        expect(Math.round(sheet!.x + sheet!.width)).toBeGreaterThanOrEqual(389);

        await picker.locator('.path-picker-input').fill('Tamsin');
        await picker.locator('.path-picker-row', { hasText: /Tamsin/ }).click();
        const chip = page.locator('.map-path-chip');
        await expect(chip).toBeVisible();
        const chipBox = await chip.boundingBox();
        expect(chipBox!.x + chipBox!.width).toBeLessThanOrEqual(390);
        const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(scrollW).toBeLessThanOrEqual(390);
    });
});
