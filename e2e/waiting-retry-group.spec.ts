import { test, expect, Page, Locator } from '@playwright/test';

/**
 * "Retry all with the agent" in a place's band of Awaiting action in the
 * Research overview (spec 089 §2, §4, §5, §8): the button through the bridge
 * (no mark) with what goes back, counted of the whole place, and "· N only
 * …" for those held by the limit; a click asks in place (Return focused,
 * Cancel, Escape), Return writes `{do: "retry"}` for the place, the toast
 * says it and the items go; a refusal is a toast and the question closes; a
 * place with one item that can go back has no button; one reason of all its
 * items said once in the band (the items keep only their button); a phone
 * gets nothing new in the band; the overview's own window keeps its columns
 * when the question opens; German with a long place name fits at 1440, 1024
 * and 390, light and dark. Invented data only (the Hrotkovi of Lipník), a
 * fake bridge, a fixed clock.
 */

const UUID = '3e8a1c5d-7b2f-4d6e-9a0c-5f1e2d3c4b5a';
const BRIDGE = 'http://127.0.0.1:5996/1f1e2d3c4b5a69788796a5b4c3d2e1f0';
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

const MZA = { key: 'repo:R0412', kind: 'archive', url: 'https://www.mza.cz', name: 'Moravský zemský archiv v Brně' };
const PRE = { key: 'repo:R0501', kind: 'archive', url: 'https://digi.archives.cz', name: 'Státní okresní archiv Přerov' };
const LONG = 'Moravský zemský archiv v Brně, oddělení matrik a pozemkových knih';

interface Reply { status: number; body?: Record<string, unknown>; abort?: boolean }
interface Bridge {
    waiting: Record<string, unknown>[];
    features: string[];
    groupReplies: Reply[];
    writes: { path: string; body: Record<string, unknown> }[];
}

const at = new Date(NOW.getTime() - 2 * 3_600_000).toISOString();

function images(id: string, what: string, group: Record<string, unknown>, missing: number[], retry: Record<string, unknown> | null, order: number): Record<string, unknown> {
    return {
        id, what, kind: 'images', section: 'images', group, at, order, person: 'P0001', url: `${group.url}/actapublica`,
        inbox: { dir: `inbox/${id}`, have: 0, want: missing.length, missing, book: 'Matrika N 1781–1799', images: missing.join('–') },
        actions: ['images', 'answer', 'chat', 'folder'],
        ...(retry ? { retry } : {}),
    };
}

function newWaiting(mza: Record<string, unknown> = MZA): Record<string, unknown>[] {
    return [
        images('T0412', 'Křty Lipník 1781–1799, snímky 57–58', mza, [57, 58], { why: 'held', host: 'www.mza.cz', images: 2, can: true }, 0),
        images('T0415', 'Oddaní Lipník 1800–1830, snímek 112', mza, [112], { why: 'stopped', images: 1, can: true }, 1),
        images('T0419', 'Zemřelí Lipník 1784–1812, snímky 14–15', mza, [14, 15], { why: 'no-extension', images: 2, can: true }, 2),
        images('T0423', 'Křty Lipník 1800–1820, snímky 3–4', mza, [3, 4], { why: 'held', host: 'www.mza.cz', images: 2, can: false, until: '2026-11-25T09:12:00Z' }, 3),
        {
            id: 'T0430', what: 'Dopis do farního úřadu Lipník – opis křtu 1781', kind: 'letter', section: 'letter', at, order: 4, person: 'P0001',
            group: mza, actions: ['answer'],
        },
        images('T0441', 'Oddaní Lipník 1831–1860, snímky 41–42', PRE, [41, 42], { why: 'held', host: 'digi.archives.cz', images: 2, can: true }, 5),
        images('T0442', 'Zemřelí Lipník 1831–1860, snímek 7', PRE, [7], { why: 'held', host: 'digi.archives.cz', images: 1, can: true }, 6),
        {
            id: 'T0425', what: 'Ověřit zápis v kronice obce Lipník', kind: 'web', section: 'web', at, order: 7, person: 'P0001',
            group: { key: 'host:lipnik.example', name: 'lipnik.example', kind: 'web' }, url: 'https://lipnik.example/kronika',
            actions: ['answer', 'chat'], retry: { why: 'ready', can: true },
        },
    ];
}

