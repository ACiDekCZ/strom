import { test, expect, Page } from '@playwright/test';

/**
 * "Retry with the agent" at an item of Awaiting action in the Research
 * overview (spec 089 §1–§3, §5–§8): the Now line says why it waits (in place
 * of the browser's note), the button through the bridge (no mark) with what
 * goes back — filled when the agent can do it now (the Deliver block's "Add
 * images" outlined then), outlined with the extension not connected (its link
 * after the Now line); among the actions of an item without the Deliver
 * block; a click writes `{do: "retry", expect}`, the toast says it and the
 * item goes; refusals in the row without "Try again"; the limit in place of
 * the button; an older bridge: nothing new; a phone: the Now line and where it
 * is done; the overview's own window: written by the main window. Invented
 * data only (the Hrotkovi of Lipník), a fake bridge, a fixed clock.
 */

const UUID = '3e8a1c5d-7b2f-4d6e-9a0c-5f1e2d3c4b5a';
const BRIDGE = 'http://127.0.0.1:5995/0f1e2d3c4b5a69788796a5b4c3d2e1f0';
const cors = { 'access-control-allow-origin': '*' };
const LINKS = ['send', 'excerpt', 'app', 'open', 'chat', 'task', 'review', 'research', 'live'];
const STORE = 'https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn';
const NOW = new Date('2026-11-24T14:30:00Z');
const RETRY = 'waiting.retry';

const GED = [
    '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 24 NOV 2026', `1 _STROM_TREE ${UUID}`, '1 CHAR UTF-8', '1 NOTE Hrotkovi z Lipníku',
    '0 @P0001@ INDI', '1 NAME Anna /Hrotková/', '1 SEX F', '1 BIRT', '2 DATE 1781', '1 REFN P0001',
    '0 TRLR',
].join('\n');

const ARCHIVE = { key: 'repo:R0412', kind: 'archive', url: 'https://www.mza.cz', name: 'Moravský zemský archiv v Brně' };

interface Reply { status: number; body?: Record<string, unknown>; abort?: boolean }
interface Bridge {
    waiting: Record<string, unknown>[];
    features: string[];
    replies: Reply[];
    writes: { path: string; body: Record<string, unknown> }[];
}

const at = new Date(NOW.getTime() - 2 * 3_600_000).toISOString();

function images(id: string, what: string, missing: number[], retry: Record<string, unknown> | null, order: number): Record<string, unknown> {
    return {
        id, what, kind: 'images', section: 'images', group: ARCHIVE, at, order, person: 'P0001', url: 'https://www.mza.cz/actapublica',
        inbox: { dir: `inbox/${id}`, have: 0, want: missing.length, missing, book: 'Matrika N 1781–1799', images: missing.join('–') },
        actions: ['images', 'answer', 'chat', 'folder'],
        ...(retry ? { retry } : {}),
    };
}

function newWaiting(): Record<string, unknown>[] {
    return [
        images('T0412', 'Křty Lipník 1781–1799, snímky 57–58', [57, 58], { why: 'held', host: 'www.mza.cz', images: 2, can: true }, 0),
        images('T0415', 'Oddaní Lipník 1800–1830, snímek 112', [112], { why: 'stopped', images: 1, can: true }, 1),
        images('T0419', 'Zemřelí Lipník 1784–1812, snímky 14–15', [14, 15], { why: 'no-extension', images: 2, can: true }, 2),
        images('T0421', 'Pozemková kniha Lipník, fol. 33', [33], { why: 'screen', screen: true, can: true }, 3),
        images('T0423', 'Křty Lipník 1800–1820, snímky 3–4', [3, 4], { why: 'held', host: 'www.mza.cz', images: 2, can: false, until: '2026-11-25T09:12:00Z' }, 4),
        {
            id: 'T0425', what: 'Ověřit zápis v kronice obce Lipník', kind: 'web', section: 'web', at, order: 5, person: 'P0001',
            group: { key: 'host:lipnik.example', name: 'lipnik.example', kind: 'web' }, url: 'https://lipnik.example/kronika',
            actions: ['answer', 'chat'], retry: { why: 'ready', can: true, again: { at: '2026-11-24T13:10:00Z' } },
        },
        {
            id: 'T0430', what: 'Dopis do farního úřadu Lipník – opis křtu 1781', kind: 'letter', section: 'letter', at, order: 6, person: 'P0001',
            group: ARCHIVE, actions: ['answer'],
        },
    ];
}

