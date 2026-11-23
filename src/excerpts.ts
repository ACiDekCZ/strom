/**
 * Source excerpts: crops of a register entry stored on its Source (see
 * SourceExcerpt in types.ts). Pure helpers — no DOM — so the importer and the
 * tests can use them; the canvas cropping lives in the UI.
 */

import { SourceExcerpt } from './types.js';
import { generateExcerptId } from './ids.js';
import { dataUrlByteSize } from './photo.js';
import { isSafeExcerptDataUrl } from './validation.js';
import { isPoolRef, turnedPoolRef } from './image-ref.js';
import { pooledImageSize } from './image-meta.js';
import { jpegWithOrientation } from './exif-orientation.js';

/** Longest side of an excerpt the app produces, in pixels. */
export const EXCERPT_MAX_SIDE = 1200;
/** JPEG quality of an excerpt the app produces. */
export const EXCERPT_QUALITY = 0.8;

/** Decode the first `maxBytes` of a base64 data URL payload. */
function headBytes(dataUrl: string, maxBytes: number): Uint8Array {
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return new Uint8Array(0);
    // 4 base64 chars = 3 bytes; keep the slice a multiple of 4.
    const chars = Math.min(dataUrl.length - comma - 1, Math.ceil(maxBytes / 3) * 4);
    try {
        const bin = atob(dataUrl.slice(comma + 1, comma + 1 + chars - (chars % 4)));
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    } catch {
        return new Uint8Array(0);
    }
}

/**
 * Pixel size of a PNG or JPEG data URL, read from its header without decoding
 * the image; for a pooled image's reference, the size the image catalog knows.
 * Returns null for other formats or a header it cannot find.
 */
export function imageSizeFromDataUrl(dataUrl: string): { width: number; height: number } | null {
    if (isPoolRef(dataUrl)) {
        const size = pooledImageSize(dataUrl);
        return size && size.w && size.h ? { width: size.w, height: size.h } : null;
    }
    if (/^data:image\/png;/i.test(dataUrl)) {
        const b = headBytes(dataUrl, 32);
        if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50) return null;
        const width = (b[16] << 24 | b[17] << 16 | b[18] << 8 | b[19]) >>> 0;
        const height = (b[20] << 24 | b[21] << 16 | b[22] << 8 | b[23]) >>> 0;
        return width && height ? { width, height } : null;
    }
    if (/^data:image\/jpeg;/i.test(dataUrl)) {
        // Walk the segments to the first SOFn frame header. An EXIF block with
        // a thumbnail comes first, so read generously.
        const b = headBytes(dataUrl, 256 * 1024);
        if (b.length < 4 || b[0] !== 0xFF || b[1] !== 0xD8) return null;
        let i = 2;
        while (i + 9 < b.length) {
            if (b[i] !== 0xFF) { i++; continue; }
            const marker = b[i + 1];
            if (marker === 0xFF) { i++; continue; }
            if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
            const len = b[i + 2] << 8 | b[i + 3];
            const isSof = marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;
            if (isSof) {
                const height = b[i + 5] << 8 | b[i + 6];
                const width = b[i + 7] << 8 | b[i + 8];
                return width && height ? { width, height } : null;
            }
            i += 2 + len;
        }
    }
    return null;
}

/**
 * Build an excerpt from an image data URL (imported or freshly cropped).
 * Returns null when the payload is not an allowed raster image.
 */
export function excerptFromDataUrl(
    dataUrl: string,
    extra: Partial<Pick<SourceExcerpt, 'caption' | 'pageUrl' | 'fromAttachmentId' | 'region' | 'width' | 'height' | 'clip' | 'originalSha' | 'orient'>> = {},
): SourceExcerpt | null {
    if (!isSafeExcerptDataUrl(dataUrl)) return null;
    const size = extra.width && extra.height
        ? { width: extra.width, height: extra.height }
        : imageSizeFromDataUrl(dataUrl) ?? { width: 0, height: 0 };
    const exc: SourceExcerpt = {
        id: generateExcerptId(),
        dataUrl,
        width: size.width,
        height: size.height,
        sizeBytes: dataUrlByteSize(dataUrl),
    };
    if (extra.caption) exc.caption = extra.caption;
    if (extra.pageUrl) exc.pageUrl = extra.pageUrl;
    if (extra.fromAttachmentId) exc.fromAttachmentId = extra.fromAttachmentId;
    if (extra.region) exc.region = extra.region;
    if (extra.clip) exc.clip = extra.clip;
    if (extra.originalSha) exc.originalSha = extra.originalSha;
    if (extra.orient && extra.orient >= 2 && extra.orient <= 8) {
        exc.orient = extra.orient;
        // Orientations 5–8 turn the image a quarter: its shown size is the stored one crossed.
        if (extra.orient >= 5 && !(extra.width && extra.height)) {
            [exc.width, exc.height] = [exc.height, exc.width];
        }
    }
    return exc;
}

/**
 * A JPEG data URL with an EXIF block saying `orientation`, so the browser
 * shows it turned (every <img> and canvas applies EXIF orientation). Used for
 * a research crop that lies as its original is stored (SourceExcerpt.orient).
 * A JPEG that already has an EXIF block, or another format, comes back as is.
 */
export function withExifOrientation(dataUrl: string, orientation: number): string {
    if (orientation < 2 || orientation > 8 || !/^data:image\/jpeg;base64,/i.test(dataUrl)) return dataUrl;
    const comma = dataUrl.indexOf(',');
    let bin: string;
    try { bin = atob(dataUrl.slice(comma + 1)); } catch { return dataUrl; }
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const turned = jpegWithOrientation(bytes, orientation);
    if (!turned) return dataUrl;
    let out = '';
    for (let i = 0; i < turned.length; i += 0x8000) out += String.fromCharCode(...turned.subarray(i, i + 0x8000));
    return `${dataUrl.slice(0, comma + 1)}${btoa(out)}`;
}

/** Turned crops already built, by orientation and image (a crop renders in many places). */
const turnedCache = new Map<string, string>();

/**
 * The URL to show an excerpt by: upright when it is a research crop lying as
 * stored. A pooled image's reference gives an address of the pool's (the
 * reference, turned ones with their orientation: image-ref.ts turnedPoolRef),
 * which the places show through image-src.ts and the viewer.
 */
export function excerptImageUrl(exc: Pick<SourceExcerpt, 'dataUrl' | 'orient'>): string {
    if (isPoolRef(exc.dataUrl)) return turnedPoolRef(exc.dataUrl, exc.orient);
    if (!exc.orient || exc.orient < 2) return exc.dataUrl;
    const key = `${exc.orient}:${exc.dataUrl.length}:${exc.dataUrl.slice(-48)}`;
    let url = turnedCache.get(key);
    if (url === undefined) {
        url = withExifOrientation(exc.dataUrl, exc.orient);
        if (turnedCache.size > 64) turnedCache.clear();
        turnedCache.set(key, url);
    }
    return url;
}
