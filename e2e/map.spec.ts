import { test, expect, Page } from '@playwright/test';
import { openApp, card, createFirstPerson, addRelation } from './helpers.js';

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

/**
 * Give the sample tree exactly these places and nothing else. The tree ships
 * with places AND their coordinates (that is the point of it), so a test that
 * wants to control what is on the map must clear them first — otherwise it is
 * counting the sample tree's markers, not its own.
 */
async function setPlaces(page: Page, places: Record<string, string>): Promise<void> {
    await page.evaluate((wanted) => {
        const dm = window.Strom.DataManager;
        for (const p of dm.getAllPersons()) {
            dm.updatePerson(p.id, { birthPlace: '', deathPlace: '' });
        }
        dm.getData().places = {};
        for (const [name, place] of Object.entries(wanted)) {
            const p = dm.getAllPersons().find((x: { firstName: string }) => x.firstName === name);
            if (p) dm.updatePerson(p.id, { birthPlace: place });
        }
        window.Strom.TreeRenderer.render();
    }, places);
}

/** The usual two: Henry VIII in Greenwich, Henry VII in Pembroke. */
async function seedPlaces(page: Page): Promise<void> {
    await setPlaces(page, { 'Henry VIII': 'Greenwich', 'Henry VII': 'Pembroke' });
}

test('the sample tree is on the map the moment it loads', async ({ page }) => {
    await stubTiles(page);
    // No geocoder stub on purpose: if the demo needed a lookup, this route would
    // never be called and the test would show an empty map.
    let asked = 0;
    await page.route('**://nominatim.openstreetmap.org/**', route => { asked++; void route.abort(); });

    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();

    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: 'Whole tree' }).click();

    // The demo ships its own coordinates: places show up with nothing sent.
    await expect(page.locator('.map-marker').first()).toBeVisible();
    expect(await page.locator('.map-marker').count()).toBeGreaterThan(10);
    expect(asked).toBe(0);
    await expect(page.getByRole('button', { name: /Look up/ })).toBeHidden();
});

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
    const lookUp = page.getByRole('button', { name: /Look up \d+ places?/ });
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
    await page.getByRole('button', { name: /Look up \d+ places?/ }).click();
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
    await expect(page.getByRole('button', { name: /Look up \d+ places?/ })).toBeHidden();
});

test('the map never scrolls out from under its own controls', async ({ page }) => {
    await stubTiles(page);
    await stubGeocoder(page, { Greenwich: [51.48, 0.0], Pembroke: [51.67, -4.91] });

    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();
    await seedPlaces(page);

    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: /Look up \d+ places?/ }).click();
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

test('coordinates survive a reload — they are part of the tree', async ({ page }) => {
    await stubTiles(page);
    const asked = await stubGeocoder(page, { 'Kolín': [50.0281, 15.2003] });

    // A tree of its own: this is about coordinates the USER looked up, not the
    // ones the sample tree ships with.
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1900' });
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        dm.updatePerson(dm.getAllPersons()[0].id, { birthPlace: 'Kolín' });
    });

    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: /Look up \d+ places?/ }).click();
    await page.getByRole('button', { name: 'Look them up' }).click();
    await expect(page.locator('.map-marker')).toHaveCount(1, { timeout: 15000 });
    expect(asked).toEqual(['Kolín']);

    // Reopening the app must not lose them. The load path rebuilds the tree
    // field by field, and once quietly dropped this one — so every coordinate
    // the user had looked up was gone the next time they opened the app.
    await page.reload();
    // The map view is remembered, so the app comes back straight onto the map.
    await expect(page.locator('#map-container')).toBeVisible();
    expect(await page.evaluate(() => Object.keys(window.Strom.DataManager.getData().places ?? {})))
        .toEqual(['kolin']);
    await expect(page.locator('.map-marker')).toHaveCount(1);
    expect(asked).toEqual(['Kolín']);  // nothing looked up a second time
});

