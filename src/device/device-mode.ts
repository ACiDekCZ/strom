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
import { startDeviceConnection, deviceConnection, type DeviceConnectionController } from './device-connection';

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
    return isDeviceModeCandidate(location, hasPairingMark());
}

let takenCode: DeviceCode | null | undefined;

/** The code of this address, taken once: the address is cleaned at once (`/`, nothing after #). */
export function takeDeviceCode(): DeviceCode | null {
    if (takenCode !== undefined) return takenCode;
    takenCode = null;
    if (typeof location === 'undefined' || excludedFromDeviceMode(location.protocol, location.hostname)) return null;
    takenCode = parseDeviceCode(location.pathname, location.search, location.hash);
    if (takenCode) {
        try { history.replaceState(history.state, '', '/'); } catch { /* the address stays; the code is used once anyway */ }
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

/**
 * The device mode confirmed and started: the gateway's hello, the code of
 * the address used (paired with this device's proposed name), the connection
 * watched. null: not a device (the app as always).
 */
export function startDeviceMode(opts: { computerWord?: string; appVersion?: string } = {}): Promise<DeviceModeStart | null> {
    if (!started) started = doStart(opts);
    return started;
}

async function doStart(opts: { computerWord?: string; appVersion?: string }): Promise<DeviceModeStart | null> {
    if (!deviceModeCandidate()) return null;
    const code = takeDeviceCode();
    if (opts.appVersion) configureGateway({ appVersion: opts.appVersion });
    const said = await hello();
    const stored = hasPairingMark() ? await loadPairing() : null;
    if (!said && !stored) return null;
    const out: DeviceModeStart = { hello: said, code, pairing: stored, connection: null };
    if (code && said) {
        const proposal = proposeThisDevice(opts.computerWord);
        try {
            out.paired = await pair(code.id, code.secret, stored?.name || proposal.name, stored?.kind ?? proposal.kind);
            out.pairing = await loadPairing();
        } catch (e) {
            out.pairError = e instanceof GatewayError ? e.code : 'network';
        }
    }
    if (out.pairing) out.connection = startDeviceConnection();
    exposeForTests();
    return out;
}

/** The device mode's own hooks for the browser tests (only in the device mode). */
function exposeForTests(): void {
    (globalThis as Record<string, unknown>).__stromDevice = {
        deviceFetch,
        tunnel,
        connection: () => deviceConnection(),
        pairing: async () => {
            const p = await loadPairing();
            return p ? { deviceId: p.deviceId, name: p.name, kind: p.kind, computer: p.computer, trees: p.trees, treeId: p.treeId ?? null } : null;
        },
    };
}
