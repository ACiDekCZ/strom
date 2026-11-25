import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    b64url, deriveKey, openRequest, sealResponse, sealPair, pairProof, fromB64url, sha256Hex, type RequestEnvelope,
} from '../device/device-crypto';
import { configureGateway, pair, tunnel, deviceFetch, hello, GatewayError, gatewayClockSkew, DEVICE_REPLAY, isDeviceReplay, deviceTreeRequest, DEVICE_TREE_TIMEOUT_MS, onGatewayOutcome } from '../device/gateway-client';
import {
    setDeviceKv, memoryKv, loadPairing, savePairing, hasPairingMark, deviceQueue, chooseTree, chosenTreeId, forgetPairing, saveLastView, loadLastView, proposeDevice, deviceKindOf,
    computerLabelOf, deviceTreeIdOk, deviceTreesOf,
} from '../device/device-store';
import { gzipSync, gunzipSync } from 'node:zlib';
import vectors from './fixtures/device-crypto.json';
import { getStringsForLang } from '../strings';

const NOW = Date.UTC(2026, 10, 24, 10, 30, 0);
const SECRET = new Uint8Array(32).map((_, i) => i + 1);
const PAIR_ID = 'pairPychavkaMlynky1';
const KEY = deriveKey(SECRET, PAIR_ID);
const DEVICE = 'dv_abcdefghijklmnop';

/** A tiny in-memory localStorage for node. */
function fakeLocalStorage(): Storage {
    const m = new Map<string, string>();
    return {
        get length() { return m.size; },
        clear: () => m.clear(),
        getItem: k => m.get(k) ?? null,
        key: i => [...m.keys()][i] ?? null,
        removeItem: k => { m.delete(k); },
        setItem: (k, v) => { m.set(k, String(v)); },
    };
}

type Handler = (url: string, init: RequestInit) => { status: number; body: unknown; headers?: Record<string, string> } | Promise<{ status: number; body: unknown; headers?: Record<string, string> }>;

function fakeFetch(handler: Handler): typeof fetch {
    return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const r = await handler(String(input), init);
        return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json', ...(r.headers ?? {}) } });
    }) as typeof fetch;
}

/** A gateway answering tunnel requests with `inner(request)`. */
function tunnelHandler(inner: (req: ReturnType<typeof openRequest>, env: RequestEnvelope) => { s: number; h?: Record<string, string>; body?: string | Uint8Array | null; gzip?: boolean }): Handler {
    return (url, init) => {
        if (!url.endsWith('/device/x')) return { status: 404, body: { code: 'phone.not-found' } };
        const env = JSON.parse(String(init.body)) as RequestEnvelope;
        const req = openRequest(KEY, env);
        if (!req) return { status: 400, body: { code: 'device.bad' } };
        const a = inner(req, env);
        let bytes: Uint8Array | null = a.body == null ? null : typeof a.body === 'string' ? new TextEncoder().encode(a.body) : a.body;
        if (bytes && a.gzip) bytes = new Uint8Array(gzipSync(bytes));
        return { status: 200, body: sealResponse(KEY, DEVICE, env.n, { s: a.s, h: a.h ?? { 'Content-Type': 'application/json' }, b: bytes ? b64url(bytes) : null, ...(a.gzip ? { z: 'gzip' as const } : {}) }) };
    };
}

async function paired(): Promise<void> {
    await savePairing({
        deviceId: DEVICE, key: KEY, name: 'iPhone · Safari', kind: 'phone',
        computer: { name: 'Pracovna.local', label: 'Pracovna' }, trees: [{ id: 'pychavkovi', name: 'Pýchavkovi z Mlýnků' }],
        origin: 'http://192.168.1.20:47800', pairedAt: new Date(NOW).toISOString(),
    });
}

beforeEach(() => {
    vi.stubGlobal('localStorage', fakeLocalStorage());
    setDeviceKv(memoryKv());
    configureGateway(null);
    configureGateway({ now: () => NOW, sleep: async () => undefined, appVersion: '3.33.0' });
});
afterEach(() => {
    vi.unstubAllGlobals();
    setDeviceKv(null);
    configureGateway(null);
});

