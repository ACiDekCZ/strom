import { test, expect, Page, Locator } from '@playwright/test';
import { openApp } from './helpers.js';
import { openResearch, fakeBridge, poll, links, UUID as RESEARCH_UUID } from './research-bridge.js';

/**
 * The agent's browser (spec 048 §11): `/status.browser` with `browser.state`
 * in `features` says the "Browser" row beside the agent (the ready dialog,
 * Research for this tree, kept up with each status) and the note at items
 * waiting for images from an archive only the agent's browser reaches (once
 * in a group's heading, else in the item's detail, one line in the small
 * panel's dialog). A phone: no links. An older bridge, an archive, a research
 * waiting for its agent: nothing. Invented data only.
 */

const STORE = 'https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn';
const FEATURE = 'browser.state';
const LONG = 'Zemský archiv ve Smyšlenově nad Lužnicí (Digitální badatelna)';
const archives5 = ['a', 'b', 'c', 'd', 'e'].map(x => ({ host: `${x}.archiv.example`, title: `Archiv ${x.toUpperCase()} ve Smyšlenově`, permitted: false }));

/** Every element of `host` whose content is wider than its box (none expected). */
const spills = (host: Locator) => host.evaluate((o) => [o, ...o.querySelectorAll<HTMLElement>('*')]
    .filter(n => n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflowX !== 'hidden' && getComputedStyle(n).overflowX !== 'clip' && n.clientWidth > 0)
    .map(n => `${n.className} ${n.scrollWidth}/${n.clientWidth}`));

// ==================== Research for this tree ====================

