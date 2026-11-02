/**
 * Where each place of the tree stands (spec 034 §1): not on the map, queued
 * in the research, being looked up, waiting for an answer, not identified,
 * flagged by the app's own check, confirmed, placed (and by whom) or located
 * by its town. One function derives it from what the app knows — the tree's
 * locations, the research's place records from its GEDCOM, the live bridge
 * reply and the free check — so the Places dialog, the map, the person card
 * and the waiting list all say the same.
 *
 * Also here: the key places are grouped by (K4.4), the summary counts, the
 * state filter, the "By state" order, the counts and the preview of the bulk
 * look-up / check, and the small HTML badges of a state and an origin.
 */

import type { PlaceGeo, PlaceRecord, PlaceRecordName, StromData } from './types.js';
import type { CheckFinding } from './place-check.js';
import type { LiveWaiting } from './research-link.js';
import { originOfBy, type BridgePlace, type BridgePlaces, type BridgePlaceState } from './places-bridge.js';
import { sameCoords } from './place-records.js';
import { placeKey, sortPlacesByName, townOfPlace, TOWN_POINT_PREFIX, type PlaceUsage } from './places.js';
import type { KnownStreets } from './streets.js';
import { formatFlexDate } from './dates.js';
import { getStringsForLang, type Language } from './strings.js';

export type PlaceState =
    | 'none'       // no location, nobody looks for it
    | 'queued'     // in the research's queue
    | 'running'    // the research works on it
    | 'confirm'    // the research has candidates, a question waits
    | 'undet'      // not identified (why + what would decide)
    | 'placed'     // identified, see origin
    | 'verified'   // confirmed by the research (date)
    | 'check'      // the app's check found something (§5); the location stays
    | 'town';      // located by its town (031)

export type PlaceOrigin = 'research' | 'hand' | 'map' | 'other';

export const PLACE_STATES: readonly PlaceState[] = ['none', 'queued', 'running', 'confirm', 'undet', 'placed', 'verified', 'check', 'town'];

export interface PlaceIdentity {
    state: PlaceState;
    /** placed / verified / check / town: who gave the location. */
    origin?: PlaceOrigin;
    /** ISO date of the identification or of the confirmation (verified). */
    at?: string;
    /** The place has a location on the map (placed, verified, check, town — and a queued check). */
    located: boolean;
    /** The research's record ("L…"). */
    record?: string;
    /** Today's name of the record, with its district and country when known. */
    today?: { name: string; district?: string; country?: string };
    /** The record's other names (by period). */
    former?: PlaceRecordName[];
    /** The research's sentence why it is there (or why it stays undetermined). */
    why?: string;
    /** undet: what would decide. */
    decide?: string;
    source?: { title: string; url?: string };
    /** confirm: how many candidates the question has (when the waiting list says). */
    candidates?: number;
    /** confirm: the waiting question's id. */
    waitingId?: string;
    /** check: the app's findings (§5), worst first. */
    checks?: CheckFinding[];
    /** "Keep": valid while the location stays (hash of the location). */
    keptAt?: string;
    /** town: the town's name the location comes from. */
    town?: string;
    /** A check the research could not decide: why. */
    checkWhy?: string;
}

export interface PlaceIdentityContext {
    data: StromData;
    /** `GET /places`, when the bridge answered. */
    live?: BridgePlaces | null;
    /** The app's check (checkPlacesCached). */
    checks?: ReadonlyMap<string, readonly CheckFinding[]>;
    /** The waiting list (for the number of candidates). */
    waiting?: readonly LiveWaiting[];
}

/** The research's record of a place (live first, then the tree's records) and its live state. */
function recordOf(key: string, ctx: PlaceIdentityContext): { id?: string; rec?: PlaceRecord | BridgePlace; state?: BridgePlaceState } {
    const form = ctx.live?.formsByKey[key];
    const id = form?.place ?? ctx.data.placeRefs?.[key];
    const rec = id ? ctx.live?.places[id] ?? ctx.data.placeRecords?.[id] : undefined;
    const liveRec = id ? ctx.live?.places[id] : undefined;
    return { id: rec ? id : undefined, rec, state: liveRec?.state ?? (rec ? undefined : form?.state) };
}

