import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import type { AddressInfo, Socket } from 'node:net';
import {
    b64url, fromB64url, deriveKey, pairProof, sealPair, openRequest, sealResponse, sealEvent, eventsAuth,
    sha256Hex, type DeviceRequest, type RequestEnvelope, type PairAnswer, type StreamEvent,
} from '../src/device/device-crypto';
import { openMediaBody, mediaBlockCount } from '../src/device/media-blocks';
import { MEDIA_BLOCK } from '../src/device/device-crypto';

/**
 * A fake gateway of the research's devices (spec 094 P3) for the browser
 * tests: a Node http server on any port (never 47800) that serves the app's
 * build on / and /pair, and the gateway's own paths with the same cipher as
 * the app (@noble, from node_modules):
 *
 * - GET /device/hello, POST /device/pair (a code the test made: pairCode()),
 * - POST /device/x — a sealed request opened, answered by the test's handler
 *   by its path (`onTunnel`, like the fake bridge of e2e/research-bridge.ts),
 * - GET /device/events?d&t&n&a&tree[&app] — the stream (as the research's
 *   U9b: a = HMAC(K, events|t|n|tree|app), each event `{event, data}` sealed
 *   with its order in the stream in the AAD, `: ping` a comment); the test
 *   sends events (sendEvent) and pings (ping),
 * - PUT /device/media/<sha> (094 §2.4 as the research's U9c): the open headers
 *   (Device, Time, Nonce, Tree, Size ≥ 1, From ≤ N) checked, the meta block
 *   (4112 B) opened, its headers only the allowlist (else a sealed 400
 *   device.bad {params: {header}}), From against the blocks kept (409
 *   media.from {params: {have}}), blocks From+1…N opened and kept per device
 *   and file, a body ending short (a batch, U9d) answered 200 {sha, have,
 *   size}, a nonce seen before a sealed 409 media.replay {params: {have}}
 *   (U9d; a time off stays the open 409 device.clock {now, replay: false}),
 *   the whole file's SHA-256
 *   checked (409 media.hash, nothing kept), then the bridge's answer by
 *   `onMedia` (default 200 `{id}`) — all sealed as a tunnel's with the
 *   request's nonce base; the test's `mediaSteps`, one per request: 429
 *   device.busy, blocks kept up to one and the connection closed without an
 *   answer, blocks kept up to one and the request answered as one sent again
 *   (media.replay), a hash that does not hold; `GET device/media/<sha>` through the tunnel says
 *   what is kept (`{sha, size, have}`),
 * - a tunnelled request with `z: "gzip"` unpacked before its handler sees it
 *   (as the research carries it),
 * - 409 device.clock of the tunnel and the stream with `replay` (U9d): false
 *   for a time off, true for a nonce seen before; `replayWrites` carries a
 *   write and answers it 409 device.clock {replay: true} (its answer lost),
 * - GET status says the tree asked (`tree: {id, name}`, its name from
 *   `trees`) and `device.others` (U9d),
 * - refusals the test asks for (refuseNext: 401/404/409 clock/410/503), and
 *   `unreachable` (each connection closed without an answer).
 *
 * Fictional data only (Pýchavkovi z Mlýnků, the computer "Pracovna").
 */

export interface TunnelReply {
    s: number;
    h?: Record<string, string>;
    /** A JSON value (sent as its text), or bytes. */
    body?: unknown;
}

export interface FakeMedia {
    sha: string;
    tree: string;
    /** The headers of the meta block (the file's name, path, batch, person). */
    meta: Record<string, string>;
    bytes: Buffer;
}

/** One PUT /device/media as it came: its From and the data blocks opened in it. */
export interface FakeMediaRequest {
    sha: string;
    from: number;
    blocks: number[];
    /** The open headers (lower-case). */
    headers: Record<string, string>;
}

export interface FakeDevice {
    id: string;
    key: Uint8Array;
    name: string;
    kind: string;
}

