import { test, expect, Locator, Page } from '@playwright/test';
import { BRIDGE, FakeBridge, fakeBridge, openResearch, poll } from './research-bridge.js';

/**
 * Writes of the Research overview without following (spec 057 §7) ask the
 * research's status at once, as "Do next" does: an answer or Sent in
 * Awaiting action and a line paused are written through the bridge, and
 * what the bridge says next is drawn within 3 s (the regular ask comes only
 * after 20 s). Nothing is followed. The overview's own window: the main
 * window writes it and asks, the window gets the new state and asks the
 * bridge nothing. Invented data (the Fíškovi of Čapkov); the bridge is
 * answered by page.route; a fixed clock.
 */

const NOW = new Date('2026-11-13T10:30:00Z');
const ACCEPTS = { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null };
const LINKS = ['send', 'open', 'live', 'app', 'setup', 'chat'];
const CAPS = { directionsWrite: true, directionsOrder: true, orderMode: 'weight', directionKinds: ['ancestors', 'descendants', 'question'], duplicateDirections: false, offLineBranches: false };
const DIRECTIONS = [
    { id: 'G0001', name: 'Předci Josefa Fíška', state: 'active', direction: 'ancestors', focus: 'P0001', order: 1, tasks: 4, waiting: 0, working: false, since: '2026-11-01T08:00:00Z' },
    { id: 'G0002', name: 'Předci Anny Svobodové', state: 'active', direction: 'ancestors', focus: 'P0002', order: 2, tasks: 1, waiting: 0, working: false, since: '2026-11-02T08:00:00Z' },
];
const AT = '2026-11-12T09:00:00Z';
const WAITING = [
    { id: 'T0001', what: 'Dopis na faru v Čapkově', kind: 'letter', section: 'letter', at: AT, order: 0, actions: ['sent', 'answer'] },
    { id: 'T0002', what: 'Které matriky Čapkova?', kind: 'web', section: 'web', url: 'https://matriky.example/capkov', at: AT, order: 1, actions: ['answer'] },
];
const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };

interface WriteBridge { bridge: FakeBridge; writes: [string, unknown][] }

/**
 * The research tree, its bridge known here and answering (`waiting.sent`, `waiting.answer`, lines it manages); not
 * followed. A write (`POST /waiting/<T>`, `/directions/<G>/state`) as the research writes it; `then` changes what its
 * next status says besides (something only a status asked after the write can bring).
 */
async function researchTree(page: Page, then: (b: FakeBridge) => void): Promise<WriteBridge> {
    await page.clock.setFixedTime(NOW);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openResearch(page);
    const bridge = await fakeBridge(page, {
        accepts: ACCEPTS, links: LINKS, features: ['waiting.groups', 'waiting.sent', 'waiting.answer'], waiting: structuredClone(WAITING),
        statusExtra: { working: [], researches: structuredClone(DIRECTIONS), queue: [], caps: CAPS },
    });
    const writes: [string, unknown][] = [];
    await page.route(`${BRIDGE}/waiting/*`, async (route) => {
        const req = route.request();
        if (req.method() !== 'POST') return route.fallback();
        const id = new URL(req.url()).pathname.split('/').pop()!;
        const body = JSON.parse(req.postData() ?? '{}') as { do: string };
        writes.push([id, body]);
        const w = (bridge.waiting ?? []).find(x => (x as { id: string }).id === id) as Record<string, unknown> | undefined;
        if (!w) return route.fulfill({ status: 404, headers: cors, body: JSON.stringify({ error: 'not waiting', code: 'waiting.none' }) });
        then(bridge);
        if (body.do === 'sent') {
            Object.assign(w, { phase: 'sent', sentAt: NOW.toISOString() });
            return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ sent: [id] }) });
        }
        bridge.waiting = (bridge.waiting ?? []).filter(x => x !== w);
        return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ task: id, head: '' }) });
    });
    await page.route(`${BRIDGE}/directions/*/state*`, async (route) => {
        const req = route.request();
        const id = new URL(req.url()).pathname.split('/').at(-2)!;
        const body = JSON.parse(req.postData() ?? '{}') as { do: string };
        writes.push([`${id}/state`, body]);
        const researches = (bridge.statusExtra!.researches as Record<string, unknown>[]);
        const d = researches.find(x => x.id === id)!;
        Object.assign(d, { state: body.do === 'pause' ? 'paused' : 'active' });
        then(bridge);
        return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ direction: d }) });
    });
    await poll(page);
    return { bridge, writes };
}

/** What only the next status says: the other item's wording and the other line's name. */
function changedMeanwhile(b: FakeBridge): void {
    const other = (b.waiting ?? []).find(x => (x as { id: string }).id === 'T0002') as Record<string, unknown> | undefined;
    if (other) other.what = 'Které matriky Čapkova a Bukovce?';
    const lines = b.statusExtra!.researches as Record<string, unknown>[];
    const anna = lines.find(x => x.id === 'G0002');
    if (anna) anna.name = 'Předci Anny Svobodové z Bukovce';
}

const ov = (page: Page) => page.locator('#research-overview');
const item = (page: Page, id: string) => ov(page).locator(`.research-overview__waiting-item[data-id="${id}"]`);
const line = (page: Page, id: string) => ov(page).locator(`.research-direction[data-direction="${id}"]`);
const following = (page: Page) => page.evaluate(() => window.Strom.UI.isFollowingActiveResearch());
const statusAsks = (b: FakeBridge) => (b.seen ?? []).filter(s => s === 'GET /status').length;

