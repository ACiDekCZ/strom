import { test, expect, Page, BrowserContext } from '@playwright/test';

/**
 * Each additional window follows the agent on its own (spec 097 §1–§3, §6):
 * while the main window follows a research live, a Family window jumps to
 * whom the agent works on in its own view, with its strip ("Following the
 * agent · read-only", Detach this window, Go to the main window). Moving it
 * pauses only that window (no pill there): Back to the agent, or by itself
 * after a while. Detached, it stays where it is (over its reload too) until
 * Follow the agent. ◎ in the main window does not turn the windows off; the
 * bridge lost shows amber; the end of the session says so in a toast and
 * forgets the detachment. The window writes nothing of following to the
 * main window's storage. Narrow windows: the buttons under the words, 44 px
 * at 390. Timings shortened through __LIVE_FOLLOW_MS. Invented data only.
 */

const UUID = '5a1e7c22-9b3d-4f60-8e2a-6c4b0d9f1e37';
const BRIDGE_ORIGIN = 'http://127.0.0.1:5987';
const BRIDGE = `${BRIDGE_ORIGIN}/0123456789abcdef0123456789abcdef`;
const cors = { 'access-control-allow-origin': '*' };
const LINKS = ['open', 'chat', 'task', 'live'];

const GED = [
    '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 30 SEP 2026', `1 _STROM_TREE ${UUID}`, '1 CHAR UTF-8', '1 NOTE Řeřichovi',
    '0 @P0001@ INDI', '1 NAME Bohumil /Řeřicha/', '1 SEX M', '1 BIRT', '2 DATE 1840', '1 REFN P0001', '1 FAMS @F0001@', '1 FAMC @F0000@',
    '0 @P0002@ INDI', '1 NAME Ludmila /Pažitková/', '1 SEX F', '1 REFN P0002', '1 FAMS @F0001@',
    '0 @P0003@ INDI', '1 NAME Prokop /Řeřicha/', '1 SEX M', '1 BIRT', '2 DATE 1810', '1 REFN P0003', '1 FAMS @F0000@',
    '0 @P0012@ INDI', '1 NAME Kryštof /Řeřicha/', '1 SEX M', '1 BIRT', '2 DATE 1865', '1 REFN P0012', '1 FAMC @F0001@',
    '0 @P0013@ INDI', '1 NAME Apolena /Řeřichová/', '1 SEX F', '1 BIRT', '2 DATE 1868', '1 REFN P0013', '1 FAMC @F0001@',
    '0 @F0000@ FAM', '1 HUSB @P0003@', '1 CHIL @P0001@',
    '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0012@', '1 CHIL @P0013@',
    '0 TRLR',
].join('\n');

interface Bridge {
    person: string;
    /** The bridge does not answer (the connection dropped). */
    down: boolean;
    /** Asks of /status and /events so far. */
    chain: number;
}

const TIMINGS = { gap: 300, idle: 5000, retry: 150 };

async function routeBridge(context: BrowserContext): Promise<Bridge> {
    const bridge: Bridge = { person: 'P0012', down: false, chain: 0 };
    const status = () => ({
        tree: { id: UUID, name: 'Řeřichovi' }, head: 'h1', persons: 5,
        working: [{ who: 'agent-matriky', since: new Date(Date.now() - 60_000).toISOString(), task: 'T0101 Matriky', person: bridge.person }],
        waiting: [], queue: [], links: LINKS,
    });
    await context.route(`${BRIDGE}/**`, async (route) => {
        if (bridge.down) return route.abort('connectionrefused');
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/status') || path.endsWith('/events')) bridge.chain++;
        if (path.endsWith('/status')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(status()) });
        if (path.endsWith('/tree.ged')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' }, body: GED });
        if (path.endsWith('/events')) {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `event: hello\ndata: ${JSON.stringify(status())}\n\n` });
        }
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    return bridge;
}

/** The main window follows the research live, ◎ on. */
async function follow(page: Page): Promise<string> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(([links, ms]) => {
        (globalThis as { __LIVE_FOLLOW_MS?: unknown }).__LIVE_FOLLOW_MS = ms;
        (globalThis as { __LIVE_RECONNECT_MS?: number }).__LIVE_RECONNECT_MS = 250;
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: links, at: new Date().toISOString() }));
        localStorage.setItem('strom-live-follow', '1');
    }, [LINKS, TIMINGS] as const);
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    await expect(page.locator('#live-panel')).toBeVisible();
    return page.evaluate(() => window.Strom.DataManager.getCurrentTreeId()!);
}

