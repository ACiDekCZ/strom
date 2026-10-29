/**
 * History in the life timeline (spec 020 "Co předek zažil").
 *
 * The research finds events of the time (regional history, local findings from
 * its records) for the places of a tree and hands them over by `GET /history`.
 * They are NOT tree data: never in StromData, GEDCOM, exports or the change log.
 * This module is pure: it validates the payload, matches the places of a
 * person's life to the payload's places, filters events to the person's life,
 * applies hidings (the research's list plus the local queue) and decides what
 * the person card shows. The DOM side lives in `src/ui/history-ui.ts`, the
 * bridge calls in `src/history-bridge.ts`, the cache in `src/history-store.ts`.
 */

import type { StromData, Person } from './types.js';
import { placeKey } from './places.js';
import { computePersonLifeline, type LifelinePoint } from './timeline.js';
import { yearOf } from './dates.js';
import { getStringsForLang, type Language } from './strings.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export const HISTORY_KINDS = ['war', 'epidemic', 'census', 'state', 'emigration', 'law', 'economy', 'disaster', 'other'] as const;
export type HistoryKind = typeof HISTORY_KINDS[number];

/** Texts by language code ("cs", "en", "de", or another valid code). */
export type HistoryText = Record<string, string>;

export interface HistorySource {
    title: string;
    url: string;
    publisher?: string;
    /** Language of the page (valid code shape only). */
    lang?: string;
    /** Date the research checked the page (ISO). */
    checked?: string;
    /** The excerpt the research verified the event on (≤ 300 chars). */
    quote?: string;
}

export interface HistoryLocal {
    /** REFN of the tree's source ("S0004"). */
    source: string;
    /** Clip mark (`_STROM_CLIP`). */
    clip?: string;
    /** Citation text. */
    cite: string;
}

/** region: a region's catalogue; local: the tree's own records; place: the history of a place and its surroundings (R6). */
export type HistoryScope = 'region' | 'local' | 'place';

/** The place an event of `scope: "place"` belongs to (R6). */
export interface HistoryEventPlace {
    /** The payload's place key. */
    key: string;
    /** The research's place record ("L0001"). */
    id?: string;
    name?: HistoryText;
}

export interface HistoryEvent {
    id: string;
    from: number;
    to?: number;
    kind: HistoryKind;
    scope: HistoryScope;
    region?: { id: string; name?: HistoryText };
    place?: HistoryEventPlace;
    text: HistoryText;
    source?: HistorySource;
    local?: HistoryLocal;
    tip?: { text: HistoryText };
    sensitive?: boolean;
}

/** A region of a place, with the years it applies (none: the whole period). */
export interface HistoryPlaceRegion {
    id: string;
    from?: number;
    to?: number;
}

/** The state of a place's own history (R6 `places[x].history`). */
export type HistoryPlaceHistory = 'none' | 'first' | 'running' | 'done' | 'empty' | 'waiting';

export interface HistoryPlace {
    events: string[];
    /** Other names of the same place (other languages, historical names). */
    also?: string[];
    /** Missing = done; pending = waits; unlocated = the research did not place it. */
    state?: 'pending' | 'unlocated';
    /** R1: the regions of the place (also while pending). */
    regions?: HistoryPlaceRegion[];
    /** R1: how many people of the tree have facts in the place. */
    persons?: number;
    /** R1: the research's sentence why it could not place it (unlocated); R6: why its own history waits. */
    why?: string;
    /** R5: the regions were set by hand. */
    manual?: boolean;
    /** R5: the place waits to be placed again (`state: "pending"`), with the user's note for the research. */
    redo?: boolean;
    note?: string;
    /** R3: the place is not searched for this tree. */
    skip?: boolean;
    /** R1: the research's place record ("L0001"); R6 links take only this. */
    id?: string;
    /** R6: the surroundings its own history covers. */
    area?: HistoryText;
    /** R6: the state of its own history. */
    history?: HistoryPlaceHistory;
    /** R6: when its own history was searched (ISO). */
    at?: string;
}

export type HistoryRegionState = 'queued' | 'running' | 'done' | 'waiting' | 'covered' | 'skipped' | 'none';

/** A region of the tree as the research keeps it (R1 `regions`). */
export interface HistoryRegion {
    id: string;
    name?: HistoryText;
    state: HistoryRegionState;
    /** When it was done (ISO). */
    at?: string;
    /** waiting: the research's sentence. */
    why?: string;
    /** covered: the regions whose catalogues hold its places and years (a state over its lands). */
    covered?: string[];
    /** Events of its catalogue that are not deleted (hidden ones too). */
    events?: number;
    /** Hidden in this tree. */
    hidden?: number;
    places?: number;
    persons?: number;
    facts?: number;
    /** Years of the tree's people without events, not searched yet (K2.6). */
    gaps?: { from: number; to: number }[];
    /** The task filling the gaps. */
    fill?: 'queued' | 'running';
    /** 1-based order among the research's region tasks. */
    order?: number;
    /** Asked to go first (`/history/first`). */
    first?: boolean;
}

/** An event the user deleted on this computer (R4 `deleted`): what the row needs to be restored. */
export interface HistoryDeleted {
    event: string;
    scope: HistoryScope;
    /** When it was deleted (ISO). */
    at?: string;
    from?: number;
    to?: number;
    text?: HistoryText;
    kind?: HistoryKind;
    region?: { id: string; name?: HistoryText };
    /** A local finding's place (R4 says it as the place key, a string), or a place's own history's place. */
    place?: HistoryEventPlace;
    source?: HistorySource;
    local?: HistoryLocal;
    tip?: { text: HistoryText };
    sensitive?: boolean;
}

/**
 * A hiding: an event for a place, for a person (REFN) or in the whole tree
 * (`tree`, R2), or everything of a region in this tree (`region`, R2, no event).
 */
export interface HistoryHidden {
    event?: string;
    /** Hidden for a place (the payload's place key). */
    place?: string;
    /** Hidden for one person (the person's REFN). */
    person?: string;
    /** Hidden in the whole tree (R2). */
    tree?: true;
    /** Everything of the region hidden in this tree (R2). */
    region?: string;
    at?: string;
}

export type HistorySearch = 'none' | 'running' | 'done' | 'waiting';

export interface HistoryState {
    on: boolean;
    search: HistorySearch;
    at?: string;
    pending?: number;
    why?: string;
    rev?: string;
    truncated?: boolean;
    /** P3: a session matching places to regions runs now — places matched so far, of how many (search stays "running"). */
    mapping?: { mapped: number; mappable: number };
}

export interface HistoryPayload {
    state: HistoryState;
    /** The research's language. */
    lang?: string;
    events: HistoryEvent[];
    places: Record<string, HistoryPlace>;
    hidden: HistoryHidden[];
    /** R1 regions by id; absent: an older research (regions are derived from the events). */
    regions?: Record<string, HistoryRegion>;
    /** R6: place ids ("L0003") the research suggests for their own history. */
    suggest?: string[];
    /** R4: events deleted on this computer (restorable). */
    deleted?: HistoryDeleted[];
    /** `/status.history.rev` the payload was read for (when the status gave one). */
    rev?: string;
    /** When this copy was read from the bridge (ISO). */
    cachedAt: string;
}

/** A hiding (or its undo) not yet confirmed by the research (§4.5). */
export interface HistoryHideOp {
    /** Absent only for a region's hiding. */
    event?: string;
    /** The payload's place key. */
    place?: string;
    /** In the whole tree (R2). */
    tree?: true;
    /** Everything of the region in this tree (R2). */
    region?: string;
    /** The person's id in the tree (a person without REFN waits for one). */
    personId?: string;
    personRefn?: string;
    do?: 'show';
    /** When it was queued (ISO). */
    at: string;
}

