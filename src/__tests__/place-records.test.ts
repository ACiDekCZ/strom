/**
 * Research place records (spec 034): sanitizing untrusted input, keeping the
 * app's own fields of a location over a research version, the fingerprint
 * without them. Fictional places only.
 */

import { describe, it, expect } from 'vitest';
import {
    sanitizePlaceRecords, sanitizePlaceRefs, keepPlaceOrigins, placeGeoHash, sameCoords, placesWithoutMeta,
    placeRecordsFor, cleanPlaceGeoMeta,
} from '../place-records.js';
import { carryOverMedia, contentFingerprint } from '../research-link.js';
import { migrateData } from '../data.js';
import { StromData } from '../types.js';

function tree(places: StromData['places'], extra: Partial<StromData> = {}): StromData {
    return { persons: {}, partnerships: {}, places, ...extra };
}

describe('sanitizePlaceRecords / sanitizePlaceRefs', () => {
    it('keeps valid records under their own id only', () => {
        const out = sanitizePlaceRecords({
            L1: { id: 'L1', names: [{ name: 'Lhota' }] },
            L2: { id: 'L3', names: [{ name: 'Jinov' }] },
            X1: { id: 'X1', names: [{ name: 'Lhotov' }] },
            L4: { id: 'L4', names: [] },
            L5: 'Lhota',
        });
        expect(out).toEqual({ L1: { id: 'L1', names: [{ name: 'Lhota' }] } });
    });

    it('drops bad values inside a record', () => {
        const out = sanitizePlaceRecords({
            L1: {
                id: 'L1', names: [{ name: 'Lhota', lang: 42, from: -3, to: 1945.5 }, { name: '' }, 7],
                coords: { lat: 'x', lon: 15 }, jurisdictions: [{ kind: 'empire', name: 'Lhotov' }, { kind: 'parish', name: 'Jinov', from: '1784' }],
                parent: 'L1', by: 'robot', at: 'today', why: 3, source: { title: 'Register', url: 'ftp://x' },
                verified: true, needs: 'x'.repeat(600),
            },
        });
        expect(out?.L1).toEqual({
            id: 'L1', names: [{ name: 'Lhota' }],
            jurisdictions: [{ kind: 'parish', name: 'Jinov', from: 1784 }],
            source: { title: 'Register' },
        });
    });

    it('keeps refs to records the tree has, with short keys', () => {
        const records = sanitizePlaceRecords({ L1: { id: 'L1', names: [{ name: 'Lhota' }] } })!;
        expect(sanitizePlaceRefs({ lhota: 'L1', jinov: 'L2', ['x'.repeat(400)]: 'L1', lhotov: 5 }, records)).toEqual({ lhota: 'L1' });
        expect(sanitizePlaceRefs('nonsense')).toBeUndefined();
    });

    it('migrateData drops refs without a record and invalid location fields', () => {
        const data = migrateData({
            persons: {}, partnerships: {},
            places: { lhota: { lat: 49.6, lon: 15.2, origin: 'robot', at: 'now', keptAt: 'abc' } },
            placeRecords: { L1: { id: 'L1', names: [{ name: 'Lhota' }] } },
            placeRefs: { lhota: 'L1', jinov: 'L9' },
        });
        expect(data.places?.lhota).toEqual({ lat: 49.6, lon: 15.2, keptAt: 'abc' });
        expect(data.placeRefs).toEqual({ lhota: 'L1' });
        expect(cleanPlaceGeoMeta({ origin: 'hand', at: '2026-11-02', keptAt: '<x>' })).toEqual({ origin: 'hand', at: '2026-11-02' });
    });
});

describe('placeGeoHash / sameCoords', () => {
    it('a location through a GEDCOM round trip keeps its hash', () => {
        expect(placeGeoHash({ lat: 49.612341, lon: 15.230012 })).toBe(placeGeoHash({ lat: 49.61234, lon: 15.23001 }));
        expect(placeGeoHash({ lat: 49.6123, lon: 15.23 })).not.toBe(placeGeoHash({ lat: 49.6153, lon: 15.23 }));
    });

    it('same coordinates within 0.0005°', () => {
        expect(sameCoords({ lat: 49.6, lon: 15.2 }, { lat: 49.6004, lon: 15.1996 })).toBe(true);
        expect(sameCoords({ lat: 49.6, lon: 15.2 }, { lat: 49.601, lon: 15.2 })).toBe(false);
        expect(sameCoords(undefined, { lat: 1, lon: 1 })).toBe(false);
    });
});

