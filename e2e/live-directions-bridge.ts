import { expect, Page } from '@playwright/test';

/**
 * A research bridge that manages its directions (Strom Research 1.26,
 * spec 038): `/status` with `caps` and the directions in their order of
 * work, and the writes (`POST /directions`, `/directions/<G>`,
 * `/directions/<G>/state`, `/directions/order`, `GET /directions/people`)
 * kept in `writes` and answered by default as the research would, or by
 * the answers queued in `replies`. Followed live through `?live=`.
 * Invented data only (the Fíškovi of Smrkov).
 */

export const UUID = '3f2c9a10-7b1e-4c55-9d2a-0e8f6b4a1c77';
export const BRIDGE = 'http://127.0.0.1:5996/0123456789abcdef0123456789abcdef';
const cors = { 'access-control-allow-origin': '*' };
export const ALL_LINKS = ['send', 'excerpt', 'app', 'open', 'chat', 'task', 'review', 'research',
    'new', 'update', 'sessions', 'conflict', 'story', 'sync-undo', 'setup', 'live', 'direction', 'finish'];

export const GED = [
    '0 HEAD', '1 SOUR STROM_RESEARCH', '1 DATE 30 SEP 2026', `1 _STROM_TREE ${UUID}`, '1 CHAR UTF-8', '1 NOTE Fíškovi',
    '0 @P0001@ INDI', '1 NAME Josef /Fíšek/', '1 SEX M', '1 BIRT', '2 DATE 1840', '1 REFN P0001', '1 FAMS @F0001@',
    '0 @P0002@ INDI', '1 NAME Anna /Svobodová/', '1 SEX F', '1 REFN P0002', '1 FAMS @F0001@',
    '0 @P0012@ INDI', '1 NAME Jan /Fíšek/', '1 SEX M', '1 BIRT', '2 DATE 1865', '1 REFN P0012', '1 FAMC @F0001@',
    '0 @P0050@ INDI', '1 NAME Marie /Fíšková/', '1 SEX F', '1 BIRT', '2 DATE 1871', '1 REFN P0050',
    '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 CHIL @P0012@',
    '0 TRLR',
].join('\n');

export const ago = (min: number): string => new Date(Date.now() - min * 60_000).toISOString();

/** Caps of a research that manages its directions (weighted order). */
export const CAPS = {
    directionsWrite: true, directionsOrder: true, orderMode: 'weight',
    directionKinds: ['ancestors', 'descendants', 'question'], duplicateDirections: false, offLineBranches: false,
};

/** Four directions in the order of work: one worked on, one paused in its place, one new, one ended. */
export const MANAGED_DIRECTIONS: Record<string, unknown>[] = [
    { id: 'G0001', name: 'Předci: Jan Fíšek', state: 'active', direction: 'ancestors', focus: 'P0012', order: 1, tasks: 2, waiting: 1,
        working: true, since: ago(6000), limits: { generations: 8 }, generations: [2, 1, 0], last: { at: ago(120), text: 'sňatek rodičů nalezen' },
        found: { days: 7, sessions: 3, persons: 1, sources: 9, people: ['P0050'] } },
    { id: 'G0004', name: 'Předci: Anna Svobodová', state: 'paused', direction: 'ancestors', focus: 'P0002', order: 2,
        reason: 'matriky ještě nejsou online', since: ago(1440) },
    { id: 'G0002', name: 'Potomci: Josef Fíšek', state: 'active', direction: 'descendants', focus: 'P0001', order: 3, tasks: 0, waiting: 0,
        working: false, since: ago(30), limits: { before: 1750 } },
    { id: 'G0005', name: 'Kdo byl kmotr?', state: 'done', direction: 'question', since: ago(2880), question: 'Kdo byl kmotr Jana?' },
];

/** The run on G0001. */
export const MANAGED_AGENT = { who: 'agent-matriky', since: ago(16), task: 'křest Marie Fíškové, Smrkov 1871', person: 'P0012', research: 'G0001', session: 'N0132' };

export interface BridgeReply { status: number; body: unknown; headers?: Record<string, string> }

