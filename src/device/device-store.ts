/**
 * What a device of the home network keeps of its pairing with the research's
 * gateway (spec 094 P3, §2.1 and §4 of the research's interface): in the
 * IndexedDB of the gateway's origin (each address of the gateway is an origin
 * of its own, so nothing here is shared with stromapp.info or another address).
 *
 * - `pairing`: {deviceId, K, name, kind, computer {name, label}, trees, treeId};
 * - `last`: the last form of the tree to read without a connection;
 * - `queue`: photos and edits not sent yet — never cleared by an unpairing
 *   (the person decides to send them elsewhere or drop them).
 *
 * The chosen tree is also in localStorage (read at start, synchronously).
 * Nothing here is ever logged: the key and the pairing secret stay on the device.
 */

import { b64url, fromB64url } from './device-crypto';
import { browserOf, systemOf, type DeviceEnv } from '../device-client';

export type DeviceKind = 'phone' | 'tablet' | 'computer';

/** A tree the gateway may open for this device (id for the tunnel, name to show). */
export interface DeviceTree {
    id: string;
    name: string;
    archive?: boolean;
}

/** This device's pairing with the computer. */
export interface DevicePairing {
    deviceId: string;
    /** K (32 bytes). */
    key: Uint8Array;
    name: string;
    kind: DeviceKind;
    /** `name`: where the computer is found (`<name>.local` when it has one); `label`: its name to show. */
    computer: { name: string; label?: string };
    trees: DeviceTree[];
    treeId?: string;
    /** The origin it was paired at (an IP address, or the computer's name). */
    origin: string;
    pairedAt: string;
}

/** The stores of the device's database. */
export type DeviceStoreName = 'pairing' | 'last' | 'queue';
const STORES: DeviceStoreName[] = ['pairing', 'last', 'queue'];

/** A key-value backend (IndexedDB, or memory in the tests and without IndexedDB). */
export interface DeviceKv {
    get(store: DeviceStoreName, key: string): Promise<unknown>;
    put(store: DeviceStoreName, key: string, value: unknown): Promise<void>;
    delete(store: DeviceStoreName, key: string): Promise<void>;
    keys(store: DeviceStoreName): Promise<string[]>;
}

const DB_NAME = 'strom-device';
const PAIRING_KEY = 'this';
const TREE_KEY = 'strom-device-tree';
/** A mark that this origin holds a pairing: read synchronously at start, so the app on the web never opens this database. */
const PAIRED_MARK = 'strom-device-paired';

/** Whether this origin was paired (the mark in localStorage; the pairing itself is in IndexedDB). */
export function hasPairingMark(): boolean {
    try { return localStorage.getItem(PAIRED_MARK) === '1'; } catch { return false; }
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function indexedDbKv(): DeviceKv {
    let dbPromise: Promise<IDBDatabase> | null = null;
    const db = (): Promise<IDBDatabase> => {
        if (!dbPromise) {
            dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
                const req = indexedDB.open(DB_NAME, 1);
                req.onupgradeneeded = () => {
                    for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            }).catch(err => {
                dbPromise = null;
                throw err;
            });
        }
        return dbPromise;
    };
    const store = async (name: DeviceStoreName, mode: IDBTransactionMode): Promise<IDBObjectStore> =>
        (await db()).transaction(name, mode).objectStore(name);
    return {
        async get(name, key) { return idbRequest((await store(name, 'readonly')).get(key)); },
        async put(name, key, value) { await idbRequest((await store(name, 'readwrite')).put(value, key)); },
        async delete(name, key) { await idbRequest((await store(name, 'readwrite')).delete(key)); },
        async keys(name) { return (await idbRequest((await store(name, 'readonly')).getAllKeys())).map(String); },
    };
}

