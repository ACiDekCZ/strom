/**
 * StorageManager - IndexedDB wrapper for persistent storage
 * Simple key-value API over three object stores: trees, audit, merge
 *
 * Design:
 * - Data lives in RAM after load; IDB is just persistence
 * - Reads are async (IDB requirement)
 * - Writes are fire-and-forget: set() returns Promise but callers don't need to await
 * - flush() waits for all pending writes (call before export/switchTree)
 */

import { researchBaseKey } from './storage-keys.js';

const DB_NAME = 'strom-db';
// v2: added the 'snapshots' store (versioned backups).
// v3: added the 'fileHandles' store (File System Access handles per tree).
// v4: added the 'shareBaselines' store (change-packet baselines per exportId).
// v5: added the 'media' store (images shared by stored trees and backups).
// onupgradeneeded creates any missing store, so existing databases gain it on
// the next open.
//
// FROZEN at 5. A browser never opens a database at a lower version than it
// has: once a build had raised it, every older build — and every older
// exported HTML file, which in Chrome all share one file:// storage — failed
// to start there. New stores go to databases of their own (EXTRA_DB below) or
// under their own keys in an existing store, never into a version bump here.
// (The 3.9 betas had raised it to 7 for 'originals' and 'researchBases': such
// a database opens as it is, and their records move once, see moveBetaStores.)
const DB_VERSION = 5;

/** Original files waiting for Strom Research: a database of their own (older builds never open it). */
const EXTRA_DB_NAME = 'strom-originals';
const EXTRA_DB_VERSION = 1;

/** Notify the UI layer (no-op outside a browser, e.g. in unit tests). */
function dispatchStorageEvent(name: string): void {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(name));
}

const STORES = ['trees', 'audit', 'merge', 'snapshots', 'media', 'fileHandles', 'shareBaselines'] as const;
const EXTRA_STORES = ['originals'] as const;
export type StoreName = typeof STORES[number] | typeof EXTRA_STORES[number];


/**
 * Open a database at `version`, creating any missing store. One a newer build
 * already upgraded (VersionError) is opened as it is (no version): its stores
 * are a superset of ours, so this build keeps working instead of failing to
 * start.
 */
function openDatabase(name: string, version: number | undefined, stores: readonly string[],
    onClosed: (db: IDBDatabase) => void): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
        const request = version === undefined ? indexedDB.open(name) : indexedDB.open(name, version);

        request.onupgradeneeded = () => {
            const db = request.result;
            for (const store of stores) {
                if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
            }
        };

        request.onsuccess = () => {
            const db = request.result;
            // Another tab (a newer build) wants to upgrade the schema: close
            // so its upgrade is not blocked forever, and tell the UI — any
            // further write from this tab fails loudly instead of hanging.
            db.onversionchange = () => {
                db.close();
                onClosed(db);
                dispatchStorageEvent('strom:storage-closed');
            };
            resolve(db);
        };

        request.onerror = () => {
            if (version !== undefined && request.error?.name === 'VersionError') {
                console.warn(`The browser storage (${name}) is from a newer version of the app: opened as it is`);
                openDatabase(name, undefined, stores, onClosed).then(resolve, reject);
                return;
            }
            console.error('Failed to open IndexedDB:', request.error);
            reject(request.error ?? new Error('IndexedDB open failed'));
        };

        // An older connection in another tab holds the database open during
        // an upgrade. The request keeps waiting (it succeeds once that tab
        // closes) — surface it so the user is not left with a blank app.
        request.onblocked = () => {
            console.warn('IndexedDB open blocked by another tab');
            dispatchStorageEvent('strom:storage-blocked');
        };
    });
}

/** Every record of a store (key and value), in one read. */
function readAll(db: IDBDatabase, store: string): Promise<{ key: IDBValidKey; value: unknown }[]> {
    return new Promise((resolve, reject) => {
        const out: { key: IDBValidKey; value: unknown }[] = [];
        const req = db.transaction(store, 'readonly').objectStore(store).openCursor();
        req.onsuccess = () => {
            const cursor = req.result;
            if (!cursor) { resolve(out); return; }
            out.push({ key: cursor.key, value: cursor.value });
            cursor.continue();
        };
        req.onerror = () => reject(req.error);
    });
}

