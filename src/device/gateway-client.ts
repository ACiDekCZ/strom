/**
 * The app on a device of the home network speaks with the research's gateway
 * alone (the same origin: relative paths, no CORS): GET /device/hello,
 * POST /device/pair and the sealed tunnel POST /device/x that carries a
 * request to the bridge of a tree on the computer (spec 094 P3; the research's
 * interface §2, with its answer U9a: errors outside the tunnel `{code, …}`,
 * the body of an answer always base64url bytes, `tree` the tree's id).
 *
 * `deviceFetch(path, init)` answers a synthetic `Response`, so the calls the
 * app makes to a bridge today can go through the tunnel unchanged.
 *
 * The pairing secret and K are never logged nor sent anywhere.
 */

import {
    b64url, fromB64url, deriveKey, pairProof, sealRequest, openResponse, openPair, responseBody, canGunzip, newNonce, gzip,
    type DeviceRequest,
} from './device-crypto';
import {
    loadPairing, savePairing, forgetPairing, chosenTreeId, deviceTreesOf,
    type DeviceKind, type DevicePairing, type DeviceTree,
} from './device-store';

/** A refusal of the gateway outside the tunnel (`{code, …}`), a failed connection or a broken answer. */
export class GatewayError extends Error {
    /** `device.unpaired`, `device.disabled`, `device.clock`, `pair.used`, … — or `network`, `timeout`, `device.answer`. */
    readonly code: string;
    /** The HTTP status (0: no answer at all). */
    readonly status: number;
    /** The rest of the refusal's body (e.g. `now` of device.clock). */
    readonly extra: Record<string, unknown>;
    /** How long the attempt took (ms): a refusal at once tells "not running" from "asleep, away" (§2.5). */
    readonly elapsedMs: number;

    constructor(code: string, status: number, extra: Record<string, unknown> = {}, elapsedMs = 0) {
        super(`gateway: ${code}${status ? ` (${status})` : ''}`);
        this.name = 'GatewayError';
        this.code = code;
        this.status = status;
        this.extra = extra;
        this.elapsedMs = elapsedMs;
    }
}

/** What GET /device/hello says. */
export interface GatewayHello {
    v: number;
    gateway: true;
    /** Where the computer is found (`<name>.local` when `local`), else its name. */
    name: string;
    label?: string;
    local?: boolean;
    port?: number;
    app?: string | null;
}

/** What a tunnelled request asks: the bridge's method and path (no token), the tree's id, query, headers and body. */
export interface TunnelRequest {
    m?: string;
    p: string;
    tree?: string;
    q?: Record<string, string>;
    h?: Record<string, string>;
    /** A JSON value, or text sent as its bytes. */
    b?: unknown;
    /** Binary bytes (sent base64url). */
    bytes?: Uint8Array;
    /** The body sent gzipped (`z: "gzip"` with `b64`) where the browser can: a send of the whole tree (`sync`). */
    gzip?: boolean;
}

/** A tunnelled answer: the bridge's status, headers and body bytes (gunzipped). */
export interface TunnelAnswer {
    s: number;
    h: Record<string, string>;
    body: Uint8Array | null;
}

/** An outcome of talking to the gateway, for the connection's state (device-connection.ts). */
export type GatewayOutcome =
    | { ok: true }
    | { ok: false; error: GatewayError };

/** How the client talks (tests give their own fetch and clock). */
export interface GatewayOptions {
    /** The gateway's origin ('' = this page's, relative paths). */
    base?: string;
    fetch?: typeof fetch;
    now?: () => number;
    /** Waits (Retry-After); tests skip it. */
    sleep?: (ms: number) => Promise<void>;
    /** A request without an answer by then is given up (ms). */
    timeoutMs?: number;
    /** The app's version, said to the bridge in each request. */
    appVersion?: string;
}

/** A request with no answer within this is "unreachable (asleep, away)" (§2.5). */
export const GATEWAY_TIMEOUT_MS = 8_000;
/** A refusal within this is "not running / turned off" (§2.5). */
export const REFUSED_AT_ONCE_MS = 1_000;
/** The longest Retry-After waited for one repeat of a busy research. */
const BUSY_WAIT_MAX_MS = 10_000;