/** An in-memory backend (tests; a browser without IndexedDB keeps it for the tab only). */
export function memoryKv(): DeviceKv {
    const stores = new Map<DeviceStoreName, Map<string, unknown>>(STORES.map(s => [s, new Map()]));
    return {
        async get(s, k) { return stores.get(s)!.get(k); },
        async put(s, k, v) { stores.get(s)!.set(k, v); },
        async delete(s, k) { stores.get(s)!.delete(k); },
        async keys(s) { return [...stores.get(s)!.keys()]; },
    };
}

let kv: DeviceKv | null = null;
function backend(): DeviceKv {
    if (!kv) kv = typeof indexedDB !== 'undefined' ? indexedDbKv() : memoryKv();
    return kv;
}

/** Tests: another backend (null: the default again). */
export function setDeviceKv(next: DeviceKv | null): void {
    kv = next;
    cached = undefined;
}

// ——— the pairing ———

interface StoredPairing extends Omit<DevicePairing, 'key'> {
    key: string;
}

const KINDS: DeviceKind[] = ['phone', 'tablet', 'computer'];

function parseTrees(v: unknown): DeviceTree[] {
    if (!Array.isArray(v)) return [];
    const out: DeviceTree[] = [];
    for (const t of v) {
        const r = t && typeof t === 'object' ? (t as Record<string, unknown>) : null;
        if (!r || typeof r.id !== 'string' || !r.id) continue;
        out.push({ id: r.id, name: typeof r.name === 'string' && r.name ? r.name : r.id, ...(r.archive === true ? { archive: true } : {}) });
    }
    return out;
}

/** The trees of a pairing's answer, as the device keeps them. */
export function deviceTreesOf(v: unknown): DeviceTree[] {
    return parseTrees(v);
}

function fromStored(v: unknown): DevicePairing | null {
    const r = v && typeof v === 'object' ? (v as Partial<StoredPairing>) : null;
    const key = fromB64url(r?.key, 32);
    if (!r || !key || typeof r.deviceId !== 'string' || !r.deviceId) return null;
    const computer = r.computer && typeof r.computer.name === 'string' ? { name: r.computer.name, ...(typeof r.computer.label === 'string' ? { label: r.computer.label } : {}) } : { name: '' };
    return {
        deviceId: r.deviceId,
        key,
        name: typeof r.name === 'string' ? r.name : '',
        kind: KINDS.includes(r.kind as DeviceKind) ? (r.kind as DeviceKind) : 'phone',
        computer,
        trees: parseTrees(r.trees),
        ...(typeof r.treeId === 'string' ? { treeId: r.treeId } : {}),
        origin: typeof r.origin === 'string' ? r.origin : '',
        pairedAt: typeof r.pairedAt === 'string' ? r.pairedAt : '',
    };
}

/** undefined: not read yet; null: none. */
let cached: DevicePairing | null | undefined;

/** This origin's pairing, or null. */
export async function loadPairing(): Promise<DevicePairing | null> {
    if (cached !== undefined) return cached;
    try {
        cached = fromStored(await backend().get('pairing', PAIRING_KEY));
    } catch {
        cached = null;
    }
    return cached;
}

/** The pairing as last read or saved (null: none or not read yet). */
export function pairingNow(): DevicePairing | null {
    return cached ?? null;
}

/** The pairing kept (a new one, a renamed device, new trees). */
export async function savePairing(p: DevicePairing): Promise<void> {
    const stored: StoredPairing = { ...p, key: b64url(p.key) };
    cached = { ...p };
    try { localStorage.setItem(PAIRED_MARK, '1'); } catch { /* no storage: this tab only */ }
    await backend().put('pairing', PAIRING_KEY, stored);
}

/**
 * The pairing forgotten (unpaired on the computer, 401 device.unpaired, or by
 * the person): the key, the chosen tree and the last form of the tree go; the
 * queue of photos and edits stays.
 */
