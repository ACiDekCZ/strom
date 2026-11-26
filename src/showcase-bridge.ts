/**
 * The bridge of a showcase's research (spec 143 K4): the research's snapshot
 * in the showcase file (`research.status|log|material|queue`), answered in
 * the page at `<origin>/__showcase/<research>` (showcaseBridgeBase), so the
 * app's own code reads the overview, the log, the queue, the materials and
 * what waits as from any bridge — no second way of reading them.
 *
 * - the snapshot is kept with its research's id (localStorage; only in memory
 *   when the browser keeps nothing) and goes with the showcase tree;
 * - one `fetch` interceptor, installed only while a snapshot is kept: a GET
 *   of a showcase base is answered from the snapshot, an unknown GET is 404
 *   (as an older bridge), and anything else is refused (403
 *   `showcase.read-only`) — nothing is ever sent anywhere;
 * - the live events: a stand-in for the bridge's EventSource that says one
 *   `hello` (the snapshot's status) and nothing more.
 */

import { parseShowcaseBridge, queueTaskKindOf, setShowcaseBridges, showcaseOriginOf } from './research-link.js';
import type { ShowcaseResearch } from './showcase-format.js';
import { STATUS_PARTS } from './status-parts.js';

/** localStorage: a showcase research's snapshot, by its id. */
const SNAPSHOT_KEY = 'strom-showcase-research:';

/** The refusal of any write (POST, PUT, DELETE…) to a showcase's bridge. */
export const SHOWCASE_READ_ONLY = 'showcase.read-only';

/** The snapshots kept in this page, by research id (lowercase). */
const snapshots = new Map<string, ShowcaseResearch>();
let origin = '';

function pageOrigin(): string {
    try {
        return typeof location !== 'undefined' ? location.origin : '';
    } catch {
        return '';
    }
}

function store(): Storage | null {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
        return null;
    }
}

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/**
 * Features of a snapshot's status the shim cannot answer (it has the status,
 * the log, the material and the queue only): each would make the app read
 * by the bridge what is not there — an excerpt or a scan (`excerpt.get`,
 * `material.thumb`, anything `media.`: the showcase's images and excerpts are
 * in its tree, inline), the tree's file by its images' hashes, a file's uses,
 * the phone's code, and the reads of their own endpoints (the time's events,
 * the quality, the fixes, the surnames, the lineage, who stands in which
 * line, what is new, the device's glance, its search and finds). Taken out
 * of the status, so the app does not ask for them at all.
 */
export const SHOWCASE_UNANSWERED_FEATURES: readonly string[] = [
    'excerpt.get', 'material.thumb', 'material.uses', 'ged.imagesByHash', 'phone', 'history.events', 'quality.read',
    'fixes.list', 'surnames.read', 'lineage.read', 'directions.people', 'directions.places', 'whats.new', 'glance',
    'people.search', 'finds', 'finds.person',
];

/** A feature the shim cannot answer (SHOWCASE_UNANSWERED_FEATURES, or any `media.`). */
export function showcaseUnanswered(feature: string): boolean {
    return feature.startsWith('media.') || SHOWCASE_UNANSWERED_FEATURES.includes(feature);
}

/**
 * Writes the app offers or makes by a feature alone, with no action of the research to grey (spec 143 K4.1):
 * confirming a source's transcript or a fact from the record, sending the tree check's "not an error" marks
 * (they stay marks of the tree here), and a material's assigning, editing, sorting and deleting. Left out of
 * the status, so the showcase neither draws nor tries them.
 */
export const SHOWCASE_WRITE_FEATURES: readonly string[] = [
    'sources.confirm', 'facts.confirm', 'facts.confirm.value', 'quality.dismiss',
    'material.assign', 'material.edit', 'material.sort', 'material.sortRun', 'material.delete', 'material.trees',
];

