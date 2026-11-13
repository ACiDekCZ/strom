/**
 * The research's whole queue, read by pages through its bridge (`GET
 * <token>/queue`, `queue.page` in `/status.features`, Strom Research 1.26):
 * a branch's or a direction's tasks, or the queue past the status's window,
 * each task with its place in the whole queue (`pos`).
 *
 * Read only when asked (a branch unfolded, a filter picked, "Load more"),
 * a page of 50 at a time, never the whole queue; at most QUEUE_ROWS_CAP tasks
 * per list (the rest is narrowed by a filter). The pages read stay valid
 * while the queue's print (`/status.queueCounts.rev`) stays the same: opening
 * the same branch again asks nothing. When it changes, the lists on screen
 * are read again after a short pause (one read for a burst of changes),
 * the others forgotten. A request for a list no longer shown is aborted.
 */

import { LiveQueueItem, sanitizeQueue, withAppVersion } from './research-link.js';
import { BRIDGE_ANSWER_MS } from './bridge-ask.js';

/** Tasks asked per page. */
export const QUEUE_PAGE = 50;
/** The bridge's own limit of one page. */
const QUEUE_PAGE_MAX = 100;
/**
 * Most tasks one list holds (and draws). A queue of thousands is not read
 * row by row: past this the list says how many it shows and a direction's
 * or a branch's filter narrows it. A fixed cap keeps the panel's keyboard
 * order, focus and screen reader whole, which a virtual list would not.
 */
export const QUEUE_ROWS_CAP = 300;
/** The pause after a change of the queue before the lists on screen are read again. */
export const QUEUE_REFRESH_MS = 800;
/** How long one page may take (a big research answers in seconds). */
const QUEUE_PAGE_TIMEOUT_MS = BRIDGE_ANSWER_MS;

/** What a list is narrowed to (none: the whole queue up next). */
export interface QueueFilter {
    branch?: string;
    research?: string;
    state?: 'next' | 'parked';
    /**
     * Searched text (`queue.search`, Strom Research 1.32): the tasks the bridge finds by it, after the
     * other filters (trimmed, 1–100 characters; never kept anywhere).
     */
    q?: string;
}

/**
 * Where a list is shown: the queue's filter, a branch unfolded in its section, a branch unfolded in a
 * direction's detail, the queue's search (beside the queue's own list while a search is being read).
 */
export type QueueSlot = 'queue' | 'branch' | 'helps' | 'search';

/** How a found task matched only by a number (`match`): its own id, or its person's. */
export type QueueMatch = 'id' | 'person';
/** The states a searched task's number may be in outside the queue (`elsewhere.state`). */
export const QUEUE_ELSEWHERE_STATES = ['done', 'waiting', 'parked', 'dropped'] as const;
export type QueueElsewhereState = typeof QUEUE_ELSEWHERE_STATES[number];
/** A searched task's number that is no longer in the queue, and what became of the task. */
export interface QueueElsewhere {
    id: string;
    state: QueueElsewhereState;
}
/** Most characters of a searched text (the bridge refuses a longer one). */
export const QUEUE_QUERY_MAX = 100;

/** A list read from the bridge. */
export interface QueueList {
    key: string;
    filter: QueueFilter;
    /** Its tasks in the queue's order (set-aside ones last, without `pos`). */
    items: LiveQueueItem[];
    /** How many tasks the filter leaves (null: not read yet). */
    total: number | null;
    /** `from` of the next page (null: none). */
    next: number | null;
    /** The queue's print the pages were read with ('' = not said). */
    rev: string;
    /** A page is being read. */
    loading: boolean;
    /** The last read failed: `busy` (the research works), else no answer or a refusal. */
    error: 'busy' | 'failed' | null;
    /** A search's tasks found only by a number (by task id; absent: none, or not a search). */
    match?: Record<string, QueueMatch>;
    /** A search's task number no longer in the queue (absent: none, or not a search). */
    elsewhere?: QueueElsewhere;
}

