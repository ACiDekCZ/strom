/**
 * Source excerpts: crops of a register entry stored on its Source (see
 * SourceExcerpt in types.ts). Pure helpers — no DOM — so the importer and the
 * tests can use them; the canvas cropping lives in the UI.
 */

import { SourceExcerpt, generateExcerptId } from './types.js';
import { dataUrlByteSize } from './photo.js';
import { isSafeExcerptDataUrl } from './validation.js';

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
 * the image. Returns null for other formats or a header it cannot find.
 */
export function imageSizeFromDataUrl(dataUrl: string): { width: number; height: number } | null {
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
    extra: Partial<Pick<SourceExcerpt, 'caption' | 'pageUrl' | 'fromAttachmentId' | 'region' | 'width' | 'height'>> = {},
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
    return exc;
}
