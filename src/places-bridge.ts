/**
 * The research bridge's routes of place identification (spec 034): read the
 * tree's places as the research knows them (`GET <token>/places`), queue
 * places to identify or to check, or take them out of the queue (`POST
 * <token>/places/identify`), answer the research's place questions one by one
 * or in bulk (`POST <token>/places/answer`) and undo the last such step (`POST
 * <token>/places/undo`). Running the queue costs the user's agent time, so it
 * is never a bridge write: only the research terminal's `places` link.
 *
 * Everything read here is untrusted: wrong types, overlong text, ids that are
 * not "L" + digits and links the app would not build itself are dropped.
 * Simple requests (text/plain JSON, no cookies) like the other writes;
 * replies typed; never throws.
 */

import type { PlaceRecord, PlaceRecordBy } from './types.js';
import { cleanText, isResearchHead, researchSchemeUrl, withAppVersion } from './research-link.js';
import { writeHeldOfRefusal, type ResearchWriteHeld } from './research-write-held.js';
import { retryAfterSeconds } from './research-waiting-write.js';
import { cleanCoords, cleanPlaceText, isPlaceRecordId, sanitizePlaceRecord, PLACE_TEXT_LIMITS } from './place-records.js';
import { placeKey } from './places.js';
import type { CheckFinding } from './place-check.js';

/** The bridge reads the tree's places and takes them into its queue (`GET /places`, `POST /places/identify`). */
export const PLACES_IDENTIFY_FEATURE = 'places.identify';
/** The bridge takes answers to its place questions (`POST /places/answer`). */
export const PLACES_ANSWER_FEATURE = 'places.answer';
/** The bridge undoes the last answer step (`POST /places/undo`). */
export const PLACES_UNDO_FEATURE = 'places.undo';

/** How long a read of the places may take (a large tree). */
export const PLACES_READ_TIMEOUT_MS = 20_000;
/** How long a write may take (the research commits it). */
export const PLACES_WRITE_TIMEOUT_MS = 15_000;

/** Limits for what is read from the bridge and what is sent to it. */
export const PLACES_BRIDGE_LIMITS = {
    /** A reply larger than this is not read. */
    bytes: 8 * 1024 * 1024,
    /** Records read from one reply. */
    places: 50_000,
    /** Texts of facts read from one reply (`forms` and each record's `forms`). */
    forms: 100_000,
    /** Forms of one record. */
    recordForms: 500,
    /** Items in one write (the research takes at most 5000). */
    request: 5000,
    /** Skipped entries read from one write's reply. */
    skipped: 5000,
} as const;

// ==================== READ: GET /places ====================

/** A place's state in the research (absent: a record that is neither identified nor queued). */
export type BridgePlaceState = 'queued' | 'running' | 'proposed' | 'unlocated' | 'identified' | 'conflict';
const BRIDGE_STATES: readonly BridgePlaceState[] = ['queued', 'running', 'proposed', 'unlocated', 'identified', 'conflict'];

/**
 * A research place record as `GET /places` gives it: the record (today's name
 * first in `names`, as in the tree's GEDCOM) with what only the bridge knows —
 * the live state, the waiting question, the texts of the tree's facts.
 */
export interface BridgePlace extends PlaceRecord {
    state?: BridgePlaceState;
    /** Country (code or name, as the research has it). */
    country?: string;
    district?: string;
    parish?: string;
    /** Texts of the tree's facts that belong to the record, as the facts write them. */
    forms: string[];
    /** How many facts and persons are there. */
    facts?: number;
    persons?: number;
    /** proposed / conflict: the id of the waiting question ("L…"). */
    waiting?: string;
    /** conflict: the location the place has now. */
    current?: { lat: number; lon: number; label?: string };
    /** A check that could not decide: why. */
    checkWhy?: string;
}

/** A text of the tree's facts: its record, or (without one yet) its state. `{}` = known to the research, nothing more. */
export interface BridgePlaceForm {
    place?: string;
    state?: BridgePlaceState;
}

