/**
 * Geocoding (src/geocode.ts). No real network: fetch and the rate-limit wait are
 * injected, so these tests pin down the promises made in the module header —
 * place names only, one request per second, a failure is never a guess.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    buildGeocodeUrl, geocodeCandidates, geocodePlace, geocodePlaces,
    parseGeocodeCandidates, parseGeocodeResponse, placesCentroid, isSettlementHit, searchPlaceCandidates, hitKind, hitLabelParts,
    CANDIDATE_LIMIT, GEOCODER_URL, GEOCODER_CONTACT, REQUEST_INTERVAL_MS, parseHitAddress, searchPlaceForms,
    pickPlaceHit, sameNamedTowns, treeCenter,
} from '../geocode.js';
import { placeGeoHash } from '../place-records.js';
import type { PlaceGeo } from '../types.js';

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

describe('geocodePlaces — towns of the same name: the one nearest the tree\'s other places (A6.5.1)', () => {
    const village = (lat: number, lon: number, name: string, region: string) =>
        ({ lat: String(lat), lon: String(lon), name, display_name: `${name}, ${region}`, category: 'boundary', type: 'administrative', addresstype: 'village' });
    // Three Lhotas: the geocoder ranks the one in western Bohemia first.
    const lhotas = [village(49.7, 13.3, 'Lhota', 'Plzeň'), village(49.3, 16.6, 'Lhota', 'Brno'), village(50.1, 15.1, 'Lhota', 'Kolín')];
    const geocoder = (answers: Record<string, unknown[]>) => vi.fn().mockImplementation(async (url: string) =>
        okResponse(answers[new URL(url).searchParams.get('q')!] ?? []));
    // The family's other places lie around Brno.
    const moravia: Record<string, PlaceGeo> = {
        brno: { lat: 49.19, lon: 16.61, origin: 'map' },
        tisnov: { lat: 49.35, lon: 16.42, origin: 'map' },
        boskovice: { lat: 49.49, lon: 16.66 },
    };

    it('takes the Lhota nearest the tree\'s places, says how many there were, in one request per place', async () => {
        const fetchFn = geocoder({ Lhota: lhotas, Brno: [village(49.19, 16.61, 'Brno', 'Morava')] });
        const waitFn = vi.fn().mockResolvedValue(undefined);
        const found = await geocodePlaces(['Lhota', 'Brno'], { fetchFn, waitFn, treePlaces: moravia });
        expect(found.get('Lhota')).toEqual({ lat: 49.3, lon: 16.6, label: 'Lhota, Brno', townChoices: 3 });
        expect(found.get('Brno')).toEqual({ lat: 49.19, lon: 16.61, label: 'Brno, Morava' });
        // The same one request per place, only with more hits; the rate limit between them.
        expect(fetchFn).toHaveBeenCalledTimes(2);
        for (const [url] of fetchFn.mock.calls) {
            const u = new URL(url as string);
            expect(u.searchParams.get('limit')).toBe(String(CANDIDATE_LIMIT));
            expect(u.searchParams.get('email')).toBe(GEOCODER_CONTACT);
        }
        expect(waitFn).toHaveBeenCalledTimes(1);
        expect(waitFn).toHaveBeenCalledWith(REQUEST_INTERVAL_MS);
    });

    it('a tree with no located place yet: the places the run found without a doubt decide, even found after the Lhota', async () => {
        const fetchFn = geocoder({ Lhota: lhotas, Kolín: [village(50.03, 15.2, 'Kolín', 'Střední Čechy')] });
        const found = await geocodePlaces(['Lhota', 'Kolín'], { fetchFn, waitFn: async () => {}, treePlaces: {} });
        expect(found.get('Lhota')).toMatchObject({ lat: 50.1, lon: 15.1, townChoices: 3 });
    });

    it('nothing to compare with: the first hit, as before', async () => {
        const fetchFn = geocoder({ Lhota: lhotas });
        const found = await geocodePlaces(['Lhota'], { fetchFn, waitFn: async () => {}, treePlaces: {} });
        expect(found.get('Lhota')).toEqual({ lat: 49.7, lon: 13.3, label: 'Lhota, Plzeň' });
        expect(pickPlaceHit(lhotas, 'Lhota', null)).toEqual({ lat: 49.7, lon: 13.3, label: 'Lhota, Plzeň' });
    });

    it('hits not named as the place, or a single town of the name: the first hit, as before', async () => {
        const center = { lat: 49.3, lon: 16.6 };
        // "Lhota u Kolína" is more than the name: the geocoder's first answer stands.
        expect(pickPlaceHit(lhotas, 'Lhota u Kolína', center)).toMatchObject({ lat: 49.7 });
        expect(sameNamedTowns(lhotas, 'Lhota u Kolína')).toEqual([]);
        // A street and a house of the name are no towns.
        const street = { lat: '49.3', lon: '16.6', name: 'Lhota', display_name: 'Lhota, Brno', category: 'highway', type: 'residential', addresstype: 'road' };
        expect(pickPlaceHit([lhotas[0], street], 'Lhota', center)).toEqual({ lat: 49.7, lon: 13.3, label: 'Lhota, Plzeň' });
        // The name compares without case and accents.
        expect(sameNamedTowns([village(1, 1, 'Lhota', 'x'), village(2, 2, 'LHOTA', 'y')], 'lhota')).toHaveLength(2);
        // Without the tree's places the run does as before.
        const fetchFn = geocoder({ Lhota: lhotas });
        expect((await geocodePlaces(['Lhota'], { fetchFn, waitFn: async () => {} })).get('Lhota')).toMatchObject({ lat: 49.7 });
    });

    it('the centre: the locations a person decided on when there are three, else all with the run\'s finds; a median', () => {
        const hand = (lat: number, lon: number): PlaceGeo => ({ lat, lon, origin: 'hand' });
        const kept = (lat: number, lon: number): PlaceGeo => ({ lat, lon, keptAt: placeGeoHash({ lat, lon }) });
        const bohemia: Record<string, PlaceGeo> = { a: { lat: 50, lon: 13 }, b: { lat: 50, lon: 13.2 }, c: { lat: 50.1, lon: 13.1 }, d: { lat: 50.2, lon: 13 } };
        // Three decided by a person outweigh four from the geocoder.
        expect(treeCenter({ ...bohemia, h1: hand(49.2, 16.6), h2: hand(49.3, 16.5), k: kept(49.4, 16.7) })).toEqual({ lat: 49.3, lon: 16.6 });
        // A "Keep" of a location that moved since no longer counts as a person's.
        const moved: PlaceGeo = { lat: 49.4, lon: 16.7, keptAt: placeGeoHash({ lat: 1, lon: 1 }) };
        expect(treeCenter({ ...bohemia, h1: hand(49.2, 16.6), h2: hand(49.3, 16.5), k: moved })!.lat).toBeGreaterThan(49.9);
        // A branch overseas does not drag the centre across the ocean.
        const center = treeCenter({ ...bohemia, chicago: { lat: 41.9, lon: -87.6 } })!;
        expect(center.lon).toBeGreaterThan(12.9);
        expect(treeCenter({}, [{ lat: 1, lon: 2 }])).toEqual({ lat: 1, lon: 2 });
        expect(treeCenter(undefined)).toBeNull();
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

describe('a search option in the Places dialog: its kind and its name', () => {
    it('reads the kind from the address type; a settlement is a town, a part of one stays a part', () => {
        expect(hitKind({ settlement: true, kind: 'village' })).toBe('settlement');
        expect(hitKind({ settlement: true, kind: 'suburb' })).toBe('suburb');
        expect(hitKind({ settlement: false, kind: 'road' })).toBe('road');
        expect(hitKind({ settlement: false, kind: 'house' })).toBe('house');
        expect(hitKind({ settlement: false, kind: 'county' })).toBe('region');
        expect(hitKind({ settlement: false })).toBe('other');
    });

    it('splits the label into the name and the rest', () => {
        expect(hitLabelParts('Bělokamen, okres Horní, Česko')).toEqual({ name: 'Bělokamen', region: 'okres Horní, Česko' });
        expect(hitLabelParts('Lhota')).toEqual({ name: 'Lhota', region: '' });
        expect(hitLabelParts(undefined)).toEqual({ name: '', region: '' });
    });
});

describe('parseHitAddress and searchPlaceForms', () => {
    it('reads a hit’s name, district and country from its address parts', () => {
        expect(parseHitAddress({ name: 'Lhotov', addresstype: 'village', address: { village: 'Lhotov', county: 'Okres Testov', state: 'Kraj Testov', country: 'Česko' } }))
            .toEqual({ name: 'Lhotov', district: 'Okres Testov', country: 'Česko' });
        expect(parseHitAddress({ addresstype: 'town', address: { town: 'Jinov', state: 'Kraj Testov' } }))
            .toEqual({ name: 'Jinov', district: 'Kraj Testov' });
        expect(parseHitAddress({ lat: '1', lon: '2' })).toBeUndefined();
        expect(new URL(buildGeocodeUrl('Lhotov', 5, true)).searchParams.get('addressdetails')).toBe('1');
        expect(new URL(buildGeocodeUrl('Lhotov', 5)).searchParams.has('addressdetails')).toBe(false);
    });

    it('asks every form in turn and keeps a spot found twice once', async () => {
        const asked: string[] = [];
        const waits: number[] = [];
        const hit = (lat: string) => ({ lat, lon: '15', display_name: 'x', category: 'place', type: 'village', addresstype: 'village' });
        const fetchFn = (async (url: string) => {
            const q = new URL(url).searchParams.get('q')!;
            asked.push(q);
            const body = q === 'Lhotov' ? [hit('50')] : [hit('50'), hit('49')];
            return { ok: true, json: async () => body } as Response;
        }) as unknown as typeof fetch;
        const found = await searchPlaceForms(['Lhotov', 'Lhotow'], { fetchFn, waitFn: async ms => { waits.push(ms); } });
        expect(asked).toEqual(['Lhotov', 'Lhotow']);
        expect(waits).toHaveLength(1);
        expect(found.map(f => [f.candidate.geo.lat, f.form])).toEqual([[50, 'Lhotov'], [49, 'Lhotow']]);
    });
});
