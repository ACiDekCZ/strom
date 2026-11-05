/**
 * The free check of locations (spec 034 §5): a location that does not fit
 * the tree gets the mark "Check". Offline, deterministic, from the tree alone:
 *   - far: the place lies more than PLACE_FAR_KM from each of the family's
 *     other places within ±PLACE_YEARS of the facts there (the distance
 *     reported is to the nearest of them);
 *   - district: the research's record names a parish/district the location's
 *     label does not;
 *   - label: the geocoder's label names a street, a part of a town or another
 *     town, not the place;
 *   - multi: the geocoder found more towns of the name and took the nearest.
 * A location answered "Keep" (keptAt = its hash) and one the research
 * confirmed are not checked while they stay where they are. Nothing here
 * changes a location; it only says what looks odd.
 */

import type { StromData, PlaceGeo, PlaceRecord, PersonId, PlaceJurisdictionKind } from './types.js';
import { forEachPlaceFact, placeKey, townOfPlace } from './places.js';
import { yearOf } from './dates.js';
import { masculineFormIn, surnameForms, surnameKey, withSurnameRules } from './surnames.js';
import { foldText, tokens, streetWord } from './streets.js';
import { placeGeoHash, sameCoords } from './place-records.js';
import { expandPlaceQuery } from './place-query.js';
import type { BridgePlaces } from './places-bridge.js';

/** A place farther than this from its family's other places is marked (km). */
export const PLACE_FAR_KM = 60;
/** A search result this close to the median of the other places is "near the other places" (km). */
export const PLACE_NEAR_KM = 25;
/** The family's places count within this many years of a fact. */
export const PLACE_YEARS = 20;

export type CheckFinding =
    | { kind: 'far'; km: number; family: string; years: [number, number] }
    | { kind: 'district'; expected: string; actual: string; jurisdiction?: PlaceJurisdictionKind }
    | { kind: 'label'; type: 'street' | 'area' | 'other-town' }
    | { kind: 'multi'; count?: number };

