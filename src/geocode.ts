/**
 * Geocoding (A6): turning the place names already in the tree into coordinates,
 * so they can be shown on a map.
 *
 * This is the ONLY part of Strom that sends anything anywhere, so it is built to
 * be as small a step as possible:
 *   - it never runs without the user explicitly saying yes (AppSettings.geocoding),
 *   - it sends place NAMES only ("Děčín") — never a person, date or relation,
 *   - the answer is stored in the user's own file (StromData.places), so each
 *     place is looked up once and the map works offline for good afterwards.
 *
 * The service is Nominatim (OpenStreetMap). Its usage policy allows at most one
 * request per second, which REQUEST_INTERVAL_MS enforces.
 */

import { PlaceGeo } from './types.js';
import { KnownStreets } from './streets.js';
import { placeKey, townOfPlace } from './places.js';
import { placeGeoHash } from './place-records.js';

export const GEOCODER_NAME = 'OpenStreetMap Nominatim';
export const GEOCODER_URL = 'https://nominatim.openstreetmap.org/search';

/**
 * Nominatim's usage policy asks every application to identify itself so they
 * can reach out instead of blocking. A browser cannot set the User-Agent, and
 * the exported single file runs from file:// where not even a Referer goes out
 * — so the contact rides along as the documented `email` parameter. This is
 * the app's contact, never the user's.
 */
export const GEOCODER_CONTACT = 'milan@stromapp.info';

/** Nominatim's usage policy: one request per second, absolute maximum. */
export const REQUEST_INTERVAL_MS = 1100;

/** Shape of the fields we read from a Nominatim (jsonv2) result. */
interface NominatimHit {
    lat?: string;
    lon?: string;
    display_name?: string;
    /** OSM main tag key ("place", "boundary", "highway"…). */
    category?: string;
    /** OSM main tag value ("village", "administrative", "residential"…). */
    type?: string;
    /** What the hit is as an address part ("village", "town", "road", "house"…). */
    addresstype?: string;
    /** The hit's own name (jsonv2). */
    name?: string;
    /** The address parts, with `addressdetails=1`. */
    address?: Record<string, unknown>;
}

/** Address types of a settlement: a town looked up by name takes only these. */
const SETTLEMENT_TYPES: ReadonlySet<string> = new Set([
    'city', 'town', 'village', 'hamlet', 'municipality', 'suburb', 'quarter', 'isolated_dwelling',
]);

/**
 * Whether a Nominatim hit is a settlement (a city, town, village, hamlet,
 * municipality or a named part of one) rather than an exact address, a street
 * or an area — what a town lookup may take and what the Places dialog's
 * search offers "for the other house numbers too".
 */
export function isSettlementHit(hit: unknown): boolean {
    const h = hit as NominatimHit | null;
    if (!h) return false;
    if (h.addresstype) return SETTLEMENT_TYPES.has(h.addresstype);
    return h.category === 'place' && !!h.type && SETTLEMENT_TYPES.has(h.type);
}

/**
 * `details`: ask for the address parts too (`addressdetails=1`) — the
 * search of the Places dialog shows a result's district and country.
 */
export function buildGeocodeUrl(place: string, limit = 1, details = false): string {
    const params = new URLSearchParams({
        q: place, format: 'jsonv2', limit: String(limit), ...(details ? { addressdetails: '1' } : {}), email: GEOCODER_CONTACT,
    });
    return `${GEOCODER_URL}?${params.toString()}`;
}

/** How many options a manual search offers the user to choose from. */
export const CANDIDATE_LIMIT = 5;