export interface BridgePlacesQueue {
    queued: number;
    running: number;
    batches?: number;
    /** The research's estimate for the whole queue: minutes and (after three measured sessions) dollars, as ranges. */
    estimate?: { minutes?: [number, number]; usd?: [number, number] };
}

/** What the research counts for "Look up all not on the map (N)" and "Check all locations (M)". */
export interface BridgePlacesCounts {
    offMap: number;
    placed: number;
    proposed: number;
    unlocated: number;
}

/** `GET /places`, sanitized. */
export interface BridgePlaces {
    /** Changes with the state of the places (queue, questions) even without a new commit ('' = not said). */
    rev: string;
    places: Record<string, BridgePlace>;
    /** Each text of the facts → its record or state, keyed by the text as the facts write it. */
    forms: Record<string, BridgePlaceForm>;
    /** The same keyed by placeKey() of the text, with each record's own `forms` added. */
    formsByKey: Record<string, BridgePlaceForm>;
    queue?: BridgePlacesQueue;
    counts?: BridgePlacesCounts;
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

const isState = (v: unknown): v is BridgePlaceState => BRIDGE_STATES.includes(v as BridgePlaceState);

/** A count: a whole number 0…10⁷, or undefined. */
function count(v: unknown): number | undefined {
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10_000_000 ? v : undefined;
}

function range(v: unknown): [number, number] | undefined {
    if (!Array.isArray(v) || v.length !== 2) return undefined;
    const [a, b] = v;
    if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) return undefined;
    if (a < 0 || b < a || b > 1_000_000) return undefined;
    return [a, b];
}

function formText(v: unknown): string | undefined {
    return cleanPlaceText(v, PLACE_TEXT_LIMITS.key);
}

