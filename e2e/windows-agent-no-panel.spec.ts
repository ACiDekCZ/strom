import { test, expect, Page, BrowserContext } from '@playwright/test';

/**
 * Another window never opens the research's panel nor its overview (spec 097
 * K2.5, §6): the window shows the main window's research through its strip
 * only. Detached from its strip, the end of following in the overview's own
 * window or in the main window's panel, and ◎ in the main window: the Table
 * window keeps no "Research now" panel and no Research overview; after the
 * end of following its strip goes with a toast. Invented data only.
 */

const UUID = '3b8d0f6e-1c2a-4e7b-9d50-8a4c6e2f1b73';
const BRIDGE_ORIGIN = 'http://127.0.0.1:5989';
const BRIDGE = `${BRIDGE_ORIGIN}/00112233445566778899aabbccddeeff`;
const cors = { 'access-control-allow-origin': '*' };
const LINKS = ['open', 'chat', 'task', 'live'];

const GED = [
    '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 30 SEP 2026', `1 _STROM_TREE ${UUID}`, '1 CHAR UTF-8', '1 NOTE Šafránkovi',
    '0 @P0001@ INDI', '1 NAME Vavřinec /Šafránek/', '1 SEX M', '1 BIRT', '2 DATE 1832', '1 REFN P0001', '1 FAMS @F0001@',
    '0 @P0002@ INDI', '1 NAME Kunhuta /Kmínová/', '1 SEX F', '1 REFN P0002', '1 FAMS @F0001@',
    '0 @P0003@ INDI', '1 NAME Bonifác /Šafránek/', '1 SEX M', '1 BIRT', '2 DATE 1861', '1 REFN P0003', '1 FAMC @F0001@',
    '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0003@',
    '0 TRLR',
].join('\n');

const TIMINGS = { gap: 300, idle: 60000, retry: 150 };

async function routeBridge(context: BrowserContext): Promise<void> {
    const status = () => ({
        tree: { id: UUID, name: 'Šafránkovi' }, head: 'h1', persons: 3,
        working: [{ who: 'agent-matriky', since: new Date(Date.now() - 60_000).toISOString(), task: 'T0101 Matriky', person: 'P0003' }],
        waiting: [], queue: [], links: LINKS,
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
}

/** The main window follows the research live, ◎ on. */
async function follow(page: Page): Promise<string> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(([links, ms]) => {
        (globalThis as { __LIVE_FOLLOW_MS?: unknown }).__LIVE_FOLLOW_MS = ms;
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: links, at: new Date().toISOString() }));
        localStorage.setItem('strom-live-follow', '1');
    }, [LINKS, TIMINGS] as const);
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    await expect(page.locator('#live-panel .live-panel-expand')).toBeVisible();
    return page.evaluate(() => window.Strom.DataManager.getCurrentTreeId()!);
}

/** The overview's own window from ⧉ in the overview's head (⤢ opens the overview here first). */
async function openOverviewWindow(page: Page): Promise<Page> {
    await page.locator('#live-panel .live-panel-expand').click();
    const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('#research-overview .research-overview__window').click()]);
    await popup.waitForLoadState('domcontentloaded');
    await expect(popup.locator('#research-overview.research-overview--window')).toBeVisible();
    return popup;
}

/** A Table window of the main window's tree, wide enough for a docked overview. */
async function openTableWindow(context: BrowserContext, treeId: string): Promise<Page> {
    const sat = await context.newPage();
    await sat.setViewportSize({ width: 1440, height: 900 });
    await sat.addInitScript((ms) => {
        (globalThis as { __LIVE_FOLLOW_MS?: unknown }).__LIVE_FOLLOW_MS = ms;
    }, TIMINGS);
    await sat.goto(`/strom.html?okno=table&tree=${encodeURIComponent(treeId)}&w=np1a2b3c`);
    await expect(sat.locator('#table-container .tv-grid[role="treegrid"]')).toBeVisible();
    await expect(stripText(sat)).toHaveText('Following the agent · read-only');
    return sat;
}

const stripText = (page: Page) => page.locator('.sat-strip .sat-strip-text');
const strip = (page: Page) => page.locator('.sat-strip');