/** The snapshot's status as the shim gives it: what it cannot answer, and its writes, left out of `features`. */
function showcaseStatusOf(status: Record<string, unknown> | null): Record<string, unknown> | null {
    if (!status || !Array.isArray(status.features)) return status;
    return {
        ...status,
        features: status.features.filter(f => typeof f === 'string' && !showcaseUnanswered(f) && !SHOWCASE_WRITE_FEATURES.includes(f)),
    };
}

/** A snapshot as stored (each part a JSON object or null), or null. */
function snapshotOf(value: unknown): ShowcaseResearch | null {
    const r = record(value);
    if (!r || typeof r.id !== 'string' || !/^[\w-]{1,64}$/.test(r.id)) return null;
    const part = (v: unknown): Record<string, unknown> | null => record(v);
    return { id: r.id.toLowerCase(), status: showcaseStatusOf(part(r.status)), log: part(r.log), material: part(r.material), queue: part(r.queue) };
}

/** The research's bridges said to the research's code, and the interceptor in place while any is kept. */
function announce(): void {
    setShowcaseBridges(snapshots.size > 0 ? showcaseOriginOf(origin || pageOrigin()) : null, [...snapshots.keys()]);
    if (snapshots.size > 0) installShowcaseFetch();
    else uninstallShowcaseFetch();
}

/**
 * The research's snapshot of a showcase opened now: kept with its id (stored
 * for the next start; in memory only when the browser keeps nothing) and
 * answered from now on.
 */
export function keepShowcaseResearch(snapshot: ShowcaseResearch, at: string = pageOrigin()): void {
    const snap = snapshotOf(snapshot);
    if (!snap) return;
    origin = at;
    snapshots.set(snap.id, snap);
    try {
        store()?.setItem(SNAPSHOT_KEY + snap.id, JSON.stringify(snap));
    } catch { /* no room: kept for this page only */ }
    announce();
}

/** The showcase research's snapshot goes (its tree was deleted): its bridge answers no more. */
export function forgetShowcaseResearch(researchId: string): void {
    const id = researchId.toLowerCase();
    snapshots.delete(id);
    try {
        store()?.removeItem(SNAPSHOT_KEY + id);
    } catch { /* nothing kept */ }
    announce();
}

/**
 * At the app's start: the snapshots kept before, for the researches `keep`
 * still names (a showcase tree's); any other goes. Returns those kept.
 */
export function restoreShowcaseResearch(keep: (researchId: string) => boolean, at: string = pageOrigin()): ShowcaseResearch[] {
    origin = at;
    const s = store();
    const found: ShowcaseResearch[] = [];
    if (s) {
        const keys: string[] = [];
        try {
            for (let i = 0; i < s.length; i++) {
                const key = s.key(i);
                if (key?.startsWith(SNAPSHOT_KEY)) keys.push(key);
            }
        } catch { /* nothing to read */ }
        for (const key of keys) {
            let snap: ShowcaseResearch | null = null;
            try {
                snap = snapshotOf(JSON.parse(s.getItem(key) ?? 'null'));
            } catch { /* broken: goes */ }
            if (snap && snap.id === key.slice(SNAPSHOT_KEY.length) && keep(snap.id)) {
                snapshots.set(snap.id, snap);
                continue;
            }
            try { s.removeItem(key); } catch { /* stays */ }
        }
    }
    // Kept in memory only (a browser that stores nothing): those of trees still here.
    for (const id of [...snapshots.keys()]) if (!keep(id)) snapshots.delete(id);
    for (const snap of snapshots.values()) found.push(snap);
    announce();
    return found;
}

/** The snapshot of a showcase research, or null. */
export function showcaseSnapshot(researchId: string): ShowcaseResearch | null {
    return snapshots.get(researchId.toLowerCase()) ?? null;
}

/** Every snapshot forgotten in this page, nothing stored touched (the tests). */
export function resetShowcaseBridgeForTest(): void {
    snapshots.clear();
    origin = '';
    announce();
}

// ——— the answers ———

