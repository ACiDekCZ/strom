import { test, expect, Page } from '@playwright/test';
import { BRIDGE, FakeBridge, fakeBridge, openResearch, poll } from './research-bridge.js';

/**
 * "Do next" in the Research overview without following (spec 052 §4 with
 * spec 057 §7): while the open tree's research is viewed through its bridge,
 * a queued task's ⋯ offers "Do next" as while following; the bridge writes
 * it, the task goes on top with its tag, the toast names it with Undo, and
 * the queue is asked of the bridge again at once (not at the next regular
 * ask). Nothing follows, the tree is neither replaced nor locked. The bridge
 * not answering: nothing to set. The overview's own window: written by the
 * main window. Invented data (the Fíškovi of Čapkov); the bridge is answered
 * by page.route; a fixed clock.
 */

const NOW = new Date('2026-11-13T10:30:00Z');
const ACCEPTS = { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null };
const LINKS = ['send', 'open', 'live', 'app', 'setup', 'chat'];
const DIRECTIONS = [
    { id: 'G0001', name: 'Předci Josefa Fíška', state: 'active', direction: 'ancestors', focus: 'P0001', order: 1, tasks: 4, waiting: 0, working: false, since: '2026-11-01T08:00:00Z' },
];
const QUEUE = [
    { id: 'T0101', text: 'Matriky Čapkov', state: 'next', research: 'G0001' },
    { id: 'T0102', text: 'Sčítání lidu 1880', state: 'next', research: 'G0001' },
    { id: 'T0103', text: 'Pozemková kniha Čapkov', state: 'next', research: 'G0001' },
    { id: 'T0104', text: 'Křest Jana Fíška', state: 'next', research: 'G0001' },
];
const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };

interface QueueBridge { bridge: FakeBridge; writes: [string, unknown][] }

/**
 * The research tree, its bridge known here and answering with `queue.next`; not followed. A task's place
 * (`POST /queue/<T>`) as the research writes it: "next" on top, `restore` back to its place; `then` changes
 * what its next status says besides.
 */
async function researchTree(page: Page, then?: (queue: Record<string, unknown>[]) => void): Promise<QueueBridge> {
    await page.clock.setFixedTime(NOW);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openResearch(page);
    const bridge = await fakeBridge(page, {
        accepts: ACCEPTS, links: LINKS, features: ['queue.next'],
        statusExtra: { working: [], researches: DIRECTIONS, queue: structuredClone(QUEUE) },
    });
    const writes: [string, unknown][] = [];
    await page.route(`${BRIDGE}/queue/*`, async (route) => {
        const req = route.request();
        if (req.method() !== 'POST') return route.fallback();
        const id = new URL(req.url()).pathname.split('/').pop()!;
        const body = JSON.parse(req.postData() ?? '{}') as { do: string };
        writes.push([id, body]);
        const queue = structuredClone(bridge.statusExtra!.queue as Record<string, unknown>[]);
        const q = queue.find(x => x.id === id)!;
        const was = q.own ? { own: q.own, at: '2026-11-13T09:00:00Z' } : {};
        if (body.do === 'next') q.own = 'next';
        else delete q.own;
        const rest = queue.filter(x => x !== q);
        const order = body.do === 'next' ? [q, ...rest] : [...rest, q].sort((a, b) => String(a.id).localeCompare(String(b.id)));
        then?.(order);
        bridge.statusExtra = { ...bridge.statusExtra, queue: order };
        return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ task: q, was }) });
    });
    await poll(page);
    return { bridge, writes };
}

const ov = (page: Page) => page.locator('#research-overview');
const rows = (page: Page) => ov(page).locator('#ov-sec-queue .live-queue > .live-queue-row[data-task]');
const order = (page: Page) => rows(page).evaluateAll(rs => rs.map(r => (r as HTMLElement).dataset.task));
const row = (page: Page, id: string) => ov(page).locator(`#ov-sec-queue .live-queue > .live-queue-row[data-task="${id}"]`);
const menu = (page: Page) => page.locator('#live-task-menu');
const toast = (page: Page) => page.locator('.toast[data-kind="queue-next"]');
const following = (page: Page) => page.evaluate(() => window.Strom.UI.isFollowingActiveResearch());
const readOnly = (page: Page) => page.evaluate(() => window.Strom.DataManager.isReadOnly() || window.Strom.DataManager.isLiveFollowing());
const statusAsks = (b: FakeBridge) => (b.seen ?? []).filter(s => s === 'GET /status').length;

/** The overview from the Research menu's first item, its Queue unfolded. */
async function openOverview(page: Page): Promise<void> {
    await page.locator('#research-menu-btn').click();
    await page.locator('#research-item-overview').click();
    await expect(ov(page)).toBeVisible();
    const head = ov(page).locator('.live-section__head[aria-controls="ov-sec-queue"]');
    if (await head.getAttribute('aria-expanded') === 'false') await head.click();
    await expect(head).toHaveAttribute('aria-expanded', 'true');
}