test('a marker tells you who belongs to the place and takes you to them', async ({ page }) => {
    await stubTiles(page);
    await stubGeocoder(page, { Greenwich: [51.48, 0.0], Pembroke: [51.67, -4.91] });

    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();
    await seedPlaces(page);

    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: /Look up \d+ places?/ }).click();
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
    await setPlaces(page, { 'Henry VIII': 'Greenwich', 'Henry VII': 'Westminster' });

    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: /Look up \d+ places?/ }).click();
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
    await page.getByRole('button', { name: /Look up \d+ places?/ }).click();
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

test('a place the map cannot find can be matched by hand', async ({ page }) => {
    await stubTiles(page);
    // "Kravaře u Č. Lípy" is how the family writes it and no geocoder knows it;
    // "Kravaře" is a real town. This is the whole point of matching by hand.
    const asked = await stubGeocoder(page, { 'Kravaře': [50.6086, 14.3486], 'Praha': [50.0755, 14.4378] });

    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();
    await setPlaces(page, { 'Henry VIII': 'Praha', 'Henry VII': 'Kravaře u Č. Lípy' });

    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: /Look up \d+ places?/ }).click();
    await page.getByRole('button', { name: 'Look them up' }).click();

    // The automatic run places Praha and leaves the odd one behind.
    await expect(page.locator('.map-marker')).toHaveCount(1, { timeout: 15000 });
    expect(asked).toContain('Kravaře u Č. Lípy');

    await page.getByRole('button', { name: 'Places', exact: true }).click();
    const row = page.locator('.place-row[data-key="kravare u c lipy"]');
    await expect(row).toBeVisible();

    // Search under a name the map does know.
    await row.getByRole('button', { name: 'Find on the map' }).click();
    await row.locator('.place-query').fill('Kravaře');
    await row.locator('.place-search-go').click();
    await row.locator('.place-candidate').first().click();

    // The place is on the map...
    await expect(page.locator('.map-marker')).toHaveCount(2, { timeout: 10000 });
    // ...and the tree still calls it what the family calls it.
    const stored = await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const p = dm.getAllPersons().find((x: { firstName: string }) => x.firstName === 'Henry VII');
        return { place: p?.birthPlace, keys: Object.keys(dm.getData().places ?? {}).sort() };
    });
    expect(stored.place).toBe('Kravaře u Č. Lípy');
    expect(stored.keys).toContain('kravare u c lipy');

    // Nothing is left unplaced, so the lookup offer is gone.
    await expect(page.getByRole('button', { name: /Look up \d+ places?/ })).toBeHidden();
});

test('a hand search that finds nothing says so and keeps the place', async ({ page }) => {
    await stubTiles(page);
    await stubGeocoder(page, { 'Praha': [50.0755, 14.4378] });

    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();
    await setPlaces(page, { 'Henry VIII': 'Lhota u Nikde' });

    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: 'Places', exact: true }).click();
    const row = page.locator('.place-row[data-key="lhota u nikde"]');
    await row.getByRole('button', { name: 'Find on the map' }).click();
    await row.locator('.place-search-go').click();
    await page.getByRole('button', { name: 'Look them up' }).click();

    await expect(row.getByText(/Nothing found/i)).toBeVisible();
    // A failed search must not invent coordinates.
    expect(await page.evaluate(() => Object.keys(window.Strom.DataManager.getData().places ?? {}))).toEqual([]);
});