interface Opts { size: { width: number; height: number }; lang?: string; dark?: boolean; setup?: (b: Bridge) => void }

async function follow(page: Page, opts: Opts): Promise<Bridge> {
    await page.setViewportSize(opts.size);
    if (opts.dark) await page.emulateMedia({ colorScheme: 'dark' });
    await page.clock.setFixedTime(NOW);
    await page.context().addInitScript((links) => {
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: links, at: new Date().toISOString() }));
    }, LINKS);
    const bridge: Bridge = {
        waiting: newWaiting(), features: ['waiting.groups', 'waiting.answer', 'browser.state', RETRY], groupReplies: [], writes: [],
    };
    opts.setup?.(bridge);
    const status = () => ({
        tree: { id: UUID, name: 'Hrotkovi z Lipníku' }, head: 'h1', persons: 1, working: [], waiting: bridge.waiting, links: LINKS, queue: [],
        features: bridge.features, accepts: { media: { taskImages: true } },
        agent: { id: 'claude', name: 'Claude Code' },
        browser: { state: 'no-extension', url: STORE, archives: [{ host: 'www.mza.cz', title: 'Moravský zemský archiv v Brně', permitted: true }] },
    });
    const json = (s: number, body: unknown) => ({ status: s, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    // On the context: the overview's own window would be answered too.
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
        const group = /\/group\/([^/]+)$/.exec(path);
        if (group && req.method() === 'POST') {
            const key = decodeURIComponent(group[1]);
            bridge.writes.push({ path: `group/${key}`, body: JSON.parse(req.postData() || '{}') as Record<string, unknown> });
            const next = bridge.groupReplies.shift();
            if (next?.abort) return route.abort('connectionrefused');
            if (next) return route.fulfill(json(next.status, next.body ?? {}));
            const retried = bridge.waiting.filter(w => (w.group as { key?: string } | undefined)?.key === key && (w.retry as { can?: boolean } | undefined)?.can)
                .map(w => w.id as string);
            bridge.waiting = bridge.waiting.filter(w => !retried.includes(w.id as string));
            return route.fulfill(json(200, { retried, group: key, head: '' }));
        }
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    await expect(page.locator('#live-panel')).toBeVisible();
    if (opts.lang) await page.evaluate(lang => window.Strom.UI.setLanguage(lang as never), opts.lang);
    return bridge;
}

async function openOverview(page: Page): Promise<Locator> {
    await page.locator('#live-panel .live-panel-expand').click();
    const ov = page.locator('#research-overview');
    await expect(ov).toBeVisible();
    return ov;
}

/** Every place's band unfolded. */
async function unfoldAll(root: Page): Promise<void> {
    const folded = root.locator('#research-overview .research-overview__waiting-group[aria-expanded="false"]');
    while (await folded.count() > 0) await folded.first().click();
}

/** Every band unfolded, then the item's detail open. */
async function openItem(root: Page, id: string): Promise<Locator> {
    await unfoldAll(root);
    const item = root.locator(`#research-overview .research-overview__waiting-item[data-id="${id}"]`);
    await item.locator('.research-overview__waiting-row').click();
    await expect(item.locator('.research-overview__waiting-detail')).toBeVisible();
    return item;
}

const band = (root: Page, name: string) => root.locator('#research-overview .research-overview__waiting-grouphead')
    .filter({ has: root.locator('.research-overview__waiting-group', { hasText: name }) });
const groupRetry = (b: Locator) => b.locator('button[data-action="group-retry"]');
const confirmBox = (b: Locator) => b.locator('.research-overview__retry-confirm');

test.describe('Retry all with the agent in a place\'s band (spec 089 §4, §5)', () => {
    test.use({ timezoneId: 'UTC' });

    test('the button counts the whole place (a filter does not change it), "· 1 only …" after it; none for a place with one; seen folded', async ({ page }) => {
        await follow(page, { size: { width: 1440, height: 900 } });
        await openOverview(page);
        const mza = band(page, MZA.name);
        const btn = groupRetry(mza);
        await expect(btn).toHaveText('Retry all with the agent (3 tasks, 5 images)');
        await expect(btn).toHaveAttribute('aria-label', 'Retry all with the agent · Moravský zemský archiv v Brně · 3 tasks, 5 images');
        await expect(btn).toHaveAttribute('data-write', 'bridge');
        await expect(btn.locator('.research-open-mark, .ai-badge')).toHaveCount(0);
        await expect(btn.locator('.waiting-retry-count')).toHaveCSS('white-space', 'nowrap');
        await expect(mza.locator('.research-overview__group-retry-later')).toHaveText('· 1 only tomorrow 9:12 AM');
        // A place with one item that can go back: no button.
        await expect(groupRetry(band(page, 'lipnik.example'))).toHaveCount(0);
        // A filter showing only the place's letter: still the whole place.
        const chip = (label: string) => page.locator('#research-overview .research-overview__waiting-filters .research-overview__filter', { hasText: label });
        await chip('Archives and offices').click();
        await expect(page.locator('#research-overview .research-overview__waiting-group', { hasText: MZA.name })).toContainText('1');
        await expect(band(page, PRE.name)).toHaveCount(0);
        await expect(btn).toHaveText('Retry all with the agent (3 tasks, 5 images)');
        await chip('All').click();
        await expect(band(page, PRE.name)).toHaveCount(1);
        // Folded, the button stays; its click never unfolds.
        const fold = mza.locator('.research-overview__waiting-group');
        if (await fold.getAttribute('aria-expanded') === 'true') await fold.click();
        await expect(fold).toHaveAttribute('aria-expanded', 'false');
        await expect(btn).toBeVisible();
        await btn.click();
        await expect(fold).toHaveAttribute('aria-expanded', 'false');
        await expect(confirmBox(mza)).toBeVisible();
    });

    test('a click asks in place: Return focused, Escape closes it (the overview stays), Cancel too', async ({ page }) => {
        const bridge = await follow(page, { size: { width: 1440, height: 900 } });
        const ov = await openOverview(page);
        const mza = band(page, MZA.name);
        await groupRetry(mza).click();
        const ask = confirmBox(mza);
        await expect(ask).toHaveAttribute('role', 'group');
        await expect(ask).toContainText('Return 3 tasks (5 images) to the agent? They go to the front of the queue.');
        await expect(groupRetry(mza)).toHaveCount(0);
        const yes = ask.locator('[data-action="group-retry-yes"]');
        await expect(yes).toHaveText('Return');
        await expect(yes).toHaveClass(/waiting-action--primary/);
        await expect(yes).toBeFocused();
        await expect(ask.locator('[data-action="group-retry-no"]')).toHaveClass(/waiting-action--link/);
        await page.keyboard.press('Escape');
        await expect(ask).toHaveCount(0);
        await expect(ov).toBeVisible();
        await expect(groupRetry(mza)).toBeFocused();
        // A click elsewhere (the band folded and drawn again) leaves it open; Cancel closes it.
        await groupRetry(mza).click();
        await mza.locator('.research-overview__waiting-group').click();
        await expect(confirmBox(mza)).toBeVisible();
        await confirmBox(mza).locator('[data-action="group-retry-no"]').click();
        await expect(confirmBox(mza)).toHaveCount(0);
        expect(bridge.writes).toEqual([]);
    });

    test('Return writes the place: "saving" meanwhile, the toast, its items gone; the item held by the limit stays', async ({ page }) => {
        const bridge = await follow(page, { size: { width: 1440, height: 900 } });
        await openOverview(page);
        await unfoldAll(page);
        const mza = band(page, MZA.name);
        let release: () => void = () => {};
        const held = new Promise<void>(r => { release = r; });
        await page.context().route(`${BRIDGE}/group/**`, async (route) => {
            if (route.request().method() !== 'POST') return route.fallback();
            await held;
            return route.fallback();
        });
        await groupRetry(mza).click();
        await confirmBox(mza).locator('[data-action="group-retry-yes"]').click();
        await expect(confirmBox(mza).locator('[data-action="group-retry-yes"]')).toBeDisabled();
        await expect(confirmBox(mza)).toContainText('saving');
        await expect(page.locator('#research-overview .research-overview__waiting-item[data-id="T0412"] .research-overview__waiting-row')).toContainText('saving');
        release();
        await expect.poll(() => bridge.writes).toEqual([{ path: `group/${MZA.key}`, body: { do: 'retry' } }]);
        await expect(page.locator('.toast[data-kind="waiting-retried"]')).toContainText('Returned to the agent: 3 tasks, first in the queue.');
        for (const id of ['T0412', 'T0415', 'T0419']) await expect(page.locator(`#research-overview .research-overview__waiting-item[data-id="${id}"]`)).toHaveCount(0);
        await expect(page.locator('#research-overview .research-overview__waiting-item[data-id="T0423"]')).toHaveCount(1);
        await expect(confirmBox(mza)).toHaveCount(0);
        // One left that can go back: no button any more.
        await expect(groupRetry(mza)).toHaveCount(0);
    });

    test('refused: the toast says why, the question closes, the button is back and the items stay', async ({ page }) => {
        const bridge = await follow(page, { size: { width: 1440, height: 900 } });
        await openOverview(page);
        const mza = band(page, MZA.name);
        bridge.groupReplies.push({ abort: true });
        await groupRetry(mza).click();
        await confirmBox(mza).locator('[data-action="group-retry-yes"]').click();
        await expect(page.locator('.toast[data-kind="waiting-failed"]')).toContainText('Nothing was returned: the research is not responding; nothing was returned');
        await expect(confirmBox(mza)).toHaveCount(0);
        await expect(groupRetry(mza)).toBeVisible();
        await expect(groupRetry(mza)).toBeFocused();
        await unfoldAll(page);
        await expect(page.locator('#research-overview .research-overview__waiting-item[data-id="T0412"]')).toHaveCount(1);
        await expect(page.locator('.toast[data-kind="waiting-retried"]')).toHaveCount(0);
    });

    test('one reason of the place\'s items: its Now line once in the band, the items only their button', async ({ page }) => {
        await follow(page, { size: { width: 1440, height: 900 } });
        await openOverview(page);
        const pre = band(page, PRE.name);
        const now = pre.locator(':scope > .research-overview__waiting-now');
        await expect(now).toHaveText('Now: The agent\'s browser held back downloads from digi.archives.cz. Once automatic downloads are allowed in the agent\'s browser profile, the agent saves them itself.');
        await expect(groupRetry(pre)).toHaveText('Retry all with the agent (2 tasks, 3 images)');
        const item = await openItem(page, 'T0441');
        await expect(item.locator('.research-overview__waiting-now')).toHaveCount(0);
        await expect(item.locator('.research-overview__waiting-retry button[data-action="retry"]')).toHaveText('Retry with the agent · 2 images');
        // Reasons that differ: no line in the band, each item says its own.
        const mza = band(page, MZA.name);
        await expect(mza.locator(':scope > .research-overview__waiting-now')).toHaveCount(0);
        const own = await openItem(page, 'T0412');
        await expect(own.locator('.research-overview__waiting-now')).toHaveCount(1);
    });

    test('an older bridge (no waiting.retry): no button, no Now line in the bands', async ({ page }) => {
        await follow(page, { size: { width: 1440, height: 900 }, setup: (b) => { b.features = b.features.filter(f => f !== RETRY); } });
        await openOverview(page);
        await expect(page.locator('#research-overview [data-action="group-retry"], #research-overview .research-overview__waiting-grouphead > .research-overview__waiting-now')).toHaveCount(0);
    });
});

test.describe('Retry all with the agent on a phone (spec 089 §8)', () => {
    test.use({ timezoneId: 'UTC' });

    test('390: nothing new in the band; each item says its own Now line', async ({ page }) => {
        await follow(page, { size: { width: 390, height: 844 } });
        await page.locator('#live-panel .live-panel-toggle').click();
        await expect(page.locator('#research-overview')).toHaveClass(/research-overview--sheet/);
        await unfoldAll(page);
        await expect(page.locator('#research-overview [data-action="group-retry"], #research-overview .research-overview__retry-confirm')).toHaveCount(0);
        await expect(page.locator('#research-overview .research-overview__waiting-grouphead > .research-overview__waiting-now')).toHaveCount(0);
        const item = await openItem(page, 'T0441');
        await expect(item.locator('.research-overview__waiting-now')).toHaveCount(1);
    });
});

test.describe('Retry all with the agent in the overview\'s own window (spec 089 §4, §8)', () => {
    test.use({ timezoneId: 'UTC' });

    test('the question opens without moving a section to another column; Return is written by the main window', async ({ page }) => {
        const bridge = await follow(page, { size: { width: 1440, height: 900 } });
        await page.locator('#view-window-btn').click();
        const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('#view-window-menu [data-view="overview"]').click()]);
        await popup.waitForLoadState('domcontentloaded');
        await popup.setViewportSize({ width: 1440, height: 600 });
        await expect(popup.locator('#research-overview.research-overview--window')).toHaveClass(/\bis-cols\b/);
        const fromWindow: string[] = [];
        page.context().on('request', (req) => {
            if (req.url().startsWith(BRIDGE) && req.frame().page() === popup) fromWindow.push(req.url());
        });
        const layout = () => popup.locator('#research-overview').evaluate((root) => {
            const body = root.querySelector('.research-overview__body')!;
            const cols = [...body.querySelectorAll(':scope > .research-overview__col')];
            return cols.map(c => [...c.querySelectorAll('.live-section__title')].map(t => ({
                title: (t.textContent ?? '').split(' ·')[0].trim(), left: Math.round(t.getBoundingClientRect().left),
            })));
        });
        const before = await layout();
        expect(before.length).toBeGreaterThan(1);
        const mza = band(popup, MZA.name);
        await groupRetry(mza).click();
        await expect(confirmBox(mza)).toBeVisible();
        expect(await layout()).toEqual(before);
        await confirmBox(mza).locator('[data-action="group-retry-yes"]').click();
        await expect.poll(() => bridge.writes).toEqual([{ path: `group/${MZA.key}`, body: { do: 'retry' } }]);
        await expect(page.locator('.toast[data-kind="waiting-retried"]')).toHaveCount(1);
        await expect(confirmBox(mza)).toHaveCount(0);
        await unfoldAll(popup);
        await expect(popup.locator('#research-overview .research-overview__waiting-item[data-id="T0412"]')).toHaveCount(0);
        expect(fromWindow).toEqual([]);
        await popup.close();
    });
});

