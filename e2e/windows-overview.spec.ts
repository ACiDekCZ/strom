import { test, expect, Page, Request } from '@playwright/test';

/**
 * The Research overview in a window of its own (spec 079 K3, §6): opened from
 * ⧉ in the overview's head or from the ⧉ menu, drawn from the main window's
 * snapshot in two columns from 1100 px and one below; its actions (Show in
 * tree, an answer to Awaiting action, Stop) are done by the main window;
 * while it is open the main window opens no overview of its own (⤢ brings the
 * window to the front); once it closes the main window behaves as before. The
 * window itself never asks the research's bridge. Invented data only.
 */

const UUID = '7c2e4a1b-3d5f-4e6a-8b9c-1d2e3f4a5b6c';
const BRIDGE = 'http://127.0.0.1:5997/a1b2c3d4e5f60718293a4b5c6d7e8f90';
const cors = { 'access-control-allow-origin': '*' };
const LINKS = ['send', 'excerpt', 'app', 'open', 'chat', 'task', 'review', 'research', 'live'];

const GED = [
    '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 2 NOV 2026', `1 _STROM_TREE ${UUID}`, '1 CHAR UTF-8', '1 NOTE Brezinovi',
    '0 @P0001@ INDI', '1 NAME Ondřej /Březina/', '1 SEX M', '1 BIRT', '2 DATE 1871', '1 REFN P0001',
    '0 @P0002@ INDI', '1 NAME Libuše /Kordová/', '1 SEX F', '1 BIRT', '2 DATE 1875', '1 REFN P0002',
    '0 TRLR',
].join('\n');

interface Bridge {
    waiting: Record<string, unknown>[];
    writes: { path: string; body: Record<string, unknown> }[];
}

const DESKTOP = { width: 1440, height: 900 };

/** The main window follows a research whose bridge answers (routed for every page of the context). */
async function follow(page: Page): Promise<Bridge> {
    await page.setViewportSize(DESKTOP);
    await page.context().addInitScript((links) => {
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: links, at: new Date().toISOString() }));
    }, LINKS);
    const at = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const bridge: Bridge = {
        waiting: [
            { id: 'T0001', what: 'Ověřit datum sňatku v oddací matrice', kind: 'web', section: 'web', at, order: 0, person: 'P0001',
              group: { key: 'host:farnost.example', name: 'farnost.example', kind: 'web' }, url: 'https://farnost.example/matriky', actions: ['answer'] },
        ],
        writes: [],
    };
    const status = () => ({
        tree: { id: UUID, name: 'Březinovi' }, head: 'h1', persons: 2, links: LINKS, queue: [],
        working: [{ who: 'agent-matriky', since: new Date(Date.now() - 12 * 60_000).toISOString(), task: 'Sčítání 1910', person: 'P0002' }],
        waiting: bridge.waiting, features: ['waiting.groups', 'waiting.answer'],
    });
    const json = (s: number, body: unknown) => ({ status: s, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    // On the context: a window that asked the bridge would be answered (and seen by the test).
    await page.context().route(`${BRIDGE}/**`, async (route) => {
        const req = route.request();
        const path = new URL(req.url()).pathname;
        if (req.method() === 'OPTIONS') {
            return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-methods': 'GET, POST, PUT', 'access-control-allow-headers': '*' } });
        }
        if (path.endsWith('/status')) return route.fulfill(json(200, status()));
        if (path.endsWith('/tree.ged')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' }, body: GED });
        if (path.endsWith('/events')) {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `event: hello\ndata: ${JSON.stringify(status())}\n\n` });
        }
        const write = /\/waiting\/(T\d+)$/.exec(path);
        if (write && req.method() === 'POST') {
            bridge.writes.push({ path: write[1], body: JSON.parse(req.postData() || '{}') as Record<string, unknown> });
            const i = bridge.waiting.findIndex(w => w.id === write[1]);
            if (i >= 0) bridge.waiting.splice(i, 1);
            return route.fulfill(json(200, { task: write[1], head: '' }));
        }
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    await expect(page.locator('#live-panel .live-panel-expand')).toBeVisible();
    return bridge;
}

/** Requests to the bridge made by any page but the main window. */
function bridgeRequestsOutsideMain(page: Page): string[] {
    const out: string[] = [];
    page.context().on('request', (req: Request) => {
        if (!req.url().startsWith('http://127.0.0.1:5997/')) return;
        let from: Page | null = null;
        try { from = req.frame().page(); } catch { /* a service worker's */ }
        if (from !== page) out.push(req.url());
    });
    return out;
}

/** The main window's calls of a few of its functions (what the window's actions reach). */
async function spyMain(page: Page): Promise<void> {
    await page.evaluate(() => {
        const ui = window.Strom.UI as unknown as Record<string, (...a: unknown[]) => unknown>;
        const calls: { fn: string; args: unknown[] }[] = [];
        (window as unknown as { __calls: typeof calls }).__calls = calls;
        for (const fn of ['overviewShowPerson']) {
            const orig = ui[fn];
            ui[fn] = function (this: unknown, ...args: unknown[]) {
                calls.push({ fn, args });
                return orig.apply(this, args);
            };
        }
        const reg = window.Strom.Windows as unknown as { focusWindow(id: string): Promise<boolean> };
        const focus = reg.focusWindow.bind(reg);
        reg.focusWindow = (id: string) => {
            calls.push({ fn: 'focusWindow', args: [id] });
            return focus(id);
        };
    });
}
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: { fn: string; args: unknown[] }[] }).__calls);

