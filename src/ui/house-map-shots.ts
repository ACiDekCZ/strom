/**
 * The app's side of the cuts of the map around houses (spec 145 T3,
 * src/house-map-shot.ts): tiles read the way the map reads them
 * (map-tiles.ts), a research's layer read as one picture (both servers
 * answer CORS, so the canvas stays readable), the canvas, and the pictures
 * kept in their own IndexedDB database ('strom-map-shots'; the app's main one
 * stays at its version), so that a print, a PDF or a gift made later needs no
 * new download. Without IndexedDB they are kept for the tab only.
 */

import type { HouseId, StromData } from '../types.js';
import type { HouseResearch } from '../house-bridge.js';
import type { LiveHouseLayer } from '../research-link.js';
import type { TreeHouse } from '../houses.js';
import type { Language } from '../strings.js';
import { SettingsManager } from '../settings.js';
import { houseOutputFilter, housePrivacyContext } from '../house-privacy.js';
import {
    houseShotsFor, type HouseMapShots, type HouseShotDeps, type HouseShotRequest, type ShotCache, type ShotContext, type ShotImage,
} from '../house-map-shot.js';
import { fetchMapTileBlob, mapTilesBlocked } from './map-tiles.js';

const DB_NAME = 'strom-map-shots';
const STORE = 'shots';
/** How many pictures are kept: the oldest go first. */
const KEEP = 400;

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function indexedDbCache(): ShotCache {
    let dbPromise: Promise<IDBDatabase> | null = null;
    const open = (): Promise<IDBDatabase> => {
        if (!dbPromise) {
            dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
                const req = indexedDB.open(DB_NAME, 1);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' }).createIndex('at', 'at');
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
    return {
        async get(key) {
            const row = await idbRequest((await open()).transaction(STORE, 'readonly').objectStore(STORE).get(key)) as { src?: string } | undefined;
            return typeof row?.src === 'string' ? row.src : null;
        },
        async put(key, src) {
            const store = (await open()).transaction(STORE, 'readwrite').objectStore(STORE);
            await idbRequest(store.put({ key, src, at: Date.now() }));
            const n = await idbRequest(store.count());
            if (n <= KEEP) return;
            const old = await idbRequest(store.index('at').getAllKeys(null, n - KEEP));
            await Promise.all(old.map(k => idbRequest(store.delete(k))));
        },
    };
}

/** The pictures of the tab (also in front of IndexedDB: an output made twice reads them once). */
const memory = new Map<string, string>();
let backing: ShotCache | null = null;

function cache(): ShotCache {
    if (!backing) backing = typeof indexedDB !== 'undefined' ? indexedDbCache() : { get: async () => null, put: async () => {} };
    const store = backing;
    return {
        async get(key) {
            const m = memory.get(key);
            if (m) return m;
            const got = await store.get(key);
            if (got) memory.set(key, got);
            return got;
        },
        async put(key, src) {
            memory.set(key, src);
            await store.put(key, src);
        },
    };
}

/** Forget the tab's pictures and use another store (tests). */
export function resetHouseShotsForTests(next: ShotCache | null = null): void {
    memory.clear();
    backing = next;
}

async function picture(blob: Blob): Promise<ShotImage> {
    if (!blob.type.startsWith('image/')) throw new Error('not a picture');
    return createImageBitmap(blob);
}

/** The app's way of making the pictures. */
export function appShotDeps(): HouseShotDeps {
    return {
        tilesAllowed: SettingsManager.isMapTilesAcknowledged() && !mapTilesBlocked(),
        loadTile: async (url, signal) => picture(await fetchMapTileBlob(url, signal)),
        loadLayer: async (url, signal) => {
            const res = await fetch(url, { credentials: 'omit', referrerPolicy: 'strict-origin-when-cross-origin', signal });
            if (!res.ok) throw new Error(`layer ${res.status}`);
            return picture(await res.blob());
        },
        canvas: (width, height) => {
            const c = document.createElement('canvas');
            c.width = width;
            c.height = height;
            const ctx = c.getContext('2d') as unknown as ShotContext;
            return { ctx, toDataUrl: type => c.toDataURL(type, type === 'image/jpeg' ? 0.85 : undefined) };
        },
        cache: cache(),
    };
}

/**
 * The requests of an output's houses: each house whose location outputs may show (houseOutputFilter: no people of
 * the last ~100 years, not hidden by hand), with the research's layers for the HTML.
 */
export function houseShotRequests(data: StromData, houses: readonly TreeHouse[], research: (house: TreeHouse) => HouseResearch | null,
    now: Date, layers?: readonly LiveHouseLayer[]): HouseShotRequest[] {
    const ctx = housePrivacyContext(data, now);
    const out: HouseShotRequest[] = [];
    for (const house of houses) {
        const r = research(house);
        const loc = houseOutputFilter(house, r, data, now, ctx).location;
        if (loc) out.push({ houseId: house.id, houseText: house.text, point: loc, research: r, ...(layers?.length ? { layers } : {}) });
    }
    return out;
}

/** The pictures of an output's houses, made or taken from what is kept; never throws, never waits past `totalMs`. */
export async function prepareHouseShots(reqs: readonly HouseShotRequest[], lang: Language, totalMs = 30_000): Promise<Map<HouseId, HouseMapShots>> {
    if (!reqs.length) return new Map();
    try {
        return await houseShotsFor(reqs, lang, appShotDeps(), { totalMs });
    } catch {
        return new Map();
    }
}
