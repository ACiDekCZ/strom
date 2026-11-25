/**
 * Bytes already known for data URLs this tab built itself from them: images
 * the research bridge sent, checked against their hash
 * (research-image-refs.ts). Storing such a tree in the image pool
 * (media-pool.ts) takes these bytes instead of decoding the text again, and
 * their checked hash instead of hashing them again for the image's catalog
 * entry (a phone without WebCrypto hashes in JavaScript).
 */

/** An image's bytes and, when it was checked against it, their SHA-256 (lowercase hex). */
export interface KnownImage {
    bytes: Uint8Array;
    sha?: string;
}

/**
 * Kept only until that store, for a short while, and up to a bound: a
 * dropped entry only costs the decoding.
 */
const knownBytes = new Map<string, KnownImage>();
/**
 * Remembered but not yet in the map: a Map key hashes its whole text (200 MB
 * for a large tree's photos), which the bridge's load would wait for. Moved
 * into the map at the first store, which hashes those texts anyway.
 */
let pending: [string, KnownImage][] = [];
let knownBytesTotal = 0;
let knownBytesTimer: ReturnType<typeof setTimeout> | null = null;
/** Most bytes kept at once (a large tree's photos; the rest is decoded when stored). */
export const KNOWN_BYTES_MAX = 256 * 1024 * 1024;
/** Kept this long after the last one came (ms): a tree is stored right after it loads. */
const KNOWN_BYTES_MS = 60_000;

/**
 * Remember the bytes of `url`, a canonical base64 data URL made from exactly
 * these bytes (`head + bytesToBase64(bytes)`), for the next store. `sha`:
 * the SHA-256 of these very bytes, when it was just checked.
 */
export function rememberImageBytes(url: string, bytes: Uint8Array, sha?: string): void {
    if (knownBytesTotal + bytes.byteLength > KNOWN_BYTES_MAX) return;
    pending.push([url, sha ? { bytes, sha } : { bytes }]);
    knownBytesTotal += bytes.byteLength;
    if (knownBytesTimer) clearTimeout(knownBytesTimer);
    knownBytesTimer = setTimeout(forgetImageBytes, KNOWN_BYTES_MS);
}

/** Drop every remembered image's bytes. */
export function forgetImageBytes(): void {
    knownBytes.clear();
    pending = [];
    knownBytesTotal = 0;
    if (knownBytesTimer) clearTimeout(knownBytesTimer);
    knownBytesTimer = null;
}

function settle(): void {
    if (!pending.length) return;
    for (const [url, known] of pending) {
        // The same image twice: one copy counts.
        if (knownBytes.has(url)) knownBytesTotal -= known.bytes.byteLength;
        else knownBytes.set(url, known);
    }
    pending = [];
}

/** How many images' bytes are remembered (tests). */
export function rememberedImageCount(): number {
    settle();
    return knownBytes.size;
}

/** The remembered bytes of `url` (with their hash when it was checked), once (null when none). */
export function takeKnownImage(url: string): KnownImage | null {
    settle();
    const known = knownBytes.get(url);
    if (!known) return null;
    knownBytes.delete(url);
    knownBytesTotal -= known.bytes.byteLength;
    return known;
}

/** The remembered bytes of `url`, once (null when none). */
export function takeImageBytes(url: string): Uint8Array | null {
    return takeKnownImage(url)?.bytes ?? null;
}
