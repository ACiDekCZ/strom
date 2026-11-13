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
    /** `/status.offLine` (null: none sent); its branches change with the writes. */
    offLine: Record<string, unknown> | null;
    /** `/status.queue` and `/status.waiting` (writes change them). */
    queue: Record<string, unknown>[];
    waiting: Record<string, unknown>[];
    /** Who else is in which direction (`GET /directions/people`, added to each direction's person; absent: its person only). */
    people?: Record<string, string[]>;
    /**
     * The whole queue read by pages (`queue.page`): `queue` is all of it, the status sends its window (14 up next,
     * 6 set aside, each with `pos`) and `queueCounts`; `rev` changes with every change of the queue's order.
     */
    paged?: { rev: number };
    /** Each `GET /queue` asked (its query, without `app`). */
    queueReads: string[];
    /** A task's number outside the queue and its state now (`queue.search`'s `elsewhere`: done, waiting, parked, dropped). */
    elsewhere: Record<string, string>;
    /** Answers for the next `GET /queue` reads, first first (empty: the research's own answer). */
    queueReplies: BridgeReply[];
    /** While set, `GET /queue` answers only once it resolves (a search being read). */
    queueHold: Promise<void> | null;
    /**
     * `queue.next` (in `features`): a task's own place carries when it was set (`at`), the latest
     * "next" first, "last" ones by their time at the end; a write answers with `was`, `restore`
     * puts it back, a task the agent works on is refused (409 `queue.doing`).
     */
    queueNext?: { base: string[]; at: Map<string, string>; clock: number };
    /** `/status.busy` (absent: none sent). */
    busy?: { sessions: number; runs: number };
    /** `/status.work` (absent: none sent). */
    work?: { gate: string | null; minutes: number };
}

/** The status's window of a queue read by pages: 14 tasks up next, then up to 6 set aside. */
const QUEUE_WINDOW = 14;

/** The tasks up next numbered by their place in the whole queue (`pos`); set-aside ones last, by id, without one. */
function queueWithPlaces(b: ManagedBridge): Record<string, unknown>[] {
    let pos = 0;
    const next = b.queue.filter(q => q.state === 'next').map(({ whyBefore: _w, ...q }) => ({ ...q, pos: ++pos }));
    const parked = b.queue.filter(q => q.state === 'parked').map(({ whyBefore: _w, ...q }) => q)
        .sort((x, y) => String(x.id).localeCompare(String(y.id)));
    return [...next, ...parked];
}

const queueRev = (b: ManagedBridge): string => (b.paged?.rev ?? 0).toString(16).padStart(16, '0');

/** `/status.queueCounts` of a queue read by pages. */
function queueCounts(b: ManagedBridge): Record<string, unknown> {
    const research: Record<string, number> = {};
    const branch: Record<string, number> = {};
    let next = 0;
    let parked = 0;
    for (const q of b.queue) {
        if (q.state !== 'next') { parked++; continue; }
        next++;
        if (typeof q.research === 'string') research[q.research] = (research[q.research] ?? 0) + 1;
        if (typeof q.branch === 'string') branch[q.branch] = (branch[q.branch] ?? 0) + 1;
    }
    return { research, branch, next, parked, rev: queueRev(b) };
}

/** Lower case without diacritics, as the research compares a searched text. */
const folded = (t: string): string => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * `queue.search`: the tasks matching `q` (a task's number T0815 / t815 / 815, a person's P12, else the text
 * without case and diacritics), each with how it matched (`id` / `person`; nothing for the text).
 */
function searchQueue(rows: Record<string, unknown>[], q: string): { rows: Record<string, unknown>[]; match: Record<string, string> } {
    const match: Record<string, string> = {};
    const num = /^t?0*(\d+)$/i.exec(q);
    const person = /^p0*(\d+)$/i.exec(q);
    const found = rows.filter(t => {
        if (num && Number(String(t.id).slice(1)) === Number(num[1])) {
            match[String(t.id)] = 'id';
            return true;
        }
        if (person && typeof t.person === 'string' && Number(t.person.slice(1)) === Number(person[1])) {
            match[String(t.id)] = 'person';
            return true;
        }
        return folded(String(t.text)).includes(folded(q));
    });
    return { rows: found, match };
}

