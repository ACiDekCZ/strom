import { test, expect, Page, BrowserContext } from '@playwright/test';
import { card, openApp, setFollowMode } from './helpers.js';

/**
 * Several windows of the chart views and the Map at once (spec 079 K2): the
 * main window opens them (its view tabs, ⧉'s menu); an edit in one satellite
 * is saved by the main window and comes to every other window, Undo of the
 * main window and of a satellite takes it back everywhere; the selection goes
 * both ways and to every window that follows it; once the main window closed,
 * every satellite is read-only under the amber strip. Two windows of one view
 * and one of another live side by side, each with its own centre. Nothing a
 * satellite does reaches the storage, and the stored trees lose nothing.
 * On a phone nothing of the windows shows.
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

    // Mark only in every satellite (Family and Descendants switch their centre by default, K2.1).
    for (const w of [famA, famB, desc]) await setFollowMode(w, 'mark');
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
    await setFollowMode(famB, 'off');
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

    // Main → the maps: the person's places marked in both; Family (switch, K2.1) takes the person as its centre.
    await chooseIn(page, who);
    for (const m of [mapA, mapB]) await expect(m.locator('#map-container .map-marker.map-marker-window-selected')).not.toHaveCount(0);
    await expect.poll(() => focusOf(fam)).toBe(who);
    await expect(ringed(fam, who)).toHaveCount(0);

    // Map A → the rest: a person picked in its bubble is selected in the main window, marked in Map B, Family's centre.
    await mapA.locator('#map-container .map-marker').first().locator('.map-marker-dot').click();
    const picked = (await mapA.locator('.map-popup .map-popup-person[data-person-id]').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.personId!))).find(id => id !== who)!;
    expect(picked).toBeTruthy();
    await mapA.locator(`.map-popup .map-popup-person[data-person-id="${picked}"]`).first().click();
    await expect.poll(() => selectedIn(page)).toBe(picked);
    await expect.poll(() => selectedIn(mapB)).toBe(picked);
    await expect.poll(() => focusOf(fam)).toBe(picked);
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

const person = (id: string, firstName: string, lastName: string, extra: Record<string, unknown> = {}) =>
    ({ id, firstName, lastName, gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });

/** localStorage and every record of the trees' database, as they are stored. */
const snapshot = (p: Page) => p.evaluate(() => new Promise<{ local: Record<string, string | null>; db: Record<string, Record<string, string>> }>((resolve, reject) => {
    const local: Record<string, string | null> = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; local[k] = localStorage.getItem(k); }
    const req = indexedDB.open('strom-db');
    req.onsuccess = () => {
        const db = req.result;
        const names = Array.from(db.objectStoreNames);
        const tx = db.transaction(names, 'readonly');
        const out: Record<string, Record<string, string>> = {};
        for (const name of names) {
            out[name] = {};
            const cur = tx.objectStore(name).openCursor();
            cur.onsuccess = () => {
                const c = cur.result;
                if (!c) return;
                out[name][String(c.key)] = JSON.stringify(c.value);
                c.continue();
            };
        }
        tx.oncomplete = () => { db.close(); resolve({ local, db: out }); };
        tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
}));

