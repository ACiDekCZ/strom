import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDeviceConnection, retryDelayMs, EVENTS_SILENT_MS, type ConnectionDeps, type EventSourceLike, type DeviceConnection } from '../device/device-connection';
import { GatewayError } from '../device/gateway-client';
import { deriveKey, sealEvent, eventsAuth } from '../device/device-crypto';
import type { DevicePairing } from '../device/device-store';
import { parseDeviceCode, isDeviceModeCandidate, excludedFromDeviceMode } from '../device/device-mode';

const NOW = Date.UTC(2026, 10, 24, 10, 30, 0);
const KEY = deriveKey(new Uint8Array(32).fill(3), 'pairPychavkaMlynky1');
const PAIRING: DevicePairing = {
    deviceId: 'dv_abcdefghijklmnop', key: KEY, name: 'iPad · Safari', kind: 'tablet',
    computer: { name: 'Pracovna.local', label: 'Pracovna' }, trees: [{ id: 'pychavkovi', name: 'Pýchavkovi z Mlýnků' }],
    origin: 'http://192.168.1.20:47800', pairedAt: new Date(NOW).toISOString(),
};

class FakeSource implements EventSourceLike {
    onopen: ((ev: unknown) => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    closed = false;
    listeners = new Map<string, (ev: { data?: string }) => void>();
    constructor(readonly url: string) {}
    addEventListener(type: string, cb: (ev: { data?: string }) => void): void { this.listeners.set(type, cb); }
    close(): void { this.closed = true; }
}

function setup(over: Partial<ConnectionDeps> = {}) {
    const sources: FakeSource[] = [];
    let pairing: DevicePairing | null = PAIRING;
    let online = true;
    const forgotten = { n: 0 };
    const deps: ConnectionDeps = {
        now: () => Date.now(),
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: t => clearTimeout(t as ReturnType<typeof setTimeout>),
        onLine: () => online,
        loadPairing: async () => pairing,
        forgetPairing: async () => { pairing = null; forgotten.n++; },
        probe: async () => undefined,
        hello: async () => null,
        eventSource: url => { const s = new FakeSource(url); sources.push(s); return s; },
        origin: () => 'http://192.168.1.20:47800',
        hostname: () => '192.168.1.20',
        treeId: p => p.trees[0]?.id ?? null,
        gatewayTime: () => Date.now(),
        ...over,
    };
    const c = createDeviceConnection(deps);
    const states: DeviceConnection[] = [];
    c.onChange(s => states.push(s));
    return { c, sources, states, forgotten, setOnline: (v: boolean) => { online = v; }, setPairing: (p: DevicePairing | null) => { pairing = p; } };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
});
afterEach(() => {
    vi.useRealTimers();
});