class StorageManagerClass {
    private db: IDBDatabase | null = null;
    private extra: IDBDatabase | null = null;
    private pendingWrites: Promise<void>[] = [];

    /**
     * Open/create the databases with all object stores
     */
    async init(): Promise<void> {
        if (this.db && this.extra) return;
        if (!this.db) {
            this.db = await openDatabase(DB_NAME, DB_VERSION, STORES, (db) => { if (this.db === db) this.db = null; });
        }
        if (!this.extra) {
            this.extra = await openDatabase(EXTRA_DB_NAME, EXTRA_DB_VERSION, EXTRA_STORES, (db) => { if (this.extra === db) this.extra = null; });
        }
        await this.moveBetaStores();
    }

    /**
     * A database a 3.9 beta raised to version 7 keeps its 'researchBases' and
     * 'originals' stores (only an upgrade could drop them): their records move
     * to where this build keeps them — the base beside its tree in 'trees',
     * the originals to their own database — and leave the old stores empty.
     */
    private async moveBetaStores(): Promise<void> {
        const db = this.db;
        const extra = this.extra;
        if (!db || !extra) return;
        try {
            if (db.objectStoreNames.contains('researchBases')) {
                const bases = await readAll(db, 'researchBases');
                if (bases.length) {
                    await new Promise<void>((resolve, reject) => {
                        const tx = db.transaction(['trees', 'researchBases'], 'readwrite');
                        const trees = tx.objectStore('trees');
                        for (const { key, value } of bases) {
                            // One written since (by this build) wins over the old copy.
                            const target = researchBaseKey(String(key));
                            const has = trees.getKey(target);
                            has.onsuccess = () => { if (has.result === undefined) trees.put(value, target); };
                        }
                        tx.objectStore('researchBases').clear();
                        tx.oncomplete = () => resolve();
                        tx.onerror = () => reject(tx.error);
                        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
                    });
                }
            }
            if (db.objectStoreNames.contains('originals')) {
                const originals = await readAll(db, 'originals');
                if (originals.length) {
                    await new Promise<void>((resolve, reject) => {
                        const tx = extra.transaction('originals', 'readwrite');
                        const store = tx.objectStore('originals');
                        for (const { key, value } of originals) store.put(value, key);
                        tx.oncomplete = () => resolve();
                        tx.onerror = () => reject(tx.error);
                        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
                    });
                    // Only once they are safe in their new place.
                    await new Promise<void>((resolve, reject) => {
                        const tx = db.transaction('originals', 'readwrite');
                        tx.objectStore('originals').clear();
                        tx.oncomplete = () => resolve();
                        tx.onerror = () => reject(tx.error);
                    });
                }
            }
        } catch (err) {
            // Left where they are; tried again at the next start.
            console.warn('Moving the stores of a 3.9 beta failed', err);
        }
    }

    /** The database that holds a store. */
    private dbFor(store: StoreName): IDBDatabase | null {
        return (EXTRA_STORES as readonly string[]).includes(store) ? this.extra : this.db;
    }

    /**
     * Read a value from an object store
     */
    async get<T>(store: StoreName, key: string): Promise<T | null> {
        const db = this.dbFor(store);
        if (!db) throw new Error('StorageManager not initialized');

        return new Promise<T | null>((resolve, reject) => {
            const tx = db.transaction(store, 'readonly');
            const req = tx.objectStore(store).get(key);
            tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = () => reject(req.error);
        });
    }

    /**
     * Write a value to an object store (fire-and-forget)
     * Returns a Promise, but callers don't need to await it.
     * The write is tracked internally; use flush() to wait for all pending writes.
     */
    set(store: StoreName, key: string, value: unknown): Promise<void> {
        // Reject (never throw synchronously): fire-and-forget callers would
        // otherwise blow up mid-operation once the connection was closed.
        const db = this.dbFor(store);
        if (!db) return Promise.reject(new Error('StorageManager not initialized'));

        const promise = new Promise<void>((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite');
            tx.objectStore(store).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            // QuotaExceededError arrives as an ABORT in Chrome — without this
            // the promise never settled and the whole save queue hung.
            tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
        });

        this.pendingWrites.push(promise);
        // Clean up resolved promises
        promise.finally(() => {
            const idx = this.pendingWrites.indexOf(promise);
            if (idx >= 0) this.pendingWrites.splice(idx, 1);
        }).catch(() => { /* reported through the returned promise */ });

        return promise;
    }

