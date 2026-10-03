/**
 * SHA-256 of a file the user adds, taken BEFORE the app shrinks it: the
 * original's identity in Strom Research (`PUT /media/<sha256>`, `_STROM_SHA`).
 *
 * WebCrypto's digest needs the whole file in memory at once, fine for a photo
 * but not for a 300 MB TIFF scan. Above SUBTLE_MAX_BYTES the file is hashed
 * piece by piece by a streaming implementation, in a worker so the page stays
 * responsive (and on the main thread with pauses when a worker cannot start).
 */

/** Files up to this size go through crypto.subtle.digest in one piece. */
export const SUBTLE_MAX_BYTES = 64 * 1024 * 1024;
/** Piece size of the streaming hash. */
const CHUNK_BYTES = 4 * 1024 * 1024;

/** A streaming SHA-256. */
export interface Sha256 {
    update(bytes: Uint8Array): void;
    /** Lowercase hex; the hash cannot be updated afterwards. */
    digestHex(): string;
}

/**
 * A streaming SHA-256 (FIPS 180-4). SELF-CONTAINED on purpose: its source text
 * is put into the worker as it is (createSha256.toString()), so it must not
 * refer to anything outside its own body.
 */
export function createSha256(): Sha256 {
    const K = new Uint32Array([
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ]);
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const W = new Uint32Array(64);
    const block = new Uint8Array(64);
    let blockLen = 0;
    let total = 0;
    let done = false;

    const compress = (b: Uint8Array, off: number): void => {
        for (let i = 0; i < 16; i++) {
            const j = off + i * 4;
            W[i] = (b[j] << 24) | (b[j + 1] << 16) | (b[j + 2] << 8) | b[j + 3];
        }
        for (let i = 16; i < 64; i++) {
            const w15 = W[i - 15], w2 = W[i - 2];
            const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
            const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
            W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
        }
        let a = H[0], bb = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
        for (let i = 0; i < 64; i++) {
            const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
            const ch = (e & f) ^ (~e & g);
            const t1 = (h + S1 + ch + K[i] + W[i]) | 0;
            const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
            const maj = (a & bb) ^ (a & c) ^ (bb & c);
            const t2 = (S0 + maj) | 0;
            h = g; g = f; f = e; e = (d + t1) | 0;
            d = c; c = bb; bb = a; a = (t1 + t2) | 0;
        }
        H[0] = (H[0] + a) | 0; H[1] = (H[1] + bb) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
        H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    };

    return {
        update(bytes: Uint8Array): void {
            if (done) throw new Error('sha256: already digested');
            total += bytes.length;
            let i = 0;
            if (blockLen > 0) {
                const take = Math.min(64 - blockLen, bytes.length);
                block.set(bytes.subarray(0, take), blockLen);
                blockLen += take;
                i = take;
                if (blockLen < 64) return;
                compress(block, 0);
                blockLen = 0;
            }
            for (; i + 64 <= bytes.length; i += 64) compress(bytes, i);
            if (i < bytes.length) {
                block.set(bytes.subarray(i), 0);
                blockLen = bytes.length - i;
            }
        },
        digestHex(): string {
            if (done) throw new Error('sha256: already digested');
            done = true;
            const bits = total * 8;
            block[blockLen++] = 0x80;
            if (blockLen > 56) {
                block.fill(0, blockLen);
                compress(block, 0);
                blockLen = 0;
            }
            block.fill(0, blockLen, 56);
            // Message length in bits, big-endian, 64 bits (high word from the float).
            const hi = Math.floor(bits / 0x100000000);
            const lo = bits >>> 0;
            block[56] = hi >>> 24; block[57] = (hi >>> 16) & 0xff; block[58] = (hi >>> 8) & 0xff; block[59] = hi & 0xff;
            block[60] = lo >>> 24; block[61] = (lo >>> 16) & 0xff; block[62] = (lo >>> 8) & 0xff; block[63] = lo & 0xff;
            compress(block, 0);
            let hex = '';
            for (let i = 0; i < 8; i++) hex += (H[i] >>> 0).toString(16).padStart(8, '0');
            return hex;
        },
    };
}

/** A SHA-256 as the app stores it (64 lowercase hex characters), or null. */
export function normalizeSha256(value: unknown): string | null {
    return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value.trim()) ? value.trim().toLowerCase() : null;
}

function toHex(buf: ArrayBuffer): string {
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Read a slice of a Blob (Blob.arrayBuffer, with a FileReader fallback for older engines). */
function readSlice(blob: Blob): Promise<ArrayBuffer> {
    if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
    });
}

/** Hash on this thread, piece by piece, yielding between pieces. */
async function hashOnThread(blob: Blob, onProgress?: (done: number) => void): Promise<string> {
    const h = createSha256();
    for (let off = 0; off < blob.size; off += CHUNK_BYTES) {
        h.update(new Uint8Array(await readSlice(blob.slice(off, off + CHUNK_BYTES))));
        onProgress?.(Math.min(off + CHUNK_BYTES, blob.size));
        await new Promise(r => setTimeout(r, 0));
    }
    return h.digestHex();
}

/** The worker's source: the streaming hash and a loop over the Blob it is given. */
function workerSource(): string {
    return `const createSha256 = ${createSha256.toString()};
self.onmessage = async (e) => {
    try {
        const blob = e.data; const h = createSha256(); const CH = ${CHUNK_BYTES};
        for (let o = 0; o < blob.size; o += CH) {
            h.update(new Uint8Array(await blob.slice(o, o + CH).arrayBuffer()));
            self.postMessage({ progress: Math.min(o + CH, blob.size) });
        }
        self.postMessage({ hex: h.digestHex() });
    } catch (err) { self.postMessage({ error: String(err) }); }
};`;
}

/** Hash in a worker; rejects when no worker can start (the caller falls back). */
function hashInWorker(blob: Blob, onProgress?: (done: number) => void): Promise<string> {
    return new Promise((resolve, reject) => {
        let worker: Worker;
        let url = '';
        try {
            url = URL.createObjectURL(new Blob([workerSource()], { type: 'text/javascript' }));
            worker = new Worker(url);
        } catch (err) {
            if (url) URL.revokeObjectURL(url);
            reject(err);
            return;
        }
        const end = (): void => { worker.terminate(); URL.revokeObjectURL(url); };
        worker.onmessage = (e: MessageEvent<{ progress?: number; hex?: string; error?: string }>) => {
            if (typeof e.data.progress === 'number') onProgress?.(e.data.progress);
            else if (typeof e.data.hex === 'string') { end(); resolve(e.data.hex); }
            else { end(); reject(new Error(e.data.error ?? 'sha256 worker failed')); }
        };
        worker.onerror = (e) => { end(); reject(new Error(e.message || 'sha256 worker failed')); };
        worker.postMessage(blob);
    });
}

/**
 * SHA-256 of a whole Blob as lowercase hex. Small files in one piece through
 * WebCrypto, large ones streamed in a worker (or on this thread when no worker
 * starts). `onProgress` gets the bytes done so far for the large ones.
 */
export async function sha256OfBlob(blob: Blob, onProgress?: (done: number) => void): Promise<string> {
    if (blob.size <= SUBTLE_MAX_BYTES && typeof crypto !== 'undefined' && crypto.subtle) {
        return toHex(await crypto.subtle.digest('SHA-256', await readSlice(blob)));
    }
    if (typeof Worker !== 'undefined') {
        try {
            return await hashInWorker(blob, onProgress);
        } catch { /* fall through to this thread */ }
    }
    return hashOnThread(blob, onProgress);
}
