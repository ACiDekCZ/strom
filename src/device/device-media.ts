/**
 * A file of a batch sent from a device of the home network (spec 094 P3 §5):
 * PUT /device/media/<sha256> at the gateway, outside the tunnel, its body
 * sealed block by block (media-blocks.ts, the research's U9c) — in the blob
 * worker of the build (`__MEDIA_SEAL_WORKER__`), else on the page with a
 * pause after each block. Sent only when the gateway announces `media.put` in
 * `status.device.actions` (the research turns a tunnelled `PUT media/<sha>`
 * down as computer-only).
 *
 * The request's open headers say only what the gateway needs to route it:
 * the device, its time and nonce base, the tree, the file's size and From
 * (the blocks the gateway has). The file's name, path, batch and person are
 * in the meta block. The answer is the bridge's own, sealed as a tunnel's (its
 * nonce: the request's nonce base), given back as a `Response`; the gateway's
 * own answers inside the seal (how far it came, From not what it has, busy
 * with another file, a block that did not open, the hash) are acted on here.
 */

import { MEDIA_BLOCK, b64url, newNonce, openResponse, responseBody } from './device-crypto';
import { chosenTreeId, forgetPairing, loadPairing } from './device-store';
import { GatewayError, evenGatewayClock, gatewayAppVersion, gatewaySleep, gatewayTime, gatewayUrl, reportGatewayOutcome, tunnel } from './gateway-client';
import { mediaBlockCount, mediaBlockRange, mediaMetaBlock, mediaMetaHeaders, sealDataBlock, sealMediaMeta, type MediaSealJob } from './media-blocks';

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
    for (let i = job.from + 1; i <= mediaBlockCount(job.size); i++) {
        const [a, b] = mediaBlockRange(job.size, i);
        parts.push(sealDataBlock(job, i, new Uint8Array(await blob.slice(a, b).arrayBuffer())));
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

/** Files of this page sent in part (cut off, the bridge away or busy): their state is asked before they go on. */
const begun = new Set<string>();

/** How long to wait for another file of this device (429 device.busy) before the batch pauses: about 2 minutes. */
const BUSY_WAITS = 24;
/** How many times a request goes on from what the gateway has before the batch pauses (no progress made). */
const GO_ONS = 6;

/** Tests: forget the files sent in part. */
export function forgetBegunMedia(): void {
    begun.clear();
}

function numberOf(v: unknown): number | undefined {
    const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,9}$/.test(v) ? Number(v) : NaN;
    return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}

/**
 * What the gateway has of a file (`GET device/media/<sha>` through the
 * tunnel, `{sha, size, have}`): the data blocks it keeps, 0 for none or for
 * a gateway that does not say (or keeps it for another size).
 */
export async function deviceMediaHave(sha: string, size: number, tree: string): Promise<number> {
    const a = await tunnel({ m: 'GET', p: `device/media/${sha}`, tree });
    if (a.s !== 200 || !a.body) return 0;
    let r: Record<string, unknown> | null = null;
    try { r = JSON.parse(new TextDecoder().decode(a.body)) as Record<string, unknown>; } catch { return 0; }
    const have = numberOf(r?.have);
    if (have === undefined || have > mediaBlockCount(size)) return 0;
    if (have > 0 && numberOf(r?.size) !== size) return 0;
    return have;
}

/** The gateway's wait of 429 device.busy (Retry-After of the sealed answer, else 5 s). */
function busyWaitMs(h: Record<string, string>): number {
    const raw = h['Retry-After'] ?? h['retry-after'];
    const s = Number(raw);
    return Math.min(30_000, Number.isFinite(s) && s >= 0 ? s * 1000 : 5000);
}

