/**
 * A pooled image's reference (`\u0000sm:<id>`) where tree data holds images:
 * the load sanitizer keeps one that names an image of this browser's own pool
 * at a place an image may be (of a type that place allows) and drops every
 * other one — a forged id, another syntax, one in a text field; the size,
 * fingerprint and count helpers give for a reference with its catalog entry
 * exactly what they give for its data URL; and the image equality helper
 * tells a data URL and a reference of one picture apart from another.
 *
 * StorageManager is an in-memory Map per store. All data is invented.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const stores = new Map<string, Map<string, unknown>>();
function st(name: string): Map<string, unknown> {
    let m = stores.get(name);
    if (!m) { m = new Map(); stores.set(name, m); }
    return m;
}

vi.mock('../storage.js', () => ({
    StorageManager: {
        async init() {},
        async get<T>(store: string, key: string): Promise<T | null> {
            return structuredClone((st(store).get(key) as T) ?? null);
        },
        async set(store: string, key: string, value: unknown): Promise<void> {
            st(store).set(key, structuredClone(value));
        },
        async setTogether(writes: { store: string; key: string; value: unknown }[]): Promise<void> {
            for (const w of writes) st(w.store).set(w.key, structuredClone(w.value));
        },
        async delete(store: string, key: string): Promise<void> {
            st(store).delete(key);
        },
        async keys(store: string): Promise<string[]> {
            return [...st(store).keys()];
        },
        async getAll<T>(store: string): Promise<T[]> {
            return [...st(store).values()] as T[];
        },
        async getMany<T>(store: string, keys: string[]): Promise<Map<string, T | null>> {
            return new Map(keys.map(k => [k, structuredClone((st(store).get(k) as T) ?? null)]));
        },
        async flush(): Promise<void> {},
    },
}));

import { POOL_REF, withPoolLock, storeImages, notePoolSizes } from '../media-pool.js';
import {
    clearImageMeta, computeImageMeta, setImageMeta, imageMetaOf, noteOwnImages, isOwnImage,
    imageToken, mediaToken, pooledImageByteSize, pooledImageSize, pooledImageToken, imageLengthMark,
} from '../image-meta.js';
import { poolIdOf, isPoolRef, looksLikePoolRef, isImageValue } from '../image-ref.js';
import { dataUrlByteSize, dataUrlImageSize, totalPhotoBytes } from '../photo.js';
import {
    stripUnsafeMediaDataUrls, dropStrayPoolRefs, cleanPortraitSources, isSafePhotoDataUrl,
    isSafeAttachmentDataUrl, isSafeExcerptDataUrl, validateTreeData,
} from '../validation.js';
import { migrateData } from '../data.js';
import { contentFingerprint, researchMediaKeys } from '../research-link.js';
import { baseCopy, stable } from '../research-changes.js';
import { browserMediaFingerprint } from '../browser-media.js';
import { countImages, personMedia, totalAttachmentBytes } from '../attachments.js';
import { sameImage, sameImageNow } from '../image-equal.js';
import { StromData, Person, PersonId, PartnershipId, Partnership } from '../types.js';

/** A PNG data URL of the given size, padded with bytes so it is long enough to be pooled. */
function png(w: number, h: number, fill = 7, length = 1500): string {
    const b = new Uint8Array(length);
    for (let i = 0; i < b.length; i++) b[i] = (i * fill) & 0xff;
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(b.buffer).setUint32(16, w);
    new DataView(b.buffer).setUint32(20, h);
    return `data:image/png;base64,${Buffer.from(b).toString('base64')}`;
}

/** A JPEG data URL (SOF0 header with the given size), padded. */
function jpeg(w: number, h: number, length = 1400): string {
    const b = new Uint8Array(length);
    for (let i = 0; i < b.length; i++) b[i] = (i * 13) & 0xff;
    b.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff, 0x03], 0);
    return `data:image/jpeg;base64,${Buffer.from(b).toString('base64')}`;
}