/** The state a record has without the bridge: from the tree's records. */
function storedState(rec: PlaceRecord): BridgePlaceState | undefined {
    if (rec.unlocated !== undefined) return 'unlocated';
    if (rec.coords && rec.by) return 'identified';
    return undefined;
}

/** How a place of the tree stands now. `key`: placeKey of the place. */
export function placeIdentity(key: string, ctx: PlaceIdentityContext): PlaceIdentity {
    const geo: PlaceGeo | undefined = ctx.data.places?.[key];
    const { id, rec, state: liveState } = recordOf(key, ctx);
    const state = liveState ?? (rec ? storedState(rec) : undefined);
    const out: PlaceIdentity = { state: 'none', located: !!geo };
    if (geo?.keptAt) out.keptAt = geo.keptAt;
    if (id && rec) {
        out.record = id;
        const live = rec as Partial<BridgePlace>;
        const today = rec.names[0]!;
        out.today = { name: today.name, ...(live.district ? { district: live.district } : {}), ...(live.country ? { country: live.country } : {}) };
        if (!out.today.district) {
            const d = rec.jurisdictions?.find(j => j.kind === 'district' && !j.to);
            if (d) out.today.district = d.name;
        }
        if (rec.names.length > 1) out.former = rec.names.slice(1);
        if (rec.why) out.why = rec.why;
        if (rec.source) out.source = rec.source;
        if (live.checkWhy) out.checkWhy = live.checkWhy;
    }

    if (state === 'running' || state === 'queued') {
        out.state = state;
        return out;
    }
    if (state === 'proposed' || state === 'conflict') {
        out.state = 'confirm';
        const w = ctx.waiting?.find(x => x.kind === 'place' && (x.place === id || x.id === id || (x.forms ?? []).some(f => placeKey(f) === key)));
        const waitingId = w?.id ?? (rec as Partial<BridgePlace> | undefined)?.waiting;
        if (waitingId) out.waitingId = waitingId;
        if (w?.candidates?.length) out.candidates = w.candidates.length;
        return out;
    }
    // A place placed by hand stays where it was put, whatever the research could not decide.
    if (state === 'unlocated' && !(geo && geo.origin === 'hand')) {
        out.state = 'undet';
        if (rec?.unlocated) out.why = rec.unlocated;
        if (rec?.needs) out.decide = rec.needs;
        return out;
    }

    const findings = geo ? ctx.checks?.get(key) : undefined;
    if (geo && findings?.length) {
        out.state = 'check';
        out.checks = [...findings];
        out.origin = geo.origin ?? 'map';
        if (geo.at) out.at = geo.at;
        return out;
    }

    if (state === 'identified' && rec?.coords) {
        const local = geo?.origin && sameCoords(rec.coords, geo);
        const coordsDiffer = geo && !sameCoords(rec.coords, geo);
        if (rec.verified && !coordsDiffer) {
            out.state = 'verified';
            out.at = rec.verified;
            out.origin = local ? geo!.origin : originOfBy(rec.by) ?? 'research';
            out.located = true;
            return out;
        }
        out.state = 'placed';
        out.located = true;
        if (local || coordsDiffer) {
            // The app's own location: it wins (its origin, or the geocoder's when it has none).
            out.origin = geo!.origin ?? 'map';
            if (geo!.at) out.at = geo!.at;
        } else {
            out.origin = originOfBy(rec.by) ?? 'research';
            if (rec.at) out.at = rec.at;
        }
        return out;
    }

    if (geo) {
        if (geo.byTown) {
            out.state = 'town';
            out.town = geo.byTown;
            out.origin = geo.origin ?? 'map';
            return out;
        }
        out.state = 'placed';
        out.origin = geo.origin ?? 'map';
        if (geo.at) out.at = geo.at;
        return out;
    }
    return out;
}

