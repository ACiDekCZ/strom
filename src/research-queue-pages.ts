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
}

/** Where a list is shown: the queue's filter, a branch unfolded in its section, a branch unfolded in a direction's detail. */
export type QueueSlot = 'queue' | 'branch' | 'helps';

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
}

export type QueuePageResult =
    | { ok: true; items: LiveQueueItem[]; total: number; from: number; next: number | null; rev: string; head: string }
    | { ok: false; code: 'busy' | 'failed' | 'aborted' };

/** A filter's key (`branch=B-P0004&research=…&state=…`, '' = the whole queue). */
export function queueFilterKey(f: QueueFilter): string {
    const parts: string[] = [];
    if (f.branch) parts.push(`branch=${f.branch}`);
    if (f.research) parts.push(`research=${f.research}`);
    if (f.state) parts.push(`state=${f.state}`);
    return parts.join('&');
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
        const next = asCount(r.next);
        return {
            ok: true,
            items: sanitizeQueue(r.items, true, true, QUEUE_PAGE_MAX),
            total,
            from: asCount(r.from) ?? from,
            next: next !== null && next > from ? next : null,
            rev: typeof r.rev === 'string' && /^[0-9a-f]{8,64}$/.test(r.rev) ? r.rev : '',
            head: typeof r.head === 'string' ? r.head.slice(0, 80) : '',
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

/** The list of `filter` read from `base` (null: not asked yet, or another bridge). */
export function queueList(base: string, filter: QueueFilter): QueueList | null {
    return base && base === listsBase ? lists.get(queueFilterKey(filter)) ?? null : null;
}

/** A task of any list read (the ⋯ menu of a task past the status's window). */
export function queueListItem(base: string, id: string): LiveQueueItem | null {
    if (!base || base !== listsBase) return null;
    for (const l of lists.values()) {
        const q = l.items.find(x => x.id === id);
        if (q) return q;
    }
    return null;
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
    const r = await fetchQueuePage(base, l.filter, from, count, ctl.signal);
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
        while (next !== null && items.length < want) {
            const r = await fetchQueuePage(base, l.filter, next, Math.min(QUEUE_PAGE_MAX, want - items.length), ctl.signal);
            if (!r.ok) { failed = true; break; }
            items = [...items, ...r.items];
            total = r.total;
            next = r.next;
            got = r.rev;
        }
        if (running.get(key) === ctl) running.delete(key);
        if (failed || ctl.signal.aborted || lists.get(key) !== l) continue;
        l.items = items.slice(0, QUEUE_ROWS_CAP);
        l.total = total;
        l.next = next !== null && l.items.length < QUEUE_ROWS_CAP ? next : null;
        l.rev = got || rev;
        changed();
    }
}
