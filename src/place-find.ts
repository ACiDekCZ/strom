/**
 * The results of the Places dialog's search (spec 034 §6), without the DOM:
 * every form of the name was asked (searchPlaceForms), and what came back
 * becomes at most FIND_MAX results A–E. Each says what it is and where
 * (name · kind · district, country), how far it lies from the tree's places
 * ("4 km from Lhotov", "120 km from the family's other places"), whether it
 * is near the other places, which form found it, and the app's own check of
 * it (§5) — a result the check warns about goes to the bottom, it is never
 * hidden. The same distances describe the cross of "Place by hand".
 *
 * Pure and offline: the tree, the found candidates and the language in,
 * data and texts out. Distances and thresholds come from place-check.ts.
 */

import type { PlaceGeo, StromData } from './types.js';
import type { FormCandidate, GeocodeCandidate, HitKind } from './geocode.js';
import { hitKind, hitLabelParts } from './geocode.js';
import { checkCandidate, distanceKm, familyPlaceKeys, nearOthers, PLACE_FAR_KM, type CheckFinding } from './place-check.js';
import { checkFindingText } from './places-dialog.js';
import { placeGeoHash } from './place-records.js';
import { getStringsForLang, type Language } from './strings.js';

/** At most this many results are offered (A–E). */
export const FIND_MAX = 5;
/** Closer than this a result or the cross is "right at" a place of the tree (km). */
export const AT_PLACE_KM = 0.5;
/**
 * Without a country to tell them by, a result farther than this from the
 * places it is measured by lies far away (km), and a place of the tree this
 * close to a result shown is in its view.
 */
export const FIND_AWAY_KM = 300;

/** A located place of the tree, as the search compares with it. */
export interface FindTreePoint {
    key: string;
    name: string;
    lat: number;
    lon: number;
    /** The country its location's label names, when it names one. */
    country?: string;
}

/** How far a result lies: from the nearest place of the tree, or from the family's places when it is far. */
export type FindDistance =
    | { kind: 'from'; km: number; to: string }
    | { kind: 'at'; to: string }
    | { kind: 'family'; km: number };

/** One result of the search. */
export interface FindResult {
    /** A, B, C… — the same on the small map. */
    letter: string;
    candidate: GeocodeCandidate;
    /** The form of the name that found it. */
    form: string;
    /** Found under another form than the one typed: that form. */
    foundAs?: string;
    name: string;
    kind: HitKind;
    /** "okres Lhotov, Česko" (district, country), else the rest of the geocoder's label. */
    where: string;
    distance?: FindDistance;
    /** Within PLACE_NEAR_KM of the tree's other places (nearOthers). */
    near: boolean;
    /**
     * Far away: in another country than the tree's places (awayFrom) and
     * farther than PLACE_FAR_KM from the places it is measured by. Listed
     * after the others; under "More far away" and only hinted at on the small
     * map when a result lies in the tree's country.
     */
    away: boolean;
    /** The app's check of the result (§5), worst first; empty when nothing looks odd. */
    warnings: CheckFinding[];
}

export interface FindInput {
    /** What searchPlaceForms found, in the order it came. */
    found: readonly FormCandidate[];
    /** The name as typed (the first form). */
    query: string;
    /** The place being searched for (placeKey). */
    key: string;
    data: StromData;
    /** The tree's located places (the place itself left out by findTreePoints). */
    tree: readonly FindTreePoint[];
}

/** The tree's located places other than `key`, with their names (`nameOf`: the dialog's display name). */
export function findTreePoints(data: StromData, key: string, nameOf: (k: string) => string | undefined): FindTreePoint[] {
    const out: FindTreePoint[] = [];
    for (const [k, g] of Object.entries(data.places ?? {})) {
        if (k === key || !Number.isFinite(g?.lat) || !Number.isFinite(g?.lon)) continue;
        const name = nameOf(k);
        const country = labelCountry(g.label);
        if (name) out.push({ key: k, name, lat: g.lat, lon: g.lon, ...(country ? { country } : {}) });
    }
    return out;
}

/** The country a geocoder's label names: its last part, when it has more than one. */
export function labelCountry(label: string | undefined): string | undefined {
    const parts = (label ?? '').split(',').map(p => p.trim()).filter(Boolean);
    return parts.length >= 2 ? parts[parts.length - 1] : undefined;
}

/** A country's name compared: case and accents aside. */
const foldCountry = (c: string): string => c.normalize('NFD').replace(/\p{M}+/gu, '').toLocaleLowerCase();

/** The tree's country: the one most of its located places' labels name (ties: alphabetical); undefined when none names one. */
export function treeCountry(tree: readonly FindTreePoint[]): string | undefined {
    const counts = new Map<string, { name: string; n: number }>();
    for (const p of tree) {
        if (!p.country) continue;
        const k = foldCountry(p.country);
        const c = counts.get(k);
        if (c) c.n++; else counts.set(k, { name: p.country, n: 1 });
    }
    return [...counts.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))[0]?.name;
}

/** Is a country the tree's (`home`)? Undefined when either is not known. */
function inHome(country: string | undefined, home: string | undefined): boolean | undefined {
    return country && home ? foldCountry(country) === foldCountry(home) : undefined;
}