export interface FakeGateway {
    /** `http://127.0.0.1:<port>` */
    origin: string;
    port: number;
    /** Every request's method and path (with its query), in order. */
    requests: string[];
    /** Opened tunnel requests, in order. */
    tunnelled: DeviceRequest[];
    devices: FakeDevice[];
    trees: { id: string; name: string; archive: boolean }[];
    computer: { name: string; label?: string };
    /** Answers of the tunnel by path (`status`, `waiting/T0001`, …); absent: the default (status, 404). A promise: the answer held until it settles. */
    onTunnel: (req: DeviceRequest, device: FakeDevice) => TunnelReply | undefined | Promise<TunnelReply | undefined>;
    /** Files of PUT /device/media opened, in order: the open headers' batch, the meta block's headers, the bytes. */
    media: FakeMedia[];
    /** The bridge's answer to a file of PUT /device/media (absent: 200 `{id}`). */
    onMedia: (m: FakeMedia, device: FakeDevice) => TunnelReply | undefined;
    /** Every PUT /device/media whose meta block opened, in order. */
    mediaRequests: FakeMediaRequest[];
    /**
     * What the next PUTs /device/media meet, one per request (first first; none: as it should go):
     * `busy` 429 device.busy (Retry-After 1), `{cutAfter}` blocks kept up to it and the connection closed
     * without an answer, `{replayAfter}` blocks kept up to it and the request answered as one the browser sent
     * again (sealed 409 media.replay {params: {have}}), `badHash` the whole file's SHA-256 does not hold (409
     * media.hash, nothing kept).
     */
    mediaSteps: ('busy' | 'badHash' | { cutAfter: number } | { replayAfter: number } | null)[];
    /**
     * Paths of the tunnel (`device/rename`, `sync/apply`, …) whose next write (not GET) is carried to its handler
     * and then answered 409 device.clock `{now, replay: true}`: as when the browser sent it again after a cut and
     * the first one's answer was lost (U9d). Taken one per request.
     */
    replayWrites: string[];
    /** Other devices connected now, said in GET status (`device.others`, U9d). */
    others: number;
    /** Each connection closed at once without an answer. */
    unreachable: boolean;
    /** The gateway's own paths (/device/*) held without an answer (the app's request times out: connecting meanwhile). */
    stall: boolean;
    /** The gateway's clock offset from the real one (ms): beyond ±2 min a request gets 409 device.clock. */
    clockOffsetMs: number;
    /** A new code to pair (one at a time, 10 minutes): its pairId, secret and the QR code's address. */
    pairCode(mode?: 'app'): { pairId: string; secret: string; url: string };
    /** A home-screen icon's code (the same pairing, one at a time): its address `/#home.<pairId>.<secret>`. */
    homeCode(): { pairId: string; secret: string; url: string };
    /** The next refusals outside the tunnel (taken one per request of /device/x, first first). */
    refuseNext(status: number, body: Record<string, unknown>, headers?: Record<string, string>): void;
    /** An event (`{event, data}`: the bridge's event's name and data) sent to every open stream (sealed for each). */
    sendEvent(event: StreamEvent): void;
    /** `: ping` to every open stream. */
    ping(): void;
    /** The queries of the streams asked (d, t, n, a, tree, app). */
    streamQueries: URLSearchParams[];
    /** How many event streams are open. */
    streams(): number;
    close(): Promise<void>;
}

const STATUS = {
    ok: true,
    features: ['device.gateway'],
};

function readBody(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const parts: Buffer[] = [];
        req.on('data', (c: Buffer) => parts.push(c));
        req.on('end', () => resolve(Buffer.concat(parts)));
        req.on('error', reject);
    });
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
}

