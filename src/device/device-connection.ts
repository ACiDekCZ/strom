/**
 * The state of a device's connection to the computer with the research
 * (spec 094 P3, the research's interface §2.5):
 *
 * | what the device sees                                  | state          |
 * |-------------------------------------------------------|----------------|
 * | the event stream lives, its pings come                | connected      |
 * | (trying)                                              | connecting     |
 * | refused at once (< 1 s) / no answer within 8 s        | unreachable    |
 * | the stored address fails, `http://<name>:47800` hello | otherAddress   |
 * | `navigator.onLine === false`                          | offline        |
 * | `401 device.unpaired`, the event `unpaired`           | unpaired       |
 * | `404 device.disabled` (turned off on the computer)    | disabled       |
 *
 * Tried again after 2 s, 4 s … 60 s, and at once on `online` and when the
 * page is shown again. Unpaired forgets the pairing (its queue stays).
 */

import {
    tunnel, hello, gatewayTime, GatewayError, REFUSED_AT_ONCE_MS, GATEWAY_TIMEOUT_MS,
} from './gateway-client';
import { b64url, eventsAuth, newNonce, openEvent } from './device-crypto';
import { loadPairing, forgetPairing, chosenTreeId, type DevicePairing } from './device-store';

export type DeviceConnectionState = 'connected' | 'connecting' | 'unreachable' | 'otherAddress' | 'offline' | 'unpaired' | 'disabled';

/** Why: `refused` (at once: not running), `timeout` (asleep, away), `error` (an odd answer), `events` (the stream fell). */
export type DeviceConnectionReason = 'refused' | 'timeout' | 'error' | 'events' | null;

export interface DeviceConnection {
    state: DeviceConnectionState;
    reason: DeviceConnectionReason;
    /** When the state began (ms of the device's clock). */
    since: number;
    /** The computer's other address that answers (otherAddress): `http://<name>:47800`. */
    otherAddress?: string;
    /** The next try in ms (unreachable, otherAddress, disabled). */
    retryInMs?: number;
}

/** The waits between tries: 2 s, 4 s … 60 s. */
export function retryDelayMs(attempt: number): number {
    return Math.min(60_000, 2_000 * 2 ** Math.max(0, attempt));
}

/** The gateway's port on every computer. */
export const GATEWAY_PORT = 47800;
/** The stream's ping comes each 25 s; none for this long and the connection is checked again. */
export const EVENTS_SILENT_MS = 60_000;
/** Without the event stream (an older research): the connection checked this often while connected. */
export const HEARTBEAT_MS = 30_000;

/** A minimal EventSource (the browser's, or the tests'). */
export interface EventSourceLike {
    onopen: ((ev: unknown) => void) | null;
    onmessage: ((ev: { data: string }) => void) | null;
    onerror: ((ev: unknown) => void) | null;
    addEventListener(type: string, cb: (ev: { data?: string }) => void): void;
    close(): void;
}

/** What the connection uses (tests give their own). */
export interface ConnectionDeps {
    now: () => number;
    setTimeout: (fn: () => void, ms: number) => unknown;
    clearTimeout: (t: unknown) => void;
    onLine: () => boolean;
    loadPairing: () => Promise<DevicePairing | null>;
    forgetPairing: () => Promise<void>;
    /** A request that proves the key (any sealed answer: alive). */
    probe: () => Promise<void>;
    /** GET /device/hello of another address. */
    hello: (base: string) => Promise<unknown>;
    /** null: no EventSource (the heartbeat alone). */
    eventSource: ((url: string) => EventSourceLike) | null;
    /** This page's origin and host name. */
    origin: () => string;
    hostname: () => string;
    /** The tree the stream is asked for. */
    treeId: (p: DevicePairing) => string | null;
    /** The device's time as the gateway counts it. */
    gatewayTime: () => number;
}

export interface DeviceConnectionController {
    start(): void;
    stop(): void;
    /** Try now (online, the page shown, the person's "try again"). */
    retryNow(): void;
    current(): DeviceConnection;
    onChange(cb: (c: DeviceConnection) => void): () => void;
    /** Each event of the research's stream (opened), other than the device's own unpairing. */
    onEvent(cb: (e: unknown) => void): () => void;
}