export type QueuePageResult =
    | { ok: true; items: LiveQueueItem[]; total: number; from: number; next: number | null; rev: string; head: string;
        match?: Record<string, QueueMatch>; elsewhere?: QueueElsewhere }
    | { ok: false; code: 'busy' | 'failed' | 'aborted' };

/** A filter's key (`branch=B-P0004&research=…&state=…&q=…`, '' = the whole queue). */
export function queueFilterKey(f: QueueFilter): string {
    const parts: string[] = [];
    if (f.branch) parts.push(`branch=${f.branch}`);
    if (f.research) parts.push(`research=${f.research}`);
    if (f.state) parts.push(`state=${f.state}`);
    if (f.q) parts.push(`q=${encodeURIComponent(f.q)}`);
    return parts.join('&');
}

/** A searched text as it is sent: trimmed, at most QUEUE_QUERY_MAX characters ('' = no search). */
export function queueQuery(text: string): string {
    return [...text.trim()].slice(0, QUEUE_QUERY_MAX).join('').trim();
}

const TASK_ID_RE = /^T\d{1,9}$/;

/** `match` of a search's page, checked: task ids to 'id' / 'person' (absent: none valid). */
function sanitizeMatch(v: unknown): Record<string, QueueMatch> | undefined {
    const r = asRecord(v);
    if (!r) return undefined;
    const out: Record<string, QueueMatch> = {};
    let n = 0;
    for (const [id, how] of Object.entries(r)) {
        if (n >= QUEUE_PAGE_MAX) break;
        // `task` is the same as `id` (the number of the task matched).
        const m = how === 'task' ? 'id' : how;
        if (!TASK_ID_RE.test(id) || (m !== 'id' && m !== 'person')) continue;
        out[id] = m;
        n++;
    }
    return n > 0 ? out : undefined;
}

/** `elsewhere` of a search, checked (absent: none, or a state the app does not name). */
function sanitizeElsewhere(v: unknown): QueueElsewhere | undefined {
    const r = asRecord(v);
    if (!r || typeof r.id !== 'string' || !TASK_ID_RE.test(r.id)) return undefined;
    const state = (QUEUE_ELSEWHERE_STATES as readonly unknown[]).includes(r.state) ? r.state as QueueElsewhereState : null;
    return state ? { id: r.id, state } : undefined;
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const asCount = (v: unknown): number | null =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10_000_000 ? v : null;

/** One page of the queue (`GET <token>/queue?from=…&count=…&…`). Never throws. */
export async function fetchQueuePage(base: string, filter: QueueFilter, from: number, count: number,
    signal?: AbortSignal): Promise<QueuePageResult> {
    if (typeof fetch !== 'function' || !base) return { ok: false, code: 'failed' };
    const q = new URLSearchParams();
    if (from > 0) q.set('from', String(from));
    q.set('count', String(Math.max(1, Math.min(QUEUE_PAGE_MAX, count))));
    if (filter.branch) q.set('branch', filter.branch);
    if (filter.research) q.set('research', filter.research);
    if (filter.state) q.set('state', filter.state);
    const query = filter.q ? queueQuery(filter.q) : '';
    if (query) q.set('q', query);
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), QUEUE_PAGE_TIMEOUT_MS) : null;
    const onAbort = (): void => ctl?.abort();
    signal?.addEventListener('abort', onAbort);
    try {
        const res = await fetch(withAppVersion(`${base}/queue?${q.toString()}`), {
            method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', signal: ctl?.signal,
        });
        if (res.status === 503) return { ok: false, code: 'busy' };
        if (res.status < 200 || res.status >= 300) return { ok: false, code: 'failed' };
        const r = asRecord(await res.json());
        const total = asCount(r?.total);
        if (!r || total === null) return { ok: false, code: 'failed' };
        // The answer of another search (an older one): not this list's.
        if (query && typeof r.q === 'string' && r.q !== query) return { ok: false, code: 'aborted' };
        const next = asCount(r.next);
        const match = query ? sanitizeMatch(r.match) : undefined;
        const elsewhere = query ? sanitizeElsewhere(r.elsewhere) : undefined;
        return {
            ok: true,
            items: sanitizeQueue(r.items, true, true, QUEUE_PAGE_MAX),
            total,
            from: asCount(r.from) ?? from,
            next: next !== null && next > from ? next : null,
            rev: typeof r.rev === 'string' && /^[0-9a-f]{8,64}$/.test(r.rev) ? r.rev : '',
            head: typeof r.head === 'string' ? r.head.slice(0, 80) : '',
            ...(match ? { match } : {}),
            ...(elsewhere ? { elsewhere } : {}),
        };
    } catch {
        return { ok: false, code: signal?.aborted ? 'aborted' : 'failed' };
    } finally {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
    }
}

