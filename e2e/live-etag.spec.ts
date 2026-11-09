import { test, expect, Page } from '@playwright/test';

/**
 * "Follow live" with a bridge that tags its tree (`ged.etag`, Strom Research
 * 1.30.0): the app keeps the ETag of the file it loaded with the tree and asks
 * again with `If-None-Match`; a 304 keeps the tree it holds (no download, no
 * parse), the cards as they were. A new head gives a new file. A file sent
 * without an ETag is never reused, and without the feature no
 * `If-None-Match` goes at all. Invented data only.
 */

const UUID = '6a1f3c8e-2b4d-4e97-a053-9d8c7b6e5f41';
const BRIDGE = 'http://127.0.0.1:5994/fedcba9876543210fedcba9876543210';
const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'if-none-match',
    'access-control-expose-headers': 'ETag, X-Strom-Head, X-Strom-Stale, X-Strom-Head-Now',
};
const OLD = '5e2a9d1c7b30';
const NEW = 'c8f4b21d07e6';

const indi = (id: string, name: string, sex: 'M' | 'F', year: number, links: string[]) =>
    [`0 @${id}@ INDI`, `1 NAME ${name}`, `1 SEX ${sex}`, '1 BIRT', `2 DATE ${year}`, `1 REFN ${id}`, ...links];

/** The research's tree at `head`; the newer one has a third child. */
function ged(head: string): string {
    const newer = head === NEW;
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 9 NOV 2026', `1 _STROM_TREE ${UUID}`, `1 _STROM_HEAD ${head}`, '1 CHAR UTF-8', '1 NOTE Ostružníkovi',
        ...indi('P0001', 'Bolemír /Ostružník/', 'M', 1836, ['1 FAMS @F0001@']),
        ...indi('P0002', 'Kvítoslava /Pelyňková/', 'F', 1841, ['1 FAMS @F0001@']),
        ...indi('P0012', 'Blahomil /Ostružník/', 'M', 1862, ['1 FAMC @F0001@']),
        ...indi('P0013', 'Dobrava /Ostružníková/', 'F', 1865, ['1 FAMC @F0001@']),
        ...(newer ? indi('P0014', 'Zbyhněv /Ostružník/', 'M', 1869, ['1 FAMC @F0001@']) : []),
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0012@', '1 CHIL @P0013@',
        ...(newer ? ['1 CHIL @P0014@'] : []),
        '0 TRLR',
    ].join('\n');
}

const tagOf = (head: string) => `"${head.padEnd(32, '0')}"`;

interface Bridge {
    /** Every `tree.ged` asked: its If-None-Match ('' without) and the status answered. */
    asks: Array<{ tag: string; status: number }>;
    /** The research moves to another head. */
    head: string;
}

/**
 * Follow a research at `head`. `etag`: the bridge has `ged.etag` (with
 * `ged.stale`, as Strom Research 1.30.0). `sendsTag`: its files carry an ETag
 * (a file built before all its images has none). A row of `working[]` is about
 * the couple F0001 (the app names its person from the families it knows).
 */
async function follow(page: Page, o: { etag: boolean; sendsTag?: boolean; head?: string }): Promise<Bridge> {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
        (globalThis as { __LIVE_RECONNECT_MS?: number }).__LIVE_RECONNECT_MS = 250;
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-live-motion', '0');
    });
    const bridge: Bridge = { asks: [], head: o.head ?? OLD };
    const sendsTag = o.sendsTag ?? true;
    const status = () => ({
        tree: { id: UUID, name: 'Ostružníkovi' }, head: bridge.head, persons: 5,
        working: [{ who: 'agent-matriky', since: new Date(Date.now() - 60_000).toISOString(), task: 'T0101 Oddací matrika', family: 'F0001' }],
        waiting: [], queue: [],
        features: o.etag ? ['ged.stale', 'ged.etag'] : ['ged.stale'],
    });
    await page.route(`${BRIDGE}/**`, async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        const path = url.pathname;
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors, body: '' });
        if (path.endsWith('/status')) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(status()) });
        if (path.endsWith('/tree.ged')) {
            const asked = req.headers()['if-none-match'] ?? '';
            const tag = tagOf(bridge.head);
            // A bridge without the feature sends a tag too here: the app must not use it.
            const tagged = sendsTag ? { etag: tag } : {};
            if (o.etag && sendsTag && asked === tag) {
                bridge.asks.push({ tag: asked, status: 304 });
                return route.fulfill({ status: 304, headers: { ...cors, ...tagged, 'x-strom-head': bridge.head }, body: '' });
            }
            bridge.asks.push({ tag: asked, status: 200 });
            return route.fulfill({
                status: 200,
                headers: { ...cors, ...tagged, 'content-type': 'text/plain; charset=utf-8', 'x-strom-head': bridge.head },
                body: ged(bridge.head),
            });
        }
        if (path.endsWith('/events')) {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `event: hello\ndata: ${JSON.stringify(status())}\n\n` });
        }
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    await expect(page.locator('#live-panel')).toBeVisible();
    await expect(card(page, 'Blahomil')).toBeVisible();
    return bridge;
}

