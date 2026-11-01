/**
 * Geocoding (src/geocode.ts). No real network: fetch and the rate-limit wait are
 * injected, so these tests pin down the promises made in the module header —
 * place names only, one request per second, a failure is never a guess.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    buildGeocodeUrl, geocodeCandidates, geocodePlace, geocodePlaces,
    parseGeocodeCandidates, parseGeocodeResponse, placesCentroid, isSettlementHit, searchPlaceCandidates,
    CANDIDATE_LIMIT, GEOCODER_URL, GEOCODER_CONTACT, REQUEST_INTERVAL_MS,
} from '../geocode.js';

const hit = (lat: string, lon: string, name = 'Somewhere'): unknown =>
    [{ lat, lon, display_name: name }];

const okResponse = (body: unknown): Response =>
    ({ ok: true, json: async () => body } as Response);

describe('buildGeocodeUrl', () => {
    it('asks the geocoder for one result for the place name', () => {
        const url = new URL(buildGeocodeUrl('Praha'));
        expect(`${url.origin}${url.pathname}`).toBe(GEOCODER_URL);
        expect(url.searchParams.get('q')).toBe('Praha');
        expect(url.searchParams.get('limit')).toBe('1');
    });

    it('sends the place name and nothing else about the family', () => {
        const url = new URL(buildGeocodeUrl('Ústí nad Labem'));
        // `email` is the app's own contact (Nominatim asks every application to
        // identify itself) — a constant, never anything from the user's data.
        expect([...url.searchParams.keys()].sort()).toEqual(['email', 'format', 'limit', 'q']);
        expect(url.searchParams.get('q')).toBe('Ústí nad Labem');
        expect(url.searchParams.get('email')).toBe(GEOCODER_CONTACT);
    });
});

describe('parseGeocodeResponse', () => {
    it('reads the first hit', () => {
        expect(parseGeocodeResponse(hit('50.08', '14.44', 'Praha, Česko')))
            .toEqual({ lat: 50.08, lon: 14.44, label: 'Praha, Česko' });
    });

    it('treats "not found" as no coordinates', () => {
        expect(parseGeocodeResponse([])).toBeNull();
    });

    it('never guesses from a broken answer', () => {
        expect(parseGeocodeResponse(null)).toBeNull();
        expect(parseGeocodeResponse({ lat: 1, lon: 2 })).toBeNull();
        expect(parseGeocodeResponse([{ lat: 'nonsense', lon: '14' }])).toBeNull();
        expect(parseGeocodeResponse([{ lat: '999', lon: '14' }])).toBeNull();
    });
});

describe('parseGeocodeCandidates', () => {
    it('keeps every usable option, in the order given', () => {
        const body = [
            { lat: '50.0', lon: '14.0', display_name: 'First' },
            { lat: '51.0', lon: '15.0', display_name: 'Second' },
        ];
        expect(parseGeocodeCandidates(body)).toEqual([
            { lat: 50, lon: 14, label: 'First' },
            { lat: 51, lon: 15, label: 'Second' },
        ]);
    });

    it('drops the broken ones rather than the whole answer', () => {
        const body = [
            { lat: 'nonsense', lon: '14.0' },
            { lat: '51.0', lon: '15.0', display_name: 'Good' },
        ];
        expect(parseGeocodeCandidates(body)).toEqual([{ lat: 51, lon: 15, label: 'Good' }]);
    });

    it('has nothing to offer for an empty or broken answer', () => {
        expect(parseGeocodeCandidates([])).toEqual([]);
        expect(parseGeocodeCandidates(null)).toEqual([]);
    });
});

describe('geocodeCandidates', () => {
    it('asks for several options so the user can choose', async () => {
        const fetchFn = vi.fn().mockResolvedValue(okResponse(hit('50.0', '14.0', 'Kravaře')));
        await geocodeCandidates('Kravaře', { fetchFn });

        const url = new URL(fetchFn.mock.calls[0][0] as string);
        expect(url.searchParams.get('q')).toBe('Kravaře');
        expect(url.searchParams.get('limit')).toBe(String(CANDIDATE_LIMIT));
        expect(CANDIDATE_LIMIT).toBeGreaterThan(1);
    });

    it('offers nothing rather than throwing when the search fails', async () => {
        const fetchFn = vi.fn().mockRejectedValue(new Error('offline'));
        await expect(geocodeCandidates('Kravaře', { fetchFn })).resolves.toEqual([]);
    });
});

describe('geocodePlace', () => {
    it('returns the coordinates of a found place', async () => {
        const fetchFn = vi.fn().mockResolvedValue(okResponse(hit('51.5', '-0.12', 'London')));
        await expect(geocodePlace('London', { fetchFn })).resolves
            .toEqual({ lat: 51.5, lon: -0.12, label: 'London' });
    });

    it('reports no coordinates when the service says no', async () => {
        const fetchFn = vi.fn().mockResolvedValue({ ok: false } as Response);
        await expect(geocodePlace('Nowhere', { fetchFn })).resolves.toBeNull();
    });

    it('reports no coordinates when offline, instead of throwing', async () => {
        const fetchFn = vi.fn().mockRejectedValue(new Error('network down'));
        await expect(geocodePlace('Praha', { fetchFn })).resolves.toBeNull();
    });
});

describe('geocodePlaces', () => {
    it('returns an entry for every place, found or not', async () => {
        const fetchFn = vi.fn()
            .mockResolvedValueOnce(okResponse(hit('50.08', '14.44')))
            .mockResolvedValueOnce(okResponse([]));
        const waitFn = vi.fn().mockResolvedValue(undefined);

        const found = await geocodePlaces(['Praha', 'Made Up'], { fetchFn, waitFn });
        expect([...found.keys()]).toEqual(['Praha', 'Made Up']);
        expect(found.get('Praha')).toMatchObject({ lat: 50.08, lon: 14.44 });
        expect(found.get('Made Up')).toBeNull();
    });

    it('keeps to one request per second between lookups', async () => {
        const fetchFn = vi.fn().mockResolvedValue(okResponse(hit('50', '14')));
        const waitFn = vi.fn().mockResolvedValue(undefined);

        await geocodePlaces(['A', 'B', 'C'], { fetchFn, waitFn });
        // Waits BETWEEN requests only — the first one goes out straight away.
        expect(waitFn).toHaveBeenCalledTimes(2);
        expect(waitFn).toHaveBeenCalledWith(REQUEST_INTERVAL_MS);
        expect(REQUEST_INTERVAL_MS).toBeGreaterThanOrEqual(1000);
    });

    it('reports progress after each place', async () => {
        const fetchFn = vi.fn().mockResolvedValue(okResponse(hit('50', '14')));
        const waitFn = vi.fn().mockResolvedValue(undefined);
        const onProgress = vi.fn();

        await geocodePlaces(['A', 'B'], { fetchFn, waitFn, onProgress });
        expect(onProgress).toHaveBeenNthCalledWith(1, 1, 2, 'A');
        expect(onProgress).toHaveBeenNthCalledWith(2, 2, 2, 'B');
    });

    it('stops sending place names the moment the user cancels', async () => {
        const controller = new AbortController();
        const fetchFn = vi.fn().mockImplementation(async () => {
            controller.abort();  // user hits Cancel while the first lookup runs
            return okResponse(hit('50', '14'));
        });
        const waitFn = vi.fn().mockResolvedValue(undefined);

        const found = await geocodePlaces(['A', 'B', 'C'], { fetchFn, waitFn, signal: controller.signal });
        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(found.size).toBe(1);
    });

    it('does nothing at all when there is nothing to look up', async () => {
        const fetchFn = vi.fn();
        await expect(geocodePlaces([], { fetchFn })).resolves.toEqual(new Map());
        expect(fetchFn).not.toHaveBeenCalled();
    });
});

describe('geocodePlaces — a house not found is found by its town', () => {
    const village = (lat: string, name: string) => ({ lat, lon: '15.0', display_name: name, category: 'boundary', type: 'administrative', addresstype: 'village' });
    const road = { lat: '40.0', lon: '15.0', display_name: 'Kopřivná, Somewhere', category: 'highway', type: 'residential', addresstype: 'road' };
    /** Answers by query: a full house name is never found, a town by its hits. */
    const geocoder = (towns: Record<string, unknown[]>) => vi.fn().mockImplementation(async (url: string) =>
        okResponse(towns[new URL(url).searchParams.get('q')!] ?? []));
    const queries = (fetchFn: ReturnType<typeof vi.fn>) => fetchFn.mock.calls.map(c => new URL(c[0] as string).searchParams.get('q'));

    it('looks the town up only after the full name failed, once a town, the nearest to the tree\'s places', async () => {
        const fetchFn = geocoder({
            'Bělokamen': [village('41.0', 'Bělokamen far'), road, village('49.1', 'Bělokamen near')],
            'Lhotín': [{ lat: '48.0', lon: '14.0', display_name: 'Lhotín' }],
        });
        const waitFn = vi.fn().mockResolvedValue(undefined);
        const centroid = placesCentroid({ a: { lat: 49, lon: 15 }, b: { lat: 50, lon: 15 } });
        const found = await geocodePlaces(['Lhotín', 'Bělokamen čp. 4', 'Bělokamen 16', 'Bělokamen, Kopřivná 12'],
            { fetchFn, waitFn, townFallback: { centroid } });

        expect(queries(fetchFn)).toEqual(['Lhotín', 'Bělokamen čp. 4', 'Bělokamen', 'Bělokamen 16', 'Bělokamen, Kopřivná 12']);
        expect(found.get('Lhotín')).toEqual({ lat: 48, lon: 14, label: 'Lhotín' });   // found by its name: no town
        expect(found.get('Bělokamen čp. 4')).toEqual({ lat: 49.1, lon: 15, label: 'Bělokamen near', byTown: 'Bělokamen', townChoices: 2 });
        expect(found.get('Bělokamen 16')).toMatchObject({ lat: 49.1, byTown: 'Bělokamen' });
        expect(found.get('Bělokamen, Kopřivná 12')).toMatchObject({ lat: 49.1, byTown: 'Bělokamen' });
        // the town lookup asked for several settlements, and kept to the rate limit
        const townUrl = new URL(fetchFn.mock.calls[2][0] as string);
        expect(townUrl.searchParams.get('limit')).toBe(String(CANDIDATE_LIMIT));
        expect(waitFn).toHaveBeenCalledTimes(fetchFn.mock.calls.length - 1);
    });

    it('takes the first settlement without places to compare, and none that is no settlement', async () => {
        const fetchFn = geocoder({ 'Bělokamen': [road, village('41.0', 'first'), village('49.1', 'second')], 'Lhotín': [road] });
        const waitFn = vi.fn().mockResolvedValue(undefined);
        const found = await geocodePlaces(['Bělokamen čp. 4', 'Lhotín čp. 2'], { fetchFn, waitFn, townFallback: {} });
        expect(found.get('Bělokamen čp. 4')).toMatchObject({ label: 'first', byTown: 'Bělokamen', townChoices: 2 });
        expect(found.get('Lhotín čp. 2')).toBeNull();
    });

    it('never looks up a town for a numbered town ("Praha 5"), a place without a house, or without the option', async () => {
        const fetchFn = geocoder({ 'Praha': [village('50.0', 'Praha')], 'Bělokamen': [village('49.0', 'Bělokamen')] });
        const waitFn = vi.fn().mockResolvedValue(undefined);
        await geocodePlaces(['Praha 5', 'Lhotín'], { fetchFn, waitFn, townFallback: {} });
        expect(queries(fetchFn)).toEqual(['Praha 5', 'Lhotín']);
        fetchFn.mockClear();
        const found = await geocodePlaces(['Bělokamen čp. 4'], { fetchFn, waitFn });
        expect(queries(fetchFn)).toEqual(['Bělokamen čp. 4']);
        expect(found.get('Bělokamen čp. 4')).toBeNull();
    });
});

describe('settlements in a manual search', () => {
    it('tells a settlement from an exact address', async () => {
        expect(isSettlementHit({ category: 'place', type: 'village' })).toBe(true);
        expect(isSettlementHit({ category: 'boundary', type: 'administrative', addresstype: 'municipality' })).toBe(true);
        expect(isSettlementHit({ category: 'building', type: 'house', addresstype: 'building' })).toBe(false);
        expect(isSettlementHit({ category: 'highway', type: 'residential', addresstype: 'road' })).toBe(false);
        const fetchFn = vi.fn().mockResolvedValue(okResponse([
            { lat: '49', lon: '15', display_name: 'Bělokamen', category: 'place', type: 'village', addresstype: 'village' },
            { lat: '49', lon: '15', display_name: 'Kopřivná 12', category: 'building', type: 'house', addresstype: 'building' },
        ]));
        expect(await searchPlaceCandidates('Bělokamen', { fetchFn })).toEqual([
            { geo: { lat: 49, lon: 15, label: 'Bělokamen' }, settlement: true, kind: 'village' },
            { geo: { lat: 49, lon: 15, label: 'Kopřivná 12' }, settlement: false, kind: 'building' },
        ]);
    });
});