test.describe('Research for this tree: the agent box', () => {
    const settings = (page: Page) => page.locator('#research-tree-settings-modal');
    const box = (page: Page) => settings(page).locator('dl.research-tree-agent');
    const browserDd = (page: Page) => box(page).locator('dd[data-row="browser"]');
    async function open(page: Page): Promise<void> {
        await page.evaluate(() => window.Strom.UI.researchActionTreeSettings());
        await expect(box(page)).toBeVisible();
    }

    test('an older bridge: the agent alone; ready: the dot and the sentence; kept up with each status, lit and said', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openResearch(page);
        const bridge = await fakeBridge(page, { links: ['send', 'open', 'live', 'app', 'setup', 'archive'], statusExtra: {
            agent: { id: 'claude', name: 'Claude Code' }, browser: { state: 'ready', archives: [] },
        } });
        await poll(page);
        await open(page);
        // No `browser.state` in the features: the agent only.
        await expect(box(page).locator('dt')).toHaveText(['Agent']);
        await expect(box(page).locator('dd[data-row="agent"]')).toHaveText('Claude Code · work is confirmed in the research');
        // It sits at the top of the content, above the transcripts.
        const order = await settings(page).evaluate((m) => {
            const dl = m.querySelector('dl.research-tree-agent')!;
            const fs = m.querySelector('fieldset.research-transcripts')!;
            return !!(dl.compareDocumentPosition(fs) & Node.DOCUMENT_POSITION_FOLLOWING);
        });
        expect(order).toBe(true);

        bridge.features = [FEATURE];
        bridge.statusExtra = { agent: { id: 'claude', name: 'Claude Code' }, browser: { state: 'ready', archives: [{ host: 'a.archiv.example', title: 'Archiv A', permitted: true }] } };
        await poll(page);
        await expect(box(page).locator('dt')).toHaveText(['Agent', 'Browser']);
        await expect(browserDd(page).locator('.browser-text')).toHaveText('Claude in Chrome connected – the agent also downloads from browser-only archives.');
        await expect(browserDd(page).locator('.browser-dot')).toHaveClass(/is-on/);
        await expect(browserDd(page).locator('.browser-dot')).toHaveAttribute('aria-hidden', 'true');
        await expect(browserDd(page).locator('a, button')).toHaveCount(0);
        // The row came while the dialog was open: lit, and said.
        await expect(settings(page).locator('.browser-live')).toHaveText('Browser: Claude in Chrome connected – the agent also downloads from browser-only archives.');

        // Five archives without permission: three by name with "Permission…", the rest counted with their names in its title.
        bridge.statusExtra = { agent: { id: 'claude', name: 'Claude Code' }, browser: { state: 'ready', archives: [{ host: 'z.archiv.example', title: 'Archiv Z', permitted: true }, ...archives5] } };
        await poll(page);
        await expect(browserDd(page).locator('.browser-text')).toHaveText('Claude in Chrome connected – the agent also downloads from browser-only archives, with the archive’s permission.');
        await expect(browserDd(page)).toHaveClass(/is-changed/);
        await expect(browserDd(page).locator('.browser-nopermit-label')).toHaveText('No permission yet:');
        await expect(browserDd(page).locator('.browser-archive')).toHaveText(['Archiv A ve Smyšlenově', 'Archiv B ve Smyšlenově', 'Archiv C ve Smyšlenově']);
        await expect(browserDd(page).locator('.browser-archive').first()).toHaveAttribute('title', 'Archiv A ve Smyšlenově · a.archiv.example');
        const permits = browserDd(page).locator('button.browser-permit');
        await expect(permits).toHaveCount(3);
        await expect(permits.first()).toContainText('Permission…');
        await expect(permits.first().locator('.research-open-mark')).toHaveCount(1);
        await expect(permits.first().locator('.research-ai-badge')).toHaveCount(0);
        const more = browserDd(page).locator('.browser-more');
        await expect(more).toHaveText('and 2 more');
        await expect(more).toHaveAttribute('title', 'Archiv D ve Smyšlenově, Archiv E ve Smyšlenově');
        expect(await more.evaluate(n => n.tagName)).toBe('SPAN');
        await permits.nth(1).click();
        expect(await links(page)).toEqual([expect.stringMatching(new RegExp(`^strom-research://archive\\?tree=${RESEARCH_UUID}&host=b\\.archiv\\.example$`))]);
        // Never the link without a host.
        expect((await links(page)).every(l => /[?&]host=/.test(l))).toBe(true);
    });

    test('no extension: the store page in a new window; another agent: named; a research waiting for its agent: no row', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openResearch(page);
        const one = [{ host: 'a.archiv.example', title: 'Archiv A', permitted: false }];
        const bridge = await fakeBridge(page, { features: [FEATURE], statusExtra: {
            agent: { id: 'claude', name: 'Claude Code' }, browser: { state: 'no-extension', url: STORE, archives: one },
        } });
        await poll(page);
        await open(page);
        await expect(browserDd(page).locator('.browser-text')).toHaveText('The Claude in Chrome extension is missing – images from browser-only archives are saved by hand.');
        await expect(browserDd(page).locator('.browser-dot')).not.toHaveClass(/is-on/);
        const ext = browserDd(page).locator('a.browser-ext-link');
        await expect(ext).toHaveText('Claude in Chrome ↗');
        await expect(ext).toHaveAttribute('href', STORE);
        await expect(ext).toHaveAttribute('target', '_blank');
        await expect(ext).toHaveAttribute('rel', 'noopener');

        // A store page elsewhere is not followed.
        bridge.statusExtra = { agent: { id: 'claude', name: 'Claude Code' }, browser: { state: 'no-extension', url: 'https://evil.example/ext', archives: one } };
        await poll(page);
        await expect(browserDd(page).locator('a')).toHaveCount(0);

        // An empty list: no row.
        bridge.statusExtra = { agent: { id: 'claude', name: 'Claude Code' }, browser: { state: 'no-extension', url: STORE, archives: [] } };
        await poll(page);
        await expect(box(page).locator('dt')).toHaveText(['Agent']);

        // Another agent, its long name shortened (whole in the title).
        const name = 'OpenCode (qwen2.5-coder-32b, local on the second computer)';
        bridge.statusExtra = { agent: { id: 'opencode', name }, browser: { state: 'agent-without-browser', archives: one } };
        await poll(page);
        const agentDd = box(page).locator('dd[data-row="agent"]');
        await expect(agentDd).toHaveAttribute('title', name);
        await expect(agentDd).toContainText('…');
        await expect(browserDd(page).locator('.browser-text')).toContainText('– strom does not watch this agent’s browser; images from browser-only archives are saved by hand.');
        await expect(browserDd(page).locator('.browser-text')).toHaveAttribute('title', new RegExp(name.replace(/[()]/g, '\\$&')));
        await page.evaluate(() => window.Strom.UI.closeResearchTreeSettings());

        // A research waiting for its agent: the agent row says so, no browser.
        bridge.features = [FEATURE, 'tree.state'];
        bridge.statusExtra = { tree: { id: RESEARCH_UUID, name: 'Novákovi', state: 'waiting' }, browser: { state: 'agent-without-browser', archives: one } };
        await poll(page);
        await open(page);
        await expect(box(page).locator('dt')).toHaveText(['Agent']);
        await expect(box(page).locator('dd[data-row="agent"]')).toHaveText('None on this computer yet. Once an AI agent is installed, the research goes on by itself.');
    });
});

// ==================== "The research is ready" ====================

