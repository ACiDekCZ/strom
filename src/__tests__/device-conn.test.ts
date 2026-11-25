import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { b64url, deriveKey, openRequest, sealResponse, type RequestEnvelope } from '../device/device-crypto';
import { configureGateway } from '../device/gateway-client';
import { setDeviceKv, memoryKv, savePairing, loadPairing, deviceQueue, queueCounts, queueEntryIsPhoto } from '../device/device-store';
import { renameThisDevice, unpairThisDevice } from '../device/device-connection';

/**
 * This device's own row on the computer (spec 094 §3, the Connection sheet):
 * rename and unpair through the tunnel, and what waits on the device counted
 * for the disconnect confirmation. Invented data only.
 */

const NOW = Date.UTC(2026, 10, 24, 10, 30, 0);
const SECRET = new Uint8Array(32).map((_, i) => i + 7);
const PAIR_ID = 'pairPychavkaMlynky2';
const KEY = deriveKey(SECRET, PAIR_ID);
const DEVICE = 'dv_qrstuvwxyzabcdef';

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

/** A gateway answering each tunnel request with `inner(request)`. */
function gateway(inner: (req: NonNullable<ReturnType<typeof openRequest>>) => { s: number; body?: unknown }): typeof fetch {
    return (async (_input: RequestInfo | URL, init: RequestInit = {}) => {
        const env = JSON.parse(String(init.body)) as RequestEnvelope;
        const req = openRequest(KEY, env)!;
        const a = inner(req);
        const bytes = a.body === undefined ? null : new TextEncoder().encode(JSON.stringify(a.body));
        const sealed = sealResponse(KEY, DEVICE, env.n, { s: a.s, h: { 'Content-Type': 'application/json' }, b: bytes ? b64url(bytes) : null });
        return new Response(JSON.stringify(sealed), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
}

async function paired(): Promise<void> {
    await savePairing({
        deviceId: DEVICE, key: KEY, name: 'iPhone · Safari', kind: 'phone',
        computer: { name: 'Pracovna.local', label: 'Pracovna' }, trees: [{ id: 'pychavkovi', name: 'Pýchavkovi z Mlýnků' }],
        origin: 'http://192.168.1.20:47800', pairedAt: new Date(NOW).toISOString(),
    });
}

beforeEach(async () => {
    vi.stubGlobal('localStorage', fakeLocalStorage());
    setDeviceKv(memoryKv());
    configureGateway(null);
    await paired();
});
afterEach(() => {
    vi.unstubAllGlobals();
    setDeviceKv(null);
    configureGateway(null);
});

describe('the Connection: this device on the computer', () => {
    it('renames this device by device/rename and keeps the name the gateway kept', async () => {
        const seen: unknown[] = [];
        configureGateway({
            now: () => NOW, sleep: async () => undefined,
            fetch: gateway((req) => {
                seen.push({ m: req.m, p: req.p, b: req.b });
                return { s: 200, body: { device: { id: DEVICE, name: 'Telefon v kuchyni', kind: 'phone' } } };
            }),
        });
        expect(await renameThisDevice('Telefon v kuchyni ')).toBe('Telefon v kuchyni');
        expect(seen).toEqual([{ m: 'POST', p: 'device/rename', b: { name: 'Telefon v kuchyni ' } }]);
        expect((await loadPairing())?.name).toBe('Telefon v kuchyni');
    });

    it('a name the gateway refuses keeps the old one', async () => {
        configureGateway({ now: () => NOW, sleep: async () => undefined, fetch: gateway(() => ({ s: 400, body: { code: 'device.name' } })) });
        await expect(renameThisDevice('x'.repeat(61))).rejects.toMatchObject({ code: 'device.name' });
        expect((await loadPairing())?.name).toBe('iPhone · Safari');
    });

    it('unpairs by device/unpair: the pairing goes, the queue stays', async () => {
        const seen: string[] = [];
        configureGateway({ now: () => NOW, sleep: async () => undefined, fetch: gateway((req) => { seen.push(req.p); return { s: 200, body: { unpaired: true } }; }) });
        await deviceQueue.put('photo-1', { kind: 'photo', name: 'svatba-1924.jpg' });
        await unpairThisDevice();
        expect(seen).toEqual(['device/unpair']);
        expect(await loadPairing()).toBeNull();
        expect(await deviceQueue.ids()).toEqual(['photo-1']);
    });

    it('a refused unpairing keeps the pairing', async () => {
        configureGateway({ now: () => NOW, sleep: async () => undefined, fetch: gateway(() => ({ s: 404, body: { code: 'device.unknown-action' } })) });
        await expect(unpairThisDevice()).rejects.toMatchObject({ code: 'device.unknown-action' });
        expect(await loadPairing()).not.toBeNull();
    });
});

describe('the Connection: what waits on the device', () => {
    it('tells photos from edits', () => {
        expect(queueEntryIsPhoto({ kind: 'photo' })).toBe(true);
        expect(queueEntryIsPhoto({ kind: 'edit', name: 'x' })).toBe(false);
        expect(queueEntryIsPhoto({ name: 'svatba.jpg' })).toBe(true);
        expect(queueEntryIsPhoto({ bytes: new Uint8Array(3) })).toBe(true);
        expect(queueEntryIsPhoto({ changes: 2 })).toBe(false);
        expect(queueEntryIsPhoto(null)).toBe(false);
    });

    it('counts the queue: photos and edits', async () => {
        expect(await queueCounts()).toEqual({ photos: 0, edits: 0 });
        await deviceQueue.put('photo-1', { kind: 'photo', name: 'a.jpg' });
        await deviceQueue.put('photo-2', { name: 'b.jpg' });
        await deviceQueue.put('edit-1', { changes: 2 });
        expect(await queueCounts()).toEqual({ photos: 2, edits: 1 });
        // a batch kept for a tree counts each of its photos
        await deviceQueue.put('batch:pychavkovi', { treeId: 'pychavkovi', name: 'Mlýnky', photos: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
        expect(await queueCounts()).toEqual({ photos: 5, edits: 1 });
    });
});
