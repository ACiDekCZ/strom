import { test, expect, Page, Locator } from '@playwright/test';
import { openApp, seedTree } from './helpers.js';
import { fakeBridge, fakePlaces, openResearch, poll, researchGed, HEAD, FakeBridge, FakePlaces } from './research-bridge.js';

/**
 * Place identification on the map and on the person card (spec 034 §7, §8):
 * the map's bar after its own lookup (what it did not find goes on to the
 * research, "N to confirm"), the Check mark on a point and Keep in its
 * bubble, the bubble of a place the research identified (its origin, one
 * line of why, "Why here ›"), the state badge of a place without a location
 * on the person card and its menu, without a research and on a phone.
 * Invented places and people (the Brindak family).
 */

/** The tree's place key (placeKey): no accents, lowercase, dots and commas as spaces. */
const key = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[.,;]/g, ' ').replace(/\s+/g, ' ').trim();

/** One person of the research with a birth and a death (year, place). */
function person(id: string, first: string, birth: [number, string], death: [number, string]): string[] {
    return [
        `0 @${id}@ INDI`, `1 NAME ${first} /Brindak/`, '1 SEX M', `1 REFN ${id}`, '2 TYPE strom-research',
        '1 BIRT', `2 DATE ${birth[0]}`, `2 PLAC ${birth[1]}`,
        '1 DEAT', `2 DATE ${death[0]}`, `2 PLAC ${death[1]}`,
    ];
}

/**
 * Lhota, Lhotínek and Lhotov close together, Jinov far away (the app's check
 * marks it), Horní Lhota without a location, Łotów not identified by the
 * research, Lhoták čp. 3 waiting to be confirmed.
 */
const GED = researchGed(HEAD, [
    ...person('P0004', 'Zorbin', [1860, 'Lhota'], [1878, 'Lhotínek']),
    ...person('P0005', 'Quilla', [1865, 'Lhotov'], [1875, 'Jinov']),
    ...person('P0006', 'Yarek', [1870, 'Horní Lhota'], [1880, 'Łotów']),
    ...person('P0007', 'Orvel', [1868, 'Lhotínek'], [1885, 'Lhoták čp. 3']),
]);

const LHOTA = { lat: 49.6, lon: 15.4 };

function placesReply(): Record<string, unknown> {
    return {
        rev: 'p1',
        places: {
            L0001: {
                name: 'Lhota', country: 'CZ', district: 'Jinov', coords: LHOTA, state: 'identified', by: 'research', at: '2026-10-20',
                why: 'The parish of Lhota keeps the records of the family. Its registers name the farm.',
                forms: ['Lhota'], facts: 1, persons: 1,
            },
            L0002: { name: 'Łotów', state: 'unlocated', unlocated: 'Three villages of this name in the region.', forms: ['Łotów'] },
        },
        forms: { 'Lhoták čp. 3': { state: 'proposed' } },
        queue: { queued: 0, running: 0 },
        counts: { offMap: 3, placed: 4, proposed: 1, unlocated: 1 },
    };
}

/** A bridge that keeps the queue as the research does: queued forms come back as `queued`. */
function livePlaces(): FakePlaces {
    const p = fakePlaces({ reply: placesReply() });
    p.identifyReply = (body) => {
        const forms = (p.reply.forms ?? {}) as Record<string, unknown>;
        // Everything off the map: what the research would take (no location, not identified).
        const asked = Array.isArray(body.forms) ? body.forms as string[] : body.all === 'offmap' ? ['Horní Lhota', 'Łotów'] : [];
        for (const f of asked) forms[f] = { state: 'queued' };
        // A place the research keeps a record of (Łotów, not determined) goes back into its queue as a whole.
        const places = Object.fromEntries(Object.entries((p.reply.places ?? {}) as Record<string, { forms?: string[] }>)
            .map(([id, rec]) => [id, (rec.forms ?? []).some(f => asked.includes(f)) ? { ...rec, state: 'queued' } : rec]));
        p.reply = { ...p.reply, rev: `p${p.identify.length + 1}`, forms, places };
        return { status: 200, body: { ok: true, queued: asked.length, skipped: [] } };
    };
    return p;
}

