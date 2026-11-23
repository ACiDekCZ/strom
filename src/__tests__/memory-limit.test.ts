/**
 * The memory limit's estimate (spec 135, D9b): the thresholds measured in
 * D9a (docs: limit 2 GB → a tree warns past ~80 MB of JSON without images,
 * an output past ~190–210 MB of images, an import past ~400 MB of file).
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
    MB, DEFAULT_LIMIT, TOUCH_LIMIT,
    heapLimit, steadyHeap, nearLimitSteady, nearLimitOutput, nearLimitImport, outputPeak, importPeak,
    treeImageChars, jsonBytesWithoutImages,
} from '../memory-limit.js';
import { estimateJsonBytes } from '../clone.js';
import { setImageMeta, clearImageMeta } from '../image-meta.js';
import { POOL_REF } from '../image-ref.js';
import type { StromData } from '../types.js';

const L2 = 2048 * MB;
const L1 = 1024 * MB;

describe('memory limit: the limit L', () => {
    it('takes the browser\'s jsHeapSizeLimit where it has one', () => {
        expect(heapLimit({ jsHeapSizeLimit: 3760 * MB })).toBe(3760 * MB);
        expect(heapLimit({ jsHeapSizeLimit: 3760 * MB, coarse: true })).toBe(3760 * MB);
    });
    it('is 2 GB without one, 1 GB on a touch device', () => {
        expect(heapLimit({})).toBe(DEFAULT_LIMIT);
        expect(DEFAULT_LIMIT).toBe(L2);
        expect(heapLimit({ jsHeapSizeLimit: null, coarse: true })).toBe(TOUCH_LIMIT);
        expect(TOUCH_LIMIT).toBe(L1);
    });
    it('ignores a figure that is no limit', () => {
        expect(heapLimit({ jsHeapSizeLimit: 0 })).toBe(L2);
        expect(heapLimit({ jsHeapSizeLimit: Number.NaN, coarse: true })).toBe(L1);
    });
});

describe('memory limit: the steady heap and its notice', () => {
    it('H = 24 MB + 6 × JSON + 25 MB per other window', () => {
        expect(steadyHeap(0)).toBe(24 * MB);
        expect(steadyHeap(10 * MB)).toBe(84 * MB);
        expect(steadyHeap(10 * MB, 2)).toBe(134 * MB);
        expect(steadyHeap(-5, -1)).toBe(24 * MB);
    });
    it('L = 2 GB: near past ~81 MB of JSON (H > 512 MB, 2H > L/2)', () => {
        expect(nearLimitSteady(512 * MB, L2)).toBe(false);
        expect(nearLimitSteady(512 * MB + 1, L2)).toBe(true);
        expect(nearLimitSteady(steadyHeap(81 * MB), L2)).toBe(false);
        expect(nearLimitSteady(steadyHeap(82 * MB), L2)).toBe(true);
    });
    it('L = 1 GB: near past ~39 MB of JSON', () => {
        expect(nearLimitSteady(steadyHeap(38 * MB), L1)).toBe(false);
        expect(nearLimitSteady(steadyHeap(39 * MB), L1)).toBe(true);
    });
    it('the other windows count', () => {
        // 70 MB of JSON: 444 MB alone, past 512 MB with three more windows.
        expect(nearLimitSteady(steadyHeap(70 * MB, 2), L2)).toBe(false);
        expect(nearLimitSteady(steadyHeap(70 * MB, 3), L2)).toBe(true);
    });
    it('the browser\'s own figure over 60 % of L says it too', () => {
        expect(nearLimitSteady(30 * MB, L2, 0.6 * L2)).toBe(false);
        expect(nearLimitSteady(30 * MB, L2, 0.6 * L2 + 1)).toBe(true);
        expect(nearLimitSteady(30 * MB, L2, null)).toBe(false);
    });
});

describe('memory limit: an output with the images', () => {
    const h = steadyHeap(1 * MB); // a small tree: 30 MB
    it('S_out = 6.5 × images + 3 × H', () => {
        expect(outputPeak(100 * MB, h)).toBe(650 * MB + 90 * MB);
    });
    it('L = 2 GB: past ~207 MB of images', () => {
        expect(nearLimitOutput(200 * MB, h, L2)).toBe(false);
        expect(nearLimitOutput(210 * MB, h, L2)).toBe(true);
    });
    it('L = 3.7 GB (Chrome on a desktop): past ~390 MB of images', () => {
        expect(nearLimitOutput(380 * MB, h, 3760 * MB)).toBe(false);
        expect(nearLimitOutput(395 * MB, h, 3760 * MB)).toBe(true);
    });
    it('no images, a small tree: never', () => {
        expect(nearLimitOutput(0, h, L2)).toBe(false);
    });
});

describe('memory limit: an import', () => {
    const h = steadyHeap(0);
    it('S_in = 3.5 × file + H', () => {
        expect(importPeak(100 * MB, h)).toBe(350 * MB + 24 * MB);
    });
    it('L = 2 GB: past ~400 MB of file', () => {
        expect(nearLimitImport(400 * MB, h, L2)).toBe(false);
        expect(nearLimitImport(405 * MB, h, L2)).toBe(true);
    });
    it('L = 1 GB: past ~198 MB of file', () => {
        expect(nearLimitImport(195 * MB, h, L1)).toBe(false);
        expect(nearLimitImport(200 * MB, h, L1)).toBe(true);
    });
});

describe('memory limit: the tree\'s sizes', () => {
    const idA = 'p:' + 'a'.repeat(40);
    const idB = 'p:' + 'b'.repeat(40);
    const photo = 'data:image/jpeg;base64,' + 'A'.repeat(2000);
    const tree = (): StromData => ({
        persons: {
            p1: { id: 'p1', firstName: 'Ada', lastName: 'Brook', photo: POOL_REF + idA },
            p2: { id: 'p2', firstName: 'Ben', lastName: 'Brook', photo },
        },
        partnerships: { u1: { id: 'u1', partner1Id: 'p1', partner2Id: 'p2', childIds: [], photo: POOL_REF + idB } },
        media: { m1: { id: 'm1', dataUrl: 'data:application/pdf;base64,' + 'B'.repeat(3000) } },
        sources: { s1: { id: 's1', title: 'Register', excerpts: [{ id: 'e1', dataUrl: 'data:image/png;base64,' + 'C'.repeat(500) }] } },
    } as unknown as StromData);

    afterEach(() => clearImageMeta());

    it('counts the images as data URL characters, pooled ones from the catalog', () => {
        setImageMeta(idA, { len: 10_000, head: 'data:image/jpeg;base64,', bytes: 7000, token: 't', mtok: 'm' } as never);
        setImageMeta(idB, { len: 20_000, head: 'data:image/jpeg;base64,', bytes: 14000, token: 't', mtok: 'm' } as never);
        const d = tree();
        const pdf = (d.media as Record<string, { dataUrl: string }>).m1.dataUrl.length;
        const excerpt = 'data:image/png;base64,'.length + 500;
        expect(treeImageChars(d)).toBe(10_000 + photo.length + 20_000 + pdf + excerpt);
        // Content: no photos; no attachments (the excerpts go with them); sources' own choice.
        expect(treeImageChars(d, { photos: false, attachments: true, sources: true })).toBe(pdf + excerpt);
        expect(treeImageChars(d, { photos: true, attachments: false, sources: true })).toBe(10_000 + photo.length + 20_000);
        expect(treeImageChars(d, { photos: false, attachments: false, sources: true, sourceImages: 'app' })).toBe(excerpt);
        expect(treeImageChars(d, { photos: false, attachments: true, sources: true, sourceImages: 'none' })).toBe(pdf);
        expect(treeImageChars(d, { photos: false, attachments: true, sources: false })).toBe(pdf);
    });

    it('a pooled image the catalog does not know counts 0', () => {
        const d = tree();
        expect(treeImageChars(d, { photos: true, attachments: false, sources: false })).toBe(photo.length);
    });

    it('the JSON without images leaves out the data URLs, keeps the references', () => {
        const d = tree();
        const bare = tree();
        (bare.persons as Record<string, { photo?: string }>).p2.photo = '';
        (bare.media as Record<string, { dataUrl: string }>).m1.dataUrl = '';
        ((bare.sources as Record<string, { excerpts: { dataUrl: string }[] }>).s1.excerpts[0]).dataUrl = '';
        expect(jsonBytesWithoutImages(d)).toBe(estimateJsonBytes(bare));
        expect(jsonBytesWithoutImages(d)).toBeLessThan(1000);
    });
});
