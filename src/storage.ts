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
const DB_VERSION = 1;

const STORES = ['trees', 'audit', 'merge'] as const;
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
                this.db = request.result;
                resolve();
            };

            request.onerror = () => {
                console.error('Failed to open IndexedDB:', request.error);
                reject(request.error);
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
        if (!this.db) throw new Error('StorageManager not initialized');

        const promise = new Promise<void>((resolve, reject) => {
            const tx = this.db!.transaction(store, 'readwrite');
            tx.objectStore(store).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });

        this.pendingWrites.push(promise);
        // Clean up resolved promises
        promise.finally(() => {
            const idx = this.pendingWrites.indexOf(promise);
            if (idx >= 0) this.pendingWrites.splice(idx, 1);
        });

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
            req.onsuccess = () => resolve(req.result.map(k => String(k)));
            req.onerror = () => reject(req.error);
        });
    }

    /**
     * Wait for all pending writes to complete
     * Call before operations that need data consistency (export, switchTree)
     */
    async flush(): Promise<void> {
        if (this.pendingWrites.length === 0) return;
        await Promise.all([...this.pendingWrites]);
    }

}

export const StorageManager = new StorageManagerClass();
