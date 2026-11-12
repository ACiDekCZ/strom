import { test, expect, Page, BrowserContext } from '@playwright/test';
import { card, openApp } from './helpers.js';

/**
 * The views drawn in a satellite window (spec 079 K2): Family, Descendants,
 * Fan, Timeline and Map draw there as in the main window (the minimap, the
 * generations' labels, the map's markers, the fan's sectors, the timeline's
 * rows), without an error in the console, and the window stores nothing —
 * not the settings, not the last view, not the reload point, not the fan's
 * or the map's choices (those stay in the window's memory).
 */

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const NOW = new Date('2026-06-15T10:00:00Z');

/** Every write to localStorage, sessionStorage and IndexedDB of the page, from its first script on. */
async function spyStorage(p: Page): Promise<void> {
    await p.addInitScript(() => {
        const w = window as unknown as { __writes: string[] };
        w.__writes = [];
        const st = Storage.prototype;
        const set = st.setItem, rem = st.removeItem, clr = st.clear;
        const name = (s: Storage) => (s === sessionStorage ? 'session' : 'local');
        st.setItem = function (this: Storage, k: string, v: string) { w.__writes.push(`${name(this)} set ${k}`); return set.call(this, k, v); };
        st.removeItem = function (this: Storage, k: string) { w.__writes.push(`${name(this)} remove ${k}`); return rem.call(this, k); };
        st.clear = function (this: Storage) { w.__writes.push(`${name(this)} clear`); return clr.call(this); };
        const os = IDBObjectStore.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
        for (const m of ['put', 'add', 'delete', 'clear']) {
            const orig = os[m];
            os[m] = function (this: IDBObjectStore, ...a: unknown[]) { w.__writes.push(`idb ${m} ${this.name}`); return orig.apply(this, a); };
        }
        const open = indexedDB.open.bind(indexedDB);
        indexedDB.open = (n: string, v?: number) => { w.__writes.push(`idb open ${n}`); return open(n, v); };
    });
}

const writesOf = (p: Page) => p.evaluate(() => (window as unknown as { __writes: string[] }).__writes);

