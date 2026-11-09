import { test, expect, Page } from '@playwright/test';

/**
 * "Follow live" with a bridge that gives its last built tree at once
 * (`ged.stale`, Strom Research 1.30.0): the app asks `tree.ged?stale=1`, shows
 * the older tree right away with a quiet "Preparing a newer version…", and the
 * tree's state (the link's head, the base of a send) is the head of the file
 * shown, never the research's head now; the newer tree replaces it once the
 * bridge has built it. Its headers read where the bridge lets the browser read
 * them, the file's `_STROM_HEAD` where not. Without the feature nothing
 * changes. Invented data only.
 */

const UUID = '2d7c5e91-4a3b-4f08-9c61-7e2b0d4a8f35';
const BRIDGE = 'http://127.0.0.1:5993/abcdef0123456789abcdef0123456789';
const cors = { 'access-control-allow-origin': '*' };
const OLD = '4c1d8e2f7a90';
const NEW = 'b7e3a10c56d2';

const indi = (id: string, name: string, sex: 'M' | 'F', year: number, links: string[]) =>
    [`0 @${id}@ INDI`, `1 NAME ${name}`, `1 SEX ${sex}`, '1 BIRT', `2 DATE ${year}`, `1 REFN ${id}`, ...links];

/** The research's tree at `head`; the newer one has a third child. */
function ged(head: string, newer: boolean): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 9 NOV 2026', `1 _STROM_TREE ${UUID}`, `1 _STROM_HEAD ${head}`, '1 CHAR UTF-8', '1 NOTE Kolářovi',
        ...indi('P0001', 'Vavřinec /Kolář/', 'M', 1838, ['1 FAMS @F0001@']),
        ...indi('P0002', 'Ludmila /Zátková/', 'F', 1842, ['1 FAMS @F0001@']),
        ...indi('P0012', 'Bořivoj /Kolář/', 'M', 1864, ['1 FAMC @F0001@']),
        ...indi('P0013', 'Jarmila /Kolářová/', 'F', 1867, ['1 FAMC @F0001@']),
        ...(newer ? indi('P0014', 'Svatopluk /Kolář/', 'M', 1870, ['1 FAMC @F0001@']) : []),
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0012@', '1 CHIL @P0013@',
        ...(newer ? ['1 CHIL @P0014@'] : []),
        '0 TRLR',
    ].join('\n');
}

interface Bridge {
    /** Every `tree.ged` asked: whether with `stale=1`. */
    asks: boolean[];
    /** The bridge has built the tree of its head now: a plain ask is answered. */
    build: () => void;
}

/**
 * Follow a research whose head is NEW. `stale`: the bridge has `ged.stale` and
 * still builds the tree of NEW (a plain ask waits until `build()`), its last
 * built one being OLD. `expose`: its headers readable by the page.
 */
async function follow(page: Page, o: { stale: boolean; expose?: boolean }): Promise<Bridge> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
        (globalThis as { __LIVE_RECONNECT_MS?: number }).__LIVE_RECONNECT_MS = 250;
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-live-motion', '0');
    });
    let built = !o.stale;
    let release: () => void = () => undefined;
    const ready = built ? Promise.resolve() : new Promise<void>((r) => { release = r; });
    const bridge: Bridge = { asks: [], build: () => { built = true; release(); } };
    const status = () => ({
        tree: { id: UUID, name: 'Kolářovi' }, head: NEW, persons: 5,
        working: [{ who: 'agent-matriky', since: new Date(Date.now() - 60_000).toISOString(), task: 'T0101 Matriky', person: 'P0012' }],
        waiting: [], queue: [],
        ...(o.stale ? { features: ['ged.stale'] } : {}),
    });
    const expose = o.expose ? { 'access-control-expose-headers': 'X-Strom-Head, X-Strom-Stale, X-Strom-Head-Now' } : {};
    await page.route(`${BRIDGE}/**`, async (route) => {
        const url = new URL(route.request().url());
        const path = url.pathname;
        if (path.endsWith('/status')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(status()) });
        if (path.endsWith('/tree.ged')) {
            const stale = o.stale && url.searchParams.get('stale') === '1';
            bridge.asks.push(url.searchParams.has('stale'));
            if (stale && !built) {
                return route.fulfill({
                    status: 200,
                    headers: { ...cors, ...expose, 'content-type': 'text/plain; charset=utf-8', 'x-strom-head': OLD, 'x-strom-stale': '1', 'x-strom-head-now': NEW },
                    body: ged(OLD, false),
                });
            }
            await ready;
            return route.fulfill({ status: 200, headers: { ...cors, ...expose, 'content-type': 'text/plain; charset=utf-8', 'x-strom-head': NEW }, body: ged(NEW, true) });
        }
        if (path.endsWith('/events')) {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `event: hello\ndata: ${JSON.stringify(status())}\n\n` });
        }
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    await expect(page.locator('#live-panel')).toBeVisible();
    return bridge;
}

const card = (page: Page, name: string) => page.locator('#tree-canvas .person-card', { hasText: name });
const linkHead = (page: Page) => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research?.head ?? '');
const preparing = (page: Page) => page.locator('#live-panel .live-panel-preparing');

test.describe('follow live with the last built tree (ged.stale)', () => {
    for (const expose of [true, false]) {
        test(`the older tree at once, its head kept, the newer one loaded when built (headers ${expose ? 'readable' : 'hidden'})`, async ({ page }) => {
            const bridge = await follow(page, { stale: true, expose });
            // Shown at once, before the bridge has built the tree of its head now.
            await expect(card(page, 'Bořivoj')).toBeVisible();
            await expect(card(page, 'Svatopluk')).toHaveCount(0);
            expect(bridge.asks[0]).toBe(true);
            // The state is the file's, not the research's now: a send builds on what the tree holds.
            await expect.poll(() => linkHead(page)).toBe(OLD);
            await expect(preparing(page)).toBeVisible();
            await expect(preparing(page)).toContainText(/newer version|novější verze/i);
            // Meanwhile the newer tree is asked for without stale (the bridge answers once it is built).
            await expect.poll(() => bridge.asks.includes(false)).toBe(true);
            expect(await linkHead(page)).toBe(OLD);

            bridge.build();
            await expect(card(page, 'Svatopluk')).toBeVisible();
            await expect.poll(() => linkHead(page)).toBe(NEW);
            await expect(preparing(page)).toHaveCount(0);
        });
    }

    test('without ged.stale: the tree asked as before, its state the research\'s head', async ({ page }) => {
        const bridge = await follow(page, { stale: false });
        await expect(card(page, 'Svatopluk')).toBeVisible();
        await expect.poll(() => linkHead(page)).toBe(NEW);
        expect(bridge.asks.length).toBeGreaterThan(0);
        expect(bridge.asks.every(a => !a)).toBe(true);
        await expect(preparing(page)).toHaveCount(0);
    });
});
