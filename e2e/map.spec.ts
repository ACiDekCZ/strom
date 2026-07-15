import { test, expect, Page } from '@playwright/test';
import { openApp, card } from './helpers.js';

/**
 * Map view (A6). The map is the one place that talks to the internet, so these
 * tests never let it: both the tile server and the geocoder are intercepted.
 * That also pins the promise the UI makes — nothing but place names is sent.
 */

/** Serve a 1×1 PNG for every tile, so no request reaches OpenStreetMap. */
async function stubTiles(page: Page): Promise<void> {
    const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
    );
    await page.route('**://tile.openstreetmap.org/**', route =>
        route.fulfill({ status: 200, contentType: 'image/png', body: png }));
}

/** Answer the geocoder locally and record exactly what was asked for. */
async function stubGeocoder(page: Page, answers: Record<string, [number, number]>): Promise<string[]> {
    const asked: string[] = [];
    await page.route('**://nominatim.openstreetmap.org/**', route => {
        const q = new URL(route.request().url()).searchParams.get('q') ?? '';
        asked.push(q);
        const hit = answers[q];
        route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(hit ? [{ lat: String(hit[0]), lon: String(hit[1]), display_name: `${q}, Test` }] : []),
        });
    });
    return asked;
}

async function seedPlaces(page: Page): Promise<void> {
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const set = (n: string, place: string) => {
            const p = dm.getAllPersons().find((x: { firstName: string }) => x.firstName === n);
            if (p) dm.updatePerson(p.id, { birthPlace: place });
        };
        set('Henry VIII', 'Greenwich');
        set('Henry VII', 'Pembroke');
    });
}

test('the map offers to look up places, then plots them', async ({ page }) => {
    await stubTiles(page);
    const asked = await stubGeocoder(page, { Greenwich: [51.48, 0.0], Pembroke: [51.67, -4.91] });

    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();
    await seedPlaces(page);

    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await expect(page.locator('#map-container')).toBeVisible();

    // Nothing has coordinates yet, so the map says so and offers the lookup.
    const lookUp = page.getByRole('button', { name: /Look up \d+ places/ });
    await expect(lookUp).toBeVisible();
    await lookUp.click();

    // Consent is asked for before anything is sent.
    await expect(page.getByText(/place names.*will be sent/i)).toBeVisible();
    await page.getByRole('button', { name: 'Look them up' }).click();

    // Markers appear for both places.
    await expect(page.locator('.map-marker')).toHaveCount(2, { timeout: 15000 });
    expect(asked.sort()).toEqual(['Greenwich', 'Pembroke']);

    // Only place names left the app — no family data rode along.
    expect(asked.join(' ')).not.toMatch(/Henry|Tudor|1491/);

    // Tiles are drawn under the markers.
    expect(await page.locator('.map-tile').count()).toBeGreaterThan(0);
});

test('coordinates are stored in the tree, so the map needs no second lookup', async ({ page }) => {
    await stubTiles(page);
    const asked = await stubGeocoder(page, { Greenwich: [51.48, 0.0], Pembroke: [51.67, -4.91] });

    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();
    await seedPlaces(page);

    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: /Look up \d+ places/ }).click();
    await page.getByRole('button', { name: 'Look them up' }).click();
    await expect(page.locator('.map-marker')).toHaveCount(2, { timeout: 15000 });
    const firstRound = asked.length;

    // The coordinates live in the tree's own data...
    expect(await page.evaluate(() => Object.keys(window.Strom.DataManager.getData().places ?? {}).sort()))
        .toEqual(['greenwich', 'pembroke']);

    // ...so leaving and returning re-plots them without asking anyone again.
    await page.getByRole('button', { name: 'Family', exact: true }).click();
    await expect(page.locator('#map-container')).toBeHidden();
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await expect(page.locator('.map-marker')).toHaveCount(2);
    expect(asked.length).toBe(firstRound);
    await expect(page.getByRole('button', { name: /Look up \d+ places/ })).toBeHidden();
});

test('the map never scrolls out from under its own controls', async ({ page }) => {
    await stubTiles(page);
    await stubGeocoder(page, { Greenwich: [51.48, 0.0], Pembroke: [51.67, -4.91] });

    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();
    await seedPlaces(page);

    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: /Look up \d+ places/ }).click();
    await page.getByRole('button', { name: 'Look them up' }).click();
    await expect(page.locator('.map-marker')).toHaveCount(2, { timeout: 15000 });

    // Tiles and markers overflow the container by design. If it were ever a
    // scroll container, focus landing on a marker would scroll the whole map
    // sideways and leave the controls half off-screen.
    const scrolled = await page.evaluate(() => {
        const c = document.getElementById('map-container') as HTMLElement;
        c.scrollLeft = 200;  // even asked directly, it must not move
        c.scrollTop = 200;
        return { left: c.scrollLeft, top: c.scrollTop };
    });
    expect(scrolled).toEqual({ left: 0, top: 0 });

    const scope = await page.locator('.map-scope').boundingBox();
    expect(scope?.x).toBeGreaterThanOrEqual(0);
});