/** The main window with the sample tree (places with coordinates, photos), its focus on a grandchild. */
async function openMain(page: Page, context: BrowserContext): Promise<string> {
    await context.clock.install({ time: NOW });
    await context.route('**://tile.openstreetmap.org/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
    await context.route('**://nominatim.openstreetmap.org/**', r => r.abort());
    await page.addInitScript(() => {
        try {
            const raw = localStorage.getItem('strom-settings');
            const s = raw ? JSON.parse(raw) : {};
            if (s.mapTiles === undefined) s.mapTiles = true;
            localStorage.setItem('strom-settings', JSON.stringify(s));
        } catch { /* no storage */ }
    });
    await page.setViewportSize({ width: 1400, height: 900 });
    await openApp(page);
    await page.getByRole('button', { name: 'Try a sample tree' }).click();
    await expect(card(page, 'Johan')).toBeVisible();
    return page.evaluate(() => window.Strom.DataManager.getCurrentTreeId() as string);
}

/** A satellite of `kind` with the tree in (errors collected). */
async function openSatellite(context: BrowserContext, treeId: string, kind: string, w: string, errors: string[]): Promise<Page> {
    const sat = await context.newPage();
    sat.on('console', m => { if (m.type() === 'error') errors.push(`${kind}: ${m.text()}`); });
    sat.on('pageerror', e => errors.push(`${kind}: ${e.message}`));
    await spyStorage(sat);
    await sat.setViewportSize({ width: 1200, height: 800 });
    await sat.goto(`/strom.html?okno=${kind}&tree=${encodeURIComponent(treeId)}&w=${w}`);
    await expect(sat.locator('html')).not.toHaveClass(/app-loading/);
    await expect(sat.locator('.sat-header-title')).toHaveText('Sample: the Berg family');
    return sat;
}

const personId = (page: Page, firstName: string, lastName: string) => page.evaluate(([f, l]) =>
    window.Strom.DataManager.getAllPersons().find(p => p.firstName === f && p.lastName === l)!.id as string, [firstName, lastName]);

test('every view draws in a satellite without an error, and the window stores nothing', async ({ page, context }) => {
    test.setTimeout(60_000);
    const treeId = await openMain(page, context);
    const errors: string[] = [];

    // Family and Descendants: the cards, the generations' labels, the minimap; wheel and drag move the chart.
    const fam = await openSatellite(context, treeId, 'family', 'cv01aa', errors);
    await expect(card(fam, 'Johan')).toBeVisible();
    await expect(fam.locator('#tree-container .gen-label').first()).toBeVisible();
    await expect(fam.locator('#minimap-panel')).toBeVisible();
    const scale = await fam.evaluate(() => window.Strom.ZoomPan.getScale());
    await fam.mouse.move(600, 450);
    await fam.mouse.wheel(0, -300);
    await expect.poll(() => fam.evaluate(() => window.Strom.ZoomPan.getScale())).not.toBe(scale);
    // Another person in this window's centre.
    await fam.evaluate(async (id) => { await window.Strom.TreeRenderer.setFocus(id as never); }, await personId(fam, 'Erik', 'Berg'));
    await expect.poll(() => fam.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId())).toBe(await personId(fam, 'Erik', 'Berg'));
    await fam.locator('.sat-view-segment').getByRole('button', { name: 'Descendants' }).click();
    await expect(card(fam, 'Erik')).toBeVisible();
    await expect(fam.locator('#tree-container .gen-label').first()).toBeVisible();
    expect(await writesOf(fam)).toEqual([]);
    await fam.close();

    // Fan: its sectors; its shape, generations, colours and legend are this window's (memory only).
    const fan = await openSatellite(context, treeId, 'fan', 'cv02aa', errors);
    await fan.evaluate(async (id) => { await window.Strom.TreeRenderer.setFocus(id as never); }, await personId(page, 'Thomas', 'Berg'));
    await expect(fan.locator('#fan-chart .fan-sector[data-fan-person]').first()).toBeVisible();
    await fan.locator('#fan-toolbar [data-fan-shape="full"]').click();
    await expect.poll(() => fan.evaluate(() => window.Strom.TreeRenderer.getFanShape())).toBe('full');
    await fan.locator('#fan-toolbar [data-fan-color="line"]').click();
    await expect.poll(() => fan.evaluate(() => window.Strom.TreeRenderer.getFanColorMode())).not.toBe('gender');
    const gens = await fan.evaluate(() => window.Strom.TreeRenderer.getFanGenerations());
    await fan.evaluate((n) => window.Strom.TreeRenderer.setFanGenerations(n - 1), gens);
    await fan.locator('#fan-legend-head').click();
    expect(await writesOf(fan)).toEqual([]);
    // The main window's fan is as it was.
    expect(await page.evaluate(() => [window.Strom.TreeRenderer.getFanShape(), window.Strom.TreeRenderer.getFanGenerations()])).toEqual(['half', gens]);
    await fan.close();

    // Timeline: a row per person shown.
    const tl = await openSatellite(context, treeId, 'timeline', 'cv03aa', errors);
    await expect(tl.locator('#timeline-container .timeline-bar').first()).toBeVisible();
    await tl.locator('#timeline-container .timeline-bar', { hasText: 'Johan Berg' }).click();
    await expect.poll(() => tl.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId())).toBe(await personId(tl, 'Johan', 'Berg'));
    expect(await writesOf(tl)).toEqual([]);
    await tl.close();

    // Map: tiles and markers; the scope, the kinds of places and the time layer stay in this window.
    const map = await openSatellite(context, treeId, 'map', 'cv04aa', errors);
    await expect(map.locator('#map-container .map-marker').first()).toBeVisible();
    await expect(map.locator('#map-container .map-tiles img').first()).toBeAttached();
    await map.getByRole('button', { name: 'Whole tree' }).click();
    await map.locator('#map-container .map-kinds .map-kind[data-kind="birth"]').click();
    await expect(map.locator('#map-container .map-kinds .map-kind[data-kind="birth"]')).toHaveAttribute('aria-pressed', 'false');
    await map.locator('#map-container .map-time-toggle').click();
    await expect(map.locator('#map-timebar')).toBeVisible();
    expect(await writesOf(map)).toEqual([]);
    await map.close();

    expect(errors).toEqual([]);
    // The main window's settings: the map's kinds as before.
    expect(await page.evaluate(() => window.Strom.SettingsManager.getMapKinds())).toContain('birth');
});

