import { test, expect, Page, BrowserContext } from '@playwright/test';
import { card, openApp } from './helpers.js';

/**
 * Another plain tab while the main window is open (spec 079 §5): it loads
 * and stores nothing and says Strom is open elsewhere. Its link (?person=,
 * ?search=) is opened by the main window exactly once, the tab says so in a
 * green line and its address loses the link. "Switch there" asks the main
 * window to the front; without its answer in 400 ms the tab says where Strom
 * is. "Open as another window" makes the tab a satellite with the Table of
 * the main window's tree, without a reload.
 */

const person = (id: string, firstName: string, lastName: string, extra: Record<string, unknown> = {}) =>
    ({ id, firstName, lastName, gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });

const PERSONS = {
    v: person('v', 'Bořivoj', 'Vrtišek', { birthDate: '1850-03-01', partnerships: ['u1'], childIds: ['c'] }),
    k: person('k', 'Kunhuta', 'Hrnčíříková', { gender: 'female', birthDate: '1852-04-05', partnerships: ['u1'], childIds: ['c'] }),
    c: person('c', 'Celestýn', 'Vrtišek', { birthDate: '1875-06-07', parentIds: ['v', 'k'] }),
};
const PARTNERSHIPS = {
    u1: { id: 'u1', person1Id: 'v', person2Id: 'k', childIds: ['c'], status: 'married' },
};

/** The main window with the tree; what its link handlers are asked is counted. */
async function openMain(page: Page): Promise<string> {
    await page.clock.setFixedTime(new Date('2026-06-15T10:00:00Z'));
    await openApp(page);
    const treeId = await page.evaluate(async ({ persons, partnerships }) => {
        const dm = window.Strom.DataManager;
        await dm.importAsNewTree({ persons, partnerships, defaultPersonId: '__last_focused__' } as never, 'Vrtišek');
        await window.Strom.TreeRenderer.setFocus('c' as never);
        const w = window as unknown as { __links: string[] };
        w.__links = [];
        const ui = window.Strom.UI as unknown as Record<string, (...a: unknown[]) => unknown>;
        for (const name of ['openDeepLink', 'handleSearchResults', 'openExternalRequest']) {
            const orig = ui[name];
            ui[name] = function (this: unknown, ...a: unknown[]) {
                w.__links.push(`${name} ${name === 'handleSearchResults' ? a[1] : JSON.stringify(a[0])}`);
                return orig.apply(this, a);
            };
        }
        return dm.getCurrentTreeId() as string;
    }, { persons: PERSONS, partnerships: PARTNERSHIPS });
    await expect(card(page, 'Celestýn')).toBeVisible();
    return treeId;
}

const linksOf = (page: Page) => page.evaluate(() => (window as unknown as { __links: string[] }).__links);