/** One record of `GET /places`, or undefined when it has no valid id or no name. */
export function sanitizeBridgePlace(raw: unknown, id: string): BridgePlace | undefined {
    const r = asRecord(raw);
    if (!r || !isPlaceRecordId(id)) return undefined;
    // Today's name first, the other names after it — the shape of the tree's records.
    const others = Array.isArray(r.names) ? r.names : [];
    const rec = sanitizePlaceRecord({ ...r, id, names: r.name !== undefined ? [r.name, ...others] : others }, id);
    if (!rec) return undefined;
    // The same name twice (today's also among the others): once.
    const seen = new Set<string>();
    rec.names = rec.names.filter(n => {
        const k = `${n.name}|${n.lang ?? ''}|${n.from ?? ''}|${n.to ?? ''}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
    const out: BridgePlace = { ...rec, forms: [] };
    if (isState(r.state)) out.state = r.state;
    const country = cleanPlaceText(r.country, PLACE_TEXT_LIMITS.name);
    if (country) out.country = country;
    const district = cleanPlaceText(r.district, PLACE_TEXT_LIMITS.name);
    if (district) out.district = district;
    const parish = cleanPlaceText(r.parish, PLACE_TEXT_LIMITS.name);
    if (parish) out.parish = parish;
    const forms = new Set<string>();
    for (const f of Array.isArray(r.forms) ? r.forms.slice(0, PLACES_BRIDGE_LIMITS.recordForms) : []) {
        const t = formText(f);
        if (t) forms.add(t);
    }
    out.forms = [...forms];
    const facts = count(r.facts);
    if (facts !== undefined) out.facts = facts;
    const persons = count(r.persons);
    if (persons !== undefined) out.persons = persons;
    if (typeof r.waiting === 'string' && /^[LT]\d{1,7}$/.test(r.waiting)) out.waiting = r.waiting;
    const c = asRecord(r.current);
    const cur = c ? cleanCoords(c.lat, c.lon) : undefined;
    if (cur) {
        const label = cleanPlaceText(c!.label, PLACE_TEXT_LIMITS.name);
        out.current = label ? { ...cur, label } : cur;
    }
    const checkWhy = cleanPlaceText(r.checkWhy, PLACE_TEXT_LIMITS.why);
    if (checkWhy) out.checkWhy = checkWhy;
    // An identified place always has a location and who gave it; without them it is not identified.
    if (out.state === 'identified' && (!out.coords || !out.by)) delete out.state;
    return out;
}

function sanitizeForm(raw: unknown, places: Record<string, BridgePlace>): BridgePlaceForm | undefined {
    const r = asRecord(raw);
    if (!r) return undefined;
    const out: BridgePlaceForm = {};
    if (isPlaceRecordId(r.place) && places[r.place]) out.place = r.place;
    else if (isState(r.state)) out.state = r.state;
    return out;
}

/** The reply of `GET /places`, sanitized; null when it is not one (no `places` object). */
export function sanitizeBridgePlaces(raw: unknown, rev?: string): BridgePlaces | null {
    const r = asRecord(raw);
    const rawPlaces = r ? asRecord(r.places) : null;
    if (!r || !rawPlaces) return null;
    const places: Record<string, BridgePlace> = {};
    let n = 0;
    for (const [id, value] of Object.entries(rawPlaces)) {
        if (n >= PLACES_BRIDGE_LIMITS.places) break;
        const p = sanitizeBridgePlace(value, id);
        if (!p) continue;
        places[id] = p;
        n++;
    }
    // A parent the reply does not have is not followed.
    for (const p of Object.values(places)) if (p.parent && !places[p.parent]) delete p.parent;

    const forms: Record<string, BridgePlaceForm> = {};
    const formsByKey: Record<string, BridgePlaceForm> = {};
    let f = 0;
    for (const [text, value] of Object.entries(asRecord(r.forms) ?? {})) {
        if (f >= PLACES_BRIDGE_LIMITS.forms) break;
        const t = formText(text);
        const form = t ? sanitizeForm(value, places) : undefined;
        if (!t || !form) continue;
        forms[t] = form;
        const k = placeKey(t);
        // Two texts of one key: the one with a record wins, else the first.
        if (k && (!formsByKey[k] || (!formsByKey[k].place && form.place))) formsByKey[k] = form;
        f++;
    }
    for (const [id, p] of Object.entries(places)) {
        for (const t of p.forms) {
            const k = placeKey(t);
            if (k && !formsByKey[k]?.place) formsByKey[k] = { place: id };
        }
    }

    const out: BridgePlaces = { rev: cleanText(r.rev, 128) || cleanText(rev, 128), places, forms, formsByKey };
    const q = asRecord(r.queue);
    if (q) {
        const queue: BridgePlacesQueue = { queued: count(q.queued) ?? 0, running: count(q.running) ?? 0 };
        const batches = count(q.batches);
        if (batches !== undefined) queue.batches = batches;
        const e = asRecord(q.estimate);
        const minutes = e ? range(e.minutes) : undefined;
        const usd = e ? range(e.usd) : undefined;
        if (minutes || usd) queue.estimate = { ...(minutes ? { minutes } : {}), ...(usd ? { usd } : {}) };
        out.queue = queue;
    }
    const c = asRecord(r.counts);
    if (c) {
        out.counts = {
            offMap: count(c.offMap) ?? 0, placed: count(c.placed) ?? 0,
            proposed: count(c.proposed) ?? 0, unlocated: count(c.unlocated) ?? 0,
        };
    }
    return out;
}

/** A reply cut off: over the byte limit. */
const TOO_BIG = '\u0000too-big';

async function request(url: string, init: RequestInit, timeoutMs: number):
    Promise<{ status: number; text: string; retryAfter: string | null } | null> {
    if (typeof fetch !== 'function') return null;
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
        const res = await fetch(withAppVersion(url), {
            mode: 'cors', credentials: 'omit', cache: 'no-store', ...init, signal: ctl?.signal,
        });
        const retryAfter = res.headers?.get?.('Retry-After') ?? null;
        const len = Number(res.headers?.get?.('Content-Length') ?? '');
        if (Number.isFinite(len) && len > PLACES_BRIDGE_LIMITS.bytes) {
            try { await res.body?.cancel(); } catch { /* nothing to cancel */ }
            return { status: res.status, text: TOO_BIG, retryAfter };
        }
        return { status: res.status, text: await res.text(), retryAfter };
    } catch {
        return null;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function jsonOf(text: string): unknown {
    try { return JSON.parse(text); } catch { return null; }
}

export type PlacesReadResult =
    | { ok: true; payload: BridgePlaces }
    /**
     * network: no answer; too-big: over the limit; invalid: not a reply the app reads;
     * busy: 503 research.busy (`retryAfter` seconds when said); refused: any other status.
     */
    | { ok: false; code: 'network' | 'too-big' | 'invalid' | 'busy' | 'refused'; status: number; retryAfter: number | null };

/** The reply to `GET /places`, typed. `rev`: the state the read was asked for (used when the reply says none). */
export function placesReadReply(status: number, text: string, retryAfter?: string | null, rev?: string): PlacesReadResult {
    const fail = (code: 'too-big' | 'invalid' | 'busy' | 'refused'): PlacesReadResult =>
        ({ ok: false, code, status, retryAfter: code === 'busy' ? retryAfterSeconds(retryAfter) : null });
    if (text === TOO_BIG) return fail('too-big');
    if (status === 503) return fail('busy');
    if (status < 200 || status >= 300) return fail('refused');
    if (text.length > PLACES_BRIDGE_LIMITS.bytes || new TextEncoder().encode(text).length > PLACES_BRIDGE_LIMITS.bytes) return fail('too-big');
    const payload = sanitizeBridgePlaces(jsonOf(text), rev);
    return payload ? { ok: true, payload } : fail('invalid');
}

/** Read the tree's places from the research (`base`: the bridge's address with its token). */
export async function fetchBridgePlaces(base: string, opts: { rev?: string; timeoutMs?: number } = {}): Promise<PlacesReadResult> {
    const res = await request(`${base}/places`, { method: 'GET' }, opts.timeoutMs ?? PLACES_READ_TIMEOUT_MS);
    if (!res) return { ok: false, code: 'network', status: 0, retryAfter: null };
    return placesReadReply(res.status, res.text, res.retryAfter, opts.rev);
}

// ==================== REFUSALS (every write) ====================

/**
 * Why a write did not go:
 * - `invalid`: 400 places.body, or not sent at all (nothing valid to send);
 * - `unsupported`: not sent — the bridge does not announce the route's feature;
 * - `archive`: 409 places.archive — an archive (`reason` = its sentence);
 * - `later`: 409 places.undo.later — something changed the places since; that step cannot be undone;
 * - `changed`: 409 places.changed — the place changed meanwhile (`place`: its state now, when said);
 * - `locked`: 423 — another session holds the tree;
 * - `link`: 403 places.link — the research's terminal decides (`link`: the `places` link to offer);
 * - `held`: sealed elsewhere / not downloaded / disk full; `busy`: 503 research.busy (`retryAfter`);
 * - `network`: no answer; `unknown`: anything else (an older bridge).
 */
export type PlacesWriteError = 'invalid' | 'unsupported' | 'archive' | 'later' | 'changed' | 'locked' | 'link' | 'held' | 'busy' | 'network' | 'unknown';

export interface PlacesWriteRefusal {
    ok: false;
    code: PlacesWriteError;
    status: number;
    /** The bridge's own sentence ('' none). */
    reason: string;
    /** The bridge's code ("places.archive"; '' none). */
    bridgeCode: string;
    /** `busy`: seconds to wait (null: not said). */
    retryAfter: number | null;
    /** `link`: the research's link — only one the app would build itself. */
    link?: string;
    held?: ResearchWriteHeld;
    /** `changed`: the place as it is now. */
    place?: BridgePlace;
}

/** What a refusal's link may be: the `places` run link of this tree, for the whole queue or the places named. */
export interface PlacesLinkCheck {
    /** The research's tree id. */
    tree: string;
    scheme?: string;
    /** Record ids a link for one place may name. */
    places?: readonly string[];
}

function ownRunLinks(check: PlacesLinkCheck | undefined): string[] {
    if (!check) return [];
    const run = researchSchemeUrl('places', { tree: check.tree, placesDo: 'run' }, check.scheme);
    const one = (check.places ?? []).slice(0, 50)
        .map(place => researchSchemeUrl('places', { tree: check.tree, placesDo: 'run', place }, check.scheme));
    return [run, ...one].filter((u): u is string => !!u);
}

function bridgeCode(r: Record<string, unknown>): string {
    return typeof r.code === 'string' && /^[a-z0-9.-]{1,40}$/.test(r.code) ? r.code : '';
}

/** The common shape of a refused write. */
export function placesWriteRefusal(status: number, body: unknown, features: readonly string[] | null | undefined,
    retryAfter?: string | null, check?: PlacesLinkCheck): PlacesWriteRefusal {
    const r = asRecord(body) ?? {};
    const code = bridgeCode(r);
    const reason = cleanText(typeof r.text === 'string' && r.text ? r.text : r.error, 400);
    const out = (c: PlacesWriteError, extra: Partial<PlacesWriteRefusal> = {}): PlacesWriteRefusal => ({
        ok: false, code: c, status, reason, bridgeCode: code,
        retryAfter: c === 'busy' ? retryAfterSeconds(retryAfter) : null, ...extra,
    });
    if (status === 403 && code === 'places.link') {
        const params = asRecord(r.params);
        const said = typeof r.link === 'string' ? r.link : typeof params?.link === 'string' ? params.link : '';
        const own = ownRunLinks(check);
        const link = own.includes(said) ? said : own[0];
        return out('link', link ? { link } : {});
    }
    const held = writeHeldOfRefusal(code, r.error, features, r.params);
    if (held) return out('held', { held });
    if (status === 400) return out(code === 'places.body' || !code ? 'invalid' : 'unknown');
    if (status === 409 && code === 'places.archive') return out('archive');
    if (status === 409 && code === 'places.undo.later') return out('later');
    if (status === 409 && code === 'places.changed') {
        const p = asRecord(r.place);
        const id = p && isPlaceRecordId(p.id) ? p.id : null;
        const place = id ? sanitizeBridgePlace(p, id) : undefined;
        return out('changed', place ? { place } : {});
    }
    if (status === 423) return out('locked');
    if (status === 503 || code === 'research.busy') return out('busy');
    return out('unknown');
}

const notSent = (code: 'invalid' | 'unsupported'): PlacesWriteRefusal =>
    ({ ok: false, code, status: 0, reason: '', bridgeCode: '', retryAfter: null });
const noAnswer = (): PlacesWriteRefusal =>
    ({ ok: false, code: 'network', status: 0, reason: '', bridgeCode: '', retryAfter: null });

function headsOf(r: Record<string, unknown>): { head: string; parent: string } {
    return { head: isResearchHead(r.head) ?? '', parent: isResearchHead(r.parent) ?? '' };
}

async function postWrite(base: string, path: string, body: unknown, timeoutMs?: number):
    Promise<{ status: number; body: unknown; retryAfter: string | null } | null> {
    const res = await request(`${base}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: JSON.stringify(body),
    }, timeoutMs ?? PLACES_WRITE_TIMEOUT_MS);
    return res ? { status: res.status, body: jsonOf(res.text), retryAfter: res.retryAfter } : null;
}