async function popupOf(page: Page, click: () => Promise<void>): Promise<Page> {
    const [popup] = await Promise.all([page.waitForEvent('popup'), click()]);
    await popup.waitForLoadState('domcontentloaded');
    expect(popup.url()).toContain('okno=overview');
    await expect(popup.locator('#research-overview.research-overview--window')).toBeVisible();
    return popup;
}

const mainOverview = (page: Page) => page.locator('#research-overview');
const expand = (page: Page) => page.locator('#live-panel .live-panel-expand');

test.describe('the Research overview in a window of its own', () => {
    test.use({ viewport: DESKTOP });

    test('from ⧉ in the overview\'s head: two columns at 1440; Show in tree and an answer are done by the main window; ⤢ brings the window forward; closed, all as before', async ({ page }) => {
        const bridge = await follow(page);
        const outside = bridgeRequestsOutsideMain(page);
        await expand(page).click();
        await expect(mainOverview(page)).toBeVisible();
        // Today's overview: one status dot in its head.
        await expect(mainOverview(page).locator('.research-overview__head > .live-dot')).toHaveCount(1);
        const winBtn = mainOverview(page).locator('.research-overview__window');
        await expect(winBtn).toHaveAccessibleName('Open in a new window');

        const popup = await popupOf(page, () => winBtn.click());
        await spyMain(page);
        // The docked overview closes here; the small panel stays.
        await expect(mainOverview(page)).toBeHidden();
        await expect(page.locator('#live-panel')).toBeVisible();

        await popup.setViewportSize(DESKTOP);
        const ov = popup.locator('#research-overview');
        // The window's head: the dot, "{tree} · Research overview", the research's name, ◎, Stop, ⋯; no ⤡ or ⧉.
        const head = ov.locator('.research-overview__head--window');
        await expect(head.locator('.live-dot')).toHaveCount(1);
        await expect(head.locator('.research-overview__title')).toHaveText(/ · Research overview$/);
        await expect(head.locator('.research-overview__stop')).toHaveText('Stop following');
        await expect(head.locator('.live-follow-btn')).toBeVisible();
        await expect(head.locator('.research-overview__more')).toBeVisible();
        await expect(ov.locator('.research-overview__close, .research-overview__window')).toHaveCount(0);
        // Two columns: Now and Awaiting action left, the rest right.
        await expect(ov).toHaveClass(/research-overview--cols/);
        const left = ov.locator('.research-overview__col--left');
        await expect(left.locator('.live-section__title').first()).toHaveText(/^Now/);
        await expect(left.locator('.live-section__title').nth(1)).toHaveText(/^Awaiting action/);
        const boxes = await ov.locator('.research-overview__col').evaluateAll(cols => cols.map(c => c.getBoundingClientRect().left));
        expect(boxes).toHaveLength(2);
        expect(boxes[1]).toBeGreaterThan(boxes[0] + 300);

        // Show in tree: the main window centres the person.
        await ov.locator('.research-overview__now-row .link-button', { hasText: 'Show in tree' }).click();
        await expect.poll(async () => (await calls(page)).filter(c => c.fn === 'overviewShowPerson').length).toBe(1);
        const shown = (await calls(page)).find(c => c.fn === 'overviewShowPerson')!;
        expect(await page.evaluate((id) => window.Strom.DataManager.getPerson(id as never)?.firstName, shown.args[0])).toBe('Libuše');

        // An answer to Awaiting action: written to the bridge by the main window; the row goes in the window.
        const group = ov.locator('.research-overview__waiting-group');
        if (await group.count() > 0 && await group.first().getAttribute('aria-expanded') === 'false') await group.first().click();
        const item = ov.locator('.research-overview__waiting-item[data-id="T0001"]');
        await item.locator('.research-overview__waiting-row').click();
        await item.locator('.waiting-actions [data-action="answer"]').click();
        await item.locator('.waiting-answer textarea').fill('Sňatek je zapsán 12. 2. 1898.');
        await item.locator('.waiting-answer__send').click();
        await expect.poll(() => bridge.writes.length).toBe(1);
        expect(bridge.writes[0]).toMatchObject({ path: 'T0001', body: { do: 'answer', text: 'Sňatek je zapsán 12. 2. 1898.' } });
        await expect(ov.locator('.research-overview__waiting-item[data-id="T0001"]')).toHaveCount(0);

        // ⤢ in the main window: no overview here, the window comes forward; its title says so.
        await expect(expand(page)).toHaveAttribute('title', 'The research overview is in a separate window · click brings it to the front');
        const before = (await calls(page)).filter(c => c.fn === 'focusWindow').length;
        await expand(page).click();
        await expect.poll(async () => (await calls(page)).filter(c => c.fn === 'focusWindow').length).toBe(before + 1);
        await expect(mainOverview(page)).toBeHidden();
        // The ⧉ menu's item brings it forward too, no second window.
        await page.locator('#view-window-btn').click();
        const menuItem = page.locator('#view-window-menu [data-view="overview"]');
        await expect(menuItem).toHaveAttribute('title', 'The research overview is in a separate window · click brings it to the front');
        await menuItem.click();
        await expect.poll(async () => (await calls(page)).filter(c => c.fn === 'focusWindow').length).toBe(before + 2);
        await expect.poll(() => page.evaluate(() => window.Strom.Windows?.size)).toBe(1);

        // The window asked the bridge nothing.
        expect(outside).toEqual([]);

        // Closed: ⤢ opens the overview here again, as before.
        await popup.close();
        await expect.poll(() => page.evaluate(() => window.Strom.Windows?.size)).toBe(0);
        await expect(expand(page)).not.toHaveAttribute('title', /separate window/);
        await expand(page).click();
        await expect(mainOverview(page)).toBeVisible();
        await expect(mainOverview(page).locator('.research-overview__head > .live-dot')).toHaveCount(1);
        await expect(mainOverview(page).locator('.research-overview__window')).toBeVisible();
    });

    test('from the ⧉ menu: one column at 900; Stop ends following in the main window and the window shows the research without following', async ({ page }) => {
        await follow(page);
        const outside = bridgeRequestsOutsideMain(page);
        await page.locator('#view-window-btn').click();
        const menuItem = page.locator('#view-window-menu [data-view="overview"]');
        await expect(menuItem).toHaveText('Research overview');
        const popup = await popupOf(page, () => menuItem.click());
        await expect(mainOverview(page)).toBeHidden();

        await popup.setViewportSize({ width: 900, height: 900 });
        const ov = popup.locator('#research-overview');
        await expect(ov).not.toHaveClass(/research-overview--cols/);
        await expect(ov.locator('.research-overview__col')).toHaveCount(0);
        // Wider again: two columns.
        await popup.setViewportSize(DESKTOP);
        await expect(ov).toHaveClass(/research-overview--cols/);
        await popup.setViewportSize({ width: 900, height: 900 });
        await expect(ov).not.toHaveClass(/research-overview--cols/);

        // A section hidden in the main window (Settings, its panel): the window draws without it.
        await expect(ov.locator('.live-section__title', { hasText: /^Now/ })).toHaveCount(1);
        await page.evaluate(() => localStorage.setItem('strom-live-section-prefs', JSON.stringify({ v: 2, s: { working: 'hidden' } })));
        await expect(ov.locator('.live-section__title', { hasText: /^Now/ })).toHaveCount(0);

        // Stop: the main window stops following; the window draws the research viewed through its bridge.
        await ov.locator('.research-overview__stop').click();
        await expect.poll(() => page.evaluate(() => window.Strom.UI.isFollowingActiveResearch())).toBe(false);
        await expect(ov.locator('.research-overview__stop')).toHaveCount(0);
        await expect(ov.locator('.research-overview__head--window .live-dot')).toHaveClass(/live-dot--off/);
        await expect(mainOverview(page)).toBeHidden();

        expect(outside).toEqual([]);
        await popup.close();
    });
});
