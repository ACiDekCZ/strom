import { test, expect, Page, Route } from '@playwright/test';
import { openApp, card } from './helpers.js';
import { dropFile } from './research-bridge.js';

/**
 * Switching trees follows the research live where an agent works (spec 011,
 * U4b): the open tree's changes go first and the switch waits for them; the
 * tree opened is followed at once when its bridge answers and someone works
 * there, the panel's head names that tree and a line says which tree is
 * followed now (no toast); following of the tree left ends quietly and that
 * tree is editable again; a bridge with nobody at work leaves the tree
 * editable, "Follow live" offered, and an agent beginning later is said in
 * the panel without locking the tree; a bridge that does not answer leaves it
 * passive, no dialog; coming back follows again; a ?live= link is a switch
 * with that line too. Two fake bridges answer by page.route. Invented families only.
 */

const NOVAK = '6a1d2c3e-4f50-4a61-8b72-9c83d4e5f601';
const DVORAK = '7b2e3d4f-5061-4b72-9c83-ad94e5f60712';
const B_NOVAK = 'http://127.0.0.1:5991/11111111111111111111111111111111';
const B_DVORAK = 'http://127.0.0.1:5992/22222222222222222222222222222222';
const N_TREE = 'Novákovi z Kolína';
const D_TREE = 'Dvořákovi (Morava)';
const cors = { 'access-control-allow-origin': '*' };
const LINKS = ['send', 'open', 'live', 'app', 'setup'];
const MANUAL = { sync: { auto: 'off' }, sources: true, verified: true, media: null };
const AUTO = { mode: 'research', sync: { auto: 'write' }, sources: true, verified: true, media: null };

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const item = (id: string) => ({ id, what: `Dopis ${id}`, on: 'odpověď matriky', at: ago(86_400_000) });
const worker = (research: string, task: string) => ({ who: 'agent-matriky', since: ago(9 * 60_000), task, research });
const AT_WORK = [worker('G0001', 'Křest Josefa Nováka 1842'), worker('G0002', 'Sňatek 1903')];

function ged(id: string, name: string, first: string, last: string): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '2 NAME Strom Research', '1 DATE 19 OCT 2026',
        `1 _STROM_TREE ${id}`, '1 _STROM_HEAD h1', '1 _STROM_LINKS send open live app setup', '1 CHAR UTF-8', `1 NOTE ${name}`,
        '0 @P0001@ INDI', `1 NAME ${first} /${last}/`, '1 SEX M', '1 REFN P0001', '2 TYPE strom-research',
        '0 TRLR',
    ].join('\n');
}

interface Bridge {
    id: string;
    name: string;
    research: string;
    first: string;
    last: string;
    /** No answer at all. */
    down: boolean;
    working: unknown[];
    waiting: unknown[];
    accepts: unknown;
    /** What came by POST /sync, and whether its answer went out. */
    posts: string[];
    replied: number;
    /** How long a send takes to be answered (ms). */
    sendMs: number;
}

function statusOf(b: Bridge) {
    return {
        tree: { id: b.id, name: b.research }, head: 'h1', persons: 1, working: b.working, waiting: b.waiting, queue: [], links: LINKS,
        accepts: b.accepts, inbox: { trees: [], material: 0 }, sends: [], lastIntake: null,
    };
}

async function serve(page: Page, base: string, b: Bridge): Promise<void> {
    await page.route(`${base}/**`, async (route: Route) => {
        if (b.down) return route.abort('connectionrefused');
        const req = route.request();
        if (req.method() === 'OPTIONS') {
            return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-methods': 'GET, PUT, POST', 'access-control-allow-headers': '*' } });
        }
        const path = new URL(req.url()).pathname;
        const json = (body: unknown) => route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
        if (path.endsWith('/status')) return json(statusOf(b));
        if (path.endsWith('/tree.ged')) {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' }, body: ged(b.id, b.name, b.first, b.last) });
        }
        if (path.endsWith('/events')) {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `event: hello\ndata: ${JSON.stringify(statusOf(b))}\n\n` });
        }
        if (path.endsWith('/sync') && req.method() === 'POST') {
            b.posts.push(req.postData() ?? '');
            await new Promise(r => setTimeout(r, b.sendMs));
            await json({ ok: true, inbox: true, changes: 1, input: 'I0042', intake: `R${Date.now()}` });
            b.replied++;
            return;
        }
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
}