async function follow(page: Page, size: { width: number; height: number }, setup: (b: Bridge) => void = () => {}): Promise<Bridge> {
    await page.setViewportSize(size);
    await page.clock.setFixedTime(NOW);
    await page.context().addInitScript((links) => {
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: links, at: new Date().toISOString() }));
    }, LINKS);
    const bridge: Bridge = {
        waiting: newWaiting(), features: ['waiting.groups', 'waiting.answer', 'browser.state', RETRY], replies: [], writes: [],
    };
    setup(bridge);
    const status = () => ({
        tree: { id: UUID, name: 'Hrotkovi z Lipníku' }, head: 'h1', persons: 1, working: [], waiting: bridge.waiting, links: LINKS, queue: [],
        features: bridge.features, accepts: { media: { taskImages: true } },
        agent: { id: 'claude', name: 'Claude Code' },
        browser: { state: 'no-extension', url: STORE, archives: [{ host: 'www.mza.cz', title: 'Moravský zemský archiv v Brně', permitted: true }] },
    });
    const json = (s: number, body: unknown) => ({ status: s, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    // On the context: the overview's own window would be answered too (and its requests seen).
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
            const next = bridge.replies.shift();
            if (next?.abort) return route.abort('connectionrefused');
            if (next) return route.fulfill(json(next.status, next.body ?? {}));
            const i = bridge.waiting.findIndex(w => w.id === write[1]);
            if (i < 0) return route.fulfill(json(404, { error: 'not waiting', code: 'waiting.none' }));
            bridge.waiting.splice(i, 1);
            return route.fulfill(json(200, { task: write[1], head: '' }));
        }
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    await expect(page.locator('#live-panel')).toBeVisible();
    return bridge;
}

async function openOverview(page: Page) {
    await page.locator('#live-panel .live-panel-expand').click();
    const ov = page.locator('#research-overview');
    await expect(ov).toBeVisible();
    return ov;
}

/** Every place's band unfolded, then the item's detail open. */
async function openItem(page: Page, id: string, root = page) {
    const ov = root.locator('#research-overview');
    const folded = ov.locator('.research-overview__waiting-group[aria-expanded="false"]');
    while (await folded.count() > 0) await folded.first().click();
    const item = ov.locator(`.research-overview__waiting-item[data-id="${id}"]`);
    await item.locator('.research-overview__waiting-row').click();
    await expect(item.locator('.research-overview__waiting-detail')).toBeVisible();
    return item;
}

/**
 * The sentences of the rows' refusals drawn as an alert from now on. A refusal carries `role=alert` on its first
 * drawing only (a redraw of the overview, by the status the bridge sends meanwhile, draws it without one, so it is
 * not said twice): read on the element afterwards, the role is gone as soon as a status came in between.
 */
async function watchRefusalAlerts(page: Page): Promise<() => Promise<string[]>> {
    await page.evaluate(() => {
        const said: string[] = [];
        const seen = new WeakSet<Element>();
        (window as unknown as { __refusalAlerts: string[] }).__refusalAlerts = said;
        const sel = '.research-overview__waiting-note[role="alert"]';
        new MutationObserver((records) => {
            for (const r of records) for (const n of r.addedNodes) {
                if (!(n instanceof HTMLElement)) continue;
                // Each element once: a row moved within the list is inserted again, the same sentence.
                for (const e of [...(n.matches(sel) ? [n] : []), ...n.querySelectorAll<HTMLElement>(sel)]) {
                    if (seen.has(e)) continue;
                    seen.add(e);
                    said.push(e.textContent ?? '');
                }
            }
        }).observe(document.body, { childList: true, subtree: true });
    });
    return () => page.evaluate(() => (window as unknown as { __refusalAlerts: string[] }).__refusalAlerts);
}