const hasFeature = (features: readonly string[] | null | undefined, f: string): boolean => !!features?.includes(f);

// ==================== POST /places/identify ====================

/** The app's check mark sent with a check (§5): what the free check found first. */
export type PlaceCheckFlag = 'far' | 'district' | 'label' | 'choices';
const CHECK_FLAGS: readonly PlaceCheckFlag[] = ['far', 'district', 'label', 'choices'];

/** The flag of a place's check findings (the first, worst one; `multi` is the research's `choices`), or undefined. */
export function placeCheckFlag(findings: readonly CheckFinding[] | undefined): PlaceCheckFlag | undefined {
    const f = findings?.[0];
    if (!f) return undefined;
    return f.kind === 'multi' ? 'choices' : f.kind;
}

export type PlacesIdentifyBody =
    | {
        do: 'queue';
        /** Texts of places as the facts write them. */
        forms?: readonly string[];
        /** Record ids. */
        places?: readonly string[];
        /** Everything not on the map (`offmap`) or, with `check`, every location (`placed`). */
        all?: 'offmap' | 'placed';
        /** Check a location instead of looking a place up. */
        check?: boolean;
        /** With `check`: the app's mark for a form. */
        flags?: Readonly<Record<string, PlaceCheckFlag>>;
    }
    | { do: 'cancel'; forms?: readonly string[]; places?: readonly string[]; all?: 'queued' };