/** Every write to localStorage and every IndexedDB open of the page, from its first script on. */
async function secondTab(context: BrowserContext, search = ''): Promise<Page> {
    const tab = await context.newPage();
    await tab.addInitScript(() => {
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
    await tab.goto(`/strom.html${search}`);
    await expect(tab.locator('main.second-tab')).toBeVisible();
    return tab;
}

const storageLog = (page: Page) => page.evaluate(() => (window as unknown as { __storage: string[] }).__storage);

/** localStorage and every store of strom-db, as the main window reads them. */
const snapshot = (page: Page) => page.evaluate(() => new Promise<string>((resolve, reject) => {
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

test.describe('desktop (1440)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the tab\'s screen; nothing read or stored', async ({ page, context }) => {
        await openMain(page);
        // The main window's own writes after the start are over.
        await page.waitForTimeout(500);
        const before = await snapshot(page);

        const tab = await secondTab(context);
        const screen = tab.locator('main.second-tab');
        await expect(tab).toHaveTitle('Strom');
        await expect(screen.locator('.second-tab-brand')).toHaveText('Strom');
        await expect(screen.locator('.second-tab-title')).toHaveText('Strom is already open in another window');
        await expect(screen.locator('.second-tab-note')).toHaveText('Only one window saves, so edits don’t overwrite each other. Other windows connect to it.');
        await expect(screen.locator('#second-tab-switch')).toHaveText('Switch there');
        await expect(screen.locator('#second-tab-open')).toHaveText('Open as another window');
        await expect(screen.locator('.second-tab-forwarded')).toBeHidden();
        await expect(tab.locator('.toolbar')).toBeHidden();
        await tab.waitForTimeout(1500);

        expect(await storageLog(tab)).toEqual([]);
        expect(await snapshot(page)).toBe(before);
        expect(await linksOf(page)).toEqual([]);
        await tab.close();
    });

    test('?person= opens the person in the main window exactly once; the tab says so and drops the link', async ({ page, context }) => {
        await openMain(page);
        const tab = await secondTab(context, '?person=k');
        const screen = tab.locator('main.second-tab');
        await expect(screen.locator('.second-tab-forwarded')).toHaveText('The link opened in the main window.');
        expect(new URL(tab.url()).search).toBe('');
        // The main window shows the person: the person page open.
        await expect(page.locator('#person-page-modal')).toBeVisible();
        await expect(page.locator('#person-page-modal .pp-sub')).toContainText('Kunhuta');
        // Heartbeats later: opened exactly once.
        await tab.waitForTimeout(2500);
        expect(await linksOf(page)).toEqual(['openExternalRequest {}', 'openDeepLink {"kind":"person","ref":"k"}']);
        expect(await storageLog(tab)).toEqual([]);
        await tab.close();
    });

    test('?search= is searched in the main window once', async ({ page, context }) => {
        await openMain(page);
        const tab = await secondTab(context, '?search=Kunhuta');
        await expect(tab.locator('.second-tab-forwarded')).toBeVisible();
        await expect.poll(() => linksOf(page)).toContain('handleSearchResults Kunhuta');
        await tab.waitForTimeout(2500);
        expect((await linksOf(page)).filter(l => l.startsWith('handleSearchResults'))).toHaveLength(1);
        expect(new URL(tab.url()).search).toBe('');
        await tab.close();
    });

    test('"Switch there": the main window answers with the focus; without it the tab says where Strom is', async ({ page, context }) => {
        await openMain(page);
        await page.evaluate(() => {
            const w = window as unknown as { __focusCalls: number };
            w.__focusCalls = 0;
            const focus = window.focus.bind(window);
            window.focus = () => { w.__focusCalls++; focus(); };
        });
        const tab = await secondTab(context);
        await expect(tab.locator('.second-tab-forwarded')).toBeHidden();
        await tab.locator('#second-tab-switch').click();
        await expect.poll(() => page.evaluate(() => (window as unknown as { __focusCalls: number }).__focusCalls)).toBe(1);
        await expect(tab.locator('#second-tab-switch')).toBeEnabled();
        await expect(tab.locator('.second-tab-failed')).toBeHidden();

        // A browser that keeps the main window behind: no answer within 400 ms.
        await page.evaluate(() => {
            window.focus = () => {};
            document.hasFocus = () => false;
        });
        await tab.locator('#second-tab-switch').click();
        await expect(tab.locator('.second-tab-failed')).toHaveText(
            'The browser didn’t bring the window to the front. Strom is open in another tab or browser window. This tab can be closed.');
        await tab.close();
    });

    test('"Open as another window": the tab becomes a satellite with the Table, without a reload', async ({ page, context }) => {
        const treeId = await openMain(page);
        const tab = await secondTab(context);
        await tab.evaluate(() => { (window as unknown as { __samePage: boolean }).__samePage = true; });
        await tab.locator('#second-tab-open').click();

        await expect(tab.locator('html')).toHaveClass(/window-satellite/);
        await expect(tab.locator('main.second-tab')).toHaveCount(0);
        await expect(tab.locator('#table-container .tv-status-count')).toHaveText('3 of 3 people');
        await expect(tab).toHaveTitle('Table – Vrtišek – Strom');
        const url = new URL(tab.url());
        expect(url.pathname).toBe('/strom.html');
        expect(url.searchParams.get('okno')).toBe('table');
        expect(url.searchParams.get('tree')).toBe(treeId);
        expect(url.searchParams.get('w')).toMatch(/^[0-9a-f]{8}$/);
        // The same page (no reload) that stored nothing.
        expect(await tab.evaluate(() => (window as unknown as { __samePage?: boolean }).__samePage)).toBe(true);
        expect(await storageLog(tab)).toEqual([]);
        await tab.close();
    });
});

test.describe('phone (390)', () => {
    test.use({ viewport: { width: 390, height: 780 } });

    test('the buttons below each other across the card, 44 px; nothing overflows', async ({ page, context }) => {
        await openMain(page);
        const tab = await secondTab(context, '?person=c');
        await expect(tab.locator('.second-tab-forwarded')).toBeVisible();
        const boxes = await Promise.all(['#second-tab-switch', '#second-tab-open'].map(s => tab.locator(s).boundingBox()));
        const card = await tab.locator('.second-tab-card').boundingBox();
        for (const b of boxes) {
            expect(b!.height).toBeGreaterThanOrEqual(44);
            expect(Math.abs(b!.width - (card!.width - 2 * 18 - 2))).toBeLessThanOrEqual(1);
        }
        expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height - 1);
        expect(await tab.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await tab.close();
    });
});
