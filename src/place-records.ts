/**
 * Places identified by Strom Research (spec 034): the research's place
 * records (`StromData.placeRecords`) and which record each place of the facts
 * is (`StromData.placeRefs`).
 *
 * They come from untrusted input — a GEDCOM file, a JSON import, the bridge —
 * so everything goes through the sanitizers here: wrong types, overlong text,
 * ids that are not "L" + digits and links that are not http(s) are dropped.
 *
 * The records belong to the research: a new research version replaces them
 * whole. What belongs to the app is on the location itself (`PlaceGeo.origin`,
 * `at`, `keptAt`) and is kept over a research version by keepPlaceOrigins.
 */

import type {
    StromData, PlaceGeo, PlaceRecord, PlaceRecordName, PlaceJurisdiction, PlaceJurisdictionKind, PlaceRecordBy,
} from './types.js';

/** A research place id: "L" + 1–7 digits. */
export const PLACE_RECORD_ID = /^L\d{1,7}$/;

/** Two locations closer than this (degrees, each axis) are the same location. */
export const SAME_COORDS_DEG = 0.0005;

/** Limits for text read from outside. */
export const PLACE_TEXT_LIMITS = {
    name: 200,
    why: 2000,
    title: 300,
    url: 500,
    reason: 500,
    key: 300,
} as const;

const MAX_NAMES = 30;
const MAX_JURISDICTIONS = 30;
const MAX_RECORDS = 50000;

const JURISDICTION_KINDS: readonly PlaceJurisdictionKind[] = ['parish', 'civil', 'diocese', 'manor', 'district', 'county', 'state', 'other'];
const BY_VALUES: readonly PlaceRecordBy[] = ['research', 'person', 'adopted'];

export function isPlaceRecordId(value: unknown): value is string {
    return typeof value === 'string' && PLACE_RECORD_ID.test(value);
}

/** Text without control characters, trimmed; empty or overlong → undefined. */
export function cleanPlaceText(value: unknown, max: number): string | undefined {
    if (typeof value !== 'string') return undefined;
    // eslint-disable-next-line no-control-regex
    const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
    if (!text || text.length > max) return undefined;
    return text;
}

/** A year as a GEDCOM DATE FROM/TO carries it: a whole number 1–2999. */
export function cleanYear(value: unknown): number | undefined {
    const n = typeof value === 'string' && /^\d{1,4}$/.test(value.trim()) ? Number(value.trim()) : value;
    return typeof n === 'number' && Number.isInteger(n) && n > 0 && n < 3000 ? n : undefined;
}