/** What goes over the wire: valid items only, each once, at most PLACES_BRIDGE_LIMITS.request in all; null = nothing to send. */
export function placesIdentifyBody(body: PlacesIdentifyBody): Record<string, unknown> | null {
    if (body.do !== 'queue' && body.do !== 'cancel') return null;
    const out: Record<string, unknown> = { do: body.do };
    if (body.all !== undefined) {
        const ok = body.do === 'queue' ? body.all === 'offmap' || body.all === 'placed' : body.all === 'queued';
        if (!ok) return null;
        out.all = body.all;
    } else {
        let room: number = PLACES_BRIDGE_LIMITS.request;
        const forms = [...new Set((body.forms ?? []).map(formText).filter((t): t is string => !!t))].slice(0, room);
        room -= forms.length;
        const places = [...new Set((body.places ?? []).filter(isPlaceRecordId))].slice(0, room);
        if (!forms.length && !places.length) return null;
        if (forms.length) out.forms = forms;
        if (places.length) out.places = places;
    }
    if (body.do === 'queue' && body.check) {
        out.check = true;
        if (body.flags && Array.isArray(out.forms)) {
            const sent = new Set(out.forms as string[]);
            const flags: Record<string, PlaceCheckFlag> = {};
            for (const [form, flag] of Object.entries(body.flags)) {
                const t = formText(form);
                if (t && sent.has(t) && CHECK_FLAGS.includes(flag)) flags[t] = flag;
            }
            if (Object.keys(flags).length) out.flags = flags;
        }
    }
    return out;
}

