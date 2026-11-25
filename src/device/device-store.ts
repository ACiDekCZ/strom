/**
 * What a device of the home network keeps of its pairing with the research's
 * gateway (spec 094 P3, §2.1 and §4 of the research's interface): in the
 * IndexedDB of the gateway's origin (each address of the gateway is an origin
 * of its own, so nothing here is shared with stromapp.info or another address).
 *
 * - `pairing`: {deviceId, K, name, kind, computer {name, label}, trees, treeId};
 * - `last`: the last form of the tree to read without a connection;
 * - `queue`: photos and edits not sent yet — never cleared by an unpairing
 *   (the person decides to send them elsewhere or drop them);
 * - `research`: the last state of each tree's research read through the
 *   bridge (the phone's Research screen without a connection, spec 094 §8);
 * - `seen`: when each tree's finds were last seen on this device.
 *
 * `last`, `research` and `seen` go with an unpairing; `queue` stays. None of
 * them is sealed on its own: the origin's storage holds the key beside them,
 * so they are kept exactly as the queue is.
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
export type DeviceStoreName = 'pairing' | 'last' | 'queue' | 'research' | 'seen';
const STORES: DeviceStoreName[] = ['pairing', 'last', 'queue', 'research', 'seen'];

/** A key-value backend (IndexedDB, or memory in the tests and without IndexedDB). */
export interface DeviceKv {
    get(store: DeviceStoreName, key: string): Promise<unknown>;
    put(store: DeviceStoreName, key: string, value: unknown): Promise<void>;
    delete(store: DeviceStoreName, key: string): Promise<void>;
    keys(store: DeviceStoreName): Promise<string[]>;
}

const DB_NAME = 'strom-device';
/** 2: the stores `research` and `seen` (spec 094 K3.13); an upgrade only adds the stores missing. */
const DB_VERSION = 2;
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
                const req = indexedDB.open(DB_NAME, DB_VERSION);
                req.onupgradeneeded = () => {
                    for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
                };
                req.onsuccess = () => {
                    const opened = req.result;
                    // A newer page of this origin upgrades the database: this one lets go and opens it again when asked.
                    opened.onversionchange = () => {
                        opened.close();
                        dbPromise = null;
                    };
                    resolve(opened);
                };
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

/** The longest id of a research's tree a device takes (the research's U9d). */
export const DEVICE_TREE_ID_MAX = 200;

/**
 * An id of a research's tree as a pairing gives it: an opaque string of at
 * most 200 characters, no control characters (the research's U9d — new trees
 * have a UUID, but its shape is never checked here).
 */
export function deviceTreeIdOk(id: unknown): id is string {
    return typeof id === 'string' && id.length > 0 && id.length <= DEVICE_TREE_ID_MAX && !/[\u0000-\u001f\u007f]/u.test(id);
}

/**
 * The computer's name to show (the research's U9d): its `label` (diacritics,
 * at most 60 characters), else its `name` (the address it is found at), else
 * `generic` (the app's word for a computer). The same for GET /device/hello.
 */
export function computerLabelOf(c: { name?: unknown; label?: unknown } | null | undefined, generic = ''): string {
    const label = typeof c?.label === 'string' ? c.label.trim() : '';
    const name = typeof c?.name === 'string' ? c.name.trim() : '';
    return label || name || generic;
}