/** An ISO date or time ("2026-11-03", "2026-11-03T10:12:00Z"). */
export function cleanIsoDate(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const v = value.trim();
    return v.length <= 30 && /^\d{4}-\d{2}-\d{2}(T[0-9:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(v) ? v : undefined;
}

/** An http(s) link, or undefined. */
export function cleanUrl(value: unknown): string | undefined {
    const v = cleanPlaceText(value, PLACE_TEXT_LIMITS.url);
    return v && /^https?:\/\/[^\s<>"]+$/i.test(v) ? v : undefined;
}

/** Latitude/longitude in range, or undefined. */
export function cleanCoords(lat: unknown, lon: unknown): { lat: number; lon: number } | undefined {
    if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
    return { lat, lon };
}

const LANG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

function cleanName(raw: unknown): PlaceRecordName | undefined {
    const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
    const name = cleanPlaceText(r ? r.name : raw, PLACE_TEXT_LIMITS.name);
    if (!name) return undefined;
    const out: PlaceRecordName = { name };
    if (r) {
        if (typeof r.lang === 'string' && LANG.test(r.lang)) out.lang = r.lang;
        const from = cleanYear(r.from);
        const to = cleanYear(r.to);
        if (from) out.from = from;
        if (to) out.to = to;
    }
    return out;
}

function cleanJurisdiction(raw: unknown): PlaceJurisdiction | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const r = raw as Record<string, unknown>;
    const kind = JURISDICTION_KINDS.includes(r.kind as PlaceJurisdictionKind) ? r.kind as PlaceJurisdictionKind : undefined;
    const name = cleanPlaceText(r.name, PLACE_TEXT_LIMITS.name);
    if (!kind || !name) return undefined;
    const out: PlaceJurisdiction = { kind, name };
    const from = cleanYear(r.from);
    const to = cleanYear(r.to);
    if (from) out.from = from;
    if (to) out.to = to;
    return out;
}

/** One record from outside, or undefined when it has no valid id or no name. */
export function sanitizePlaceRecord(raw: unknown, idHint?: string): PlaceRecord | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const r = raw as Record<string, unknown>;
    const id = isPlaceRecordId(r.id) ? r.id : idHint;
    if (!isPlaceRecordId(id)) return undefined;
    const names = (Array.isArray(r.names) ? r.names : [])
        .slice(0, MAX_NAMES).map(cleanName).filter((n): n is PlaceRecordName => !!n);
    if (!names.length) return undefined;
    const out: PlaceRecord = { id, names };
    const c = r.coords && typeof r.coords === 'object' ? r.coords as Record<string, unknown> : null;
    const coords = c ? cleanCoords(c.lat, c.lon) : undefined;
    if (coords) out.coords = coords;
    const jur = (Array.isArray(r.jurisdictions) ? r.jurisdictions : [])
        .slice(0, MAX_JURISDICTIONS).map(cleanJurisdiction).filter((j): j is PlaceJurisdiction => !!j);
    if (jur.length) out.jurisdictions = jur;
    if (isPlaceRecordId(r.parent) && r.parent !== id) out.parent = r.parent;
    if (BY_VALUES.includes(r.by as PlaceRecordBy)) out.by = r.by as PlaceRecordBy;
    const at = cleanIsoDate(r.at);
    if (at) out.at = at;
    const why = cleanPlaceText(r.why, PLACE_TEXT_LIMITS.why);
    if (why) out.why = why;
    const s = r.source && typeof r.source === 'object' ? r.source as Record<string, unknown> : null;
    const title = s ? cleanPlaceText(s.title, PLACE_TEXT_LIMITS.title) : undefined;
    if (title) {
        const url = cleanUrl(s!.url);
        out.source = url ? { title, url } : { title };
    }
    const verified = cleanIsoDate(r.verified);
    if (verified) out.verified = verified;
    // Unlocated even without a reason (or with one too long to keep): '' then.
    if (typeof r.unlocated === 'string') out.unlocated = cleanPlaceText(r.unlocated, PLACE_TEXT_LIMITS.reason) ?? '';
    const needs = cleanPlaceText(r.needs, PLACE_TEXT_LIMITS.reason);
    if (needs) out.needs = needs;
    return out;
}

/** The records of a tree from outside: only valid ones, keyed by their own id. */
export function sanitizePlaceRecords(raw: unknown): Record<string, PlaceRecord> | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const out: Record<string, PlaceRecord> = {};
    let n = 0;
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (n >= MAX_RECORDS) break;
        if (!isPlaceRecordId(key)) continue;
        const rec = sanitizePlaceRecord(value, key);
        if (!rec || rec.id !== key) continue;
        out[key] = rec;
        n++;
    }
    return n ? out : undefined;
}

/**
 * Which record each place is: keys are placeKey()s (short text), values
 * record ids; with `records`, only refs to a record the tree has.
 */
export function sanitizePlaceRefs(raw: unknown, records?: Record<string, PlaceRecord>): Record<string, string> | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const out: Record<string, string> = {};
    let n = 0;
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (n >= MAX_RECORDS) break;
        if (!key || key.length > PLACE_TEXT_LIMITS.key || !isPlaceRecordId(value)) continue;
        if (records && !records[value]) continue;
        out[key] = value;
        n++;
    }
    return n ? out : undefined;
}

/** The app's own fields on a location (who put it there, when, "Keep"), each only when valid. */
export function cleanPlaceGeoMeta(geo: Record<string, unknown>): Pick<PlaceGeo, 'origin' | 'at' | 'keptAt'> {
    const out: Pick<PlaceGeo, 'origin' | 'at' | 'keptAt'> = {};
    if (geo.origin === 'hand' || geo.origin === 'map') out.origin = geo.origin;
    const at = cleanIsoDate(geo.at);
    if (at) out.at = at;
    if (typeof geo.keptAt === 'string' && /^[a-z0-9]{1,24}$/.test(geo.keptAt)) out.keptAt = geo.keptAt;
    return out;
}

/** Do two locations stand at the same spot (SAME_COORDS_DEG on each axis)? */
export function sameCoords(a: { lat: number; lon: number } | undefined, b: { lat: number; lon: number } | undefined): boolean {
    return !!a && !!b && Math.abs(a.lat - b.lat) <= SAME_COORDS_DEG && Math.abs(a.lon - b.lon) <= SAME_COORDS_DEG;
}