/** Why the research skipped a form: placed by hand, identified already (a check would do), queued or running, or no fact writes it. */
export type PlacesSkipWhy = 'manual' | 'identified' | 'queued' | 'running' | 'unknown';
const SKIP_WHYS: readonly PlacesSkipWhy[] = ['manual', 'identified', 'queued', 'running', 'unknown'];

export interface PlacesIdentifyOk {
    ok: true;
    queued: number;
    cancelled?: number;
    skipped: { form: string; why: PlacesSkipWhy }[];
    queue?: BridgePlacesQueue;
}

export type PlacesIdentifyResult = PlacesIdentifyOk | PlacesWriteRefusal;

/** The reply to `POST /places/identify`, typed. */
export function placesIdentifyReply(status: number, body: unknown, features: readonly string[] | null | undefined,
    retryAfter?: string | null, check?: PlacesLinkCheck): PlacesIdentifyResult {
    if (status >= 200 && status < 300) {
        const r = asRecord(body);
        if (!r) return { ...noAnswer(), code: 'unknown', status };
        const skipped: PlacesIdentifyOk['skipped'] = [];
        for (const s of Array.isArray(r.skipped) ? r.skipped.slice(0, PLACES_BRIDGE_LIMITS.skipped) : []) {
            const x = asRecord(s);
            const form = x ? formText(x.form) ?? (isPlaceRecordId(x.place) ? x.place : undefined) : undefined;
            if (form && SKIP_WHYS.includes(x!.why as PlacesSkipWhy)) skipped.push({ form, why: x!.why as PlacesSkipWhy });
        }
        const out: PlacesIdentifyOk = { ok: true, queued: count(r.queued) ?? 0, skipped };
        const cancelled = count(r.cancelled);
        if (cancelled !== undefined) out.cancelled = cancelled;
        // The queue as `GET /places` has it.
        const q = sanitizeBridgePlaces({ places: {}, queue: r.queue })?.queue;
        if (q && asRecord(r.queue)) out.queue = q;
        return out;
    }
    return placesWriteRefusal(status, body, features, retryAfter, check);
}

