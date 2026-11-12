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