const READY_BRIDGE = 'http://127.0.0.1:5987/0123456789abcdef0123456789abcdef';
const READY_UUID = '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77';
const cors = { 'access-control-allow-origin': '*' };

async function showReady(page: Page, extra: Record<string, unknown>): Promise<Locator> {
    await page.route(`${READY_BRIDGE}/**`, (route) => new URL(route.request().url()).pathname.endsWith('/status')
        ? route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' },
            body: JSON.stringify({ tree: { id: READY_UUID, name: 'Novákovi' }, path: '/Users/jan/Strom/Novakovi', accepts: { mode: 'research', sync: { auto: 'write' } }, ...extra }) })
        : route.fulfill({ status: 404, headers: cors, body: '' }));
    await page.evaluate(({ b, id }) => window.Strom.UI.showResearchReady(b, id, 'Novákovi', true), { b: READY_BRIDGE, id: READY_UUID });
    const ready = page.locator('#research-ready-modal');
    await expect(ready).toBeVisible();
    return ready;
}

test.describe('"The research is ready": the Browser row', () => {
    test('right after the Agent row; none from an older bridge, for an archive, for an empty list', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openApp(page);
        let ready = await showReady(page, { features: [FEATURE], agent: { id: 'claude', name: 'Claude Code' }, browser: { state: 'ready', archives: [] } });
        const dts = ready.locator('dl.install-ready-rows > dt');
        await expect(dts).toHaveText(['Where', 'Agent', 'Browser', 'Originals']);
        await expect(ready.locator('dd.install-ready-browser .browser-text')).toHaveText('Claude in Chrome connected.');
        await page.evaluate(() => window.Strom.UI.closeResearchReady());

        ready = await showReady(page, { agent: { id: 'claude', name: 'Claude Code' }, browser: { state: 'ready', archives: [] } });
        await expect(ready.locator('dd.install-ready-browser')).toHaveCount(0);
        await page.evaluate(() => window.Strom.UI.closeResearchReady());

        ready = await showReady(page, { features: [FEATURE, 'tree.state'], tree: { id: READY_UUID, name: 'Novákovi', state: 'archive' }, browser: { state: 'ready', archives: [] } });
        await expect(ready.locator('dd.install-ready-browser')).toHaveCount(0);
        await page.evaluate(() => window.Strom.UI.closeResearchReady());

        ready = await showReady(page, { features: [FEATURE], agent: { id: 'claude', name: 'Claude Code' }, browser: { state: 'agent-without-browser', archives: [] } });
        await expect(ready.locator('dd.install-ready-browser')).toHaveCount(0);
    });
});

test.describe('"The research is ready" on a phone in German', () => {
    test.use({ locale: 'de-DE' });
    test('no links, the hint instead; nothing spills at 390', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await openApp(page);
        const ready = await showReady(page, { features: [FEATURE], agent: { id: 'claude', name: 'Claude Code' },
            browser: { state: 'ready', archives: [{ host: 'digi.archiv-smyslenov.example', title: LONG, permitted: false }, ...archives5] } });
        const dd = ready.locator('dd.install-ready-browser');
        await expect(dd.locator('.browser-text')).toHaveText('Claude in Chrome verbunden – der Agent lädt auch aus Archiven, die nur im Browser zugänglich sind, mit Erlaubnis des Archivs.');
        await expect(dd.locator('.browser-nopermit-label')).toHaveText('Ohne Erlaubnis:');
        await expect(dd.locator('.browser-more')).toHaveText('und 3 weitere');
        await expect(dd.locator('a, button')).toHaveCount(0);
        await expect(dd.locator('.browser-hint')).toHaveText('Erweiterung und Erlaubnisse werden am Computer eingerichtet.');
        expect(await spills(ready)).toEqual([]);
    });
});

// ==================== Waiting for images: the note ====================