const retryButton = (item: ReturnType<Page['locator']>) => item.locator('button[data-action="retry"]');
const imagesStep = (item: ReturnType<Page['locator']>) => item.locator('.research-overview__deliver-steps [data-action="images"]');

test.describe('Retry with the agent at an item (spec 089)', () => {
    test.use({ timezoneId: 'UTC' });

    test('held, stopped, read only: the Now line and the filled button under it, "Add images" outlined; no browser note', async ({ page }) => {
        await follow(page, { width: 1440, height: 900 });
        await openOverview(page);

        const held = await openItem(page, 'T0412');
        const box = held.locator('.research-overview__waiting-retry');
        const now = box.locator('p.research-overview__waiting-now');
        await expect(now).toHaveAttribute('role', 'note');
        await expect(now.locator('b')).toHaveText('Now:');
        await expect(now).toHaveText('Now: The agent\'s browser held back downloads from www.mza.cz. Once automatic downloads are allowed in the agent\'s browser profile, the agent saves them itself.');
        const btn = retryButton(box);
        await expect(btn).toHaveText('Retry with the agent · 2 images');
        await expect(btn).toHaveClass(/waiting-action--primary/);
        await expect(btn).toHaveAttribute('data-write', 'bridge');
        await expect(btn.locator('.waiting-retry-count')).toHaveText('· 2 images');
        await expect(btn.locator('.waiting-retry-count')).toHaveCSS('white-space', 'nowrap');
        await expect(btn.locator('.research-open-mark, .ai-badge')).toHaveCount(0);
        await expect(imagesStep(held)).toHaveClass(/waiting-action--secondary/);
        // One filled button in the item.
        await expect(held.locator('.waiting-action--primary')).toHaveCount(1);
        await expect(held.locator('.waiting-browser-note')).toHaveCount(0);
        // In its place: after the images' state, before the person · direction.
        expect(await held.evaluate((li) => {
            const r = li.querySelector('.research-overview__waiting-retry')!;
            const book = li.querySelector('.wait-book')!;
            const meta = li.querySelector('.research-overview__waiting-detail > .research-overview__waiting-meta')!;
            return !!(book.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(r.compareDocumentPosition(meta) & Node.DOCUMENT_POSITION_FOLLOWING);
        })).toBe(true);

        const stopped = await openItem(page, 'T0415');
        await expect(stopped.locator('.research-overview__waiting-now')).toHaveText('Now: Saving the images stopped; the agent\'s session ended midway.');
        await expect(retryButton(stopped)).toHaveText('Retry with the agent · 1 image');
        await expect(retryButton(stopped)).toHaveClass(/waiting-action--primary/);
        await expect(imagesStep(stopped)).toHaveClass(/waiting-action--secondary/);

        const screen = await openItem(page, 'T0421');
        await expect(screen.locator('.research-overview__waiting-now')).toContainText('the agent only reads them on screen');
        await expect(retryButton(screen)).toHaveText('Retry with the agent · read only');
        await expect(retryButton(screen)).toHaveClass(/waiting-action--primary/);
    });

    test('the extension not connected: outlined, the browser\'s sentence and its link; "Add images" stays the main one', async ({ page }) => {
        await follow(page, { width: 1440, height: 900 });
        await openOverview(page);
        const item = await openItem(page, 'T0419');
        const now = item.locator('.research-overview__waiting-now');
        await expect(now.locator('span')).toHaveText('Now: With the Claude in Chrome extension the agent would save the images itself. Once the extension is connected, the task can go back to the agent.');
        const ext = now.locator('a.browser-ext-link');
        await expect(ext).toHaveText('Claude in Chrome ↗');
        await expect(ext).toHaveAttribute('href', STORE);
        await expect(retryButton(item)).toHaveClass(/waiting-action--secondary/);
        await expect(retryButton(item)).toHaveText('Retry with the agent · 2 images');
        await expect(imagesStep(item)).toHaveClass(/waiting-action--primary/);
        await expect(item.locator('.waiting-browser-note')).toHaveCount(0);
    });

    test('without the Deliver block: Retry first among the actions, the Now line above them with when it went back last', async ({ page }) => {
        await follow(page, { width: 1440, height: 900 });
        await openOverview(page);
        const item = await openItem(page, 'T0425');
        await expect(item.locator('.research-overview__waiting-retry .research-overview__waiting-now'))
            .toHaveText('Now: The agent\'s browser is ready now; the agent saves the images itself – retried 1:10 PM, waiting again.');
        await expect(item.locator('.research-overview__waiting-retry button')).toHaveCount(0);
        const actions = item.locator('.research-overview__waiting-actions.waiting-actions').last();
        const first = actions.locator('.waiting-action').first();
        await expect(first).toHaveAttribute('data-action', 'retry');
        await expect(first).toHaveClass(/waiting-action--primary/);
        await expect(first).toHaveText('Retry with the agent');
        await expect(actions.locator('[data-action="answer"]')).toHaveClass(/waiting-action--secondary/);
    });

    test('the limit: no button, when it can go back again in its place; "Add images" filled', async ({ page }) => {
        await follow(page, { width: 1440, height: 900 });
        await openOverview(page);
        const item = await openItem(page, 'T0423');
        await expect(item.locator('.research-overview__waiting-now')).toBeVisible();
        await expect(item.locator('.research-overview__waiting-retry p.research-overview__waiting-hint'))
            .toHaveText('Can go back to the agent again tomorrow 9:12 AM – 3 attempts in 24 hours.');
        await expect(retryButton(item)).toHaveCount(0);
        await expect(imagesStep(item)).toHaveClass(/waiting-action--primary/);
    });

    test('a click: written with what the item said, "saving" in its row, the toast, the item gone', async ({ page }) => {
        const bridge = await follow(page, { width: 1440, height: 900 });
        await openOverview(page);
        const item = await openItem(page, 'T0412');
        // The answer comes late: the row says "saving" (no second write meanwhile).
        let release: () => void = () => {};
        const held = new Promise<void>(r => { release = r; });
        // By the path: the write carries the app's version in its query (?app=…).
        await page.context().route((url) => url.href.startsWith(`${BRIDGE}/waiting/T0412`) && url.pathname.endsWith('/waiting/T0412'), async (route) => {
            if (route.request().method() !== 'POST') return route.fallback();
            await held;
            return route.fallback();
        });
        await retryButton(item).click();
        await expect(item.locator('.research-overview__waiting-row')).toContainText('saving');
        release();
        await expect.poll(() => bridge.writes).toEqual([{ path: 'T0412', body: { do: 'retry', expect: at } }]);
        await expect(page.locator('.toast[data-kind="waiting-retried"]'))
            .toContainText('Returned to the agent – first in the queue; the agent takes it up at the next start.');
        await expect(item).toHaveCount(0);
        expect(bridge.writes).toHaveLength(1);
    });

    test('refused: the task changed, the research not answering, the limit — said in the row without "Try again"', async ({ page }) => {
        const bridge = await follow(page, { width: 1440, height: 900 });
        await openOverview(page);
        const item = await openItem(page, 'T0415');
        const note = item.locator('.research-overview__waiting-note');
        const alerts = await watchRefusalAlerts(page);

        bridge.replies.push({ status: 409, body: { error: 'changed', code: 'waiting.changed', at } });
        await retryButton(item).click();
        await expect(note).toHaveText('The task now waits for something else; not returned.');
        await expect.poll(alerts).toEqual(['The task now waits for something else; not returned.']);
        await expect(item).toHaveClass(/is-refused/);
        await expect(note.locator('[data-action="write-retry"]')).toHaveCount(0);
        await expect(retryButton(item)).toBeEnabled();

        bridge.replies.push({ abort: true });
        await retryButton(item).click();
        await expect(note).toHaveText('The research is not responding; nothing was returned.');
        await expect(note.locator('[data-action="write-retry"]')).toHaveCount(0);

        bridge.replies.push({ status: 409, body: { error: 'limit', code: 'retry.limit', until: '2026-11-25T09:12:00Z' } });
        await retryButton(item).click();
        await expect(item.locator('.research-overview__waiting-retry .research-overview__waiting-hint'))
            .toHaveText('Can go back to the agent again tomorrow 9:12 AM – 3 attempts in 24 hours.');
        await expect(retryButton(item)).toHaveCount(0);
        await expect(imagesStep(item)).toHaveClass(/waiting-action--primary/);
        expect(bridge.writes.map(w => w.body.do)).toEqual(['retry', 'retry', 'retry']);
        await expect(page.locator('.toast[data-kind="waiting-retried"]')).toHaveCount(0);
    });

    test('an older bridge (no waiting.retry): nothing new — no Now line, no button, "Add images" filled', async ({ page }) => {
        await follow(page, { width: 1440, height: 900 }, (b) => { b.features = b.features.filter(f => f !== RETRY); });
        await openOverview(page);
        for (const id of ['T0412', 'T0423']) {
            const item = await openItem(page, id);
            await expect(item.locator('.research-overview__waiting-now, .research-overview__waiting-retry, [data-action="retry"], .waiting-retry-count')).toHaveCount(0);
            await expect(imagesStep(item)).toHaveClass(/waiting-action--primary/);
        }
        const web = await openItem(page, 'T0425');
        await expect(web.locator('[data-action="retry"], .research-overview__waiting-now')).toHaveCount(0);
        await expect(web.locator('.waiting-action').first()).toHaveAttribute('data-action', 'answer');
    });
});

test.describe('Retry with the agent on a phone (spec 089 §8)', () => {
    test.use({ timezoneId: 'UTC' });

    test('390: the Now line and where it is done, no button; nothing spills sideways', async ({ page }) => {
        await follow(page, { width: 390, height: 844 });
        await page.locator('#live-panel .live-panel-toggle').click();
        const ov = page.locator('#research-overview');
        await expect(ov).toHaveClass(/research-overview--sheet/);
        for (const id of ['T0412', 'T0425']) {
            const item = await openItem(page, id);
            await expect(item.locator('.research-overview__waiting-now')).toBeVisible();
            await expect(item.locator('p.research-overview__muted.waiting-phone-note', { hasText: 'Returning to the agent is possible in the app on a computer.' })).toHaveCount(1);
            await expect(retryButton(item)).toHaveCount(0);
            const spill = await item.evaluate((o) => [o, ...o.querySelectorAll<HTMLElement>('*')]
                .filter(n => n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflowX !== 'hidden' && getComputedStyle(n).overflowX !== 'clip' && n.clientWidth > 0)
                .map(n => `${n.className} ${n.scrollWidth}/${n.clientWidth}`));
            expect(spill).toEqual([]);
        }
        // No extension's link on a phone.
        const noExt = await openItem(page, 'T0419');
        await expect(noExt.locator('.research-overview__waiting-now a')).toHaveCount(0);
    });
});

test.describe('Retry with the agent in the overview\'s own window (spec 089 §1.3)', () => {
    test('a click in the window is written by the main window: its toast there, the item gone in the window', async ({ page }) => {
        const bridge = await follow(page, { width: 1440, height: 900 });
        await page.locator('#view-window-btn').click();
        const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('#view-window-menu [data-view="overview"]').click()]);
        await popup.waitForLoadState('domcontentloaded');
        await expect(popup.locator('#research-overview.research-overview--window')).toBeVisible();
        const fromWindow: string[] = [];
        page.context().on('request', (req) => {
            if (req.url().startsWith(BRIDGE) && req.frame().page() === popup) fromWindow.push(req.url());
        });
        const item = await openItem(popup, 'T0412', popup);
        await expect(retryButton(item)).toHaveClass(/waiting-action--primary/);
        await retryButton(item).click();
        await expect.poll(() => bridge.writes).toEqual([{ path: 'T0412', body: { do: 'retry', expect: at } }]);
        await expect(item).toHaveCount(0);
        await expect(page.locator('.toast[data-kind="waiting-retried"]')).toHaveCount(1);
        expect(fromWindow).toEqual([]);
        await popup.close();
    });
});