/** Queue places to identify or to check, or take them out of the queue. */
export async function postPlacesIdentify(base: string, body: PlacesIdentifyBody, features: readonly string[] | null | undefined,
    check?: PlacesLinkCheck, opts: { timeoutMs?: number } = {}): Promise<PlacesIdentifyResult> {
    if (!hasFeature(features, PLACES_IDENTIFY_FEATURE)) return notSent('unsupported');
    const send = placesIdentifyBody(body);
    if (!send) return notSent('invalid');
    const links = check ? { ...check, places: [...(check.places ?? []), ...((send.places as string[] | undefined) ?? [])] } : undefined;
    const res = await postWrite(base, '/places/identify', send, opts.timeoutMs);
    return res ? placesIdentifyReply(res.status, res.body, features, res.retryAfter, links) : noAnswer();
}

// ==================== POST /places/answer ====================

/** An answer to one place question: a candidate, keep the location (conflict), don't know, none of them, yes / no (form). */
export type PlaceAnswerTake = 'c1' | 'c2' | 'c3' | 'keep' | 'unknown' | 'none' | 'yes' | 'no';
const TAKES: readonly PlaceAnswerTake[] = ['c1', 'c2', 'c3', 'keep', 'unknown', 'none', 'yes', 'no'];

export type PlacesAnswerBody =
    | { place: string; take: PlaceAnswerTake }
    /** In bulk: the first candidate of each, or keep each location; `dry` asks only what it would do. */
    | { places: readonly string[]; take: 'first' | 'keep'; dry?: boolean };

/** The id of a step to undo, as the research gives it. */
const UNDO_ID = /^[A-Za-z0-9._:-]{1,64}$/;
const undoId = (v: unknown): string => typeof v === 'string' && UNDO_ID.test(v) ? v : '';

export type PlacesAnswerOk =
    | { ok: true; kind: 'one'; place: BridgePlace | null; undo: string; head: string; parent: string }
    | { ok: true; kind: 'dry'; places: number; facts: number }
    | { ok: true; kind: 'bulk'; done: string[]; skipped: { place: string; why: string }[]; undo: string; head: string; parent: string };

export type PlacesAnswerResult = PlacesAnswerOk | PlacesWriteRefusal;

/** The reply to `POST /places/answer`, typed by what was asked. */
export function placesAnswerReply(status: number, body: unknown, asked: PlacesAnswerBody,
    features: readonly string[] | null | undefined, retryAfter?: string | null): PlacesAnswerResult {
    if (status < 200 || status >= 300) return placesWriteRefusal(status, body, features, retryAfter);
    const r = asRecord(body);
    if (!r) return { ...noAnswer(), code: 'unknown', status };
    if ('place' in asked) {
        const p = asRecord(r.place);
        const id = p && isPlaceRecordId(p.id) ? p.id : asked.place;
        return { ok: true, kind: 'one', place: p ? sanitizeBridgePlace(p, id) ?? null : null, undo: undoId(r.undo), ...headsOf(r) };
    }
    if (asked.dry) return { ok: true, kind: 'dry', places: count(r.places) ?? 0, facts: count(r.facts) ?? 0 };
    const done = Array.isArray(r.done) ? [...new Set(r.done.filter(isPlaceRecordId))] : [];
    const skipped: { place: string; why: string }[] = [];
    for (const s of Array.isArray(r.skipped) ? r.skipped.slice(0, PLACES_BRIDGE_LIMITS.skipped) : []) {
        const x = asRecord(s);
        if (x && isPlaceRecordId(x.place)) skipped.push({ place: x.place, why: cleanText(x.why, 40) });
    }
    return { ok: true, kind: 'bulk', done, skipped, undo: undoId(r.undo), ...headsOf(r) };
}