const UUID = '6b1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
const BRIDGE = 'http://127.0.0.1:5986/fedcba9876543210fedcba9876543210';
const LINKS = ['send', 'excerpt', 'app', 'open', 'chat', 'task', 'review', 'research', 'live', 'archive'];
const GED = [
    '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 2 NOV 2026', `1 _STROM_TREE ${UUID}`, '1 CHAR UTF-8', '1 NOTE Hruskovi',
    '0 @P0001@ INDI', '1 NAME Bedřich /Hruška/', '1 SEX M', '1 BIRT', '2 DATE 1858', '1 REFN P0001',
    '0 TRLR',
].join('\n');
const ARCHIVE = { key: 'repo:R0077', kind: 'archive', name: LONG.replace(/ \(.*$/, '') };

interface Bridge { waiting: Record<string, unknown>[]; features: string[]; browser?: Record<string, unknown> }

function waiting(): Record<string, unknown>[] {
    const at = new Date(Date.now() - 2 * 86_400_000).toISOString();
    return [
        {
            id: 'T0001', what: 'Uložit snímky 57–58 oddací matriky Dolní Smyšlenov', kind: 'images', section: 'images', group: ARCHIVE, at, order: 0,
            person: 'P0001', url: 'https://digi.archiv-smyslenov.example/kniha/31',
            inbox: { dir: 'inbox/T0001', have: 1, want: 2, missing: [58], book: 'Oddací matrika N 1858–1871', images: '57–58' },
            actions: ['images', 'answer', 'chat', 'folder'],
        },
        {
            id: 'T0002', what: 'Uložit snímky 112–113 křestní matriky Smyšlenov', kind: 'images', section: 'images', group: ARCHIVE, at, order: 1,
            inbox: { dir: 'inbox/T0002', have: 0, want: 2, missing: [112, 113], book: 'Křestní matrika N 1849–1866', images: '112–113' },
            actions: ['images', 'answer', 'chat', 'folder'],
        },
    ];
}

async function follow(page: Page, size: { width: number; height: number }, setup: (b: Bridge) => void = () => {}): Promise<Bridge> {
    await page.setViewportSize(size);
    await page.addInitScript((links) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: links, at: new Date().toISOString() }));
    }, LINKS);
    const bridge: Bridge = { waiting: waiting(), features: ['waiting.groups', 'waiting.answer', FEATURE] };
    setup(bridge);
    const status = () => ({
        tree: { id: UUID, name: 'Hruskovi' }, head: 'h1', persons: 1, working: [], waiting: bridge.waiting, links: LINKS,
        queue: [], features: bridge.features, accepts: { media: { taskImages: true } }, agent: { id: 'claude', name: 'Claude Code' },
        ...(bridge.browser ? { browser: bridge.browser } : {}),
    });
    const json = (s: number, body: unknown) => ({ status: s, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    await page.route(`${BRIDGE}/**`, async (route) => {
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
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    await page.evaluate(() => {
        const ui = window.Strom.UI as unknown as { handOverResearchLink: (u: string) => void; __links: string[] };
        ui.__links = [];
        ui.handOverResearchLink = (u: string) => { ui.__links.push(u); };
    });
    return bridge;
}

async function openOverview(page: Page): Promise<Locator> {
    await page.locator('#live-panel .live-panel-expand').click();
    const ov = page.locator('#research-overview');
    await expect(ov).toBeVisible();
    return ov;
}

const groupHead = (ov: Locator) => ov.locator('.research-overview__waiting-grouphead').filter({ hasText: 'Zemský archiv' });

async function openItem(ov: Locator, id: string): Promise<Locator> {
    const head = groupHead(ov).locator('.research-overview__waiting-group');
    if (await head.count() > 0 && await head.getAttribute('aria-expanded') === 'false') await head.click();
    const item = ov.locator(`.research-overview__waiting-item[data-id="${id}"]`);
    await item.locator('.research-overview__waiting-row').click();
    await expect(item.locator('.research-overview__waiting-detail')).toBeVisible();
    return item;
}

const unpermitted = { state: 'ready', archives: [{ host: 'digi.archiv-smyslenov.example', title: LONG, permitted: false }] };

test.describe('Waiting for images from a browser-only archive', () => {
    test('two items of one archive: once in the group\'s heading with Permission…; not again in the detail', async ({ page }) => {
        await follow(page, { width: 1440, height: 900 }, (b) => { b.browser = unpermitted; });
        const ov = await openOverview(page);
        const note = groupHead(ov).locator('.waiting-browser-note');
        await expect(note).toHaveCount(1);
        await expect(note.locator('.waiting-browser-note__text')).toHaveText(`With the permission “through the browser” for ${ARCHIVE.name} the agent saves the images itself.`);
        const permit = note.locator('button.browser-permit');
        await expect(permit).toContainText('Permission…');
        await expect(permit.locator('.research-open-mark')).toHaveCount(1);
        const item = await openItem(ov, 'T0002');
        await expect(item.locator('.waiting-browser-note')).toHaveCount(0);
        await permit.click();
        expect(await links(page)).toEqual([`strom-research://archive?tree=${UUID}&host=digi.archiv-smyslenov.example`]);
    });

    test('one item: in its detail under the book, above the actions; gone while Add images is open; permitted: nothing', async ({ page }) => {
        const bridge = await follow(page, { width: 1440, height: 900 }, (b) => {
            b.waiting = b.waiting.slice(0, 1);
            b.browser = { state: 'no-extension', url: STORE, archives: unpermitted.archives };
        });
        const ov = await openOverview(page);
        // Its place's heading (open, a lone item's) says no browser note: the item's detail does.
        await expect(groupHead(ov)).toHaveCount(1);
        await expect(groupHead(ov).locator('.research-overview__waiting-group')).toHaveAttribute('aria-expanded', 'true');
        await expect(groupHead(ov).locator('.waiting-browser-note')).toHaveCount(0);
        const item = await openItem(ov, 'T0001');
        const note = item.locator('.waiting-browser-note');
        await expect(note.locator('.waiting-browser-note__text')).toHaveText('With the Claude in Chrome extension the agent would save the images itself.');
        await expect(note.locator('a.browser-ext-link')).toHaveAttribute('href', STORE);
        const order = await item.evaluate((li) => {
            const book = li.querySelector('.wait-book, .wait-book__state')!;
            const n = li.querySelector('.waiting-browser-note')!;
            const actions = li.querySelector('.waiting-actions')!;
            return [!!(book.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING), !!(n.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING)];
        });
        expect(order).toEqual([true, true]);
        await item.locator('.waiting-actions [data-action="images"]').click();
        await expect(item.locator('.waiting-upload')).toBeVisible();
        await expect(note).toHaveCount(0);

        // Permitted: no note (the status comes again).
        bridge.browser = { state: 'ready', archives: [{ ...unpermitted.archives[0], permitted: true }] };
        await page.evaluate(() => window.Strom.UI.pollResearchBridge());
        await page.keyboard.press('Escape');
        await expect(ov.locator('.waiting-browser-note')).toHaveCount(0);
    });

    test('an agent without a browser: the note without a link; an older bridge: nothing', async ({ page }) => {
        await follow(page, { width: 1440, height: 900 }, (b) => {
            b.waiting = b.waiting.slice(0, 1);
            b.browser = { state: 'agent-without-browser', archives: unpermitted.archives };
        });
        const ov = await openOverview(page);
        const item = await openItem(ov, 'T0001');
        await expect(item.locator('.waiting-browser-note')).toHaveText('With Claude Code and the Claude in Chrome extension the agent would save the images itself.');
        await expect(item.locator('.waiting-browser-note a, .waiting-browser-note button')).toHaveCount(0);
    });

    test('an older bridge (no browser.state): no note anywhere', async ({ page }) => {
        await follow(page, { width: 1440, height: 900 }, (b) => {
            b.features = ['waiting.groups', 'waiting.answer'];
            b.browser = unpermitted;
        });
        const ov = await openOverview(page);
        await openItem(ov, 'T0001');
        await expect(page.locator('.waiting-browser-note')).toHaveCount(0);
    });

    test('the small panel: not in its rows; one line in the Add images dialog', async ({ page }) => {
        await follow(page, { width: 1440, height: 900 }, (b) => { b.browser = unpermitted; });
        const panel = page.locator('#live-panel');
        const row = panel.locator('.live-waiting-row').filter({ hasText: '57–58' });
        await expect(row).toBeVisible();
        await expect(panel.locator('.waiting-browser-note')).toHaveCount(0);
        await row.locator('.waiting-panel-action').click();
        const dialog = page.locator('.waiting-dialog');
        await expect(dialog).toBeVisible();
        const note = dialog.locator('.waiting-browser-note');
        await expect(note).toHaveCount(1);
        await expect(note.locator('.waiting-browser-note__text')).toContainText(ARCHIVE.name);
        await expect(note.locator('button.browser-permit')).toHaveCount(1);
    });
});

test.describe('Waiting for images on a phone in German', () => {
    test.use({ locale: 'de-DE' });
    test('the note says it is done on a computer, no links; nothing spills at 390', async ({ page }) => {
        await follow(page, { width: 390, height: 844 }, (b) => { b.browser = unpermitted; });
        await page.locator('#live-panel .live-panel-toggle').click();
        const ov = page.locator('#research-overview');
        await expect(ov).toHaveClass(/research-overview--sheet/);
        const note = groupHead(ov).locator('.waiting-browser-note');
        await expect(note).toHaveText(`Mit der Erlaubnis „über den Browser“ für ${ARCHIVE.name} speichert der Agent die Bilder selbst. Die Erlaubnis wird in der Forschung am Computer erteilt.`);
        await expect(note.locator('a, button')).toHaveCount(0);
        expect(await spills(groupHead(ov))).toEqual([]);
        const item = await openItem(ov, 'T0001');
        await expect(item.locator('.waiting-browser-note')).toHaveCount(0);
        expect(await spills(ov)).toEqual([]);
    });
});