describe('device connection', () => {
    it('waits 2 s, 4 s … 60 s between tries', () => {
        expect([0, 1, 2, 3, 4, 5, 6, 9].map(retryDelayMs)).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
    });

    it('is connected once the key holds, with the event stream asked by d, t, n, a and tree', async () => {
        const { c, sources } = setup();
        c.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(c.current().state).toBe('connected');
        expect(sources).toHaveLength(1);
        const q = new URL(sources[0].url, 'http://x').searchParams;
        expect(q.get('d')).toBe(PAIRING.deviceId);
        expect(q.get('t')).toBe(String(NOW));
        expect(q.get('tree')).toBe('pychavkovi');
        expect(q.get('a')).toMatch(/^[A-Za-z0-9_-]{43}$/);
        c.stop();
    });

    it('opens the events of the stream in their order and turns unpaired on the device event', async () => {
        const { c, sources, forgotten } = setup({ appVersion: () => '3.33.0' });
        const got: unknown[] = [];
        c.onEvent(e => got.push(e));
        c.start();
        await vi.advanceTimersByTimeAsync(0);
        const q = new URL(sources[0].url, 'http://x').searchParams;
        const n = q.get('n')!;
        expect(q.get('app')).toBe('3.33.0');
        expect(q.get('a')).toBe(eventsAuth(KEY, NOW, n, 'pychavkovi', '3.33.0'));
        sources[0].onopen?.({});
        const send = (seq: number, ev: { event: string; data: unknown }, stream = n) => sources[0].onmessage?.({ data: JSON.stringify(sealEvent(KEY, PAIRING.deviceId, stream, seq, ev)) });
        send(0, { event: 'sync', data: { intake: 'I0001' } });
        expect(got).toEqual([{ event: 'sync', data: { intake: 'I0001' } }]);
        // an event sealed for another stream is not taken (it still counts in the order)
        send(1, { event: 'x', data: {} }, 'other');
        expect(got).toHaveLength(1);
        // another device unpaired: an ordinary event
        send(2, { event: 'device', data: { type: 'device', what: 'unpaired', id: 'dv_another' } });
        expect(got).toHaveLength(2);
        expect(c.current().state).toBe('connected');
        send(3, { event: 'device', data: { type: 'device', what: 'unpaired', id: PAIRING.deviceId } });
        await vi.advanceTimersByTimeAsync(0);
        expect(c.current().state).toBe('unpaired');
        expect(forgotten.n).toBe(1);
        expect(sources[0].closed).toBe(true);
    });

    it('an event out of its order does not open', async () => {
        const { c, sources } = setup();
        const got: unknown[] = [];
        c.onEvent(e => got.push(e));
        c.start();
        await vi.advanceTimersByTimeAsync(0);
        const n = new URL(sources[0].url, 'http://x').searchParams.get('n')!;
        sources[0].onmessage?.({ data: JSON.stringify(sealEvent(KEY, PAIRING.deviceId, n, 1, { event: 'change', data: {} })) });
        expect(got).toEqual([]);
        c.stop();
    });

    it('without a tree chosen no stream is asked (the heartbeat)', async () => {
        let probes = 0;
        const { c, sources } = setup({ treeId: () => null, probe: async () => { probes++; } });
        c.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(sources).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(probes).toBe(2);
        c.stop();
    });

    it('a stream refused before it opens is asked again after 2 s; a third refusal leaves the heartbeat', async () => {
        let probes = 0;
        const { c, sources } = setup({ probe: async () => { probes++; } });
        c.start();
        await vi.advanceTimersByTimeAsync(0);
        sources[0].onerror?.({ status: 409, code: 'device.clock' });
        await vi.advanceTimersByTimeAsync(1999);
        expect(sources).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(sources).toHaveLength(2);
        sources[1].onerror?.({ status: 502, code: 'bridge.down' });
        await vi.advanceTimersByTimeAsync(4000);
        expect(sources).toHaveLength(3);
        sources[2].onerror?.({ status: 502, code: 'bridge.down' });
        await vi.advanceTimersByTimeAsync(0);
        expect(sources).toHaveLength(3);
        expect(c.current().state).toBe('connected');
        const before = probes;
        await vi.advanceTimersByTimeAsync(30_000);
        expect(probes).toBe(before + 1);
        c.stop();
    });

    it('a refusal at once is unreachable (refused), tried again after 2 s, 4 s', async () => {
        let fail = true;
        let probes = 0;
        const { c } = setup({ probe: async () => { probes++; if (fail) throw new GatewayError('network', 0, {}, 30); } });
        c.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(c.current()).toMatchObject({ state: 'unreachable', reason: 'refused', retryInMs: 2000 });
        await vi.advanceTimersByTimeAsync(2000);
        expect(probes).toBe(2);
        expect(c.current().retryInMs).toBe(4000);
        fail = false;
        await vi.advanceTimersByTimeAsync(4000);
        expect(c.current().state).toBe('connected');
        c.stop();
    });

    it('no answer within 8 s is unreachable (timeout)', async () => {
        const { c } = setup({ probe: async () => { throw new GatewayError('timeout', 0, {}, 8000); } });
        c.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(c.current()).toMatchObject({ state: 'unreachable', reason: 'timeout' });
        c.stop();
    });

    it('turned off on the computer is disabled; unpaired forgets the pairing', async () => {
        const off = setup({ probe: async () => { throw new GatewayError('device.disabled', 404); } });
        off.c.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(off.c.current().state).toBe('disabled');
        off.c.stop();
        const gone = setup({ probe: async () => { throw new GatewayError('device.unpaired', 401); } });
        gone.c.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(gone.c.current().state).toBe('unpaired');
        expect(gone.forgotten.n).toBe(1);
    });

    it('the stored address fails, the computer name answers: otherAddress', async () => {
        const asked: string[] = [];
        const { c } = setup({
            probe: async () => { throw new GatewayError('network', 0, {}, 20); },
            hello: async base => { asked.push(base); return { gateway: true }; },
        });
        c.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(asked).toEqual(['http://Pracovna.local:47800']);
        expect(c.current()).toMatchObject({ state: 'otherAddress', otherAddress: 'http://Pracovna.local:47800' });
        c.stop();
    });

    it('offline without a network; at once again when online', async () => {
        const { c, setOnline } = setup();
        setOnline(false);
        c.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(c.current().state).toBe('offline');
        setOnline(true);
        c.retryNow();
        await vi.advanceTimersByTimeAsync(0);
        expect(c.current().state).toBe('connected');
        c.stop();
    });

    it('a silent stream is checked again; a stream that never opened leaves the heartbeat', async () => {
        let probes = 0;
        const { c, sources } = setup({ probe: async () => { probes++; } });
        c.start();
        await vi.advanceTimersByTimeAsync(0);
        sources[0].onopen?.({});
        await vi.advanceTimersByTimeAsync(EVENTS_SILENT_MS);
        expect(probes).toBe(2);
        expect(sources).toHaveLength(2);
        // a comment ping keeps the stream alive
        sources[1].onopen?.({});
        await vi.advanceTimersByTimeAsync(EVENTS_SILENT_MS - 1000);
        sources[1].listeners.get('ping')?.({});
        await vi.advanceTimersByTimeAsync(EVENTS_SILENT_MS - 1000);
        expect(sources).toHaveLength(2);
        expect(probes).toBe(2);
        // it falls; the third fails before it opens with 404 (an older gateway): no fourth stream, the heartbeat
        sources[1].onerror?.({ status: 0 });
        await vi.advanceTimersByTimeAsync(0);
        expect(probes).toBe(3);
        expect(sources).toHaveLength(3);
        sources[2].onerror?.({ status: 404, code: 'device.unknown-action' });
        await vi.advanceTimersByTimeAsync(0);
        expect(c.current().state).toBe('connected');
        expect(sources).toHaveLength(3);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(probes).toBe(5);
        c.stop();
    });

    it('without a pairing it is unpaired', async () => {
        const { c, setPairing } = setup();
        setPairing(null);
        c.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(c.current().state).toBe('unpaired');
    });
});

