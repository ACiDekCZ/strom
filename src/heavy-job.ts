/**
 * The page's heavy pure-JS work on a browser without WebCrypto (a device of
 * the home network opens the app over plain http: no `crypto.subtle`, and a
 * phone's browser may run it without JIT): SHA-256 of bytes and the opening
 * of a sealed answer of the research's gateway. One function for both places
 * it runs: the build's blob worker (heavy-worker.ts) and the page itself when
 * no worker starts (heavy-work.ts).
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { openResponse, responseBody } from './device/device-crypto';

export type HeavyJob =
    | { op: 'sha256'; bytes: Uint8Array }
    /** A tunnel answer (`envelope`: the gateway's JSON) opened for the request whose nonce was `nonce`. */
    | { op: 'open-answer'; key: Uint8Array; deviceId: string; nonce: string; envelope: unknown };

/** An answer of the tunnel opened: its status, headers and body; null when it does not open or its body does not unpack. */
export type OpenedAnswer = { s: number; h: Record<string, string>; body: Uint8Array | null } | null;

export type HeavyResult = { digest: ArrayBuffer } | { answer: OpenedAnswer };

/** The work of `job` done here; `transfer`: the buffers the result can hand over without a copy. */
export async function runHeavyJob(job: HeavyJob): Promise<{ result: HeavyResult; transfer: ArrayBuffer[] }> {
    if (job.op === 'sha256') {
        const digest = sha256(job.bytes).slice().buffer as ArrayBuffer;
        return { result: { digest }, transfer: [digest] };
    }
    const opened = openResponse(job.key, job.deviceId, job.nonce, job.envelope);
    const body = opened ? await responseBody(opened) : undefined;
    if (!opened || body === undefined) return { result: { answer: null }, transfer: [] };
    const transfer = body && body.byteOffset === 0 && body.byteLength === body.buffer.byteLength ? [body.buffer as ArrayBuffer] : [];
    return { result: { answer: { s: opened.s, h: opened.h, body } }, transfer };
}