// ─── Limits and validation ─────────────────────────────────────────────────

export const HISTORY_LIMITS = {
    events: 3000,
    places: 5000,
    bytes: 8 * 1024 * 1024,
    also: 20,
    alsoLength: 200,
    quote: 300,
    text: 300,
    title: 200,
    hidden: 20000,
    regions: 2000,
    deleted: 5000,
    suggest: 50,
    placeRegions: 20,
} as const;

const LANG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{1,8})?$/;
const ID_RE = /^[A-Za-z0-9-]{1,32}$/;
/** A region's id ("cz-bohemia"). */
export const HISTORY_REGION_RE = /^[A-Za-z0-9._-]{1,64}$/;
/** A research place record ("L0001"). */
export const HISTORY_PLACE_ID_RE = /^L\d{1,7}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;

/** A language code of the shape the bridge may send (`cs`, `en-GB`); others are ignored. */
export function isHistoryLang(v: unknown): v is string {
    return typeof v === 'string' && LANG_RE.test(v);
}

function isObj(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, max?: number): string | undefined {
    if (typeof v !== 'string') return undefined;
    const t = v.trim();
    if (!t) return undefined;
    return max !== undefined && t.length > max ? t.slice(0, max) : t;
}

function year(v: unknown): number | undefined {
    return typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 3000 ? v : undefined;
}

function count(v: unknown): number | undefined {
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e9 ? v : undefined;
}

function isoTime(v: unknown): string | undefined {
    const s = str(v, 40);
    return s && !Number.isNaN(Date.parse(s)) ? s : undefined;
}

function regionRef(v: unknown): { id: string; name?: HistoryText } | undefined {
    if (!isObj(v)) return undefined;
    const id = str(v.id, 64);
    if (!id || !HISTORY_REGION_RE.test(id)) return undefined;
    const out: { id: string; name?: HistoryText } = { id };
    const name = langText(v.name, HISTORY_LIMITS.title);
    if (name) out.name = name;
    return out;
}

function eventPlaceRef(v: unknown): HistoryEventPlace | undefined {
    if (!isObj(v)) return undefined;
    const key = str(v.key, 500);
    if (!key) return undefined;
    const out: HistoryEventPlace = { key };
    if (typeof v.id === 'string' && HISTORY_PLACE_ID_RE.test(v.id)) out.id = v.id;
    const name = langText(v.name, HISTORY_LIMITS.title);
    if (name) out.name = name;
    return out;
}

/** Text by language: valid codes only, each clipped. Empty → undefined. */
function langText(v: unknown, max: number): HistoryText | undefined {
    if (!isObj(v)) return undefined;
    const out: HistoryText = {};
    let any = false;
    for (const [k, raw] of Object.entries(v)) {
        if (!isHistoryLang(k)) continue;
        const t = str(raw, max);
        if (!t) continue;
        out[k] = t;
        any = true;
    }
    return any ? out : undefined;
}

function httpsUrl(v: unknown): string | undefined {
    const s = str(v, 2000);
    if (!s) return undefined;
    try {
        return new URL(s).protocol === 'https:' ? s : undefined;
    } catch {
        return undefined;
    }
}

function parseSource(v: unknown): HistorySource | undefined {
    if (!isObj(v)) return undefined;
    const title = str(v.title, HISTORY_LIMITS.title);
    const url = httpsUrl(v.url);
    if (!title || !url) return undefined;
    const out: HistorySource = { title, url };
    const publisher = str(v.publisher, HISTORY_LIMITS.title);
    if (publisher) out.publisher = publisher;
    if (isHistoryLang(v.lang)) out.lang = v.lang;
    const checked = str(v.checked, 40);
    if (checked && ISO_DATE_RE.test(checked)) out.checked = checked;
    const quote = str(v.quote, HISTORY_LIMITS.quote);
    if (quote) out.quote = quote;
    return out;
}

function parseLocal(v: unknown): HistoryLocal | undefined {
    if (!isObj(v)) return undefined;
    const source = str(v.source, 64);
    const cite = str(v.cite, HISTORY_LIMITS.text);
    if (!source || !cite) return undefined;
    const out: HistoryLocal = { source, cite };
    const clip = str(v.clip, 64);
    if (clip) out.clip = clip;
    return out;
}

/** One event, or null when it is invalid (dropped, never the whole payload). */
export function parseHistoryEvent(v: unknown): HistoryEvent | null {
    if (!isObj(v)) return null;
    const id = typeof v.id === 'string' && ID_RE.test(v.id) ? v.id : undefined;
    const from = year(v.from);
    const text = langText(v.text, HISTORY_LIMITS.text);
    if (!id || from === undefined || !text) return null;
    const scope: HistoryScope | undefined = v.scope === 'local' || v.scope === 'region' || v.scope === 'place' ? v.scope : undefined;
    if (!scope) return null;
    const source = parseSource(v.source);
    const local = parseLocal(v.local);
    if (!source && !local) return null;
    const kind: HistoryKind = (HISTORY_KINDS as readonly string[]).includes(v.kind as string)
        ? v.kind as HistoryKind : 'other';
    const ev: HistoryEvent = { id, from, kind, scope, text };
    const to = year(v.to);
    if (to !== undefined && to > from) ev.to = to;
    if (isObj(v.region)) {
        const rid = str(v.region.id, 64);
        if (rid) {
            ev.region = { id: rid };
            const name = langText(v.region.name, HISTORY_LIMITS.title);
            if (name) ev.region.name = name;
        }
    }
    const place = eventPlaceRef(v.place);
    if (place) ev.place = place;
    if (source) ev.source = source;
    if (local) ev.local = local;
    if (isObj(v.tip)) {
        const tip = langText(v.tip.text, HISTORY_LIMITS.text);
        if (tip) ev.tip = { text: tip };
    }
    if (v.sensitive === true) ev.sensitive = true;
    return ev;
}

/**
 * A place's regions with their years (R1 `places[x].regions`, R5 `map.regions`):
 * valid ids, each period once — a region may come back with another period
 * (a state 1918–1938 and again 1945–1992); one without years stands alone.
 */
export function parsePlaceRegions(v: unknown): HistoryPlaceRegion[] {
    const regions: HistoryPlaceRegion[] = [];
    if (!Array.isArray(v)) return regions;
    for (const r of v) {
        if (regions.length >= HISTORY_LIMITS.placeRegions) break;
        if (!isObj(r)) continue;
        const id = str(r.id, 64);
        if (!id || !HISTORY_REGION_RE.test(id)) continue;
        const pr: HistoryPlaceRegion = { id };
        const from = year(r.from);
        const to = year(r.to);
        if (from !== undefined) pr.from = from;
        if (to !== undefined && (from === undefined || to >= from)) pr.to = to;
        // The same period again, or a period beside the whole time (no years): once.
        const whole = (x: HistoryPlaceRegion) => x.from === undefined && x.to === undefined;
        if (regions.some(x => x.id === id && ((x.from === pr.from && x.to === pr.to) || whole(x) || whole(pr)))) continue;
        regions.push(pr);
    }
    return regions;
}