/** The identities of many places at once. */
export function placeIdentities(keys: Iterable<string>, ctx: PlaceIdentityContext): Map<string, PlaceIdentity> {
    const out = new Map<string, PlaceIdentity>();
    for (const k of keys) out.set(k, placeIdentity(k, ctx));
    return out;
}

// ==================== GROUPING (K4.4) ====================

export interface IdentityKeyContext {
    data: StromData;
    live?: BridgePlaces | null;
    /** Renames from the history of places (placeKey → placeKey of today's name), step C. */
    aliases?: ReadonlyMap<string, string>;
    known?: KnownStreets;
}

/**
 * What a place is grouped by: its research record ("L…"), else today's name
 * when a rename unites it with another, else its town (`town:<key>`, 031 town
 * and houses), else its own key.
 */
export function identityKey(key: string, ctx: IdentityKeyContext): string {
    const rec = ctx.live?.formsByKey[key]?.place ?? ctx.data.placeRefs?.[key];
    if (rec && (ctx.live?.places[rec] || ctx.data.placeRecords?.[rec])) return rec;
    const alias = ctx.aliases?.get(key);
    if (alias && alias !== key) return alias;
    const town = townOfPlace(key, ctx.known);
    if (town) {
        const t = placeKey(town.town);
        if (t) return TOWN_POINT_PREFIX + t;
    }
    return key;
}

/** The name a group is shown under: the record's today's name, else the most used way of writing among its places. */
export function identityHead(groupKey: string, members: readonly { key: string; usage: PlaceUsage }[], ctx: IdentityKeyContext): string {
    const rec = ctx.live?.places[groupKey] ?? ctx.data.placeRecords?.[groupKey];
    if (rec) return rec.names[0]!.name;
    let best: { display: string; count: number } | null = null;
    for (const m of members) if (!best || m.usage.count > best.count) best = { display: m.usage.display, count: m.usage.count };
    return best?.display ?? groupKey;
}

// ==================== SUMMARY, FILTER, ORDER ====================

/** The chips of the summary line: On the map · Check · To confirm · Not identified · In the research · No location. */
export type PlaceStateFilter = 'all' | 'map' | 'check' | 'confirm' | 'undet' | 'research' | 'none';
export const PLACE_STATE_FILTERS: readonly PlaceStateFilter[] = ['all', 'map', 'check', 'confirm', 'undet', 'research', 'none'];

export function isPlaceStateFilter(v: unknown): v is PlaceStateFilter {
    return PLACE_STATE_FILTERS.includes(v as PlaceStateFilter);
}

/** Does a place pass a chip? "Check" places are on the map too. */
export function placeStateMatches(id: PlaceIdentity, filter: PlaceStateFilter): boolean {
    switch (filter) {
        case 'all': return true;
        case 'map': return id.located;
        case 'check': return id.state === 'check';
        case 'confirm': return id.state === 'confirm';
        case 'undet': return id.state === 'undet';
        case 'research': return id.state === 'queued' || id.state === 'running';
        case 'none': return id.state === 'none';
    }
}

export interface PlaceStateSummary {
    total: number;
    map: number;
    check: number;
    confirm: number;
    undet: number;
    research: number;
    none: number;
}

/** The counts of the summary line (houses and variants count as their own places). */
export function placeStateSummary(ids: Iterable<PlaceIdentity>): PlaceStateSummary {
    const s: PlaceStateSummary = { total: 0, map: 0, check: 0, confirm: 0, undet: 0, research: 0, none: 0 };
    for (const id of ids) {
        s.total++;
        for (const f of ['map', 'check', 'confirm', 'undet', 'research', 'none'] as const) if (placeStateMatches(id, f)) s[f]++;
    }
    return s;
}

/**
 * The chips to show: "On the map" always, the others only with a count —
 * and without the tree's research only the app's own (check, no location).
 */
export function placeSummaryChips(s: PlaceStateSummary, hasResearch: boolean): Exclude<PlaceStateFilter, 'all'>[] {
    const out: Exclude<PlaceStateFilter, 'all'>[] = ['map'];
    const order = hasResearch ? (['check', 'confirm', 'undet', 'research', 'none'] as const) : (['check', 'none'] as const);
    for (const f of order) if (s[f] > 0) out.push(f);
    return out;
}