/**
 * Does a result lie far away: farther than PLACE_FAR_KM from the places it is
 * measured by, and in another country than the tree's (`home`), or, with
 * either country unknown, farther than FIND_AWAY_KM. A result with nothing
 * to measure by is never far away.
 */
export function awayFrom(c: GeocodeCandidate, distance: FindDistance | undefined, home: string | undefined): boolean {
    if (!distance || distance.kind === 'at') return false;
    if (distance.km <= PLACE_FAR_KM) return false;
    const same = inHome(c.place?.country ?? labelCountry(c.geo.label), home);
    return same === undefined ? distance.km > FIND_AWAY_KM : !same;
}

/**
 * What the small map fits its view to: the results that are not far away
 * (all of them when every one is) and the tree's places of the tree's
 * country — or, without one to tell them by, those within FIND_AWAY_KM of a
 * result shown. A far result is only hinted at on the map's edge.
 */
export function miniMapFit(list: readonly FindResult[], tree: readonly FindTreePoint[]): { lat: number; lon: number }[] {
    const shown = list.some(r => !r.away) ? list.filter(r => !r.away) : list;
    const at = shown.map(r => ({ lat: r.candidate.geo.lat, lon: r.candidate.geo.lon }));
    const home = treeCountry(tree);
    const places = tree.filter(p => inHome(p.country, home) ?? at.some(g => distanceKm(g, p) <= FIND_AWAY_KM));
    return [...at, ...places.map(p => ({ lat: p.lat, lon: p.lon }))];
}

/** The tree's place nearest to `at`, with the distance; null when the tree has none. */
export function nearestTreePlace(at: { lat: number; lon: number }, tree: readonly FindTreePoint[]): { point: FindTreePoint; km: number } | null {
    let best: { point: FindTreePoint; km: number } | null = null;
    for (const p of tree) {
        const km = distanceKm(p, at);
        if (!best || km < best.km || (km === best.km && p.name.localeCompare(best.point.name) < 0)) best = { point: p, km };
    }
    return best;
}

/** Kilometres as a result says them: whole, at least 1. */
export function wholeKm(km: number): number {
    return Math.max(1, Math.round(km));
}

/** Kilometres as "about": whole under 10, to 5 under 100, to 10 above. */
export function aboutKm(km: number): number {
    if (km < 10) return wholeKm(km);
    if (km < 100) return Math.round(km / 5) * 5;
    return Math.round(km / 10) * 10;
}

/**
 * The compass direction from `from` to `to`, one of eight: 0 north, 1
 * north-east, 2 east … 7 north-west (the order of `pinDirs` in the strings).
 */
export function compassDir(from: { lat: number; lon: number }, to: { lat: number; lon: number }): number {
    const dy = to.lat - from.lat;
    const dx = (to.lon - from.lon) * Math.cos(((from.lat + to.lat) / 2) * Math.PI / 180);
    const deg = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
    return Math.round(deg / 45) % 8;
}

/**
 * How far a result lies (undefined when the tree has no other located
 * place), from `tree`: the places it is measured by (the family's places of
 * the place, else the whole tree; findResults picks them).
 */
export function findDistance(at: { lat: number; lon: number }, tree: readonly FindTreePoint[], warnings: readonly CheckFinding[]): FindDistance | undefined {
    const far = warnings.find((w): w is Extract<CheckFinding, { kind: 'far' }> => w.kind === 'far');
    if (far) return { kind: 'family', km: far.km };
    const nearest = nearestTreePlace(at, tree);
    if (!nearest) return undefined;
    if (nearest.km > PLACE_FAR_KM) return { kind: 'family', km: wholeKm(nearest.km) };
    if (nearest.km < AT_PLACE_KM) return { kind: 'at', to: nearest.point.name };
    return { kind: 'from', km: wholeKm(nearest.km), to: nearest.point.name };
}

/** The order of kinds: towns, then parts of towns, streets, houses, the rest. */
const KIND_RANK: Record<HitKind, number> = { settlement: 0, suburb: 1, road: 2, house: 3, region: 4, other: 4 };

/** A candidate's name and where it lies, from its address parts, else its label. */
function nameAndWhere(c: GeocodeCandidate): { name: string; where: string } {
    const label = hitLabelParts(c.geo.label);
    const name = c.place?.name ?? label.name ?? '';
    const where = c.place && (c.place.district || c.place.country)
        ? [c.place.district, c.place.country].filter(Boolean).join(', ')
        : label.region;
    return { name: name || `${c.geo.lat.toFixed(4)}, ${c.geo.lon.toFixed(4)}`, where };
}

/**
 * The places a result is measured by: the family's places of the place, as
 * the check measures (§5) — a result beside another branch's village is not
 * "near" for this family — else, with no family to say it by, the whole tree.
 */
export function measureTreePoints(data: StromData, key: string, tree: readonly FindTreePoint[]): readonly FindTreePoint[] {
    const family = familyPlaceKeys(data, key);
    const own = tree.filter(p => family.has(p.key));
    return own.length ? own : tree;
}