describe('a research version keeps the app’s own fields of a location', () => {
    const previous = tree({
        lhota: { lat: 49.61, lon: 15.23, label: 'Lhota', origin: 'hand', at: '2026-10-01', keptAt: 'k1' },
        jinov: { lat: 49.7, lon: 15.3, origin: 'map', at: '2026-10-02' },
        lhotov: { lat: 49.8, lon: 15.4, origin: 'hand' },
    }, { placeRecords: { L1: { id: 'L1', names: [{ name: 'Old Lhota' }] } }, placeRefs: { lhota: 'L1' } });

    // The research's GEDCOM brings the coordinates only; one place moved, one is new.
    const next = tree({
        lhota: { lat: 49.610001, lon: 15.229999, label: 'Lhota' },
        jinov: { lat: 49.9, lon: 15.3, label: 'Jinov' },
        lhotinek: { lat: 49.5, lon: 15.1, label: 'Lhotínek' },
    }, { placeRecords: { L2: { id: 'L2', names: [{ name: 'Jinov' }] } }, placeRefs: { jinov: 'L2' } });

    it('keepPlaceOrigins takes over origin/at/keptAt where the location did not move', () => {
        const out = keepPlaceOrigins(next, previous);
        expect(out.places?.lhota).toEqual({ lat: 49.610001, lon: 15.229999, label: 'Lhota', origin: 'hand', at: '2026-10-01', keptAt: 'k1' });
        expect(out.places?.jinov).toEqual({ lat: 49.9, lon: 15.3, label: 'Jinov' });
        expect(out.places?.lhotinek).toEqual({ lat: 49.5, lon: 15.1, label: 'Lhotínek' });
        expect(out.places?.lhotov).toBeUndefined();
        expect(next.places?.lhota?.origin).toBeUndefined();
    });

    it('carryOverMedia (every research load) does it, and takes the records whole from the new version', () => {
        const { data } = carryOverMedia(next, previous);
        expect(data.places?.lhota?.origin).toBe('hand');
        expect(data.places?.lhota?.keptAt).toBe('k1');
        expect(data.placeRecords).toEqual({ L2: { id: 'L2', names: [{ name: 'Jinov' }] } });
        expect(data.placeRefs).toEqual({ jinov: 'L2' });
    });

    it('nothing to take over returns the same object', () => {
        const plain = tree({ lhota: { lat: 1, lon: 1 } });
        expect(keepPlaceOrigins(plain, tree({ lhota: { lat: 1, lon: 1 } }))).toBe(plain);
    });
});

describe('the fingerprint leaves out the app’s own fields of a location', () => {
    it('a location marked by hand or kept is still in step with the research', () => {
        const bare = tree({ lhota: { lat: 49.61, lon: 15.23, label: 'Lhota' } });
        const marked = tree({ lhota: { lat: 49.61, lon: 15.23, label: 'Lhota', origin: 'hand', at: '2026-10-01', keptAt: 'k1' } });
        expect(contentFingerprint(marked)).toBe(contentFingerprint(bare));
        expect(placesWithoutMeta(bare.places)).toBe(bare.places);
        const moved = tree({ lhota: { lat: 49.62, lon: 15.23, label: 'Lhota' } });
        expect(contentFingerprint(moved)).not.toBe(contentFingerprint(bare));
    });
});

describe('placeRecordsFor', () => {
    it('picks the records of the given places with the records they lie in', () => {
        const data = tree({}, {
            placeRecords: {
                L1: { id: 'L1', names: [{ name: 'Horní Lhota' }], parent: 'L2' },
                L2: { id: 'L2', names: [{ name: 'Lhota' }] },
                L3: { id: 'L3', names: [{ name: 'Jinov' }] },
            },
            placeRefs: { 'horni lhota': 'L1', jinov: 'L3' },
        });
        expect(placeRecordsFor(data, ['horni lhota'])).toEqual({
            placeRecords: { L1: data.placeRecords!.L1, L2: data.placeRecords!.L2 },
            placeRefs: { 'horni lhota': 'L1' },
        });
        expect(placeRecordsFor(data, ['lhotov'])).toEqual({});
    });
});