test('a marker tells you who belongs to the place and takes you to them', async ({ page }) => {
    await stubTiles(page);
    await stubGeocoder(page, { Greenwich: [51.48, 0.0], Pembroke: [51.67, -4.91] });

    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();
    await seedPlaces(page);

    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: /Look up \d+ places/ }).click();
    await page.getByRole('button', { name: 'Look them up' }).click();
    await expect(page.locator('.map-marker')).toHaveCount(2, { timeout: 15000 });

    await page.locator('.map-marker[data-key="greenwich"] .map-marker-dot').click();
    await expect(page.locator('.map-popup')).toBeVisible();
    await page.locator('.map-popup-person', { hasText: 'Henry VIII' }).click();

    // Clicking a person leaves the map and focuses them in the family view.
    await expect(page.locator('#map-container')).toBeHidden();
    await expect(card(page, 'Henry VIII')).toBeVisible();
    expect(await page.evaluate(() => window.Strom.TreeRenderer.getViewMode())).toBe('family');
});

test('two places close together stay separately clickable', async ({ page }) => {
    await stubTiles(page);
    // Greenwich and Westminster are a few km apart: at any sensible zoom their
    // labels overlap. The label of one must never swallow the other's dot.
    await stubGeocoder(page, { Greenwich: [51.4826, -0.0077], Westminster: [51.4994, -0.1273] });

    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const set = (n: string, place: string) => {
            const p = dm.getAllPersons().find((x: { firstName: string }) => x.firstName === n);
            if (p) dm.updatePerson(p.id, { birthPlace: place });
        };
        set('Henry VIII', 'Greenwich');
        set('Henry VII', 'Westminster');
    });

    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: /Look up \d+ places/ }).click();
    await page.getByRole('button', { name: 'Look them up' }).click();
    await expect(page.locator('.map-marker')).toHaveCount(2, { timeout: 15000 });

    for (const key of ['greenwich', 'westminster']) {
        await page.locator(`.map-marker[data-key="${key}"] .map-marker-dot`).click();
        await expect(page.locator('.map-popup')).toBeVisible();
        await page.locator('.map-popup-close').click();
    }
});

test('offline, the map says so instead of showing a blank canvas', async ({ page, context }) => {
    await stubTiles(page);
    await stubGeocoder(page, { Greenwich: [51.48, 0.0], Pembroke: [51.67, -4.91] });

    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();
    await seedPlaces(page);

    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: /Look up \d+ places/ }).click();
    await page.getByRole('button', { name: 'Look them up' }).click();
    await expect(page.locator('.map-marker')).toHaveCount(2, { timeout: 15000 });

    await context.setOffline(true);
    await page.getByRole('button', { name: 'Whole tree' }).click();
    await expect(page.getByText(/No internet/i)).toBeVisible();

    // The coordinates are the user's own data — they keep working offline.
    await expect(page.locator('.map-marker')).toHaveCount(2);
    await context.setOffline(false);
});

test('the map controls say what they do', async ({ page }) => {
    await stubTiles(page);
    await stubGeocoder(page, { Greenwich: [51.48, 0.0], Pembroke: [51.67, -4.91] });

    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();
    await seedPlaces(page);
    await page.getByRole('button', { name: 'Map', exact: true }).click();

    // The glyphs on these buttons ("+", "−", "⤢") mean nothing on their own —
    // each must carry a real name for screen readers.
    for (const name of ['Zoom in', 'Zoom out', 'Fit all places']) {
        await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    }
});

test('nothing is sent when the user declines', async ({ page }) => {
    await stubTiles(page);
    const asked = await stubGeocoder(page, { Greenwich: [51.48, 0.0] });

    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();
    await seedPlaces(page);

    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: /Look up \d+ places/ }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.locator('.map-marker')).toHaveCount(0);
    expect(asked).toEqual([]);
    // The offer is still there — declining is not a permanent no.
    await expect(page.getByRole('button', { name: /Look up \d+ places/ })).toBeVisible();
});

test('the scope switch covers the whole tree, not just the view', async ({ page }) => {
    await stubTiles(page);
    const asked = await stubGeocoder(page, { Greenwich: [51.48, 0.0], Pembroke: [51.67, -4.91] });

    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();
    await seedPlaces(page);

    // Narrow the view down to one person, so the two scopes differ.
    await page.evaluate(() => {
        window.Strom.TreeRenderer.setFocusDepth(0, 0);
    });

    // The lookup covers the scope in use: on screen there is only Henry VIII,
    // so only his place is asked about.
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: /Look up \d+ places/ }).click();
    await page.getByRole('button', { name: 'Look them up' }).click();
    await expect(page.locator('.map-marker')).toHaveCount(1, { timeout: 15000 });
    expect(asked).toEqual(['Greenwich']);

    // Widening to the whole tree brings the rest of the family's places into
    // play — the one nobody has looked up yet is offered, not silently skipped.
    await page.getByRole('button', { name: 'Whole tree' }).click();
    await expect(page.locator('.map-marker')).toHaveCount(1);
    await page.getByRole('button', { name: /Look up 1 places/ }).click();
    await expect(page.locator('.map-marker')).toHaveCount(2, { timeout: 15000 });
    expect(asked).toEqual(['Greenwich', 'Pembroke']);

    // Consent already given, so the second lookup went ahead without re-asking.
    await expect(page.getByRole('button', { name: 'Look them up' })).toBeHidden();

    // Back to the view: Pembroke keeps its coordinates but is out of scope.
    await page.getByRole('button', { name: 'This view' }).click();
    await expect(page.locator('.map-marker')).toHaveCount(1);
});
