/**
 * A satellite reads the tree's pooled images through the main window's pool
 * (spec 135): found through the opener (also through a satellite that opened
 * this one), read anew at every call (the main window's reload publishes its
 * own), nothing from a closed or foreign window; what the satellites hold
 * goes into the main window's pool cleanup.
 */
import { describe, it, expect } from 'vitest';
import { findPoolSource, holdSatelliteImages, publishPoolSource, satelliteImageIds, POOL_SOURCE_KEY, type PoolSource } from '../window-images.js';

const blobOf = (n: number) => new Blob([new Uint8Array(n)], { type: 'image/png' });

function pool(n: number): PoolSource {
    return { blobs: async ids => new Map(ids.map(id => [id, blobOf(n)])) };
}

describe('findPoolSource', () => {
    it('finds the main window through the opener, also through a satellite that opened this one', async () => {
        const main = { closed: false, opener: null } as Record<string, unknown>;
        publishPoolSource(pool(3), main);
        const satellite = { closed: false, opener: main };
        expect((await findPoolSource({ opener: main })!.blobs(['p:1'])).get('p:1')?.size).toBe(3);
        expect((await findPoolSource({ opener: satellite })!.blobs(['p:1'])).get('p:1')?.size).toBe(3);
        expect(findPoolSource({ opener: null })).toBeNull();
        expect(findPoolSource({ opener: { closed: false, opener: null } })).toBeNull();
    });

    it('reads the main window\'s pool at every call (its reload publishes a new one); nothing from a closed one', async () => {
        const main = { closed: false, opener: null } as Record<string, unknown>;
        main[POOL_SOURCE_KEY] = pool(1);
        const source = findPoolSource({ opener: main })!;
        expect((await source.blobs(['p:1'])).get('p:1')?.size).toBe(1);
        main[POOL_SOURCE_KEY] = pool(2);
        expect((await source.blobs(['p:1'])).get('p:1')?.size).toBe(2);
        main.closed = true;
        expect((await source.blobs(['p:1'])).get('p:1')).toBeNull();
    });

    it('a window it may not read (another origin) is no source', () => {
        const foreign = new Proxy({}, { get: () => { throw new Error('SecurityError'); } });
        expect(findPoolSource({ opener: foreign })).toBeNull();
    });
});

describe('what the satellites hold', () => {
    it('is asked at every cleanup; a satellite that let go or cannot be asked is forgotten', () => {
        let held = ['p:a'];
        holdSatelliteImages('w1', () => held);
        holdSatelliteImages('w2', () => { throw new Error('closed'); });
        expect(satelliteImageIds()).toEqual(['p:a']);
        held = ['p:b'];
        expect(satelliteImageIds()).toEqual(['p:b']);
        holdSatelliteImages('w1', null);
        expect(satelliteImageIds()).toEqual([]);
    });
});