const menu = (p: Page) => p.locator('.context-menu.person-menu');
const nameOf = (p: Page, id: string) => p.evaluate((pid) => window.Strom.DataManager.getPerson(pid as never)?.firstName ?? null, id);

test('a Family satellite edits through the main window, in Undo of both; Focus and Descendants change this window only', async ({ page, context }) => {
    test.setTimeout(60_000);
    const treeId = await openMain(page, context);
    const errors: string[] = [];
    const sat = await openSatellite(context, treeId, 'family', 'cv11aa', errors);
    const johan = await personId(page, 'Johan', 'Berg');
    const mainFocus = await page.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId());

    // The person dialog: saved by the main window, shown in both.
    await card(sat, 'Johan').click();
    await expect(menu(sat).locator('[data-action="focus"]')).toBeVisible();
    await expect(menu(sat).locator('[data-action="descendants"]')).toBeVisible();
    await menu(sat).locator('[data-action="edit"]').click();
    await sat.locator('#input-firstname').fill('Johannes');
    await sat.locator('.modal').filter({ has: sat.locator('#input-firstname') }).getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => nameOf(page, johan)).toBe('Johannes');
    await expect(card(sat, 'Johannes')).toBeVisible();
    await expect(card(page, 'Johannes')).toBeVisible();
    // In the main window's Undo; the satellite's Undo takes it back in both.
    await expect(page.locator('#toolbar-undo-btn')).toBeEnabled();
    await sat.locator('#toolbar-undo-btn').click();
    await expect.poll(() => nameOf(page, johan)).toBe('Johan');
    await expect.poll(() => nameOf(sat, johan)).toBe('Johan');

    // Add a child from the card's menu: the main window saves it; its Undo takes it back in the satellite too.
    await card(sat, 'Johan').click();
    await menu(sat).locator('[data-action="child"]').click();
    const rel = sat.locator('#relation-modal');
    await expect(rel).toBeVisible();
    await rel.locator('#rel-firstname').fill('Ottokar');
    await rel.locator('#rel-submit-btn').click();
    await expect(rel).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.Strom.DataManager.getAllPersons().some(p => p.firstName === 'Ottokar'))).toBe(true);
    await page.locator('#toolbar-undo-btn').click();
    await expect.poll(() => sat.evaluate(() => window.Strom.DataManager.getAllPersons().some(p => p.firstName === 'Ottokar'))).toBe(false);

    // Focus and Descendants: this window's centre and view, the main window's stay.
    await card(sat, 'Johan').click();
    await menu(sat).locator('[data-action="focus"]').click();
    await expect.poll(() => sat.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId())).toBe(johan);
    await card(sat, 'Johan').click();
    await menu(sat).locator('[data-action="descendants"]').click();
    await expect.poll(() => sat.evaluate(() => window.Strom.TreeRenderer.getViewMode())).toBe('descendants');
    expect(await page.evaluate(() => [window.Strom.TreeRenderer.getFocusPersonId(), window.Strom.TreeRenderer.getViewMode()])).toEqual([mainFocus, 'family']);
    expect(await writesOf(sat)).toEqual([]);
    expect(errors).toEqual([]);
});