/** Map tiles answered locally (and already acknowledged); the geocoder finds nothing. */
async function stubMap(page: Page): Promise<string[]> {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await page.route('**://tile.openstreetmap.org/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: png }));
    await page.addInitScript(() => {
        const raw = localStorage.getItem('strom-settings');
        const settings = raw ? JSON.parse(raw) : {};
        settings.mapTiles = true;
        localStorage.setItem('strom-settings', JSON.stringify(settings));
    });
    const asked: string[] = [];
    await page.route('**://nominatim.openstreetmap.org/**', route => {
        asked.push(new URL(route.request().url()).searchParams.get('q') ?? '');
        void route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    return asked;
}

/** The tree's own locations: Lhota as the research has it, Lhotov by hand, Lhotínek and Jinov from the map. */
async function setGeos(page: Page): Promise<void> {
    await page.evaluate(({ lhota }) => {
        const S = window.Strom;
        S.DataManager.getData().places = {
            lhota: { ...lhota, label: 'Lhota' },
            lhotinek: { lat: 49.63, lon: 15.46, label: 'Lhotínek' },
            lhotov: { lat: 49.57, lon: 15.36, label: 'Lhotov', origin: 'hand' },
            jinov: { lat: 50.3, lon: 16.9, label: 'Jinov' },
        };
        S.TreeRenderer.render();
        S.UI.dismissUndoToast();
        document.querySelectorAll('.toast').forEach(t => t.remove());
    }, { lhota: LHOTA });
}

async function research(page: Page): Promise<FakeBridge> {
    const b = await fakeBridge(page, { features: ['places.identify'], treeGed: GED, places: livePlaces() });
    await openResearch(page, { ged: GED });
    await poll(page);
    await setGeos(page);
    return b;
}

const clearToasts = (page: Page): Promise<void> => page.evaluate(() => {
    window.Strom.UI.dismissUndoToast();
    document.querySelectorAll('.toast, .family-offer').forEach(t => t.remove());
});

/** The map open on a place, its bubble open (the whole tree in scope). */
async function mapOn(page: Page, place: string): Promise<void> {
    await page.evaluate((k) => window.Strom.UI.showPlaceOnMap(k), key(place));
    await expect(page.locator('#map-container')).toBeVisible();
    await expect(page.locator('.map-popup')).toBeVisible();
}

const marker = (page: Page, place: string): Locator => page.locator(`.map-marker[data-key="${key(place)}"]`);
const popup = (page: Page): Locator => page.locator('.map-popup');

/** The person card of a Brindak, its life timeline drawn. */
async function card(page: Page, first: string): Promise<Locator> {
    await page.evaluate((name) => {
        const p = window.Strom.DataManager.getAllPersons().find((x: { firstName: string }) => x.firstName === name);
        window.Strom.UI.showEditPersonModal(p!.id);
    }, first);
    const body = page.locator('#pm-lifeline-body');
    await expect(body.locator('.pm-lifeline-row').first()).toBeVisible();
    return body;
}

const placeIn = (body: Locator, place: string): Locator =>
    body.locator('.pm-lifeline-place').filter({ has: body.page().locator(`button[data-place="${place}"]`) });

/** Nothing wider than the screen. */
async function noSideScroll(page: Page): Promise<void> {
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

test.describe('places on the map with the research here', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('after the map\'s lookup: "N not found by the map", ◆ Look up in the research opens Places with its preview, "N to confirm" opens Waiting', async ({ page }) => {
        const asked = await stubMap(page);
        const b = await research(page);
        await mapOn(page, 'Lhota');
        await page.evaluate(() => { window.Strom.UI.closeMapPopup(); window.Strom.UI.setMapScope('tree'); });
        await expect.poll(() => b.places!.reads).toBeGreaterThan(0);
        await clearToasts(page);
        const bar = page.locator('#map-status');
        // Before the lookup: the map's lookup, the research's beside it (spec 058), Places.
        await expect(bar).toContainText('4 places on the map, 3 without coordinates.');
        await expect(bar.getByRole('button', { name: 'Look up 3 places' })).toBeVisible();
        await expect(bar.getByRole('button', { name: 'In the research, AI' })).toBeVisible();
        await expect(bar.locator('.map-status-confirm')).toHaveCount(0);

        await bar.getByRole('button', { name: 'Look up 3 places' }).click();
        await page.getByRole('button', { name: 'Look them up' }).click();
        await expect(bar).toContainText('4 places on the map · 3 not found by the map', { timeout: 20000 });
        expect(asked.length).toBeGreaterThan(0);
        await clearToasts(page);
        // What the map did not find goes on to the research (spec 058 K1.4): the two it can look up
        // (Lhoták čp. 3 waits for an answer), with the AI badge alone (queued through the bridge, no terminal).
        const names = await bar.locator('button').evaluateAll(bs => bs.map(b => (b.textContent ?? '').replace(/\s+/g, ' ').trim()));
        expect(names).toEqual(['Look up in the research (2), AIAI', '? 1 to confirm ›', 'Places']);
        await expect(bar.locator('.map-status-research .research-ai-badge')).toHaveText('AI');
        await expect(bar.locator('.map-status-research .research-open-mark')).toHaveCount(0);

        // Look up: Places with the "No location" chip and the preview of looking them up.
        await bar.locator('.map-status-research').click();
        const modal = page.locator('#places-modal');
        await expect(modal).toBeVisible();
        await expect(modal.locator('.places-chip[data-filter="none"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(modal.locator('.places-bulk')).toBeVisible();
        expect(b.places!.identify).toEqual([]);
        await page.evaluate(() => window.Strom.UI.closePlacesManager());

        // "? 1 to confirm ›": Waiting in the research panel.
        await page.evaluate(() => {
            const ui = window.Strom.UI as unknown as { __waiting: number; showResearchWaiting: () => void };
            ui.__waiting = 0;
            ui.showResearchWaiting = () => { ui.__waiting++; };
        });
        await clearToasts(page);
        await bar.locator('.map-status-confirm').click();
        expect(await page.evaluate(() => (window.Strom.UI as unknown as { __waiting: number }).__waiting)).toBe(1);
    });

    test('before the map\'s lookup "In the research" (AI) opens Places with the preview; nothing goes before Queue, nothing twice after it (spec 058)', async ({ page }) => {
        await stubMap(page);
        const b = await research(page);
        await mapOn(page, 'Lhota');
        await page.evaluate(() => { window.Strom.UI.closeMapPopup(); window.Strom.UI.setMapScope('tree'); });
        await expect.poll(() => b.places!.reads).toBeGreaterThan(0);
        await clearToasts(page);
        const bar = page.locator('#map-status');
        const look = bar.locator('.map-status-research');
        await expect(look).toHaveAccessibleName('In the research, AI');
        await expect(look.locator('.research-ai-badge')).toBeVisible();
        await expect(look.locator('.research-open-mark')).toHaveCount(0);
        await look.click();
        const modal = page.locator('#places-modal');
        await expect(modal).toBeVisible();
        await expect(modal.locator('.places-chip[data-filter="none"]')).toHaveAttribute('aria-pressed', 'true');
        const preview = modal.locator('.places-bulk');
        await expect(preview.locator('.places-bulk-head')).toHaveText('Look up 2 places not on the map in the research');
        expect(b.places!.identify).toEqual([]);
        await preview.locator('.places-bulk-go').click();
        await expect.poll(() => b.places!.identify.length).toBe(1);
        expect(b.places!.identify[0]).toMatchObject({ do: 'queue', all: 'offmap' });
        await page.evaluate(() => window.Strom.UI.closePlacesManager());
        // Queued in the research now: the bar does not offer them again.
        await expect(bar.getByRole('button', { name: 'Look up 3 places' })).toBeVisible();
        await expect(look).toHaveCount(0);
    });

    test('the research on another computer: "In the research" stays, a click says where it goes, nothing opens (spec 058)', async ({ page }) => {
        await stubMap(page);
        await openResearch(page, { ged: GED, bridge: false });
        await setGeos(page);
        await mapOn(page, 'Lhota');
        await page.evaluate(() => { window.Strom.UI.closeMapPopup(); window.Strom.UI.setMapScope('tree'); });
        await clearToasts(page);
        const bar = page.locator('#map-status');
        await bar.locator('.map-status-research').click();
        await expect(page.locator('.toast')).toContainText('Look up and check work in the research on the computer where it runs.');
        await expect(page.locator('#places-modal')).toBeHidden();
    });

    test('a point to check: "!" with its reason; Keep in its bubble takes the mark away, the location stays', async ({ page }) => {
        await stubMap(page);
        await research(page);
        await mapOn(page, 'Jinov');
        const mark = marker(page, 'Jinov').locator('.map-marker-check');
        await expect(mark).toBeVisible();
        await expect(mark).toHaveAttribute('title', /^Check: \d+ km from the other places of the Brindak family/);
        await expect(marker(page, 'Lhotínek').locator('.map-marker-check')).toHaveCount(0);

        const check = popup(page).locator('.map-popup-check');
        await expect(check).toContainText(/\d+ km from the other places/);
        await expect(popup(page).locator('.map-popup-origin')).toContainText('From the map (OpenStreetMap)');
        await expect(check.getByRole('button', { name: 'Keep' })).toBeVisible();
        await expect(check.getByRole('button', { name: 'Change' })).toBeVisible();
        await expect(check.locator('.map-popup-checkres')).toHaveText('Check in the research');

        await check.getByRole('button', { name: 'Keep' }).click();
        await expect(mark).toHaveCount(0);
        await expect(popup(page)).toBeVisible();
        await expect(popup(page).locator('.map-popup-check')).toHaveCount(0);
        const geo = await page.evaluate(() => window.Strom.DataManager.getData().places?.jinov);
        expect(geo).toMatchObject({ lat: 50.3, lon: 16.9, label: 'Jinov' });
        expect(geo?.keptAt).toBeTruthy();
    });

    test('a place the research identified: its origin, today\'s name, one line of why; Why here › opens Places on it', async ({ page }) => {
        await stubMap(page);
        const b = await research(page);
        await mapOn(page, 'Lhota');
        await expect.poll(() => b.places!.reads).toBeGreaterThan(0);
        await expect(popup(page).locator('.place-origin[data-origin="research"]')).toContainText('Identified by the research');
        await expect(popup(page).locator('.map-popup-label')).toContainText('Lhota, Jinov District, Czechia');
        await expect(popup(page).locator('.map-popup-why p')).toHaveText('The parish of Lhota keeps the records of the family.');
        await expect(popup(page).locator('.map-popup-check, .map-popup-checkres')).toHaveCount(0);
        await popup(page).getByRole('button', { name: 'Why here ›' }).click();
        const row = page.locator(`#places-modal .place-row[data-key="lhota"]`);
        await expect(row).toBeVisible();
        await expect(row.locator('.place-why')).toBeVisible();
    });
});

test.describe('places without a location on the person card', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the state badge and its menu: ◆ Look up queues the place; Not identified offers the detail; Esc closes', async ({ page }) => {
        const b = await research(page);
        const body = await card(page, 'Yarek');
        await expect.poll(() => b.places!.reads).toBeGreaterThan(0);
        const horni = placeIn(body, 'Horní Lhota');
        await expect(horni.locator('.pm-place-badge')).toHaveAttribute('data-state', 'none');
        await expect(horni.locator('.pm-place-badge')).toHaveText(/no location/);
        await expect(placeIn(body, 'Łotów').locator('.pm-place-badge')).toHaveAttribute('data-state', 'undet');

        await horni.locator('button[data-place]').click();
        const menu = page.locator('.place-menu[role="menu"]');
        await expect(menu).toBeVisible();
        await expect(menu.locator('.place-menu-head')).toContainText('Horní Lhota');
        await expect(menu.locator('.place-menu-head')).toContainText('Not on the map yet');
        expect((await menu.locator('[data-action]').allTextContents()).map(t => t.replace(/\s+/g, ' ').trim()))
            .toEqual(['Find on the map', 'Look up in the research', 'Open in Places']);
        await expect(menu.locator('.place-menu-item.is-primary')).toHaveText('Find on the map');
        expect((await menu.boundingBox())!.width).toBeCloseTo(300, 0);
        await menu.locator('[data-action="look"]').click();
        await expect(menu).toHaveCount(0);
        await expect.poll(() => b.places!.identify).toEqual([{ do: 'queue', forms: ['Horní Lhota'] }]);
        await expect(page.locator('.toast')).toContainText('1 place queued for the research.');
        await expect(placeIn(body, 'Horní Lhota').locator('.pm-place-badge')).toHaveAttribute('data-state', 'queued');

        // Not identified: the detail in Places first, Look up again; Esc closes and gives the focus back.
        const lotow = placeIn(body, 'Łotów').locator('button[data-place]');
        await placeIn(body, 'Łotów').locator('.pm-place-badge').click();
        await expect(menu).toBeVisible();
        expect((await menu.locator('[data-action]').allTextContents()).map(t => t.replace(/\s+/g, ' ').trim()))
            .toEqual(['Open in Places', 'Look up again', 'Find on the map']);
        await expect(menu.locator('.place-menu-head')).toContainText('Not identified: Three villages of this name in the region.');
        await expect(menu.locator('[data-action="places"]')).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(menu.locator('[data-action="lookAgain"]')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await expect(lotow).toBeFocused();
        await expect(page.locator('#person-modal')).toHaveClass(/active/);

        // Open in Places: the dialog on the row with Why here open.
        await lotow.click();
        await menu.locator('[data-action="places"]').click();
        const row = page.locator(`#places-modal .place-row[data-key="${key('Łotów')}"]`);
        await expect(row).toBeVisible();
        await expect(row.locator('.place-why')).toBeVisible();
    });

    test('a place with a location still opens the map; to confirm answers in Waiting', async ({ page }) => {
        await stubMap(page);
        await research(page);
        const body = await card(page, 'Orvel');
        await expect(placeIn(body, 'Lhotínek').locator('.pm-place-badge')).toHaveCount(0);
        const confirm = placeIn(body, 'Lhoták čp. 3');
        await expect(confirm.locator('.pm-place-badge')).toHaveAttribute('data-state', 'confirm');
        await confirm.locator('button[data-place]').click();
        const menu = page.locator('.place-menu[role="menu"]');
        expect((await menu.locator('[data-action]').allTextContents()).map(t => t.trim()))
            .toEqual(['Answer in Waiting ›', 'Find on the map', 'Open in Places']);
        await page.keyboard.press('Escape');
        await placeIn(body, 'Lhotínek').locator('button[data-place]').click();
        await expect(page.locator('#map-container')).toBeVisible();
        await expect(popup(page)).toContainText('Lhotínek');
    });
});

test('a tree without a research: the badge and Find on the map, no ◆ and no word of the research', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await seedTree(page, {
        a: { firstName: 'Yarek', lastName: 'Brindak', birthDate: '1870', birthPlace: 'Horní Lhota', deathDate: '1880', deathPlace: 'Lhotov' },
    } as never, 'Brindak');
    const body = await card(page, 'Yarek');
    await expect(placeIn(body, 'Horní Lhota').locator('.pm-place-badge')).toHaveAttribute('data-state', 'none');
    await placeIn(body, 'Horní Lhota').locator('button[data-place]').click();
    const menu = page.locator('.place-menu[role="menu"]');
    expect((await menu.locator('[data-action]').allTextContents()).map(t => t.trim())).toEqual(['Find on the map', 'Open in Places']);
    await expect(menu).not.toContainText('research');
    await menu.locator('[data-action="find"]').click();
    const row = page.locator(`#places-modal .place-row[data-key="${key('Horní Lhota')}"]`);
    await expect(row.locator('.place-search')).toBeVisible();
});

test('a tree without a research: the map\'s bar as before, no step of the research (spec 058)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await stubMap(page);
    await openApp(page);
    await seedTree(page, {
        a: { firstName: 'Yarek', lastName: 'Brindak', birthDate: '1870', birthPlace: 'Horní Lhota', deathDate: '1880', deathPlace: 'Lhota' },
    } as never, 'Brindak');
    await page.evaluate(({ lhota }) => { window.Strom.DataManager.getData().places = { lhota: { ...lhota, label: 'Lhota' } }; }, { lhota: LHOTA });
    await mapOn(page, 'Lhota');
    await page.evaluate(() => { window.Strom.UI.closeMapPopup(); window.Strom.UI.setMapScope('tree'); });
    const bar = page.locator('#map-status');
    await expect(bar).toContainText('1 place on the map, 1 without coordinates.');
    expect((await bar.locator('button').allTextContents()).map(t => t.trim())).toEqual(['Look up 1 place', 'Places']);
    await expect(bar).not.toContainText('research');
});

test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the place menu as a sheet with 48 px rows and where ◆ goes; the bubble as a sheet over the bar; no horizontal scroll', async ({ page }) => {
        await stubMap(page);
        const b = await research(page);
        const body = await card(page, 'Yarek');
        await placeIn(body, 'Horní Lhota').locator('button[data-place]').click();
        const sheet = page.locator('.bottom-sheet.place-menu-sheet');
        await expect(sheet).toBeVisible();
        const items = sheet.locator('[data-action]');
        expect((await items.allTextContents()).map(t => t.trim())).toEqual(['Find on the map', 'Open in Places']);
        for (const box of await items.evaluateAll(els => els.map(e => e.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(48);
        await expect(sheet.locator('.place-menu-note')).toHaveText('Look up in the research works on the computer with the research.');
        await noSideScroll(page);
        await page.evaluate(() => window.Strom.UI.hideBottomSheet());
        await page.evaluate(() => window.Strom.UI.forceCloseModal());

        await mapOn(page, 'Jinov');
        await expect(popup(page)).toHaveClass(/map-popup--sheet/);
        await expect(page.locator('#map-status')).toBeHidden();
        const check = popup(page).locator('.map-popup-check');
        await expect(check.locator('.map-popup-checkres')).toHaveCount(0);
        await expect(check.locator('.map-popup-note')).toHaveText('Check in the research works on the computer with the research.');
        for (const name of ['Keep', 'Change']) {
            expect((await check.getByRole('button', { name }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
        await noSideScroll(page);
        await popup(page).locator('.map-popup-close').click();
        await expect(page.locator('#map-status')).toBeVisible();
        expect(b.places!.identify).toEqual([]);
    });

    test('the map\'s bar: "In the research" only says where looking up goes, nothing is queued (spec 058)', async ({ page }) => {
        await stubMap(page);
        const b = await research(page);
        await mapOn(page, 'Lhota');
        await popup(page).locator('.map-popup-close').click();
        await page.evaluate(() => window.Strom.UI.setMapScope('tree'));
        await clearToasts(page);
        const bar = page.locator('#map-status');
        await bar.locator('.map-status-research').click();
        await expect(page.locator('.toast')).toContainText('Look up and check work on the computer with the research.');
        await expect(page.locator('#places-modal')).toBeHidden();
        expect(b.places!.identify).toEqual([]);
        await noSideScroll(page);
    });
});