/**
 * The results: every candidate checked (§5) and measured (measureTreePoints), ordered near the
 * other places → towns → parts of towns → streets → the rest, the warned
 * ones after them and the far away ones (awayFrom) last (each part in the
 * order the map gave them), at most FIND_MAX, lettered A–E.
 */
export function findResults(input: FindInput): FindResult[] {
    const typed = input.query.trim().toLocaleLowerCase();
    const by = measureTreePoints(input.data, input.key, input.tree);
    const home = treeCountry(input.tree);
    const all = input.found.map((f, index) => {
        const c = f.candidate;
        const warnings = checkCandidate(input.data, input.key, c.geo);
        const { name, where } = nameAndWhere(c);
        const result: FindResult = {
            letter: '',
            candidate: c,
            form: f.form,
            ...(f.form.trim().toLocaleLowerCase() !== typed ? { foundAs: f.form } : {}),
            name,
            kind: hitKind(c),
            where,
            distance: findDistance(c.geo, by, warnings),
            near: nearOthers(input.data, input.key, c.geo),
            away: false,
            warnings,
        };
        result.away = awayFrom(c, result.distance, home);
        return { result, index };
    });
    all.sort((a, b) => {
        // The far away ones after all the others, so the country's results keep their letters and none is cut off.
        const aa = a.result.away ? 1 : 0;
        const ab = b.result.away ? 1 : 0;
        if (aa !== ab) return aa - ab;
        const wa = a.result.warnings.length ? 1 : 0;
        const wb = b.result.warnings.length ? 1 : 0;
        if (wa !== wb) return wa - wb;
        const na = a.result.near ? 0 : 1;
        const nb = b.result.near ? 0 : 1;
        if (na !== nb) return na - nb;
        const ka = KIND_RANK[a.result.kind];
        const kb = KIND_RANK[b.result.kind];
        if (ka !== kb) return ka - kb;
        return a.index - b.index;
    });
    return all.slice(0, FIND_MAX).map(({ result }, i) => ({ ...result, letter: String.fromCharCode(65 + i) }));
}

/** The forms asked besides the one typed ("Also searched as"). */
export function otherForms(forms: readonly string[], query: string): string[] {
    const typed = query.trim().toLocaleLowerCase();
    return forms.filter(f => f.trim().toLocaleLowerCase() !== typed);
}

/** The lines of a result, in the UI language. */
export interface FindResultTexts {
    /** "town · okres Lhotov, Česko" */
    sub: string;
    /** "4 km from Lhotov" / "120 km from the family's other places"; '' without places to compare with. */
    distance: string;
    /** "found as Horní Lhota"; '' when found as typed. */
    foundAs: string;
    /**
     * The check's first reason; '' when nothing looks odd. Far from the family
     * or in another district: it may be another place of the same name.
     */
    warning: string;
}

export function findResultTexts(r: FindResult, lang: Language): FindResultTexts {
    const s = getStringsForLang(lang);
    const d = s.places.dialog;
    const dist = r.distance;
    const w = r.warnings[0];
    return {
        sub: [s.map.hitKind(r.kind), r.where].filter(Boolean).join(' · '),
        distance: !dist ? ''
            : dist.kind === 'family' ? d.kmFam(dist.km)
                : dist.kind === 'at' ? d.kmAt(dist.to)
                    : d.kmFrom(dist.km, dist.to),
        foundAs: r.foundAs ? d.foundAs(r.foundAs) : '',
        warning: !w ? '' : w.kind === 'far' || w.kind === 'district' ? `${checkFindingText(w, lang)} ${d.checkSameName}` : checkFindingText(w, lang),
    };
}

/**
 * Where the cross of "Place by hand" stands, said by the tree's nearest
 * place: "Cross: about 3 km south-west of Lhotov", "Cross: at Lhotov", and
 * with no place to say it by, the coordinates.
 */
export function crossDescription(at: { lat: number; lon: number }, tree: readonly FindTreePoint[], lang: Language): string {
    const d = getStringsForLang(lang).places.dialog;
    const nearest = nearestTreePlace(at, tree);
    if (!nearest) return d.pinAtCoords(at.lat.toFixed(4), at.lon.toFixed(4));
    if (nearest.km < AT_PLACE_KM) return d.pinAtPlace(nearest.point.name);
    return d.pinAt(aboutKm(nearest.km), d.pinDirs[compassDir(nearest.point, at)] ?? '', nearest.point.name);
}

/**
 * A location as it is written: who put it there (`hand`: picked or placed by
 * a person, `map`: taken by the app from the geocoder) and the day. A Keep of
 * an earlier location never carries over; `keep` answers the check's warning
 * of this one (the warned result was picked knowingly).
 */
export function stampedGeo(geo: PlaceGeo, origin: 'hand' | 'map', opts: { keep?: boolean; now?: Date } = {}): PlaceGeo {
    const { keptAt: _old, ...rest } = geo;
    const at = (opts.now ?? new Date()).toISOString().slice(0, 10);
    return { ...rest, origin, at, ...(opts.keep ? { keptAt: placeGeoHash(geo) } : {}) };
}
