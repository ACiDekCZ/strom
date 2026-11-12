import { test, expect, Page, BrowserContext } from '@playwright/test';
import { card, openApp } from './helpers.js';

/**
 * Windows of one app (spec 079 §0, §2, §5): the first window holds the
 * strom-main lock and is the main window; a satellite (?okno=table) shows
 * the main window's tree in the Table, reads and writes no storage, and sends
 * its edits there (an undo step of the main window); undo there brings the
 * satellite back; a focus moved in the main window meanwhile is no change the
 * edit conflicts with; the main window's following of a research is not
 * resumed there; another plain tab is "already open" and stores nothing.
 */

const person = (id: string, firstName: string, lastName: string, extra: Record<string, unknown> = {}) =>
    ({ id, firstName, lastName, gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });

const PERSONS = {
    v: person('v', 'Bořivoj', 'Vrtišek', { birthDate: '1850-03-01', birthPlace: 'Lopuchov', partnerships: ['u1'], childIds: ['c'] }),
    k: person('k', 'Kunhuta', 'Hrnčíříková', { gender: 'female', birthDate: '1852-04-05', partnerships: ['u1'], childIds: ['c'] }),
    c: person('c', 'Celestýn', 'Vrtišek', { birthDate: '1875-06-07', parentIds: ['v', 'k'] }),
};
const PARTNERSHIPS = {
    u1: { id: 'u1', person1Id: 'v', person2Id: 'k', childIds: ['c'], status: 'married' },
};

/** The main window with the tree (where the work stands is remembered: a click on a card saves the focus). */
async function openMain(page: Page): Promise<string> {
    await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
    await openApp(page);
    const treeId = await page.evaluate(async ({ persons, partnerships }) => {
        const dm = window.Strom.DataManager;
        await dm.importAsNewTree({ persons, partnerships, defaultPersonId: '__last_focused__' } as never, 'Vrtišek');
        await window.Strom.TreeRenderer.setFocus('c' as never);
        return dm.getCurrentTreeId() as string;
    }, { persons: PERSONS, partnerships: PARTNERSHIPS });
    await expect(card(page, 'Celestýn')).toBeVisible();
    return treeId;
}

/** Every write to localStorage and every IndexedDB open of the page, from its first script on. */
async function recordStorage(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const log: string[] = [];
        (window as unknown as { __storage: string[] }).__storage = log;
        const proto = Storage.prototype;
        const { setItem, removeItem, clear } = proto;
        proto.setItem = function (this: Storage, k: string, v: string) { if (this === localStorage) log.push(`set ${k}`); return setItem.call(this, k, v); };
        proto.removeItem = function (this: Storage, k: string) { if (this === localStorage) log.push(`remove ${k}`); return removeItem.call(this, k); };
        proto.clear = function (this: Storage) { if (this === localStorage) log.push('clear'); return clear.call(this); };
        const open = indexedDB.open.bind(indexedDB);
        indexedDB.open = (name: string, version?: number) => { log.push(`idb ${name}`); return version === undefined ? open(name) : open(name, version); };
    });
}

const storageLog = (page: Page) => page.evaluate(() => (window as unknown as { __storage: string[] }).__storage);

/** The bridge the main window followed (a window it opens gets a copy of its session storage). */
const LIVE_BRIDGE = 'http://127.0.0.1:5996';

async function openSatellite(context: BrowserContext, treeId: string): Promise<{ sat: Page; bridgeCalls: string[] }> {
    const sat = await context.newPage();
    await sat.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
    await recordStorage(sat);
    await sat.addInitScript(({ bridge, treeId }) => {
        sessionStorage.setItem('strom.live', JSON.stringify({ bridge, treeId }));
    }, { bridge: LIVE_BRIDGE, treeId });
    const bridgeCalls: string[] = [];
    sat.on('request', (req) => { if (req.url().startsWith(LIVE_BRIDGE)) bridgeCalls.push(req.url()); });
    await sat.goto(`/strom.html?okno=table&tree=${encodeURIComponent(treeId)}&w=t1`);
    return { sat, bridgeCalls };
}

const tv = (page: Page, sel: string) => page.locator(`#table-container ${sel}`);

