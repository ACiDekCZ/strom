/**
 * Originals for Strom Research (step C): the hash taken before shrinking, the
 * EXIF orientation and the crop's region on the stored file, the bridge
 * headers, who an original goes to, the queue budget, and `_STROM_SHA` /
 * `_STROM_REGION` through GEDCOM. Invented data only.
 */

import { describe, it, expect } from 'vitest';
import { createHash, randomBytes } from 'crypto';
import { createSha256, normalizeSha256, sha256OfBlob, SUBTLE_MAX_BYTES } from '../sha256.js';
import {
    exifOrientation, regionToStored, regionFromStored, regionHeader, parseRegion, uploadHeaders, originalTargets,
    originalsBudget, fitsBudget, mediaReplyId, researchSourceRef, ORIGINALS_MAX_BYTES, Region,
} from '../originals.js';
import { sanitizeAccepts } from '../research-link.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { StromData, PersonId } from '../types.js';

const hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

describe('SHA-256 of the original', () => {
    it('matches the standard vectors', () => {
        const h = (text: string): string => { const s = createSha256(); s.update(new TextEncoder().encode(text)); return s.digestHex(); };
        expect(h('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
        expect(h('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
        expect(h('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))
            .toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    });

    it('gives the same hash however the file is cut into pieces', () => {
        const data = new Uint8Array(randomBytes(200_003));
        for (const piece of [1, 63, 64, 65, 4096, 77_777]) {
            const s = createSha256();
            for (let o = 0; o < data.length; o += piece) s.update(data.subarray(o, o + piece));
            expect(s.digestHex()).toBe(hex(data));
        }
    });

    it('hashes a Blob (WebCrypto below the limit) and normalizes stored hashes', async () => {
        const data = new Uint8Array(randomBytes(10_000));
        expect(await sha256OfBlob(new Blob([data]))).toBe(hex(data));
        expect(SUBTLE_MAX_BYTES).toBe(64 * 1024 * 1024);
        expect(normalizeSha256(' ' + hex(data).toUpperCase())).toBe(hex(data));
        expect(normalizeSha256('abc')).toBeNull();
        expect(normalizeSha256(42)).toBeNull();
    });

    it('the worker source is self-contained (its text alone builds a working hash)', () => {
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const rebuilt = new Function(`return (${createSha256.toString()})`)() as typeof createSha256;
        const s = rebuilt();
        s.update(new TextEncoder().encode('abc'));
        expect(s.digestHex()).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });
});

/** A JPEG head with an EXIF block (TIFF in `order`) whose Orientation is `o`. */
function jpegWithOrientation(o: number, order: 'II' | 'MM'): Uint8Array {
    const le = order === 'II';
    const tiff: number[] = [...(le ? [0x49, 0x49, 42, 0] : [0x4d, 0x4d, 0, 42])];
    const u32 = (v: number) => le ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24] : [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255];
    const u16 = (v: number) => le ? [v & 255, v >> 8] : [v >> 8, v & 255];
    tiff.push(...u32(8));                       // IFD at offset 8
    tiff.push(...u16(2));                       // two entries
    tiff.push(...u16(0x010f), ...u16(2), ...u32(4), 0x41, 0x42, 0x43, 0);   // Make "ABC"
    tiff.push(...u16(0x0112), ...u16(3), ...u32(1), ...u16(o), 0, 0);      // Orientation
    tiff.push(...u32(0));
    const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    const len = exif.length + 2;
    return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xe1, len >> 8, len & 255, ...exif, 0xff, 0xda, 0, 2]);
}

describe('EXIF orientation and the crop region on the stored file', () => {
    it('reads the orientation of a JPEG (both byte orders) and of a TIFF', () => {
        for (const o of [1, 3, 6, 8]) {
            expect(exifOrientation(jpegWithOrientation(o, 'II'))).toBe(o);
            expect(exifOrientation(jpegWithOrientation(o, 'MM'))).toBe(o);
        }
        const jpeg = jpegWithOrientation(6, 'MM');
        const tiffStart = jpeg.indexOf(0x4d);
        expect(exifOrientation(jpeg.slice(tiffStart))).toBe(6);
    });

    it('is 1 for a PNG, a JPEG without EXIF or junk', () => {
        expect(exifOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]))).toBe(1);
        expect(exifOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBe(1);
        expect(exifOrientation(new Uint8Array([1, 2, 3]))).toBe(1);
    });

    it('maps a region drawn on the upright image onto the stored pixels (phone photo turned 90°)', () => {
        // Orientation 6: stored landscape, shown turned 90° clockwise. The top
        // band of the shown (portrait) image is the left band of the stored one.
        const shownTop: Region = { x: 0, y: 0, w: 1, h: 0.25 };
        const stored = regionToStored(shownTop, 6);
        expect(stored.x).toBeCloseTo(0); expect(stored.y).toBeCloseTo(0);
        expect(stored.w).toBeCloseTo(0.25); expect(stored.h).toBeCloseTo(1);
        // Orientation 8: the top band shown is the right band stored.
        const s8 = regionToStored(shownTop, 8);
        expect(s8.x).toBeCloseTo(0.75); expect(s8.w).toBeCloseTo(0.25); expect(s8.h).toBeCloseTo(1);
        // 3: turned 180°.
        const s3 = regionToStored({ x: 0.1, y: 0.2, w: 0.3, h: 0.1 }, 3);
        expect(s3.x).toBeCloseTo(0.6); expect(s3.y).toBeCloseTo(0.7);
        // 1 / missing: as it is.
        const s1 = regionToStored({ x: 0.1, y: 0.2, w: 0.3, h: 0.1 }, undefined);
        expect(s1.x).toBeCloseTo(0.1); expect(s1.y).toBeCloseTo(0.2); expect(s1.w).toBeCloseTo(0.3); expect(s1.h).toBeCloseTo(0.1);
    });

    it('comes back the same through stored and back for every orientation', () => {
        const r: Region = { x: 0.12, y: 0.34, w: 0.4, h: 0.2 };
        for (let o = 1; o <= 8; o++) {
            const back = regionFromStored(regionToStored(r, o), o);
            expect(back.x).toBeCloseTo(r.x); expect(back.y).toBeCloseTo(r.y);
            expect(back.w).toBeCloseTo(r.w); expect(back.h).toBeCloseTo(r.h);
        }
    });

    it('writes and reads the "x,y,w,h" form', () => {
        expect(regionHeader({ x: 0.05, y: 0.4, w: 0.45, h: 0.183333 })).toBe('0.05,0.4,0.45,0.1833');
        expect(parseRegion('0.05,0.4,0.45,0.1833')).toEqual({ x: 0.05, y: 0.4, w: 0.45, h: 0.1833 });
        expect(parseRegion('0.5,0.5,0.6,0.1')).toBeNull();     // runs off the image
        expect(parseRegion('a,b,c,d')).toBeNull();
        expect(parseRegion('0,0,0,0.5')).toBeNull();           // no width
    });
});

describe('sending an original: headers, targets, budget, reply', () => {
    const data = {
        persons: {
            p1: { id: 'p1', firstName: 'Anna', lastName: 'V', gender: 'female', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], refn: 'P0012' },
            p2: { id: 'p2', firstName: 'Nová', lastName: 'V', gender: 'female', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [] },
        },
        partnerships: {},
        sources: { s1: { id: 's1', title: 'Matrika', refn: 'S0042' }, s2: { id: 's2', title: 'Z aplikace' } },
    } as unknown as StromData;

    it('sends the person, the source and the region; percent-encodes the text', () => {
        const h = uploadHeaders({
            mimeType: 'image/tiff', name: 'Čáslav fol. 112.tif',
            region: { x: 0.05, y: 0.4, w: 0.45, h: 0.18 }, note: 'od tety',
        }, { person: 'P0012', source: 'S0042', region: true });
        expect(h).toEqual({
            'Content-Type': 'image/tiff',
            'X-Strom-Name': encodeURIComponent('Čáslav fol. 112.tif'),
            'X-Strom-Person': 'P0012',
            'X-Strom-Source': 'S0042',
            'X-Strom-Region': '0.05,0.4,0.45,0.18',
            'X-Strom-Note': encodeURIComponent('od tety'),
        });
        expect(uploadHeaders({ mimeType: '', name: 'a.jpg' }, {}))
            .toEqual({ 'Content-Type': 'application/octet-stream', 'X-Strom-Name': 'a.jpg' });
        // A research that does not take a region gets none.
        expect(uploadHeaders({ mimeType: 'image/jpeg', name: 'a.jpg', region: { x: 0, y: 0, w: 1, h: 1 } }, { region: false }))
            .not.toHaveProperty('X-Strom-Region');
    });

    it('waits for research numbers, drops what lost its person', () => {
        expect(originalTargets({ personId: 'p1' as PersonId, sourceId: 's1' }, data)).toEqual({ ready: true, gone: false, person: 'P0012', source: 'S0042' });
        expect(originalTargets({ personId: 'p2' as PersonId }, data)).toMatchObject({ ready: false, gone: false });
        expect(originalTargets({ sourceId: 's2' }, data)).toMatchObject({ ready: false, gone: false });
        expect(originalTargets({ personId: 'gone' as PersonId }, data)).toMatchObject({ gone: true });
        expect(originalTargets({ sourceId: 'gone' }, data)).toMatchObject({ gone: true });
        // A person's file whose source link went still goes to the person.
        expect(originalTargets({ personId: 'p1' as PersonId, sourceId: 'gone' }, data)).toEqual({ ready: true, gone: false, person: 'P0012' });
        expect(researchSourceRef('S0042')).toBe('S0042');
        expect(researchSourceRef('s1')).toBeNull();
    });

    it('keeps the queue within min(2 GB, 30 % of the quota)', () => {
        expect(originalsBudget(undefined)).toBe(ORIGINALS_MAX_BYTES);
        expect(originalsBudget(1_000_000_000)).toBe(300_000_000);
        expect(originalsBudget(100e9)).toBe(ORIGINALS_MAX_BYTES);
        expect(fitsBudget(250_000_000, 50_000_000, 1_000_000_000)).toBe(true);
        expect(fitsBudget(250_000_000, 50_000_001, 1_000_000_000)).toBe(false);
    });

    it('reads the research id from the reply, and the limit from accepts.media', () => {
        expect(mediaReplyId({ known: 'I0042' })).toBe('I0042');
        expect(mediaReplyId({ media: 'M0123' })).toBe('M0123');
        expect(mediaReplyId({ input: '<script>' })).toBeNull();
        expect(mediaReplyId(null)).toBeNull();
        expect(sanitizeAccepts({ media: { max: 524288000, free: 1e11, region: true, tasks: 'open' } }))
            .toMatchObject({ media: true, mediaMaxBytes: 524288000, mediaRegion: true });
        expect(sanitizeAccepts({ media: {} })).toMatchObject({ media: true, mediaMaxBytes: null, mediaRegion: false });
        expect(sanitizeAccepts({ media: null })).toMatchObject({ media: false, mediaMaxBytes: null, mediaRegion: false });
    });
});

