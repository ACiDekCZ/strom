/**
 * Bytes already known for data URLs this tab built itself from them: images
 * the research bridge sent, checked against their hash
 * (research-image-refs.ts). Storing such a tree in the image pool
 * (media-pool.ts) takes these bytes instead of decoding the text again.
 */

/**
 * Kept only until that store, for a short while, and up to a bound: a
 * dropped entry only costs the decoding.
 */
const knownBytes = new Map<string, Uint8Array>();
/**
 * Remembered but not yet in the map: a Map key hashes its whole text (200 MB
 * for a large tree's photos), which the bridge's load would wait for. Moved
 * into the map at the first store, which hashes those texts anyway.
 */
let pending: [string, Uint8Array][] = [];
let knownBytesTotal = 0;
let knownBytesTimer: ReturnType<typeof setTimeout> | null = null;
/** Most bytes kept at once (a large tree's photos; the rest is decoded when stored). */
export const KNOWN_BYTES_MAX = 256 * 1024 * 1024;
/** Kept this long after the last one came (ms): a tree is stored right after it loads. */
const KNOWN_BYTES_MS = 60_000;

/**
 * Remember the bytes of `url`, a canonical base64 data URL made from exactly
 * these bytes (`head + bytesToBase64(bytes)`), for the next store.
 */
export function rememberImageBytes(url: string, bytes: Uint8Array): void {
    if (knownBytesTotal + bytes.byteLength > KNOWN_BYTES_MAX) return;
    pending.push([url, bytes]);
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
    for (const [url, bytes] of pending) {
        // The same image twice: one copy counts.
        if (knownBytes.has(url)) knownBytesTotal -= bytes.byteLength;
        else knownBytes.set(url, bytes);
    }
    pending = [];
}

/** How many images' bytes are remembered (tests). */
export function rememberedImageCount(): number {
    settle();
    return knownBytes.size;
}

/** The remembered bytes of `url`, once (null when none). */
export function takeImageBytes(url: string): Uint8Array | null {
    settle();
    const bytes = knownBytes.get(url);
    if (!bytes) return null;
    knownBytes.delete(url);
    knownBytesTotal -= bytes.byteLength;
    return bytes;
}
