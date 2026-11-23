/**
 * The tree's images and the satellite windows (spec 135). The tree holds its
 * stored images as pool references (`\u0000sm:<id>`) and goes to a satellite
 * as it is: small. A satellite keeps no storage of its own and no key of an
 * encrypted pool; it reads an image's bytes through the main window, which
 * publishes its pool for the windows it (or they) opened (`opener`). The
 * windows of the app share one browser: the Blob the main window reads is
 * shown here through an object URL of this window's own, so a reload or a
 * cache of the main window never takes a picture away from a satellite.
 *
 * A satellite that cannot reach the main window (a second tab turned into a
 * window) reads an unencrypted pool's images from this browser's storage
 * itself; for an encrypted one it says so in its hello and gets the images
 * whole in the data. A window of 3.31 or before gets one JSON string with
 * every image whole (window-registry.ts).
 */

import { registerMemoryImages } from '../pool-memory.js';

interface OpenerChain { opener?: unknown }

// ---- pooled images (spec 135, D6) ----

/**
 * The name the main window publishes its image pool under. The tree holds
 * pooled images as references (`\u0000sm:<id>`); a satellite keeps no
 * storage and no key of an encrypted pool, so it reads their bytes (and
 * their catalog entries) through the main window, which reads and decrypts
 * them.
 */
export const POOL_SOURCE_KEY = '__stromWindowPool';

/** The main window's pool as a satellite reads it. */
export interface PoolSource {
    /** The images of `ids` as Blobs (null: not in the pool, or not readable now). */
    blobs(ids: readonly string[]): Promise<Map<string, Blob | null>>;
    /**
     * A satellite's images in memory (its tree, its open edits) for the main
     * window's pool cleanup (spec 135, D7): `held` gives their content ids,
     * asked at each cleanup; null: the satellite holds none any more.
     */
    hold?(windowId: string, held: (() => Iterable<string>) | null): void;
}

/** What each satellite holds of the pool (the main window), by its window id. */
const satelliteHolds = new Map<string, () => Iterable<string>>();

/** A satellite says what it holds (PoolSource.hold), or that it holds nothing any more. */
export function holdSatelliteImages(windowId: string, held: (() => Iterable<string>) | null): void {
    if (typeof windowId !== 'string' || !windowId) return;
    if (typeof held === 'function') satelliteHolds.set(windowId, held);
    else satelliteHolds.delete(windowId);
}

/**
 * The content ids the satellites hold now. A satellite that cannot be asked
 * (closed without saying so) is forgotten.
 */
export function satelliteImageIds(): string[] {
    const out: string[] = [];
    for (const [windowId, held] of satelliteHolds) {
        try {
            for (const id of held()) if (typeof id === 'string') out.push(String(id));
        } catch {
            satelliteHolds.delete(windowId);
        }
    }
    return out;
}

registerMemoryImages(satelliteImageIds);

/** The window ids of the satellites that tell this window what they hold. */
export function satellitesHolding(): string[] {
    return [...satelliteHolds.keys()];
}

/** The main window publishes its pool for the satellites it (or they) opened. */
export function publishPoolSource(source: PoolSource, target: object | undefined = typeof window !== 'undefined' ? window : undefined): void {
    if (!target) return;
    try {
        Object.defineProperty(target, POOL_SOURCE_KEY, { value: source, configurable: true });
    } catch { /* not published: the satellites read the pool themselves, or get the images whole */ }
}

/**
 * The main window's pool as this window can reach it (through the window
 * that opened it, or the one that opened that), read anew at every call:
 * after the main window's reload its new page publishes its own. Null when
 * none can be reached.
 */
export function findPoolSource(self: OpenerChain | undefined = typeof window !== 'undefined' ? window : undefined): PoolSource | null {
    let w: unknown = self?.opener;
    for (let depth = 0; depth < 8 && w; depth++) {
        try {
            const win = w as OpenerChain & { closed?: boolean } & Record<string, unknown>;
            if (win.closed) return null;
            if (win[POOL_SOURCE_KEY] && typeof win[POOL_SOURCE_KEY] === 'object') {
                const current = (): PoolSource | null => {
                    try {
                        if (win.closed) return null;
                        const s = win[POOL_SOURCE_KEY] as PoolSource | undefined;
                        return s && typeof s.blobs === 'function' ? s : null;
                    } catch { return null; }
                };
                return {
                    blobs: async (ids) => {
                        const s = current();
                        if (!s) return new Map(ids.map(id => [id, null]));
                        try { return await s.blobs(ids); } catch { return new Map(ids.map(id => [id, null])); }
                    },
                    hold: (windowId, held) => {
                        try { current()?.hold?.(windowId, held); } catch { /* the main window went: it asks no more */ }
                    },
                };
            }
            w = win.opener;
        } catch { return null; }
    }
    return null;
}
