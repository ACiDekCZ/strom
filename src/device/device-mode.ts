/**
 * Is this app a device's, opened from the research's gateway in the home
 * network (spec 094 P3)? A candidate only when:
 *
 * - the page is at the gateway's port (47800), or
 * - its address carries a code (`/pair?m=app#<pairId>.<secret>`,
 *   `#home.<id>.<secret>`, `#move.<id>.<secret>`), or
 * - this origin holds a pairing (a mark in localStorage);
 *
 * never on `file:` nor on stromapp.info. Only a candidate asks the gateway
 * (`GET /device/hello`, `gateway: true`): the app on the web makes no new
 * request. The code is read once and taken out of the address at once
 * (`history.replaceState`); it is never logged.
 */

import { hello, pair, configureGateway, deviceFetch, tunnel, type GatewayHello, type PairResult, GatewayError } from './gateway-client';
import { hasPairingMark, loadPairing, proposeThisDevice, type DevicePairing } from './device-store';
import { startDeviceConnection, deviceConnection, onDeviceEvent, onDeviceConnection, type DeviceConnectionController } from './device-connection';
import { enterDeviceBridge, leaveDeviceBridge } from './device-bridge';
import type { StreamEvent } from './device-crypto';

export const GATEWAY_PORT = '47800';

export type DeviceCodeKind = 'pair' | 'home' | 'move';

/** A code of the address: the pairing's (QR code), the icon's on the home screen, a move to the computer's name. */
export interface DeviceCode {
    kind: DeviceCodeKind;
    /** The pairId the gateway knows it by. */
    id: string;
    /** The secret (32 bytes, base64url). */
    secret: string;
}

const ID = '[A-Za-z0-9_-]{16,64}';
const SECRET = '[A-Za-z0-9_-]{43}';
const PAIR_HASH = new RegExp(`^(${ID})\\.(${SECRET})$`);
const CODE_HASH = new RegExp(`^(home|move)\\.(${ID})\\.(${SECRET})$`);

