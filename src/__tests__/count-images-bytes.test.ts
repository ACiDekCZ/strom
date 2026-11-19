/**
 * The size of the images a tree brings (the "Include photos and attachments"
 * line of loading a research's version, of a JSON import): each picture once,
 * by the data it carries — the same scan as an attachment and as excerpts of
 * several sources, or one photo of several people, is one picture; the
 * `sizeBytes` of a record (an original's size) is not what travels.
 * Invented data only.
 */

import { describe, it, expect } from 'vitest';
import { countImages } from '../attachments.js';
import { dataUrlByteSize } from '../photo.js';
import { StromData } from '../types.js';

/** A JPEG-typed data URL of `n` bytes of payload, distinct by `seed`. */
function image(n: number, seed: number): string {
    const bytes = Array.from({ length: n }, (_, i) => (i * 7 + seed) & 255);
    return 'data:image/jpeg;base64,' + btoa(String.fromCharCode(...bytes));
}

const SCAN = image(3000, 1);
const PHOTO = image(1200, 2);
const UNION = image(900, 3);

function tree(): StromData {
    const person = (id: string, photo?: string) => ({
        id, firstName: id, lastName: 'Kovář', gender: 'male', isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [], ...(photo ? { photo } : {}),
    });
    return {
        version: 1,
        persons: {
            p1: person('p1', PHOTO),
            p2: person('p2', PHOTO),
            p3: person('p3'),
        },
        partnerships: {
            u1: { id: 'u1', person1Id: 'p1', person2Id: 'p3', childIds: [], status: 'married', photo: UNION },
        },
        media: {
            // The scan at two people, its record claiming the original's size.
            a1: { id: 'a1', name: 'scan.jpg', mimeType: 'image/jpeg', dataUrl: SCAN, sizeBytes: 40_000_000,
                places: [{ personId: 'p1' }, { personId: 'p3' }] },
            // Only the original, kept by the research (no data in the tree).
            a2: { id: 'a2', name: 'page.tif', mimeType: 'image/tiff', dataUrl: '', sizeBytes: 0, originalOnly: true,
                places: [{ personId: 'p2' }] },
        },
        sources: {
            s1: { id: 's1', title: 'Register 1', excerpts: [
                { id: 'e1', dataUrl: SCAN, width: 10, height: 10, sizeBytes: 40_000_000 },
            ] },
            s2: { id: 's2', title: 'Register 2', excerpts: [
                { id: 'e2', dataUrl: SCAN, width: 10, height: 10, sizeBytes: 40_000_000 },
            ] },
        },
    } as unknown as StromData;
}

describe('countImages bytes', () => {
    it('weighs each picture once, by its data URL, never by sizeBytes', () => {
        const count = countImages(tree());
        expect(count.bytes).toBe(dataUrlByteSize(SCAN) + dataUrlByteSize(PHOTO) + dataUrlByteSize(UNION));
        expect(count.bytes).toBe(3000 + 1200 + 900);
    });

    it('keeps counting every place a picture is at', () => {
        expect(countImages(tree())).toMatchObject({ photos: 3, attachments: 2, excerpts: 2 });
    });
});