/** `GET /queue?from&count&branch&research&state&q`, as the research answers it. */
function queuePage(b: ManagedBridge, query: URLSearchParams): BridgeReply {
    const from = Number(query.get('from') ?? 0);
    const count = Math.min(100, Number(query.get('count') ?? 50));
    let rows = queueWithPlaces(b)
        .filter(q => !query.get('branch') || q.branch === query.get('branch'))
        .filter(q => !query.get('research') || q.research === query.get('research'))
        .filter(q => !query.get('state') || q.state === query.get('state'));
    const q = query.get('q');
    let found: Record<string, unknown> = {};
    if (q) {
        const r = searchQueue(rows, q);
        rows = r.rows;
        const num = /^t?0*(\d+)$/i.exec(q);
        const id = num ? Object.keys(b.elsewhere).find(x => Number(x.slice(1)) === Number(num[1])) : undefined;
        found = { q, match: Object.fromEntries(Object.entries(r.match).filter(([k]) => rows.slice(from, from + count).some(t => t.id === k))),
            ...(rows.length === 0 && id ? { elsewhere: { id, state: b.elsewhere[id] } } : {}) };
    }
    const items = rows.slice(from, from + count);
    const next = from + count < rows.length ? from + count : undefined;
    return { status: 200, body: { items, total: rows.length, from, ...(next !== undefined ? { next } : {}), rev: queueRev(b), head: 'h1', ...found } };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    ({ status, headers: { ...cors, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

/** What the research answers to a write by itself (and what it changes). */
/** The queue in the research's order with `queue.next`: the latest "next" first, the rest as it came, "last" ones by their time. */
function orderQueueNext(b: ManagedBridge, n: NonNullable<ManagedBridge['queueNext']>): void {
    const base = (q: Record<string, unknown>): number => n.base.indexOf(String(q.id));
    const at = (q: Record<string, unknown>): string => n.at.get(String(q.id)) ?? '';
    const next = b.queue.filter(q => q.state === 'next');
    b.queue = [
        ...next.filter(q => q.own === 'next').sort((x, y) => at(y).localeCompare(at(x))),
        ...next.filter(q => !q.own).sort((x, y) => base(x) - base(y)),
        ...next.filter(q => q.own === 'last').sort((x, y) => at(x).localeCompare(at(y))),
        ...b.queue.filter(q => q.state !== 'next'),
    ];
}

/** `POST /queue/<T>` with `queue.next`: next / last / default / restore, answered with the place before (`was`). */
function answerQueueNext(b: ManagedBridge, n: NonNullable<ManagedBridge['queueNext']>, id: string, body: Record<string, unknown>): BridgeReply {
    const q = b.queue.find(x => x.id === id);
    if (!q || q.state !== 'next') return { status: 404, body: { error: 'queue.none' } };
    const keys = Object.keys(body);
    const doing = b.working.some(w => !w.paused && w.task === q.text);
    if (doing) return { status: 409, body: { error: 'queue.doing' } };
    const was: Record<string, unknown> = q.own ? { own: q.own, at: n.at.get(id) } : {};
    let own: string | undefined;
    let at: string | undefined;
    if (body.do === 'restore' && keys.length === 2 && body.was && typeof body.was === 'object') {
        const w = body.was as Record<string, unknown>;
        const wk = Object.keys(w);
        if (wk.length === 0) own = undefined;
        else if (wk.length === 2 && (w.own === 'next' || w.own === 'last') && typeof w.at === 'string') {
            own = w.own;
            at = w.at;
        } else return { status: 400, body: { error: 'queue.body' } };
    } else if (keys.length === 1 && (body.do === 'next' || body.do === 'last')) {
        own = body.do;
        at = new Date(Date.UTC(2026, 10, 13, 10, 0, ++n.clock)).toISOString();
    } else if (keys.length === 1 && body.do === 'default') own = undefined;
    else return { status: 400, body: { error: 'queue.body' } };
    if (own) {
        if ((q.why as { kind?: string } | undefined)?.kind !== 'own') q.whyBefore = q.why;
        q.own = own;
        if (q.why || q.whyBefore) q.why = { kind: 'own', do: own };
        n.at.set(id, at!);
    } else {
        delete q.own;
        if ((q.why as { kind?: string } | undefined)?.kind === 'own') q.why = q.whyBefore ?? undefined;
        if (q.why === undefined) delete q.why;
        n.at.delete(id);
    }
    orderQueueNext(b, n);
    if (b.paged) b.paged.rev++;
    if (b.offLine) b.offLine.ownTasks = b.queue.filter(x => x.own).length;
    const { whyBefore: _w, ...sent } = q;
    return { status: 200, body: { task: sent, was, head: 'h1', parent: 'h1' } };
}

function answer(b: ManagedBridge, method: string, path: string, body: Record<string, unknown>): BridgeReply {
    const find = (id: string) => b.researches.find(d => d.id === id);
    if (method === 'GET' && path === 'directions/people') {
        const people: Record<string, string[]> = {};
        for (const d of b.researches) {
            if (d.state === 'done' || typeof d.focus !== 'string') continue;
            (people[d.focus] ??= []).push(d.id as string);
        }
        for (const [p, ids] of Object.entries(b.people ?? {})) people[p] = [...new Set([...(people[p] ?? []), ...ids])];
        return { status: 200, body: { people } };
    }
    const branches = (b.offLine?.branches ?? []) as Record<string, unknown>[];
    const branchGet = /^offline\/(B-P\d+)$/.exec(path);
    if (method === 'GET' && branchGet) {
        const br = branches.find(x => x.id === branchGet[1]);
        if (!br) return { status: 404, body: { error: 'offline.none' } };
        return { status: 200, body: { branch: br, tasks: b.queue.filter(q => q.branch === br.id).map(q => ({ id: q.id, text: q.text })) } };
    }
    if (method !== 'POST') return { status: 404, body: { error: 'not.found' } };
    // Work outside the directions (spec 038 K7): a branch's choice, the tree's, a task's own place, a growing branch's answer.
    const setBranch = (br: Record<string, unknown>, mode: string, line?: string): void => {
        if (mode === 'default') {
            br.mode = (b.offLine!.mode as string) ?? 'occasional';
            br.own = false;
            delete br.line;
        } else {
            br.mode = mode;
            br.own = true;
            if (mode === 'line') br.line = line ?? br.nearest;
            else delete br.line;
        }
    };
    if (branchGet) {
        const br = branches.find(x => x.id === branchGet[1]);
        if (!br) return { status: 404, body: { error: 'offline.none' } };
        if (body.mode === 'line' && !find(body.line as string)) return { status: 404, body: { error: 'directions.none' } };
        setBranch(br, body.mode as string, body.line as string | undefined);
        return { status: 200, body: { branch: br, head: 'h1', parent: 'h1' } };
    }
    if (path === 'offline') {
        if (typeof body.mode === 'string') b.offLine!.mode = body.mode === 'default' ? 'occasional' : body.mode;
        if (typeof body.suggest === 'boolean') b.offLine!.suggest = body.suggest;
        const { branches: _drop, ...rest } = b.offLine!;
        return { status: 200, body: { offLine: rest, head: 'h1', parent: 'h1' } };
    }
    const task = /^queue\/(T\d+)$/.exec(path);
    if (task && b.queueNext) return answerQueueNext(b, b.queueNext, task[1], body);
    if (task) {
        const q = b.queue.find(x => x.id === task[1]);
        if (!q) return { status: 404, body: { error: 'queue.none' } };
        // A queue read by pages: Do next puts the task first, To the end last; the order's print changes.
        if (b.paged && (body.do === 'next' || body.do === 'last')) {
            b.queue = body.do === 'next' ? [q, ...b.queue.filter(x => x !== q)] : [...b.queue.filter(x => x !== q), q];
            b.paged.rev++;
        }
        if (body.do === 'default') {
            delete q.own;
            if ((q.why as { kind?: string } | undefined)?.kind === 'own') q.why = q.whyBefore ?? undefined;
        } else {
            if ((q.why as { kind?: string } | undefined)?.kind !== 'own') q.whyBefore = q.why;
            q.own = body.do;
            q.why = { kind: 'own', do: body.do };
        }
        // The count of tasks with a manual place follows.
        if (b.offLine) b.offLine.ownTasks = b.queue.filter(x => x.own).length;
        const { whyBefore: _w, ...sent } = q;
        return { status: 200, body: { task: sent, head: 'h1', parent: 'h1' } };
    }
    const wait = /^waiting\/(W-B-P\d+)$/.exec(path);
    if (wait) {
        const w = b.waiting.find(x => x.id === wait[1]);
        if (!w) return { status: 404, body: { error: 'waiting.none', id: wait[1] } };
        b.waiting = b.waiting.filter(x => x !== w);
        const br = branches.find(x => x.id === w.branch);
        if (br && body.do === 'line') setBranch(br, 'line', (body.line as string | undefined) ?? (w.research as string));
        if (br && body.do === 'never') setBranch(br, 'never');
        return { status: 200, body: { branch: br, answer: body.do, head: 'h1', parent: 'h1' } };
    }
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
    /** `/status.offLine` (absent: none sent). */
    offLine?: Record<string, unknown>;
    /** `/status.queue` (absent: one task of G0001). */
    queue?: Record<string, unknown>[];
    /** `/status.waiting` (absent: none). */
    waiting?: Record<string, unknown>[];
    /** The research's tree (absent: `GED`). */
    ged?: string;
    /** Who else is in which direction (absent: each direction's person only). */
    people?: Record<string, string[]>;
    /** `queue` is the whole queue, read by pages (`queue.page` should be in `features`). */
    paged?: boolean;
    /** Task numbers outside the queue and their state (`queue.search`'s `elsewhere`). */
    elsewhere?: Record<string, string>;
    /** Links the research announces besides `ALL_LINKS` (seeded and in `/status.links`). */
    links?: string[];
    /** `/status.busy` (absent: none sent). */
    busy?: { sessions: number; runs: number };
    /** `/status.work` (absent: none sent). */
    work?: { gate: string | null; minutes: number };
} = {}): Promise<ManagedBridge> {
    const links = [...ALL_LINKS, ...(opts.links ?? [])];
    await page.setViewportSize(opts.size ?? { width: 1440, height: 900 });
    if (opts.fastReconnect) {
        await page.addInitScript(() => { (globalThis as { __LIVE_RECONNECT_MS?: number }).__LIVE_RECONNECT_MS = 250; });
    }
    await page.addInitScript((links) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('strom-research-links', JSON.stringify({ actions: links, at: new Date().toISOString() }));
    }, links);
    const b: ManagedBridge = {
        researches: structuredClone(opts.researches ?? MANAGED_DIRECTIONS),
        caps: opts.caps === undefined ? CAPS : opts.caps,
        working: opts.working ?? [MANAGED_AGENT],
        writes: [], replies: [], statusAsks: 0, down: false,
        offLine: opts.offLine ? structuredClone(opts.offLine) : null,
        queue: structuredClone(opts.queue ?? [{ id: 'T0101', text: 'Matriky Smrkov', state: 'next', research: 'G0001' }]),
        waiting: structuredClone(opts.waiting ?? []),
        ...(opts.people ? { people: structuredClone(opts.people) } : {}),
        ...(opts.paged ? { paged: { rev: 1 } } : {}),
        queueReads: [],
        elsewhere: opts.elsewhere ?? {},
        queueReplies: [],
        queueHold: null,
        ...(opts.busy ? { busy: { ...opts.busy } } : {}),
        ...(opts.work ? { work: { ...opts.work } } : {}),
    };
    if (opts.features?.includes('queue.next')) {
        b.queueNext = { base: b.queue.map(q => String(q.id)), at: new Map(), clock: 0 };
        // Tasks set by hand before, in the research's order: an earlier "next" set later, an earlier "last" set sooner.
        b.queue.forEach((q, i) => {
            if (q.own) b.queueNext!.at.set(String(q.id), new Date(Date.UTC(2026, 10, 13, 9, 0, q.own === 'next' ? 50 - i : i)).toISOString());
        });
    }
    const pagedFeature = !!opts.features?.includes('queue.page');
    const windowOf = (): Record<string, unknown>[] => {
        const all = queueWithPlaces(b);
        return [...all.filter(q => q.state === 'next').slice(0, QUEUE_WINDOW), ...all.filter(q => q.state === 'parked').slice(0, 6)];
    };
    const status = () => ({
        tree: { id: UUID, name: 'Fíškovi' }, head: 'h1', persons: 4,
        working: b.working,
        waiting: b.waiting,
        // An older research cuts the queue to the same window, without places and counts.
        ...(b.paged ? {
            queue: windowOf().map(({ pos, ...q }) => (pagedFeature ? { ...q, ...(pos ? { pos } : {}) } : q)),
            queueMore: Math.max(0, b.queue.filter(q => q.state === 'next').length - QUEUE_WINDOW),
            ...(pagedFeature ? { queueCounts: queueCounts(b) } : {}),
        } : { queue: b.queue.map(({ whyBefore: _w, ...q }) => q) }),
        links,
        researches: b.researches,
        ...(b.busy ? { busy: b.busy } : {}),
        ...(b.work ? { work: b.work } : {}),
        ...(b.caps ? { caps: b.caps } : {}),
        ...(b.offLine ? { offLine: b.offLine } : {}),
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
        if (path === 'tree.ged') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' }, body: opts.ged ?? GED });
        if (path === 'events') {
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body: `event: hello\ndata: ${JSON.stringify(status())}\n\n` });
        }
        if (path === 'queue' && req.method() === 'GET') {
            const query = new URL(req.url()).searchParams;
            query.delete('app');
            b.queueReads.push(query.toString());
            if (b.queueHold) await b.queueHold;
            const r = b.queueReplies.shift() ?? queuePage(b, query);
            return route.fulfill(json(r.body, r.status, r.headers));
        }
        if (/^(directions|offline|queue\/|waiting\/)/.test(path)) {
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