function parsePlace(v: unknown, known: Set<string>): HistoryPlace | null {
    if (!isObj(v)) return null;
    const events = Array.isArray(v.events)
        ? [...new Set(v.events.filter((e): e is string => typeof e === 'string' && known.has(e)))]
        : [];
    const out: HistoryPlace = { events };
    if (Array.isArray(v.also)) {
        const also = v.also
            .filter((a): a is string => typeof a === 'string' && a.trim().length > 0 && a.length <= HISTORY_LIMITS.alsoLength)
            .slice(0, HISTORY_LIMITS.also)
            .map(a => a.trim());
        if (also.length) out.also = also;
    }
    if (v.state === 'pending' || v.state === 'unlocated') out.state = v.state;
    const regions = parsePlaceRegions(v.regions);
    if (regions.length) out.regions = regions;
    const persons = count(v.persons);
    if (persons !== undefined) out.persons = persons;
    const why = str(v.why, 300);
    if (why) out.why = why;
    if (v.manual === true) out.manual = true;
    if (v.redo === true) {
        out.redo = true;
        const note = str(v.note, 400); // 200 code points at most (R5)
        if (note) out.note = note;
    }
    if (v.skip === true) out.skip = true;
    if (typeof v.id === 'string' && HISTORY_PLACE_ID_RE.test(v.id)) out.id = v.id;
    const area = langText(v.area, HISTORY_LIMITS.title);
    if (area) out.area = area;
    if (typeof v.history === 'string' && (PLACE_HISTORY as readonly string[]).includes(v.history)) out.history = v.history as HistoryPlaceHistory;
    const at = isoTime(v.at);
    if (at) out.at = at;
    return out;
}

const PLACE_HISTORY = ['none', 'first', 'running', 'done', 'empty', 'waiting'] as const;
const REGION_STATES = ['queued', 'running', 'done', 'waiting', 'covered', 'skipped', 'none'] as const;

function parseRegion(id: string, v: unknown): HistoryRegion | null {
    if (!isObj(v) || !HISTORY_REGION_RE.test(id)) return null;
    const state = typeof v.state === 'string' && (REGION_STATES as readonly string[]).includes(v.state)
        ? v.state as HistoryRegionState : 'none';
    const out: HistoryRegion = { id, state };
    const name = langText(v.name, HISTORY_LIMITS.title);
    if (name) out.name = name;
    const at = isoTime(v.at);
    if (at) out.at = at;
    const why = str(v.why, 300);
    if (why) out.why = why;
    if (Array.isArray(v.covered)) {
        const covered = [...new Set(v.covered.filter((c): c is string => typeof c === 'string' && HISTORY_REGION_RE.test(c) && c !== id))].slice(0, 100);
        if (covered.length) out.covered = covered;
    }
    for (const k of ['events', 'hidden', 'places', 'persons', 'facts'] as const) {
        const n = count(v[k]);
        if (n !== undefined) out[k] = n;
    }
    if (Array.isArray(v.gaps)) {
        const gaps = v.gaps
            .filter(isObj)
            .map(g => ({ from: year(g.from), to: year(g.to) }))
            .filter((g): g is { from: number; to: number } => g.from !== undefined && g.to !== undefined && g.to >= g.from)
            .slice(0, 50);
        if (gaps.length) out.gaps = gaps;
    }
    if (v.fill === 'queued' || v.fill === 'running') out.fill = v.fill;
    const order = count(v.order);
    if (order !== undefined && order >= 1) out.order = order;
    if (v.first === true) out.first = true;
    return out;
}

/** An item of R4 `deleted` (the event's whole row, `id` as `event`, with `at`); null when it has no valid id. */
export function parseHistoryDeleted(v: unknown): HistoryDeleted | null {
    if (!isObj(v)) return null;
    const event = typeof v.event === 'string' && ID_RE.test(v.event) ? v.event : undefined;
    if (!event) return null;
    const scope: HistoryScope = v.scope === 'local' || v.scope === 'place' ? v.scope : 'region';
    const out: HistoryDeleted = { event, scope };
    const at = isoTime(v.at);
    if (at) out.at = at;
    const from = year(v.from);
    if (from !== undefined) {
        out.from = from;
        const to = year(v.to);
        if (to !== undefined && to > from) out.to = to;
    }
    const text = langText(v.text, HISTORY_LIMITS.text);
    if (text) out.text = text;
    const region = regionRef(v.region);
    if (region) out.region = region;
    // R4: a local finding names its place by the payload's key (a string); a place's own history by an object.
    const placeId = typeof v.place === 'string' ? str(v.place, 500) : '';
    const place = placeId ? { key: placeId } : eventPlaceRef(v.place);
    if (place) out.place = place;
    if ((HISTORY_KINDS as readonly string[]).includes(v.kind as string)) out.kind = v.kind as HistoryKind;
    const source = parseSource(v.source);
    if (source) out.source = source;
    const local = parseLocal(v.local);
    if (local) out.local = local;
    if (isObj(v.tip)) {
        const tip = langText(v.tip.text, HISTORY_LIMITS.text);
        if (tip) out.tip = { text: tip };
    }
    if (v.sensitive === true) out.sensitive = true;
    return out;
}

function parseState(v: unknown): HistoryState {
    const o = isObj(v) ? v : {};
    const search: HistorySearch = o.search === 'running' || o.search === 'done' || o.search === 'waiting'
        ? o.search : 'none';
    const out: HistoryState = { on: o.on === true, search };
    const at = str(o.at, 40);
    if (at && !Number.isNaN(Date.parse(at))) out.at = at;
    if (typeof o.pending === 'number' && Number.isInteger(o.pending) && o.pending >= 0) out.pending = o.pending;
    const why = str(o.why, 300);
    if (why) out.why = why;
    const rev = str(o.rev, 128);
    if (rev) out.rev = rev;
    if (o.truncated === true) out.truncated = true;
    if (isObj(o.mapping)) {
        const mapped = count(o.mapping.mapped);
        const mappable = count(o.mapping.mappable);
        if (mapped !== undefined && mappable !== undefined && mapped <= mappable) out.mapping = { mapped, mappable };
    }
    return out;
}

function parseHidden(v: unknown): HistoryHidden | null {
    if (!isObj(v)) return null;
    const event = str(v.event, 64);
    const region = str(v.region, 64);
    let out: HistoryHidden;
    if (!event) {
        // Everything of a region (R2): no event.
        if (!region || !HISTORY_REGION_RE.test(region)) return null;
        out = { region };
    } else {
        const place = str(v.place, 500);
        const person = str(v.person, 64);
        out = { event };
        if (place) out.place = place;
        else if (person) out.person = person;
        else if (v.tree === true) out.tree = true;
        else return null;
    }
    const at = str(v.at, 40);
    if (at) out.at = at;
    return out;
}

/**
 * Validate a `GET /history` reply. Defensive like every bridge reply: an invalid
 * event is dropped (without both `source` and `local` too), never the whole
 * reply; lists are capped (3000 events, 5000 places, 20 × 200 also-names).
 * Returns null only for a reply that is not an object at all.
 */
export function parseHistoryPayload(raw: unknown, cachedAt: string, rev?: string): HistoryPayload | null {
    if (!isObj(raw)) return null;
    const events: HistoryEvent[] = [];
    const seen = new Set<string>();
    if (Array.isArray(raw.events)) {
        for (const e of raw.events) {
            if (events.length >= HISTORY_LIMITS.events) break;
            const ev = parseHistoryEvent(e);
            if (!ev || seen.has(ev.id)) continue;
            seen.add(ev.id);
            events.push(ev);
        }
    }
    const places: Record<string, HistoryPlace> = {};
    if (isObj(raw.places)) {
        let n = 0;
        for (const [key, v] of Object.entries(raw.places)) {
            if (n >= HISTORY_LIMITS.places) break;
            if (!key.trim() || key.length > 500) continue;
            const p = parsePlace(v, seen);
            if (!p) continue;
            places[key] = p;
            n++;
        }
    }
    const hidden: HistoryHidden[] = [];
    if (Array.isArray(raw.hidden)) {
        for (const h of raw.hidden) {
            if (hidden.length >= HISTORY_LIMITS.hidden) break;
            const x = parseHidden(h);
            if (x) hidden.push(x);
        }
    }
    const state = parseState(raw.state);
    const out: HistoryPayload = { state, events, places, hidden, cachedAt };
    if (isHistoryLang(raw.lang)) out.lang = raw.lang;
    if (isObj(raw.regions)) {
        const regions: Record<string, HistoryRegion> = {};
        let n = 0;
        for (const [id, v] of Object.entries(raw.regions)) {
            if (n >= HISTORY_LIMITS.regions) break;
            const r = parseRegion(id, v);
            if (!r) continue;
            regions[id] = r;
            n++;
        }
        out.regions = regions;
    }
    if (Array.isArray(raw.suggest)) {
        const suggest = [...new Set(raw.suggest.filter((x): x is string => typeof x === 'string' && HISTORY_PLACE_ID_RE.test(x)))]
            .slice(0, HISTORY_LIMITS.suggest);
        if (suggest.length) out.suggest = suggest;
    }
    if (Array.isArray(raw.deleted)) {
        const deleted: HistoryDeleted[] = [];
        for (const d of raw.deleted) {
            if (deleted.length >= HISTORY_LIMITS.deleted) break;
            const x = parseHistoryDeleted(d);
            if (x && !deleted.some(y => y.event === x.event)) deleted.push(x);
        }
        if (deleted.length) out.deleted = deleted;
    }
    const r = rev ?? state.rev;
    if (r) out.rev = r;
    return out;
}