/** One hit, or null if it is missing or nonsense. Never guesses. */
function parseHit(hit: unknown): PlaceGeo | null {
    const h = hit as NominatimHit;
    const lat = Number(h?.lat);
    const lon = Number(h?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return { lat, lon, label: h.display_name?.trim() || undefined };
}

/**
 * Read the first hit. Returns null for "not found" and for anything unexpected —
 * a place we cannot place is simply left without coordinates, never guessed.
 */
export function parseGeocodeResponse(body: unknown): PlaceGeo | null {
    if (!Array.isArray(body) || body.length === 0) return null;
    return parseHit(body[0]);
}

/** Read every usable hit, for a manual search where the user picks. */
export function parseGeocodeCandidates(body: unknown): PlaceGeo[] {
    if (!Array.isArray(body)) return [];
    return body.map(parseHit).filter((p): p is PlaceGeo => p !== null);
}

/** One option of a manual search, with what kind of place it is. */
export interface GeocodeCandidate {
    geo: PlaceGeo;
    /** A settlement (isSettlementHit), not an exact address. */
    settlement: boolean;
    /** The geocoder's address type ("village", "road", "house"…), when it says. */
    kind?: string;
    /** The hit's name and where it lies, from its address parts (with `addressdetails=1`). */
    place?: HitAddress;
}

/** A search result's name, district and country (parseHitAddress). */
export interface HitAddress {
    name?: string;
    /** The district (county) or, without one, the region. */
    district?: string;
    country?: string;
}

const text = (v: unknown): string | undefined => typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : undefined;

/**
 * The name, district and country of a Nominatim hit from its `name` and its
 * `address` (`addressdetails=1`): the district is the county, else the state
 * district, else the state. Undefined when the hit says none of it.
 */
export function parseHitAddress(hit: unknown): HitAddress | undefined {
    const h = hit as NominatimHit | null;
    if (!h || typeof h !== 'object') return undefined;
    const a = h.address && typeof h.address === 'object' && !Array.isArray(h.address) ? h.address : {};
    const kind = h.addresstype ?? '';
    const name = text(h.name) ?? (kind ? text(a[kind]) : undefined);
    const district = text(a.county) ?? text(a.state_district) ?? text(a.state);
    const country = text(a.country);
    if (!name && !district && !country) return undefined;
    return { ...(name ? { name } : {}), ...(district ? { district } : {}), ...(country ? { country } : {}) };
}

/** Read every usable hit with its kind, for the Places dialog's search. */
export function parseGeocodeCandidateDetails(body: unknown): GeocodeCandidate[] {
    if (!Array.isArray(body)) return [];
    const out: GeocodeCandidate[] = [];
    for (const hit of body) {
        const geo = parseHit(hit);
        if (!geo) continue;
        const h = hit as NominatimHit;
        const kind = h.addresstype || h.type;
        const place = parseHitAddress(hit);
        out.push({ geo, settlement: isSettlementHit(hit), ...(kind ? { kind } : {}), ...(place ? { place } : {}) });
    }
    return out;
}

/** What a search option is, for its line in the Places dialog. */
export type HitKind = 'settlement' | 'suburb' | 'road' | 'house' | 'region' | 'other';

const SUBURB_TYPES: ReadonlySet<string> = new Set(['suburb', 'quarter', 'neighbourhood', 'city_district', 'borough', 'city_block']);
const ROAD_TYPES: ReadonlySet<string> = new Set(['road', 'street', 'residential', 'pedestrian', 'square', 'living_street']);
const HOUSE_TYPES: ReadonlySet<string> = new Set(['house', 'building', 'house_number', 'yes', 'farm', 'church']);
const REGION_TYPES: ReadonlySet<string> = new Set(['county', 'state', 'region', 'province', 'district', 'country', 'administrative']);

/** The kind of a search option (GeocodeCandidate) by its address type. */
export function hitKind(c: { settlement: boolean; kind?: string }): HitKind {
    const k = c.kind ?? '';
    if (SUBURB_TYPES.has(k)) return 'suburb';
    if (c.settlement) return 'settlement';
    if (ROAD_TYPES.has(k)) return 'road';
    if (HOUSE_TYPES.has(k)) return 'house';
    if (REGION_TYPES.has(k)) return 'region';
    return 'other';
}

/** A geocoder's label as the option's name (its first part) and where it is (the rest). */
export function hitLabelParts(label: string | undefined): { name: string; region: string } {
    const parts = (label ?? '').split(',').map(p => p.trim()).filter(Boolean);
    return { name: parts[0] ?? '', region: parts.slice(1).join(', ') };
}

/** A point on the globe. */
export interface LatLon {
    lat: number;
    lon: number;
}

/** The centre of the places that already have coordinates; null when none has. */
export function placesCentroid(places: Readonly<Record<string, PlaceGeo>> | undefined): LatLon | null {
    const all = Object.values(places ?? {}).filter(g => Number.isFinite(g?.lat) && Number.isFinite(g?.lon));
    if (all.length === 0) return null;
    return {
        lat: all.reduce((s, g) => s + g.lat, 0) / all.length,
        lon: all.reduce((s, g) => s + g.lon, 0) / all.length,
    };
}

/**
 * Placed by hand or answered "Keep" (while it stays where it was kept): a
 * location a person decided on.
 */
export function isPersonsGeo(geo: PlaceGeo): boolean {
    return geo.origin === 'hand' || (!!geo.keptAt && geo.keptAt === placeGeoHash(geo));
}

/** With at least this many locations a person decided on, those alone make the tree's centre (treeCenter). */
export const PERSONS_CENTER_MIN = 3;

function median(values: number[]): number {
    const s = [...values].sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * The centre that decides between towns of the same name in a lookup run:
 * the median (each axis) of the locations a person decided on (isPersonsGeo)
 * when there are PERSONS_CENTER_MIN of them, else of all the tree's located
 * places together with `extra` (the places the run found without a doubt).
 * A median, not a mean: a branch that emigrated overseas would drag a mean
 * across the ocean. Null when there is no point at all.
 */
export function treeCenter(places: Readonly<Record<string, PlaceGeo>> | undefined, extra: readonly LatLon[] = []): LatLon | null {
    const all = Object.values(places ?? {}).filter(g => Number.isFinite(g?.lat) && Number.isFinite(g?.lon));
    const persons = all.filter(isPersonsGeo);
    const points: LatLon[] = persons.length >= PERSONS_CENTER_MIN ? persons : [...all, ...extra];
    if (points.length === 0) return null;
    return { lat: median(points.map(p => p.lat)), lon: median(points.map(p => p.lon)) };
}

/** Squared distance on a flat map scaled by latitude — enough to pick the nearest of a few towns. */
function distance2(a: LatLon, b: LatLon): number {
    const dLat = a.lat - b.lat;
    const dLon = (a.lon - b.lon) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
    return dLat * dLat + dLon * dLon;
}

/** The option nearest to `centroid`; the first without one. */
export function nearestTo<T extends LatLon>(options: readonly T[], centroid?: LatLon | null): T | undefined {
    if (!centroid) return options[0];
    let best: T | undefined;
    let bestD = Infinity;
    for (const o of options) {
        const d = distance2(o, centroid);
        if (d < bestD) { best = o; bestD = d; }
    }
    return best;
}

export interface GeocodeOptions {
    /** Called after every place, found or not, so the UI can show progress. */
    onProgress?: (done: number, total: number, place: string) => void;
    /** Lets the user stop a long run. */
    signal?: AbortSignal;
    /** Injected in tests; defaults to the browser's fetch. */
    fetchFn?: typeof fetch;
    /** Injected in tests to avoid real waiting. */
    waitFn?: (ms: number) => Promise<void>;
}

/** geocodePlaces' second step: a place with a house that was not found is looked up by its town. */
export interface TownFallbackOptions {
    /** Centre of the tree's places with coordinates (placesCentroid): of several towns, the nearest is taken. */
    centroid?: LatLon | null;
    /** The tree's streets (places.ts knownStreets), so "Lhota, Dlouhá" reads as a street where a house names it. */
    known?: KnownStreets;
}

export interface GeocodePlacesOptions extends GeocodeOptions {
    /**
     * The tree's located places: of several towns named as a place is written
     * (sameNamedTowns), the one nearest to their centre (treeCenter, with the
     * places the run found without a doubt) is taken, decided once the run's
     * requests are done. Absent: the first hit, as without it.
     */
    treePlaces?: Readonly<Record<string, PlaceGeo>>;
    /**
     * When set: a place not found under its full name that holds a house
     * (townOfPlace: a recognised house, or a number alone after a town whose
     * numbers are no parts of it) is looked up by its town — each town once a
     * run, under the same rate limit — and found "by the town" (PlaceGeo.byTown).
     */
    townFallback?: TownFallbackOptions;
}

const defaultWait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Of a place's lookup answer: the settlements named exactly as the place is
 * written (placeKey of the hit's name, else of its label's first part) — the
 * towns of the same name ("Lhota" in five districts). Empty for a place with
 * more to it than a name ("Lhota u Kolína", "Lhota 16").
 */
export function sameNamedTowns(body: unknown, place: string): PlaceGeo[] {
    const key = placeKey(place);
    if (!key) return [];
    return parseGeocodeCandidateDetails(body)
        .filter(c => c.settlement && placeKey(c.place?.name ?? hitLabelParts(c.geo.label).name) === key)
        .map(c => c.geo);
}

/**
 * Of a place's lookup answer: with several towns of the place's name and a
 * centre to compare with, the town nearest to it, with how many there were
 * (`townChoices`); otherwise the first hit, as the geocoder ranks them.
 */
export function pickPlaceHit(body: unknown, place: string, center?: LatLon | null): PlaceGeo | null {
    const towns = center ? sameNamedTowns(body, place) : [];
    if (towns.length < 2) return parseGeocodeResponse(body);
    return { ...nearestTo(towns, center)!, townChoices: towns.length };
}

/** One request for a place (CANDIDATE_LIMIT hits): the answer's body, or null on any failure. */
async function lookUpPlace(place: string, options: GeocodeOptions): Promise<unknown> {
    const doFetch = options.fetchFn ?? fetch;
    try {
        const response = await doFetch(buildGeocodeUrl(place, CANDIDATE_LIMIT), {
            headers: { Accept: 'application/json' },
            signal: options.signal,
        });
        if (!response.ok) return null;
        return await response.json();
    } catch {
        return null;  // offline, blocked, rate-limited — all just "unknown"
    }
}

/**
 * Look one place up (one request). Of several towns of its name, the one
 * nearest to `center` (pickPlaceHit). Network and parse failures both mean
 * "no coordinates".
 */
export async function geocodePlace(place: string, options: GeocodeOptions & { center?: LatLon | null } = {}): Promise<PlaceGeo | null> {
    return pickPlaceHit(await lookUpPlace(place, options), place, options.center);
}

/**
 * Search for a place the automatic lookup could not find, returning several
 * options for the user to choose from. The query is whatever the user typed —
 * usually the nearest town — and is NOT what gets stored: only the coordinates
 * are, under the place the family actually wrote.
 */
export async function geocodeCandidates(query: string, options: GeocodeOptions = {}): Promise<PlaceGeo[]> {
    const doFetch = options.fetchFn ?? fetch;
    try {
        const response = await doFetch(buildGeocodeUrl(query, CANDIDATE_LIMIT), {
            headers: { Accept: 'application/json' },
            signal: options.signal,
        });
        if (!response.ok) return [];
        return parseGeocodeCandidates(await response.json());
    } catch {
        return [];
    }
}

/**
 * The Places dialog's search with the kind of each option (settlement or not),
 * so a settlement picked for a place with a house can be stored "by the town".
 */
export async function searchPlaceCandidates(query: string, options: GeocodeOptions = {}): Promise<GeocodeCandidate[]> {
    const doFetch = options.fetchFn ?? fetch;
    try {
        const response = await doFetch(buildGeocodeUrl(query, CANDIDATE_LIMIT, true), {
            headers: { Accept: 'application/json' },
            signal: options.signal,
        });
        if (!response.ok) return [];
        return parseGeocodeCandidateDetails(await response.json());
    } catch {
        return [];
    }
}

/**
 * Of a town lookup's answer: the settlement nearest to `centroid` (the first
 * without one), as found by `town`, with how many settlements there were when
 * more than one. Null when no settlement is among the hits.
 */
export function pickTownHit(body: unknown, town: string, centroid?: LatLon | null): PlaceGeo | null {
    const towns = parseGeocodeCandidateDetails(body).filter(c => c.settlement).map(c => c.geo);
    const best = nearestTo(towns, centroid);
    if (!best) return null;
    return { ...best, byTown: town, ...(towns.length > 1 ? { townChoices: towns.length } : {}) };
}

/**
 * Look a town up for a place with a house that the geocoder did not find
 * (one request, CANDIDATE_LIMIT hits, settlements only, the nearest to
 * `centroid`). The result carries `byTown: town`. Network and parse failures
 * mean null, as everywhere here.
 */
export async function geocodeTown(town: string, options: GeocodeOptions & { centroid?: LatLon | null } = {}): Promise<PlaceGeo | null> {
    const doFetch = options.fetchFn ?? fetch;
    try {
        const response = await doFetch(buildGeocodeUrl(town, CANDIDATE_LIMIT), {
            headers: { Accept: 'application/json' },
            signal: options.signal,
        });
        if (!response.ok) return null;
        return pickTownHit(await response.json(), town, options.centroid);
    } catch {
        return null;
    }
}

/**
 * Look up several places, one per second, in order. Returns a result for every
 * requested name (null = not found) so callers can report what is still missing.
 * Aborting stops the queue and returns what was found so far.
 */
export async function geocodePlaces(places: string[], options: GeocodePlacesOptions = {}): Promise<Map<string, PlaceGeo | null>> {
    const wait = options.waitFn ?? defaultWait;
    const found = new Map<string, PlaceGeo | null>();
    const fallback = options.townFallback;
    // One town lookup a run: by placeKey of the town, a miss remembered too.
    const towns = new Map<string, PlaceGeo | null>();
    let sent = 0;
    // Rate limit applies BETWEEN requests (town lookups included), so the
    // first one goes out at once. False: aborted, send nothing more.
    const turn = async (): Promise<boolean> => {
        if (options.signal?.aborted) return false;
        if (sent > 0) await wait(REQUEST_INTERVAL_MS);
        if (options.signal?.aborted) return false;
        sent++;
        return true;
    };

    // Places with several towns of their name wait for the end of the run, so the
    // places found meanwhile without a doubt count towards the centre too.
    const doubtful: { place: string; body: unknown }[] = [];
    const sure: LatLon[] = [];

    for (let i = 0; i < places.length; i++) {
        if (!await turn()) break;
        const place = places[i];
        const body = await lookUpPlace(place, options);
        if (options.treePlaces && sameNamedTowns(body, place).length > 1) {
            doubtful.push({ place, body });
            found.set(place, parseGeocodeResponse(body));
            options.onProgress?.(i + 1, places.length, place);
            continue;
        }
        let geo = parseGeocodeResponse(body);
        if (geo) sure.push(geo);
        if (!geo && fallback) {
            const parsed = townOfPlace(place, fallback.known);
            const key = parsed ? placeKey(parsed.town) : '';
            if (parsed && key) {
                if (!towns.has(key)) {
                    if (!await turn()) {
                        found.set(place, null);
                        options.onProgress?.(i + 1, places.length, place);
                        break;
                    }
                    towns.set(key, await geocodeTown(parsed.town, { ...options, centroid: fallback.centroid }));
                }
                const town = towns.get(key);
                if (town) geo = { ...town, byTown: parsed.town };
            }
        }
        found.set(place, geo);
        options.onProgress?.(i + 1, places.length, place);
    }
    if (doubtful.length) {
        const center = treeCenter(options.treePlaces, sure);
        for (const d of doubtful) found.set(d.place, pickPlaceHit(d.body, d.place, center));
    }
    return found;
}

/** A result of searchPlaceForms: the option and the form it was found under. */
export interface FormCandidate {
    candidate: GeocodeCandidate;
    form: string;
}

/**
 * The Places dialog's search under every form of the name (expandPlaceQuery,
 * at most MAX_PLACE_QUERIES): one request per form, REQUEST_INTERVAL_MS
 * between them, the same spot found twice kept once (under the first form).
 * `onForm` after every form, with what is found so far.
 */
export async function searchPlaceForms(forms: readonly string[], options: GeocodeOptions & {
    onForm?: (found: readonly FormCandidate[], asked: number) => void;
} = {}): Promise<FormCandidate[]> {
    const wait = options.waitFn ?? defaultWait;
    const found: FormCandidate[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < forms.length; i++) {
        if (options.signal?.aborted) break;
        if (i > 0) await wait(REQUEST_INTERVAL_MS);
        if (options.signal?.aborted) break;
        for (const c of await searchPlaceCandidates(forms[i]!, options)) {
            const spot = `${c.geo.lat.toFixed(4)},${c.geo.lon.toFixed(4)}`;
            if (seen.has(spot)) continue;
            seen.add(spot);
            found.push({ candidate: c, form: forms[i]! });
        }
        options.onForm?.(found, i + 1);
    }
    return found;
}