function pdf(length = 1200): string {
    const b = new Uint8Array(length);
    b.set([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    for (let i = 8; i < b.length; i++) b[i] = (i * 3) & 0xff;
    return `data:application/pdf;base64,${Buffer.from(b).toString('base64')}`;
}

/** Store the data URLs in the pool (as a save does) and give their references. */
async function pool(...urls: string[]): Promise<string[]> {
    const { ids } = await withPoolLock(() => storeImages(new Set(urls), false, 'test'));
    return urls.map(u => POOL_REF + ids.get(u)!);
}

/** A reference to an image not in this pool (a forged one). */
const FOREIGN = POOL_REF + 'p:' + '3'.repeat(40);

const A = 'p_a' as PersonId, B = 'p_b' as PersonId;
const U = 'u_ab' as PartnershipId;

function person(id: PersonId, extra: Partial<Person> = {}): Person {
    return {
        id, firstName: id === A ? 'Bertold' : 'Ilmara', lastName: 'Vranec', gender: id === A ? 'male' : 'female',
        partnerships: [U], parentIds: [], childIds: [], ...extra,
    } as Person;
}

/** A tree with each place an image may be: two portraits, the couple's photo, a file and an excerpt. */
function tree(img: { portrait: string; union: string; file: string; excerpt: string; other?: string }): StromData {
    return {
        version: 25,
        persons: {
            [A]: person(A, { photo: img.portrait }),
            [B]: person(B, { photo: img.other ?? img.portrait }),
        },
        partnerships: {
            [U]: { id: U, person1Id: A, person2Id: B, childIds: [], status: 'married', photo: img.union } as Partnership,
        },
        media: {
            m1: { id: 'm1', name: 'scan.png', mimeType: 'image/png', dataUrl: img.file, sizeBytes: 0, places: [{ personId: A }] },
        },
        sources: {
            s1: { id: 's1', title: 'Matrika', excerpts: [{ id: 'e1', dataUrl: img.excerpt, width: 10, height: 10, sizeBytes: 0 }] },
        },
    } as unknown as StromData;
}

beforeEach(() => {
    stores.clear();
    clearImageMeta();
});

describe('reference syntax (image-ref.ts)', () => {
    it('takes exactly the form the pool writes', () => {
        const id = 'p:' + 'ab'.repeat(20);
        expect(poolIdOf(POOL_REF + id)).toBe(id);
        expect(poolIdOf(POOL_REF + 'e:' + '0'.repeat(40))).toBe('e:' + '0'.repeat(40));
        for (const bad of [
            POOL_REF + 'p:' + 'AB'.repeat(20),          // upper case
            POOL_REF + 'p:' + 'a'.repeat(39),           // too short
            POOL_REF + 'p:' + 'a'.repeat(41),           // too long
            POOL_REF + 'x:' + 'a'.repeat(40),           // another kind
            POOL_REF + 'p:' + 'a'.repeat(40) + ' ',     // something after
            ' ' + POOL_REF + 'p:' + 'a'.repeat(40),     // something before
            'sm:p:' + 'a'.repeat(40),                   // no NUL
            '\\u0000sm:p:' + 'a'.repeat(40),            // the JSON escape as text
        ]) {
            expect(isPoolRef(bad), JSON.stringify(bad)).toBe(false);
        }
        expect(looksLikePoolRef(POOL_REF + 'whatever')).toBe(true);
        expect(looksLikePoolRef('note ' + POOL_REF + id)).toBe(false);
        expect(isImageValue(png(2, 2))).toBe(true);
        expect(isImageValue(POOL_REF + id)).toBe(true);
        expect(isImageValue('plain text')).toBe(false);
    });
});

describe('helpers give for a reference what they give for its data URL', () => {
    it('byte size, pixel size and both tokens', async () => {
        const urls = [png(400, 300), jpeg(640, 480), pdf()];
        const refs = await pool(...urls);
        urls.forEach((url, i) => {
            const ref = refs[i];
            expect(dataUrlByteSize(ref)).toBe(dataUrlByteSize(url));
            expect(dataUrlImageSize(ref)).toEqual(dataUrlImageSize(url));
            expect(imageToken(ref)).toBe(imageToken(url));
            expect(mediaToken(ref)).toBe(mediaToken(url));
            expect(imageLengthMark(ref, 256)).toBe(imageLengthMark(url, 256));
        });
        expect(dataUrlImageSize(refs[0])).toEqual({ w: 400, h: 300 });
        expect(dataUrlImageSize(refs[1])).toEqual({ w: 640, h: 480 });
        expect(dataUrlImageSize(refs[2])).toBeNull();
    });

    it('the research fingerprint, its media keys and the base copy', async () => {
        const [portrait, union, file, excerpt] = [png(300, 300, 3), jpeg(800, 600), png(1200, 900, 5), png(200, 100, 9)];
        const refs = await pool(portrait, union, file, excerpt);
        const plain = tree({ portrait, union, file, excerpt });
        const pooled = tree({ portrait: refs[0], union: refs[1], file: refs[2], excerpt: refs[3] });
        for (const t of [plain, pooled]) {
            t.persons[A].refn = 'P1';
            t.persons[B].refn = 'P2';
        }
        expect(contentFingerprint(pooled)).toBe(contentFingerprint(plain));
        expect(researchMediaKeys(pooled)).toEqual(researchMediaKeys(plain));
        expect(baseCopy(pooled)).toEqual(baseCopy(plain));
        expect(stable(pooled)).toBe(stable(plain));
        expect(stable(pooled.persons[A])).toContain(`img:${portrait.length}`);
        // Another picture still tells.
        const other = tree({ portrait: (await pool(png(301, 300, 3)))[0], union: refs[1], file: refs[2], excerpt: refs[3] });
        expect(contentFingerprint(other)).not.toBe(contentFingerprint(plain));
    });

    it('the browser media fingerprint, the counts and the totals', async () => {
        const [portrait, union, file, excerpt] = [png(300, 300, 3), jpeg(800, 600), png(1200, 900, 5), png(200, 100, 9)];
        const refs = await pool(portrait, union, file, excerpt);
        const plain = tree({ portrait, union, file, excerpt, other: union });
        const pooled = tree({ portrait: refs[0], union: refs[1], file: refs[2], excerpt: refs[3], other: refs[1] });
        expect(browserMediaFingerprint(pooled)).toBe(browserMediaFingerprint(plain));
        expect(browserMediaFingerprint(pooled)).not.toBe('');
        expect(countImages(pooled)).toEqual(countImages(plain));
        expect(countImages(pooled).bytes).toBeGreaterThan(0);
        expect(totalPhotoBytes(pooled)).toBe(totalPhotoBytes(plain));
        expect(totalAttachmentBytes(pooled)).toBe(totalAttachmentBytes(plain));
        expect(personMedia(pooled.persons[A], pooled)).toEqual(personMedia(plain.persons[A], plain));
    });

    it('a reference without its catalog entry: documented fallbacks', () => {
        const ref = POOL_REF + 'p:' + 'c'.repeat(40);
        const enc = POOL_REF + 'e:' + 'c'.repeat(40);
        // Not known at all: no size, a token of its own (stable, not a data URL's), the value kept as it is.
        expect(dataUrlByteSize(ref)).toBe(0);
        expect(dataUrlImageSize(ref)).toBeNull();
        expect(imageToken(ref)).toBe(pooledImageToken(ref));
        expect(imageToken(ref)).toBe(imageToken(ref));
        expect(imageToken(ref)).not.toBe(imageToken(enc));
        expect(mediaToken(ref)).not.toBe(mediaToken(enc));
        expect(imageLengthMark(ref, 256)).toBeNull();
        expect(stable({ photo: ref })).toBe(JSON.stringify({ photo: ref }));
        // Named by an own record (its stored size): an unencrypted image's size is its bytes.
        noteOwnImages({ [ref.slice(4)]: 1234, [enc.slice(4)]: 999 });
        expect(pooledImageByteSize(ref)).toBe(1234);
        expect(pooledImageByteSize(enc)).toBe(0);
        expect(pooledImageSize(ref)).toBeNull();
    });
});

describe('the load sanitizer and references', () => {
    it('keeps an own reference at each place an image may be', async () => {
        const [portrait, union, file, excerpt] = await pool(png(300, 300, 3), jpeg(800, 600), pdf(), png(200, 100, 9));
        const data = tree({ portrait, union, file, excerpt });
        expect(stripUnsafeMediaDataUrls(data)).toBe(0);
        expect(dropStrayPoolRefs(data)).toBe(0);
        expect(data.persons[A].photo).toBe(portrait);
        expect(data.partnerships[U].photo).toBe(union);
        expect(data.media!.m1.dataUrl).toBe(file);
        expect(data.sources!.s1.excerpts![0].dataUrl).toBe(excerpt);
        // Through the whole load as well.
        const loaded = migrateData(structuredClone(tree({ portrait, union, file, excerpt })));
        expect(loaded.persons[A].photo).toBe(portrait);
        expect(loaded.partnerships[U].photo).toBe(union);
        expect(loaded.media!.m1.dataUrl).toBe(file);
        expect(loaded.sources!.s1.excerpts![0].dataUrl).toBe(excerpt);
        expect(validateTreeData(loaded).issues.filter(i => i.type === 'photoUnsafeData' || i.type === 'attachmentNoData')).toEqual([]);
    });

    it('keeps a reference an own stored record names before its catalog entry is there', () => {
        const ref = POOL_REF + 'p:' + 'd'.repeat(40);
        expect(isSafePhotoDataUrl(ref)).toBe(false);
        notePoolSizes({ [ref.slice(4)]: 2048 });
        expect(isOwnImage(ref)).toBe(true);
        const loaded = migrateData(tree({ portrait: ref, union: ref, file: ref, excerpt: ref }));
        expect(loaded.persons[A].photo).toBe(ref);
        expect(loaded.media!.m1.dataUrl).toBe(ref);
    });

    it('drops a reference to an image not in this pool (a file from elsewhere)', () => {
        const data = tree({ portrait: FOREIGN, union: FOREIGN, file: FOREIGN, excerpt: FOREIGN });
        const loaded = migrateData(structuredClone(data));
        expect(loaded.persons[A].photo).toBeUndefined();
        expect(loaded.partnerships[U].photo).toBeUndefined();
        expect(loaded.media?.m1).toBeUndefined();
        expect(loaded.sources!.s1.excerpts).toBeUndefined();
        expect(stripUnsafeMediaDataUrls(data)).toBe(5);
    });

    it('drops a reference of a type the place does not allow', async () => {
        // An image's catalog entry says what it is: a PDF is a file, not a portrait or a crop;
        // text pooled from anywhere (a long "data:" note) is none of them.
        const html = 'data:text/html;base64,' + Buffer.from('<script>alert(1)</script>'.repeat(60)).toString('base64');
        const [pdfRef, htmlRef, svgRef] = await pool(pdf(), html, 'data:image/svg+xml;base64,' + 'A'.repeat(1200));
        expect(imageMetaOf(htmlRef)?.head).toBe('data:text/html;base64,');
        expect(isSafePhotoDataUrl(pdfRef)).toBe(false);
        expect(isSafeExcerptDataUrl(pdfRef)).toBe(false);
        expect(isSafeAttachmentDataUrl(pdfRef)).toBe(true);
        for (const ref of [htmlRef, svgRef]) {
            expect(isSafePhotoDataUrl(ref)).toBe(false);
            expect(isSafeAttachmentDataUrl(ref)).toBe(false);
            expect(isSafeExcerptDataUrl(ref)).toBe(false);
        }
        const loaded = migrateData(tree({ portrait: pdfRef, union: htmlRef, file: htmlRef, excerpt: svgRef }));
        expect(loaded.persons[A].photo).toBeUndefined();
        expect(loaded.partnerships[U].photo).toBeUndefined();
        expect(loaded.media?.m1).toBeUndefined();
        expect(loaded.sources!.s1.excerpts).toBeUndefined();
    });

    it('drops another syntax and a reference inside longer text at an image place', async () => {
        const [own] = await pool(png(10, 10));
        const id = own.slice(4);
        for (const bad of [
            POOL_REF + id.toUpperCase(),
            POOL_REF + id.slice(0, -1),
            POOL_REF + id + '0',
            POOL_REF + 'x' + id.slice(1),
            own + ' ',
            'x' + own,
            `note ${own} more`,
        ]) {
            const loaded = migrateData(tree({ portrait: bad, union: bad, file: bad, excerpt: bad }));
            expect(loaded.persons[A].photo, JSON.stringify(bad)).toBeUndefined();
            expect(loaded.partnerships[U].photo).toBeUndefined();
            expect(loaded.media?.m1).toBeUndefined();
            expect(loaded.sources!.s1.excerpts).toBeUndefined();
        }
    });

    it('drops a reference in a text field, keeps one inside longer text there', async () => {
        const [own] = await pool(png(10, 10));
        const portrait = png(20, 20);
        const data = tree({ portrait, union: portrait, file: portrait, excerpt: portrait });
        const a = data.persons[A] as Person & Record<string, unknown>;
        a.notes = own;
        a.birthPlace = POOL_REF + 'p:' + 'zz';
        a.nameVariants = [own, 'Wranetz'] as unknown as Person['nameVariants'];
        (data.persons[B] as Person).notes = `Seen at ${own} in the register`;
        (data.partnerships[U] as Partnership).note = FOREIGN;
        (data.media!.m1 as unknown as Record<string, unknown>).note = own;
        (data.sources!.s1 as unknown as Record<string, unknown>).title = own;
        (data.sources!.s1.excerpts![0] as unknown as Record<string, unknown>).caption = own;
        const loaded = migrateData(data);
        const la = loaded.persons[A] as Person & Record<string, unknown>;
        expect(la.notes).toBeUndefined();
        expect(la.birthPlace).toBeUndefined();
        expect(la.nameVariants).toEqual(['Wranetz']);
        expect(la.photo).toBe(portrait);
        expect(loaded.persons[B].notes).toBe(`Seen at ${own} in the register`);
        expect(loaded.partnerships[U].note).toBeUndefined();
        expect((loaded.media!.m1 as unknown as Record<string, unknown>).note).toBeUndefined();
        expect(loaded.media!.m1.dataUrl).toBe(portrait);
        expect((loaded.sources!.s1 as unknown as Record<string, unknown>).title).toBeUndefined();
        expect(loaded.sources!.s1.excerpts![0].caption).toBeUndefined();
        expect(loaded.sources!.s1.excerpts![0].dataUrl).toBe(portrait);
        expect(JSON.stringify(loaded)).not.toMatch(/"\\u0000sm:/);
    });

    it('drops a reference in a field an image holder has besides its image', async () => {
        const [own] = await pool(png(10, 10));
        const data = tree({ portrait: own, union: own, file: own, excerpt: own });
        (data.persons[A] as Person).photoOriginalName = own;
        (data.partnerships[U] as Partnership).photoDate = own;
        const n = dropStrayPoolRefs(data);
        expect(n).toBe(2);
        expect(data.persons[A].photo).toBe(own);
        expect(data.persons[A].photoOriginalName).toBeUndefined();
        expect(data.partnerships[U].photo).toBe(own);
        expect(data.partnerships[U].photoDate).toBeUndefined();
    });

    it('checks a portrait cut from a pooled original by the catalog\'s pixel size', async () => {
        const [wide] = await pool(png(400, 200));
        const make = (w: number): StromData => {
            const d = tree({ portrait: png(50, 50), union: wide, file: wide, excerpt: png(5, 5) });
            d.persons[A].photoSource = { attachmentId: 'm1', region: { x: 0, y: 0, w, h: 1 } };
            return d;
        };
        // Square in pixels: 0.5 of 400 = 200 = the height.
        const ok = make(0.5);
        expect(cleanPortraitSources(ok)).toBe(0);
        expect(ok.persons[A].photoSource).toBeDefined();
        // Not a square (known only from the catalog): goes, the portrait stays.
        const bad = make(0.9);
        expect(cleanPortraitSources(bad)).toBe(1);
        expect(bad.persons[A].photoSource).toBeUndefined();
        expect(bad.persons[A].photo).toBeDefined();
    });

    it('leaves data URLs as before', () => {
        const portrait = png(30, 30);
        const data = tree({ portrait, union: jpeg(10, 10), file: pdf(), excerpt: png(4, 4) });
        expect(stripUnsafeMediaDataUrls(data)).toBe(0);
        expect(dropStrayPoolRefs(data)).toBe(0);
        expect(data.persons[A].photo).toBe(portrait);
    });
});

describe('the same picture as a data URL or a reference (image-equal.ts)', () => {
    it('a data URL and the reference it was pooled under', async () => {
        const url = png(64, 48);
        const other = png(64, 48, 11);
        const [ref, otherRef] = await pool(url, other);
        expect(await sameImage(url, ref)).toBe(true);
        expect(await sameImage(ref, url)).toBe(true);
        expect(await sameImage(other, ref)).toBe(false);
        expect(await sameImage(url, otherRef)).toBe(false);
        // The catalog tells another length or sample at once.
        expect(sameImageNow(png(64, 48, 11, 1600), ref)).toBe(false);
        expect(sameImageNow(url, ref)).toBeNull();
    });

    it('two references: by id, across kinds by the catalog', async () => {
        const url = png(64, 48);
        const [ref, otherRef] = await pool(url, png(8, 8));
        expect(sameImageNow(ref, ref)).toBe(true);
        expect(sameImageNow(ref, otherRef)).toBe(false);
        // The same picture under an encrypted id (stored with encryption on), known to the catalog.
        const enc = 'e:' + 'f'.repeat(40);
        setImageMeta(enc, await computeImageMeta(url));
        expect(sameImageNow(ref, POOL_REF + enc)).toBe(true);
        expect(await sameImage(url, POOL_REF + enc)).toBe(true);
        expect(await sameImage(png(64, 48, 11), POOL_REF + enc)).toBe(false);
        expect(sameImageNow(otherRef, POOL_REF + enc)).toBe(false);
    });

    it('what cannot be told counts as another picture', async () => {
        const url = png(64, 48);
        const unknownE = POOL_REF + 'e:' + '1'.repeat(40);
        const unknownP = POOL_REF + 'p:' + '1'.repeat(40);
        expect(await sameImage(url, unknownE)).toBe(false);
        expect(await sameImage(url, unknownP)).toBe(false);
        expect(sameImageNow(unknownP, unknownE)).toBe(false);
        expect(sameImageNow(undefined, url)).toBe(false);
        expect(sameImageNow(undefined, undefined)).toBe(true);
        expect(sameImageNow('a', 'b')).toBe(false);
    });
});