/** A body cell of a row by its column's id. */
async function cell(page: Page, key: string, colId: string) {
    const head = tv(page, '.tv-headrow [data-col]');
    const ids = await head.evaluateAll(els => els.map(el => (el as HTMLElement).dataset.col ?? ''));
    const at = ids.indexOf(colId);
    expect(at, colId).toBeGreaterThanOrEqual(0);
    const index = await head.nth(at).getAttribute('aria-colindex');
    return tv(page, `.tv-body .tv-row[data-key="${key}"] [aria-colindex="${index}"]`);
}

const birthPlace = (page: Page, id: string) => page.evaluate((pid) => window.Strom.DataManager.getPerson(pid as never)?.birthPlace, id);

test.describe('desktop (1440)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('a satellite shows the Table of the main window\'s tree, stores nothing, and its edit is an undo step of the main window', async ({ page, context }) => {
        const treeId = await openMain(page);
        await expect(page).toHaveTitle('Vrtišek – Strom');

        const { sat, bridgeCalls } = await openSatellite(context, treeId);
        await expect(tv(sat, '.tv-status-count')).toHaveText('3 of 3 people');
        await expect(sat.locator('html')).toHaveClass(/window-satellite/);
        // The main window's following (strom.live, copied into this window's session) is not resumed here.
        await expect(sat.locator('html')).not.toHaveClass(/external-opening/);
        await expect(sat.locator('.toolbar')).toBeHidden();
        await expect(sat).toHaveTitle('Table – Vrtišek – Strom');
        // Connected to the main window: editable.
        await expect(tv(sat, '.tv-status-ro')).toBeHidden();

        // Meanwhile the main window's focus moves (stored in the tree's data): no change of its content.
        await page.evaluate(() => window.Strom.TreeRenderer.setFocus('v' as never));
        await expect.poll(() => page.evaluate(() => window.Strom.DataManager.getData().lastFocusPersonId)).toBe('v');

        // An edit in the satellite: saved by the main window as its own undo step.
        const place = await cell(sat, 'p:v', 'bPlace');
        await place.dblclick();
        await tv(sat, '.tv-editor-input').fill('Pantoflov');
        await tv(sat, '.tv-editor-input').press('Enter');
        await expect.poll(() => birthPlace(page, 'v')).toBe('Pantoflov');
        expect(await page.evaluate(() => window.Strom.DataManager.canUndo())).toBe(true);
        // The main window keeps where its work stands.
        expect(await page.evaluate(() => window.Strom.DataManager.getData().lastFocusPersonId)).toBe('v');

        // Undo in the main window: the satellite has the place as before.
        await page.evaluate(() => window.Strom.UI.performUndo());
        expect(await birthPlace(page, 'v')).toBe('Lopuchov');
        await expect(await cell(sat, 'p:v', 'bPlace')).toHaveText('Lopuchov');
        await expect.poll(() => birthPlace(sat, 'v')).toBe('Lopuchov');

        // Nothing of the satellite's reached the storage.
        expect(await storageLog(sat)).toEqual([]);
        expect(bridgeCalls).toEqual([]);
        await sat.close();
    });

    test('another plain tab is "already open" and changes nothing in the storage', async ({ page, context }) => {
        await openMain(page);
        const snapshot = () => page.evaluate(() => new Promise<string>((resolve, reject) => {
            const local: Record<string, string | null> = {};
            for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; local[k] = localStorage.getItem(k); }
            const req = indexedDB.open('strom-db');
            req.onsuccess = () => {
                const db = req.result;
                const names = Array.from(db.objectStoreNames);
                const tx = db.transaction(names, 'readonly');
                const out: Record<string, unknown> = {};
                for (const name of names) {
                    const all = tx.objectStore(name).getAll();
                    all.onsuccess = () => { out[name] = all.result; };
                }
                tx.oncomplete = () => { db.close(); resolve(JSON.stringify({ local, db: out })); };
                tx.onerror = () => reject(tx.error);
            };
            req.onerror = () => reject(req.error);
        }));
        // The main window's own writes after the start are over.
        await page.waitForTimeout(500);
        const before = await snapshot();

        const tab = await context.newPage();
        await recordStorage(tab);
        await tab.goto('/strom.html');
        await expect(tab.locator('main.second-tab')).toBeVisible();
        await expect(tab.locator('main.second-tab')).toContainText('Strom is already open in another window');
        await expect(tab.locator('.toolbar')).toBeHidden();
        await tab.waitForTimeout(500);

        expect(await storageLog(tab)).toEqual([]);
        expect(await snapshot()).toBe(before);
        await tab.close();
    });
});