function bridge(o: Partial<Bridge> & Pick<Bridge, 'id' | 'name' | 'research' | 'first' | 'last'>): Bridge {
    return { down: false, working: [], waiting: [], accepts: MANUAL, posts: [], replied: 0, sendMs: 0, ...o };
}

/**
 * Both research trees opened in the app (Dvořákovi open last), their bridges'
 * addresses kept on this computer; the other trees asked fast.
 */
async function twoTrees(page: Page, o: { novak?: Partial<Bridge>; dvorak?: Partial<Bridge>; auto?: boolean } = {}) {
    const novak = bridge({ id: NOVAK, name: N_TREE, research: 'Kolín 1840–1910', first: 'Josef', last: 'Novák', working: AT_WORK, waiting: [item('T1')], ...o.novak });
    const dvorak = bridge({ id: DVORAK, name: D_TREE, research: 'Morava', first: 'Karel', last: 'Dvořák', waiting: [item('T1'), item('T2'), item('T3')], ...o.dvorak });
    await page.addInitScript(() => {
        (globalThis as { __OTHER_RESEARCH_MS?: unknown }).__OTHER_RESEARCH_MS = { first: 50, every: 800, fresh: 0, timeout: 600 };
    });
    await serve(page, B_NOVAK, novak);
    await serve(page, B_DVORAK, dvorak);
    await openApp(page);
    await page.evaluate(() => {
        // Opening links in the system is not testable: record them instead.
        const ui = window.Strom.UI as unknown as { handOverResearchLink: (u: string) => void; __links: string[] };
        ui.__links = [];
        ui.handOverResearchLink = (u: string) => { ui.__links.push(u); };
        localStorage.setItem('strom-research-auto-intro-seen', '1');
    });
    const ids: Record<string, string> = {};
    for (const b of [novak, dvorak]) {
        await dropFile(page, `${b.last}.ged`, ged(b.id, b.name, b.first, b.last));
        await expect(card(page, b.first)).toBeVisible();
        ids[b.name] = await page.evaluate(({ id, base, accepts, auto }) => {
            const tm = window.Strom.TreeManager;
            const tree = tm.getActiveTreeId()!;
            localStorage.setItem(`strom-research-bridge:${id}`, JSON.stringify({ base, accepts }));
            tm.patchResearchLink(tree, { sendMode: auto ? 'auto' : 'manual' });
            localStorage.setItem(`strom-research-auto:${tree}`, JSON.stringify({ ...JSON.parse(localStorage.getItem(`strom-research-auto:${tree}`) ?? '{}'), modeAsked: true, skipPreview: true }));
            return tree as string;
        }, { id: b.id, base: b.id === NOVAK ? B_NOVAK : B_DVORAK, accepts: b.accepts, auto: !!o.auto });
    }
    await page.evaluate(() => window.Strom.UI.updateTreeSwitcher());
    // Each bridge answered once (the open tree's own ask, the others' round).
    await page.evaluate(() => window.Strom.UI.pollResearchBridge());
    await expect.poll(() => page.evaluate((list) => {
        const ui = window.Strom.UI as unknown as { researchAnswerOf(id: string): unknown };
        return list.every(id => !!ui.researchAnswerOf(id));
    }, [NOVAK, DVORAK])).toBe(true);
    return { novak, dvorak, ids };
}

const row = (page: Page, name: string) => page.locator('#tree-switcher-dropdown .tree-switcher-item', { has: page.locator('.tree-item-name', { hasText: new RegExp(`^${name.replace(/[()]/g, '\\$&')}$`) }) });
const liveTree = (page: Page) => page.evaluate(() => window.Strom.DataManager.getLiveTreeId());
const openTree = (page: Page) => page.evaluate(() => window.Strom.TreeManager.getActiveTreeId());

