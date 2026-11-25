import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { b64url, deriveKey, openRequest, sealResponse, type RequestEnvelope } from '../device/device-crypto';
import { configureGateway } from '../device/gateway-client';
import { setDeviceKv, memoryKv, savePairing } from '../device/device-store';
import { installDeviceFetch, uninstallDeviceFetch, deviceBridgeRequest, deviceBridgeBase, isDeviceTunnelled } from '../device/device-bridge';
import { parseLiveBridge, parseDeviceBridge, setResearchDeviceState, researchDevicePage, setResearchDevicePage } from '../research-link';
import { storedResearchBridge } from '../research-device';

const NOW = Date.UTC(2026, 10, 24, 10, 30, 0);
const KEY = deriveKey(new Uint8Array(32).fill(7), 'pairPychavkaMlynky1');
const DEVICE = 'dv_abcdefghijklmnop';
const ORIGIN = 'http://192.168.1.20:47800';
const TREE = 'pychavkovi';

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

/** The gateway: each tunnel request opened and kept, answered `{ok:true}`. */
function gateway(asked: ReturnType<typeof openRequest>[]): typeof fetch {
    return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
        expect(String(input)).toBe('/device/x');
        const env = JSON.parse(String(init.body)) as RequestEnvelope;
        const req = openRequest(KEY, env);
        asked.push(req);
        const body = sealResponse(KEY, DEVICE, env.n, { s: 200, h: { 'Content-Type': 'application/json' }, b: b64url(new TextEncoder().encode('{"ok":true}')) });
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
}

function device(): void {
    setResearchDeviceState({ origin: ORIGIN, trees: [TREE], computer: 'Pracovna', actions: [] });
}

beforeEach(async () => {
    vi.stubGlobal('localStorage', fakeLocalStorage());
    setDeviceKv(memoryKv());
    configureGateway(null);
    configureGateway({ now: () => NOW, sleep: async () => undefined, appVersion: '3.33.0' });
    await savePairing({
        deviceId: DEVICE, key: KEY, name: 'Notebook · Firefox', kind: 'computer',
        computer: { name: 'Pracovna.local', label: 'Pracovna' }, trees: [{ id: TREE, name: 'Pýchavkovi z Mlýnků' }],
        origin: ORIGIN, pairedAt: new Date(NOW).toISOString(),
    });
});
afterEach(() => {
    uninstallDeviceFetch();
    setResearchDeviceState(null);
    setResearchDevicePage(false);
    vi.unstubAllGlobals();
    setDeviceKv(null);
    configureGateway(null);
});

describe('the bridge of a device of the home network (spec 094 P3)', () => {
    it('knows a device base only in the device mode and at the device\'s own origin', () => {
        const base = deviceBridgeBase(TREE, ORIGIN);
        expect(base).toBe(`${ORIGIN}/__device/pychavkovi`);
        // Outside the device mode: no such bridge (only 127.0.0.1 as always).
        expect(parseDeviceBridge(`${base}/status`)).toBeNull();
        expect(parseLiveBridge(base)).toBeNull();
        expect(parseLiveBridge('http://127.0.0.1:47123/tok')?.status).toBe('http://127.0.0.1:47123/tok/status');
        device();
        expect(parseDeviceBridge(`${base}/media/abc?thumb=1`)).toEqual({ treeId: TREE, base, path: 'media/abc?thumb=1' });
        expect(parseLiveBridge(base)?.events).toBe(`${base}/events`);
        // Another origin, another path: not one.
        expect(parseDeviceBridge('http://192.168.1.99:47800/__device/pychavkovi/status')).toBeNull();
        expect(parseDeviceBridge(`${ORIGIN}/device/x`)).toBeNull();
        expect(researchDevicePage()).toBe(true);
    });

    it('says which requests go through the sealed tunnel: a device base with the interceptor in place, nothing else', () => {
        const images = `${deviceBridgeBase(TREE, ORIGIN)}/images`;
        expect(isDeviceTunnelled(images)).toBe(false);
        device();
        expect(isDeviceTunnelled(images)).toBe(false);
        vi.stubGlobal('fetch', vi.fn(async () => new Response('page')));
        installDeviceFetch();
        expect(isDeviceTunnelled(images)).toBe(true);
        expect(isDeviceTunnelled('http://127.0.0.1:47123/tok/images')).toBe(false);
        expect(isDeviceTunnelled('http://192.168.1.99:47800/__device/pychavkovi/images')).toBe(false);
    });

    it('leaves fetch as it is outside the device mode', async () => {
        const page = vi.fn(async () => new Response('page'));
        vi.stubGlobal('fetch', page);
        expect(deviceBridgeRequest(`${ORIGIN}/__device/pychavkovi/status`)).toBeNull();
        expect(globalThis.fetch).toBe(page);
        expect(researchDevicePage()).toBe(false);
    });

    it('asks a device base through the tunnel: the path without a token, the tree, the app\'s version; the rest as ever', async () => {
        const asked: ReturnType<typeof openRequest>[] = [];
        configureGateway({ fetch: gateway(asked) });
        const page = vi.fn(async () => new Response('page'));
        vi.stubGlobal('fetch', page);
        device();
        installDeviceFetch();
        const res = await fetch(`${deviceBridgeBase(TREE)}/status?poll=1`, { headers: { 'X-Test': '1' } });
        expect(await res.json()).toEqual({ ok: true });
        expect(asked).toHaveLength(1);
        expect(asked[0]).toMatchObject({ m: 'GET', p: 'status', tree: TREE, q: { poll: '1' } });
        expect(asked[0]?.h).toMatchObject({ 'x-test': '1', 'X-Strom-App-Version': '3.33.0' });
        await fetch(`${deviceBridgeBase(TREE)}/sync`, { method: 'POST', body: '{"a":1}' });
        expect(asked[1]).toMatchObject({ m: 'POST', p: 'sync', tree: TREE });
        // Not a device base: the page's own fetch.
        expect(await (await fetch('/manifest.json')).text()).toBe('page');
        expect(page).toHaveBeenCalledTimes(1);
        // An aborted request is not asked.
        const ctrl = new AbortController();
        ctrl.abort();
        await expect(fetch(`${deviceBridgeBase(TREE)}/status`, { signal: ctrl.signal })).rejects.toMatchObject({ name: 'AbortError' });
        expect(asked).toHaveLength(2);
    });

    it('gives a tree of the pairing its bridge through the gateway before any status said where it is', () => {
        expect(storedResearchBridge(TREE)).toBeNull();
        device();
        expect(storedResearchBridge(TREE)?.base).toBe(`${ORIGIN}/__device/pychavkovi`);
        expect(storedResearchBridge('another-tree')).toBeNull();
    });
});
