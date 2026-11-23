/**
 * The person page in the app is built from a tree whose pooled images the
 * page can show are whole (spec 135): only the person's own (portrait,
 * couples' photos, files, excerpts of the sources cited), read from the pool
 * once; every other image stays a reference and every other record is the
 * tree's own (not copied). All data is invented.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const pool = new Map<string, string>();
const asked: string[][] = [];
vi.mock('../media-pool.js', () => ({
    loadImageUrls: async (ids: readonly string[]) => {
        asked.push([...ids].sort());
        return new Map(ids.filter(id => pool.has(id)).map(id => [id, pool.get(id)!]));
    },
}));

import { pageImagesToRead, readPageImages, treeWithPageImages, pageImageValue, forgetPageImages } from '../ui/person-page-images.js';
import { POOL_REF } from '../image-ref.js';
import type { StromData, PersonId } from '../types.js';

const P0 = 'p0' as PersonId;

function id(n: number): string {
    return 'p:' + n.toString(16).padStart(2, '0').repeat(20);
}
function ref(n: number): string {
    return POOL_REF + id(n);
}
function url(n: number): string {
    return `data:image/png;base64,${'QUJD'.repeat(10 + n)}`;
}

function tree(): StromData {
    return {
        version: 1,
        persons: {
            p0: { id: 'p0', firstName: 'Zbyňka', lastName: 'Pertlová', gender: 'female', partnerships: ['u0'], parentIds: [], childIds: [],
                photo: ref(1), sourceIds: ['s0'] },
            p1: { id: 'p1', firstName: 'Hroznata', lastName: 'Pertl', gender: 'male', partnerships: ['u0'], parentIds: [], childIds: [],
                photo: ref(2) },
            p2: { id: 'p2', firstName: 'Ctibor', lastName: 'Okurka', gender: 'male', partnerships: [], parentIds: [], childIds: [], photo: ref(8) },
        },
        partnerships: {
            u0: { id: 'u0', person1Id: 'p1', person2Id: 'p0', childIds: [], photo: ref(3) },
        },
        media: {
            m0: { id: 'm0', name: 'scan.png', mimeType: 'image/png', dataUrl: ref(4), sizeBytes: 1, places: [{ personId: 'p0' }] },
            m1: { id: 'm1', name: 'other.png', mimeType: 'image/png', dataUrl: ref(5), sizeBytes: 1, places: [{ personId: 'p2' }] },
        },
        sources: {
            s0: { id: 's0', title: 'Matrika', excerpts: [{ id: 'e0', dataUrl: ref(6), width: 1, height: 1, sizeBytes: 1 }] },
            s1: { id: 's1', title: 'Jiná', excerpts: [{ id: 'e1', dataUrl: ref(7), width: 1, height: 1, sizeBytes: 1 }] },
        },
    } as unknown as StromData;
}

beforeEach(() => {
    forgetPageImages();
    pool.clear();
    asked.length = 0;
    for (let n = 1; n <= 8; n++) pool.set(id(n), url(n));
});

describe('the person page\'s images', () => {
    it('reads only the person\'s own images, once', async () => {
        const d = tree();
        const want = pageImagesToRead(d, P0);
        expect(want.sort()).toEqual([id(1), id(3), id(4), id(6)].sort());
        await readPageImages(want);
        await readPageImages(want);
        expect(asked).toEqual([[id(1), id(3), id(4), id(6)].sort()]);
        expect(pageImagesToRead(d, P0)).toEqual([]);
    });

    it('builds from a tree with those images whole; everything else is the tree\'s own', async () => {
        const d = tree();
        expect(treeWithPageImages(d, P0)).toBe(d);
        await readPageImages(pageImagesToRead(d, P0));
        const t = treeWithPageImages(d, P0);
        expect(t.persons[P0].photo).toBe(url(1));
        expect(t.partnerships['u0' as never].photo).toBe(url(3));
        expect(t.media!.m0.dataUrl).toBe(url(4));
        expect(t.sources!.s0.excerpts![0].dataUrl).toBe(url(6));
        // Not the page's: still references, the same records.
        expect(t.persons['p1' as PersonId]).toBe(d.persons['p1' as PersonId]);
        expect(t.media!.m1).toBe(d.media!.m1);
        expect(t.sources!.s1).toBe(d.sources!.s1);
        // The tree itself is untouched.
        expect(d.persons[P0].photo).toBe(ref(1));
        expect(pageImageValue(ref(1))).toBe(url(1));
        expect(pageImageValue(ref(2))).toBe(ref(2));
    });

    it('another person\'s page lets the former images go; one the pool lacks stays a reference', async () => {
        const d = tree();
        await readPageImages(pageImagesToRead(d, P0));
        pool.delete(id(8));
        const want = pageImagesToRead(d, 'p2' as PersonId);
        expect(want.sort()).toEqual([id(5), id(8)].sort());
        await readPageImages(want);
        expect(pageImageValue(ref(1))).toBe(ref(1));
        const t = treeWithPageImages(d, 'p2' as PersonId);
        expect(t.persons['p2' as PersonId].photo).toBe(ref(8));
        expect(t.media!.m1.dataUrl).toBe(url(5));
        // Not asked again.
        expect(pageImagesToRead(d, 'p2' as PersonId)).toEqual([]);
    });
});