function asRecord(v: unknown): Record<string, unknown> | null {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function createDeviceConnection(deps: ConnectionDeps): DeviceConnectionController {
    let conn: DeviceConnection = { state: 'connecting', reason: null, since: deps.now() };
    const listeners = new Set<(c: DeviceConnection) => void>();
    const eventListeners = new Set<(e: unknown) => void>();
    let attempt = 0;
    let timer: unknown = null;
    let watchdog: unknown = null;
    let es: EventSourceLike | null = null;
    /** The stream failed before it ever opened while the key held: an older gateway — the heartbeat alone. */
    let eventsMissing = false;
    let running = false;
    let checking = false;
    let generation = 0;

    const set = (state: DeviceConnectionState, reason: DeviceConnectionReason = null, extra: Partial<DeviceConnection> = {}): void => {
        const same = conn.state === state && conn.reason === reason && conn.otherAddress === extra.otherAddress && conn.retryInMs === extra.retryInMs;
        if (same) return;
        conn = { state, reason, since: conn.state === state ? conn.since : deps.now(), ...extra };
        for (const cb of [...listeners]) {
            try { cb(conn); } catch { /* a listener's failure stays its own */ }
        }
    };

    const clearTimer = (): void => {
        if (timer !== null) deps.clearTimeout(timer);
        timer = null;
    };
    const clearWatchdog = (): void => {
        if (watchdog !== null) deps.clearTimeout(watchdog);
        watchdog = null;
    };
    const closeEvents = (): void => {
        clearWatchdog();
        if (es) {
            es.onopen = es.onmessage = es.onerror = null;
            es.close();
        }
        es = null;
    };

    const schedule = (ms: number): void => {
        clearTimer();
        timer = deps.setTimeout(() => {
            timer = null;
            void check();
        }, ms);
    };

    const retryLater = (state: DeviceConnectionState, reason: DeviceConnectionReason, extra: Partial<DeviceConnection> = {}): void => {
        const ms = retryDelayMs(attempt);
        attempt++;
        set(state, reason, { ...extra, retryInMs: ms });
        schedule(ms);
    };

    const unpaired = async (): Promise<void> => {
        generation++;
        clearTimer();
        closeEvents();
        await deps.forgetPairing().catch(() => undefined);
        set('unpaired');
    };

    const armWatchdog = (): void => {
        clearWatchdog();
        watchdog = deps.setTimeout(() => {
            watchdog = null;
            closeEvents();
            void check();
        }, EVENTS_SILENT_MS);
    };

    const openEvents = (p: DevicePairing): void => {
        closeEvents();
        if (!deps.eventSource || eventsMissing) {
            // the heartbeat alone
            schedule(HEARTBEAT_MS);
            return;
        }
        const t = deps.gatewayTime();
        const n = b64url(newNonce());
        const q = new URLSearchParams({ d: p.deviceId, t: String(t), n, a: eventsAuth(p.key, t, n) });
        const tree = deps.treeId(p);
        if (tree) q.set('tree', tree);
        const mine = generation;
        let opened = false;
        const source = deps.eventSource(`/device/events?${q.toString()}`);
        es = source;
        armWatchdog();
        source.onopen = () => {
            if (mine !== generation) return;
            opened = true;
            armWatchdog();
        };
        const alive = (): void => {
            if (mine !== generation) return;
            opened = true;
            armWatchdog();
        };
        source.addEventListener('ping', alive);
        source.onmessage = (ev) => {
            if (mine !== generation) return;
            alive();
            if (!ev.data) return;
            const event = openEvent(p.key, p.deviceId, n, ev.data);
            const e = asRecord(event);
            if (!e) return;
            if (e.type === 'device' && e.what === 'unpaired') {
                void unpaired();
                return;
            }
            for (const cb of [...eventListeners]) {
                try { cb(event); } catch { /* its own */ }
            }
        };
        source.onerror = () => {
            if (mine !== generation) return;
            closeEvents();
            if (!opened) eventsMissing = true;
            // the probe tells why (unpaired, off, away) — or that only the stream is missing
            void check();
        };
    };

    const check = async (): Promise<void> => {
        if (!running || checking) return;
        checking = true;
        const mine = ++generation;
        try {
            clearTimer();
            if (!deps.onLine()) {
                closeEvents();
                set('offline');
                return;
            }
            const p = await deps.loadPairing();
            if (mine !== generation) return;
            if (!p) {
                closeEvents();
                set('unpaired');
                return;
            }
            if (conn.state !== 'connected') set('connecting', conn.reason);
            try {
                await deps.probe();
            } catch (e) {
                if (mine !== generation) return;
                closeEvents();
                const err = e instanceof GatewayError ? e : new GatewayError('network', 0);
                if (err.code === 'device.unpaired') {
                    await unpaired();
                    return;
                }
                if (err.code === 'device.disabled') {
                    retryLater('disabled', null);
                    return;
                }
                const reason: DeviceConnectionReason = err.code === 'timeout' || err.elapsedMs >= GATEWAY_TIMEOUT_MS
                    ? 'timeout'
                    : err.status === 0 && err.elapsedMs < REFUSED_AT_ONCE_MS ? 'refused'
                    : err.status === 0 ? 'timeout' : 'error';
                if (err.status === 0) {
                    const other = otherAddressOf(p);
                    if (other && (await deps.hello(other).catch(() => null))) {
                        if (mine !== generation) return;
                        retryLater('otherAddress', reason, { otherAddress: other });
                        return;
                    }
                    if (mine !== generation) return;
                }
                retryLater('unreachable', reason);
                return;
            }
            if (mine !== generation) return;
            attempt = 0;
            set('connected');
            if (!es) openEvents(p);
            else if (eventsMissing || !deps.eventSource) schedule(HEARTBEAT_MS);
        } finally {
            checking = false;
        }
    };

    /** The computer's name as another address (not this page's own host); null when it is the same or none. */
    const otherAddressOf = (p: DevicePairing): string | null => {
        const name = p.computer.name?.trim();
        if (!name || !/^[A-Za-z0-9.-]+$/.test(name)) return null;
        if (name.toLowerCase() === deps.hostname().toLowerCase()) return null;
        return `http://${name}:${GATEWAY_PORT}`;
    };

    return {
        start() {
            if (running) return;
            running = true;
            attempt = 0;
            void check();
        },
        stop() {
            running = false;
            generation++;
            clearTimer();
            closeEvents();
        },
        retryNow() {
            if (!running) return;
            attempt = 0;
            closeEvents();
            void check();
        },
        current: () => conn,
        onChange(cb) {
            listeners.add(cb);
            return () => listeners.delete(cb);
        },
        onEvent(cb) {
            eventListeners.add(cb);
            return () => eventListeners.delete(cb);
        },
    };
}

// ——— the connection of this page ———

let controller: DeviceConnectionController | null = null;

/** The probe: a sealed request the gateway answers itself (any sealed answer proves the key and that it lives). */
async function probeGateway(): Promise<void> {
    await tunnel({ m: 'GET', p: 'device' });
}

function browserDeps(): ConnectionDeps {
    return {
        now: () => Date.now(),
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: t => clearTimeout(t as ReturnType<typeof setTimeout>),
        onLine: () => typeof navigator === 'undefined' || navigator.onLine !== false,
        loadPairing,
        forgetPairing,
        probe: probeGateway,
        hello: base => hello(base),
        eventSource: typeof EventSource !== 'undefined' ? (url => new EventSource(url) as unknown as EventSourceLike) : null,
        origin: () => location.origin,
        hostname: () => location.hostname,
        treeId: p => chosenTreeId(p),
        gatewayTime,
    };
}

/** The connection of this page, started once (the device mode alone starts it). */
export function startDeviceConnection(deps: ConnectionDeps = browserDeps()): DeviceConnectionController {
    if (controller) return controller;
    const c = createDeviceConnection(deps);
    controller = c;
    if (typeof window !== 'undefined') {
        window.addEventListener('online', () => c.retryNow());
        window.addEventListener('offline', () => c.retryNow());
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') c.retryNow();
        });
    }
    c.start();
    return c;
}

