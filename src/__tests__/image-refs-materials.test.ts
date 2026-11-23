/**
 * The materials, the excerpts and the editors take a pooled image's reference
 * (`\u0000sm:<id>`) as well as a data URL, and do with either what they do
 * today (spec 135, part D4): an excerpt is shown by an address of the pool's
 * (a research crop turned by its EXIF orientation, written into the pooled
 * JPEG's bytes as excerpts.ts writes it into a data URL); its pixel size comes
 * from the image catalog; a tree's file is saved and a PDF opened from the
 * pool's bytes (a Blob, no base64), a data URL as before; an editor decodes a
 * reference from the pool. StorageManager is an in-memory Map; data invented.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveObjectURL } from 'node:buffer';

const media = new Map<string, unknown>();

vi.mock('../storage.js', () => ({
    StorageManager: {
        async init() {},
        async get<T>(store: string, key: string): Promise<T | null> {
            return store === 'media' ? structuredClone((media.get(key) as T) ?? null) : null;
        },
        async set() {},
        async setTogether() {},
        async keys(store: string): Promise<string[]> { return store === 'media' ? [...media.keys()] : []; },
        async getAll(): Promise<unknown[]> { return []; },
        async getMany<T>(store: string, keys: string[]): Promise<Map<string, T | null>> {
            return new Map(keys.map(k => [k, store === 'media' ? structuredClone((media.get(k) as T) ?? null) : null]));
        },
        async delete() {},
        async flush() {},
    },
}));

import { POOL_REF, poolKeyOf, poolKeyParts, turnedPoolRef, imageAddrAttr, poolIdOf, IMAGE_PLACEHOLDER } from '../image-ref.js';
import { imageUrl, imageUrlNow, imageBlob, releaseImageUrls, imgSrcAttr } from '../image-src.js';
import { excerptImageUrl, withExifOrientation, imageSizeFromDataUrl, excerptFromDataUrl } from '../excerpts.js';
import { jpegWithOrientation } from '../exif-orientation.js';
import { exifOrientation } from '../originals.js';
import { setImageMeta, clearImageMeta, noteOwnImages, type ImageMeta } from '../image-meta.js';
import { saveImageValue, openPdfValue, wireImageDownload } from '../ui/image-file.js';

/** A JPEG head of `width` × `height` (JFIF, a frame header, the end) plus `pad` bytes of scan data. */
function tinyJpegBytes(width: number, height: number, pad = 0): Uint8Array {
    const bytes = [0xFF, 0xD8,
        0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
        0xFF, 0xC0, 0x00, 0x11, 0x08, height >> 8, height & 0xFF, width >> 8, width & 0xFF,
        0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
    for (let i = 0; i < pad; i++) bytes.push((i * 7) & 0x7F);
    bytes.push(0xFF, 0xD9);
    return new Uint8Array(bytes);
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const PDF_BYTES = new TextEncoder().encode('%PDF-1.4\n' + 'x'.repeat(1500) + '\n%%EOF');

/** Put bytes into the pool as the pool stores an image (`{head, bytes}`); its reference. */
function pooled(seed: number, head: string, bytes: Uint8Array, meta?: Partial<ImageMeta>): string {
    const id = 'p:' + (seed.toString(16).padStart(2, '0')).repeat(20);
    media.set(id, { head, bytes: bytes.slice().buffer });
    if (meta) setImageMeta(id, { len: head.length + b64(bytes).length, head, bytes: bytes.length, token: 't', mtok: 'm', ...meta });
    return POOL_REF + id;
}

async function blobBytes(url: string): Promise<Uint8Array> {
    const blob = url.startsWith('blob:') ? resolveObjectURL(url) : null;
    if (!blob) throw new Error(`no blob behind ${url}`);
    return new Uint8Array(await blob.arrayBuffer());
}

beforeEach(() => { media.clear(); clearImageMeta(); });
afterEach(() => { releaseImageUrls(); vi.unstubAllGlobals(); });

describe('a turned reference: the address of a research crop shown upright', () => {
    it('is the reference with its orientation; a plain one, another value, a bad orientation stay as they are', () => {
        const ref = POOL_REF + 'p:' + 'ab'.repeat(20);
        const turned = turnedPoolRef(ref, 6);
        expect(turned).toBe(ref + '@o6');
        expect(poolKeyOf(turned)).toBe('p:' + 'ab'.repeat(20) + '@o6');
        expect(poolKeyParts(poolKeyOf(turned)!)).toEqual({ id: 'p:' + 'ab'.repeat(20), orient: 6 });
        expect(poolKeyOf(ref)).toBe(poolIdOf(ref));
        for (const o of [undefined, 0, 1, 9, 2.5]) expect(turnedPoolRef(ref, o)).toBe(ref);
        expect(turnedPoolRef('data:image/jpeg;base64,AAAA', 6)).toBe('data:image/jpeg;base64,AAAA');
        // Never an image of the tree: the sanitizer's strict reference does not read it.
        expect(poolIdOf(turned)).toBeNull();
        expect(poolKeyOf(ref + '@o1')).toBeNull();
        expect(poolKeyOf(ref + '@o6x')).toBeNull();
    });

    it('is written as the placeholder with its key, as a plain reference is', () => {
        const ref = POOL_REF + 'p:' + 'cd'.repeat(20);
        expect(imageAddrAttr(turnedPoolRef(ref, 8))).toBe(`src="${IMAGE_PLACEHOLDER}" data-pool-ref="p:${'cd'.repeat(20)}@o8"`);
        expect(imgSrcAttr(ref)).toBe(`src="${IMAGE_PLACEHOLDER}" data-pool-ref="p:${'cd'.repeat(20)}"`);
    });
});

describe('an excerpt held as a reference', () => {
    it('is shown by the reference, a research crop by its turned address', () => {
        const ref = pooled(1, 'data:image/jpeg;base64,', tinyJpegBytes(400, 100, 1200));
        expect(excerptImageUrl({ dataUrl: ref })).toBe(ref);
        expect(excerptImageUrl({ dataUrl: ref, orient: 1 })).toBe(ref);
        expect(excerptImageUrl({ dataUrl: ref, orient: 6 })).toBe(turnedPoolRef(ref, 6));
    });

    it('the turned address gives the pooled JPEG with the EXIF block a data URL gets — the same bytes', async () => {
        const jpeg = tinyJpegBytes(400, 100, 1200);
        const ref = pooled(2, 'data:image/jpeg;base64,', jpeg);
        const asData = withExifOrientation(`data:image/jpeg;base64,${b64(jpeg)}`, 6);
        const url = await imageUrl(excerptImageUrl({ dataUrl: ref, orient: 6 }));
        expect(url.startsWith('blob:')).toBe(true);
        const got = await blobBytes(url);
        expect(exifOrientation(got)).toBe(6);
        expect(b64(got)).toBe(asData.split(',')[1]);
        expect(resolveObjectURL(url)!.type).toBe('image/jpeg');
        // The plain reference: the bytes as stored, under its own key.
        const plain = await imageUrl(ref);
        expect(plain).not.toBe(url);
        expect(b64(await blobBytes(plain))).toBe(b64(jpeg));
        expect(imageUrlNow(turnedPoolRef(ref, 6))).toBe(url);
        // As a Blob (the viewer, a download): the turned bytes too.
        const blob = await imageBlob(turnedPoolRef(ref, 6));
        expect(b64(new Uint8Array(await blob!.arrayBuffer()))).toBe(asData.split(',')[1]);
    });

    it('a turned PNG, or a JPEG with its own EXIF block, comes as stored (as for a data URL)', async () => {
        const png = new Uint8Array(1500).fill(7);
        const ref = pooled(3, 'data:image/png;base64,', png);
        const blob = await imageBlob(turnedPoolRef(ref, 6));
        expect(b64(new Uint8Array(await blob!.arrayBuffer()))).toBe(b64(png));
        const missing = POOL_REF + 'p:' + '0'.repeat(40);
        expect(await imageUrl(turnedPoolRef(missing, 6))).toBe('');
    });

    it('the byte writer matches the data URL writer', () => {
        const jpeg = tinyJpegBytes(30, 20, 50);
        for (const o of [2, 5, 8]) {
            expect(b64(jpegWithOrientation(jpeg, o)!)).toBe(withExifOrientation(`data:image/jpeg;base64,${b64(jpeg)}`, o).split(',')[1]);
        }
        expect(jpegWithOrientation(jpeg, 1)).toBeNull();
        expect(jpegWithOrientation(jpegWithOrientation(jpeg, 6)!, 3)).toBeNull();
        expect(jpegWithOrientation(new Uint8Array([1, 2, 3]), 6)).toBeNull();
    });

    it('its pixel size and byte size come from the image catalog; a new excerpt from it keeps them', () => {
        const ref = pooled(4, 'data:image/jpeg;base64,', tinyJpegBytes(400, 100, 1200), { w: 400, h: 100, bytes: 1241 });
        expect(imageSizeFromDataUrl(ref)).toEqual({ width: 400, height: 100 });
        const unknown = POOL_REF + 'p:' + '9'.repeat(40);
        expect(imageSizeFromDataUrl(unknown)).toBeNull();
        noteOwnImages({ [poolIdOf(ref)!]: 1241 });
        const exc = excerptFromDataUrl(ref);
        expect(exc).toMatchObject({ dataUrl: ref, width: 400, height: 100, sizeBytes: 1241 });
    });
});

// ==================== FILES: SAVE, OPEN A PDF ====================

interface FakeAnchor { href: string; download: string; hidden: boolean; clicked: number; click(): void; remove(): void; listeners: ((e: { preventDefault(): void }) => void)[]; addEventListener(t: string, l: (e: { preventDefault(): void }) => void): void; attrs: Map<string, string>; getAttribute(n: string): string | null; setAttribute(n: string, v: string): void; removeAttribute(n: string): void }

function fakeAnchor(): FakeAnchor {
    const a: FakeAnchor = {
        href: '', download: '', hidden: false, clicked: 0, listeners: [], attrs: new Map(),
        click() { a.clicked++; saved.push({ href: a.href, name: a.download }); },
        remove() {},
        addEventListener(_t, l) { a.listeners.push(l); },
        getAttribute(n) { return a.attrs.get(n) ?? null; },
        setAttribute(n, v) { a.attrs.set(n, v); },
        removeAttribute(n) { a.attrs.delete(n); },
    };
    return a;
}

let saved: { href: string; name: string }[] = [];

function stubDocument(): void {
    saved = [];
    vi.stubGlobal('document', { createElement: () => fakeAnchor(), body: { appendChild() {} } });
}

describe('a tree\'s file saved or opened', () => {
    it('a data URL is saved from itself; a reference from an object URL of its pooled bytes', async () => {
        stubDocument();
        const data = `data:image/png;base64,${b64(new Uint8Array(1200).fill(3))}`;
        expect(await saveImageValue(data, 'a.png')).toBe(true);
        expect(saved).toEqual([{ href: data, name: 'a.png' }]);
        const png = new Uint8Array(1200).fill(5);
        const ref = pooled(5, 'data:image/png;base64,', png);
        expect(await saveImageValue(ref, 'b.png')).toBe(true);
        expect(saved[1].name).toBe('b.png');
        expect(saved[1].href.startsWith('blob:')).toBe(true);
        expect(b64(await blobBytes(saved[1].href))).toBe(b64(png));
        // None in the pool: nothing saved.
        expect(await saveImageValue(POOL_REF + 'p:' + '0'.repeat(40), 'c.png')).toBe(false);
        expect(saved).toHaveLength(2);
    });

    it('a Download link: a data URL as its href, a reference saved on the click', async () => {
        stubDocument();
        const link = fakeAnchor();
        wireImageDownload(link as unknown as HTMLAnchorElement, 'data:image/png;base64,AAAA', 'x.png');
        expect([link.href, link.download, link.listeners.length]).toEqual(['data:image/png;base64,AAAA', 'x.png', 0]);
        const ref = pooled(6, 'data:image/jpeg;base64,', tinyJpegBytes(10, 10, 1200));
        const refLink = fakeAnchor();
        wireImageDownload(refLink as unknown as HTMLAnchorElement, ref, 'y.jpg');
        expect(refLink.href).toBe('#');
        expect(refLink.download).toBe('y.jpg');
        let prevented = false;
        refLink.listeners[0]({ preventDefault: () => { prevented = true; } });
        expect(prevented).toBe(true);
        await vi.waitFor(() => expect(saved.some(s => s.name === 'y.jpg' && s.href.startsWith('blob:'))).toBe(true));
    });

    it('a pooled PDF opens in a tab opened at once, which then gets the PDF\'s bytes', async () => {
        const tab = { closed: false, location: { href: '' }, close: vi.fn() };
        const open = vi.fn(() => tab);
        vi.stubGlobal('window', { open });
        const ref = pooled(7, 'data:application/pdf;base64,', PDF_BYTES, { bytes: PDF_BYTES.length });
        const failed = vi.fn();
        expect(openPdfValue(ref, 'application/pdf', failed)).toBe(true);
        expect(open).toHaveBeenCalledWith('', '_blank');
        await vi.waitFor(() => expect(tab.location.href.startsWith('blob:')).toBe(true));
        const blob = resolveObjectURL(tab.location.href)!;
        expect(blob.type).toBe('application/pdf');
        expect(new Uint8Array(await blob.arrayBuffer())).toEqual(PDF_BYTES);
        expect(failed).not.toHaveBeenCalled();
    });

    it('a data URL PDF opens as before; not a PDF opens nothing', async () => {
        const open = vi.fn(() => null);
        vi.stubGlobal('window', { open });
        expect(openPdfValue(`data:application/pdf;base64,${b64(PDF_BYTES)}`, 'application/pdf')).toBe(true);
        expect(open).toHaveBeenCalledTimes(1);
        expect((open.mock.calls[0] as unknown[])[0]).toMatch(/^blob:/);
        // A declared PDF whose catalog says otherwise, or another declared type: no tab.
        const img = pooled(8, 'data:image/png;base64,', new Uint8Array(1200), {});
        expect(openPdfValue(img, 'application/pdf')).toBe(false);
        expect(openPdfValue(pooled(9, 'data:application/pdf;base64,', PDF_BYTES), 'image/png')).toBe(false);
        expect(open).toHaveBeenCalledTimes(1);
    });

    it('a pooled "PDF" that is not one closes its tab and says it failed', async () => {
        const tab = { closed: false, location: { href: '' }, close: vi.fn() };
        vi.stubGlobal('window', { open: vi.fn(() => tab) });
        // No catalog entry: known only once read — a text record is never handed on.
        const ref = pooled(10, 'data:text/html;base64,', new TextEncoder().encode('<script>1</script>'.repeat(80)));
        const failed = vi.fn();
        expect(openPdfValue(ref, 'application/pdf', failed)).toBe(true);
        await vi.waitFor(() => expect(failed).toHaveBeenCalled());
        expect(tab.close).toHaveBeenCalled();
        expect(tab.location.href).toBe('');
    });
});

describe('an editor\'s source held as a reference', () => {
    it('is decoded from the pooled bytes; one the pool does not give rejects', async () => {
        const jpeg = tinyJpegBytes(12, 8, 1200);
        const ref = pooled(11, 'data:image/jpeg;base64,', jpeg);
        const seen: Blob[] = [];
        vi.stubGlobal('createImageBitmap', async (b: Blob) => { seen.push(b); return { width: 12, height: 8, close() {} }; });
        const { decodeImage } = await import('../ui/crop-editor.js');
        const bmp = await decodeImage(ref);
        expect(bmp.width).toBe(12);
        expect(seen[0].type).toBe('image/jpeg');
        expect(b64(new Uint8Array(await seen[0].arrayBuffer()))).toBe(b64(jpeg));
        await expect(decodeImage(POOL_REF + 'p:' + '0'.repeat(40))).rejects.toThrow();
    });
});