/** What goes over the wire for an answer; null = nothing valid to send. */
export function placesAnswerBody(body: PlacesAnswerBody): Record<string, unknown> | null {
    if ('place' in body) {
        return isPlaceRecordId(body.place) && TAKES.includes(body.take) ? { place: body.place, take: body.take } : null;
    }
    if (body.take !== 'first' && body.take !== 'keep') return null;
    const places = [...new Set(body.places.filter(isPlaceRecordId))].slice(0, PLACES_BRIDGE_LIMITS.request);
    if (!places.length) return null;
    return { places, take: body.take, ...(body.dry ? { dry: true } : {}) };
}

/** Answer a place question, or many at once (`dry`: only how many places and facts it would change). */
export async function postPlacesAnswer(base: string, body: PlacesAnswerBody, features: readonly string[] | null | undefined,
    opts: { timeoutMs?: number } = {}): Promise<PlacesAnswerResult> {
    if (!hasFeature(features, PLACES_ANSWER_FEATURE)) return notSent('unsupported');
    const send = placesAnswerBody(body);
    if (!send) return notSent('invalid');
    const res = await postWrite(base, '/places/answer', send, opts.timeoutMs);
    return res ? placesAnswerReply(res.status, res.body, body, features, res.retryAfter) : noAnswer();
}

// ==================== POST /places/undo ====================

export type PlacesUndoResult = { ok: true; head: string; parent: string } | PlacesWriteRefusal;

export function placesUndoReply(status: number, body: unknown, features: readonly string[] | null | undefined,
    retryAfter?: string | null): PlacesUndoResult {
    if (status >= 200 && status < 300) return { ok: true, ...headsOf(asRecord(body) ?? {}) };
    return placesWriteRefusal(status, body, features, retryAfter);
}

/** Undo the last answer step (`undo` from its reply); 409 places.undo.later when something changed the places since. */
export async function postPlacesUndo(base: string, body: { undo: string }, features: readonly string[] | null | undefined,
    opts: { timeoutMs?: number } = {}): Promise<PlacesUndoResult> {
    if (!hasFeature(features, PLACES_UNDO_FEATURE)) return notSent('unsupported');
    const undo = undoId(body.undo);
    if (!undo) return notSent('invalid');
    const res = await postWrite(base, '/places/undo', { undo }, opts.timeoutMs);
    return res ? placesUndoReply(res.status, res.body, features, res.retryAfter) : noAnswer();
}

// ==================== WHO MAY ASK THE RESEARCH ====================

/**
 * Where the research's place actions stand (§10):
 * - `ok`: they go (the tree's research, its bridge answering here, `places.identify`, not a phone);
 * - `none`: the tree has no research — no word about it anywhere but an empty search;
 * - `phone`: a phone layout — look up and check go on the computer with the research;
 * - `elsewhere`: the research is not on this computer (its bridge does not answer here);
 * - `old`: the research does not take places yet (no `places.identify`).
 */
export type PlacesResearchAccess = 'ok' | 'none' | 'phone' | 'elsewhere' | 'old';

export interface PlacesResearchEnv {
    /** The tree belongs to a research. */
    hasResearch: boolean;
    /** Its bridge answers in this page (it runs on this computer). */
    bridgeLocal: boolean;
    /** What the bridge announced (`/status features`). */
    features: readonly string[] | null | undefined;
    /** The phone layout (≤ 640 px, or a phone held sideways). */
    phoneLayout: boolean;
}

export function placesResearchAccess(env: PlacesResearchEnv): PlacesResearchAccess {
    if (!env.hasResearch) return 'none';
    if (env.phoneLayout) return 'phone';
    if (!env.bridgeLocal) return 'elsewhere';
    if (!hasFeature(env.features, PLACES_IDENTIFY_FEATURE)) return 'old';
    return 'ok';
}

/** The one rule for every ◆ action (Look up / Check / Select / ⋯ / Run now / Remove from the queue). */
export function canResearchPlaces(env: PlacesResearchEnv): boolean {
    return placesResearchAccess(env) === 'ok';
}

/** Who gave a research location, as the app shows it. */
export function originOfBy(by: PlaceRecordBy | undefined): 'research' | 'hand' | 'other' | undefined {
    return by === 'research' ? 'research' : by === 'person' ? 'hand' : by === 'adopted' ? 'other' : undefined;
}