/**
 * A group passes a filter when its head or any child passes; `children` says
 * which children to show (all when the head passes, else only those that pass).
 */
export function filterPlaceGroup<T>(head: T, children: readonly T[], passes: (x: T) => boolean): { pass: boolean; children: T[] } {
    if (passes(head)) return { pass: true, children: [...children] };
    const kids = children.filter(passes);
    return { pass: kids.length > 0, children: kids };
}

/** "By state": check → confirm → not identified → no location / town → being looked up → queued → placed / confirmed. */
export const PLACE_STATE_ORDER: Readonly<Record<PlaceState, number>> = {
    check: 0, confirm: 1, undet: 2, none: 3, town: 3, running: 4, queued: 5, placed: 6, verified: 6,
};

export function placeStateRank(id: PlaceIdentity): number {
    return PLACE_STATE_ORDER[id.state];
}

/** Rows by state, inside a state by name (the dialog's collator). */
export function sortPlacesByState<T extends { key: string; usage: PlaceUsage }>(
    rows: readonly T[], lang: string, rank: (row: T) => number): T[] {
    return sortPlacesByName(rows, lang).sort((a, b) => rank(a) - rank(b));
}

// ==================== BULK: LOOK UP ALL / CHECK ALL ====================

/** "Look up all not on the map (N)" / "Check all locations (M)": the research's own counts, else the app's. */
export function bulkCounts(ids: Iterable<PlaceIdentity>, live?: BridgePlaces | null): { offMap: number; placed: number } {
    if (live?.counts) return { offMap: live.counts.offMap, placed: live.counts.placed };
    let offMap = 0;
    let placed = 0;
    for (const id of ids) {
        if (id.state === 'none' || id.state === 'undet') offMap++;
        else if (id.located && (id.state === 'placed' || id.state === 'verified' || id.state === 'check' || id.state === 'town')) placed++;
    }
    return { offMap, placed };
}

export interface BulkLookPreview {
    /** Without a location: they go to the queue. */
    queue: number;
    /** Not identified: looked up again. */
    again: number;
    /** Waiting for an answer: skipped (answered in the waiting list). */
    skipConfirm: number;
    /** Already queued or being looked up: skipped. */
    skipResearch: number;
    /** What goes to the queue in all. */
    total: number;
}

/** What "Look up all not on the map" would do with these places. */
export function bulkLookPreview(ids: Iterable<PlaceIdentity>): BulkLookPreview {
    const p: BulkLookPreview = { queue: 0, again: 0, skipConfirm: 0, skipResearch: 0, total: 0 };
    for (const id of ids) {
        if (id.state === 'none') p.queue++;
        else if (id.state === 'undet') p.again++;
        else if (id.state === 'confirm') p.skipConfirm++;
        else if (id.state === 'queued' || id.state === 'running') p.skipResearch++;
    }
    p.total = p.queue + p.again;
    return p;
}

export interface BulkCheckPreview {
    /** Located places that go to the queue for a check. */
    total: number;
    /** Of them flagged by the app's check: they go first. */
    first: number;
    /** Of them placed by hand: the research checks them but does not move them. */
    hand: number;
    /** Already queued or being looked up: skipped. */
    skipResearch: number;
    /** Waiting for an answer: skipped. */
    skipConfirm: number;
}

/** What "Check all locations" would do with these places. */
export function bulkCheckPreview(ids: Iterable<PlaceIdentity>): BulkCheckPreview {
    const p: BulkCheckPreview = { total: 0, first: 0, hand: 0, skipResearch: 0, skipConfirm: 0 };
    for (const id of ids) {
        if (id.state === 'queued' || id.state === 'running') { p.skipResearch++; continue; }
        if (id.state === 'confirm') { p.skipConfirm++; continue; }
        if (!id.located || id.state === 'undet' || id.state === 'none') continue;
        p.total++;
        if (id.state === 'check') p.first++;
        if (id.origin === 'hand') p.hand++;
    }
    return p;
}