// ==================== THE LISTS ====================

/** The bridge the lists were read from; another one forgets them all. */
let listsBase = '';
/** The queue's print the lists are valid for ('' = not said). */
let listsRev = '';
const lists = new Map<string, QueueList>();
/** What each place on screen shows now (a list's key). */
const slots = new Map<QueueSlot, string>();
/** Reads under way, by list. */
const running = new Map<string, AbortController>();
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let listener: (() => void) | null = null;

/** Called after a list changed (read, failed, refreshed): the panel draws it again. */
export function onQueueListsChange(fn: (() => void) | null): void {
    listener = fn;
}

function changed(): void {
    listener?.();
}

function forBase(base: string): void {
    if (base === listsBase) return;
    resetQueueLists();
    listsBase = base;
}

/** Forget every list and stop every read (another bridge, following ended, a test). */
export function resetQueueLists(): void {
    for (const ctl of running.values()) ctl.abort();
    running.clear();
    lists.clear();
    slots.clear();
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
    listsBase = '';
    listsRev = '';
}

/**
 * The Research overview in a window of its own (K3, spec 052 §1 there): its
 * lists are its own, but each page is asked of the main window (`queue-list`),
 * which reads it from its bridge with `fetchQueuePage` and answers with the
 * page; nothing is read from a bridge here.
 */
export interface QueueRemote {
    /** One page of a list, as `fetchQueuePage` answers it (a failed or missing answer: `failed`). */
    page(filter: QueueFilter, from: number, count: number): Promise<QueuePageResult>;
    /** The main window's research answers through its bridge now (its snapshot says so). */
    up(): boolean;
}
let remote: QueueRemote | null = null;

/** Pages are asked of the main window and the lists are this window's (null: read from the bridge, as everywhere else). */
export function setQueueRemote(r: QueueRemote | null): void {
    resetQueueLists();
    remote = r;
}

/** The main window this window's pages are asked of (null: none, the bridge is asked directly). */
export function queueRemote(): QueueRemote | null {
    return remote;
}

/** A page as the main window answered it, checked (anything else: `failed`). */
export function readQueuePage(v: unknown): QueuePageResult {
    const r = asRecord(v);
    if (!r) return { ok: false, code: 'failed' };
    if (r.ok !== true) return { ok: false, code: r.code === 'busy' || r.code === 'aborted' ? r.code : 'failed' };
    const total = asCount(r.total);
    const from = asCount(r.from);
    if (total === null || from === null) return { ok: false, code: 'failed' };
    const next = asCount(r.next);
    const match = sanitizeMatch(r.match);
    const elsewhere = sanitizeElsewhere(r.elsewhere);
    return {
        ok: true,
        items: sanitizeQueue(r.items, true, true, QUEUE_PAGE_MAX),
        total,
        from,
        next: next !== null && next > from ? next : null,
        rev: typeof r.rev === 'string' && /^[0-9a-f]{8,64}$/.test(r.rev) ? r.rev : '',
        head: typeof r.head === 'string' ? r.head.slice(0, 80) : '',
        ...(match ? { match } : {}),
        ...(elsewhere ? { elsewhere } : {}),
    };
}