/**
 * One file of a batch by PUT /device/media/<sha>: `headers` are the bridge's
 * headers of the file (as the computer's `PUT media/<sha>` sends them; only
 * those the gateway takes go into the meta block); the answer the bridge's.
 *
 * A file sent in part before is asked for first and goes on from the blocks
 * the gateway has (all of them: the meta block alone, From = N). Inside the
 * seal: 200 `{have}` short of the last block and `409 media.from` go on from
 * `have`, `400 device.bad {have}` too (a block cut on the way), `429
 * device.busy` waits its Retry-After (one file of a device at a time), `409
 * media.hash` sends the file once more from the start. A refusal of the
 * gateway itself (outside the seal), no answer, a time-out or `502
 * bridge.down` throw GatewayError (the file waits; the batch pauses); 409
 * device.clock evens the clock out, asks what the gateway has and sends it
 * once more, 401
 * device.unpaired forgets the pairing (the queue stays). A file of 0 B is
 * never sent (the gateway takes a size of 1 at least): `media.empty`.
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
    const size = opts.file.size;
    if (size < 1) throw new GatewayError('media.empty', 0);
    const pairing = await loadPairing();
    if (!pairing) throw new GatewayError('device.unpaired', 0);
    const tree = opts.tree ?? chosenTreeId(pairing) ?? '';
    const meta = mediaMetaBlock(mediaMetaHeaders(opts.headers));
    if (!meta) throw new GatewayError('device.bad', 0);
    const app = gatewayAppVersion();
    const blocks = mediaBlockCount(size);
    const mark = `${pairing.deviceId}|${tree}|${opts.sha}`;
    const fail = (err: GatewayError): never => {
        reportGatewayOutcome({ ok: false, error: err });
        throw err;
    };
    let from = 0;
    if (begun.has(mark)) {
        try {
            from = await deviceMediaHave(opts.sha, size, tree);
        } catch (e) {
            throw e instanceof GatewayError ? e : new GatewayError('network', 0);
        }
    }
    let clockTried = false;
    let hashTried = false;
    let busy = 0;
    let goOns = 0;
    for (;;) {
        if (opts.signal?.aborted) fail(new GatewayError('timeout', 0));
        const nonce = newNonce();
        const job: MediaSealJob = { key: pairing.key, deviceId: pairing.deviceId, t: gatewayTime(), nonce, sha: opts.sha, meta, size, from };
        const base = Math.min(size, from * MEDIA_BLOCK);
        const rest = size - base;
        // Sealing is the first tenth of what is left, the upload the rest.
        const parts = await sealBody(job, opts.file, done => opts.onProgress?.(Math.round(base + (done - base) * 0.1)));
        const body = new Blob(parts as BlobPart[], { type: 'application/octet-stream' });
        const n = b64url(nonce);
        const headers: Record<string, string> = {
            'Content-Type': 'application/octet-stream',
            'X-Strom-Device': pairing.deviceId,
            'X-Strom-Time': String(job.t),
            'X-Strom-Nonce': n,
            'X-Strom-Tree': tree,
            'X-Strom-Size': String(size),
            'X-Strom-From': String(from),
            ...(app ? { 'X-Strom-App-Version': app } : {}),
        };
        let r: MediaSendResult;
        try {
            r = await (sender ?? xhrSend)(gatewayUrl(`/device/media/${opts.sha}`), headers, body,
                loaded => opts.onProgress?.(Math.round(base + rest * (0.1 + 0.9 * Math.min(1, loaded / Math.max(1, body.size))))), opts.signal);
        } catch (e) {
            begun.add(mark);
            fail(e instanceof GatewayError ? e : new GatewayError('network', 0));
            throw e;
        }
        let json: unknown = undefined;
        try { json = r.text ? JSON.parse(r.text) : undefined; } catch { /* not JSON */ }
        if (r.status !== 200) {
            const rec = json && typeof json === 'object' ? json as Record<string, unknown> : {};
            const { code, ...extra } = rec;
            const err = new GatewayError(typeof code === 'string' && code ? code : `http.${r.status}`, r.status, extra);
            if (err.code === 'device.clock' && !clockTried && typeof extra.now === 'number') {
                clockTried = true;
                evenGatewayClock(extra.now);
                // Its nonce seen already may be the browser sending the body once more after a connection
                // cut under it: the gateway may keep blocks of the first, so it is asked before going on.
                try { from = await deviceMediaHave(opts.sha, size, tree); } catch { /* sent as it was */ }
                continue;
            }
            if (err.code === 'device.unpaired') { begun.delete(mark); await forgetPairing(); }
            fail(err);
        }
        const opened = openResponse(pairing.key, pairing.deviceId, n, json);
        const plain = opened ? await responseBody(opened) : undefined;
        if (!opened || plain === undefined) fail(new GatewayError('device.answer', 200));
        reportGatewayOutcome({ ok: true });
        const status = opened!.s >= 200 && opened!.s <= 599 ? opened!.s : 502;
        let said: Record<string, unknown> = {};
        try {
            const v = plain ? JSON.parse(new TextDecoder().decode(plain)) as unknown : null;
            if (v && typeof v === 'object' && !Array.isArray(v)) said = v as Record<string, unknown>;
        } catch { /* the bridge's own body */ }
        const have = numberOf(said.have);
        // On from what the gateway has: the request ended before the last block (200 {have}), From was not what
        // it has (409 media.from), a block was cut on the way (400 device.bad {have}). Going on without getting
        // further pauses the batch (the file is asked for when it goes again).
        const onFrom = (status === 200 && have !== undefined && numberOf(said.size) === size && have < blocks)
            || (status === 409 && said.code === 'media.from' && have !== undefined)
            || (status === 400 && said.code === 'device.bad' && have !== undefined && !said.header);
        if (onFrom) {
            begun.add(mark);
            if (++goOns > GO_ONS || have! > blocks) fail(new GatewayError(typeof said.code === 'string' ? said.code : 'media.from', status));
            from = have!;
            continue;
        }
        if (status === 429 && said.code === 'device.busy') {
            begun.add(mark);
            if (++busy > BUSY_WAITS) fail(new GatewayError('device.busy', 429));
            await gatewaySleep(busyWaitMs(opened!.h));
            continue;
        }
        if (status === 409 && said.code === 'media.hash' && !hashTried) {
            hashTried = true;
            from = 0;
            begun.delete(mark);
            continue;
        }
        if (status === 502 && said.code === 'bridge.down') {
            // The gateway keeps the file whole: it goes once the research's bridge is back (From = N).
            begun.add(mark);
            fail(new GatewayError('bridge.down', 502));
        }
        // Kept on the computer at a busy or failing bridge (5xx, 408, 429): asked for before it goes again.
        if (status >= 500 || status === 408 || status === 429) begun.add(mark);
        else begun.delete(mark);
        return new Response([101, 204, 205, 304].includes(status) ? null : (plain as BodyInit | null), { status, headers: opened!.h });
    }
}