/** A Family window of the main window's tree; its writes to localStorage are counted. */
async function openFamilyWindow(context: BrowserContext, treeId: string, size = { width: 1200, height: 800 }): Promise<Page> {
    const sat = await context.newPage();
    await sat.setViewportSize(size);
    await sat.addInitScript((ms) => {
        (globalThis as { __LIVE_FOLLOW_MS?: unknown }).__LIVE_FOLLOW_MS = ms;
        // The window's own selection (follow mode off): the main window's jumps are not taken as a
        // choice here, so only the window's own following moves it.
        sessionStorage.setItem('strom.win.follow.af1a2b3c', 'off');
        const log: string[] = [];
        (window as unknown as { __storage: string[] }).__storage = log;
        const proto = Storage.prototype;
        const { setItem, removeItem } = proto;
        proto.setItem = function (this: Storage, k: string, v: string) { if (this === localStorage) log.push(`set ${k}`); return setItem.call(this, k, v); };
        proto.removeItem = function (this: Storage, k: string) { if (this === localStorage) log.push(`remove ${k}`); return removeItem.call(this, k); };
    }, TIMINGS);
    await sat.goto(`/strom.html?okno=family&tree=${encodeURIComponent(treeId)}&w=af1a2b3c`);
    await expect(sat.locator('.person-card').first()).toBeVisible();
    return sat;
}

async function nextStatus(bridge: Bridge): Promise<void> {
    const n = bridge.chain;
    await expect.poll(() => bridge.chain, { timeout: 10000 }).toBeGreaterThanOrEqual(n + 2);
}

const focusRefn = (page: Page) => page.evaluate(() => window.Strom.DataManager.getPerson(window.Strom.TreeRenderer.getFocusPersonId()!)?.refn ?? null);
const strip = (page: Page) => page.locator('.sat-strip');
const stripText = (page: Page) => page.locator('.sat-strip .sat-strip-text');
const detachedKey = (page: Page) => page.evaluate(() => sessionStorage.getItem('strom.win.agent.af1a2b3c'));

/** Drag the empty canvas a little (the user takes the tree). */
async function dragTree(page: Page): Promise<void> {
    const { x, y } = await page.evaluate(() => {
        const box = document.getElementById('tree-container')!.getBoundingClientRect();
        for (let fy = 0.2; fy < 0.9; fy += 0.1) {
            for (let fx = 0.1; fx < 0.9; fx += 0.1) {
                const px = box.left + box.width * fx, py = box.top + box.height * fy;
                const el = document.elementFromPoint(px, py);
                if (el && (el.id === 'tree-container' || el.id === 'tree-canvas' || el.closest('#tree-lines'))) return { x: px, y: py };
            }
        }
        throw new Error('no empty spot');
    });
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 60, y - 20, { steps: 4 });
    await page.mouse.up();
}

