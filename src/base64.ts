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