export async function startDeviceGateway(opts: { appPath?: string } = {}): Promise<FakeGateway> {
    const appPath = opts.appPath ?? process.env.STROM_DEVICE_APP ?? 'e2e-dist/strom.html';
    const app = readFileSync(appPath);
    let code: { pairId: string; secret: Uint8Array; expiresAt: number } | null = null;
    const used = new Set<string>();
    const refusals: { status: number; body: Record<string, unknown>; headers?: Record<string, string> }[] = [];
    const streams = new Set<{ res: ServerResponse; device: FakeDevice; n: string; seq: number }>();
    const sockets = new Set<Socket>();
    const seenNonces = new Set<string>();
    /** The blocks of files kept per device and file (`<device>|<sha>`). */
    const kept = new Map<string, { size: number; blocks: Map<number, Uint8Array> }>();

    const gw: FakeGateway = {
        origin: '',
        port: 0,
        requests: [],
        tunnelled: [],
        devices: [],
        trees: [{ id: 'pychavkovi', name: 'Pýchavkovi z Mlýnků', archive: false }],
        computer: { name: 'Pracovna', label: 'Pracovna' },
        onTunnel: () => undefined,
        media: [],
        onMedia: () => undefined,
        mediaRequests: [],
        mediaSteps: [],
        replayWrites: [],
        others: 0,
        unreachable: false,
        stall: false,
        clockOffsetMs: 0,
        pairCode() {
            const pairId = b64url(randomBytes(16));
            const secret = new Uint8Array(randomBytes(32));
            code = { pairId, secret, expiresAt: Date.now() + 10 * 60_000 };
            return { pairId, secret: b64url(secret), url: `${gw.origin}/pair?m=app#${pairId}.${b64url(secret)}` };
        },
        homeCode() {
            const pairId = b64url(randomBytes(16));
            const secret = new Uint8Array(randomBytes(32));
            code = { pairId, secret, expiresAt: Date.now() + 24 * 60 * 60_000 };
            return { pairId, secret: b64url(secret), url: `${gw.origin}/#home.${pairId}.${b64url(secret)}` };
        },
        refuseNext(status, body, headers) {
            refusals.push({ status, body, headers });
        },
        sendEvent(event) {
            for (const s of streams) s.res.write(`data: ${JSON.stringify(sealEvent(s.device.key, s.device.id, s.n, s.seq++, event))}\n\n`);
        },
        ping() {
            for (const s of streams) s.res.write(': ping\n\n');
        },
        streamQueries: [],
        streams: () => streams.size,
        close: () => new Promise<void>(resolve => {
            for (const s of streams) s.res.end();
            for (const s of sockets) s.destroy();
            server.close(() => resolve());
        }),
    };

    const pair = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        let sent: Record<string, unknown> = {};
        try { sent = JSON.parse((await readBody(req)).toString('utf8')); } catch { return json(res, 400, { code: 'device.bad' }); }
        const pairId = String(sent.pairId ?? '');
        if (used.has(pairId)) return json(res, 410, { code: 'pair.used' });
        if (!code || code.pairId !== pairId || code.expiresAt <= Date.now()) return json(res, 410, { code: 'pair.expired' });
        const key = deriveKey(code.secret, pairId);
        if (sent.proof !== pairProof(key, pairId)) return json(res, 400, { code: 'device.bad' });
        used.add(pairId);
        code = null;
        const id = `dv_${Array.from(randomBytes(16), b => 'abcdefghijklmnopqrstuvwxyz234567'[b & 31]).join('')}`;
        const device: FakeDevice = { id, key, name: typeof sent.name === 'string' && sent.name ? sent.name : id, kind: typeof sent.kind === 'string' ? sent.kind : 'phone' };
        gw.devices.push(device);
        const answer: PairAnswer = { device: { id, name: device.name, kind: device.kind }, computer: gw.computer, trees: gw.trees };
        json(res, 200, sealPair(key, pairId, answer));
    };

    const tunnel = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        const raw = await readBody(req);
        const refusal = refusals.shift();
        if (refusal) return json(res, refusal.status, refusal.body, refusal.headers);
        let env: RequestEnvelope;
        try { env = JSON.parse(raw.toString('utf8')); } catch { return json(res, 400, { code: 'device.bad' }); }
        const device = gw.devices.find(d => d.id === env.d);
        if (!device) return json(res, 401, { code: 'device.unpaired' });
        const r = openRequest(device.key, env);
        if (!r) return json(res, 400, { code: 'device.bad' });
        const now = Date.now() + gw.clockOffsetMs;
        if (Math.abs(env.t - now) > 2 * 60_000) return json(res, 409, { code: 'device.clock', now, replay: false });
        if (seenNonces.has(env.n)) return json(res, 409, { code: 'device.clock', now, replay: true });
        seenNonces.add(env.n);
        if (r.z === 'gzip' && typeof r.b64 === 'string') {
            const packed = fromB64url(r.b64);
            let plain: Buffer;
            try { plain = gunzipSync(packed ?? new Uint8Array(0)); } catch { return json(res, 200, sealResponse(device.key, device.id, env.n, { s: 400, h: { 'Content-Type': 'application/json; charset=utf-8' }, b: b64url(new TextEncoder().encode('{"code":"device.body"}')) })); }
            r.b64 = b64url(new Uint8Array(plain));
            delete r.z;
        }
        gw.tunnelled.push(r);
        let reply = await gw.onTunnel(r, device);
        const state = /^device\/media\/([0-9a-f]{64})$/.exec(r.p);
        if (!reply && state && r.m === 'GET') {
            const k = kept.get(`${device.id}|${state[1]}`);
            reply = { s: 200, body: k ? { sha: state[1], size: k.size, have: k.blocks.size } : { sha: state[1], have: 0 } };
        }
        if (!reply) {
            if (r.p === 'status' && r.m === 'GET') {
                const tree = gw.trees.find(x => x.id === r.tree);
                reply = { s: 200, body: { ...STATUS, tree: { id: r.tree, name: tree?.name ?? 'Pýchavkovi z Mlýnků' },
                    device: { id: device.id, name: device.name, kind: device.kind, actions: ['device.rename', 'device.unpair'], others: gw.others } } };
            }
            else if (r.p === 'device/rename' && r.m === 'POST') {
                // NFC, at most 60 characters, as the research keeps it
                const name = typeof (r.b as { name?: unknown } | undefined)?.name === 'string' ? ((r.b as { name: string }).name).normalize('NFC').trim() : '';
                if (!name || name.length > 60) reply = { s: 400, body: { code: 'device.name' } };
                else {
                    device.name = name;
                    reply = { s: 200, body: { device: { id: device.id, name, kind: device.kind } } };
                }
            } else if (r.p === 'device/unpair' && r.m === 'POST') {
                // the whole row goes: the next request is 401 device.unpaired
                gw.devices = gw.devices.filter(d => d.id !== device.id);
                reply = { s: 200, body: { unpaired: true } };
            }
            else if (r.p === 'device' || r.p.startsWith('device/')) reply = { s: 404, body: { code: 'device.unknown-action' } };
            else reply = { s: 404, body: { code: 'not-found' } };
        }
        // carried, its answer lost: the browser's own second request meets the nonce seen (U9d)
        const lost = r.m !== 'GET' ? gw.replayWrites.indexOf(r.p) : -1;
        if (lost >= 0) {
            gw.replayWrites.splice(lost, 1);
            return json(res, 409, { code: 'device.clock', now, replay: true });
        }
        const bytes = reply.body === undefined || reply.body === null ? null
            : reply.body instanceof Uint8Array ? reply.body
            : new TextEncoder().encode(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body));
        json(res, 200, sealResponse(device.key, device.id, env.n, {
            s: reply.s,
            h: reply.h ?? { 'Content-Type': 'application/json; charset=utf-8' },
            b: bytes ? b64url(bytes) : null,
        }));
    };

    const media = async (req: IncomingMessage, res: ServerResponse, sha: string): Promise<void> => {
        const raw = await readBody(req);
        const h = (k: string): string => String(req.headers[k.toLowerCase()] ?? '');
        const num = (v: string): number => (/^\d{1,16}$/.test(v) ? Number(v) : NaN);
        const t = num(h('X-Strom-Time'));
        const n = h('X-Strom-Nonce');
        const nonce = fromB64url(n, 12);
        const size = num(h('X-Strom-Size'));
        const from = num(h('X-Strom-From'));
        const total = mediaBlockCount(size);
        // The open headers' shape first (nothing else is open: no batch, no meta length).
        if (!nonce || !Number.isSafeInteger(t) || !h('X-Strom-Tree') || !(size >= 1) || !(from >= 0) || from > total
            || h('X-Strom-Batch') || h('X-Strom-Meta')) return json(res, 400, { code: 'device.bad' });
        const device = gw.devices.find(d => d.id === h('X-Strom-Device'));
        if (!device) return json(res, 401, { code: 'device.unpaired' });
        const opened = openMediaBody(device.key, device.id, t, nonce, sha, size, from, new Uint8Array(raw));
        if (!opened.ok && !opened.meta) return json(res, 400, { code: 'device.bad' });
        const now = Date.now() + gw.clockOffsetMs;
        if (Math.abs(t - now) > 2 * 60_000) return json(res, 409, { code: 'device.clock', now, replay: false });
        const sealed = (s: number, body: unknown, headers: Record<string, string> = {}): void => {
            const bytes = body === undefined || body === null ? null : new TextEncoder().encode(JSON.stringify(body));
            json(res, 200, sealResponse(device.key, device.id, n, {
                s, h: { 'Content-Type': 'application/json; charset=utf-8', ...headers }, b: bytes ? b64url(bytes) : null,
            }));
        };
        const id = `${device.id}|${sha}`;
        const haveNow = (): number => {
            const k = kept.get(id);
            return k && k.size === size ? k.blocks.size : 0;
        };
        // The same request again (the browser after a cut): nothing read, nothing kept, sealed (U9d).
        if (seenNonces.has(n)) return sealed(409, { code: 'media.replay', params: { have: String(haveNow()) } });
        seenNonces.add(n);
        if (!opened.ok && !('blocks' in opened)) return sealed(400, { code: 'device.bad', ...(opened.header ? { params: { header: opened.header } } : {}) });
        gw.mediaRequests.push({ sha, from, blocks: [...opened.blocks.keys()], headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)])) });
        const step = gw.mediaSteps.shift() ?? null;
        if (step === 'busy') return sealed(429, { code: 'device.busy' }, { 'Retry-After': '1' });
        const k = kept.get(id);
        const have = haveNow();
        if (from > 0 && from !== have) return sealed(409, { code: 'media.from', params: { have: String(have) } });
        const keep = from === 0 || !k ? { size, blocks: new Map<number, Uint8Array>() } : k;
        kept.set(id, keep);
        const cutAfter = step && typeof step === 'object' ? 'cutAfter' in step ? step.cutAfter : step.replayAfter : null;
        for (const [i, b] of opened.blocks) {
            if (cutAfter !== null && i > cutAfter) break;
            keep.blocks.set(i, b);
        }
        if (step && typeof step === 'object' && 'replayAfter' in step) return sealed(409, { code: 'media.replay', params: { have: String(keep.blocks.size) } });
        if (cutAfter !== null) {
            req.socket.destroy();
            return;
        }
        if (!opened.ok) return sealed(400, { code: 'device.bad', params: { have: String(keep.blocks.size) } });
        if (keep.blocks.size < total) return sealed(200, { sha, have: keep.blocks.size, size });
        const file = Buffer.alloc(size);
        for (const [i, b] of keep.blocks) file.set(b, (i - 1) * MEDIA_BLOCK);
        kept.delete(id);
        if (step === 'badHash' || sha256Hex(new Uint8Array(file)) !== sha) {
            return sealed(409, { code: 'media.hash' });
        }
        const m: FakeMedia = { sha, tree: h('X-Strom-Tree'), meta: opened.headers, bytes: file };
        const reply = gw.onMedia(m, device) ?? { s: 200, body: { id: `I${String(gw.media.length + 1).padStart(4, '0')}` } };
        if (reply.s >= 200 && reply.s < 300) gw.media.push(m);
        sealed(reply.s, reply.body, reply.h);
    };

    const events = (req: IncomingMessage, res: ServerResponse, url: URL): void => {
        const q = url.searchParams;
        gw.streamQueries.push(new URLSearchParams(q));
        const t = Number(q.get('t'));
        const n = q.get('n') ?? '';
        const tree = q.get('tree') ?? '';
        const app = q.get('app') ?? undefined;
        if (!q.get('d') || !Number.isSafeInteger(t) || !fromB64url(n, 12) || !tree) return json(res, 400, { code: 'device.bad' });
        const device = gw.devices.find(d => d.id === q.get('d'));
        if (!device) return json(res, 401, { code: 'device.unpaired' });
        if (q.get('a') !== eventsAuth(device.key, t, n, tree, app)) return json(res, 400, { code: 'device.bad' });
        const now = Date.now() + gw.clockOffsetMs;
        if (Math.abs(t - now) > 2 * 60_000 || seenNonces.has(n)) return json(res, 409, { code: 'device.clock', now, replay: seenNonces.has(n) && Math.abs(t - now) <= 2 * 60_000 });
        seenNonces.add(n);
        if (!gw.trees.some(x => x.id === tree)) return json(res, 404, { code: 'tree.unknown' });
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.flushHeaders();
        const s = { res, device, n, seq: 0 };
        streams.add(s);
        req.on('close', () => streams.delete(s));
    };

    const server: Server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://gateway');
        gw.requests.push(`${req.method} ${url.pathname}${url.search}`);
        if (gw.unreachable) {
            req.socket.destroy();
            return;
        }
        const p = url.pathname;
        if (gw.stall && p.startsWith('/device/')) return;
        if (req.method === 'GET' && (p === '/' || p === '/pair')) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
            res.end(app);
            return;
        }
        if (req.method === 'GET' && p === '/device/hello') {
            return json(res, 200, { v: 1, gateway: true, name: gw.computer.name, label: gw.computer.label, local: false, port: gw.port, app: '3.33.0' });
        }
        if (req.method === 'POST' && p === '/device/pair') { void pair(req, res); return; }
        if (req.method === 'POST' && p === '/device/x') { void tunnel(req, res); return; }
        if (req.method === 'GET' && p === '/device/events') { events(req, res, url); return; }
        const mediaPath = /^\/device\/media\/([0-9a-f]{64})$/.exec(p);
        if (req.method === 'PUT' && mediaPath) { void media(req, res, mediaPath[1]); return; }
        json(res, 404, { code: 'phone.not-found' });
    });
    server.on('connection', s => {
        sockets.add(s);
        s.on('close', () => sockets.delete(s));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    gw.port = (server.address() as AddressInfo).port;
    // never the real gateway's port (the app would take it for the gateway by its port alone)
    if (gw.port === 47800) {
        await new Promise<void>(resolve => server.close(() => resolve()));
        return startDeviceGateway(opts);
    }
    gw.origin = `http://127.0.0.1:${gw.port}`;
    return gw;
}
