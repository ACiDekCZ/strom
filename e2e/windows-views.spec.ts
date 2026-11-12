import { test, expect, Page, BrowserContext } from '@playwright/test';
import { card, openApp } from './helpers.js';

/**
 * Several windows of the chart views and the Map at once (spec 079 K2): the
 * main window opens them (its view tabs, ⧉'s menu); an edit in one satellite
 * is saved by the main window and comes to every other window, Undo of the
 * main window and of a satellite takes it back everywhere; the selection goes
 * both ways and to every window that follows it; once the main window closed,
 * every satellite is read-only under the amber strip. Two windows of one view
 * and one of another live side by side, each with its own centre. Nothing a
 * satellite does reaches the storage, and the stored trees lose nothing.
 */

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const NOW = new Date('2026-06-15T10:00:00Z');

/** Every write to localStorage, sessionStorage and IndexedDB of every page of the context, from its first script on. */
async function spyStorage(context: BrowserContext): Promise<void> {
    await context.addInitScript(() => {
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

/** The writes of a page, but for the window's own "Follow selection" (its session, kept over a reload). */
const writesOf = (p: Page) => p.evaluate(() => (window as unknown as { __writes: string[] }).__writes
    .filter(w => !w.startsWith('session set strom.win.follow.')));

/** The main window with the sample tree (places with coordinates, photos); every page's storage watched. */
async function openMain(page: Page, context: BrowserContext): Promise<string> {
    await context.clock.install({ time: NOW });
    await context.route('**://tile.openstreetmap.org/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
    await context.route('**://nominatim.openstreetmap.org/**', r => r.abort());
    await spyStorage(context);
    // The map's tiles allowed (the device's setting, read by every window).
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

/** A window the main window opens by `click`, loaded as a satellite of `kind` with the tree in. */
async function opened(page: Page, click: () => Promise<void>, kind: string, errors: string[]): Promise<Page> {
    const [sat] = await Promise.all([page.waitForEvent('popup'), click()]);
    sat.on('console', m => { if (m.type() === 'error') errors.push(`${kind}: ${m.text()}`); });
    sat.on('pageerror', e => errors.push(`${kind}: ${e.message}`));
    await sat.waitForLoadState('domcontentloaded');
    // As large as the main window: the middle it hands over shows the same cards.
    await sat.setViewportSize({ width: 1400, height: 900 });
    expect(new URL(sat.url()).searchParams.get('okno')).toBe(kind);
    await expect(sat.locator('html')).not.toHaveClass(/app-loading/);
    await expect(sat.locator('.sat-header-title')).toHaveText('Sample: the Berg family');
    await expect.poll(() => sat.evaluate(() => window.Strom.TreeRenderer.getViewMode())).toBe(kind);
    return sat;
}

/** A view from ⧉'s menu of the main window. */
const fromMenu = (page: Page, view: string) => async () => {
    await page.locator('#view-window-btn').click();
    await page.locator(`#view-window-menu .view-window-item[data-view="${view}"]`).click();
};

const personId = (page: Page, firstName: string, lastName: string) => page.evaluate(([f, l]) =>
    window.Strom.DataManager.getAllPersons().find(p => p.firstName === f && p.lastName === l)!.id as string, [firstName, lastName]);
const nameOf = (p: Page, id: string) => p.evaluate((pid) => window.Strom.DataManager.getPerson(pid as never)?.firstName ?? null, id);
const menu = (p: Page) => p.locator('.context-menu.person-menu');
const focusOf = (p: Page) => p.evaluate(() => window.Strom.TreeRenderer.getFocusPersonId() as string | null);
const selectedIn = (p: Page) => p.evaluate(() => window.Strom.TreeRenderer.getWindowSelected() as string | null);
const chooseIn = (p: Page, id: string) => p.evaluate(async (pid) => { await window.Strom.TreeRenderer.setFocus(pid as never); }, id);
const ringed = (p: Page, id: string) => p.locator(`.person-card.window-selected[data-id="${id}"]`);
const strip = (p: Page) => p.locator('.sat-strip');
const editRows = (p: Page) => menu(p).locator('[data-action="edit"], [data-action="add"], [data-action="child"], [data-action="parent"], [data-action="partner"], [data-action="delete"]');

/** The person dialog of `id` in `p`, its first name changed and saved. */
async function renameInDialog(p: Page, id: string, firstName: string): Promise<void> {
    await p.evaluate((pid) => window.Strom.UI.showEditPersonModal(pid as never), id);
    await p.locator('#input-firstname').fill(firstName);
    await p.locator('.modal').filter({ has: p.locator('#input-firstname') }).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(p.locator('#input-firstname')).toBeHidden();
}

test('Family twice and Descendants at once: an edit in one window is saved by the main window and shown in all; Undo anywhere; the selection both ways; the main window closed: all read-only', async ({ page, context }) => {
    test.setTimeout(90_000);
    await openMain(page, context);
    const errors: string[] = [];
    const [johan, erik, thomas] = [await personId(page, 'Johan', 'Berg'), await personId(page, 'Erik', 'Berg'), await personId(page, 'Thomas', 'Berg')];

    // Opened by the main window: Family by Ctrl/Cmd+click on its tab, Family again and Descendants from ⧉'s menu.
    const famA = await opened(page, () => page.locator('#view-mode-family').click({ modifiers: ['ControlOrMeta'] }), 'family', errors);
    const famB = await opened(page, fromMenu(page, 'family'), 'family', errors);
    const desc = await opened(page, fromMenu(page, 'descendants'), 'descendants', errors);
    await expect.poll(() => page.evaluate(() => window.Strom.Windows?.size)).toBe(3);
    await expect(page.locator('#view-mode-family')).toHaveClass(/active/);
    for (const w of [famA, famB, desc]) await expect(card(w, 'Johan')).toBeVisible();

    const mainFocus = await focusOf(page);
    const bFocus = await focusOf(famB);

    // An edit in Family A (the person dialog): saved by the main window, shown in the main window, Family B and Descendants.
    await card(famA, 'Johan').click();
    await menu(famA).locator('[data-action="edit"]').click();
    await famA.locator('#input-firstname').fill('Ermenrich');
    await famA.locator('.modal').filter({ has: famA.locator('#input-firstname') }).getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => nameOf(page, johan)).toBe('Ermenrich');
    for (const w of [page, famA, famB, desc]) await expect(card(w, 'Ermenrich')).toBeVisible();
    // Undo in Descendants (a window other than the one that edited): back in every window.
    await desc.locator('#toolbar-undo-btn').click();
    await expect.poll(() => nameOf(page, johan)).toBe('Johan');
    for (const w of [famA, famB, desc]) await expect.poll(() => nameOf(w, johan)).toBe('Johan');
    await expect(card(famB, 'Johan')).toBeVisible();

    // Add a child from Family B's card menu; the main window's Undo takes it back in A, B and Descendants.
    await card(famB, 'Johan').click();
    await menu(famB).locator('[data-action="child"]').click();
    const rel = famB.locator('#relation-modal');
    await rel.locator('#rel-firstname').fill('Ottwin');
    await rel.locator('#rel-submit-btn').click();
    await expect(rel).toBeHidden();
    const hasOttwin = (w: Page) => w.evaluate(() => window.Strom.DataManager.getAllPersons().some(p => p.firstName === 'Ottwin'));
    await expect.poll(() => hasOttwin(page)).toBe(true);
    for (const w of [famA, desc]) await expect.poll(() => hasOttwin(w)).toBe(true);
    await page.locator('#toolbar-undo-btn').click();
    for (const w of [page, famA, famB, desc]) await expect.poll(() => hasOttwin(w)).toBe(false);
    // Redo from a satellite: in every window again.
    await famA.locator('#toolbar-redo-btn').click();
    for (const w of [page, famB, desc]) await expect.poll(() => hasOttwin(w)).toBe(true);
    await page.locator('#toolbar-undo-btn').click();
    for (const w of [famA, famB, desc]) await expect.poll(() => hasOttwin(w)).toBe(false);

    // The selection: Focus on a card in Family A → selected in the main window and ringed in B and Descendants.
    const ida = await personId(page, 'Ida', 'Strand');
    await card(famA, 'Ida').click();
    await menu(famA).locator('[data-action="focus"]').click();
    await expect.poll(() => selectedIn(page)).toBe(ida);
    await expect(ringed(page, ida)).toHaveCount(1);
    await expect(ringed(famB, ida)).toHaveCount(1);
    await expect(ringed(desc, ida)).toHaveCount(1);
    expect(await focusOf(page)).toBe(mainFocus);
    expect(await focusOf(famB)).toBe(bFocus);
    // The main window chooses: ringed in every satellite (in Family A too), their centres stay.
    await chooseIn(page, erik);
    for (const w of [famA, famB, desc]) await expect(ringed(w, erik)).toHaveCount(1);
    expect(await focusOf(famB)).toBe(bFocus);
    expect(await focusOf(famA)).toBe(ida);

    // "Follow selection" off in Family B: it neither takes the main window's choice nor sends its own.
    await famB.locator('.sat-follow').click();
    await expect(famB.locator('.sat-follow')).toHaveAttribute('aria-checked', 'false');
    await chooseIn(page, johan);
    await expect(ringed(famA, johan)).toHaveCount(1);
    await expect(ringed(desc, johan)).toHaveCount(1);
    await expect(ringed(famB, johan)).toHaveCount(0);
    await page.evaluate(() => window.Strom.TreeRenderer.setWindowSelected(null));
    await card(famB, 'Ida').click();
    await menu(famB).locator('[data-action="focus"]').click();
    await expect.poll(() => focusOf(famB)).toBe(ida);
    await page.waitForTimeout(400);
    expect(await selectedIn(page)).toBeNull();
    await expect(ringed(famA, ida)).toHaveCount(0);

    // Each window its own centre: Family A on Thomas, Family B on Ida, the main window on Johan.
    await famA.evaluate(async (id) => { await window.Strom.TreeRenderer.setFocus(id as never); }, thomas);
    await expect.poll(() => focusOf(famA)).toBe(thomas);
    expect(await focusOf(famB)).toBe(ida);
    expect(await focusOf(page)).toBe(johan);

    // The main window closes: every satellite read-only under the amber strip; no edit row, an edit refused.
    await page.close();
    for (const w of [famA, famB, desc]) {
        await expect(strip(w)).toHaveClass(/sat-strip--amber/, { timeout: 6000 });
        await expect(strip(w)).toHaveText(/The main window is closed · as of \d{1,2}:\d{2}.*, read-only/);
        await expect.poll(() => w.evaluate(() => window.Strom.DataManager.isTreeLocked())).toBe(true);
    }
    await card(famA, 'Thomas').click();
    await expect(menu(famA).locator('[data-action="view"]')).toBeVisible();
    await expect(editRows(famA)).toHaveCount(0);
    await famA.keyboard.press('Escape');
    await desc.evaluate((id) => { window.Strom.DataManager.updatePerson(id as never, { firstName: 'Ermenrich' } as never); }, johan);
    await desc.waitForTimeout(300);
    for (const w of [famA, famB, desc]) expect(await nameOf(w, johan)).toBe('Johan');
    await expect(card(desc, 'Johan')).toBeVisible();

    for (const w of [famA, famB, desc]) expect(await writesOf(w)).toEqual([]);
    expect(errors).toEqual([]);
});

test('two Maps and a Family: the person\'s places marked from the main window, a person picked in a map selected everywhere; an edit through the person dialog in a map comes to all; the main window closed: read-only', async ({ page, context }) => {
    test.setTimeout(90_000);
    await openMain(page, context);
    const errors: string[] = [];
    const mapA = await opened(page, () => page.locator('#view-mode-map').click({ button: 'middle' }), 'map', errors);
    const mapB = await opened(page, fromMenu(page, 'map'), 'map', errors);
    const fam = await opened(page, fromMenu(page, 'family'), 'family', errors);
    await expect.poll(() => page.evaluate(() => window.Strom.Windows?.size)).toBe(3);
    for (const m of [mapA, mapB]) await expect(m.locator('#map-container .map-marker').first()).toBeVisible();

    // Someone with a place on the map, other than the main window's focus.
    const mainFocus = await focusOf(page);
    await mapA.locator('#map-container .map-marker').first().locator('.map-marker-dot').click();
    const people = await mapA.locator('.map-popup .map-popup-person[data-person-id]').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.personId!));
    const who = people.find(id => id !== mainFocus)!;
    expect(who).toBeTruthy();
    await mapA.locator('.map-popup-close').click();

    // Main → the maps: the person's places marked in both, a card ringed in Family.
    await chooseIn(page, who);
    for (const m of [mapA, mapB]) await expect(m.locator('#map-container .map-marker.map-marker-window-selected')).not.toHaveCount(0);
    await expect(ringed(fam, who)).toHaveCount(1);

    // Map A → the rest: a person picked in its bubble is selected in the main window, marked in Map B, ringed in Family.
    await mapA.locator('#map-container .map-marker').first().locator('.map-marker-dot').click();
    const picked = (await mapA.locator('.map-popup .map-popup-person[data-person-id]').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.personId!))).find(id => id !== who)!;
    expect(picked).toBeTruthy();
    await mapA.locator(`.map-popup .map-popup-person[data-person-id="${picked}"]`).first().click();
    await expect.poll(() => selectedIn(page)).toBe(picked);
    await expect.poll(() => selectedIn(mapB)).toBe(picked);
    await expect(ringed(fam, picked)).toHaveCount(1);
    expect(await mapA.evaluate(() => window.Strom.TreeRenderer.getViewMode())).toBe('map');
    expect(await focusOf(page)).toBe(who);

    // An edit in Map B through the person dialog: saved by the main window, in the other map's bubble and in Family.
    await renameInDialog(mapB, picked, 'Hartwiga');
    await expect.poll(() => nameOf(page, picked)).toBe('Hartwiga');
    await expect.poll(() => nameOf(mapA, picked)).toBe('Hartwiga');
    await expect(card(fam, 'Hartwiga')).toBeVisible();
    await mapA.locator('#map-container .map-marker').first().locator('.map-marker-dot').click();
    await expect(mapA.locator(`.map-popup .map-popup-person[data-person-id="${picked}"]`).first()).toContainText('Hartwiga');
    await mapA.locator('.map-popup-close').click();
    // Undo in Map A: back everywhere.
    await mapA.locator('#toolbar-undo-btn').click();
    for (const w of [page, mapA, mapB, fam]) await expect.poll(() => nameOf(w, picked)).not.toBe('Hartwiga');

    // The main window closes: read-only maps, the edit refused.
    await page.close();
    for (const w of [mapA, mapB, fam]) {
        await expect(strip(w)).toHaveClass(/sat-strip--amber/, { timeout: 6000 });
        await expect.poll(() => w.evaluate(() => window.Strom.DataManager.isTreeLocked())).toBe(true);
    }
    const before = await nameOf(mapB, picked);
    await mapB.evaluate((id) => { window.Strom.DataManager.updatePerson(id as never, { firstName: 'Hartwiga' } as never); }, picked);
    await mapB.waitForTimeout(300);
    for (const w of [mapA, mapB, fam]) expect(await nameOf(w, picked)).toBe(before);
    // The map still answers: its bubble opens.
    await mapB.locator('#map-container .map-marker').first().locator('.map-marker-dot').click();
    await expect(mapB.locator('.map-popup .map-popup-person').first()).toBeVisible();

    for (const w of [mapA, mapB, fam]) expect(await writesOf(w)).toEqual([]);
    expect(errors).toEqual([]);
});