test('read-only while the main window follows a research or is closed: no edit, no add, the record only to look at', async ({ page, context }) => {
    test.setTimeout(60_000);
    const treeId = await openMain(page, context);
    const sat = await openSatellite(context, treeId, 'family', 'cv12aa', []);
    const johan = await personId(page, 'Johan', 'Berg');
    const editRows = () => menu(sat).locator('[data-action="edit"], [data-action="add"], [data-action="child"], [data-action="parent"], [data-action="partner"], [data-action="delete"]');

    // The main window follows a research (its status says so).
    await page.evaluate(() => {
        (window.Strom.DataManager as unknown as { isLiveFollowing(): boolean }).isLiveFollowing = () => true;
        window.dispatchEvent(new CustomEvent('strom:data-changed'));
    });
    await expect.poll(() => sat.evaluate(() => window.Strom.DataManager.isTreeLocked())).toBe(true);
    await card(sat, 'Johan').click();
    await expect(menu(sat).locator('[data-action="view"]')).toBeVisible();
    await expect(editRows()).toHaveCount(0);
    // Focus stays (this window's view).
    await expect(menu(sat).locator('[data-action="focus"]')).toBeVisible();
    await sat.keyboard.press('Escape');
    // An edit tried anyway is refused: the data stay.
    await sat.evaluate((id) => { window.Strom.DataManager.updatePerson(id as never, { firstName: 'Johannes' } as never); }, johan);
    expect(await nameOf(page, johan)).toBe('Johan');

    // Following ends; then the main window closes.
    await page.evaluate(() => {
        (window.Strom.DataManager as unknown as { isLiveFollowing(): boolean }).isLiveFollowing = () => false;
        window.dispatchEvent(new CustomEvent('strom:data-changed'));
    });
    await expect.poll(() => sat.evaluate(() => window.Strom.DataManager.isTreeLocked())).toBe(false);
    await page.close();
    await expect.poll(() => sat.evaluate(() => window.Strom.DataManager.isTreeLocked())).toBe(true);
    await card(sat, 'Johan').click();
    await expect(menu(sat).locator('[data-action="view"]')).toBeVisible();
    await expect(editRows()).toHaveCount(0);
});

const focusOf = (p: Page) => p.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId() as string | null);
const selectedIn = (p: Page) => p.evaluate(() => window.Strom.TreeRenderer.getWindowSelected() as string | null);
const chooseIn = (p: Page, id: string) => p.evaluate(async (pid) => { await window.Strom.TreeRenderer.setFocus(pid as never); }, id);