const card = (page: Page, name: string) => page.locator('#tree-canvas .person-card', { hasText: name });
const link = (page: Page) => page.evaluate(() => window.Strom.TreeManager.getActiveTreeMetadata()?.research ?? null);
const downloads = (b: Bridge) => b.asks.filter(a => a.status === 200).length;
/** The cards as drawn: name and classes (marks of the research and of the agent's work included). */
const cards = (page: Page) => page.locator('#tree-canvas .person-card').evaluateAll(els => els
    .map(el => `${(el.textContent ?? '').replace(/\s+/g, ' ').trim()}|${[...el.classList].sort().join(' ')}`).sort());

/** Reopen the app: following resumes from the remembered bridge. */
async function reopen(page: Page): Promise<void> {
    await page.reload();
    await expect(page.locator('#live-panel')).toBeVisible();
    await expect(card(page, 'Blahomil')).toBeVisible();
}

test.describe('follow live with a tagged tree (ged.etag)', () => {
    test('opened again with the same head: 304, the tree it holds, nothing downloaded again', async ({ page }) => {
        const bridge = await follow(page, { etag: true });
        // First time nothing is held: asked without a tag, the file's tag kept with the tree.
        await expect.poll(() => bridge.asks.length).toBeGreaterThan(0);
        expect(bridge.asks[0]).toEqual({ tag: '', status: 200 });
        await expect.poll(async () => (await link(page))?.treeEtag?.tag).toBe(tagOf(OLD));
        await expect(page.locator('#live-panel')).toContainText('Bolemír');
        const before = await cards(page);
        const asked = bridge.asks.length;

        await reopen(page);
        await expect.poll(() => bridge.asks.length).toBeGreaterThan(asked);
        expect(bridge.asks[asked]).toEqual({ tag: tagOf(OLD), status: 304 });
        await expect.poll(() => cards(page)).toEqual(before);
        expect((await link(page))?.head).toBe(OLD);
        expect((await link(page))?.treeEtag?.tag).toBe(tagOf(OLD));
        // The row about the couple names its person from the tree held: the file is not read for its families.
        await expect(page.locator('#live-panel')).toContainText('Bolemír');
        await page.waitForTimeout(500);
        expect(downloads(bridge)).toBe(1);
        // And once more.
        await reopen(page);
        await expect.poll(() => bridge.asks.filter(a => a.status === 304).length).toBe(2);
        expect(downloads(bridge)).toBe(1);
        await expect.poll(() => cards(page)).toEqual(before);
    });

    test('a new head: the tag asked with, the new file sent and loaded, its tag kept', async ({ page }) => {
        const bridge = await follow(page, { etag: true });
        await expect.poll(async () => (await link(page))?.treeEtag?.tag).toBe(tagOf(OLD));
        const asked = bridge.asks.length;
        bridge.head = NEW;
        await reopen(page);
        await expect(card(page, 'Zbyhněv')).toBeVisible();
        expect(bridge.asks[asked]).toEqual({ tag: tagOf(OLD), status: 200 });
        await expect.poll(async () => (await link(page))?.head).toBe(NEW);
        await expect.poll(async () => (await link(page))?.treeEtag?.tag).toBe(tagOf(NEW));
        expect(downloads(bridge)).toBe(2);
    });

    test('a file sent without a tag is never reused', async ({ page }) => {
        const bridge = await follow(page, { etag: true, sendsTag: false });
        expect((await link(page))?.treeEtag).toBeUndefined();
        await reopen(page);
        await expect.poll(() => downloads(bridge)).toBe(2);
        expect(bridge.asks.every(a => a.tag === '')).toBe(true);
    });

    test('without ged.etag no If-None-Match ever goes', async ({ page }) => {
        const bridge = await follow(page, { etag: false });
        await reopen(page);
        await expect.poll(() => downloads(bridge)).toBe(2);
        expect(bridge.asks.every(a => a.tag === '')).toBe(true);
        expect((await link(page))?.treeEtag).toBeUndefined();
    });
});