/**
 * Parse the raw text of a `GET /history` reply. Over 8 MB the reply is refused
 * whole (null: the caller keeps the cache it has), as is text that is not JSON.
 */
export function parseHistoryText(text: string, cachedAt: string, rev?: string): HistoryPayload | null {
    if (text.length > HISTORY_LIMITS.bytes) return null;
    if (new TextEncoder().encode(text).length > HISTORY_LIMITS.bytes) return null;
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return null;
    }
    return parseHistoryPayload(raw, cachedAt, rev);
}

/** Validate a stored cache entry (written by this app, read defensively). */
export function sanitizeCachedHistory(raw: unknown): HistoryPayload | null {
    if (!isObj(raw) || typeof raw.cachedAt !== 'string') return null;
    return parseHistoryPayload(raw, raw.cachedAt, typeof raw.rev === 'string' ? raw.rev : undefined);
}

/** Validate a stored hide queue. */
export function sanitizeHideQueue(raw: unknown): HistoryHideOp[] {
    if (!Array.isArray(raw)) return [];
    const out: HistoryHideOp[] = [];
    for (const v of raw) {
        if (!isObj(v)) continue;
        const event = str(v.event, 64);
        const region = str(v.region, 64);
        const at = str(v.at, 40);
        if (!at) continue;
        let op: HistoryHideOp;
        if (!event) {
            if (!region || !HISTORY_REGION_RE.test(region)) continue;
            op = { region, at };
        } else {
            op = { event, at };
            const place = str(v.place, 500);
            const personId = str(v.personId, 64);
            const personRefn = str(v.personRefn, 64);
            if (place) op.place = place;
            else if (personId || personRefn) {
                if (personId) op.personId = personId;
                if (personRefn) op.personRefn = personRefn;
            } else if (v.tree === true) op.tree = true;
            else continue;
        }
        if (v.do === 'show') op.do = 'show';
        out.push(op);
    }
    return out;
}

// ─── Places ────────────────────────────────────────────────────────────────

/** Index of a payload's places by `placeKey`: exact keys, then also-names (ambiguous ones dropped). */
export interface HistoryPlaceIndex {
    exact: Map<string, string>;
    also: Map<string, string | null>;
}

const placeIndexCache = new WeakMap<HistoryPayload, HistoryPlaceIndex>();

export function historyPlaceIndex(p: HistoryPayload): HistoryPlaceIndex {
    const hit = placeIndexCache.get(p);
    if (hit) return hit;
    const exact = new Map<string, string>();
    const also = new Map<string, string | null>();
    for (const key of Object.keys(p.places)) {
        const k = placeKey(key);
        if (k && !exact.has(k)) exact.set(k, key);
    }
    for (const [key, place] of Object.entries(p.places)) {
        for (const a of place.also ?? []) {
            const k = placeKey(a);
            if (!k) continue;
            const prev = also.get(k);
            if (prev === undefined) also.set(k, key);
            // The same other name for two different places: neither (a wrong region does more harm than none).
            else if (prev !== key) also.set(k, null);
        }
    }
    const idx = { exact, also };
    placeIndexCache.set(p, idx);
    return idx;
}

/**
 * The payload's place key a tree place matches: the exact key first, then an
 * also-name; an also-name of two different places matches none.
 */
export function matchHistoryPlace(p: HistoryPayload, treePlace: string | undefined): string | null {
    if (!treePlace) return null;
    const k = placeKey(treePlace);
    if (!k) return null;
    const idx = historyPlaceIndex(p);
    const exact = idx.exact.get(k);
    if (exact !== undefined) return exact;
    return idx.also.get(k) ?? null;
}

// ─── Where a person lived ──────────────────────────────────────────────────

/** A dated point of a person's life with a place. */
export interface ResidencePoint {
    year: number;
    sortKey: number;
    place: string;
}

const RESIDENCE_KINDS: ReadonlySet<LifelinePoint['kind']> = new Set(['birth', 'death', 'marriage', 'divorce', 'event', 'coupleEvent']);

/** The person's dated points with a place (birth, death, marriages, own and couple events), sorted. */
export function residencePoints(points: readonly LifelinePoint[]): ResidencePoint[] {
    return points
        .filter(pt => RESIDENCE_KINDS.has(pt.kind) && typeof pt.place === 'string' && pt.place.trim())
        .map(pt => ({ year: pt.year, sortKey: pt.sortKey, place: pt.place!.trim() }))
        .sort((a, b) => a.sortKey - b.sortKey);
}

/**
 * Where the person lived in year Y: the place of the dated point nearest to Y
 * (an equal distance takes the earlier point). Y right on points that change
 * the place (a move) gives both places: the old one and the new one.
 */
export function placesInYear(points: readonly ResidencePoint[], y: number): string[] {
    if (!points.length) return [];
    const out: string[] = [];
    const add = (place: string) => {
        if (!out.some(p => placeKey(p) === placeKey(place))) out.push(place);
    };
    const at = points.filter(p => p.year === y);
    if (at.length) {
        const before = [...points].reverse().find(p => p.year < y);
        if (before) add(before.place);
        for (const p of at) add(p.place);
        // Only the place before Y and nothing changed at Y: just the place.
        return out;
    }
    let before: ResidencePoint | undefined;
    let after: ResidencePoint | undefined;
    for (const p of points) {
        if (p.year < y) before = p;
        else if (p.year > y && !after) after = p;
    }
    if (before && after) add(y - before.year <= after.year - y ? before.place : after.place);
    else if (before) add(before.place);
    else if (after) add(after.place);
    return out;
}

// ─── Hidden ────────────────────────────────────────────────────────────────

/** An effective hiding: the research's list plus the local queue on top. */
export interface EffectiveHidden {
    /** Absent only for a region's hiding. */
    event?: string;
    place?: string;
    /** In the whole tree (R2). */
    tree?: true;
    /** Everything of the region (R2). */
    region?: string;
    /** REFN of the person. */
    person?: string;
    /** Tree id of the person (a queued hiding of a person without REFN). */
    personId?: string;
    at?: string;
    /** Not confirmed by the research yet (queued on this device). */
    queued: boolean;
}

interface HideTarget {
    event?: string;
    place?: string;
    person?: string;
    personRefn?: string;
    personId?: string;
    tree?: true;
    region?: string;
}

