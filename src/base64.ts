/** Base64 of bytes and back: native where the browser has it, a fast fallback elsewhere. */

/** Native base64 of typed arrays (Chrome 140+, Firefox 133+, Safari 18.2+). */
type NativeBase64 = { toBase64?: () => string };
type NativeFromBase64 = { fromBase64?: (b64: string) => Uint8Array };

export function bytesToBase64(bytes: Uint8Array): string {
    const native = (bytes as unknown as NativeBase64).toBase64;
    if (typeof native === 'function') return native.call(bytes);
    // Fallback: build the binary string in large slices. The spread of a
    // 32 KB chunk per call was ~40x slower than native on 80 MB of images.
    const parts: string[] = [];
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]));
    }
    return btoa(parts.join(''));
}

export function base64ToBytes(b64: string): Uint8Array {
    const native = (Uint8Array as unknown as NativeFromBase64).fromBase64;
    if (typeof native === 'function') return native(b64);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

/**
 * The bytes of `b64` when it is canonical base64 — standard alphabet, padded
 * to whole groups of four, nothing else in it, no stray bits in the last
 * group — else null. Exactly these texts give back the same text from their
 * bytes, so storing the bytes instead of the text loses nothing.
 *
 * No pattern test over the text (on 150 MB of photos it took over a second):
 * the decoders throw on anything outside the alphabet or on padding inside
 * the text, and they skip ASCII whitespace, which leaves fewer bytes than a
 * text of this length must give.
 */
export function canonicalBase64Bytes(b64: string): Uint8Array | null {
    const n = b64.length;
    if (n === 0 || n % 4 !== 0) return null;
    const pad = b64.charCodeAt(n - 1) === 0x3D ? (b64.charCodeAt(n - 2) === 0x3D ? 2 : 1) : 0;
    let bytes: Uint8Array;
    try {
        bytes = base64ToBytes(b64);
    } catch {
        return null;
    }
    if (bytes.length !== (n / 4) * 3 - pad) return null;
    // Decoders accept stray bits in the last group; the text would not come back.
    if (bytesToBase64(bytes.subarray((n / 4 - 1) * 3)) !== b64.slice(n - 4)) return null;
    return bytes;
}