/** Nothing about following said as a toast (stopped, ended, another research). */
async function noFollowToast(page: Page): Promise<void> {
    await expect(page.locator('.toast', { hasText: /Stopped following|Following ended|different research|Now following/ })).toHaveCount(0);
}

/** Through the tree switcher, as the user does. */
async function pick(page: Page, name: string): Promise<void> {
    await page.locator('.tree-switcher-btn').click();
    await row(page, name).click();
}

test.describe('switching trees follows the research where an agent works', () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
    });

    test('a tree where an agent works is followed at once; the head names it, a line says so, the switcher marks both', { tag: '@smoke' }, async ({ page }) => {
        const { ids } = await twoTrees(page);
        expect(await liveTree(page)).toBeNull();
        await pick(page, N_TREE);
        const panel = page.locator('#live-panel');
        await expect(panel).toBeVisible();
        await expect(panel).not.toHaveClass(/idle/);
        expect(await liveTree(page)).toBe(ids[N_TREE]);
        await expect(panel.locator('.live-panel-head .live-panel-title')).toHaveText(N_TREE);
        await expect(panel).toHaveAttribute('aria-label', 'Live research from Strom Research');
        const note = panel.locator('.live-follow-note');
        await expect(note).toHaveText(`Now following “${N_TREE}”. “${D_TREE}” stays editable.`);
        await expect(note).toHaveAttribute('aria-live', 'polite');
        // The research's name beside the tree's (it says something else).
        await expect(panel.locator('.live-panel-state')).toHaveText(`Following the tree “${N_TREE}” (research “Kolín 1840–1910”). Changes arrive by themselves; the tree is read-only meanwhile.`);
        // The line comes after the head, before "Elsewhere".
        expect(await panel.evaluate((p) => {
            const kids = [...p.children];
            const n = kids.findIndex(k => k.classList.contains('live-follow-note'));
            const e = kids.findIndex(k => k.classList.contains('rs-elsewhere'));
            return n === 1 && (e === -1 || e > n);
        })).toBe(true);
        // Nothing asked, nothing toasted.
        await expect(page.locator('.modal-overlay.active')).toHaveCount(0);
        await noFollowToast(page);
        // The switcher: followed live with its directions and what waits; the tree left with its own mark.
        await page.locator('.tree-switcher-btn').click();
        await expect(row(page, N_TREE).locator('.rs-mark--live .rs-full')).toHaveText('live · 2 directions');
        await expect(row(page, N_TREE).locator('.rs-mark--waiting')).toHaveText('1 waiting');
        await expect(row(page, D_TREE).locator('.rs-mark--waiting')).toHaveText('3 waiting');
        await page.locator('.tree-switcher-btn').click();
        // The line goes after a while; the name is no longer lit.
        await expect(note).toHaveCount(0, { timeout: 9000 });
        await expect(panel.locator('.live-panel-title.is-fresh')).toHaveCount(0);
    });

    test('leaving a followed tree ends following quietly, coming back follows again; moving between two working trees says so', async ({ page }) => {
        const { ids, dvorak } = await twoTrees(page);
        await pick(page, N_TREE);
        await expect.poll(() => liveTree(page)).toBe(ids[N_TREE]);
        // To a tree with nobody at work: following of the one left ends, nothing said; both editable.
        await pick(page, D_TREE);
        await expect.poll(() => openTree(page)).toBe(ids[D_TREE]);
        await expect.poll(() => liveTree(page)).toBeNull();
        await noFollowToast(page);
        expect(await page.evaluate(() => window.Strom.DataManager.isReadOnly())).toBe(false);
        // The panel was in sight: this tree's research panel, by its name, Follow live offered.
        const panel = page.locator('#live-panel');
        await expect(panel).toHaveClass(/idle/);
        await expect(panel.locator('.live-panel-title')).toHaveText(D_TREE);
        await expect(panel.locator('.live-panel-follow')).toHaveText('Follow live');
        // Back: followed again, its current version loaded, the line again.
        await pick(page, N_TREE);
        await expect.poll(() => liveTree(page)).toBe(ids[N_TREE]);
        await expect(panel.locator('.live-follow-note')).toHaveText(`Now following “${N_TREE}”. “${D_TREE}” stays editable.`);
        // The pointer in the panel holds the line; it goes once the pointer leaves.
        await panel.locator('.live-panel-state').hover();
        await page.waitForTimeout(7000);
        await expect(panel.locator('.live-follow-note')).toHaveCount(1);
        await page.mouse.move(10, 600);
        await expect(panel.locator('.live-follow-note')).toHaveCount(0, { timeout: 9000 });
        // Now an agent works on the Dvořáks too: the switch moves following there.
        dvorak.working = [worker('G0007', 'Matrika Brno')];
        await page.evaluate(() => (window.Strom.UI as unknown as { kickOtherResearch(): void }).kickOtherResearch());
        await pick(page, D_TREE);
        await expect.poll(() => liveTree(page)).toBe(ids[D_TREE]);
        await expect(panel.locator('.live-follow-note')).toHaveText(`Now following “${D_TREE}”. “${N_TREE}” can be edited again.`);
        await noFollowToast(page);
        await expect(page.locator('.modal-overlay.active')).toHaveCount(0);
    });

    test('nobody at work: editable, and an agent beginning later is said in the panel without locking the tree', async ({ page }) => {
        const { ids, novak } = await twoTrees(page, { novak: { working: [] } });
        // The Dvořáks open, their research panel in sight; to the Nováks (nobody at work).
        await page.evaluate(() => window.Strom.UI.showResearchWaiting());
        await pick(page, N_TREE);
        await expect.poll(() => openTree(page)).toBe(ids[N_TREE]);
        const panel = page.locator('#live-panel');
        await expect(panel).toHaveClass(/idle/);
        await expect(panel.locator('.live-panel-title')).toHaveText(N_TREE);
        await expect(panel.locator('.live-panel-state')).toHaveText('Research connected, nobody at work right now. Edits are sent to it automatically.');
        await expect(panel.locator('.live-panel-follow')).toHaveText('Follow live');
        expect(await liveTree(page)).toBeNull();
        // The agent starts: the open tree's own regular ask finds it; the tree stays editable, the panel says it.
        novak.working = AT_WORK;
        await page.evaluate(() => window.Strom.UI.pollResearchBridge());
        const started = panel.locator('.live-agent-started');
        await expect(started).toContainText('The agent has started work.');
        await expect(started).toHaveAttribute('role', 'status');
        expect(await liveTree(page)).toBeNull();
        expect(await page.evaluate(() => window.Strom.DataManager.isReadOnly())).toBe(false);
        await expect(panel.locator('.live-panel-follow')).toHaveCount(0);
        // Follow live: followed now, the line says it.
        await started.getByRole('button', { name: 'Follow live' }).click();
        await expect.poll(() => liveTree(page)).toBe(ids[N_TREE]);
        await expect(panel).not.toHaveClass(/idle/);
        await expect(panel.locator('.live-follow-note')).toHaveText(`Now following “${N_TREE}”.`);
        await expect(page.locator('.modal-overlay.active')).toHaveCount(0);
    });

    test('a bridge that does not answer: passive, the panel says it is not running, no dialog', async ({ page }) => {
        const { ids, novak } = await twoTrees(page);
        novak.down = true;
        // What it said is older than the switch takes as it is: asked again, no answer.
        await page.evaluate(() => {
            const ui = window.Strom.UI as unknown as { researchAnswerOf(id: string): { at: number } | null };
            const a = ui.researchAnswerOf('6a1d2c3e-4f50-4a61-8b72-9c83d4e5f601');
            if (a) a.at = Date.now() - 60_000;
        });
        await page.evaluate(() => window.Strom.UI.showResearchWaiting());
        await pick(page, N_TREE);
        await expect.poll(() => openTree(page)).toBe(ids[N_TREE]);
        const panel = page.locator('#live-panel');
        await expect(panel).toHaveClass(/is-off/);
        await expect(panel.locator('.live-panel-title')).toHaveText(N_TREE);
        await expect(panel.locator('.live-panel-state')).toHaveText('Research not running right now. The tree can be edited; edits are sent once the research reconnects.');
        expect(await liveTree(page)).toBeNull();
        expect(await page.evaluate(() => window.Strom.DataManager.isReadOnly())).toBe(false);
        await expect(page.locator('.modal-overlay.active')).toHaveCount(0);
        await expect(page.getByText('Could not connect to the research')).toHaveCount(0);
        await noFollowToast(page);
    });

    test('following that cannot start (no tree from the bridge) stays passive without a dialog', async ({ page }) => {
        const { ids } = await twoTrees(page);
        await page.route((url) => url.href.startsWith(B_NOVAK) && url.pathname.endsWith('/tree.ged'), (route) => route.abort('connectionrefused'));
        await pick(page, N_TREE);
        await expect.poll(() => openTree(page)).toBe(ids[N_TREE]);
        const panel = page.locator('#live-panel');
        await expect(panel).toHaveClass(/idle/);
        expect(await liveTree(page)).toBeNull();
        await expect(page.locator('.modal-overlay.active')).toHaveCount(0);
        await expect(page.getByText('Could not connect to the research')).toHaveCount(0);
    });

    test('a ?live= link is a switch: the line names the tree followed now and the one left', async ({ page }) => {
        const { ids, dvorak } = await twoTrees(page);
        // The Dvořáks open: the link to the Nováks' research.
        const slug = await page.evaluate((id) => window.Strom.TreeManager.getTreeSlug(id as never), ids[D_TREE]);
        await page.goto(`/strom.html?tree=${encodeURIComponent(slug ?? '')}&live=${encodeURIComponent(B_NOVAK)}`);
        const panel = page.locator('#live-panel');
        await expect.poll(() => liveTree(page)).toBe(ids[N_TREE]);
        await expect(panel.locator('.live-panel-title')).toHaveText(N_TREE);
        await expect(panel.locator('.live-follow-note')).toHaveText(`Now following “${N_TREE}”. “${D_TREE}” stays editable.`);
        // Another link while following: moved, not ended quietly.
        dvorak.working = AT_WORK;
        await page.evaluate((base) => window.Strom.UI.startLiveFollow(base), B_DVORAK);
        await expect.poll(() => liveTree(page)).toBe(ids[D_TREE]);
        await expect(panel.locator('.live-follow-note')).toHaveText(`Now following “${D_TREE}”. “${N_TREE}” can be edited again.`);
        await noFollowToast(page);
    });

    test('an edit not sent yet goes before the switch, and the switch waits for it', async ({ page }) => {
        const { ids, dvorak } = await twoTrees(page, { auto: true, dvorak: { accepts: AUTO, sendMs: 700 } });
        await page.evaluate(() => {
            const dm = window.Strom.DataManager;
            const karel = Object.values(dm.getData().persons).find((p: any) => p.firstName === 'Karel') as any;
            dm.updatePerson(karel.id, { birthPlace: 'Brno' });
        });
        expect(dvorak.posts).toHaveLength(0);
        await page.evaluate((id) => window.Strom.UI.switchToTree(id), ids[N_TREE]);
        // Sent and answered before the switch was done.
        expect(dvorak.posts).toHaveLength(1);
        expect(dvorak.replied).toBe(1);
        expect(dvorak.posts[0]).toContain('2 PLAC Brno');
        expect(await openTree(page)).toBe(ids[N_TREE]);
        await expect.poll(() => liveTree(page)).toBe(ids[N_TREE]);
        // Kept in the tree too.
        await pick(page, D_TREE);
        await expect(card(page, 'Karel')).toBeVisible();
        expect(await page.evaluate(() => (Object.values(window.Strom.DataManager.getData().persons).find((p: any) => p.firstName === 'Karel') as any)?.birthPlace)).toBe('Brno');
    });
});
