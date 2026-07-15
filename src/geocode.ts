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

export const GEOCODER_NAME = 'OpenStreetMap Nominatim';
export const GEOCODER_URL = 'https://nominatim.openstreetmap.org/search';

/** Nominatim's usage policy: one request per second, absolute maximum. */
export const REQUEST_INTERVAL_MS = 1100;

/** Shape of the one field we read from a Nominatim result. */
interface NominatimHit {
    lat?: string;
    lon?: string;
    display_name?: string;
}

export function buildGeocodeUrl(place: string, limit = 1): string {
    const params = new URLSearchParams({ q: place, format: 'jsonv2', limit: String(limit) });
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

const defaultWait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Look one place up. Network and parse failures both mean "no coordinates". */
export async function geocodePlace(place: string, options: GeocodeOptions = {}): Promise<PlaceGeo | null> {
    const doFetch = options.fetchFn ?? fetch;
    try {
        const response = await doFetch(buildGeocodeUrl(place), {
            headers: { Accept: 'application/json' },
            signal: options.signal,
        });
        if (!response.ok) return null;
        return parseGeocodeResponse(await response.json());
    } catch {
        return null;  // offline, blocked, rate-limited — all just "unknown"
    }
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
 * Look up several places, one per second, in order. Returns a result for every
 * requested name (null = not found) so callers can report what is still missing.
 * Aborting stops the queue and returns what was found so far.
 */
export async function geocodePlaces(places: string[], options: GeocodeOptions = {}): Promise<Map<string, PlaceGeo | null>> {
    const wait = options.waitFn ?? defaultWait;
    const found = new Map<string, PlaceGeo | null>();

    for (let i = 0; i < places.length; i++) {
        if (options.signal?.aborted) break;
        // Rate limit applies BETWEEN requests, so the first one goes out at once.
        if (i > 0) await wait(REQUEST_INTERVAL_MS);
        if (options.signal?.aborted) break;

        const place = places[i];
        found.set(place, await geocodePlace(place, options));
        options.onProgress?.(i + 1, places.length, place);
    }
    return found;
}
