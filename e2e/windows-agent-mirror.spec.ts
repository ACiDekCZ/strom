import { test, expect, Page, BrowserContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { card, openApp, seedTree } from './helpers.js';

/**
 * The research in another window of the app (spec 097 K1.3, K3.1, K3.2):
 * only the main window follows the research and talks to its bridge; a
 * satellite's Table draws the research from the main window's agent state
 * (the `agent-state` mirror): its research columns and views, the agent's
 * bar on the name of whom it works on, and a saved view with a research
 * filter shows the same rows as in the main window. The satellite asks no
 * bridge and stores nothing of it. A view whose research filter has no
 * research to read says so (5e). Invented data (e2e/fixtures/research-table.ged).
 */

const GED = readFileSync('e2e/fixtures/research-table.ged', 'utf8');
const UUID = '7d3f2a10-5c4b-4e8a-9b61-1f0e2d3c4b5a';
const BRIDGE_ORIGIN = 'http://127.0.0.1:5983';
const BRIDGE = `${BRIDGE_ORIGIN}/0123456789abcdef0123456789abcdef`;
const TOKEN = '0123456789abcdef0123456789abcdef';
const cors = { 'access-control-allow-origin': '*' };
const LINKS = ['send', 'open', 'live', 'app', 'setup'];
const NOW = new Date('2026-11-10T12:00:00Z');

interface Bridge {
    /** Whom the agent works on (REFN). */
    person: string;
}

/** The research's bridge for the whole browser (every window's asks are seen and counted by their page). */
async function routeBridge(context: BrowserContext): Promise<Bridge> {
    const bridge: Bridge = { person: 'P0003' };
    const status = () => ({
        tree: { id: UUID, name: 'Výzkum Pivoňkovských' }, head: 'h1', persons: 13,
        working: [{ who: 'agent-matriky', since: new Date(NOW.getTime() - 60_000).toISOString(), task: 'Hledat křest Josefa', person: bridge.person }],
        waiting: [], queue: [{ id: 'T0001', state: 'next', person: 'P0004', text: 'Úmrtí Rozálie' }], links: LINKS,
    });
    await context.route(`${BRIDGE}/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/status')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(status()) });
        if (path.endsWith('/tree.ged')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' }, body: GED });
        if (path.endsWith('/events')) {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `event: hello\ndata: ${JSON.stringify(status())}\n\n` });
        }
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    return bridge;
}

/** The main window follows the research live. */
async function follow(page: Page): Promise<string> {
    await page.clock.setFixedTime(NOW);
    await page.addInitScript((links) => {
        (globalThis as { __LIVE_RECONNECT_MS?: number }).__LIVE_RECONNECT_MS = 250;
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: links, at: new Date().toISOString() }));
    }, LINKS);
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    await expect(page.locator('#live-panel')).toBeAttached();
    await expect(card(page, 'Karel')).toBeVisible();
    return page.evaluate(() => window.Strom.DataManager.getCurrentTreeId()!);
}

/** A Table window of the main window's tree; its asks of the bridge and its writes to the storage are counted. */
async function openTableWindow(context: BrowserContext, treeId: string): Promise<{ sat: Page; bridgeCalls: string[] }> {
    const sat = await context.newPage();
    await sat.clock.setFixedTime(NOW);
    await sat.addInitScript(() => {
        const log: string[] = [];
        (window as unknown as { __storage: string[] }).__storage = log;
        const proto = Storage.prototype;
        const { setItem, removeItem } = proto;
        proto.setItem = function (this: Storage, k: string, v: string) { if (this === localStorage) log.push(`set ${k}`); return setItem.call(this, k, v); };
        proto.removeItem = function (this: Storage, k: string) { if (this === localStorage) log.push(`remove ${k}`); return removeItem.call(this, k); };
    });
    const bridgeCalls: string[] = [];
    sat.on('request', (req) => { if (req.url().startsWith(BRIDGE_ORIGIN)) bridgeCalls.push(req.url()); });
    await sat.goto(`/strom.html?okno=table&tree=${encodeURIComponent(treeId)}&w=am1`);
    await expect(sat.locator('#table-container .tv-grid[role="treegrid"]')).toBeVisible();
    return { sat, bridgeCalls };
}

async function openTable(page: Page): Promise<void> {
    await page.evaluate(() => window.Strom.UI.setDisplayViewMode('table'));
    await expect(page.locator('#table-container .tv-grid[role="treegrid"]')).toBeVisible();
}

const openView = (page: Page, id: string) => page.evaluate((id) => window.Strom.UI.openTableView(id), id);
const rowKeyOf = (page: Page, refn: string) => page.evaluate((r) => `p:${Object.values(window.Strom.DataManager.getData().persons).find(p => p.refn === r)!.id}`, refn);
const rowAt = async (page: Page, refn: string) => page.locator(`#table-container .tv-body .tv-row[data-key="${await rowKeyOf(page, refn)}"]`);
const headOrder = (page: Page) => page.locator('#table-container .tv-headrow .tv-headcell').evaluateAll(els => els.map(el => (el as HTMLElement).dataset.col ?? ''));
const rowKeys = (page: Page) => page.locator('#table-container .tv-body .tv-row').evaluateAll(els => els.map(el => (el as HTMLElement).dataset.key ?? ''));

test.describe('desktop (1440)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the Table of another window: the research\'s columns and views and the agent\'s bar from the main window, no bridge asked there', async ({ page, context }) => {
        await routeBridge(context);
        const treeId = await follow(page);
        const { sat, bridgeCalls } = await openTableWindow(context, treeId);

        // The research's views are offered there (VÝZKUM), and the Research view shows its columns.
        await openView(sat, 'r:research');
        await expect.poll(async () => (await headOrder(sat)).slice(0, 2)).toEqual(['name', 'rSum']);
        // Whom the agent works on (Josef): the bar on the name, as in the main window; the queued one has none.
        await expect((await rowAt(sat, 'P0003')).locator('.tv-name .tv-agent-bar')).toHaveCount(1);
        await expect((await rowAt(sat, 'P0004')).locator('.tv-name .tv-agent-bar')).toHaveCount(0);
        // The research chips are there (the block of the filters' row), not the note of a filter without research.
        await expect(sat.locator('#table-container .tv-view-note')).toBeHidden();

        // Nothing of the bridge reached that window: neither an ask nor its address or token.
        expect(bridgeCalls).toEqual([]);
        const leaked = await sat.evaluate((token) => {
            const meta = window.Strom.TreeManager.getTreeMetadata(window.Strom.DataManager.getCurrentTreeId()!);
            return JSON.stringify(meta).includes(token) || document.documentElement.outerHTML.includes(token);
        }, TOKEN);
        expect(leaked).toBe(false);
        expect(await sat.evaluate(() => (window as unknown as { __storage: string[] }).__storage)).toEqual([]);
        await sat.close();
    });

    test('a research bubble of another window\'s Table: its research action runs in the main window (spec 097 §5)', async ({ page, context }) => {
        await routeBridge(context);
        const treeId = await follow(page);
        const { sat } = await openTableWindow(context, treeId);
        await openView(sat, 'r:research');
        await expect.poll(async () => (await headOrder(sat)).slice(0, 2)).toEqual(['name', 'rSum']);
        const sumCell = async (refn: string) => {
            const index = await sat.locator('#table-container .tv-headrow .tv-headcell[data-col="rSum"]').getAttribute('aria-colindex');
            return (await rowAt(sat, refn)).locator(`[aria-colindex="${index}"]`);
        };
        const bubble = sat.locator('.tv-bubble--research');

        // Decide on a conflict: the main window opens What the research knows, this window does not.
        await (await sumCell('P0006')).click();
        await bubble.locator('[data-rid="decide"]').first().click();
        await expect(bubble).toBeHidden();
        await expect(page.locator('#person-research-modal')).toBeVisible();
        await expect(sat.locator('#person-research-modal')).toBeHidden();
        await sat.close();
    });

    test('a card\'s conflict badge in a family window: What the research knows opens in the main window, at the conflict (1126)', async ({ page, context }) => {
        await routeBridge(context);
        const treeId = await follow(page);
        const sat = await context.newPage();
        await sat.clock.setFixedTime(NOW);
        await sat.goto(`/strom.html?okno=family&tree=${encodeURIComponent(treeId)}&w=am2`);
        const marieId = await sat.evaluate(() => Object.values(window.Strom.DataManager.getData().persons).find(p => p.refn === 'P0006')!.id);
        await sat.evaluate((id) => window.Strom.TreeRenderer.setFocus(id as never), marieId);
        const badge = card(sat, 'Marie').locator('.card-signal');
        await expect(badge).toHaveText('≠');
        await badge.click();
        // Decided there through its bridge; nothing of it here.
        await expect(page.locator('#person-research-modal [data-conflict-card="X0001"]')).toBeVisible();
        await expect(sat.locator('#person-research-modal')).toHaveCount(0);
        await sat.close();
    });

    test('a saved view with a research filter shows the same rows in another window', async ({ page, context }) => {
        await routeBridge(context);
        const treeId = await follow(page);
        await openTable(page);
        // The view as saved: a research chip of the block (rQ).
        await page.evaluate(() => {
            const ok = window.Strom.DataManager.saveTableView({
                id: 'v-agent', name: 'Agent', rowType: 'persons', columns: [{ id: 'name' }, { id: 'rSum' }], pinned: 1, collapsedGroups: [],
                coverageRow: false, filter: { op: 'and', items: [{ chip: 'rQ' }] }, sort: [], updated: new Date().toISOString(),
            } as never);
            if (!ok) throw new Error('view not saved');
        });
        await openView(page, 'v-agent');
        // The filter applies there: some of the tree's people, not all of them.
        const all = await page.evaluate(() => Object.keys(window.Strom.DataManager.getData().persons).length);
        await expect.poll(async () => { const n = (await rowKeys(page)).length; return n > 0 && n < all; }).toBe(true);
        const main = await rowKeys(page);

        const { sat } = await openTableWindow(context, treeId);
        await openView(sat, 'v-agent');
        await expect.poll(() => rowKeys(sat)).toEqual(main);
        await expect(sat.locator('#table-container .tv-view-note')).toBeHidden();
        await sat.close();
    });
});

test.describe('5e: a research filter without a research', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('a view filtering by the research on a tree without one: every row, and the note says the filter is not applied', async ({ page }) => {
        await page.clock.setFixedTime(NOW);
        await openApp(page);
        await seedTree(page, { a: { firstName: 'Adam', lastName: 'Vrtišek' }, b: { firstName: 'Bára', lastName: 'Vrtišková', gender: 'female' } }, 'Vrtišek');
        await page.evaluate(() => {
            const ok = window.Strom.DataManager.saveTableView({
                id: 'v-wait', name: 'Waiting', rowType: 'persons', columns: [{ id: 'name' }], pinned: 1, collapsedGroups: [],
                coverageRow: false, filter: { op: 'and', items: [{ chip: 'rWait' }] }, sort: [], updated: new Date().toISOString(),
            } as never);
            if (!ok) throw new Error('view not saved');
        });
        await openTable(page);
        const note = page.locator('#table-container .tv-view-note');
        await expect(note).toBeHidden();
        await openView(page, 'v-wait');
        await expect.poll(async () => (await rowKeys(page)).length).toBe(2);
        await expect(note).toBeVisible();
        await expect(note).toHaveText('The research filter is not applied now');
        await expect(note).toHaveAttribute('title', 'The research filter is not applied now');
        // Another view without it: the note goes.
        await openView(page, 'b:overview');
        await expect(note).toBeHidden();
    });

    test('on a phone (390): the note\'s dot beside the view, its words in its title, the bar within the screen', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.clock.setFixedTime(NOW);
        await openApp(page);
        await seedTree(page, { a: { firstName: 'Adam', lastName: 'Vrtišek' } }, 'Vrtišek');
        await page.evaluate(() => {
            window.Strom.DataManager.saveTableView({
                id: 'v-wait', name: 'Waiting', rowType: 'persons', columns: [{ id: 'name' }], pinned: 1, collapsedGroups: [],
                coverageRow: false, filter: { op: 'and', items: [{ chip: 'rWait' }] }, sort: [], updated: new Date().toISOString(),
            } as never);
        });
        await openTable(page);
        await openView(page, 'v-wait');
        const note = page.locator('#table-container .tv-view-note');
        await expect(note).toBeVisible();
        await expect(note).toHaveAttribute('title', 'The research filter is not applied now');
        const box = await note.boundingBox();
        expect(box!.width).toBeLessThanOrEqual(26);
        expect(box!.x + box!.width).toBeLessThanOrEqual(390);
        expect(await page.locator('#table-container .tv-bar-row1').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    });
});