/** One page of a list: from the bridge, or asked of the main window (an aborted read answers `aborted` at once). */
function readOnePage(base: string, filter: QueueFilter, from: number, count: number, signal: AbortSignal): Promise<QueuePageResult> {
    if (!remote) return fetchQueuePage(base, filter, from, count, signal);
    const r = remote;
    return new Promise<QueuePageResult>((resolve) => {
        const onAbort = (): void => resolve({ ok: false, code: 'aborted' });
        if (signal.aborted) return onAbort();
        signal.addEventListener('abort', onAbort, { once: true });
        r.page(filter, from, count).then(
            (page) => resolve(signal.aborted ? { ok: false, code: 'aborted' } : page),
            () => resolve({ ok: false, code: signal.aborted ? 'aborted' : 'failed' }),
        ).finally(() => signal.removeEventListener('abort', onAbort));
    });
}

/** The list of `filter` read from `base` (null: not asked yet, or another bridge). */
export function queueList(base: string, filter: QueueFilter): QueueList | null {
    if (remote) return lists.get(queueFilterKey(filter)) ?? null;
    return base && base === listsBase ? lists.get(queueFilterKey(filter)) ?? null : null;
}

/** A task of any list read (the ⋯ menu of a task past the status's window). */
export function queueListItem(base: string, id: string): LiveQueueItem | null {
    if (!remote && (!base || base !== listsBase)) return null;
    for (const l of lists.values()) {
        const q = l.items.find(x => x.id === id);
        if (q) return q;
    }
    return null;
}

/**
 * "Do next" written: the task first in every list read that holds it (a search's too), marked next,
 * and the places of the tasks before it moved one on in every list. The lists are read again
 * with the queue's next print; this only keeps the screen right meanwhile.
 */
export function moveQueueItemFirst(base: string, id: string): void {
    if (!remote && (!base || base !== listsBase)) return;
    let was: number | undefined;
    for (const l of lists.values()) was ??= l.items.find(x => x.id === id)?.pos;
    for (const l of lists.values()) {
        const at = l.items.findIndex(x => x.id === id);
        const items = l.items.map(x => (x.id !== id && x.state === 'next' && x.pos !== undefined && (was === undefined || x.pos < was)
            ? { ...x, pos: x.pos + 1 } : x));
        if (at >= 0) {
            const [moved] = items.splice(at, 1);
            items.unshift({
                ...moved, own: 'next', ...(moved.why ? { why: { kind: 'own', do: 'next' } } : {}),
                ...(moved.pos !== undefined || was !== undefined ? { pos: 1 } : {}),
            });
        }
        l.items = items;
    }
}

/**
 * A task's place as the bridge answered a write of it (`task` with its `pos`, `own` and `why` as the
 * queue has them now): the task moved to that place in `items` and drawn as the answer says, the places
 * of the tasks between its old place and its new one moved by one. `cut`: more tasks follow those held
 * (a status's window, a list not read to its end); a task whose new place lies past the ones held leaves
 * them (`out`). Without a place in the answer, or the task not held, only its row is replaced.
 */
export function placeQueueItem(items: LiveQueueItem[], now: LiveQueueItem, cut: boolean): { items: LiveQueueItem[]; out: boolean } {
    const at = items.findIndex(x => x.id === now.id);
    if (at < 0) return { items, out: false };
    const from = items[at].pos;
    const to = now.pos;
    if (from === undefined || to === undefined || items[at].state !== 'next' || now.state !== 'next') {
        const same = [...items];
        same[at] = now;
        return { items: same, out: false };
    }
    const rest = items.filter((_, i) => i !== at).map(x => {
        if (x.state !== 'next' || x.pos === undefined) return x;
        let p = x.pos;
        if (p > from) p--;
        if (p >= to) p++;
        return p === x.pos ? x : { ...x, pos: p };
    });
    const held = rest.filter(x => x.state === 'next' && x.pos !== undefined);
    const last = held.length > 0 ? held[held.length - 1].pos! : 0;
    let i = rest.findIndex(x => x.state === 'next' && x.pos !== undefined && x.pos > to);
    if (i < 0) {
        // Past the tasks held: next to the last one when its place follows it, else out of the ones held.
        if (cut && to > last + 1) return { items: rest, out: true };
        const lastNext = rest.reduce((n, x, k) => (x.state === 'next' ? k : n), -1);
        i = lastNext + 1;
    }
    rest.splice(i, 0, now);
    return { items: rest, out: false };
}

