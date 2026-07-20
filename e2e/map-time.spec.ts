import { test, expect, Page } from '@playwright/test';
import { openApp, card, createFirstPerson, addRelation } from './helpers.js';

/**
 * Migration over time (P5): the map's time slider. Like the rest of the map
 * suite, no request ever reaches OpenStreetMap — tiles are stubbed and the
 * tiles notice pre-acknowledged. Coordinates are set directly on the tree so a
 * test controls exactly what is on the map (and needs no geocoder at all).
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
 * A tiny tree with known dates, places and coordinates:
 *   Adam  — born Alpha 1850, died Alpha 1900   (the eldest, a parent)
 *   Bela  — born Beta 1880                      (Adam's child, a place-move)
 *   Cyril — born Gamma, NO date                 (pinned but undated → off-axis)
 * The slider therefore runs 1850..1900 and one migration line (Alpha→Beta)
 * appears from Bela's birth year onward.
 */
async function seedTimeTree(page: Page): Promise<void> {
    await openApp(page);
    await createFirstPerson(page, 'Bela', 'Novak', { birthDate: '1880' });
    await addRelation(page, 'Bela', 'parent', 'Adam', 'Novak');
    await addRelation(page, 'Bela', 'sibling', 'Cyril', 'Novak');

    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const byName = (n: string) => dm.getAllPersons().find((p: { firstName: string }) => p.firstName === n)!;
        dm.updatePerson(byName('Adam').id, { birthDate: '1850', birthPlace: 'Alpha', deathDate: '1900', deathPlace: 'Alpha' });
        dm.updatePerson(byName('Bela').id, { birthDate: '1880', birthPlace: 'Beta' });
        dm.updatePerson(byName('Cyril').id, { birthPlace: 'Gamma' });  // no date on purpose
        dm.getData().places = {
            alpha: { lat: 50.0, lon: 14.0 },
            beta: { lat: 49.0, lon: 16.0 },
            gamma: { lat: 48.5, lon: 15.0 },
        };
        window.Strom.TreeRenderer.render();
    });

    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: 'Whole tree' }).click();
    await expect(page.locator('.map-marker').first()).toBeVisible();
}

/** Move the slider and fire its input event (Playwright fill is unreliable on ranges). */
async function setYear(page: Page, year: number): Promise<void> {
    await page.locator('.map-time-range').evaluate((el, val) => {
        const input = el as HTMLInputElement;
        input.value = String(val);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }, year);
}

test('the time toggle reveals the slider and starts at the earliest year', async ({ page }) => {
    await stubTiles(page);
    await seedTimeTree(page);

    // Off by default: three ordinary markers (Alpha, Beta, Gamma).
    await expect(page.locator('.map-marker')).toHaveCount(3);
    await expect(page.locator('#map-timebar')).toBeHidden();

    await page.getByRole('button', { name: 'Migration over time' }).click();
    await expect(page.locator('#map-timebar')).toBeVisible();

    // The slider begins at the start of the story (1850) and only the oldest
    // place is on the map — Beta (1880) is still in the future, Gamma has no date.
    await expect(page.locator('.map-time-year')).toHaveText('1850');
    await expect(page.locator('.map-marker')).toHaveCount(1);
    await expect(page.locator('.map-marker[data-key="alpha"]')).toBeVisible();
});

test('sliding to the last year reveals every dated place, and undated ones stay hidden', async ({ page }) => {
    await stubTiles(page);
    await seedTimeTree(page);
    await page.getByRole('button', { name: 'Migration over time' }).click();

    await setYear(page, 1900);
    // Alpha and Beta are dated and now in the past; Gamma has no date, so it is
    // never on the timeline — and the status bar says so instead of hiding it.
    await expect(page.locator('.map-marker')).toHaveCount(2);
    await expect(page.locator('.map-marker[data-key="gamma"]')).toHaveCount(0);
    await expect(page.getByText(/without a date/i)).toBeVisible();
});

test('a parent→child birthplace line appears once the child is born', async ({ page }) => {
    await stubTiles(page);
    await seedTimeTree(page);
    await page.getByRole('button', { name: 'Migration over time' }).click();

    // Bela is born in 1880: before that there is no route to draw.
    await setYear(page, 1870);
    await expect(page.locator('.map-lines line')).toHaveCount(0);

    // Past 1880 the family's move Alpha→Beta is drawn as one line.
    await setYear(page, 1885);
    await expect(page.locator('.map-lines line')).toHaveCount(1);
});

test('turning the mode off brings the ordinary map back', async ({ page }) => {
    await stubTiles(page);
    await seedTimeTree(page);
    const toggle = page.getByRole('button', { name: 'Migration over time' });

    await toggle.click();
    await setYear(page, 1885);
    await expect(page.locator('.map-lines line')).toHaveCount(1);

    await toggle.click();
    await expect(page.locator('#map-timebar')).toBeHidden();
    await expect(page.locator('.map-marker')).toHaveCount(3);   // all places, no year filter
    await expect(page.locator('.map-lines line')).toHaveCount(0);
});

test('play steps the year forward on its own', async ({ page }) => {
    await stubTiles(page);
    await seedTimeTree(page);
    await page.getByRole('button', { name: 'Migration over time' }).click();
    await expect(page.locator('.map-time-year')).toHaveText('1850');

    await page.getByRole('button', { name: 'Play', exact: true }).click();

    // The year advances without any further input.
    await expect
        .poll(() => page.locator('.map-time-year').textContent().then(t => Number(t)))
        .toBeGreaterThan(1850);
});