function sameHideTarget(p: HistoryPayload | null, a: HideTarget, b: HideTarget): boolean {
    if (a.region || b.region) return !a.event && !b.event && a.region === b.region;
    if (a.event !== b.event) return false;
    if (a.tree || b.tree) return !!a.tree && !!b.tree;
    if (a.place || b.place) {
        if (!a.place || !b.place) return false;
        if (placeKey(a.place) === placeKey(b.place)) return true;
        if (!p) return false;
        const ka = matchHistoryPlace(p, a.place);
        return ka !== null && ka === matchHistoryPlace(p, b.place);
    }
    const ra = a.person ?? a.personRefn;
    const rb = b.person ?? b.personRefn;
    if (ra && rb) return ra === rb;
    return !!a.personId && a.personId === b.personId;
}

/**
 * Add a hiding (or its undo) to the queue. An undo cancels a queued hiding of
 * the same target that was not sent yet (and the other way round) instead of
 * queuing both.
 */
export function queueHideOp(queue: readonly HistoryHideOp[], op: HistoryHideOp, p: HistoryPayload | null = null): HistoryHideOp[] {
    const idx = queue.findIndex(q => sameHideTarget(p, q, op) && !!q.do !== !!op.do);
    if (idx >= 0) return [...queue.slice(0, idx), ...queue.slice(idx + 1)];
    if (queue.some(q => sameHideTarget(p, q, op) && !!q.do === !!op.do)) return [...queue];
    return [...queue, op];
}

/** The research's hidden list with the queue applied on top, in order. */
export function effectiveHidden(p: HistoryPayload | null, queue: readonly HistoryHideOp[] = []): EffectiveHidden[] {
    let out: EffectiveHidden[] = (p?.hidden ?? []).map(h => ({ ...h, queued: false }));
    for (const op of queue) {
        const target: HideTarget = op.region && !op.event
            ? { region: op.region }
            : op.tree ? { event: op.event, tree: true } : { event: op.event, place: op.place, person: op.personRefn, personId: op.personId };
        for (const k of Object.keys(target) as (keyof HideTarget)[]) if (target[k] === undefined) delete target[k];
        if (op.do === 'show') {
            out = out.filter(h => !sameHideTarget(p, h, target));
        } else if (!out.some(h => sameHideTarget(p, h, target))) {
            const { personRefn: _r, ...rest } = target;
            out.push({ ...rest, ...(op.at ? { at: op.at } : {}), queued: true });
        }
    }
    return out;
}

// ─── Text ──────────────────────────────────────────────────────────────────

/** A text by language: UI language, then the research's, then the first there is. */
export function pickHistoryText(t: HistoryText | undefined, lang: string, payloadLang?: string): { text: string; lang: string } | null {
    if (!t) return null;
    if (t[lang]) return { text: t[lang], lang };
    if (payloadLang && t[payloadLang]) return { text: t[payloadLang], lang: payloadLang };
    const first = Object.keys(t)[0];
    return first ? { text: t[first], lang: first } : null;
}

// ─── A person's events ─────────────────────────────────────────────────────

export interface LifelineHistoryItem {
    ev: HistoryEvent;
    /** Display year (= ev.from). */
    year: number;
    /** "1866–1868" for an event of more years. */
    yearLabel?: string;
    /** "věk 28" / "age 29–33"; empty without a birth year. */
    age: string;
    /** The tree's spelling of the place the event matched through. */
    place: string;
    /** The payload's key of that place (what a hiding for the place sends). */
    placeKey: string;
    /** Region (or for a local event the place), only when the person's events come from ≥ 2 regions. */
    regionLabel?: string;
    text: string;
    /** Language of `text` (a `lang` attribute when it differs from the UI). */
    textLang: string;
    tip?: string;
    tipLang?: string;
}

/** A hidden item of the person (for "Hidden: n" in the card). */
export interface HiddenHistoryItem extends LifelineHistoryItem {
    hiddenBy: EffectiveHidden;
}

export type HistoryCardState =
    /** Events shown; `somePending` adds the last row "For some places the research is still looking". */
    | { kind: 'events'; somePending: boolean }
    /** 6: no place with a year. */
    | { kind: 'noPlace' }
    /** 9: everything hidden; only "Hidden: n". */
    | { kind: 'allHidden' }
    /** 7: archive / waits for its agent (no link to turn on). */
    | { kind: 'waiting'; why?: string }
    /** 3: the research does not search; the link to turn it on only with `link`. */
    | { kind: 'noSearch'; link: boolean }
    /** 4: still searching. */
    | { kind: 'searching' }
    /** 11: an incomplete result and a place of the person missing: nothing. */
    | { kind: 'silent' }
    /** 5: nothing found. */
    | { kind: 'none' };

/** The kinds the card shows (§6, Settings → Person card; false: off). */
export interface HistoryKinds {
    region: boolean;
    place: boolean;
    local: boolean;
}

export const HISTORY_SCOPE_KINDS = ['region', 'place', 'local'] as const;

/**
 * §6: the kinds the card shows from the stored choice. The place kind is
 * offered only with `history.place` (`placeShown`); when no offered kind is
 * on (a choice made while the place kind was offered), all are shown again —
 * Settings never lets the last one go, the main option switches all off.
 */
export function historyKindsShown(stored: HistoryKinds, placeShown: boolean): HistoryKinds {
    const offered = HISTORY_SCOPE_KINDS.filter(k => k !== 'place' || placeShown);
    return offered.some(k => stored[k]) ? { ...stored } : { region: true, place: true, local: true };
}

/** §6: the kind is the last one on among those offered (its switch cannot go off). */
export function historyKindLocked(kinds: HistoryKinds, kind: keyof HistoryKinds, placeShown: boolean): boolean {
    const offered = HISTORY_SCOPE_KINDS.filter(k => k !== 'place' || placeShown);
    return kinds[kind] && offered.filter(k => kinds[k]).length === 1;
}

export interface PersonHistoryEnv {
    /** Local hide queue (§4.5). */
    queue?: readonly HistoryHideOp[];
    /** §6: kinds switched off in Settings stay out of the card (rows, year counts, "Hidden: n"). */
    kinds?: HistoryKinds;
    /** The research searches for this tree (`/status.experiments.history` while the bridge runs); default `state.on`. */
    searchOn?: boolean;
    /** `tree.state` of the research (`research`, `archive`, …) when known. */
    treeState?: string;
}

export interface PersonHistory {
    /** Visible items, sorted by year, region before local. */
    items: LifelineHistoryItem[];
    /** Items the person would see but are hidden. */
    hidden: HiddenHistoryItem[];
    /** At least one place of the person is `pending` in the payload. */
    placesPending: boolean;
    /** A place of the person is not in the payload at all. */
    placesMissing: boolean;
    /** The person has dated points with a place. */
    hasPlaces: boolean;
    /** The research search state the card goes by. */
    state: HistoryCardState;
    /** §5: regions not searched yet to offer instead of "still looking" (set by the caller: feature, bridge). */
    find?: HistoryFindRegion[];
    /** §6a: the last row for the person's main place's own history (set by the caller: feature, bridge). */
    placeRow?: HistoryPlaceRow;
}

function lifeBounds(person: Person, points: readonly LifelinePoint[]): { birth: number | null; death: number | null; lo: number | null; hi: number | null } {
    const birth = yearOf(person.birthDate);
    const death = yearOf(person.deathDate);
    // A period (resided FROM 1901 TO 1910) counts up to its last year.
    const years = points.map(p => Math.max(p.year, p.endYear ?? p.year));
    const first = years.length ? Math.min(...years) : null;
    const last = years.length ? Math.max(...years) : null;
    return { birth, death, lo: birth ?? first, hi: death ?? last };
}

function ageLabel(lang: Language, ev: HistoryEvent, birth: number | null, death: number | null): string {
    if (birth === null) return '';
    const a = ev.from - birth;
    if (a < 0) return '';
    const end = ev.to !== undefined ? (death !== null ? Math.min(ev.to, death) : ev.to) : ev.from;
    const b = end - birth;
    return getStringsForLang(lang).history.age(b > a ? `${a}–${b}` : String(a));
}

