/**
 * A file of a batch sent from a device of the home network (spec 094 P3 §5):
 * PUT /device/media/<sha256> at the gateway, outside the tunnel, its body
 * sealed block by block (media-blocks.ts) — in the blob worker of the build
 * (`__MEDIA_SEAL_WORKER__`), else on the page with a pause after each block.
 * Sent only when the gateway announces `media.put` in `status.device.actions`
 * (the research turns a tunnelled `PUT media/<sha>` down as computer-only).
 *
 * The request's open headers say only what the gateway needs to route it:
 * the device, its time and nonce base, the tree, the file's size, the batch
 * and the meta block's sealed length. The file's name, path, person and type
 * are in the meta block. The answer is the bridge's own, sealed as a tunnel's
 * (its nonce: the request's nonce base), given back as a `Response`.
 */

import { b64url, newNonce, openResponse, responseBody } from './device-crypto';
import { chosenTreeId, forgetPairing, loadPairing } from './device-store';
import { GatewayError, evenGatewayClock, gatewayAppVersion, gatewayTime, gatewayUrl, reportGatewayOutcome } from './gateway-client';
import { mediaBlockRanges, sealFileBlock, sealMediaMeta, type MediaSealJob } from './media-blocks';

declare const __MEDIA_SEAL_WORKER__: string | undefined;

/** The device action of the gateway that takes files of a batch (PUT /device/media). */
export const DEVICE_MEDIA_ACTION = 'media.put';

/** A request's body went out; what came back (status and the body's text). */
export interface MediaSendResult {
    status: number;
    text: string;
}

/** How a sealed body is sent (tests give their own; the default: XHR with its upload progress). */
export type MediaSender = (url: string, headers: Record<string, string>, body: Blob, onProgress?: (loaded: number) => void, signal?: AbortSignal) => Promise<MediaSendResult>;

let sender: MediaSender | null = null;
let workerOff = false;

/** Tests: another sender (null: the default again); `noWorker` seals on the page. */
export function configureDeviceMedia(opts: { sender?: MediaSender | null; noWorker?: boolean } | null): void {
    sender = opts?.sender ?? null;
    workerOff = !!opts?.noWorker;
}

function xhrSend(url: string, headers: Record<string, string>, body: Blob, onProgress?: (loaded: number) => void, signal?: AbortSignal): Promise<MediaSendResult> {
    if (typeof XMLHttpRequest === 'undefined') {
        return fetch(url, { method: 'PUT', headers, body, cache: 'no-store', signal })
            .then(async res => ({ status: res.status, text: await res.text().catch(() => '') }));
    }
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url);
        for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
        xhr.upload.onprogress = (e) => onProgress?.(e.loaded);
        xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
        xhr.onerror = () => reject(new GatewayError('network', 0));
        xhr.ontimeout = () => reject(new GatewayError('timeout', 0));
        xhr.onabort = () => reject(new GatewayError('timeout', 0));
        signal?.addEventListener('abort', () => xhr.abort(), { once: true });
        xhr.send(body);
    });
}

/** The blocks sealed on the page: a pause after each, so a large photo never freezes it. */
async function sealOnPage(job: MediaSealJob, blob: Blob, onProgress?: (done: number) => void): Promise<Uint8Array[]> {
    const parts: Uint8Array[] = [sealMediaMeta(job)];
    const ranges = mediaBlockRanges(blob.size);
    for (let i = 0; i < ranges.length; i++) {
        const [a, b] = ranges[i];
        parts.push(sealFileBlock(job, i, i === ranges.length - 1, new Uint8Array(await blob.slice(a, b).arrayBuffer())));
        onProgress?.(b);
        await new Promise(r => setTimeout(r, 0));
    }
    return parts;
}

/** The blocks sealed in the build's blob worker; rejects when it cannot start (the caller seals on the page). */
function sealInWorker(job: MediaSealJob, blob: Blob, onProgress?: (done: number) => void): Promise<Uint8Array[]> {
    return new Promise((resolve, reject) => {
        const source = typeof __MEDIA_SEAL_WORKER__ === 'string' ? __MEDIA_SEAL_WORKER__ : '';
        if (!source || workerOff || typeof Worker === 'undefined') { reject(new Error('no worker')); return; }
        let worker: Worker;
        let url = '';
        try {
            url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
            worker = new Worker(url);
        } catch (err) {
            if (url) URL.revokeObjectURL(url);
            reject(err);
            return;
        }
        const end = (): void => { worker.terminate(); URL.revokeObjectURL(url); };
        worker.onmessage = (e: MessageEvent<{ progress?: number; parts?: Uint8Array[]; error?: string }>) => {
            if (typeof e.data.progress === 'number') onProgress?.(e.data.progress);
            else if (Array.isArray(e.data.parts)) { end(); resolve(e.data.parts); }
            else { end(); reject(new Error(e.data.error ?? 'seal worker failed')); }
        };
        worker.onerror = (e) => { end(); reject(new Error(e.message || 'seal worker failed')); };
        worker.postMessage({ job, blob });
    });
}