    /**
     * Write several values, possibly in different stores, in ONE transaction:
     * all land or none (a tree and the research head it builds on must never
     * be stored apart). Tracked like set() for flush().
     */
    setTogether(writes: readonly { store: StoreName; key: string; value: unknown }[]): Promise<void> {
        const stores = [...new Set(writes.map(w => w.store))];
        // One transaction is one database: the stores must all live in it.
        const db = stores.length ? this.dbFor(stores[0]) : this.db;
        if (!db) return Promise.reject(new Error('StorageManager not initialized'));
        if (stores.some(st => this.dbFor(st) !== db)) return Promise.reject(new Error('setTogether across databases'));
        const promise = new Promise<void>((resolve, reject) => {
            const tx = db.transaction(stores, 'readwrite');
            for (const w of writes) tx.objectStore(w.store).put(w.value, w.key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
        });
        this.pendingWrites.push(promise);
        promise.finally(() => {
            const idx = this.pendingWrites.indexOf(promise);
            if (idx >= 0) this.pendingWrites.splice(idx, 1);
        }).catch(() => { /* reported through the returned promise */ });
        return promise;
    }

    /**
     * Delete a key from an object store
     */
    async delete(store: StoreName, key: string): Promise<void> {
        const db = this.dbFor(store);
        if (!db) throw new Error('StorageManager not initialized');

        return new Promise<void>((resolve, reject) => {
            const tx = db.transaction(store, 'readwrite');
            tx.objectStore(store).delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
        });
    }

    /**
     * Read several keys in one transaction (null for a missing one).
     */
    async getMany<T>(store: StoreName, keys: string[]): Promise<Map<string, T | null>> {
        const db = this.dbFor(store);
        if (!db) throw new Error('StorageManager not initialized');
        const out = new Map<string, T | null>();
        if (keys.length === 0) return out;

        return new Promise<Map<string, T | null>>((resolve, reject) => {
            const tx = db.transaction(store, 'readonly');
            const os = tx.objectStore(store);
            for (const key of keys) {
                const req = os.get(key);
                req.onsuccess = () => { out.set(key, (req.result as T) ?? null); };
            }
            tx.oncomplete = () => resolve(out);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
        });
    }

    /**
     * Get all keys in an object store
     */
    async keys(store: StoreName): Promise<string[]> {
        const db = this.dbFor(store);
        if (!db) throw new Error('StorageManager not initialized');

        return new Promise<string[]>((resolve, reject) => {
            const tx = db.transaction(store, 'readonly');
            const req = tx.objectStore(store).getAllKeys();
            tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
            req.onsuccess = () => resolve(req.result.map(k => String(k)));
            req.onerror = () => reject(req.error);
        });
    }

    /**
     * Get all values in an object store.
     */
    async getAll<T>(store: StoreName): Promise<T[]> {
        const db = this.dbFor(store);
        if (!db) throw new Error('StorageManager not initialized');

        return new Promise<T[]>((resolve, reject) => {
            const tx = db.transaction(store, 'readonly');
            const req = tx.objectStore(store).getAll();
            tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
            req.onsuccess = () => resolve(req.result as T[]);
            req.onerror = () => reject(req.error);
        });
    }

    /**
     * Wait for all pending writes to complete
     * Call before operations that need data consistency (export, switchTree)
     */
    async flush(): Promise<void> {
        if (this.pendingWrites.length === 0) return;
        // Settle, never throw: a failed write is reported by its own caller
        // (save-failed toast); flush only orders reads after writes.
        await Promise.allSettled([...this.pendingWrites]);
    }

}

export const StorageManager = new StorageManagerClass();
