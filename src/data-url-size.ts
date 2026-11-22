/**
 * Sizes read from a data URL's text: its payload's byte size and the image's
 * pixel size from its header. Pure (no catalog): photo.ts's dataUrlByteSize /
 * dataUrlImageSize answer for a pooled image's reference too, through the
 * catalog (image-meta.ts), whose entries are computed with these.
 */

/** Approximate byte size of a data-URL string (base64 payload). */
export function dataUrlTextByteSize(dataUrl: string): number {
    const comma = dataUrl.indexOf(',');
    const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor(b64.length * 3 / 4) - padding);
}

/** An image's pixel size from its data URL's header (PNG, GIF, JPEG, WebP), else null. */
export function dataUrlTextImageSize(url: string): { w: number; h: number } | null {
    const comma = url.indexOf(',');
    if (comma < 0) return null;
    let bytes: Uint8Array;
    try {
        const b64 = url.slice(comma + 1, comma + 1 + 90_000).replace(/\s+/g, '');
        const bin = atob(b64.slice(0, b64.length - (b64.length % 4)));
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch {
        return null;
    }
    const b = bytes;
    const be16 = (i: number) => (b[i] << 8) | b[i + 1];
    const le16 = (i: number) => b[i] | (b[i + 1] << 8);
    const ok = (w: number, h: number) => (w > 0 && h > 0 ? { w, h } : null);
    if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
        return ok(((b[16] << 24) | (b[17] << 16) | be16(18)) >>> 0, ((b[20] << 24) | (b[21] << 16) | be16(22)) >>> 0);
    }
    if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return ok(le16(6), le16(8));
    if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
        let i = 2;
        while (i + 9 < b.length) {
            if (b[i] !== 0xff) { i++; continue; }
            const m = b[i + 1];
            if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
            if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return ok(be16(i + 7), be16(i + 5));
            i += 2 + be16(i + 2);
        }
        return null;
    }
    if (b.length > 30 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) {
        const tag = String.fromCharCode(b[12], b[13], b[14], b[15]);
        if (tag === 'VP8 ') return ok(le16(26) & 0x3fff, le16(28) & 0x3fff);
        if (tag === 'VP8L') {
            const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
            return ok((v & 0x3fff) + 1, ((v >>> 14) & 0x3fff) + 1);
        }
        if (tag === 'VP8X') return ok((b[24] | (b[25] << 8) | (b[26] << 16)) + 1, (b[27] | (b[28] << 8) | (b[29] << 16)) + 1);
    }
    return null;
}