async function sealBody(job: MediaSealJob, blob: Blob, onProgress?: (done: number) => void): Promise<Uint8Array[]> {
    try {
        return await sealInWorker(job, blob, onProgress);
    } catch {
        return sealOnPage(job, blob, onProgress);
    }
}

/** Headers kept out of the meta block: the open ones of the request itself. */
const OPEN = new Set(['x-strom-batch']);

/**
 * One file of a batch by PUT /device/media/<sha>: `headers` are the bridge's
 * headers of the file (as the computer's `PUT media/<sha>` sends them); the
 * answer the bridge's. A refusal of the gateway itself (outside the seal), no
 * answer or a time-out throw GatewayError; 409 device.clock evens the clock
 * out and sends it once more, 401 device.unpaired forgets the pairing (the
 * queue stays).
 */
export async function putDeviceMedia(opts: {
    sha: string;
    file: Blob;
    headers: Record<string, string>;
    tree?: string;
    /** Plain bytes of the file gone so far (sealing, then the upload). */
    onProgress?: (done: number) => void;
    signal?: AbortSignal;
}): Promise<Response> {
    const pairing = await loadPairing();
    if (!pairing) throw new GatewayError('device.unpaired', 0);
    const tree = opts.tree ?? chosenTreeId(pairing) ?? '';
    const meta: Record<string, string> = {};
    let batch = '';
    for (const [k, v] of Object.entries(opts.headers)) {
        if (OPEN.has(k.toLowerCase())) batch = v;
        else meta[k] = v;
    }
    const app = gatewayAppVersion();
    if (app) meta['X-Strom-App-Version'] = app;
    const metaBytes = new TextEncoder().encode(JSON.stringify({ h: meta }));
    const size = opts.file.size;
    let clockTried = false;
    for (;;) {
        const nonce = newNonce();
        const job: MediaSealJob = { key: pairing.key, deviceId: pairing.deviceId, t: gatewayTime(), nonce, sha: opts.sha, meta: metaBytes };
        // Sealing is the first tenth of the way, the upload the rest.
        const parts = await sealBody(job, opts.file, done => opts.onProgress?.(Math.round(done * 0.1)));
        const body = new Blob(parts as BlobPart[], { type: 'application/octet-stream' });
        const n = b64url(nonce);
        const headers: Record<string, string> = {
            'Content-Type': 'application/octet-stream',
            'X-Strom-Device': pairing.deviceId,
            'X-Strom-Time': String(job.t),
            'X-Strom-Nonce': n,
            'X-Strom-Tree': tree,
            'X-Strom-Size': String(size),
            'X-Strom-Meta': String(parts[0].length),
            ...(batch ? { 'X-Strom-Batch': batch } : {}),
        };
        let r: MediaSendResult;
        try {
            r = await (sender ?? xhrSend)(gatewayUrl(`/device/media/${opts.sha}`), headers, body,
                loaded => opts.onProgress?.(Math.round(size * 0.1 + Math.min(1, loaded / Math.max(1, body.size)) * size * 0.9)), opts.signal);
        } catch (e) {
            const err = e instanceof GatewayError ? e : new GatewayError('network', 0);
            reportGatewayOutcome({ ok: false, error: err });
            throw err;
        }
        let json: unknown = undefined;
        try { json = r.text ? JSON.parse(r.text) : undefined; } catch { /* not JSON */ }
        if (r.status === 200) {
            const opened = openResponse(pairing.key, pairing.deviceId, n, json);
            const plain = opened ? await responseBody(opened) : undefined;
            if (!opened || plain === undefined) {
                const err = new GatewayError('device.answer', 200);
                reportGatewayOutcome({ ok: false, error: err });
                throw err;
            }
            reportGatewayOutcome({ ok: true });
            const status = opened.s >= 200 && opened.s <= 599 ? opened.s : 502;
            return new Response([101, 204, 205, 304].includes(status) ? null : (plain as BodyInit | null), { status, headers: opened.h });
        }
        const rec = json && typeof json === 'object' ? json as Record<string, unknown> : {};
        const { code, ...extra } = rec;
        const err = new GatewayError(typeof code === 'string' && code ? code : `http.${r.status}`, r.status, extra);
        if (err.code === 'device.clock' && !clockTried && typeof extra.now === 'number') {
            clockTried = true;
            evenGatewayClock(extra.now);
            continue;
        }
        if (err.code === 'device.unpaired') await forgetPairing();
        reportGatewayOutcome({ ok: false, error: err });
        throw err;
    }
}
