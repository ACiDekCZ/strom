import { test, expect, Page, BrowserContext } from '@playwright/test';

/**
 * Taking over after the main window closed (spec 097 §7, K2.6): while the
 * main window follows a research live, closing it makes the first window
 * following the agent the main window (its strip says so before its reload);
 * following goes on there with ◎ as it was, the detached window stays
 * detached and says another window took over. Without the bridge address
 * stored in this browser no window becomes the main one: every window says
 * following can't be restored, with the manual way of spec 079. The main
 * window's F5 starts nothing. Invented data only.
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

const focusRefn = (page: Page) => page.evaluate(() => window.Strom.DataManager.getPerson(window.Strom.TreeRenderer.getFocusPersonId()!)?.refn ?? null);

const SAT_A = 'af1a2b3c';
const SAT_B = 'bf2b3c4d';

/** A Family window (its own selection, so only following moves it); the classes its strip had are logged across its reload. */
async function openFamilyWindow(context: BrowserContext, treeId: string, id: string): Promise<Page> {
    const sat = await context.newPage();
    await sat.setViewportSize({ width: 1200, height: 800 });
    await sat.addInitScript(([ms, wid]) => {
        (globalThis as { __LIVE_FOLLOW_MS?: unknown }).__LIVE_FOLLOW_MS = ms;
        if (!sessionStorage.getItem('seeded-sat')) {
            sessionStorage.setItem('seeded-sat', '1');
            sessionStorage.setItem(`strom.win.follow.${wid}`, 'off');
        }
        const note = (what: string): void => {
            const log = JSON.parse(sessionStorage.getItem('strip-log') ?? '[]') as string[];
            if (log[log.length - 1] === what) return;
            log.push(what);
            sessionStorage.setItem('strip-log', JSON.stringify(log));
        };
        new MutationObserver(() => {
            const s = document.querySelector<HTMLElement>('.sat-strip');
            if (s && !s.hidden) note(s.className);
        }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    }, [TIMINGS, id] as const);
    await sat.goto(`/strom.html?okno=family&tree=${encodeURIComponent(treeId)}&w=${id}`);
    await expect(sat.locator('.person-card').first()).toBeVisible();
    return sat;
}

const strip = (page: Page) => page.locator('.sat-strip');
const stripText = (page: Page) => page.locator('.sat-strip .sat-strip-text');
const stripLog = (page: Page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('strip-log') ?? '[]') as string[]);
const isMain = (page: Page) => page.evaluate(() => !document.documentElement.classList.contains('window-satellite') && !new URL(location.href).searchParams.has('okno'));

test.describe('desktop', () => {
    test('the main window closed: the following window takes over and follows on, ◎ as it was; the detached one stays detached and says so', async ({ page, context }) => {
        const bridge = await routeBridge(context);
        const treeId = await follow(page);
        const a = await openFamilyWindow(context, treeId, SAT_A);
        const b = await openFamilyWindow(context, treeId, SAT_B);
        await expect(stripText(a)).toHaveText('Following the agent · read-only');
        await expect(stripText(b)).toHaveText('Following the agent · read-only');
        // A detached: B (opened later) is first in the order.
        await strip(a).getByRole('button', { name: 'Detach this window' }).click();
        await expect(stripText(a)).toHaveText('This window is not following the agent · read-only');
        // The main window's list knows it (its status says each window's following).
        await expect.poll(() => page.evaluate((id) => window.Strom.Windows!.list().find(w => w.id === id)?.agent, SAT_A)).toBe('detached');

        await page.close();
        // B: its strip said it takes over, then it started again as the main window and follows the research.
        await expect.poll(() => isMain(b), { timeout: 15000 }).toBe(true);
        expect(await stripLog(b)).toContainEqual(expect.stringContaining('sat-strip--takeover'));
        await expect(b.locator('#live-panel')).toBeVisible({ timeout: 15000 });
        expect(await b.evaluate(() => window.Strom.UI.isLiveFollowOn())).toBe(true);
        expect(await b.evaluate(() => window.Strom.DataManager.getCurrentTreeId())).toBe(treeId);
        bridge.person = 'P0003';
        await expect.poll(() => focusRefn(b), { timeout: 10000 }).toBe('P0003');

        // A: never tried, another window took over (a toast); still detached, now with B as its main window.
        await expect(a.locator('.toast', { hasText: 'Another window took over following' })).toBeVisible({ timeout: 10000 });
        expect(await isMain(a)).toBe(false);
        await expect(stripText(a)).toHaveText('This window is not following the agent · read-only', { timeout: 10000 });
        expect(await stripLog(a)).not.toContainEqual(expect.stringContaining('sat-strip--takeover'));
        await expect.poll(() => b.evaluate((id) => window.Strom.Windows?.list().some(w => w.id === id) ?? false, SAT_A)).toBe(true);

        // On the map (spec 098 §6) after the takeover: B shows it itself; A hands it to B, its new main window.
        expect(await b.evaluate(() => window.Strom.UI.showOnMapState().disabled)).toBe(false);
        await expect.poll(() => a.evaluate(() => window.Strom.UI.showOnMapState().disabled)).toBe(false);
        const root = await a.evaluate(() => Object.values(window.Strom.DataManager.getData().persons).find(x => x.refn === 'P0001')!.id);
        await a.evaluate((r) => window.Strom.UI.showSelectionOnMap({ kind: 'descendants', personId: r } as never), root);
        await expect.poll(() => b.evaluate(() => window.Strom.TreeRenderer.getViewMode())).toBe('map');
        await expect.poll(() => b.evaluate(() => window.Strom.UI.mapEffectiveScope())).toBe('sel');
        expect(await b.evaluate(() => window.Strom.SettingsManager.getSelectionForTree(window.Strom.DataManager.getCurrentTreeId())?.ref ?? null)).toEqual({ kind: 'descendants', personId: root });
        expect(await a.evaluate(() => window.Strom.TreeRenderer.getViewMode())).toBe('family');
    });

    test('without the bridge address stored here no window takes over: following can\'t be restored, Make this the main window and Open Strom', async ({ page, context }) => {
        await routeBridge(context);
        const treeId = await follow(page);
        const a = await openFamilyWindow(context, treeId, SAT_A);
        await expect(stripText(a)).toHaveText('Following the agent · read-only');
        await page.close();
        // The address forgotten in this browser before the window learns the main window closed (3 s).
        await a.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('strom-research-bridge:')) localStorage.removeItem(k); });
        await expect(stripText(a)).toHaveText('Following can’t be restored · the main window closed', { timeout: 10000 });
        await expect(strip(a)).toHaveClass(/sat-strip--amber/);
        await expect(strip(a).getByRole('button', { name: 'Make this the main window' })).toBeVisible();
        await expect(strip(a).getByRole('button', { name: 'Open Strom' })).toBeVisible();
        await a.waitForTimeout(1000);
        expect(await isMain(a)).toBe(false);
    });

    test('the main window\'s F5 while following: no window takes over, no strip of a closed main window', async ({ page, context }) => {
        await routeBridge(context);
        const treeId = await follow(page);
        const a = await openFamilyWindow(context, treeId, SAT_A);
        await expect(stripText(a)).toHaveText('Following the agent · read-only');
        await page.reload();
        await expect(page.locator('#live-panel')).toBeVisible({ timeout: 10000 });
        await a.waitForTimeout(4500);
        expect(await isMain(a)).toBe(false);
        const log = await stripLog(a);
        expect(log.filter(c => /sat-strip--(takeover|takeoverFailed|closed)/.test(c))).toEqual([]);
        await expect(stripText(a)).toHaveText('Following the agent · read-only');
    });
});