test.describe('Do next without following', () => {
    test('the bridge answering: Do next in the ⋯, the task on top with its tag, the toast with Undo, the queue asked again at once; nothing followed', async ({ page }) => {
        // The research's queue after the write: another task's text changed meanwhile (only its next status says so).
        const { bridge, writes } = await researchTree(page, (queue) => {
            const census = queue.find(x => x.id === 'T0102');
            if (census) census.text = 'Sčítání lidu 1880 a 1890';
        });
        await openOverview(page);
        await expect.poll(() => order(page)).toEqual(['T0101', 'T0102', 'T0103', 'T0104']);
        expect(await following(page)).toBe(false);

        // The first task: nothing to set (and no research links for Postpone / Give up here): no ⋯.
        await expect(row(page, 'T0101').locator('.live-queue-more')).toHaveCount(0);

        await row(page, 'T0103').locator('.live-queue-more').click();
        await expect(menu(page).locator('[data-order="next"]')).toHaveText('Do nextComes up after the task in progress');
        const asked = statusAsks(bridge);
        await menu(page).locator('[data-order="next"]').click();
        await expect.poll(() => writes).toEqual([['T0103', { do: 'next' }]]);
        await expect.poll(() => order(page)).toEqual(['T0103', 'T0101', 'T0102', 'T0104']);
        await expect(row(page, 'T0103').locator('.research-queue__tag-next')).toHaveText('next');
        await expect(row(page, 'T0103')).toBeFocused();
        await expect(toast(page)).toContainText('T0103 comes up next');
        // The bridge asked again at once (the regular ask comes only after 20 s): what it says now is drawn.
        await expect.poll(() => statusAsks(bridge), { timeout: 3000 }).toBeGreaterThan(asked);
        await expect(row(page, 'T0102')).toContainText('Sčítání lidu 1880 a 1890', { timeout: 3000 });

        // Undo: back exactly where it was, through the bridge.
        await toast(page).locator('.toast-action').click();
        await expect.poll(() => writes.at(-1)).toEqual(['T0103', { do: 'restore', was: {} }]);
        await expect.poll(() => order(page)).toEqual(['T0101', 'T0102', 'T0103', 'T0104']);
        await expect(row(page, 'T0103').locator('.research-queue__tag-next')).toHaveCount(0);

        // Nothing followed: no stream, no research tree loaded, the tree editable.
        expect(await following(page)).toBe(false);
        expect(await readOnly(page)).toBe(false);
        expect((bridge.seen ?? []).some(s => s.endsWith('/events') || s.endsWith('/tree.ged'))).toBe(false);
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const jan = Object.values(dm.getData().persons).find((p: any) => p.firstName === 'Jan') as any;
            dm.updatePerson(jan.id, { birthPlace: 'Čapkov' });
        });
        expect(await page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons) as any[]).find(p => p.firstName === 'Jan').birthPlace)).toBe('Čapkov');
    });

    test('the bridge not answering: the overview from the tree, nothing to set', async ({ page }) => {
        const { bridge, writes } = await researchTree(page);
        bridge.down = true;
        await poll(page);
        await page.locator('#research-menu-btn').click();
        await page.locator('#research-item-overview').click();
        await expect(ov(page)).toBeVisible();
        await expect(ov(page).locator('.research-overview__head .live-dot')).toHaveClass(/live-dot--off/);
        await expect(ov(page).locator('.live-queue-more')).toHaveCount(0);
        await expect(page.locator('[data-order]')).toHaveCount(0);
        expect(writes).toEqual([]);
    });

    test('the overview\'s own window: Do next written by the main window, shown in the window with Undo', async ({ page }) => {
        const { writes } = await researchTree(page);
        await page.locator('#view-window-btn').click();
        const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('#view-window-menu [data-view="overview"]').click()]);
        await popup.waitForLoadState('domcontentloaded');
        const win = popup.locator('#research-overview.research-overview--window');
        await expect(win).toBeVisible();
        // The window asks the bridge nothing.
        const bridgeAsks: string[] = [];
        popup.on('request', r => { if (r.url().startsWith('http://127.0.0.1:5998')) bridgeAsks.push(r.url()); });
        const head = win.locator('.live-section__head[aria-controls="ov-sec-queue"]');
        if (await head.getAttribute('aria-expanded') === 'false') await head.click();
        const winRow = (id: string) => win.locator(`#ov-sec-queue .live-queue > .live-queue-row[data-task="${id}"]`);
        const first = () => win.locator('#ov-sec-queue .live-queue > .live-queue-row[data-task]').first().getAttribute('data-task');
        await winRow('T0104').locator('.live-queue-more').click();
        await popup.locator('#live-task-menu [data-order="next"]').click();
        await expect.poll(() => writes).toEqual([['T0104', { do: 'next' }]]);
        await expect.poll(first).toBe('T0104');
        await expect(winRow('T0104').locator('.research-queue__tag-next')).toHaveText('next');
        const winToast = popup.locator('.toast[data-kind="queue-next"]');
        await expect(winToast).toContainText('T0104 comes up next');
        await winToast.locator('.toast-action').click();
        await expect.poll(() => writes.at(-1)).toEqual(['T0104', { do: 'restore', was: {} }]);
        await expect.poll(first).toBe('T0101');
        expect(await following(page)).toBe(false);
        expect(bridgeAsks).toEqual([]);
        await popup.close();
    });
});
