import { test, expect, Page, BrowserContext } from '@playwright/test';
import { card, openApp } from './helpers.js';

/**
 * A satellite window's reload (spec 079 §1): F5 keeps the window's own state
 * (its person in the centre, the generations, the zoom and middle of the
 * chart, the map's frame) — kept in the window's sessionStorage only. A
 * window without a state of its own (its address opened again, the state
 * gone, another tree from the main window) starts at the main window's
 * person, never at the tree's first person (on a large tree its whole
 * family: minutes of a frozen window).
 */

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const NOW = new Date('2026-06-15T10:00:00Z');

/** The main window with the sample tree (places with coordinates). */
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

const satUrl = (treeId: string, kind: string, w: string) => `/strom.html?okno=${kind}&tree=${encodeURIComponent(treeId)}&w=${w}`;

/** A satellite of `kind` at its address, the tree in. */
async function openSatellite(context: BrowserContext, treeId: string, kind: string, w: string): Promise<Page> {
    const sat = await context.newPage();
    await sat.setViewportSize({ width: 1200, height: 800 });
    await sat.goto(satUrl(treeId, kind, w));
    await loaded(sat);
    return sat;
}

async function loaded(sat: Page): Promise<void> {
    await expect(sat.locator('html')).not.toHaveClass(/app-loading/);
    await expect(sat.locator('.sat-header-title')).toHaveText('Sample: the Berg family');
}

const personId = (page: Page, firstName: string, lastName: string) => page.evaluate(([f, l]) =>
    window.Strom.DataManager.getAllPersons().find(p => p.firstName === f && p.lastName === l)!.id as string, [firstName, lastName]);
const focusOf = (p: Page) => p.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId() as string | null);
const depthsOf = (p: Page) => p.evaluate(() => [window.Strom.TreeRenderer.getFocusDepthUp(), window.Strom.TreeRenderer.getFocusDepthDown()]);
const setFocus = (p: Page, id: string) => p.evaluate(async (pid) => { await window.Strom.TreeRenderer.setFocus(pid as never); }, id);
/** The person a window without any state would start at: the tree's default person, else its first one. */
const treeDefault = (p: Page) => p.evaluate(() => {
    const dm = window.Strom.DataManager;
    return (dm.getStartupFocus()?.personId ?? dm.getAllPersons()[0].id) as string;
});
const zoomOf = (p: Page) => p.evaluate(() => {
    const z = window.Strom.ZoomPan;
    const m = z.viewCenterWorld();
    return { scale: z.getScale(), x: m.x, y: m.y };
});
const mapOf = (p: Page) => p.evaluate(() => {
    const ui = window.Strom.UI as unknown as { mapCenter: { lat: number; lon: number } | null; mapZoom: number; mapScope: string };
    return { center: ui.mapCenter, zoom: ui.mapZoom, scope: ui.mapScope };
});

test('F5 of a Family satellite keeps its person, generations, zoom and middle; nothing but its own sessionStorage', async ({ page, context }) => {
    test.setTimeout(60_000);
    const treeId = await openMain(page, context);
    const sat = await openSatellite(context, treeId, 'family', 'rl01aa');
    const [erik, thomas] = [await personId(page, 'Erik', 'Berg'), await personId(page, 'Thomas', 'Berg')];
    // This window's own person: neither the main window's nor the tree's default one.
    const x = (await focusOf(page)) === erik || (await treeDefault(sat)) === erik ? thomas : erik;
    expect([await focusOf(page), await treeDefault(sat)]).not.toContain(x);
    await setFocus(sat, x);
    await expect.poll(() => focusOf(sat)).toBe(x);
    await sat.evaluate(() => window.Strom.TreeRenderer.setFocusDepth(1, 1));
    await sat.mouse.move(600, 450);
    await sat.mouse.wheel(0, -300);
    await expect.poll(async () => (await zoomOf(sat)).scale).not.toBe(1);
    await sat.waitForTimeout(400);
    const depths = await depthsOf(sat);
    const zoom = await zoomOf(sat);

    await sat.reload();
    await loaded(sat);
    await expect(card(sat, x === erik ? 'Erik' : 'Thomas')).toBeVisible();
    expect(await focusOf(sat)).toBe(x);
    expect(await depthsOf(sat)).toEqual(depths);
    await expect.poll(async () => (await zoomOf(sat)).scale).toBeCloseTo(zoom.scale, 3);
    const after = await zoomOf(sat);
    expect(Math.abs(after.x - zoom.x)).toBeLessThan(2);
    expect(Math.abs(after.y - zoom.y)).toBeLessThan(2);
    // Kept in the window's own session, not in localStorage.
    expect(await sat.evaluate(() => sessionStorage.getItem('strom.win.state.rl01aa'))).toContain(x);
    expect(await sat.evaluate(() => Object.keys(localStorage).filter(k => k.includes('win.state')))).toEqual([]);
    // The main window's person stays.
    expect(await focusOf(page)).not.toBe(await focusOf(sat));
});

