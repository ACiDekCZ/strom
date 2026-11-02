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
import { checkCandidate, distanceKm, nearOthers, PLACE_FAR_KM, type CheckFinding } from './place-check.js';
import { checkFindingText } from './places-dialog.js';
import { placeGeoHash } from './place-records.js';
import { getStringsForLang, type Language } from './strings.js';

/** At most this many results are offered (A–E). */
export const FIND_MAX = 5;
/** Closer than this a result or the cross is "right at" a place of the tree (km). */
export const AT_PLACE_KM = 0.5;

/** A located place of the tree, as the search compares with it. */
export interface FindTreePoint {
    key: string;
    name: string;
    lat: number;
    lon: number;
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
        if (name) out.push({ key: k, name, lat: g.lat, lon: g.lon });
    }
    return out;
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

/** How far a result lies (undefined when the tree has no other located place). */
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
 * The results: every candidate checked (§5) and measured, ordered near the
 * other places → towns → parts of towns → streets → the rest, the warned
 * ones last (each part in the order the map gave them), at most FIND_MAX,
 * lettered A–E.
 */
export function findResults(input: FindInput): FindResult[] {
    const typed = input.query.trim().toLocaleLowerCase();
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
            distance: findDistance(c.geo, input.tree, warnings),
            near: nearOthers(input.data, input.key, c.geo),
            warnings,
        };
        return { result, index };
    });
    all.sort((a, b) => {
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
    /** The check's first reason; '' when nothing looks odd. */
    warning: string;
}

export function findResultTexts(r: FindResult, lang: Language): FindResultTexts {
    const s = getStringsForLang(lang);
    const d = s.places.dialog;
    const dist = r.distance;
    return {
        sub: [s.map.hitKind(r.kind), r.where].filter(Boolean).join(' · '),
        distance: !dist ? ''
            : dist.kind === 'family' ? d.kmFam(dist.km)
                : dist.kind === 'at' ? d.kmAt(dist.to)
                    : d.kmFrom(dist.km, dist.to),
        foundAs: r.foundAs ? d.foundAs(r.foundAs) : '',
        warning: r.warnings[0] ? checkFindingText(r.warnings[0], lang) : '',
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