test('a pin in the wrong place can be fixed from the map', async ({ page }) => {
    await stubTiles(page);
    // "Boston" lands in the USA first — the family means the one in England.
    await stubGeocoder(page, {
        'Boston': [42.3601, -71.0589],
        'Boston, Lincolnshire': [52.9788, -0.0269],
    });

    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();
    await setPlaces(page, { 'Henry VIII': 'Boston' });

    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: /Look up \d+ places?/ }).click();
    await page.getByRole('button', { name: 'Look them up' }).click();
    await expect(page.locator('.map-marker')).toHaveCount(1, { timeout: 15000 });
    expect(await page.evaluate(() => window.Strom.DataManager.getData().places?.boston?.lon))
        .toBeCloseTo(-71.06, 1);  // wrong Boston

    // The pin is reachable from the marker itself — that is where you see it.
    await page.locator('.map-marker[data-key="boston"] .map-marker-dot').click();
    await page.getByRole('button', { name: /Wrong spot/i }).click();
    const row = page.locator('.place-row[data-key="boston"]');
    // Coming from the marker, the search is already open — that is the point.
    await expect(row.locator('.place-query')).toBeVisible();
    await row.locator('.place-query').fill('Boston, Lincolnshire');
    await row.locator('.place-search-go').click();
    await row.locator('.place-candidate').first().click();

    expect(await page.evaluate(() => window.Strom.DataManager.getData().places?.boston?.lon))
        .toBeCloseTo(-0.03, 1);  // right Boston
    await expect(page.locator('.map-marker')).toHaveCount(1);
});

test('places can be fixed without going to the map', async ({ page }) => {
    await stubTiles(page);
    await stubGeocoder(page, { 'Kolín': [50.0281, 15.2003] });

    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1900' });
    await addRelation(page, 'Jan', 'parent', 'Otec', 'Novak');
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const set = (n: string, place: string) => {
            const p = dm.getAllPersons().find((x: { firstName: string }) => x.firstName === n);
            if (p) dm.updatePerson(p.id, { birthPlace: place });
        };
        set('Jan', 'Kolin');
        set('Otec', 'Beroun');
        // Only Jan on screen: the dialog must still cover the whole tree, since
        // "this view" means nothing when you are not looking at the map.
        window.Strom.TreeRenderer.setFocusDepth(0, 0);
    });

    // Renaming a place is a data job, so it is reachable from the tree manager.
    await page.evaluate(() => window.Strom.UI.showTreeManagerDialog());
    await page.locator('.tree-row-menu-btn').first().click();
    await page.locator('.tree-row-menu-item', { hasText: 'Places' }).click();

    await expect(page.locator('#places-modal')).toBeVisible();
    await expect(page.locator('.place-row')).toHaveCount(2);   // whole tree, not the view

    // Fix the spelling; every use in the tree follows.
    const row = page.locator('.place-row[data-key="kolin"]');
    await row.locator('.place-name').fill('Kolín');
    await row.getByRole('button', { name: 'Rename' }).click();
    expect(await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        return dm.getAllPersons().find((x: { firstName: string }) => x.firstName === 'Jan')?.birthPlace;
    })).toBe('Kolín');

    // Escape goes back where it came from.
    await page.keyboard.press('Escape');
    await expect(page.locator('#places-modal')).toHaveCount(0);
    await expect(page.locator('#tree-manager-modal')).toHaveClass(/active/);
});

test('a pin can be removed, and the place stays', async ({ page }) => {
    await stubTiles(page);
    await stubGeocoder(page, { Greenwich: [51.48, 0.0], Pembroke: [51.67, -4.91] });

    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();
    await seedPlaces(page);

    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: /Look up \d+ places?/ }).click();
    await page.getByRole('button', { name: 'Look them up' }).click();
    await expect(page.locator('.map-marker')).toHaveCount(2, { timeout: 15000 });

    await page.getByRole('button', { name: 'Places', exact: true }).click();
    await page.locator('.place-row[data-key="greenwich"]').getByRole('button', { name: 'Remove' }).click();

    // The pin is gone from the map, but nobody lost their birthplace.
    await expect(page.locator('.map-marker')).toHaveCount(1);
    const after = await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const p = dm.getAllPersons().find((x: { firstName: string }) => x.firstName === 'Henry VIII');
        return { place: p?.birthPlace, keys: Object.keys(dm.getData().places ?? {}) };
    });
    expect(after.place).toBe('Greenwich');
    expect(after.keys).toEqual(['pembroke']);
});