describe('gateway client: pairing', () => {
    it('pairs with the proof of K and keeps the pairing', async () => {
        let sent: Record<string, unknown> = {};
        configureGateway({
            fetch: fakeFetch((url, init) => {
                expect(url).toBe('/device/pair');
                sent = JSON.parse(String(init.body));
                return { status: 200, body: sealPair(KEY, PAIR_ID, { device: { id: DEVICE, name: 'iPhone · Safari', kind: 'phone' }, computer: { name: 'Pracovna.local', label: 'Pracovna' }, trees: [{ id: 'pychavkovi', name: 'Pýchavkovi z Mlýnků', archive: false }] }) };
            }),
        });
        const r = await pair(PAIR_ID, b64url(SECRET), 'iPhone · Safari', 'phone');
        expect(sent).toEqual({ pairId: PAIR_ID, name: 'iPhone · Safari', kind: 'phone', proof: pairProof(KEY, PAIR_ID) });
        expect(JSON.stringify(sent)).not.toContain(b64url(SECRET));
        expect(r.device.id).toBe(DEVICE);
        expect(r.trees).toEqual([{ id: 'pychavkovi', name: 'Pýchavkovi z Mlýnků' }]);
        const p = await loadPairing();
        expect(p?.key).toEqual(KEY);
        expect(p?.computer).toEqual({ name: 'Pracovna.local', label: 'Pracovna' });
        expect(hasPairingMark()).toBe(true);
        expect(chosenTreeId(p)).toBe('pychavkovi');
    });

    it('takes a tree id as an opaque string of at most 200 characters, never a UUID check (U9d)', async () => {
        const long = 'x'.repeat(200);
        configureGateway({
            fetch: fakeFetch(() => ({ status: 200, body: sealPair(KEY, PAIR_ID, {
                device: { id: DEVICE, name: 'iPhone · Safari', kind: 'phone' },
                // a computer whose answer has its label only: shown by it
                computer: { label: 'Pracovna Mlýnky' } as unknown as { name: string },
                trees: [{ id: 'pychavkovi', name: 'Pýchavkovi z Mlýnků', archive: false }, { id: long, name: 'Dlouhý', archive: false },
                    { id: `${long}y`, name: 'Příliš dlouhý', archive: false }, { id: 'a\u0000b', name: 'Řídicí', archive: false }],
            }) })),
        });
        const r = await pair(PAIR_ID, b64url(SECRET), 'iPhone · Safari', 'phone');
        expect(r.trees.map(t => t.id)).toEqual(['pychavkovi', long]);
        expect(r.computer).toEqual({ name: '', label: 'Pracovna Mlýnky' });
        expect((await loadPairing())?.computer).toEqual({ name: '', label: 'Pracovna Mlýnky' });
        expect(deviceTreesOf([{ id: `${long}y` }, { id: '' }, { id: 7 }])).toEqual([]);
        expect(deviceTreeIdOk('3f1c2a9e-0000-4000-8000-000000000000')).toBe(true);
        expect(deviceTreeIdOk('strom 1')).toBe(true);
    });

    it('shows the computer by its label, else its name, else the app\'s word (U9d)', () => {
        expect(computerLabelOf({ name: 'pracovna.local', label: 'Pracovna' }, 'Computer')).toBe('Pracovna');
        expect(computerLabelOf({ name: 'pracovna.local', label: ' ' }, 'Computer')).toBe('pracovna.local');
        expect(computerLabelOf({ name: '' }, 'Počítač')).toBe('Počítač');
        expect(computerLabelOf(null, 'Počítač')).toBe('Počítač');
        // GET /device/hello: label to show, name for the address
        expect(computerLabelOf({ name: 'Pracovna.local', label: 'Pracovna' })).toBe('Pracovna');
    });

    it('turns a refused code into GatewayError', async () => {
        configureGateway({ fetch: fakeFetch(() => ({ status: 410, body: { code: 'pair.used' } })) });
        await expect(pair(PAIR_ID, b64url(SECRET), 'x', 'phone')).rejects.toMatchObject({ code: 'pair.used', status: 410 });
        expect(await loadPairing()).toBeNull();
    });

    it('reads the hello of a gateway, and none of another server', async () => {
        configureGateway({ fetch: fakeFetch(url => url === 'http://Pracovna.local:47800/device/hello' ? { status: 200, body: { v: 1, gateway: true, name: 'Pracovna.local', label: 'Pracovna', local: true, port: 47800, app: '3.33.0' } } : { status: 404, body: { code: 'device.disabled' } }) });
        expect((await hello('http://Pracovna.local:47800'))?.name).toBe('Pracovna.local');
        expect(await hello()).toBeNull();
    });
});