function hidingFor(hidden: readonly EffectiveHidden[], p: HistoryPayload, ev: HistoryEvent, key: string, person: Person): EffectiveHidden | undefined {
    // Wider hidings first: everything of the region, then the whole tree.
    const wide = hidden.find(h => !h.event && !!h.region && ev.scope === 'region' && ev.region?.id === h.region)
        ?? hidden.find(h => h.tree && h.event === ev.id);
    if (wide) return wide;
    return hidden.find(h => {
        if (h.event !== ev.id || h.tree) return false;
        if (h.place) return placeKey(h.place) === placeKey(key) || matchHistoryPlace(p, h.place) === key;
        if (h.person) return !!person.refn && h.person === person.refn;
        return !!h.personId && h.personId === person.id;
    });
}

/**
 * A person's history: the events of the places the person lived in during
 * the person's life, with the person's age, hidden ones apart, and what the
 * card says (§5 order: 6 → events (+4b) → 9 → 7 → 3 → 4 → 11 → 5; states
 * 1 / 2 / 10 are the caller's: no layer, no research, no payload).
 */
export function computePersonHistory(
    data: StromData, personId: string, p: HistoryPayload, lang: Language, env: PersonHistoryEnv = {},
): PersonHistory {
    const person = data.persons[personId as keyof typeof data.persons] as Person | undefined;
    const empty = (state: HistoryCardState): PersonHistory =>
        ({ items: [], hidden: [], placesPending: false, placesMissing: false, hasPlaces: false, state });
    if (!person) return empty({ kind: 'noPlace' });
    const points = computePersonLifeline(data, personId);
    const residence = residencePoints(points);
    if (!residence.length) return empty({ kind: 'noPlace' });

    const { birth, death, lo, hi } = lifeBounds(person, points);
    const hiddenList = effectiveHidden(p, env.queue ?? []);
    const byId = new Map(p.events.map(e => [e.id, e]));

    // The person's places, matched to the payload once.
    let placesPending = false;
    let placesMissing = false;
    const matched = new Map<string, string | null>();
    for (const r of residence) {
        const k = placeKey(r.place);
        if (matched.has(k)) continue;
        const key = matchHistoryPlace(p, r.place);
        matched.set(k, key);
        if (key === null) placesMissing = true;
        else if (p.places[key].state === 'pending') placesPending = true;
    }

    const items: LifelineHistoryItem[] = [];
    const hidden: HiddenHistoryItem[] = [];
    const done = new Set<string>();
    const candidates: { ev: HistoryEvent; place: string; key: string }[] = [];
    let kindOff = 0;
    for (const r of residence) {
        const key = matched.get(placeKey(r.place));
        if (!key) continue;
        for (const id of p.places[key].events) {
            const ev = byId.get(id);
            if (!ev) continue;
            if (env.kinds && !env.kinds[ev.scope]) { kindOff++; continue; }
            candidates.push({ ev, place: r.place, key });
        }
    }
    // Each event once: the first place of the year it applies through that does not hide it.
    const yearPlaces = new Map<number, string[]>();
    const lived = (y: number) => {
        let v = yearPlaces.get(y);
        if (!v) { v = placesInYear(residence, y).map(placeKey); yearPlaces.set(y, v); }
        return v;
    };
    const byEvent = new Map<string, { ev: HistoryEvent; place: string; key: string }[]>();
    for (const c of candidates) {
        if (lo !== null && c.ev.from < lo) continue;
        if (hi !== null && c.ev.from > hi) continue;
        if (!lived(c.ev.from).includes(placeKey(c.place))) continue;
        const list = byEvent.get(c.ev.id) ?? [];
        if (!list.some(x => x.key === c.key)) list.push(c);
        byEvent.set(c.ev.id, list);
    }
    for (const [id, list] of byEvent) {
        if (done.has(id)) continue;
        done.add(id);
        const make = (c: { ev: HistoryEvent; place: string; key: string }): LifelineHistoryItem | null => {
            const t = pickHistoryText(c.ev.text, lang, p.lang);
            if (!t) return null;
            const item: LifelineHistoryItem = {
                ev: c.ev, year: c.ev.from, age: ageLabel(lang, c.ev, birth, death),
                place: c.place, placeKey: c.key, text: t.text, textLang: t.lang,
            };
            if (c.ev.to !== undefined && c.ev.to > c.ev.from) item.yearLabel = `${c.ev.from}–${c.ev.to}`;
            const tip = pickHistoryText(c.ev.tip?.text, lang, p.lang);
            if (tip) { item.tip = tip.text; item.tipLang = tip.lang; }
            return item;
        };
        const open = list.find(c => !hidingFor(hiddenList, p, c.ev, c.key, person));
        if (open) {
            const item = make(open);
            if (item) items.push(item);
        } else {
            const item = make(list[0]);
            const by = hidingFor(hiddenList, p, list[0].ev, list[0].key, person);
            if (item && by) hidden.push({ ...item, hiddenBy: by });
        }
    }

    const rank = { region: 0, place: 1, local: 2 } as const;
    const order = (a: LifelineHistoryItem, b: LifelineHistoryItem) =>
        a.year - b.year || rank[a.ev.scope] - rank[b.ev.scope];
    items.sort(order);
    hidden.sort(order);

    // The region shows only when the person's events come from more than one region.
    const regions = new Set(items.filter(i => i.ev.scope === 'region' && i.ev.region).map(i => i.ev.region!.id));
    if (regions.size >= 2) {
        for (const i of items) {
            if (i.ev.scope !== 'region') i.regionLabel = i.place;
            else if (i.ev.region) i.regionLabel = pickHistoryText(i.ev.region.name, lang, p.lang)?.text ?? i.ev.region.id;
        }
    }

    const state = cardState(p, env, { items: items.length, hidden: hidden.length, placesPending, placesMissing, kindOff: kindOff > 0 });
    return { items, hidden, placesPending, placesMissing, hasPlaces: true, state };
}

/**
 * Does the person card show the layer at all (K1.3)? Only when the research
 * already has events for the tree or searches for them now; otherwise (no
 * search, waiting, an older research, nothing read) the card stays as it was
 * and the state is said in Settings only.
 */
export function historyCardShows(p: HistoryPayload | null, env: { searchOn?: boolean; treeState?: string } = {}): boolean {
    if (p && p.events.length > 0) return true;
    if (historyWaiting(p, env.treeState)) return false;
    return env.searchOn ?? p?.state.on ?? false;
}

/** What decides the card's line "the research does not look for history yet" (spec 020 K1.6). */
export interface HistoryStripEnv {
    /** The layer is on in Settings. */
    layerOn: boolean;
    /** The line was closed in this browser. */
    closed: boolean;
    /** The open tree follows a live research (read-only). */
    following: boolean;
    /** The bridge of the tree's research runs and offers history (`history.events`). */
    bridgeHistory: boolean;
    /** The research's answer whether it searches (`/status.experiments.history`); undefined = an older research that does not say. */
    searchOn: boolean | undefined;
    /** The search was switched off from here this session. */
    offDone: boolean;
    /** "Turn on the search in the research" can be offered (§1.3 canLinkOn). */
    canLinkOn: boolean;
    payload: HistoryPayload | null;
    treeState?: string;
}

/**
 * The card's line "the research does not look for history yet" with the
 * link to switch the search on (K1.6): only where the card shows no layer
 * at all, the research says its search is off and the link can be offered.
 */
export function historyStripShows(env: HistoryStripEnv): boolean {
    if (!env.layerOn || env.closed || env.following || !env.bridgeHistory) return false;
    if (env.offDone || env.searchOn !== false || !env.canLinkOn) return false;
    if (historyWaiting(env.payload, env.treeState)) return false;
    // With events already found the layer itself says the search is off.
    return !historyCardShows(env.payload, { searchOn: false, ...(env.treeState ? { treeState: env.treeState } : {}) });
}