export interface ManagedBridge {
    researches: Record<string, unknown>[];
    /** `/status.caps` (null: an older research, none sent). */
    caps: Record<string, unknown> | null;
    working: Record<string, unknown>[];
    /** Every write, in the order it came (method, path after the token, body). */
    writes: { method: string; path: string; body: unknown }[];
    /** Answers for the next writes, first first (empty: the research's own answer). */
    replies: BridgeReply[];
    statusAsks: number;
    /** The bridge does not answer (every request refused). */
    down: boolean;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    ({ status, headers: { ...cors, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

/** What the research answers to a write by itself (and what it changes). */
function answer(b: ManagedBridge, method: string, path: string, body: Record<string, unknown>): BridgeReply {
    const find = (id: string) => b.researches.find(d => d.id === id);
    if (method === 'GET' && path === 'directions/people') {
        const people: Record<string, string[]> = {};
        for (const d of b.researches) {
            if (d.state === 'done' || typeof d.focus !== 'string') continue;
            (people[d.focus] ??= []).push(d.id as string);
        }
        return { status: 200, body: { people } };
    }
    if (method !== 'POST') return { status: 404, body: { error: 'not.found' } };
    if (path === 'directions/order') {
        const order = (body.order as string[]).filter(id => find(id));
        const ignored = (body.order as string[]).filter(id => !find(id));
        order.forEach((id, i) => { find(id)!.order = i + 1; });
        return { status: 200, body: { order, ignored } };
    }
    const state = /^directions\/(G\d+)\/state$/.exec(path);
    if (state) {
        const d = find(state[1]);
        if (!d) return { status: 404, body: { error: 'directions.none' } };
        d.state = body.do === 'pause' ? 'paused' : body.do === 'done' ? 'done' : 'active';
        d.since = new Date().toISOString();
        if (typeof body.reason === 'string') d.reason = body.reason;
        else delete d.reason;
        return { status: 200, body: { direction: d } };
    }
    const edit = /^directions\/(G\d+)$/.exec(path);
    if (edit) {
        const d = find(edit[1]);
        if (!d) return { status: 404, body: { error: 'directions.none' } };
        for (const k of ['name', 'question', 'reason'] as const) if (typeof body[k] === 'string') d[k] = body[k];
        const limits = body.limits as Record<string, number | null> | undefined;
        if (limits) {
            const now = { ...(d.limits as Record<string, number> | undefined) };
            for (const [k, v] of Object.entries(limits)) {
                if (v === null) delete now[k];
                else now[k] = v;
            }
            d.limits = now;
        }
        return { status: 200, body: { direction: d } };
    }
    if (path === 'directions') {
        const id = `G${String(b.researches.length + 10).padStart(4, '0')}`;
        const d = { id, name: (body.name as string) || `Předci: ${body.person}`, state: 'active', direction: body.direction, focus: body.person,
            order: b.researches.filter(x => x.state !== 'done').length + 1, tasks: 0, waiting: 0, working: false, since: new Date().toISOString(),
            ...(body.limits ? { limits: body.limits } : {}), ...(typeof body.question === 'string' ? { question: body.question } : {}) };
        b.researches.push(d);
        return { status: 200, body: { direction: d } };
    }
    return { status: 404, body: { error: 'not.found' } };
}

/**
 * Follow a research live with the bridge above (`caps: null`: an older
 * research). Research links are recorded in `window.__launched` instead of
 * being opened.
 */
export async function followManaged(page: Page, opts: {
    researches?: Record<string, unknown>[];
    caps?: Record<string, unknown> | null;
    working?: Record<string, unknown>[];
    size?: { width: number; height: number };
    /** Reconnect every 250 ms (a test of the bridge going away). */
    fastReconnect?: boolean;
    /** `/status.features` (absent: none sent). */
    features?: string[];
} = {}): Promise<ManagedBridge> {
    await page.setViewportSize(opts.size ?? { width: 1440, height: 900 });
    if (opts.fastReconnect) {
        await page.addInitScript(() => { (globalThis as { __LIVE_RECONNECT_MS?: number }).__LIVE_RECONNECT_MS = 250; });
    }
    await page.addInitScript((links) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: links, at: new Date().toISOString() }));
    }, ALL_LINKS);
    const b: ManagedBridge = {
        researches: structuredClone(opts.researches ?? MANAGED_DIRECTIONS),
        caps: opts.caps === undefined ? CAPS : opts.caps,
        working: opts.working ?? [MANAGED_AGENT],
        writes: [], replies: [], statusAsks: 0, down: false,
    };
    const status = () => ({
        tree: { id: UUID, name: 'Fíškovi' }, head: 'h1', persons: 4,
        working: b.working,
        waiting: [],
        queue: [{ id: 'T0101', text: 'Matriky Smrkov', state: 'next', research: 'G0001' }],
        links: ALL_LINKS,
        researches: b.researches,
        ...(b.caps ? { caps: b.caps } : {}),
        ...(opts.features ? { features: opts.features } : {}),
    });
    await page.route(`${BRIDGE}/**`, async (route) => {
        if (b.down) return route.abort('connectionrefused');
        const req = route.request();
        const path = new URL(req.url()).pathname.replace(/^\/[0-9a-f]+\//, '');
        if (path === 'status') {
            b.statusAsks++;
            return route.fulfill(json(status()));
        }
        if (path === 'tree.ged') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' }, body: GED });
        if (path === 'events') {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `event: hello\ndata: ${JSON.stringify(status())}\n\n` });
        }
        if (path.startsWith('directions')) {
            const raw = req.postData();
            const body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
            b.writes.push({ method: req.method(), path, body });
            const r = b.replies.shift() ?? answer(b, req.method(), path, body);
            return route.fulfill(json(r.body, r.status, r.headers));
        }
        return route.fulfill({ status: 404, headers: cors, body: '' });
    });
    await page.goto(`/strom.html?live=${encodeURIComponent(BRIDGE)}`);
    await expect(page.locator('#live-panel')).toBeVisible();
    await page.evaluate(() => {
        const launched: string[] = [];
        (window as unknown as { __launched: string[] }).__launched = launched;
        window.Strom.UI.handOverResearchLink = (url: string) => { launched.push(url); };
    });
    return b;
}

export const launchedLinks = (page: Page) => page.evaluate(() => (window as unknown as { __launched: string[] }).__launched);

export async function openOverview(page: Page): Promise<void> {
    await page.locator('#live-panel .live-panel-expand').click();
    await expect(page.locator('#research-overview')).toBeVisible();
}

export const overview = (page: Page) => page.locator('#research-overview');
export const directionRow = (page: Page, id: string) => overview(page).locator(`.research-direction[data-direction="${id}"]`);
/** The writes of the directions (no `GET /directions/people`). */
export const directionWrites = (b: ManagedBridge) => b.writes.filter(w => w.method === 'POST');