test('no data lost: the satellites store nothing; the main window stores their edits in the tree they belong to, every other record as it was', async ({ page, context }) => {
    test.setTimeout(90_000);
    const sample = await openMain(page, context);
    // A second stored tree beside the sample one.
    const other = await page.evaluate(async ({ persons }) => {
        const dm = window.Strom.DataManager;
        await dm.importAsNewTree({ persons, partnerships: {} } as never, 'Vrtišek');
        const id = dm.getCurrentTreeId() as string;
        return id;
    }, { persons: { v: person('v', 'Bořivoj', 'Vrtišek', { birthDate: '1850-03-01' }), c: person('c', 'Celestýn', 'Vrtišek', { birthDate: '1875-06-07' }) } });
    await page.evaluate((id) => window.Strom.DataManager.switchTree(id as never), sample);
    await expect(card(page, 'Johan')).toBeVisible();
    await page.waitForTimeout(800);
    const before = await snapshot(page);
    expect(before.db.trees[other]).toBeTruthy();
    const storedBefore = await page.evaluate((id) => window.Strom.TreeManager.getTreeData(id as never), sample);

    const errors: string[] = [];
    const fam = await opened(page, fromMenu(page, 'family'), 'family', errors);
    const map = await opened(page, fromMenu(page, 'map'), 'map', errors);
    const [erik, ida] = [await personId(page, 'Erik', 'Berg'), await personId(page, 'Ida', 'Strand')];
    await renameInDialog(fam, erik, 'Ermenrich');
    await expect.poll(() => nameOf(page, erik)).toBe('Ermenrich');
    await renameInDialog(map, ida, 'Hartwiga');
    await expect.poll(() => nameOf(page, ida)).toBe('Hartwiga');
    await expect.poll(() => nameOf(fam, ida)).toBe('Hartwiga');
    await page.waitForTimeout(800);
    const after = await snapshot(page);

    // Nothing of the satellites' reached the storage.
    for (const w of [fam, map]) expect(await writesOf(w)).toEqual([]);
    // localStorage as it was; the stores the edits do not touch as they were.
    expect(after.local).toEqual(before.local);
    for (const store of Object.keys(before.db).filter(n => n !== 'trees' && n !== 'snapshots')) {
        expect(after.db[store], store).toEqual(before.db[store]);
    }
    // Backups: added to, none changed or removed.
    for (const [k, v] of Object.entries(before.db.snapshots)) expect(after.db.snapshots[k], k).toBe(v);
    // The trees: the other one as it was, the index with both and nothing changed but the sample's dates and size.
    expect(after.db.trees[other]).toBe(before.db.trees[other]);
    expect(Object.keys(after.db.trees).sort()).toEqual(Object.keys(before.db.trees).sort());
    const meta = (raw: string) => {
        const index = JSON.parse(raw) as { activeTreeId: string; trees: { id: string; lastModifiedAt?: string; changedAt?: string; sizeBytes?: number }[] };
        return {
            ...index,
            trees: index.trees.map(({ lastModifiedAt, changedAt, sizeBytes, ...t }) => (t.id === sample ? t : { ...t, lastModifiedAt, changedAt, sizeBytes })),
        };
    };
    expect(meta(after.db.trees._index)).toEqual(meta(before.db.trees._index));
    // The sample tree as stored: as before but for the two names, and as the main window has it.
    type Stored = { persons: Record<string, { firstName: string }> };
    const storedAfter = await page.evaluate((id) => window.Strom.TreeManager.getTreeData(id as never), sample) as Stored;
    expect(storedAfter.persons[erik].firstName).toBe('Ermenrich');
    expect(storedAfter.persons[ida].firstName).toBe('Hartwiga');
    const expected = JSON.parse(JSON.stringify(storedBefore)) as Stored;
    expected.persons[erik].firstName = 'Ermenrich';
    expected.persons[ida].firstName = 'Hartwiga';
    expect(storedAfter).toEqual(expected);
    expect(await page.evaluate(() => window.Strom.DataManager.getData().persons)).toEqual(storedAfter.persons);

    // Undo twice from a satellite: the tree stored as it was.
    await map.locator('#toolbar-undo-btn').click();
    await expect.poll(() => nameOf(page, ida)).toBe('Ida');
    await map.locator('#toolbar-undo-btn').click();
    await expect.poll(() => nameOf(page, erik)).toBe('Erik');
    await expect.poll(async () => JSON.stringify((await page.evaluate((id) => window.Strom.TreeManager.getTreeData(id as never), sample) as Stored).persons))
        .toBe(JSON.stringify((storedBefore as Stored).persons));
    for (const w of [fam, map]) expect(await writesOf(w)).toEqual([]);
    expect(errors).toEqual([]);
});

// A phone (390, touch, a mobile browser): nothing of the windows anywhere.
test.describe('phone (390, touch)', () => {
    test.use({
        viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
    });

    test('no ⧉ in any view, Ctrl+click on a view tab just switches, no window opens', async ({ page, context }) => {
        await openApp(page);
        await page.getByRole('button', { name: 'Try a sample tree' }).click();
        await expect(card(page, 'Johan')).toBeVisible();
        let popups = 0;
        context.on('page', () => { popups++; });
        for (const view of ['family', 'descendants', 'timeline', 'fan', 'map', 'table']) {
            await page.evaluate((v) => window.Strom.UI.setDisplayViewMode(v), view);
            await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.getViewMode())).toBe(view);
            await expect(page.locator('#view-window-wrap')).toBeHidden();
            for (const b of await page.locator('#view-window-btn, .table-bar__window').all()) await expect(b).toBeHidden();
        }
        // The bottom bar's view tabs: Ctrl+click just switches; the middle button and the context menu open no window.
        await page.evaluate(() => window.Strom.UI.setDisplayViewMode('family'));
        const tab = page.locator('#bb-view-descendants');
        await expect(tab).toBeVisible();
        await expect(tab).not.toHaveAttribute('title', /new window/);
        await tab.click({ modifiers: ['ControlOrMeta'] });
        await expect.poll(() => page.evaluate(() => window.Strom.TreeRenderer.getViewMode())).toBe('descendants');
        await page.locator('#bb-view-family').click({ button: 'middle' });
        await page.locator('#bb-view-family').dispatchEvent('contextmenu');
        await expect(page.locator('.view-window-ctx')).toHaveCount(0);
        await page.waitForTimeout(300);
        expect(popups).toBe(0);
        expect(await page.evaluate(() => window.Strom.Windows?.size ?? 0)).toBe(0);
    });
});
