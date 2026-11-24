import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import type { AddressInfo, Socket } from 'node:net';
import {
    b64url, fromB64url, deriveKey, pairProof, sealPair, openRequest, sealResponse, sealEvent, eventsAuth,
    type DeviceRequest, type RequestEnvelope, type PairAnswer,
} from '../src/device/device-crypto';

/**
 * A fake gateway of the research's devices (spec 094 P3) for the browser
 * tests: a Node http server on any port (never 47800) that serves the app's
 * build on / and /pair, and the gateway's own paths with the same cipher as
 * the app (@noble, from node_modules):
 *
 * - GET /device/hello, POST /device/pair (a code the test made: pairCode()),
 * - POST /device/x — a sealed request opened, answered by the test's handler
 *   by its path (`onTunnel`, like the fake bridge of e2e/research-bridge.ts),
 * - GET /device/events — the stream; the test sends events (sendEvent),
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
    /** Answers of the tunnel by path (`status`, `waiting/T0001`, …); absent: the default (status, 404). */
    onTunnel: (req: DeviceRequest, device: FakeDevice) => TunnelReply | undefined;
    /** Each connection closed at once without an answer. */
    unreachable: boolean;
    /** The gateway's clock offset from the real one (ms): beyond ±2 min a request gets 409 device.clock. */
    clockOffsetMs: number;
    /** A new code to pair (one at a time, 10 minutes): its pairId, secret and the QR code's address. */
    pairCode(mode?: 'app'): { pairId: string; secret: string; url: string };
    /** The next refusals outside the tunnel (taken one per request of /device/x, first first). */
    refuseNext(status: number, body: Record<string, unknown>, headers?: Record<string, string>): void;
    /** An event sent to every open stream (sealed for each). */
    sendEvent(event: unknown): void;
    /** How many event streams are open. */
    streams(): number;
    close(): Promise<void>;
}

const STATUS = {
    ok: true,
    features: ['device.gateway'],
    tree: { name: 'Pýchavkovi z Mlýnků' },
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
    const streams = new Set<{ res: ServerResponse; device: FakeDevice; n: string }>();
    const sockets = new Set<Socket>();
    const seenNonces = new Set<string>();

    const gw: FakeGateway = {
        origin: '',
        port: 0,
        requests: [],
        tunnelled: [],
        devices: [],
        trees: [{ id: 'pychavkovi', name: 'Pýchavkovi z Mlýnků', archive: false }],
        computer: { name: 'Pracovna', label: 'Pracovna' },
        onTunnel: () => undefined,
        unreachable: false,
        clockOffsetMs: 0,
        pairCode() {
            const pairId = b64url(randomBytes(16));
            const secret = new Uint8Array(randomBytes(32));
            code = { pairId, secret, expiresAt: Date.now() + 10 * 60_000 };
            return { pairId, secret: b64url(secret), url: `${gw.origin}/pair?m=app#${pairId}.${b64url(secret)}` };
        },
        refuseNext(status, body, headers) {
            refusals.push({ status, body, headers });
        },
        sendEvent(event) {
            for (const s of streams) s.res.write(`data: ${JSON.stringify(sealEvent(s.device.key, s.device.id, s.n, event))}\n\n`);
        },
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
        if (Math.abs(env.t - now) > 2 * 60_000 || seenNonces.has(env.n)) return json(res, 409, { code: 'device.clock', now });
        seenNonces.add(env.n);
        gw.tunnelled.push(r);
        let reply = gw.onTunnel(r, device);
        if (!reply) {
            if (r.p === 'status' && r.m === 'GET') reply = { s: 200, body: { ...STATUS, device: { id: device.id, name: device.name, kind: device.kind, actions: ['device.rename', 'device.unpair'] } } };
            else if (r.p === 'device' || r.p.startsWith('device/')) reply = { s: 404, body: { code: 'device.unknown-action' } };
            else reply = { s: 404, body: { code: 'not-found' } };
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

    const events = (req: IncomingMessage, res: ServerResponse, url: URL): void => {
        const q = url.searchParams;
        const device = gw.devices.find(d => d.id === q.get('d'));
        if (!device) return json(res, 401, { code: 'device.unpaired' });
        const t = Number(q.get('t'));
        const n = q.get('n') ?? '';
        if (!fromB64url(n, 12) || q.get('a') !== eventsAuth(device.key, t, n)) return json(res, 400, { code: 'device.bad' });
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(': open\n\n');
        const s = { res, device, n };
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