describe('gateway client: the tunnel', () => {
    beforeEach(paired);

    it('seals the request with the tree id, the version and the query; opens a gzipped answer', async () => {
        const seen: unknown[] = [];
        configureGateway({
            fetch: fakeFetch(tunnelHandler((req, env) => {
                seen.push(req);
                expect(env.t).toBe(NOW);
                return { s: 200, body: JSON.stringify({ people: 'x'.repeat(3000) }), gzip: true };
            })),
        });
        const res = await deviceFetch('/status?lang=cs');
        expect(res.status).toBe(200);
        expect((await res.json()).people).toHaveLength(3000);
        expect(seen[0]).toEqual({ m: 'GET', p: 'status', tree: 'pychavkovi', q: { lang: 'cs' }, h: { 'X-Strom-App-Version': '3.33.0' } });
    });

    it('sends a JSON text body as text and bytes base64url', async () => {
        const seen: unknown[] = [];
        configureGateway({ fetch: fakeFetch(tunnelHandler(req => { seen.push(req); return { s: 200, body: '{}' }; })) });
        await deviceFetch('waiting/T0001', { method: 'POST', body: JSON.stringify({ do: 'answer' }), headers: { 'Content-Type': 'application/json' } });
        await deviceFetch('media/known', { method: 'POST', body: new Uint8Array([1, 2, 3]) });
        expect(seen[0]).toMatchObject({ m: 'POST', p: 'waiting/T0001', b: '{"do":"answer"}', h: { 'content-type': 'application/json' } });
        expect(fromB64url((seen[1] as { b64: string }).b64)).toEqual(new Uint8Array([1, 2, 3]));
    });

    it('sends a send of the tree gzipped (z: gzip with b64) as the research\'s requestGzip vector', async () => {
        await paired();
        const V = vectors.requestGzip;
        const seen: NonNullable<ReturnType<typeof openRequest>>[] = [];
        configureGateway({ fetch: fakeFetch(tunnelHandler(req => { seen.push(req!); return { s: 200, body: '{"ok":true}' }; })) });
        await deviceFetch('sync', { method: 'POST', body: V.body, headers: V.request.h, tree: V.request.tree });
        const r = seen[0];
        expect(Object.keys(r).sort()).toEqual(Object.keys(V.request).sort());
        expect(r).toMatchObject({ m: V.request.m, p: V.request.p, tree: V.request.tree, z: 'gzip' });
        expect(r.h).toMatchObject({ 'content-type': V.request.h['Content-Type'] });
        expect(r.b).toBeUndefined();
        const unpacked = new Uint8Array(gunzipSync(fromB64url(r.b64)!));
        expect(unpacked.length).toBe(V.bodyLength);
        expect(sha256Hex(unpacked)).toBe(V.bodySha256);
        expect(fromB64url(r.b64)!.length).toBeLessThan(V.bodyLength);
        // Other writes go as before.
        await deviceFetch('waiting/T0001', { method: 'POST', body: '{"do":"answer"}' });
        expect(seen[1].z).toBeUndefined();
    });

    it('a send refused by the gateway as too large or damaged reads as the send\'s refusal in the app\'s words', () => {
        for (const lang of ['en', 'cs', 'de', 'pl'] as const) {
            const words = getStringsForLang(lang).sync.refusedCodes;
            expect(words['device.large']).toBeTruthy();
            expect(words['device.body']).toBeTruthy();
        }
    });

    it('returns an error of the bridge inside the tunnel as an answer (403 computer-only with its action)', async () => {
        configureGateway({ fetch: fakeFetch(tunnelHandler(() => ({ s: 403, body: JSON.stringify({ code: 'device.computer-only', action: 'verify' }) }))) });
        const res = await deviceFetch('verify', { method: 'POST', body: '{}' });
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ code: 'device.computer-only', action: 'verify' });
    });

    it('evens out the clock after 409 device.clock and asks once more', async () => {
        let calls = 0;
        const gatewayNow = NOW + 5 * 60_000;
        const inner = tunnelHandler((_r, env) => {
            expect(env.t).toBe(gatewayNow);
            return { s: 200, body: '{}' };
        });
        configureGateway({
            fetch: fakeFetch((url, init) => {
                calls++;
                if (calls === 1) return { status: 409, body: { code: 'device.clock', now: gatewayNow } };
                return inner(url, init);
            }),
        });
        expect((await tunnel({ p: 'status' })).s).toBe(200);
        expect(calls).toBe(2);
        expect(gatewayClockSkew()).toBe(5 * 60_000);
    });

    it('a write met with a time off (replay: false) evens the clock out and is sent once more (U9d)', async () => {
        let calls = 0;
        const gatewayNow = NOW + 4 * 60_000;
        const inner = tunnelHandler(() => ({ s: 200, body: '{}' }));
        configureGateway({
            fetch: fakeFetch((url, init) => {
                calls++;
                if (calls === 1) return { status: 409, body: { code: 'device.clock', now: gatewayNow, replay: false } };
                return inner(url, init);
            }),
        });
        expect((await tunnel({ m: 'POST', p: 'device/rename', b: { name: 'Mlýnek' } })).s).toBe(200);
        expect(calls).toBe(2);
        expect(gatewayClockSkew()).toBe(4 * 60_000);
    });

    it('a write whose nonce the gateway took already (replay: true) is never sent again: device.replay (U9d)', async () => {
        let calls = 0;
        configureGateway({ fetch: fakeFetch(() => { calls++; return { status: 409, body: { code: 'device.clock', now: NOW + 1000, replay: true } }; }) });
        const err = await tunnel({ m: 'POST', p: 'sync/apply', b: {} }).catch((e: unknown) => e);
        expect(err).toMatchObject({ code: DEVICE_REPLAY, status: 409 });
        expect(isDeviceReplay(err)).toBe(true);
        expect(calls).toBe(1);
        // its clock was right: nothing evened out
        expect(gatewayClockSkew()).toBe(0);
        // the bridge's interceptor too: an error, never a second request
        calls = 0;
        await expect(deviceFetch('device/rename', { method: 'POST', body: '{}' })).rejects.toMatchObject({ code: DEVICE_REPLAY });
        expect(calls).toBe(1);
    });

    it('a read whose nonce came again (replay: true) is asked once more, its clock left as it is (U9d)', async () => {
        let calls = 0;
        const inner = tunnelHandler(() => ({ s: 200, body: '{"ok":true}' }));
        configureGateway({
            fetch: fakeFetch((url, init) => {
                calls++;
                if (calls === 1) return { status: 409, body: { code: 'device.clock', now: NOW + 90_000, replay: true } };
                return inner(url, init);
            }),
        });
        expect((await tunnel({ p: 'status' })).s).toBe(200);
        expect(calls).toBe(2);
        expect(gatewayClockSkew()).toBe(0);
    });

    it('asks only once more after a second device.clock', async () => {
        let calls = 0;
        configureGateway({ fetch: fakeFetch(() => { calls++; return { status: 409, body: { code: 'device.clock', now: NOW + 1000 } }; }) });
        await expect(tunnel({ p: 'status' })).rejects.toMatchObject({ code: 'device.clock' });
        expect(calls).toBe(2);
    });

    it('waits Retry-After of a busy research and asks once more', async () => {
        const waits: number[] = [];
        let calls = 0;
        const inner = tunnelHandler(() => ({ s: 200, body: '{}' }));
        configureGateway({
            sleep: async ms => { waits.push(ms); },
            fetch: fakeFetch((url, init) => (++calls === 1 ? { status: 503, body: { code: 'research.busy' }, headers: { 'Retry-After': '3' } } : inner(url, init))),
        });
        expect((await tunnel({ p: 'status' })).s).toBe(200);
        expect(waits).toEqual([3000]);
    });

    it('forgets the pairing but keeps the queue on 401 device.unpaired', async () => {
        await deviceQueue.put('photo-1', { name: 'svatba.jpg' });
        await saveLastView('pychavkovi', { people: 3 });
        await chooseTree('pychavkovi');
        configureGateway({ fetch: fakeFetch(() => ({ status: 401, body: { code: 'device.unpaired' } })) });
        const err = await tunnel({ p: 'status' }).catch(e => e);
        expect(err).toBeInstanceOf(GatewayError);
        expect(err.code).toBe('device.unpaired');
        expect(await loadPairing()).toBeNull();
        expect(hasPairingMark()).toBe(false);
        expect(await loadLastView('pychavkovi')).toBeUndefined();
        expect(localStorage.getItem('strom-device-tree')).toBeNull();
        expect(await deviceQueue.ids()).toEqual(['photo-1']);
    });

    it('says 413 device.large and other refusals with their code', async () => {
        configureGateway({ fetch: fakeFetch(() => ({ status: 413, body: { code: 'device.large' } })) });
        await expect(tunnel({ p: 'sync', m: 'POST', b: 'x' })).rejects.toMatchObject({ code: 'device.large', status: 413 });
        configureGateway({ fetch: fakeFetch(() => ({ status: 404, body: { code: 'device.disabled' } })) });
        await expect(tunnel({ p: 'status' })).rejects.toMatchObject({ code: 'device.disabled', status: 404 });
    });

    it('refuses an answer sealed for another request', async () => {
        configureGateway({
            fetch: fakeFetch(() => ({ status: 200, body: sealResponse(KEY, DEVICE, 'AAAAAAAAAAAAAAAA', { s: 200, h: {}, b: null }) })),
        });
        await expect(tunnel({ p: 'status' })).rejects.toMatchObject({ code: 'device.answer' });
    });

    it('a network failure is GatewayError network, with how long it took', async () => {
        configureGateway({ fetch: (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch });
        await expect(tunnel({ p: 'status' })).rejects.toMatchObject({ code: 'network', status: 0 });
    });

    it('gives up after the timeout', async () => {
        vi.useFakeTimers();
        try {
            configureGateway({ timeoutMs: 8000, fetch: (() => new Promise(() => undefined)) as typeof fetch });
            const p = tunnel({ p: 'status' }).catch(e => e);
            await vi.advanceTimersByTimeAsync(8000);
            expect(await p).toMatchObject({ code: 'timeout' });
        } finally {
            vi.useRealTimers();
        }
    });

    it('waits for the research\'s tree and its images as long as on the computer, never the 8 s of a quick request', async () => {
        expect(deviceTreeRequest('GET', 'tree.ged')).toBe(true);
        expect(deviceTreeRequest('GET', 'images.ged')).toBe(true);
        expect(deviceTreeRequest('POST', 'images')).toBe(true);
        expect(deviceTreeRequest('GET', 'status')).toBe(false);
        expect(deviceTreeRequest('POST', 'tree.ged')).toBe(false);
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        try {
            // The tree's answer comes after 30 s (a big research, the bridge building it).
            const answer = tunnelHandler(() => ({ s: 200, h: { 'Content-Type': 'text/plain; charset=utf-8' }, body: '0 HEAD\n0 TRLR' }));
            configureGateway({
                timeoutMs: 8000,
                fetch: (async (input: RequestInfo | URL, init: RequestInit = {}) => {
                    await new Promise(r => setTimeout(r, 30_000));
                    const r = await answer(String(input), init);
                    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
                }) as typeof fetch,
            });
            const tree = deviceFetch('tree.ged?images=ref&media=app').catch(e => e);
            const status = deviceFetch('status').catch(e => e);
            await vi.advanceTimersByTimeAsync(8000);
            expect(await status).toMatchObject({ code: 'timeout' });
            await vi.advanceTimersByTimeAsync(23_000);
            const res = await tree;
            expect(res).toBeInstanceOf(Response);
            expect(await (res as Response).text()).toBe('0 HEAD\n0 TRLR');
            // Still given up at DEVICE_TREE_TIMEOUT_MS.
            configureGateway({ fetch: (() => new Promise(() => undefined)) as typeof fetch });
            const never = deviceFetch('tree.ged').catch(e => e);
            await vi.advanceTimersByTimeAsync(DEVICE_TREE_TIMEOUT_MS);
            expect(await never).toMatchObject({ code: 'timeout' });
        } finally {
            vi.useRealTimers();
        }
    });

    it('a cancel of the caller gives the request up at once, an abort and no failure of the connection', async () => {
        const outcomes: unknown[] = [];
        const off = onGatewayOutcome(o => outcomes.push(o));
        let aborted = false;
        let sent!: () => void;
        const asked = new Promise<void>(r => { sent = r; });
        configureGateway({
            fetch: ((_: RequestInfo | URL, init: RequestInit = {}) => new Promise((_r, reject) => {
                init.signal?.addEventListener('abort', () => { aborted = true; reject(new DOMException('Aborted', 'AbortError')); });
                sent();
            })) as typeof fetch,
        });
        const ctl = new AbortController();
        const p = deviceFetch('tree.ged', { signal: ctl.signal }).catch(e => e);
        await asked;
        ctl.abort();
        const err = await p;
        expect(err).toMatchObject({ name: 'AbortError' });
        expect(err).not.toBeInstanceOf(GatewayError);
        expect(aborted, 'the request to the gateway itself stopped').toBe(true);
        expect(outcomes).toEqual([]);
        off();
    });
});