/** The code an address carries (pure); null when none. */
export function parseDeviceCode(pathname: string, search: string, hash: string): DeviceCode | null {
    const h = hash.replace(/^#/, '');
    if (!h) return null;
    const c = CODE_HASH.exec(h);
    if (c) return { kind: c[1] as DeviceCodeKind, id: c[2], secret: c[3] };
    const p = PAIR_HASH.exec(h);
    if (p && pathname === '/pair' && new URLSearchParams(search).get('m') === 'app') return { kind: 'pair', id: p[1], secret: p[2] };
    return null;
}

/** Where the device mode never is: a file, the app's own site. */
export function excludedFromDeviceMode(protocol: string, hostname: string): boolean {
    if (protocol !== 'http:') return true;
    const h = hostname.toLowerCase();
    return h === 'stromapp.info' || h.endsWith('.stromapp.info');
}

/** Whether this page may be a device's (pure). */
export function isDeviceModeCandidate(loc: { protocol: string; hostname: string; port: string; pathname: string; search: string; hash: string }, paired: boolean): boolean {
    if (excludedFromDeviceMode(loc.protocol, loc.hostname)) return false;
    return loc.port === GATEWAY_PORT || parseDeviceCode(loc.pathname, loc.search, loc.hash) !== null || paired;
}

/** Whether this page may be a device's (no request, no database opened). */
export function deviceModeCandidate(): boolean {
    if (typeof location === 'undefined') return false;
    // a code already taken out of the address still makes this page a device's
    if (takenCode) return true;
    return isDeviceModeCandidate(location, hasPairingMark());
}

let takenCode: DeviceCode | null | undefined;

/** The code of this address, taken once: the address is cleaned at once (nothing after #; `/pair?m=app` becomes `/`). */
export function takeDeviceCode(): DeviceCode | null {
    if (takenCode !== undefined) return takenCode;
    takenCode = null;
    if (typeof location === 'undefined' || excludedFromDeviceMode(location.protocol, location.hostname)) return null;
    takenCode = parseDeviceCode(location.pathname, location.search, location.hash);
    if (takenCode) {
        // The pairing's own address (`/pair?m=app`) becomes `/`; any other keeps its path, only without the code.
        const left = location.pathname === '/pair' ? '/' : location.pathname + location.search;
        try { history.replaceState(history.state, '', left); } catch { /* the address stays; the code is used once anyway */ }
    }
    return takenCode;
}

/** What the start of the device mode found. */
export interface DeviceModeStart {
    /** The gateway's hello (null: it did not answer — the stored pairing alone, e.g. the computer asleep). */
    hello: GatewayHello | null;
    /** The code of the address, if any (already taken out of it). */
    code: DeviceCode | null;
    /** This origin's pairing (after the code was used). */
    pairing: DevicePairing | null;
    /** The pairing made from the code. */
    paired?: PairResult;
    /** Why the code paired nothing (`pair.used`, `pair.expired`, `device.bad`, `network`…). */
    pairError?: string;
    connection: DeviceConnectionController | null;
}

let started: Promise<DeviceModeStart | null> | null = null;
let watchingUnpair = false;

/**
 * The device mode confirmed and started: the gateway's hello, the code of
 * the address used (paired with this device's proposed name), the connection
 * watched. null: not a device (the app as always).
 */
export function startDeviceMode(opts: DeviceModeOptions = {}): Promise<DeviceModeStart | null> {
    if (!started) started = doStart(opts);
    return started;
}

/**
 * The start asked once more ("Try again" of a code that paired nothing): the
 * same code of the address (taken once, kept in memory) paired again.
 */
export function restartDeviceMode(opts: DeviceModeOptions = {}): Promise<DeviceModeStart | null> {
    started = null;
    return startDeviceMode(opts);
}

/** How the device mode starts: the device's word for a computer, the app's version, who hears the gateway's hello. */
export interface DeviceModeOptions {
    computerWord?: string;
    appVersion?: string;
    /** The gateway answered (or not: null), before any pairing: the start screen names the computer. */
    onHello?: (said: GatewayHello | null) => void;
}

/**
 * Whether the code of the address pairs this origin: a home-screen icon's code
 * (`#home.`) only where nothing is paired yet — the icon of iOS has its own
 * storage; the browser holding its pairing (Safari reloaded with the code in
 * its address, Android's shortcut sharing Chrome's storage) stays as it is.
 */
export function codePairs(code: DeviceCode, storedPairing: boolean): boolean {
    return code.kind !== 'home' || !storedPairing;
}

async function doStart(opts: DeviceModeOptions): Promise<DeviceModeStart | null> {
    if (!deviceModeCandidate()) return null;
    const code = takeDeviceCode();
    if (opts.appVersion) configureGateway({ appVersion: opts.appVersion });
    const said = await hello();
    try { opts.onHello?.(said); } catch { /* the screen's own */ }
    const stored = hasPairingMark() ? await loadPairing() : null;
    if (!said && !stored) return null;
    const out: DeviceModeStart = { hello: said, code, pairing: stored, connection: null };
    if (code && said && codePairs(code, !!stored)) {
        const proposal = proposeThisDevice(opts.computerWord);
        try {
            out.paired = await pair(code.id, code.secret, stored?.name || proposal.name, stored?.kind ?? proposal.kind, code.kind);
            out.pairing = await loadPairing();
        } catch (e) {
            out.pairError = e instanceof GatewayError ? e.code : 'network';
        }
    }
    if (out.pairing) {
        out.connection = startDeviceConnection();
        // The research's bridge through the gateway (spec 094 P3): its fetch, events and images; gone once unpaired.
        enterDeviceBridge(out.pairing, location.origin, opts.computerWord);
        if (!watchingUnpair) {
            watchingUnpair = true;
            onDeviceConnection(c => { if (c.state === 'unpaired') leaveDeviceBridge(); });
        }
    }
    exposeForTests();
    return out;
}

/** The device mode's own hooks for the browser tests (only in the device mode). */
let exposed = false;
function exposeForTests(): void {
    if (exposed) return;
    exposed = true;
    const events: StreamEvent[] = [];
    onDeviceEvent(e => {
        events.push(e);
        if (events.length > 50) events.shift();
    });
    (globalThis as Record<string, unknown>).__stromDevice = {
        deviceFetch,
        tunnel,
        connection: () => deviceConnection(),
        events: () => events.slice(),
        pairing: async () => {
            const p = await loadPairing();
            return p ? { deviceId: p.deviceId, name: p.name, kind: p.kind, computer: p.computer, trees: p.trees, treeId: p.treeId ?? null } : null;
        },
    };
}
