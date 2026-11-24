/**
 * The research's bridge on a device of the home network (spec 094 P3): the
 * app's bridge code asks `<origin>/__device/<tree>/<path>` (a base of the
 * device's own origin, `deviceBridgeBase`), and here it goes through the
 * gateway's sealed tunnel. Nothing of this is installed outside the confirmed
 * device mode: there `fetch`, `EventSource` and images stay as they are.
 *
 * - one `fetch` interceptor: a URL of such a base is asked by `deviceFetch`
 *   (the bridge's path without a token, the tree from the pairing);
 * - the live events: the gateway's own event stream stands in for the
 *   bridge's EventSource (`deviceEventSource`);
 * - images: an `<img src>` of such a base gets a blob URL of the answer
 *   (revoked when the image goes or changes); no service worker.
 */

import { deviceFetch } from './gateway-client';
import { onDeviceConnection, onDeviceEvent, deviceConnection } from './device-connection';
import { chosenTreeId, pairingNow, type DevicePairing } from './device-store';
import { DEVICE_BRIDGE_PATH, deviceBridgeBase, parseDeviceBridge, researchDeviceState, setResearchDeviceState } from '../research-link.js';

export { deviceBridgeBase };

/** The device's state for the research's code: its origin, the trees it opens, the computer's name. */
export function enterDeviceBridge(pairing: DevicePairing, origin: string = location.origin): void {
    setResearchDeviceState({
        origin,
        trees: pairing.trees.map(t => t.id),
        computer: pairing.computer.label || pairing.computer.name,
        actions: researchDeviceState()?.actions ?? [],
    });
    installDeviceFetch();
    watchDeviceImages();
}

/** The device unpaired (or the mode left): the research's code sees no bridge here any more. */
export function leaveDeviceBridge(): void {
    setResearchDeviceState(null);
}

// ——— fetch ———

let pageFetch: typeof fetch | null = null;

function abortError(): Error {
    try {
        return new DOMException('The operation was aborted.', 'AbortError');
    } catch {
        const e = new Error('The operation was aborted.');
        e.name = 'AbortError';
        return e;
    }
}