/**
 * A task's place written (Undo of "Do next", `restore`): the task at the place the bridge answered in every
 * list read that holds it, the others' places moved by one. The lists are read again with the queue's next
 * print; this keeps the screen right meanwhile.
 */
export function placeQueueItemInLists(base: string, now: LiveQueueItem): void {
    if (!remote && (!base || base !== listsBase)) return;
    for (const l of lists.values()) {
        const r = placeQueueItem(l.items, now, l.next !== null);
        if (r.out && l.next !== null) l.next = Math.max(0, l.next - 1);
        l.items = r.items;
    }
}

/** Abort the read of a list nothing shows any more. */
function settleSlot(slot: QueueSlot, key: string | null): void {
    const was = slots.get(slot);
    if (key === null) slots.delete(slot);
    else slots.set(slot, key);
    if (was === undefined || was === key || [...slots.values()].includes(was)) return;
    const ctl = running.get(was);
    if (ctl) {
        ctl.abort();
        running.delete(was);
        const l = lists.get(was);
        if (l) {
            l.loading = false;
            // Nothing read yet: asked again from the start next time.
            if (l.total === null) lists.delete(was);
        }
    }
}

/** The places asked for in the drawing under way (null: none under way). */
let touched: Set<QueueSlot> | null = null;

/** A drawing of the overview starts: a place it does not ask for again shows nothing any more. */
export function beginQueueSlots(): void {
    touched = new Set();
}

/** The drawing is done: the places it did not ask for are let go (their reads aborted). */
export function endQueueSlots(): void {
    const t = touched;
    touched = null;
    for (const slot of [...slots.keys()]) if (!t?.has(slot)) settleSlot(slot, null);
}

/** Nothing is shown in `slot` now (a branch folded, the filter cleared). */
export function releaseQueueSlot(slot: QueueSlot): void {
    settleSlot(slot, null);
}

/**
 * The list of `filter` for `slot`: read its first page unless it is read
 * (or being read) already with the queue's current print. Returns the list as
 * it is now (loading: no tasks yet).
 */
export function requestQueueList(base: string, filter: QueueFilter, slot: QueueSlot,
    seed?: { items: LiveQueueItem[]; total: number }): QueueList {
    forBase(base);
    const key = queueFilterKey(filter);
    touched?.add(slot);
    settleSlot(slot, key);
    const have = lists.get(key);
    if (have && (have.loading || have.total !== null || have.error)) return have;
    const l: QueueList = {
        key, filter, items: seed ? seed.items.slice(0, QUEUE_ROWS_CAP) : [], total: seed ? seed.total : null,
        next: seed ? (seed.items.length < seed.total ? seed.items.length : null) : 0, rev: listsRev, loading: false, error: null,
    };
    lists.set(key, l);
    if (!seed) void readPage(base, l, 0, QUEUE_PAGE);
    return l;
}

/** Read the list's next page ("Load more"); nothing past QUEUE_ROWS_CAP or the end. */
export function loadMoreQueueList(base: string, filter: QueueFilter, slot: QueueSlot,
    seed?: { items: LiveQueueItem[]; total: number }): void {
    const l = requestQueueList(base, filter, slot, seed);
    if (l.loading) return;
    const from = l.error && l.total === null ? 0 : l.next;
    if (from === null) return;
    const room = QUEUE_ROWS_CAP - l.items.length;
    if (room <= 0) return;
    void readPage(base, l, from, Math.min(QUEUE_PAGE, room));
}

/** Try a failed list again. */
export function retryQueueList(base: string, filter: QueueFilter, slot: QueueSlot): void {
    const l = requestQueueList(base, filter, slot);
    if (l.loading) return;
    l.error = null;
    void readPage(base, l, l.total === null ? 0 : l.next ?? l.items.length, QUEUE_PAGE);
}