test.describe('desktop', () => {
    test('a Family window follows the agent on its own: jumps, a pause of its own and back, ◎ in the main window does not reach it', async ({ page, context }) => {
        const bridge = await routeBridge(context);
        const treeId = await follow(page);
        const sat = await openFamilyWindow(context, treeId);

        // Attached: the window jumps to whom the agent works on, in its own view.
        await expect.poll(() => focusRefn(sat)).toBe('P0012');
        await expect(stripText(sat)).toHaveText('Following the agent · read-only');
        await expect(strip(sat).getByRole('button', { name: 'Detach this window' })).toBeVisible();
        await expect(strip(sat).getByRole('button', { name: 'Go to the main window' })).toBeVisible();
        await expect(strip(sat)).toHaveClass(/sat-strip--attached/);

        bridge.person = 'P0003';
        await nextStatus(bridge);
        await expect.poll(() => focusRefn(sat)).toBe('P0003');

        // Moved: paused here only, no pill in the window; Back to the agent.
        await dragTree(sat);
        await expect(stripText(sat)).toHaveText('Following paused · read-only');
        await expect(sat.locator('#live-follow-pill')).toHaveCount(0);
        bridge.person = 'P0013';
        await nextStatus(bridge);
        await expect.poll(() => focusRefn(page)).toBe('P0013');
        expect(await focusRefn(sat)).toBe('P0003');
        const back = strip(sat).getByRole('button', { name: 'Back to the agent' });
        await back.click();
        await expect.poll(() => focusRefn(sat)).toBe('P0013');
        await expect(stripText(sat)).toHaveText('Following the agent · read-only');
        // Focus stays in the strip after the state changed.
        expect(await sat.evaluate(() => !!document.activeElement?.closest('.sat-strip'))).toBe(true);

        // Paused again: back by itself after a while without touching.
        await dragTree(sat);
        await expect(stripText(sat)).toHaveText('Following paused · read-only');
        await expect(stripText(sat)).toHaveText('Following the agent · read-only', { timeout: 12000 });

        // ◎ off in the main window: the window keeps following.
        await page.evaluate(() => window.Strom.UI.setLiveFollow(false));
        bridge.person = 'P0001';
        await nextStatus(bridge);
        await expect.poll(() => focusRefn(sat)).toBe('P0001');
        await expect(stripText(sat)).toHaveText('Following the agent · read-only');

        // Nothing of following written to the storage the main window keeps.
        const writes = await sat.evaluate(() => (window as unknown as { __storage: string[] }).__storage);
        expect(writes.filter(w => /live-follow|focus|view|fan/i.test(w))).toEqual([]);
    });

    test('detached: no jumps, over the window\'s reload; Follow the agent; the end of the session forgets it with a toast', async ({ page, context }) => {
        const bridge = await routeBridge(context);
        const treeId = await follow(page);
        const sat = await openFamilyWindow(context, treeId);
        await expect.poll(() => focusRefn(sat)).toBe('P0012');

        await strip(sat).getByRole('button', { name: 'Detach this window' }).click();
        await expect(stripText(sat)).toHaveText('This window is not following the agent · read-only');
        await expect(strip(sat).getByRole('button', { name: 'Follow the agent' })).toBeFocused();
        expect(await detachedKey(sat)).toBe('detached');
        bridge.person = 'P0003';
        await nextStatus(bridge);
        await expect.poll(() => focusRefn(page)).toBe('P0003');
        expect(await focusRefn(sat)).toBe('P0012');

        // The window's reload: still detached.
        await sat.reload();
        await expect(stripText(sat)).toHaveText('This window is not following the agent · read-only');
        expect(await focusRefn(sat)).not.toBe('P0003');

        await strip(sat).getByRole('button', { name: 'Follow the agent' }).click();
        await expect.poll(() => focusRefn(sat)).toBe('P0003');
        await expect(stripText(sat)).toHaveText('Following the agent · read-only');
        expect(await detachedKey(sat)).toBeNull();

        // Detached again, then the main window ends following: a toast, no strip, nothing kept.
        await strip(sat).getByRole('button', { name: 'Detach this window' }).click();
        expect(await detachedKey(sat)).toBe('detached');
        await page.evaluate(() => window.Strom.UI.stopLiveFollow());
        await expect(sat.locator('.toast', { hasText: 'Following the research ended · the tree can be edited' })).toBeVisible();
        await expect(strip(sat)).toBeHidden();
        expect(await detachedKey(sat)).toBeNull();
    });

    test('the bridge lost: the amber strip with the window\'s own button', async ({ page, context }) => {
        const bridge = await routeBridge(context);
        const treeId = await follow(page);
        const sat = await openFamilyWindow(context, treeId);
        await expect(stripText(sat)).toHaveText('Following the agent · read-only');
        bridge.down = true;
        await expect(stripText(sat)).toHaveText('The connection to the research dropped · trying again', { timeout: 10000 });
        await expect(strip(sat)).toHaveClass(/sat-strip--amber/);
        await expect(strip(sat).getByRole('button', { name: 'Detach this window' })).toBeVisible();
        bridge.down = false;
        await expect(stripText(sat)).toHaveText('Following the agent · read-only', { timeout: 10000 });
    });
});

for (const width of [600, 390]) {
    test(`a narrow window (${width}): the buttons under the words, nothing past the edge${width <= 400 ? ', 44 px buttons' : ''}`, async ({ page, context }) => {
        await routeBridge(context);
        const treeId = await follow(page);
        const sat = await openFamilyWindow(context, treeId, { width, height: 760 });
        await expect(stripText(sat)).toHaveText('Following the agent · read-only');
        const box = await sat.evaluate(() => {
            const s = document.querySelector('.sat-strip') as HTMLElement;
            const text = s.querySelector('.sat-strip-text')!.getBoundingClientRect();
            const buttons = [...s.querySelectorAll('.sat-strip-btn')].map(b => b.getBoundingClientRect());
            return {
                overflow: s.scrollWidth - s.clientWidth,
                pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                below: buttons.every(b => b.top >= text.bottom - 1),
                inside: buttons.every(b => b.right <= window.innerWidth + 0.5),
                minHeight: Math.min(...buttons.map(b => b.height)),
            };
        });
        expect(box.overflow).toBeLessThanOrEqual(0);
        expect(box.pageOverflow).toBeLessThanOrEqual(0);
        expect(box.below).toBe(true);
        expect(box.inside).toBe(true);
        if (width <= 400) expect(box.minHeight).toBeGreaterThanOrEqual(44);
    });
}