/** The connection's state now (null: not in the device mode). */
export function deviceConnection(): DeviceConnection | null {
    return controller ? controller.current() : null;
}

/** Each change of the connection's state; returns the unsubscribe (nothing outside the device mode). */
export function onDeviceConnection(cb: (c: DeviceConnection) => void): () => void {
    return controller ? controller.onChange(cb) : () => undefined;
}

/** Each event of the research's stream; returns the unsubscribe. */
export function onDeviceEvent(cb: (e: unknown) => void): () => void {
    return controller ? controller.onEvent(cb) : () => undefined;
}

// ——— the move to the computer's name (§2.5; no UI yet) ———

/**
 * A code to move this device to the computer's name (`http://<name>:47800/#move.<id>.<secret>`),
 * asked once the name answers its hello. The queue is sent from here first; then `moveAway`.
 */
export async function requestMove(): Promise<{ url: string; expiresAt?: string }> {
    const a = await tunnel({ m: 'POST', p: 'device/move', b: {} });
    let said: Record<string, unknown> | null = null;
    try { said = asRecord(JSON.parse(new TextDecoder().decode(a.body ?? new Uint8Array()))); } catch { said = null; }
    if (a.s !== 200 || !said || typeof said.url !== 'string') {
        throw new GatewayError(typeof said?.code === 'string' ? said.code : `http.${a.s}`, a.s, said ?? {});
    }
    return { url: said.url, ...(typeof said.expiresAt === 'string' ? { expiresAt: said.expiresAt } : {}) };
}

/** This address left for the new one: its key forgotten here (the queue stays), the new address opened. */
export async function moveAway(url: string): Promise<void> {
    if (!/^http:\/\/[A-Za-z0-9.-]+:\d+\/#move\./.test(url)) throw new GatewayError('device.bad', 0);
    controller?.stop();
    await forgetPairing();
    location.assign(url);
}