test('renaming a place fixes it everywhere and keeps its pin', async ({ page }) => {
    await stubTiles(page);
    await stubGeocoder(page, { 'Grenwich': [51.48, 0.0] });

    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();
    // The same typo on two people — a rename must catch both.
    await setPlaces(page, { 'Henry VIII': 'Grenwich', 'Henry VII': 'Grenwich' });

    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: /Look up \d+ places?/ }).click();
    await page.getByRole('button', { name: 'Look them up' }).click();
    await expect(page.locator('.map-marker')).toHaveCount(1, { timeout: 15000 });

    await page.getByRole('button', { name: 'Places', exact: true }).click();
    const row = page.locator('.place-row[data-key="grenwich"]');
    await row.locator('.place-name').fill('Greenwich');
    await row.getByRole('button', { name: 'Rename' }).click();

    const after = await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const places = dm.getAllPersons()
            .filter((x: { firstName: string }) => x.firstName.startsWith('Henry V'))
            .map((x: { birthPlace?: string }) => x.birthPlace);
        return { places, keys: Object.keys(dm.getData().places ?? {}) };
    });
    // Both people renamed...
    expect(after.places).toEqual(['Greenwich', 'Greenwich']);
    // ...and the coordinates moved to the new key rather than being orphaned.
    expect(after.keys).toEqual(['greenwich']);
    await expect(page.locator('.map-marker')).toHaveCount(1);
});

test('nothing is sent when the user declines', async ({ page }) => {
    await stubTiles(page);
    const asked = await stubGeocoder(page, { Greenwich: [51.48, 0.0] });

    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Henry VIII')).toBeVisible();
    await seedPlaces(page);

    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: /Look up \d+ places?/ }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.locator('.map-marker')).toHaveCount(0);
    expect(asked).toEqual([]);
    // The offer is still there — declining is not a permanent no.
    await expect(page.getByRole('button', { name: /Look up \d+ places?/ })).toBeVisible();
});

test('the scope switch covers the whole tree, not just the view', async ({ page }) => {
    await stubTiles(page);
    const asked = await stubGeocoder(page, { 'Kolín': [50.0281, 15.2003], 'Beroun': [49.9639, 14.0722] });

    // A tree of its own: the sample tree ships places for everybody, which is
    // exactly what this test needs to control.
    await openApp(page);
    await createFirstPerson(page, 'Jan', 'Novak', { birthDate: '1900' });
    await addRelation(page, 'Jan', 'parent', 'Otec', 'Novak');
    await page.evaluate(() => {
        const dm = window.Strom.DataManager;
        const set = (n: string, place: string) => {
            const p = dm.getAllPersons().find((x: { firstName: string }) => x.firstName === n);
            if (p) dm.updatePerson(p.id, { birthPlace: place });
        };
        set('Jan', 'Kolín');
        set('Otec', 'Beroun');
        // Narrow the view to Jan alone, so the two scopes differ.
        window.Strom.TreeRenderer.setFocusDepth(0, 0);
    });

    // The lookup covers the scope in use: only Jan is on screen, so only his
    // place is asked about.
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: 'Look up 1 place', exact: true }).click();
    await page.getByRole('button', { name: 'Look them up' }).click();
    await expect(page.locator('.map-marker')).toHaveCount(1, { timeout: 15000 });
    expect(asked).toEqual(['Kolín']);

    // Widening to the whole tree brings the rest of the family's places into
    // play — the one nobody has looked up yet is offered, not silently skipped.
    await page.getByRole('button', { name: 'Whole tree' }).click();
    await expect(page.locator('.map-marker')).toHaveCount(1);
    await page.getByRole('button', { name: 'Look up 1 place', exact: true }).click();
    await expect(page.locator('.map-marker')).toHaveCount(2, { timeout: 15000 });
    expect(asked).toEqual(['Kolín', 'Beroun']);

    // Consent already given, so the second lookup went ahead without re-asking.
    await expect(page.getByRole('button', { name: 'Look them up' })).toBeHidden();

    // Back to the view: Beroun keeps its coordinates but is out of scope.
    await page.getByRole('button', { name: 'This view' }).click();
    await expect(page.locator('.map-marker')).toHaveCount(1);
});
