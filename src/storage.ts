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

const DB_NAME = 'strom-db';
// v2: added the 'snapshots' store (versioned backups).
// v3: added the 'fileHandles' store (File System Access handles per tree).
// v4: added the 'shareBaselines' store (change-packet baselines per exportId).
// v5: added the 'snapshotMedia' store (images shared by backups).
// onupgradeneeded creates any missing store, so existing databases gain it on
// the next open.
const DB_VERSION = 5;

/** Notify the UI layer (no-op outside a browser, e.g. in unit tests). */
function dispatchStorageEvent(name: string): void {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(name));
}

const STORES = ['trees', 'audit', 'merge', 'snapshots', 'snapshotMedia', 'fileHandles', 'shareBaselines'] as const;
export type StoreName = typeof STORES[number];

class StorageManagerClass {
    private db: IDBDatabase | null = null;
    private pendingWrites: Promise<void>[] = [];

    /**
     * Open/create the database with all object stores
     */
    async init(): Promise<void> {
        if (this.db) return;

        return new Promise<void>((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = () => {
                const db = request.result;
                for (const store of STORES) {
                    if (!db.objectStoreNames.contains(store)) {
                        db.createObjectStore(store);
                    }
                }
            };

            request.onsuccess = () => {
                const db = request.result;
                // Another tab (a newer build) wants to upgrade the schema: close
                // so its upgrade is not blocked forever, and tell the UI — any
                // further write from this tab fails loudly instead of hanging.
                db.onversionchange = () => {
                    db.close();
                    if (this.db === db) this.db = null;
                    dispatchStorageEvent('strom:storage-closed');
                };
                this.db = db;
                resolve();
            };

            request.onerror = () => {
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

    /**
     * Read a value from an object store
     */
    async get<T>(store: StoreName, key: string): Promise<T | null> {
        if (!this.db) throw new Error('StorageManager not initialized');

        return new Promise<T | null>((resolve, reject) => {
            const tx = this.db!.transaction(store, 'readonly');
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
        if (!this.db) return Promise.reject(new Error('StorageManager not initialized'));

        const promise = new Promise<void>((resolve, reject) => {
            const tx = this.db!.transaction(store, 'readwrite');
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
     * Delete a key from an object store
     */
    async delete(store: StoreName, key: string): Promise<void> {
        if (!this.db) throw new Error('StorageManager not initialized');

        return new Promise<void>((resolve, reject) => {
            const tx = this.db!.transaction(store, 'readwrite');
            tx.objectStore(store).delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
        });
    }

    /**
     * Get all keys in an object store
     */
    async keys(store: StoreName): Promise<string[]> {
        if (!this.db) throw new Error('StorageManager not initialized');

        return new Promise<string[]>((resolve, reject) => {
            const tx = this.db!.transaction(store, 'readonly');
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
        if (!this.db) throw new Error('StorageManager not initialized');

        return new Promise<T[]>((resolve, reject) => {
            const tx = this.db!.transaction(store, 'readonly');
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