/** Great-circle distance in km. */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
    const rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad;
    const dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function median(values: number[]): number {
    const s = [...values].sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** One place fact as the check reads it: where, when, whose family. */
interface CheckFact {
    key: string;
    raw: string;
    year: number | null;
    family: string;
    surname: string;
}

/** The facts indexed by place and by family. */
interface FactIndex {
    byKey: Map<string, CheckFact[]>;
    byFamily: Map<string, CheckFact[]>;
}

function indexFacts(facts: readonly CheckFact[]): FactIndex {
    const byKey = new Map<string, CheckFact[]>();
    const byFamily = new Map<string, CheckFact[]>();
    for (const f of facts) {
        const k = byKey.get(f.key);
        if (k) k.push(f); else byKey.set(f.key, [f]);
        const fam = byFamily.get(f.family);
        if (fam) fam.push(f); else byFamily.set(f.family, [f]);
    }
    return { byKey, byFamily };
}

/** The facts of the tree with a place, each person's family by surname (spellings of a family share it). */
function checkFacts(data: StromData): FactIndex {
    return withSurnameRules(data, () => indexFacts(collectCheckFacts(data)));
}

/**
 * The family of each surname: the surnames joined by their forms (surnameForms),
 * as a whole — Jaworska and Jaworski are one family even where the forms of one
 * reach a spelling the other's do not. A family is named by its first key.
 */
function familiesOf(surnames: Iterable<string>, data: StromData): (surname: string) => string {
    const parent = new Map<string, string>();
    const find = (k: string): string => {
        let r = k;
        while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
        parent.set(k, r);
        return r;
    };
    const join = (a: string, b: string): void => {
        const ra = find(a), rb = find(b);
        if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
    };
    for (const s of surnames) {
        const k = surnameKey(s);
        find(k);
        for (const f of surnameForms(s, data)) {
            const fk = surnameKey(f);
            if (fk) join(k, fk);
        }
    }
    return surname => find(surnameKey(surname));
}

function collectCheckFacts(data: StromData): CheckFact[] {
    const facts: Omit<CheckFact, 'family'>[] = [];
    forEachPlaceFact(data, fact => {
        const raw = fact.place?.trim();
        if (!raw) return;
        const key = placeKey(raw);
        if (!key) return;
        for (const id of fact.persons) {
            const p = data.persons[id as PersonId];
            const surname = p?.lastName?.trim();
            if (!p || p.isPlaceholder || !surname) continue;
            const year = yearOf(fact.date) ?? yearOf(p.birthDate);
            facts.push({ key, raw, year, surname });
        }
    });
    const family = familiesOf(new Set(facts.map(f => f.surname)), data);
    return facts.map(f => ({ ...f, family: family(f.surname) }));
}

/** The research's record of a place, through the tree's refs. */
function recordOf(data: StromData, key: string): PlaceRecord | undefined {
    const id = data.placeRefs?.[key];
    return id ? data.placeRecords?.[id] : undefined;
}

/** The family context of a place: the family's other places around the facts here (and their median). */
interface FamilyContext {
    family: string;
    median: { lat: number; lon: number };
    years: [number, number];
    /** The family's other located places counted (one point each). */
    points: { lat: number; lon: number }[];
}

/** Needs at least this many other places of the family to say anything. */
const MIN_OTHER_PLACES = 2;

/**
 * The family contexts of a place (one per family with facts here), from the
 * located facts of the same family within ±PLACE_YEARS, other places only.
 */
function familyContexts(key: string, facts: FactIndex, places: Record<string, PlaceGeo>): FamilyContext[] {
    const here = (facts.byKey.get(key) ?? []).filter(f => f.year !== null);
    const byFamily = new Map<string, CheckFact[]>();
    for (const f of here) byFamily.set(f.family, [...(byFamily.get(f.family) ?? []), f]);
    const out: FamilyContext[] = [];
    for (const [family, own] of byFamily) {
        const refs = (facts.byFamily.get(family) ?? []).filter(f => f.key !== key && f.year !== null && places[f.key]
            && own.some(o => Math.abs(o.year! - f.year!) <= PLACE_YEARS));
        if (new Set(refs.map(r => r.key)).size < MIN_OTHER_PLACES) continue;
        const years = refs.map(r => r.year!);
        out.push({
            family,
            median: { lat: median(refs.map(r => places[r.key].lat)), lon: median(refs.map(r => places[r.key].lon)) },
            years: [Math.min(...years), Math.max(...years)],
            points: [...new Set(refs.map(r => r.key))].map(k => places[k]),
        });
    }
    return out;
}

/**
 * The surname shown for a family: its basic (masculine) form — Jaworski, not
 * Jaworska, Novák, not Nováková — the one its people here use most (ties:
 * alphabetical); a feminine form only where the family has no other.
 */
function familyName(family: string, facts: FactIndex, data: StromData): string {
    const counts = new Map<string, number>();
    for (const f of facts.byFamily.get(family) ?? []) counts.set(f.surname, (counts.get(f.surname) ?? 0) + 1);
    return withSurnameRules(data, () => {
        const feminine = (s: string): number => (masculineFormIn(s, data) ? 1 : 0);
        return [...counts].sort((a, b) => feminine(a[0]) - feminine(b[0]) || b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? family;
    });
}

const DISTRICT_PATTERNS: readonly RegExp[] = [
    /^okres\s+(.+)$/i, /^(.+)\s+district$/i, /^district\s+of\s+(.+)$/i, /^(?:land)?kreis\s+(.+)$/i,
    /^bezirk\s+(.+)$/i, /^powiat\s+(.+)$/i,
];

/** The district a geocoder label names ("…, okres Jinov, …" → "Jinov"), if any. */
export function labelDistrict(label: string): string | undefined {
    for (const part of label.split(',').map(s => s.trim())) {
        for (const re of DISTRICT_PATTERNS) {
            const m = re.exec(part);
            if (m && m[1].trim()) return m[1].trim();
        }
    }
    return undefined;
}

const PREFERRED_JURISDICTION: readonly PlaceJurisdictionKind[] = ['district', 'parish', 'civil', 'county'];

/** The district/parish the record names now (no end year), in order of preference. */
function expectedJurisdiction(rec: PlaceRecord | undefined): { name: string; kind: PlaceJurisdictionKind } | undefined {
    for (const kind of PREFERRED_JURISDICTION) {
        const j = (rec?.jurisdictions ?? []).filter(x => x.kind === kind).sort((a, b) => (b.from ?? 0) - (a.from ?? 0))
            .find(x => x.to === undefined) ?? rec?.jurisdictions?.find(x => x.kind === kind);
        if (j) return { name: j.name, kind: j.kind };
    }
    return undefined;
}

/** The record's jurisdiction against the label's district. */
function districtFinding(rec: PlaceRecord | undefined, geo: { label?: string }): CheckFinding | undefined {
    const expected = expectedJurisdiction(rec);
    if (!expected || !geo.label) return undefined;
    const actual = labelDistrict(geo.label);
    if (!actual) return undefined;
    const want = foldText(expected.name);
    // The label names the parish/district anywhere (the parish town in the address): fits.
    if (geo.label.split(',').some(part => {
        const f = foldText(part);
        return f === want || f.endsWith(` ${want}`) || f.startsWith(`${want} `);
    })) return undefined;
    return { kind: 'district', expected: expected.name, actual, jurisdiction: expected.kind };
}

/** Significant words of a name (4+ letters), folded. */
function words(text: string): string[] {
    return foldText(text).split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 4);
}

/** Does a part of a label name this place (one of its names)? */
function partNames(part: string, names: readonly string[]): boolean {
    const p = foldText(part);
    if (!p) return false;
    const pw = new Set(words(part));
    return names.some(n => {
        const f = foldText(n);
        return f === p || f.startsWith(`${p} `) || p.startsWith(`${f} `) || words(n).some(w => pw.has(w));
    });
}

/** The label of a geocoder hit against the place's names. */
function labelFinding(geo: { label?: string }, names: readonly string[]): CheckFinding | undefined {
    if (!geo.label || !names.length) return undefined;
    const parts = geo.label.split(',').map(s => s.trim()).filter(Boolean);
    if (!parts.length || partNames(parts[0], names)) return undefined;
    if (parts.slice(1).some(p => partNames(p, names))) {
        return { kind: 'label', type: streetWord(tokens(parts[0])) ? 'street' : 'area' };
    }
    return { kind: 'label', type: 'other-town' };
}

/** The names a place goes by: how the facts write it, its town, spelled out, the research's names. */
function namesOf(key: string, facts: FactIndex, data: StromData): string[] {
    const raw = [...new Set((facts.byKey.get(key) ?? []).map(f => f.raw))];
    const out = new Set<string>();
    for (const r of raw) {
        out.add(r);
        const town = townOfPlace(r)?.town;
        if (town) out.add(town);
        for (const q of expandPlaceQuery(town ?? r, 'cs', data)) out.add(q);
    }
    for (const n of recordOf(data, key)?.names ?? []) out.add(n.name);
    if (!raw.length) out.add(key);
    return [...out];
}

/** The findings for one location of one place, kept/verified aside. */
function findingsFor(
    data: StromData, key: string, geo: Pick<PlaceGeo, 'lat' | 'lon' | 'label' | 'townChoices' | 'origin' | 'byTown'>,
    facts: FactIndex, places: Record<string, PlaceGeo>,
): CheckFinding[] {
    const out: CheckFinding[] = [];
    let far: { km: number; ctx: FamilyContext } | undefined;
    for (const ctx of familyContexts(key, facts, places)) {
        // The distance to the family's nearest other place, not to their median: the median of a family
        // whose branch emigrated lies with the branch, and would make the home village "far" (7712 km from
        // Chicago) though another place of the family lies 56 km away.
        const km = Math.min(...ctx.points.map(p => distanceKm(geo, p)));
        if (km > PLACE_FAR_KM && (!far || km > far.km)) far = { km, ctx };
    }
    if (far) out.push({ kind: 'far', km: Math.round(far.km), family: familyName(far.ctx.family, facts, data), years: far.ctx.years });
    const rec = recordOf(data, key);
    // A location the research itself gave knows its jurisdictions.
    if (!(rec?.coords && sameCoords(rec.coords, geo))) {
        const d = districtFinding(rec, geo);
        if (d) out.push(d);
    }
    // A location picked by hand is not the geocoder's guess; a town point is labelled by its town.
    if (geo.origin !== 'hand' && !geo.byTown) {
        const l = labelFinding(geo, namesOf(key, facts, data));
        if (l) out.push(l);
    }
    if (geo.origin !== 'hand' && (geo.townChoices ?? 0) > 1) out.push({ kind: 'multi', count: geo.townChoices });
    return out;
}

/** The research's live record of a place (`GET /places`), by the text's form or the tree's ref. */
function liveRecordOf(data: StromData, key: string, live: BridgePlaces | null | undefined): PlaceRecord | undefined {
    if (!live) return undefined;
    const id = live.formsByKey[key]?.place ?? data.placeRefs?.[key];
    return id ? live.places[id] : undefined;
}

/** A record that confirms this location: verified, and at the same spot when it has one. */
const confirms = (rec: PlaceRecord | undefined, geo: PlaceGeo): boolean =>
    !!rec?.verified && (!rec.coords || sameCoords(rec.coords, geo));

/**
 * Is this location exempt from the check: answered "Keep", or confirmed by
 * the research (both while it stays). The confirmation counts from the live
 * bridge reply as well as from the tree's records (GEDCOM).
 */
export function checkExempt(data: StromData, key: string, geo: PlaceGeo, live?: BridgePlaces | null): boolean {
    if (geo.keptAt && geo.keptAt === placeGeoHash(geo)) return true;
    return confirms(liveRecordOf(data, key, live), geo) || confirms(recordOf(data, key), geo);
}

export interface CheckOptions {
    /** Only these places (placeKeys); all located ones when absent. */
    keys?: Iterable<string>;
    /** The research's live places (`GET /places`): its confirmations exempt locations too. */
    live?: BridgePlaces | null;
}

/**
 * The check of every located place of the tree: placeKey → its findings,
 * worst first (far, district, label, multi). Places with nothing to say are
 * not in the map.
 */
export function checkPlaces(data: StromData, opts: CheckOptions = {}): Map<string, CheckFinding[]> {
    const places = data.places ?? {};
    const facts = checkFacts(data);
    const keys = opts.keys ? [...opts.keys] : Object.keys(places);
    const out = new Map<string, CheckFinding[]>();
    for (const key of keys) {
        const geo = places[key];
        if (!geo || checkExempt(data, key, geo, opts.live)) continue;
        const found = findingsFor(data, key, geo, facts, places);
        if (found.length) out.set(key, found);
    }
    return out;
}

/** A short hash of what the check reads: the locations, the refs and the facts' places, years and families. */
export function placeCheckKey(data: StromData): string {
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    const feed = (text: string): void => {
        for (let i = 0; i < text.length; i++) {
            const c = text.charCodeAt(i);
            h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
            h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
        }
    };
    feed(JSON.stringify(data.places ?? {}));
    feed(JSON.stringify(data.placeRefs ?? {}));
    for (const id of Object.keys(data.placeRecords ?? {}).sort()) feed(`${id}${data.placeRecords![id].verified ?? ''}`);
    forEachPlaceFact(data, f => {
        if (!f.place) return;
        feed(f.place);
        feed(f.date ?? '');
        for (const id of f.persons) feed(`${data.persons[id]?.lastName ?? ''}${data.persons[id]?.birthDate ?? ''}`);
    });
    feed(JSON.stringify(data.surnameVariants ?? []));
    return `${h1.toString(36)}${h2.toString(36)}`;
}

/** What the check reads of the live places: each text's record and the records' confirmations and spots. */
const liveKeys = new WeakMap<BridgePlaces, string>();
function liveCheckKey(live: BridgePlaces | null | undefined): string {
    if (!live) return '';
    const known = liveKeys.get(live);
    if (known !== undefined) return known;
    const refs = Object.keys(live.formsByKey).sort().map(k => `${k}=${live.formsByKey[k].place ?? ''}`);
    const recs = Object.keys(live.places).sort().map(id => {
        const r = live.places[id];
        return `${id}:${r.verified ?? ''}:${r.coords ? `${r.coords.lat},${r.coords.lon}` : ''}`;
    });
    const out = `${refs.join('|')}#${recs.join('|')}`;
    liveKeys.set(live, out);
    return out;
}

let cache: { key: string; live: string; result: Map<string, CheckFinding[]> } | null = null;

/**
 * checkPlaces over the whole tree, computed again only when what it reads
 * changed (placeCheckKey, and the live places' confirmations when given).
 */
export function checkPlacesCached(data: StromData, live?: BridgePlaces | null): Map<string, CheckFinding[]> {
    const key = placeCheckKey(data);
    const liveKey = liveCheckKey(live);
    if (cache?.key === key && cache.live === liveKey) return cache.result;
    const result = checkPlaces(data, { live });
    cache = { key, live: liveKey, result };
    return result;
}

/**
 * The check of a search result for a place, before it is taken (the warning
 * in the result list): the same rules, the result in place of the location
 * the place has now. "Keep" and the research's confirmation do not apply.
 */
export function checkCandidate(
    data: StromData, key: string, candidate: Pick<PlaceGeo, 'lat' | 'lon' | 'label' | 'townChoices'>,
): CheckFinding[] {
    const places = data.places ?? {};
    return findingsFor(data, key, { ...candidate, origin: 'map' }, checkFacts(data), places);
}

/**
 * Is a location near the tree's other places (≤ PLACE_NEAR_KM from one of
 * the family's places around the facts of this place or from their median),
 * else from the median of all the tree's other located places. False when there is nothing to compare with.
 */
export function nearOthers(data: StromData, key: string, at: { lat: number; lon: number }): boolean {
    const places = data.places ?? {};
    const ctx = familyContexts(key, checkFacts(data), places);
    // A family's place near counts as well: the median of a family with a branch overseas lies overseas.
    if (ctx.some(c => c.points.some(p => distanceKm(at, p) <= PLACE_NEAR_KM))) return true;
    const medians = ctx.length
        ? ctx.map(c => c.median)
        : (() => {
            const others = Object.entries(places).filter(([k]) => k !== key).map(([, g]) => g);
            return others.length >= MIN_OTHER_PLACES
                ? [{ lat: median(others.map(g => g.lat)), lon: median(others.map(g => g.lon)) }] : [];
        })();
    return medians.some(m => distanceKm(at, m) <= PLACE_NEAR_KM);
}