// ==================== BADGES ====================

const esc = (s: string): string =>
    s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** The glyph of each state (aria-hidden; the text says it). */
export const PLACE_STATE_GLYPHS: Readonly<Record<PlaceState, string>> = {
    none: '○', queued: '◌', running: '◐', confirm: '?', undet: '⊘', check: '!', verified: '✓', placed: '⌖', town: '⌖',
};

export const PLACE_ORIGIN_GLYPHS: Readonly<Record<PlaceOrigin, string>> = {
    research: '◆', hand: '✛', map: '⌖', other: '⇄',
};

/** An ISO date as the app writes dates ('3. 11. 2026', '3 Nov 2026', '3.11.2026'); '' when it is none. */
export function formatPlaceDate(iso: string | undefined, lang: Language): string {
    const day = iso?.slice(0, 10);
    return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? formatFlexDate(day, lang) : '';
}

/** The text of a state's badge. */
export function placeStateText(id: PlaceIdentity, lang: Language, short = false): string {
    const s = getStringsForLang(lang).places;
    if (short && id.state in s.stateShort) return s.stateShort[id.state as keyof typeof s.stateShort];
    switch (id.state) {
        case 'none': return s.state.none;
        case 'queued': return s.state.queued;
        case 'running': return s.state.running;
        case 'confirm': return id.candidates ? s.state.confirmN(id.candidates) : s.state.confirm;
        case 'undet': return s.state.undet;
        case 'check': return s.state.check;
        case 'verified': return s.state.verified(formatPlaceDate(id.at, lang));
        case 'town': return s.state.town(id.town ?? '');
        case 'placed': return placeOriginText(id.origin ?? 'map', lang, id.at);
    }
}

/** The text of an origin's badge. */
export function placeOriginText(origin: PlaceOrigin, lang: Language, at?: string): string {
    const o = getStringsForLang(lang).places.origin;
    switch (origin) {
        case 'research': return o.research(formatPlaceDate(at, lang));
        case 'hand': return o.hand;
        case 'map': return o.map;
        case 'other': return o.other;
    }
}

export interface PlaceBadgeOptions {
    /** The small badge (11.5 px, short text) of the person card and the map. */
    small?: boolean;
    /** Add the origin badge after the state (verified, check, town); placed shows its origin alone. */
    origin?: boolean;
}

/** The origin badge: `<span class="place-origin" data-origin=…>`. */
export function placeOriginBadge(origin: PlaceOrigin, lang: Language, at?: string, opts: { small?: boolean } = {}): string {
    const cls = opts.small ? 'place-origin is-small' : 'place-origin';
    return `<span class="${cls}" data-origin="${origin}"><span aria-hidden="true">${PLACE_ORIGIN_GLYPHS[origin]}</span> ${esc(placeOriginText(origin, lang, at))}</span>`;
}

/**
 * The state badge as HTML (texts escaped): `<span class="place-state"
 * data-state=…><span aria-hidden="true">glyph</span> text</span>`. A placed
 * place is shown by who placed it (the origin badge).
 */
export function placeStateBadge(id: PlaceIdentity, lang: Language, opts: PlaceBadgeOptions = {}): string {
    if (id.state === 'placed') return placeOriginBadge(id.origin ?? 'map', lang, id.at, opts);
    const cls = opts.small ? 'place-state is-small' : 'place-state';
    const title = id.state === 'running' ? ` title="${esc(getStringsForLang(lang).places.state.runningTitle)}"` : '';
    const badge = `<span class="${cls}" data-state="${id.state}"${title}><span aria-hidden="true">${PLACE_STATE_GLYPHS[id.state]}</span> ${esc(placeStateText(id, lang, opts.small))}</span>`;
    const withOrigin = opts.origin && id.origin && (id.state === 'verified' || id.state === 'check' || id.state === 'town');
    // A confirmed place says the date in its own badge; its origin badge without it.
    return withOrigin ? `${badge} ${placeOriginBadge(id.origin!, lang, id.state === 'verified' ? undefined : id.at, opts)}` : badge;
}