async function readPage(base: string, l: QueueList, from: number, count: number): Promise<void> {
    running.get(l.key)?.abort();
    const ctl = new AbortController();
    running.set(l.key, ctl);
    l.loading = true;
    l.error = null;
    const r = await readOnePage(base, l.filter, from, count, ctl.signal);
    if (running.get(l.key) !== ctl) return;
    running.delete(l.key);
    if (lists.get(l.key) !== l) return;
    l.loading = false;
    if (!r.ok) {
        if (r.code !== 'aborted') l.error = r.code;
        changed();
        return;
    }
    // Read with another print than the others: the queue changed meanwhile; the next status tells which is newer.
    if (r.rev) l.rev = r.rev;
    const seen = new Set(from === 0 ? [] : l.items.map(q => q.id));
    const page = r.items.filter(q => !seen.has(q.id));
    l.items = (from === 0 ? page : [...l.items, ...page]).slice(0, QUEUE_ROWS_CAP);
    l.total = r.total;
    l.next = r.next !== null && l.items.length < QUEUE_ROWS_CAP ? r.next : null;
    if (l.filter.q) {
        const match = { ...(from === 0 ? {} : l.match), ...r.match };
        if (Object.keys(match).length > 0) l.match = match;
        else delete l.match;
        if (from === 0 || r.elsewhere) {
            if (r.elsewhere) l.elsewhere = r.elsewhere;
            else delete l.elsewhere;
        }
    }
    changed();
}

/**
 * The queue's print of the latest status. A new one keeps only the lists on
 * screen and reads them again, as far as they were read, after
 * QUEUE_REFRESH_MS (a burst of changes reads once); a list read with this
 * print already stays.
 */
export function noteQueueRev(base: string, rev: string): void {
    forBase(base);
    if (!rev || rev === listsRev) return;
    listsRev = rev;
    const shown = new Set(slots.values());
    for (const key of [...lists.keys()]) {
        if (shown.has(key)) continue;
        running.get(key)?.abort();
        running.delete(key);
        lists.delete(key);
    }
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void refreshShown(base);
    }, QUEUE_REFRESH_MS);
}

/** Read the lists on screen again from their start, as many tasks as they held. */
async function refreshShown(base: string): Promise<void> {
    if (base !== listsBase) return;
    const rev = listsRev;
    for (const key of new Set(slots.values())) {
        const l = lists.get(key);
        if (!l || l.rev === rev || l.loading) continue;
        const want = Math.max(QUEUE_PAGE, Math.min(QUEUE_ROWS_CAP, l.items.length));
        const ctl = new AbortController();
        running.set(key, ctl);
        let items: LiveQueueItem[] = [];
        let total: number | null = null;
        let next: number | null = 0;
        let got = '';
        let failed = false;
        let match: Record<string, QueueMatch> = {};
        let elsewhere: QueueElsewhere | undefined;
        while (next !== null && items.length < want) {
            const r = await readOnePage(base, l.filter, next, Math.min(QUEUE_PAGE_MAX, want - items.length), ctl.signal);
            if (!r.ok) { failed = true; break; }
            items = [...items, ...r.items];
            total = r.total;
            next = r.next;
            got = r.rev;
            match = { ...match, ...r.match };
            elsewhere ??= r.elsewhere;
        }
        if (running.get(key) === ctl) running.delete(key);
        if (failed || ctl.signal.aborted || lists.get(key) !== l) continue;
        l.items = items.slice(0, QUEUE_ROWS_CAP);
        l.total = total;
        l.next = next !== null && l.items.length < QUEUE_ROWS_CAP ? next : null;
        l.rev = got || rev;
        if (l.filter.q) {
            if (Object.keys(match).length > 0) l.match = match;
            else delete l.match;
            if (elsewhere) l.elsewhere = elsewhere;
            else delete l.elsewhere;
        }
        changed();
    }
}