let options: GatewayOptions = {};
/** The gateway's clock minus this device's (409 device.clock evens it out). */
let clockSkew = 0;
const outcomeListeners = new Set<(o: GatewayOutcome) => void>();

/** Tests and the device mode: how the client talks (merged; `null` resets). */
export function configureGateway(next: GatewayOptions | null): void {
    options = next ? { ...options, ...next } : {};
    if (!next) clockSkew = 0;
}

/** The app's version said to the bridge (the event stream's `app` too). */
export function gatewayAppVersion(): string | undefined {
    return options.appVersion;
}

/** The offset of the gateway's clock from this device's (ms). */
export function gatewayClockSkew(): number {
    return clockSkew;
}

/** Each outcome of a request to the gateway (connection state); returns the unsubscribe. */
export function onGatewayOutcome(cb: (o: GatewayOutcome) => void): () => void {
    outcomeListeners.add(cb);
    return () => outcomeListeners.delete(cb);
}

function report(o: GatewayOutcome): void {
    for (const cb of [...outcomeListeners]) {
        try { cb(o); } catch { /* a listener's failure stays its own */ }
    }
}

const nowMs = (): number => (options.now ?? Date.now)();
const fetcher = (): typeof fetch => options.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
const sleep = (ms: number): Promise<void> => (options.sleep ?? (m => new Promise(r => setTimeout(r, m))))(ms);

/** A wait of the gateway's requests (tests give their own through configureGateway). */
export function gatewaySleep(ms: number): Promise<void> {
    return sleep(ms);
}
const url = (path: string, base = options.base ?? ''): string => `${base.replace(/\/+$/, '')}${path}`;

/** The gateway's clock said by a 409 device.clock `{now}`: this device's evened out to it (PUT /device/media too). */
export function evenGatewayClock(now: number): void {
    clockSkew = now - nowMs();
}

/** An outcome of a request made outside `tunnel` (PUT /device/media): told to the connection's state as the tunnel's are. */
export function reportGatewayOutcome(o: GatewayOutcome): void {
    report(o);
}

/** The address of a path of the gateway (its origin from the options, '' = this page's). */
export function gatewayUrl(path: string): string {
    return url(path);
}

/** The device's time for a request: its clock evened out to the gateway's. */
export function gatewayTime(): number {
    return Math.round(nowMs() + clockSkew);
}

function asRecord(v: unknown): Record<string, unknown> {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** One HTTP exchange with the gateway, timed out; network failures become GatewayError. */
async function exchange(path: string, init: RequestInit, base?: string): Promise<{ status: number; json: unknown; headers: Headers; elapsed: number }> {
    const started = nowMs();
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutMs = options.timeoutMs ?? GATEWAY_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            ctrl?.abort();
            reject(new GatewayError('timeout', 0, {}, nowMs() - started));
        }, timeoutMs);
    });
    try {
        const res = await Promise.race([
            fetcher()(url(path, base), { ...init, cache: 'no-store', ...(ctrl ? { signal: ctrl.signal } : {}) }),
            timeout,
        ]);
        let json: unknown = undefined;
        try { json = await Promise.race([res.json(), timeout]); } catch (e) { if (e instanceof GatewayError) throw e; }
        return { status: res.status, json, headers: res.headers, elapsed: nowMs() - started };
    } catch (e) {
        if (e instanceof GatewayError) throw e;
        throw new GatewayError('network', 0, {}, nowMs() - started);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}

function refusal(status: number, json: unknown, elapsed: number): GatewayError {
    const { code, ...extra } = asRecord(json);
    return new GatewayError(typeof code === 'string' && code ? code : `http.${status}`, status, extra, elapsed);
}

/** GET /device/hello of this gateway (or of another address, e.g. `http://<name>:47800`): null when it is none. */
export async function hello(base?: string): Promise<GatewayHello | null> {
    try {
        const r = await exchange('/device/hello', { method: 'GET' }, base);
        const j = asRecord(r.json);
        if (r.status !== 200 || j.gateway !== true) return null;
        return j as unknown as GatewayHello;
    } catch {
        return null;
    }
}

/** What a pairing gives: this device, the computer, the trees it may open. */
export interface PairResult {
    device: { id: string; name: string; kind: DeviceKind };
    computer: { name: string; label?: string };
    trees: DeviceTree[];
}