function json(status: number, body: unknown, head = false): Response {
    return new Response(head ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
}

/** A short rev of a part, the same for the same snapshot (only compared). */
function revOf(value: unknown): string {
    const text = JSON.stringify(value ?? null);
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(16).padStart(8, '0');
}

/** How a queue item reads in a search: its text, its id, the person it is about (lowercase, no accents). */
function folded(text: string): string {
    return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * The kinds of the app's first list (spec 065 K7.4): `other` is any kind beyond them and beyond those `known`
 * names (census, house: counted on their own when the research has them), as research-queue-pages asks it.
 */
const FIRST_TASK_KINDS: ReadonlySet<string> = new Set(['verify', 'records', 'material', 'places', 'enrich', 'request', 'story', 'history']);

/** A task of `kind` as the bridge narrows the queue (`kind=`, `known=`); a task saying no kind is `other`. */
function ofKind(taskKind: unknown, kind: string, known: ReadonlySet<string>): boolean {
    const k = typeof taskKind === 'string' && queueTaskKindOf(taskKind) !== null ? taskKind.toLowerCase() : 'other';
    if (kind === 'other') return !FIRST_TASK_KINDS.has(k) && !known.has(k);
    return k === kind;
}

/** One page of the snapshot's queue, narrowed as the bridge narrows it (`branch`, `research`, `state`, `kind`, `q`). */
export function showcaseQueuePage(queue: Record<string, unknown>, query: URLSearchParams): Record<string, unknown> {
    const all = Array.isArray(queue.items) ? queue.items.filter((i): i is Record<string, unknown> => !!record(i)) : [];
    const branch = query.get('branch');
    const research = query.get('research');
    const state = query.get('state');
    const kind = query.get('kind');
    const known = new Set((query.get('known') ?? '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean));
    const q = (query.get('q') ?? '').trim();
    const words = q ? folded(q).split(/\s+/).filter(Boolean) : [];
    const items = all.filter(i => {
        if (branch && i.branch !== branch) return false;
        if (research && i.research !== research) return false;
        if (state && i.state !== state) return false;
        if (kind && !ofKind(i.taskKind, kind, known)) return false;
        if (words.length > 0) {
            const text = folded([i.text, i.id, i.person].filter(v => typeof v === 'string').join(' '));
            if (!words.every(w => text.includes(w))) return false;
        }
        return true;
    });
    const count = Math.max(1, Math.min(100, Number.parseInt(query.get('count') ?? '', 10) || 100));
    const from = Math.max(0, Number.parseInt(query.get('from') ?? '', 10) || 0);
    const page = items.slice(from, from + count);
    const next = from + count < items.length ? from + count : null;
    return {
        items: page,
        total: items.length,
        from,
        ...(next !== null ? { next } : {}),
        rev: typeof queue.rev === 'string' ? queue.rev : revOf(queue.items),
        head: typeof queue.head === 'string' ? queue.head : '',
        ...(q ? { q } : {}),
    };
}

/** A part of the status (`GET status/<part>`): its fields, its rev. */
function statusPart(status: Record<string, unknown>, name: string): Record<string, unknown> | null {
    const fields = STATUS_PARTS[name];
    if (!fields) return null;
    const out: Record<string, unknown> = { part: name };
    for (const f of fields) if (f in status) out[f] = status[f];
    out.rev = revOf(out);
    return out;
}

/**
 * The answer of a showcase research's bridge to `method path` (path with its
 * query, after the base): GET and HEAD from the snapshot, 404 for what it has
 * not; any other method refused.
 */
export function showcaseBridgeAnswer(method: string, researchId: string, path: string): Response {
    const m = method.toUpperCase();
    if (m !== 'GET' && m !== 'HEAD') return json(403, { error: SHOWCASE_READ_ONLY });
    const head = m === 'HEAD';
    const snap = showcaseSnapshot(researchId);
    const q = path.indexOf('?');
    const name = (q < 0 ? path : path.slice(0, q)).replace(/^\/+|\/+$/g, '');
    const query = new URLSearchParams(q < 0 ? '' : path.slice(q + 1));
    const notFound = (): Response => json(404, { error: 'not-found' }, head);
    if (!snap) return notFound();
    if (name === 'status') return snap.status ? json(200, snap.status, head) : notFound();
    if (name.startsWith('status/')) {
        const part = snap.status ? statusPart(snap.status, name.slice('status/'.length)) : null;
        return part ? json(200, part, head) : notFound();
    }
    if (name === 'log') return snap.log ? json(200, snap.log, head) : notFound();
    if (name === 'material') return snap.material ? json(200, snap.material, head) : notFound();
    if (name === 'queue') return snap.queue ? json(200, showcaseQueuePage(snap.queue, query), head) : notFound();
    return notFound();
}

function abortError(): Error {
    try {
        return new DOMException('The operation was aborted.', 'AbortError');
    } catch {
        const e = new Error('The operation was aborted.');
        e.name = 'AbortError';
        return e;
    }
}

/** A request of a showcase base answered from its snapshot, else null (not one). */
export function showcaseBridgeRequest(input: RequestInfo | URL, init?: RequestInit): Promise<Response> | null {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const target = parseShowcaseBridge(url);
    if (!target) return null;
    const req = typeof input === 'object' && !(input instanceof URL) ? input : null;
    const signal = init?.signal ?? req?.signal ?? null;
    if (signal?.aborted) return Promise.reject(abortError());
    return Promise.resolve(showcaseBridgeAnswer(init?.method ?? req?.method ?? 'GET', target.researchId, target.path));
}

let pageFetch: typeof fetch | null = null;

/** The interceptor in place (once, while a snapshot is kept). */
export function installShowcaseFetch(): void {
    if (pageFetch || typeof globalThis.fetch !== 'function') return;
    const original = globalThis.fetch;
    pageFetch = original;
    const wrapped: typeof fetch = (input, init) => showcaseBridgeRequest(input, init) ?? original.call(globalThis, input, init);
    globalThis.fetch = wrapped;
}

/** The interceptor taken away (no snapshot kept any more, the tests). */
export function uninstallShowcaseFetch(): void {
    if (!pageFetch) return;
    globalThis.fetch = pageFetch;
    pageFetch = null;
}

/** The interceptor is in place. */
export function showcaseFetchInstalled(): boolean {
    return pageFetch !== null;
}

// ——— the live events ———

/** The EventSource-like shape the live code uses. */
export interface ShowcaseEventSource {
    onerror: ((ev: Event) => void) | null;
    addEventListener(type: string, cb: (ev: Event) => void): void;
    close(): void;
}

/**
 * The bridge's event stream of a showcase research (its `events` URL): one
 * `hello` with the snapshot's status, then nothing (the snapshot never
 * changes). null: not a showcase's URL.
 */
export function showcaseEventSource(url: string): ShowcaseEventSource | null {
    const target = parseShowcaseBridge(url);
    if (!target) return null;
    const listeners = new Map<string, Set<(ev: Event) => void>>();
    let closed = false;
    const source: ShowcaseEventSource = {
        onerror: null,
        addEventListener(type, cb) {
            let set = listeners.get(type);
            if (!set) listeners.set(type, (set = new Set()));
            set.add(cb);
        },
        close() {
            closed = true;
        },
    };
    setTimeout(() => {
        if (closed) return;
        const status = showcaseSnapshot(target.researchId)?.status ?? null;
        const ev = typeof MessageEvent === 'function'
            ? new MessageEvent('hello', { data: JSON.stringify(status) })
            : ({ type: 'hello', data: JSON.stringify(status) } as unknown as Event);
        for (const cb of [...(listeners.get('hello') ?? [])]) {
            try { cb(ev); } catch { /* its own */ }
        }
    }, 0);
    return source;
}