describe('device store: the name a device proposes', () => {
    const ua = {
        iPhone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
        iPadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
        androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
        androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
        firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
    };
    it('names the phone, the tablet and a computer', () => {
        expect(proposeDevice({ userAgent: ua.iPhone })).toEqual({ name: 'iPhone · Safari', kind: 'phone' });
        expect(proposeDevice({ userAgent: ua.iPadDesktop, maxTouchPoints: 5 })).toEqual({ name: 'iPad · Safari', kind: 'tablet' });
        expect(proposeDevice({ userAgent: ua.iPadDesktop, maxTouchPoints: 0 })).toEqual({ name: 'Computer · Safari', kind: 'computer' });
        expect(proposeDevice({ userAgent: ua.androidPhone })).toEqual({ name: 'Android · Chrome', kind: 'phone' });
        expect(deviceKindOf({ userAgent: ua.androidTablet })).toBe('tablet');
        expect(proposeDevice({ userAgent: ua.firefoxLinux }, 'Notebook')).toEqual({ name: 'Notebook · Firefox', kind: 'computer' });
    });

    it('forgets nothing of the queue when forgetting the pairing', async () => {
        vi.stubGlobal('localStorage', fakeLocalStorage());
        setDeviceKv(memoryKv());
        await paired();
        await deviceQueue.put('edit-1', { changes: 2 });
        await forgetPairing();
        expect(await loadPairing()).toBeNull();
        expect(await deviceQueue.get('edit-1')).toEqual({ changes: 2 });
    });
});