/**
 * The device paired by the code of a QR code (or of a home / move code):
 * K derived from the secret, its proof sent, the answer opened with K and
 * the pairing kept. Refusals: 400 device.bad, 410 pair.used / pair.expired.
 */
export async function pair(pairId: string, secret: string | Uint8Array, name: string, kind: DeviceKind): Promise<PairResult> {
    const raw = typeof secret === 'string' ? fromB64url(secret, 32) : secret;
    if (!raw || raw.length !== 32) throw new GatewayError('device.bad', 0);
    const key = deriveKey(raw, pairId);
    const r = await exchange('/device/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairId, name, kind, proof: pairProof(key, pairId) }),
    });
    if (r.status !== 200) {
        const err = refusal(r.status, r.json, r.elapsed);
        report({ ok: false, error: err });
        throw err;
    }
    const a = openPair(key, pairId, r.json);
    if (!a) throw new GatewayError('device.answer', r.status);
    const deviceKind: DeviceKind = a.device.kind === 'tablet' || a.device.kind === 'computer' ? a.device.kind : 'phone';
    const result: PairResult = {
        device: { id: a.device.id, name: typeof a.device.name === 'string' ? a.device.name : name, kind: deviceKind },
        computer: { name: a.computer.name, ...(typeof a.computer.label === 'string' ? { label: a.computer.label } : {}) },
        trees: deviceTreesOf(a.trees),
    };
    const was = await loadPairing();
    const keepTree = was?.treeId && result.trees.some(t => t.id === was.treeId) ? { treeId: was.treeId } : {};
    const pairing: DevicePairing = {
        deviceId: result.device.id,
        key,
        name: result.device.name,
        kind: result.device.kind,
        computer: result.computer,
        trees: result.trees,
        ...keepTree,
        origin: typeof location !== 'undefined' ? location.origin : options.base ?? '',
        pairedAt: new Date(nowMs()).toISOString(),
    };
    await savePairing(pairing);
    report({ ok: true });
    return result;
}

/**
 * The body of a tunnelled request: JSON or text as `b`, bytes as `b64`; asked
 * gzipped (a send of the tree, U9c), its bytes gzipped in `b64` with `z:
 * "gzip"` — a GEDCOM shrinks several times. A browser without
 * CompressionStream sends it as before.
 */
async function bodyFields(req: TunnelRequest): Promise<Pick<DeviceRequest, 'b' | 'b64' | 'z'>> {
    const plain = req.bytes ?? (typeof req.b === 'string' ? new TextEncoder().encode(req.b) : undefined);
    if (req.gzip && plain) {
        const packed = await gzip(plain);
        if (packed) return { b64: b64url(packed), z: 'gzip' };
    }
    if (req.bytes) return { b64: b64url(req.bytes) };
    return req.b !== undefined && req.b !== null ? { b: req.b } : {};
}

function retryAfterMs(headers: Headers | Record<string, string>): number {
    const raw = headers instanceof Headers ? headers.get('Retry-After') : (headers['Retry-After'] ?? headers['retry-after']);
    const s = Number(raw);
    return Math.min(BUSY_WAIT_MAX_MS, Number.isFinite(s) && s >= 0 ? s * 1000 : 2000);
}

/**
 * One request carried through the tunnel to the bridge of a tree. Refusals of
 * the gateway (outside the tunnel) throw GatewayError; 409 device.clock evens
 * out the clock and asks once more, 503 research.busy waits its Retry-After
 * and asks once more; 401 device.unpaired forgets the pairing (the queue
 * stays). Errors of the bridge inside the tunnel are an ordinary answer.
 */