test('the selection between the main window and a chart satellite: the card, the sector, the row; a focus here goes out', async ({ page, context }) => {
    test.setTimeout(60_000);
    const treeId = await openMain(page, context);
    const sat = await openSatellite(context, treeId, 'family', 'cv21aa', []);
    const [johan, erik, thomas] = [await personId(page, 'Johan', 'Berg'), await personId(page, 'Erik', 'Berg'), await personId(page, 'Thomas', 'Berg')];
    // Opening the window chose nobody.
    await page.waitForTimeout(300);
    expect(await selectedIn(page)).toBeNull();
    const satFocus = await focusOf(sat);

    // Main → satellite: the card's ring; the satellite's centre stays.
    const other = (await focusOf(page)) === erik ? thomas : erik;
    await chooseIn(page, other);
    await expect(sat.locator(`.person-card.window-selected[data-id="${other}"]`)).toHaveCount(1);
    expect(await focusOf(sat)).toBe(satFocus);

    // Satellite → main: Focus in the person menu; the main window's centre stays, the ring here goes.
    const mainFocus = await focusOf(page);
    await card(sat, 'Johan').click();
    await menu(sat).locator('[data-action="focus"]').click();
    await expect.poll(() => selectedIn(page)).toBe(johan);
    expect(await focusOf(page)).toBe(mainFocus);
    await expect(sat.locator('.person-card.window-selected')).toHaveCount(0);

    // The Fan: the person's sectors outlined; the Timeline: their row.
    await sat.locator('.sat-view-segment').getByRole('button', { name: 'Fan' }).click();
    await expect(sat.locator('#fan-chart .fan-sector').first()).toBeVisible();
    const ancestor = await sat.evaluate(() => document.querySelector<SVGElement>('#fan-chart .fan-sector[data-fan-kind="anc"][data-fan-person]')!.dataset.fanPerson!);
    await chooseIn(page, ancestor);
    await expect(sat.locator('#fan-chart path.fan-mark')).not.toHaveCount(0);
    await sat.locator('.sat-view-segment').getByRole('button', { name: 'Timeline' }).click();
    await expect(sat.locator(`#timeline-container .timeline-bar.window-selected[data-person-id="${ancestor}"]`)).toHaveCount(1);
    await chooseIn(page, johan === mainFocus ? erik : johan);
    await expect(sat.locator('#timeline-container .timeline-bar.window-selected')).toHaveCount(1);
    await expect(sat.locator(`#timeline-container .timeline-bar.window-selected[data-person-id="${ancestor}"]`)).toHaveCount(0);
    // A row clicked here goes out.
    await sat.locator(`#timeline-container .timeline-bar[data-person-id="${ancestor}"]`).click();
    await expect.poll(() => selectedIn(page)).toBe(ancestor);

    // "Follow selection" off: nothing sent, nothing taken.
    await sat.locator('.sat-follow').click();
    await expect(sat.locator('.sat-follow')).toHaveAttribute('aria-checked', 'false');
    await chooseIn(page, thomas);
    await page.waitForTimeout(400);
    await expect(sat.locator('#timeline-container .timeline-bar.window-selected')).toHaveCount(0);
    await page.evaluate(() => window.Strom.TreeRenderer.setWindowSelected(null));
    await sat.locator(`#timeline-container .timeline-bar[data-person-id="${erik}"]`).click();
    await page.waitForTimeout(400);
    expect(await selectedIn(page)).toBeNull();
});

test('a Map satellite: the person\'s places marked, the map moved only when none is in view; a person picked there is selected, the view stays', async ({ page, context }) => {
    test.setTimeout(60_000);
    const treeId = await openMain(page, context);
    const sat = await openSatellite(context, treeId, 'map', 'cv22aa', []);
    const marker = sat.locator('#map-container .map-marker');
    await expect(marker.first()).toBeVisible();
    // Someone with a place on this map (the main window's focus is no new choice).
    await marker.first().locator('.map-marker-dot').click();
    const people = await sat.locator('.map-popup .map-popup-person[data-person-id]').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.personId!));
    const mainFocus = await focusOf(page);
    const who = people.find(id => id !== mainFocus)!;
    expect(who).toBeTruthy();
    await sat.locator('.map-popup-close').click();

    // Main → the map: the places marked; in view, the map stays.
    const center = () => sat.evaluate(() => JSON.stringify((window.Strom.UI as unknown as { mapCenter: unknown }).mapCenter));
    const zoom = () => sat.evaluate(() => (window.Strom.UI as unknown as { mapZoom: number }).mapZoom);
    const before = await center();
    await chooseIn(page, who);
    await expect(sat.locator('#map-container .map-marker.map-marker-window-selected')).not.toHaveCount(0);
    expect(await center()).toBe(before);

    // Out of view: the map moves to them, its zoom kept.
    await sat.evaluate(() => {
        const ui = window.Strom.UI as unknown as { mapCenter: unknown; zoomMap(d: number): void };
        ui.mapCenter = { lat: -45, lon: 170 };
        ui.zoomMap(0);
    });
    await expect(sat.locator('#map-container .map-marker-window-selected')).toHaveCount(0);
    const z = await zoom();
    await page.evaluate(() => window.Strom.TreeRenderer.setWindowSelected(null));
    await chooseIn(page, mainFocus!);
    await chooseIn(page, who);
    await expect(sat.locator('#map-container .map-marker.map-marker-window-selected')).not.toHaveCount(0);
    await expect(sat.locator('#map-container .map-marker.map-marker-window-selected').first()).toBeInViewport();
    expect(await zoom()).toBe(z);

    // A person picked in the map's bubble: selected in the main window, the satellite stays on its map.
    await marker.first().locator('.map-marker-dot').click();
    const picked = await sat.locator('.map-popup .map-popup-person[data-person-id]').first().getAttribute('data-person-id');
    await sat.locator('.map-popup .map-popup-person[data-person-id]').first().click();
    await expect.poll(() => selectedIn(page)).toBe(picked);
    expect(await sat.evaluate(() => window.Strom.TreeRenderer.getViewMode())).toBe('map');
    expect(await focusOf(page)).toBe(who);
    await expect(sat.locator('#map-container .map-marker.map-marker-window-selected')).not.toHaveCount(0);
});