/** Whether the research is waiting (archive, waits for its agent): no search, no link to turn it on. */
export function historyWaiting(p: HistoryPayload | null, treeState?: string): boolean {
    return (!!treeState && treeState !== 'research') || p?.state.search === 'waiting';
}

function cardState(
    p: HistoryPayload, env: PersonHistoryEnv,
    r: { items: number; hidden: number; placesPending: boolean; placesMissing: boolean; kindOff?: boolean },
): HistoryCardState {
    if (r.items > 0) return { kind: 'events', somePending: r.placesPending };
    if (r.hidden > 0) return { kind: 'allHidden' };
    if (historyWaiting(p, env.treeState)) return { kind: 'waiting', ...(p.state.why ? { why: p.state.why } : {}) };
    const searchOn = env.searchOn ?? p.state.on;
    if (!searchOn) return { kind: 'noSearch', link: false };
    if (r.placesPending || ((p.state.search === 'none' || p.state.search === 'running') && r.placesMissing)) return { kind: 'searching' };
    if (p.state.truncated && r.placesMissing) return { kind: 'silent' };
    // Events there, only of kinds switched off (§6): nothing to say ("nothing found" would not be true).
    if (r.kindOff) return { kind: 'silent' };
    return { kind: 'none' };
}

// ─── "Find the history of the region" in the card (§5) ─────────────────────

/** A region the research has not searched yet for a place of the person (§5). */
export interface HistoryFindRegion {
    id: string;
    /** The person's facts in places of the region (in its years). */
    facts: number;
    /** The region was asked to go first already (the sentence of §5.2 right away). */
    first: boolean;
}

/**
 * §5: the regions of the person's places that the research has not searched
 * yet (`queued` / `waiting`; never `skipped`, never an archive), the one with
 * most of the person's facts first — a fact counts for the regions its place
 * has in its year; a tie goes to the lower `order`, then the id. Places not
 * searched (`skip`) do not count. Without R1 regions: none.
 */
export function historyFindRegions(data: StromData, personId: string, p: HistoryPayload,
    env: { treeState?: string } = {}): HistoryFindRegion[] {
    const regions = p.regions;
    if (!regions) return [];
    if (historyWaiting(p, env.treeState)) return [];
    if (!data.persons[personId as keyof typeof data.persons]) return [];
    const residence = residencePoints(computePersonLifeline(data, personId));
    const facts = new Map<string, number>();
    const matched = new Map<string, string | null>();
    for (const r of residence) {
        const k = placeKey(r.place);
        if (!matched.has(k)) matched.set(k, matchHistoryPlace(p, r.place));
        const key = matched.get(k);
        const place = key ? p.places[key] : undefined;
        if (!place || place.skip || !place.regions) continue;
        for (const pr of place.regions) {
            if (pr.from !== undefined && r.year < pr.from) continue;
            if (pr.to !== undefined && r.year > pr.to) continue;
            const region = regions[pr.id];
            if (!region || (region.state !== 'queued' && region.state !== 'waiting')) continue;
            facts.set(pr.id, (facts.get(pr.id) ?? 0) + 1);
        }
    }
    const order = (id: string) => regions[id].order ?? Number.MAX_SAFE_INTEGER;
    return [...facts]
        .sort(([a, x], [b, y]) => y - x || order(a) - order(b) || (a < b ? -1 : a > b ? 1 : 0))
        .map(([id, n]) => ({ id, facts: n, first: regions[id].first === true }));
}

// ─── Local history on request in the card (§6a) ───────────────────────────

/** The place a person lived in longest (§6a.2), as the payload knows it. */
export interface HistoryMainPlace {
    /** The payload's place key. */
    key: string;
    /** The tree's spelling of the place. */
    name: string;
    /** Years of the person's life spent there (by `placesInYear`). */
    years: number;
    /** The person's dated points there. */
    facts: number;
}

/** At most this many years are walked for "lived longest" (a life is shorter). */
const MAIN_PLACE_MAX_YEARS = 150;

/**
 * §6a.2: the person's place of the longest stay among the places the payload
 * knows — every year of the life (birth to death, else the first to the last
 * dated point) counts for the places `placesInYear` gives; a tie goes to more
 * of the person's facts there, then to the place met first. Null: no place.
 */
export function historyMainPlace(data: StromData, personId: string, p: HistoryPayload): HistoryMainPlace | null {
    const person = data.persons[personId as keyof typeof data.persons] as Person | undefined;
    if (!person) return null;
    const points = computePersonLifeline(data, personId);
    const residence = residencePoints(points);
    if (!residence.length) return null;
    const matched = new Map<string, string | null>();
    const out = new Map<string, HistoryMainPlace & { first: number }>();
    const keyOf = (place: string): string | null => {
        const k = placeKey(place);
        if (!matched.has(k)) matched.set(k, matchHistoryPlace(p, place));
        return matched.get(k) ?? null;
    };
    residence.forEach((r, i) => {
        const key = keyOf(r.place);
        if (!key) return;
        const cur = out.get(key);
        if (cur) cur.facts++;
        else out.set(key, { key, name: r.place, years: 0, facts: 1, first: i });
    });
    if (!out.size) return null;
    const { lo, hi } = lifeBounds(person, points);
    if (lo !== null && hi !== null) {
        const end = Math.min(hi, lo + MAIN_PLACE_MAX_YEARS);
        for (let y = lo; y <= end; y++) {
            const seen = new Set<string>();
            for (const place of placesInYear(residence, y)) {
                const key = keyOf(place);
                if (!key || seen.has(key)) continue;
                seen.add(key);
                const cur = out.get(key);
                if (cur) cur.years++;
            }
        }
    }
    const best = [...out.values()].sort((a, b) => b.years - a.years || b.facts - a.facts || a.first - b.first)[0];
    return { key: best.key, name: best.name, years: best.years, facts: best.facts };
}

/** The card's last row for the main place's own history (§6a.4, M5). */
export type HistoryPlaceRow =
    /** none (with an `id`): "… not looked for yet" + "Find local history…". */
    | { kind: 'offer'; key: string; name: string }
    | { kind: 'first' | 'running' | 'empty'; key: string; name: string }
    | { kind: 'waiting'; key: string; name: string; why?: string };

/**
 * §6a.4: what the card says of the main place's own history: its state, or
 * the offer — only when it may be offered (`canOffer`: `history.place`, the
 * bridge running, the research searching, no archive) and the place has the
 * research's record (`id`; links take only that). Done: its events speak
 * (no row); a place not searched for the tree (`skip`): nothing.
 */
/**
 * A place whose own history may be asked for (R6, §6a.2, K7.1a): its record
 * id, not left out, matched to its regions and no history of its own yet.
 * A place whose regions wait for their history (`pending` with regions) may
 * be asked for; one still being matched (`pending` without regions, or placed
 * again) or not placed (`unlocated`) waits for that first.
 */
export function historyPlaceOfferable(place: HistoryPlace | undefined): boolean {
    if (!place?.id || place.skip || place.redo || place.state === 'unlocated') return false;
    if (place.state === 'pending' && !place.regions?.length) return false;
    return !place.history || place.history === 'none';
}

export function historyPlaceRow(p: HistoryPayload, main: HistoryMainPlace | null, canOffer: boolean): HistoryPlaceRow | null {
    if (!main) return null;
    const place = p.places[main.key];
    if (!place || place.skip) return null;
    const base = { key: main.key, name: main.name };
    switch (place.history) {
        case 'first': case 'running': case 'empty': return { kind: place.history, ...base };
        case 'waiting': return { kind: 'waiting', ...base, ...(place.why ? { why: place.why } : {}) };
        case 'done': return null;
        default: return canOffer && historyPlaceOfferable(place) ? { kind: 'offer', ...base } : null;
    }
}