test.describe('Retry all with the agent in German with a long place name (spec 089 §8)', () => {
    test.use({ timezoneId: 'UTC' });

    for (const [width, dark] of [[1440, false], [1440, true], [1024, false], [1024, true], [390, false], [390, true]] as const) {
        test(`${width}${dark ? ', dark' : ''}: the band, its button and the question fit`, async ({ page }) => {
            await follow(page, {
                size: { width, height: width < 641 ? 844 : 900 }, lang: 'de', dark,
                setup: (b) => { b.waiting = newWaiting({ ...MZA, name: LONG }); },
            });
            if (width < 641) await page.locator('#live-panel .live-panel-toggle').click();
            else await page.locator('#live-panel .live-panel-expand').click();
            await expect(page.locator('#research-overview')).toBeVisible();
            await unfoldAll(page);
            const mza = band(page, LONG);
            await expect(mza).toHaveCount(1);
            if (width >= 641) {
                await expect(groupRetry(mza)).toHaveText('Alle erneut über den Agenten versuchen (3 Aufgaben, 5 Bilder)');
                await groupRetry(band(page, PRE.name)).click();
                await expect(confirmBox(band(page, PRE.name))).toBeVisible();
            } else {
                await expect(groupRetry(mza)).toHaveCount(0);
            }
            await openItem(page, 'T0412');
            const spill = await page.locator('#research-overview').evaluate((ov) => {
                const right = ov.getBoundingClientRect().right;
                const out: string[] = [];
                for (const n of [ov, ...ov.querySelectorAll<HTMLElement>('.research-overview__waiting-grouphead, .research-overview__waiting-grouphead *, .research-overview__waiting-detail, .research-overview__waiting-detail *')]) {
                    if (n.getClientRects().length === 0) continue;
                    const cs = getComputedStyle(n);
                    const clipped = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
                    if (!clipped && n.clientWidth > 0 && n.scrollWidth > n.clientWidth + 1) out.push(`scroll ${n.className} ${n.scrollWidth}/${n.clientWidth}`);
                    if (n.getBoundingClientRect().right > right + 1) out.push(`right ${n.className}`);
                }
                // The buttons and the question in a band never overlap each other.
                for (const box of ov.querySelectorAll('.research-overview__waiting-groupactions, .research-overview__retry-confirm')) {
                    const kids = [...box.children].filter(k => k.getClientRects().length > 0).map(k => k.getBoundingClientRect());
                    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
                        const a = kids[i], b = kids[j];
                        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push(`overlap ${box.className} ${i}/${j}`);
                    }
                }
                out.push(...(document.documentElement.scrollWidth > document.documentElement.clientWidth ? ['doc'] : []));
                return out;
            });
            expect(spill).toEqual([]);
        });
    }
});