describe('_STROM_SHA and _STROM_REGION in GEDCOM', () => {
    const SHA = 'a'.repeat(64);
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const tree = (): StromData => (<unknown>{
        persons: {
            p1: {
                id: 'p1' as PersonId, firstName: 'Anna', lastName: 'Víšková', gender: 'female', isPlaceholder: false,
                partnerships: [], parentIds: [], childIds: [], sourceIds: ['s1'],
                attachments: [{
                    id: 'att1', name: 'IMG_4021.jpg', mimeType: 'image/jpeg', dataUrl: PNG, sizeBytes: 70,
                    original: { sha256: SHA, name: 'IMG_4021.jpg', mimeType: 'image/jpeg', bytes: 3_100_000, orientation: 6 },
                }],
            },
        },
        partnerships: {},
        sources: {
            s1: {
                id: 's1', title: 'Křestní matrika Čáslav',
                excerpts: [{
                    id: 'exc1', dataUrl: PNG, width: 1, height: 1, sizeBytes: 70,
                    fromAttachmentId: 'att1', region: { x: 0, y: 0, w: 1, h: 0.25 }, originalSha: SHA,
                }],
            },
        },
    } as StromData);

    it('writes the hash under the attachment and the excerpt, the region on the stored file', () => {
        const ged = exportToGedcom(tree()).content;
        expect(ged).toContain(`2 _STROM_SHA ${SHA}\n2 _STROM_ORIENT 6`);
        // Shown top band of a photo turned 90° = the stored left band.
        expect(ged).toContain(`2 _STROM_SHA ${SHA}\n2 _STROM_REGION 0,0,0.25,1`);
    });

    it('reads them back: the original, and the crop linked to its page again', () => {
        const back = convertToStrom(parseGedcom(exportToGedcom(tree()).content)).data;
        const anna = Object.values(back.persons)[0];
        const att = anna.attachments![0];
        expect(att.original).toMatchObject({ sha256: SHA, orientation: 6 });
        const exc = Object.values(back.sources!)[0].excerpts![0];
        expect(exc.originalSha).toBe(SHA);
        expect(exc.fromAttachmentId).toBe(att.id);
        expect(exc.region!.x).toBeCloseTo(0); expect(exc.region!.y).toBeCloseTo(0);
        expect(exc.region!.w).toBeCloseTo(1); expect(exc.region!.h).toBeCloseTo(0.25);
    });

    it('ignores a malformed hash or region from a foreign file', () => {
        const ged = exportToGedcom(tree()).content
            .replace(`2 _STROM_SHA ${SHA}\n2 _STROM_ORIENT 6`, '2 _STROM_SHA nonsense\n2 _STROM_ORIENT 9')
            .replace('2 _STROM_REGION 0,0,0.25,1', '2 _STROM_REGION 2,2,2,2');
        const back = convertToStrom(parseGedcom(ged)).data;
        expect(Object.values(back.persons)[0].attachments![0].original).toBeUndefined();
        const exc = Object.values(back.sources!)[0].excerpts![0];
        expect(exc.originalSha).toBe(SHA);
        expect(exc.fromAttachmentId).toBeUndefined();
    });

    it('a tree without originals exports as before (no new lines)', () => {
        const t = tree();
        delete t.persons['p1' as PersonId].attachments![0].original;
        delete t.sources!.s1.excerpts![0].originalSha;
        const ged = exportToGedcom(t).content;
        expect(ged).not.toMatch(/_STROM_SHA|_STROM_REGION|_STROM_ORIENT/);
    });
});