describe('device mode: candidates and codes', () => {
    const SECRET = 'A'.repeat(42) + 'A';
    const loc = (over: Partial<Location>) => ({ protocol: 'http:', hostname: '192.168.1.20', port: '8080', pathname: '/', search: '', hash: '', ...over });

    it('reads the codes of the QR code, the icon and the move', () => {
        expect(parseDeviceCode('/pair', '?m=app', `#eg4vxiQhLTT5LMnine59QA.${SECRET}`)).toEqual({ kind: 'pair', id: 'eg4vxiQhLTT5LMnine59QA', secret: SECRET });
        expect(parseDeviceCode('/', '', `#home.eg4vxiQhLTT5LMnine59QA.${SECRET}`)).toMatchObject({ kind: 'home' });
        expect(parseDeviceCode('/', '', `#move.eg4vxiQhLTT5LMnine59QA.${SECRET}`)).toMatchObject({ kind: 'move' });
        // the phone's page, another path, a short secret, a deep link of the app
        expect(parseDeviceCode('/pair', '?m=page', `#eg4vxiQhLTT5LMnine59QA.${SECRET}`)).toBeNull();
        expect(parseDeviceCode('/', '?m=app', `#eg4vxiQhLTT5LMnine59QA.${SECRET}`)).toBeNull();
        expect(parseDeviceCode('/pair', '?m=app', '#eg4vxiQhLTT5LMnine59QA.short')).toBeNull();
        expect(parseDeviceCode('/', '', '#person=P0001')).toBeNull();
    });

    it('is a candidate at the gateway port, with a code or a pairing — never on file: or stromapp.info', () => {
        expect(isDeviceModeCandidate(loc({ port: '47800' }), false)).toBe(true);
        expect(isDeviceModeCandidate(loc({ pathname: '/pair', search: '?m=app', hash: `#eg4vxiQhLTT5LMnine59QA.${SECRET}` }), false)).toBe(true);
        expect(isDeviceModeCandidate(loc({}), true)).toBe(true);
        expect(isDeviceModeCandidate(loc({}), false)).toBe(false);
        expect(isDeviceModeCandidate(loc({ protocol: 'file:', hostname: '', port: '' }), true)).toBe(false);
        expect(isDeviceModeCandidate(loc({ protocol: 'https:', hostname: 'stromapp.info', port: '' }), true)).toBe(false);
        expect(excludedFromDeviceMode('http:', 'beta.stromapp.info')).toBe(true);
        expect(excludedFromDeviceMode('http:', 'pracovna.local')).toBe(false);
    });
});