function parseTrees(v: unknown): DeviceTree[] {
    if (!Array.isArray(v)) return [];
    const out: DeviceTree[] = [];
    for (const t of v) {
        const r = t && typeof t === 'object' ? (t as Record<string, unknown>) : null;
        if (!r || !deviceTreeIdOk(r.id)) continue;
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
    const computer = { name: typeof r.computer?.name === 'string' ? r.computer.name : '', ...(typeof r.computer?.label === 'string' ? { label: r.computer.label } : {}) };
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
 * the person): the key, the chosen tree, the last form of the tree, the last
 * state of the research and when its finds were seen go; the queue of photos
 * and edits stays.
 */
export async function forgetPairing(): Promise<void> {
    cached = null;
    try {
        localStorage.removeItem(TREE_KEY);
        localStorage.removeItem(PAIRED_MARK);
    } catch { /* no storage */ }
    const b = backend();
    await b.delete('pairing', PAIRING_KEY).catch(() => undefined);
    for (const store of ['last', 'research', 'seen'] as const) {
        for (const k of await b.keys(store).catch(() => [] as string[])) await b.delete(store, k).catch(() => undefined);
    }
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

/** The tree chosen on this device noted (null: none chosen, the chooser asks), the pairing left as it is. */
export function noteChosenTree(treeId: string | null): void {
    try {
        if (treeId) localStorage.setItem(TREE_KEY, treeId);
        else localStorage.removeItem(TREE_KEY);
    } catch { /* no storage */ }
}

/** A tree chosen (kept in localStorage and in the pairing). */
export async function chooseTree(treeId: string): Promise<void> {
    noteChosenTree(treeId);
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

/**
 * The last state of a tree's research read through the bridge (spec 094 §8,
 * `device-research-data.ts` says its shape and cleans it when read back).
 */
export async function saveResearchState(treeId: string, state: unknown): Promise<void> {
    await backend().put('research', treeId, state);
}

/** The last state of a tree's research kept here (undefined: none, or the storage failed). */
export async function loadResearchState(treeId: string): Promise<unknown> {
    return backend().get('research', treeId).catch(() => undefined);
}

/** A moment as kept: an ISO time the clock reads. */
function isoMs(v: unknown): number | null {
    if (typeof v !== 'string' || v.length > 40) return null;
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : null;
}

/**
 * A tree's finds seen up to `at` (an ISO time) on this device; never moved
 * back (a later mark stays). An invalid time is not kept.
 */
export async function markFindsSeen(treeId: string, at: string): Promise<void> {
    const ms = isoMs(at);
    if (ms === null) return;
    const before = isoMs(await backend().get('seen', treeId).catch(() => undefined));
    if (before !== null && before >= ms) return;
    await backend().put('seen', treeId, at);
}

/** When a tree's finds were last seen on this device (an ISO time), or null. */
export async function findsSeenAt(treeId: string): Promise<string | null> {
    const v = await backend().get('seen', treeId).catch(() => undefined);
    return isoMs(v) !== null ? (v as string) : null;
}

/** The queue of photos and edits not sent yet (kept over an unpairing). */
export const deviceQueue = {
    put: (id: string, value: unknown): Promise<void> => backend().put('queue', id, value),
    get: (id: string): Promise<unknown> => backend().get('queue', id),
    delete: (id: string): Promise<void> => backend().delete('queue', id),
    ids: (): Promise<string[]> => backend().keys('queue'),
};

/**
 * What waits in the queue, told apart: a photo (an entry of kind `photo`, or
 * one carrying a file's name, bytes or blob), anything else an edit.
 */
export function queueEntryIsPhoto(entry: unknown): boolean {
    if (!entry || typeof entry !== 'object') return false;
    const e = entry as Record<string, unknown>;
    if (typeof e.kind === 'string') return e.kind === 'photo';
    return typeof e.name === 'string' || e.bytes instanceof Uint8Array
        || (typeof Blob !== 'undefined' && (e.blob instanceof Blob || e.file instanceof Blob));
}

/**
 * The photos and edits waiting on this device (the queue kept over an
 * unpairing). A kept batch (`batch:<tree>`, its `photos`) counts each photo.
 */
export async function queueCounts(): Promise<{ photos: number; edits: number }> {
    let photos = 0;
    let edits = 0;
    for (const id of await deviceQueue.ids().catch(() => [] as string[])) {
        const entry = await deviceQueue.get(id).catch(() => undefined);
        if (entry === undefined) continue;
        const kept = entry && typeof entry === 'object' ? (entry as { photos?: unknown }).photos : undefined;
        if (Array.isArray(kept)) photos += kept.length;
        else if (queueEntryIsPhoto(entry)) photos++;
        else edits++;
    }
    return { photos, edits };
}

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