export async function tunnel(req: TunnelRequest): Promise<TunnelAnswer> {
    const pairing = await loadPairing();
    if (!pairing) {
        const err = new GatewayError('device.unpaired', 0);
        throw err;
    }
    const tree = req.tree ?? chosenTreeId(pairing) ?? '';
    const h: Record<string, string> = { ...(req.h ?? {}) };
    if (options.appVersion && !Object.keys(h).some(k => k.toLowerCase() === 'x-strom-app-version')) h['X-Strom-App-Version'] = options.appVersion;
    if (!canGunzip()) h['Accept-Encoding'] = 'identity';
    const inner: DeviceRequest = {
        m: (req.m ?? 'GET').toUpperCase(),
        p: req.p.replace(/^\/+/, ''),
        tree,
        ...(req.q && Object.keys(req.q).length ? { q: req.q } : {}),
        ...(Object.keys(h).length ? { h } : {}),
        ...(await bodyFields(req)),
    };
    let clockTried = false;
    let busyTried = false;
    for (;;) {
        const nonce = newNonce();
        const envelope = sealRequest(pairing.key, pairing.deviceId, gatewayTime(), inner, nonce);
        let r: Awaited<ReturnType<typeof exchange>>;
        try {
            r = await exchange('/device/x', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(envelope),
            });
        } catch (e) {
            report({ ok: false, error: e as GatewayError });
            throw e;
        }
        if (r.status === 200) {
            const opened = openResponse(pairing.key, pairing.deviceId, envelope.n, r.json);
            const body = opened ? await responseBody(opened) : undefined;
            if (!opened || body === undefined) {
                const err = new GatewayError('device.answer', 200, {}, r.elapsed);
                report({ ok: false, error: err });
                throw err;
            }
            report({ ok: true });
            return { s: opened.s, h: opened.h, body };
        }
        const err = refusal(r.status, r.json, r.elapsed);
        if (err.code === 'device.clock' && !clockTried && typeof err.extra.now === 'number') {
            clockTried = true;
            clockSkew = err.extra.now - nowMs();
            continue;
        }
        if (err.code === 'research.busy' && !busyTried) {
            busyTried = true;
            await sleep(retryAfterMs(r.headers));
            continue;
        }
        if (err.code === 'device.unpaired') await forgetPairing();
        report({ ok: false, error: err });
        throw err;
    }
}

/** Statuses a Response carries without a body. */
const NULL_BODY = new Set([101, 204, 205, 304]);

function headersRecord(h: HeadersInit | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    if (!h) return out;
    new Headers(h).forEach((v, k) => { out[k] = v; });
    return out;
}

async function bodyOf(body: BodyInit | null | undefined): Promise<{ b?: unknown; bytes?: Uint8Array }> {
    if (body === undefined || body === null) return {};
    if (typeof body === 'string') return { b: body };
    if (body instanceof Uint8Array) return { bytes: body };
    if (body instanceof ArrayBuffer) return { bytes: new Uint8Array(body) };
    if (ArrayBuffer.isView(body)) return { bytes: new Uint8Array(body.buffer, body.byteOffset, body.byteLength) };
    if (typeof Blob !== 'undefined' && body instanceof Blob) return { bytes: new Uint8Array(await body.arrayBuffer()) };
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return { b: body.toString() };
    return { bytes: new Uint8Array(await new Response(body).arrayBuffer()) };
}

/**
 * A bridge request through the tunnel as a `Response`: `path` is the bridge's
 * path without its token (`status`, `/tree.ged`, `waiting/T0001?lang=cs`).
 * `init.tree` picks a tree other than the chosen one.
 */
export async function deviceFetch(path: string, init: RequestInit & { tree?: string } = {}): Promise<Response> {
    const clean = path.replace(/^\/+/, '');
    const qAt = clean.indexOf('?');
    const p = qAt >= 0 ? clean.slice(0, qAt) : clean;
    const q: Record<string, string> = {};
    if (qAt >= 0) new URLSearchParams(clean.slice(qAt + 1)).forEach((v, k) => { q[k] = v; });
    const m = (init.method ?? 'GET').toUpperCase();
    const answer = await tunnel({
        m,
        p,
        // A send of the tree goes gzipped (413 device.large / 400 device.body come back as its refusal).
        ...(m === 'POST' && p === 'sync' ? { gzip: true } : {}),
        ...(init.tree ? { tree: init.tree } : {}),
        q,
        h: headersRecord(init.headers),
        ...(await bodyOf(init.body)),
    });
    const status = answer.s >= 200 && answer.s <= 599 ? answer.s : 502;
    const body = NULL_BODY.has(status) ? null : (answer.body as BodyInit | null);
    return new Response(body, { status, headers: answer.h });
}