export async function forgetPairing(): Promise<void> {
    cached = null;
    try {
        localStorage.removeItem(TREE_KEY);
        localStorage.removeItem(PAIRED_MARK);
    } catch { /* no storage */ }
    const b = backend();
    await b.delete('pairing', PAIRING_KEY).catch(() => undefined);
    for (const k of await b.keys('last').catch(() => [] as string[])) await b.delete('last', k).catch(() => undefined);
}

// ——— the tree chosen ———

/** The tree chosen on this device (localStorage first, then the pairing's), when the pairing still offers it. */
export function chosenTreeId(p: DevicePairing | null = pairingNow()): string | null {
    let id: string | null = null;
    try { id = localStorage.getItem(TREE_KEY); } catch { /* no storage */ }
    id = id ?? p?.treeId ?? null;
    if (p && id && !p.trees.some(t => t.id === id)) id = null;
    return id ?? (p?.trees.length === 1 ? p.trees[0].id : null);
}

/** A tree chosen (kept in localStorage and in the pairing). */
export async function chooseTree(treeId: string): Promise<void> {
    try { localStorage.setItem(TREE_KEY, treeId); } catch { /* no storage */ }
    const p = await loadPairing();
    if (p) await savePairing({ ...p, treeId });
}

// ——— the last form of the tree, the queue ———

/** The last form of a tree kept to read without a connection. */
export async function saveLastView(treeId: string, value: unknown): Promise<void> {
    await backend().put('last', treeId, value);
}

export async function loadLastView(treeId: string): Promise<unknown> {
    return backend().get('last', treeId).catch(() => undefined);
}

/** The queue of photos and edits not sent yet (kept over an unpairing). */
export const deviceQueue = {
    put: (id: string, value: unknown): Promise<void> => backend().put('queue', id, value),
    get: (id: string): Promise<unknown> => backend().get('queue', id),
    delete: (id: string): Promise<void> => backend().delete('queue', id),
    ids: (): Promise<string[]> => backend().keys('queue'),
};

// ——— the name this device proposes ———

/**
 * The kind of this device: an iPad (also one asking for the Mac page, told by
 * touch), an Android without "Mobile" or a "Tablet": a tablet; an iPhone or an
 * Android phone: a phone; anything else a computer.
 */
export function deviceKindOf(env: DeviceEnv): DeviceKind {
    const ua = env.userAgent || '';
    const system = systemOf(env);
    if (system === 'iPad' || /\bTablet\b/.test(ua) || (system === 'Android' && !/\bMobile\b/.test(ua))) return 'tablet';
    if (system === 'iPhone' || system === 'Android' || /\bMobile\b/.test(ua)) return 'phone';
    return 'computer';
}

/**
 * The name this device proposes at its pairing ("iPhone · Safari", "iPad ·
 * Safari", "Android · Chrome"; a computer: `computerWord` · its browser, e.g.
 * "Notebook · Firefox"). Never translated by the research; `computerWord`
 * comes from the UI's language.
 */
export function proposeDevice(env: DeviceEnv, computerWord = 'Computer'): { name: string; kind: DeviceKind } {
    const kind = deviceKindOf(env);
    const browser = browserOf(env);
    const system = systemOf(env);
    const first = kind === 'computer' ? computerWord : system || (kind === 'tablet' ? 'Tablet' : 'Phone');
    return { name: [first, browser].filter(Boolean).join(' · ').slice(0, 60), kind };
}

/** This browser's own proposal (navigator). */
export function proposeThisDevice(computerWord?: string): { name: string; kind: DeviceKind } {
    if (typeof navigator === 'undefined') return proposeDevice({ userAgent: '' }, computerWord);
    const nav = navigator as Navigator & { userAgentData?: { brands?: { brand: string }[]; platform?: string } };
    return proposeDevice({
        userAgent: nav.userAgent || '',
        brands: nav.userAgentData?.brands?.map(b => b.brand),
        platform: nav.userAgentData?.platform,
        maxTouchPoints: nav.maxTouchPoints ?? 0,
    }, computerWord);
}