test('a card\'s person menu in a Family satellite: the research rows run by the main window; with it closed, greyed under their own heading', async ({ page, context }) => {
    test.setTimeout(60_000);
    const treeId = await openMain(page, context);
    await page.evaluate(() => {
        const ui = window.Strom.UI as unknown as Record<string, unknown>;
        const ran: string[] = [];
        (window as unknown as { __ran: string[] }).__ran = ran;
        ui.personResearchMenuItems = () => [{ action: 'research-check', label: 'Check the records', badge: 'ai' }];
        const run = ui.runPersonMenuAction as (p: string, a: string) => void;
        ui.runPersonMenuAction = function (this: unknown, p: string, a: string) {
            if (a === 'research-check') { ran.push(`${p} ${a}`); return; }
            run.call(this, p, a);
        };
    });
    const sat = await openSatellite(context, treeId, 'family', 'cv31aa', []);
    const johan = await personId(page, 'Johan', 'Berg');

    await card(sat, 'Johan').click();
    await expect(menu(sat).locator('.win-research-head')).toHaveText('Research · runs in the main window');
    await menu(sat).locator('[data-action="win-research:research-check"]').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __ran: string[] }).__ran)).toEqual([`${johan} research-check`]);

    await page.close();
    await expect.poll(() => sat.evaluate(() => window.Strom.DataManager.isTreeLocked())).toBe(true);
    await card(sat, 'Johan').click();
    await expect(menu(sat).locator('.win-research-head')).toHaveText('Research · main window only');
    await expect(menu(sat).getByRole('menuitem', { name: /Check the records/ })).toHaveAttribute('aria-disabled', 'true');
});

test('photos: shown in a satellite; an edit there keeps every photo of the stored tree', async ({ page, context }) => {
    test.setTimeout(60_000);
    const treeId = await openMain(page, context);
    const photos = (p: Page) => p.evaluate(() => Object.fromEntries(window.Strom.DataManager.getAllPersons()
        .filter(x => x.photo).map(x => [x.id, x.photo as string])));
    const before = await photos(page);
    // Long enough to be kept in the media pool when stored (data: URLs, not pool references, in memory).
    expect(Object.values(before).some(v => v.startsWith('data:') && v.length >= 1024)).toBe(true);

    const sat = await openSatellite(context, treeId, 'family', 'cv32aa', []);
    expect(await photos(sat)).toEqual(before);
    const img = sat.locator('.person-card img').first();
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate(i => (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

    // An edit of a name in the satellite, saved by the main window.
    const erik = await personId(page, 'Erik', 'Berg');
    await sat.evaluate((id) => { window.Strom.DataManager.updatePerson(id as never, { firstName: 'Erich' } as never); }, erik);
    await expect.poll(() => nameOf(page, erik)).toBe('Erich');
    await sat.close();

    // The stored tree, read again: every photo as it was.
    await page.reload();
    await expect(card(page, 'Erich')).toBeVisible();
    expect(await photos(page)).toEqual(before);
});