/**
 * A short hash of a location (rounded to 4 decimals, ~10 m), what "Keep"
 * remembers: a location moved since then is checked again. Rounded so a
 * location that went through a GEDCOM round trip keeps its hash.
 */
export function placeGeoHash(geo: { lat: number; lon: number }): string {
    const text = `${geo.lat.toFixed(4)},${geo.lon.toFixed(4)}`;
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return (h >>> 0).toString(36);
}

/**
 * A research version brings the locations as plain coordinates (GEDCOM MAP):
 * the app's own fields of a location — who put it there, when, "Keep" — are
 * taken over from the previous state for every place whose location did not
 * move. Returns `next` itself when there is nothing to take over.
 */
export function keepPlaceOrigins(next: StromData, previous: StromData): StromData {
    const before = previous.places;
    const now = next.places;
    if (!before || !now) return next;
    let places: Record<string, PlaceGeo> | null = null;
    for (const [key, geo] of Object.entries(now)) {
        const old = before[key];
        if (!geo || !old || (!old.origin && !old.at && !old.keptAt)) continue;
        if (!sameCoords(geo, old)) continue;
        const meta: Partial<PlaceGeo> = {};
        if (old.origin && !geo.origin) meta.origin = old.origin;
        if (old.at && !geo.at) meta.at = old.at;
        if (old.keptAt && !geo.keptAt) meta.keptAt = old.keptAt;
        if (!Object.keys(meta).length) continue;
        places ??= { ...now };
        places[key] = { ...geo, ...meta };
    }
    return places ? { ...next, places } : next;
}

/** The location without the app's own bookkeeping (who, when, "Keep") — what the research also has. */
export function placesWithoutMeta(places: Record<string, PlaceGeo> | undefined): Record<string, PlaceGeo> | undefined {
    if (!places) return places;
    let out: Record<string, PlaceGeo> | null = null;
    for (const [key, geo] of Object.entries(places)) {
        if (!geo || (geo.origin === undefined && geo.at === undefined && geo.keptAt === undefined)) continue;
        out ??= { ...places };
        const { origin: _o, at: _a, keptAt: _k, ...rest } = geo;
        out[key] = rest;
    }
    return out ?? places;
}

/**
 * The records the given place keys use (with the records they lie in), and
 * the refs of those keys — for a part of a tree (subtree, split).
 */
export function placeRecordsFor(data: StromData, keys: Iterable<string>):
    { placeRecords?: Record<string, PlaceRecord>; placeRefs?: Record<string, string> } {
    const all = data.placeRecords;
    const refsAll = data.placeRefs;
    if (!all || !refsAll) return {};
    const placeRefs: Record<string, string> = {};
    const placeRecords: Record<string, PlaceRecord> = {};
    const add = (id: string | undefined): void => {
        for (let depth = 0; id && all[id] && !placeRecords[id] && depth < 20; depth++) {
            placeRecords[id] = all[id];
            id = all[id].parent;
        }
    };
    for (const key of keys) {
        const id = refsAll[key];
        if (!id || !all[id]) continue;
        placeRefs[key] = id;
        add(id);
    }
    return Object.keys(placeRefs).length ? { placeRecords, placeRefs } : {};
}

/**
 * Records and refs of `incoming` added to `base` (a merge): what `base` has
 * wins; a ref of `incoming` is taken only for a place `base` has no ref for,
 * and only with its record when `base` has no record of that id — a record
 * id that `base` already uses for another place stays `base`'s.
 */
export function mergePlaceRecords(base: StromData, incoming: StromData):
    { placeRecords?: Record<string, PlaceRecord>; placeRefs?: Record<string, string> } {
    const records = { ...(base.placeRecords ?? {}) };
    const refs = { ...(base.placeRefs ?? {}) };
    const inRecords = incoming.placeRecords ?? {};
    for (const [key, id] of Object.entries(incoming.placeRefs ?? {})) {
        if (refs[key]) continue;
        const rec = inRecords[id];
        if (!rec) continue;
        if (records[id] && JSON.stringify(records[id]) !== JSON.stringify(rec)) continue;
        records[id] = rec;
        refs[key] = id;
        for (let p = rec.parent, depth = 0; p && inRecords[p] && !records[p] && depth < 20; depth++) {
            records[p] = inRecords[p];
            p = inRecords[p].parent;
        }
    }
    return {
        ...(Object.keys(records).length ? { placeRecords: records } : {}),
        ...(Object.keys(refs).length ? { placeRefs: refs } : {}),
    };
}