/** A request of a device base through the tunnel (its signal respected), else null (not one). */
export function deviceBridgeRequest(input: RequestInfo | URL, init?: RequestInit): Promise<Response> | null {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const target = parseDeviceBridge(url);
    if (!target) return null;
    const req = typeof input === 'object' && !(input instanceof URL) ? input : null;
    const method = init?.method ?? req?.method ?? 'GET';
    const headers = init?.headers ?? req?.headers;
    const signal = init?.signal ?? req?.signal ?? null;
    if (signal?.aborted) return Promise.reject(abortError());
    const body = init?.body !== undefined ? Promise.resolve(init.body)
        : req && method !== 'GET' && method !== 'HEAD' ? req.arrayBuffer() : Promise.resolve(undefined);
    const asked = body.then(b => deviceFetch(target.path, { method, headers, body: b ?? null, tree: target.treeId }));
    if (!signal) return asked;
    return new Promise<Response>((resolve, reject) => {
        const onAbort = (): void => reject(abortError());
        signal.addEventListener('abort', onAbort, { once: true });
        asked.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
}

/** The interceptor in place (once); only called in the confirmed device mode. */
export function installDeviceFetch(): void {
    if (pageFetch || typeof globalThis.fetch !== 'function') return;
    const original = globalThis.fetch.bind(globalThis);
    pageFetch = original;
    const wrapped: typeof fetch = (input, init) => deviceBridgeRequest(input, init) ?? original(input, init);
    globalThis.fetch = wrapped;
}

/** The interceptor taken away (the tests). */
export function uninstallDeviceFetch(): void {
    if (!pageFetch) return;
    globalThis.fetch = pageFetch;
    pageFetch = null;
}

// ——— the live events ———

/** The EventSource-like shape the live code uses. */
export interface DeviceEventSource {
    onerror: ((ev: Event) => void) | null;
    addEventListener(type: string, cb: (ev: Event) => void): void;
    close(): void;
}

/**
 * The bridge's events of `treeId` from the gateway's stream: each `{event, data}`
 * said to its listeners as a MessageEvent with the data as JSON; the connection
 * leaving `connected` is the stream's error. null: the stream is of another tree
 * or not open (the caller asks for the status now and then instead).
 */
export function deviceEventSource(treeId: string): DeviceEventSource | null {
    const pairing = pairingNow();
    if (!pairing || chosenTreeId(pairing) !== treeId || deviceConnection()?.state !== 'connected') return null;
    const listeners = new Map<string, Set<(ev: Event) => void>>();
    let closed = false;
    const offs: (() => void)[] = [];
    const source: DeviceEventSource = {
        onerror: null,
        addEventListener(type, cb) {
            let set = listeners.get(type);
            if (!set) listeners.set(type, (set = new Set()));
            set.add(cb);
        },
        close() {
            if (closed) return;
            closed = true;
            for (const off of offs.splice(0)) off();
        },
    };
    offs.push(onDeviceEvent(e => {
        if (closed) return;
        const ev = new MessageEvent(e.event, { data: JSON.stringify(e.data ?? null) });
        for (const cb of [...(listeners.get(e.event) ?? [])]) {
            try { cb(ev); } catch { /* its own */ }
        }
    }));
    offs.push(onDeviceConnection(c => {
        if (closed || c.state === 'connected') return;
        source.onerror?.(new Event('error'));
    }));
    return source;
}

// ——— images ———

/** The blob URL each image of a device base shows, and the address it stands for. */
const shown = new WeakMap<HTMLImageElement, { src: string; blob: string }>();
const live = new Set<HTMLImageElement>();
let observer: MutationObserver | null = null;

function isDeviceSrc(src: string | null): src is string {
    return !!src && !!parseDeviceBridge(src);
}

function forget(img: HTMLImageElement): void {
    const held = shown.get(img);
    if (!held) return;
    shown.delete(img);
    live.delete(img);
    URL.revokeObjectURL(held.blob);
}

/** An image of a device base: its bytes through the tunnel, shown by a blob URL. */
async function swapImage(img: HTMLImageElement): Promise<void> {
    const src = img.getAttribute('src');
    if (!isDeviceSrc(src)) return;
    forget(img);
    try {
        const res = await (deviceBridgeRequest(src) ?? Promise.reject(new Error('not a device base')));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = URL.createObjectURL(await res.blob());
        // Changed meanwhile: this answer is no longer the one asked for.
        if (img.getAttribute('src') !== src) {
            URL.revokeObjectURL(blob);
            return;
        }
        shown.set(img, { src, blob });
        live.add(img);
        img.setAttribute('src', blob);
    } catch {
        img.dispatchEvent(new Event('error'));
    }
}

function scan(node: Node): void {
    if (node instanceof HTMLImageElement) {
        if (isDeviceSrc(node.getAttribute('src'))) void swapImage(node);
        return;
    }
    if (node instanceof Element || node instanceof DocumentFragment) {
        node.querySelectorAll?.(`img[src*="${DEVICE_BRIDGE_PATH}"]`).forEach(img => void swapImage(img as HTMLImageElement));
    }
}

/** Images gone from the page give back their blob URLs. */
function sweep(): void {
    for (const img of [...live]) {
        if (!img.isConnected) forget(img);
    }
}

/** Every image of a device base on the page (now and later) shown through the tunnel. */
export function watchDeviceImages(root: Document = document): void {
    if (observer || typeof MutationObserver !== 'function') return;
    observer = new MutationObserver(records => {
        let removed = false;
        for (const r of records) {
            if (r.type === 'attributes' && r.target instanceof HTMLImageElement) {
                const img = r.target;
                const src = img.getAttribute('src');
                const held = shown.get(img);
                if (held && src === held.blob) continue;
                if (held) forget(img);
                if (isDeviceSrc(src)) void swapImage(img);
                continue;
            }
            r.addedNodes.forEach(scan);
            if (r.removedNodes.length) removed = true;
        }
        if (removed) sweep();
    });
    observer.observe(root.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
    scan(root.documentElement);
}

/** The watch stopped and every blob URL given back (the tests). */
export function unwatchDeviceImages(): void {
    observer?.disconnect();
    observer = null;
    for (const img of [...live]) forget(img);
}

/** The base of the tree a device asks now (its chosen one), or null. */
export function deviceBridgeBaseNow(): string | null {
    const tree = chosenTreeId();
    return tree && researchDeviceState() ? deviceBridgeBase(tree) : null;
}