/** Neither the research's panel nor its overview in the window, for a while (they came a moment after the click). */
async function noResearchPanel(sat: Page): Promise<void> {
    for (let i = 0; i < 6; i++) {
        await sat.waitForTimeout(150);
        expect(await sat.locator('#research-overview').count()).toBe(0);
        expect(await sat.locator('#live-panel:visible').count()).toBe(0);
        expect(await sat.evaluate(() => document.body.classList.contains('overview-docked'))).toBe(false);
    }
}

async function endedHere(sat: Page): Promise<void> {
    await expect(sat.locator('.toast', { hasText: 'Following the research ended · the tree can be edited' })).toBeVisible();
    await expect(strip(sat)).toBeHidden();
    await noResearchPanel(sat);
}

test.describe('another window opens no research panel', () => {
    test('(a) Detach this window and Follow the agent in the Table window\'s strip, the overview in its own window', async ({ page, context }) => {
        await routeBridge(context);
        const treeId = await follow(page);
        const popup = await openOverviewWindow(page);
        const sat = await openTableWindow(context, treeId);
        await noResearchPanel(sat);

        await strip(sat).getByRole('button', { name: 'Detach this window' }).click();
        await expect(stripText(sat)).toHaveText('This window is not following the agent · read-only');
        await noResearchPanel(sat);

        await strip(sat).getByRole('button', { name: 'Follow the agent' }).click();
        await expect(stripText(sat)).toHaveText('Following the agent · read-only');
        await noResearchPanel(sat);
        // The overview's own window stays as it was.
        await expect(popup.locator('#research-overview.research-overview--window')).toBeVisible();
    });

    test('(a) Detach this window: following begun anew from Follow live in the overview\'s own window', async ({ page, context }) => {
        await routeBridge(context);
        await follow(page);
        const popup = await openOverviewWindow(page);
        // Ended, then begun again from the overview's own window: the main window's session has the overview open (drawn there).
        await page.locator('#live-panel .live-panel-action', { hasText: 'End following' }).click();
        const followLive = popup.locator('.research-overview__follow-live');
        await expect(followLive).toBeVisible();
        await followLive.click();
        await expect(page.locator('#live-panel .live-panel-action', { hasText: 'End following' })).toBeVisible();
        await expect(page.locator('#research-overview')).toHaveCount(0);
        const treeId = await page.evaluate(() => window.Strom.DataManager.getCurrentTreeId()!);
        const sat = await openTableWindow(context, treeId);
        await strip(sat).getByRole('button', { name: 'Detach this window' }).click();
        await expect(stripText(sat)).toHaveText('This window is not following the agent · read-only');
        await noResearchPanel(sat);
        await expect(popup.locator('#research-overview.research-overview--window')).toBeVisible();
    });

    test('(a) Detach this window while the main window shows the overview docked', async ({ page, context }) => {
        await routeBridge(context);
        const treeId = await follow(page);
        await page.locator('#live-panel .live-panel-expand').click();
        await expect(page.locator('#research-overview')).toBeVisible();
        const sat = await openTableWindow(context, treeId);
        await strip(sat).getByRole('button', { name: 'Detach this window' }).click();
        await expect(stripText(sat)).toHaveText('This window is not following the agent · read-only');
        await noResearchPanel(sat);
    });

    test('(b) End following in the overview\'s own window', async ({ page, context }) => {
        await routeBridge(context);
        const treeId = await follow(page);
        const popup = await openOverviewWindow(page);
        const sat = await openTableWindow(context, treeId);
        await strip(sat).getByRole('button', { name: 'Detach this window' }).click();
        await expect(stripText(sat)).toHaveText('This window is not following the agent · read-only');
        await popup.getByRole('button', { name: 'End following' }).first().click();
        await endedHere(sat);
    });

    test('(b) End following in the main window\'s panel', async ({ page, context }) => {
        await routeBridge(context);
        const treeId = await follow(page);
        const sat = await openTableWindow(context, treeId);
        await page.locator('#live-panel .live-panel-action', { hasText: 'End following' }).click();
        await endedHere(sat);
    });

    test('(c) ◎ in the main window', async ({ page, context }) => {
        await routeBridge(context);
        const treeId = await follow(page);
        const sat = await openTableWindow(context, treeId);
        await page.locator('#live-follow').click();
        await expect.poll(() => page.evaluate(() => window.Strom.UI.isLiveFollowOn())).toBe(false);
        await noResearchPanel(sat);
        await expect(stripText(sat)).toHaveText('Following the agent · read-only');
    });
});