// ─── Year groups ───────────────────────────────────────────────────────────

/** One place in the card's merged order: a row of the person, or a year group of the layer. */
export type HistoryTimelineSlot = { point: number } | { group: number };

/**
 * The person's rows and the layer's year groups in one order: a group goes
 * after the person's last row of a year ≤ its own (the person's rows first
 * within a year); groups after the person's last row go at the end.
 */
export function interleaveHistory(pointYears: readonly number[], groupYears: readonly number[]): HistoryTimelineSlot[] {
    const out: HistoryTimelineSlot[] = [];
    let g = 0;
    pointYears.forEach((year, point) => {
        while (g < groupYears.length && groupYears[g] < year) out.push({ group: g++ });
        out.push({ point });
    });
    while (g < groupYears.length) out.push({ group: g++ });
    return out;
}

/** What a source link of a row says: the publisher, else the page's title. */
export function historySourceLabel(source: Pick<HistorySource, 'title' | 'publisher'>): string {
    return source.publisher || source.title;
}

export interface HistoryYearGroup {
    year: number;
    items: LifelineHistoryItem[];
    /** Shown as one collapsed row ("3 events: war, epidemic, from records ▸"). */
    cluster: boolean;
    /** The cluster's mark: local only when all its events are local. */
    mark: 'region' | 'local';
}

/** Group items by year: ≥ 2 in a year → a cluster; `always` (phone held sideways) clusters every year. */
export function groupHistoryByYear(items: readonly LifelineHistoryItem[], always = false): HistoryYearGroup[] {
    const out: HistoryYearGroup[] = [];
    for (const item of items) {
        const last = out[out.length - 1];
        if (last && last.year === item.year) last.items.push(item);
        else out.push({ year: item.year, items: [item], cluster: false, mark: 'region' });
    }
    for (const g of out) {
        g.cluster = always || g.items.length >= 2;
        g.mark = g.items.every(i => i.ev.scope === 'local') ? 'local' : 'region';
    }
    return out;
}

/** The label of a collapsed cluster: "3 události: válka, epidemie, z pramenů"; expanded only the count. */
export function historyClusterLabel(items: readonly LifelineHistoryItem[], lang: Language, expanded = false): string {
    const h = getStringsForLang(lang).history;
    const head = h.cluster(items.length);
    if (expanded) return head;
    if (items.length === 1) return items[0].text;
    const tags: string[] = [];
    for (const i of items) {
        const tag = i.ev.scope === 'local' ? h.localShort : h.kinds[i.ev.kind];
        if (!tags.includes(tag)) tags.push(tag);
    }
    return `${head}: ${tags.join(', ')}`;
}

// ─── Settings status row ───────────────────────────────────────────────────

export type HistorySettingsAction = 'linkOn' | 'off' | 'linkOff';

export interface HistorySettingsInput {
    /** The app's layer is on (Settings toggle). */
    layerOn: boolean;
    /** The open tree is linked to a research. */
    linked: boolean;
    /** The tree's research bridge answers now. */
    bridgeUp: boolean;
    /** The bridge answers but its `features` lack `history.events` (an older research without the layer). */
    noHistory?: boolean;
    /** The cached (or fresh) payload, if any. */
    payload: HistoryPayload | null;
    /** `/status.experiments.history` (true = searching for this tree), when the bridge says it. */
    statusSearching?: boolean;
    /** `tree.state` (`research`, `archive`, …) when known. */
    treeState?: string;
    canLinkOn: boolean;
    canOff: boolean;
    canLinkOff: boolean;
    /** The search was turned off from here (successful `POST /experiments`), until the status says otherwise. */
    offDone?: boolean;
    /** The bridge's sentence after a failed turn-off (kept until Settings close). */
    offError?: string;
    /** "27. 10. 2026" from an ISO date. */
    formatDate: (iso: string) => string;
    /** "27. 10. 14:05" from an ISO time. */
    formatTime: (iso: string) => string;
}

export interface HistorySettingsStatus {
    text: string;
    action: HistorySettingsAction | null;
}

/** The research's search is on for the tree: the live status wins over the cached payload. */
export function historySearchOn(input: Pick<HistorySettingsInput, 'bridgeUp' | 'payload' | 'statusSearching' | 'offDone'>): boolean {
    if (input.offDone) return false;
    if (input.bridgeUp && input.statusSearching !== undefined) return input.statusSearching;
    return input.payload?.state.on ?? false;
}

/** The status row under the toggle (§1.3); null = the row is hidden. */
export function historySettingsStatus(input: HistorySettingsInput, lang: Language): HistorySettingsStatus | null {
    const h = getStringsForLang(lang).history;
    if (!input.layerOn) {
        if (!input.bridgeUp || input.statusSearching !== true || input.offDone) return null;
        if (input.offError) return { text: `${h.statusStillSearching} ${input.offError}`, action: null };
        const action: HistorySettingsAction | null = input.canOff ? 'off' : input.canLinkOff ? 'linkOff' : null;
        return { text: h.statusStillSearching, action };
    }
    if (!input.linked) return { text: h.statusNoResearch, action: null };
    if (input.bridgeUp && input.noHistory) return { text: h.statusNoHistory, action: null };
    if (!input.bridgeUp && !input.payload) return { text: h.statusNoDevice, action: null };

    const p = input.payload;
    const state: HistoryState = p?.state ?? { on: false, search: 'none' };
    let text: string;
    let action: HistorySettingsAction | null = null;
    if (historyWaiting(p, input.treeState)) {
        text = `${h.statusWaiting(state.why)} ${h.statusFoundKept}`;
    } else if (!historySearchOn(input)) {
        if (input.bridgeUp && input.canLinkOn) {
            text = h.statusNoSearch;
            action = 'linkOn';
        } else {
            text = h.statusNoSearchElsewhere;
        }
    } else if ((state.search === 'running' || state.search === 'none') && (state.pending ?? 0) > 0) {
        text = h.statusRunning(state.pending!);
    } else {
        text = h.statusDone(state.at ? input.formatDate(state.at) : undefined);
    }
    if (state.truncated) text += ` ${h.statusTruncated}`;
    if (!input.bridgeUp && p) {
        text += ` ${h.statusAsOf(input.formatTime(p.cachedAt))}`;
        action = null;
    }
    return { text, action };
}

// ─── Tree places ───────────────────────────────────────────────────────────

/** Tree places by their payload key: the tree's spelling for each matched place. */
export function treePlaceNames(data: StromData, p: HistoryPayload): Map<string, string> {
    const out = new Map<string, string>();
    const consider = (raw: string | undefined) => {
        if (!raw || !raw.trim()) return;
        const key = matchHistoryPlace(p, raw);
        if (key !== null && !out.has(key)) out.set(key, raw.trim());
    };
    for (const person of Object.values(data.persons)) {
        consider(person.birthPlace);
        consider(person.deathPlace);
        for (const ev of person.events ?? []) consider(ev.place);
    }
    for (const u of Object.values(data.partnerships)) {
        consider(u.startPlace);
        consider(u.endPlace);
        for (const ev of u.events ?? []) consider(ev.place);
    }
    return out;
}

/** How many hidden events the tree has (withdrawn events not counted). */
export function historyHiddenCount(p: HistoryPayload | null, queue: readonly HistoryHideOp[] = []): number {
    if (!p) return 0;
    const ids = new Set(p.events.map(e => e.id));
    // A region's hiding counts once (§1.2).
    return effectiveHidden(p, queue).filter(h => (h.event ? ids.has(h.event) : !!h.region)).length;
}