/** The overview from the Research menu's first item. */
async function openOverview(page: Page): Promise<void> {
    await page.locator('#research-menu-btn').click();
    await page.locator('#research-item-overview').click();
    await expect(ov(page)).toBeVisible();
}

/** Every folded place of Awaiting action unfolded (in `root`: the docked overview or the window's). */
async function unfoldPlaces(root: Locator): Promise<void> {
    const folded = root.locator('.research-overview__waiting-group[aria-expanded="false"]');
    while (await folded.count() > 0) await folded.first().click();
}

/** An item's detail open (its place unfolded). */
async function openItem(page: Page, id: string): Promise<void> {
    await unfoldPlaces(ov(page));
    const it = item(page, id);
    await expect(it).toBeVisible();
    if (await it.locator('.research-overview__waiting-detail').count() === 0) await it.locator('.research-overview__waiting-row').click();
    await expect(it.locator('.research-overview__waiting-detail')).toBeVisible();
}

test.describe('writes of the overview without following ask the status at once', () => {
    test('Awaiting action: an answer and Sent written through the bridge, the next status drawn within 3 s; nothing followed', async ({ page }) => {
        const { bridge, writes } = await researchTree(page, changedMeanwhile);
        await openOverview(page);
        expect(await following(page)).toBe(false);

        await openItem(page, 'T0001');
        const asked = statusAsks(bridge);
        await item(page, 'T0001').locator('[data-action="sent"]').click();
        await expect.poll(() => writes).toEqual([['T0001', { do: 'sent' }]]);
        await expect.poll(() => statusAsks(bridge), { timeout: 3000 }).toBeGreaterThan(asked);
        await expect(item(page, 'T0002')).toContainText('Které matriky Čapkova a Bukovce?', { timeout: 3000 });

        // The answer: the item goes, and what the research says now comes at once again.
        const other = bridge.waiting!.find(x => (x as { id: string }).id === 'T0002') as Record<string, unknown>;
        await openItem(page, 'T0002');
        await item(page, 'T0002').locator('.waiting-actions [data-action="answer"]').click();
        await item(page, 'T0002').locator('.waiting-answer textarea').fill('Kniha N 1840–1870 je v badatelně.');
        // The bridge's next status names a new item (only a status asked after the write brings it).
        bridge.waiting!.push({ id: 'T0003', what: 'Opis křtu Jana Fíška', kind: 'web', section: 'web', url: 'https://matriky.example/krest', at: AT, order: 2, actions: ['answer'] });
        other.what = 'Které matriky Čapkova a Bukovce?';
        await item(page, 'T0002').locator('.waiting-answer__send').click();
        await expect.poll(() => writes.at(-1)?.[0]).toBe('T0002');
        await expect(item(page, 'T0002')).toHaveCount(0);
        await expect(item(page, 'T0003')).toBeVisible({ timeout: 3000 });

        expect(await following(page)).toBe(false);
        expect((bridge.seen ?? []).some(s => s.endsWith('/events') || s.endsWith('/tree.ged'))).toBe(false);
    });

    test('Lines: a line paused through the bridge, the next status drawn within 3 s', async ({ page }) => {
        const { bridge, writes } = await researchTree(page, changedMeanwhile);
        await openOverview(page);
        await line(page, 'G0001').locator('.research-direction__head').click();
        const asked = statusAsks(bridge);
        await line(page, 'G0001').locator('[data-do="pause"]').click();
        await expect.poll(() => writes).toEqual([['G0001/state', { do: 'pause' }]]);
        await expect(line(page, 'G0001').locator('.research-direction__chip')).toHaveText(/^paused/);
        await expect.poll(() => statusAsks(bridge), { timeout: 3000 }).toBeGreaterThan(asked);
        await expect(line(page, 'G0002')).toContainText('Předci Anny Svobodové z Bukovce', { timeout: 3000 });
        expect(await following(page)).toBe(false);
    });

    test('the overview\'s own window: Sent written by the main window, the window gets the next status within 3 s and asks the bridge nothing', async ({ page }) => {
        const { writes } = await researchTree(page, changedMeanwhile);
        await page.locator('#view-window-btn').click();
        const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('#view-window-menu [data-view="overview"]').click()]);
        await popup.waitForLoadState('domcontentloaded');
        const win = popup.locator('#research-overview.research-overview--window');
        await expect(win).toBeVisible();
        const bridgeAsks: string[] = [];
        popup.on('request', r => { if (r.url().startsWith('http://127.0.0.1:5998')) bridgeAsks.push(r.url()); });
        const winItem = (id: string) => win.locator(`.research-overview__waiting-item[data-id="${id}"]`);
        await unfoldPlaces(win);
        await expect(winItem('T0001')).toBeVisible();
        if (await winItem('T0001').locator('.research-overview__waiting-detail').count() === 0) await winItem('T0001').locator('.research-overview__waiting-row').click();
        await winItem('T0001').locator('[data-action="sent"]').click();
        await expect.poll(() => writes).toEqual([['T0001', { do: 'sent' }]]);
        await expect(winItem('T0002')).toContainText('Které matriky Čapkova a Bukovce?', { timeout: 3000 });
        expect(await following(page)).toBe(false);
        expect(bridgeAsks).toEqual([]);
        await popup.close();
    });
});
