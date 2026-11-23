/**
 * An EXIF orientation written into a JPEG's bytes, so the browser shows it
 * turned (every <img> and canvas applies EXIF orientation). Pure, no
 * imports: excerpts.ts uses it for a data URL, image-src.ts for a pooled
 * image's bytes (a research crop lying as its original is stored).
 */

/**
 * The JPEG's bytes with an EXIF block saying `orientation` (2–8), or null
 * when nothing is to be done: another orientation, not a JPEG, or one that
 * already has an EXIF block (it wins).
 */
export function jpegWithOrientation(bytes: Uint8Array, orientation: number): Uint8Array | null {
    if (orientation < 2 || orientation > 8) return null;
    if (bytes.length < 2 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;
    // After SOI and a JFIF APP0 when there is one; an APP1 there already wins.
    let at = 2;
    if (bytes[2] === 0xFF && bytes[3] === 0xE0) at = 4 + ((bytes[4] ?? 0) << 8 | (bytes[5] ?? 0));
    if (bytes[at] === 0xFF && bytes[at + 1] === 0xE1) return null;
    at = Math.min(at, bytes.length);
    // APP1: "Exif\0\0", a big-endian TIFF header and one IFD with the Orientation tag.
    const app1 = [
        0xFF, 0xE1, 0x00, 0x22,
        0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
        0x4D, 0x4D, 0x00, 0x2A, 0x00, 0x00, 0x00, 0x08,
        0x00, 0x01,
        0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
    ];
    const out = new Uint8Array(bytes.length + app1.length);
    out.set(bytes.subarray(0, at), 0);
    out.set(app1, at);
    out.set(bytes.subarray(at), at + app1.length);
    return out;
}