test('F5 of a Map satellite keeps its frame: centre, zoom and scope', async ({ page, context }) => {
    test.setTimeout(60_000);
    const treeId = await openMain(page, context);
    const sat = await openSatellite(context, treeId, 'map', 'rl02aa');
    await expect(sat.locator('#map-container .map-marker').first()).toBeVisible();
    await sat.getByRole('button', { name: 'Whole tree' }).click();
    await sat.evaluate(() => {
        const ui = window.Strom.UI as unknown as { mapCenter: unknown; mapZoom: number; zoomMap(d: number): void };
        ui.mapCenter = { lat: 47.25, lon: 11.5 };
        ui.mapZoom = 6;
        ui.zoomMap(1);
    });
    const frame = await mapOf(sat);
    expect(frame.zoom).toBe(7);

    await sat.reload();
    await loaded(sat);
    await expect(sat.locator('#map-container .map-tiles img').first()).toBeAttached();
    const after = await mapOf(sat);
    expect(after.zoom).toBe(frame.zoom);
    expect(after.scope).toBe('tree');
    expect(after.center!.lat).toBeCloseTo(frame.center!.lat, 5);
    expect(after.center!.lon).toBeCloseTo(frame.center!.lon, 5);
});

test('without a state of its own the satellite starts at the main window\'s person, not the tree\'s first one; another tree: the main window\'s person there', async ({ page, context }) => {
    test.setTimeout(60_000);
    const treeId = await openMain(page, context);
    // The main window on someone who is not the tree's default person.
    const def = await treeDefault(page);
    const [erik, thomas] = [await personId(page, 'Erik', 'Berg'), await personId(page, 'Thomas', 'Berg')];
    const mainPerson = def === erik ? thomas : erik;
    await setFocus(page, mainPerson);
    await expect.poll(() => focusOf(page)).toBe(mainPerson);
    const mainDepths = await depthsOf(page);

    // F5 with the window's state gone (cleared as the page goes).
    const sat = await openSatellite(context, treeId, 'family', 'rl03aa');
    await setFocus(sat, def);
    await expect.poll(() => focusOf(sat)).toBe(def);
    await sat.evaluate(() => {
        // After the window's own writes (as the page goes and as it is hidden, in either order).
        const drop = () => sessionStorage.removeItem('strom.win.state.rl03aa');
        window.addEventListener('pagehide', drop);
        document.addEventListener('visibilitychange', drop);
    });
    await sat.reload();
    await loaded(sat);
    expect(await sat.evaluate(() => sessionStorage.getItem('strom.win.state.rl03aa'))).toBeNull();
    await expect.poll(() => focusOf(sat)).toBe(mainPerson);
    expect(await depthsOf(sat)).toEqual(mainDepths);

    // Its address opened again in a new window (no session): the same.
    await sat.close();
    const again = await openSatellite(context, treeId, 'family', 'rl03aa');
    await expect.poll(() => focusOf(again)).toBe(mainPerson);

    // Another tree in the main window: the satellite at the person the main window opens it at.
    const other = await page.evaluate(async () => {
        const p = (id: string, firstName: string, extra: Record<string, unknown> = {}) =>
            ({ id, firstName, lastName: 'Brambořík', gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });
        const persons = { a: p('a', 'Radhost'), b: p('b', 'Velimír', { birthDate: '1901-02-03' }) };
        const dm = window.Strom.DataManager;
        await dm.importAsNewTree({ persons, partnerships: {}, defaultPersonId: 'b' } as never, 'Bramboříkovi');
        return dm.getCurrentTreeId() as string;
    });
    await page.evaluate((id) => window.Strom.UI.switchToTree(id as never), treeId);
    await expect.poll(() => again.evaluate(() => window.Strom.DataManager.getCurrentTreeId())).toBe(treeId);
    await page.evaluate((id) => window.Strom.UI.switchToTree(id as never), other);
    await expect.poll(() => again.evaluate(() => window.Strom.DataManager.getCurrentTreeId())).toBe(other);
    const mainThere = await focusOf(page);
    expect(mainThere).toBe('b');
    await expect.poll(() => focusOf(again)).toBe(mainThere);
});
