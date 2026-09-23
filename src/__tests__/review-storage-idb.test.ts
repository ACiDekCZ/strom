/**
 * Review 2026-09-22 V2 / S22 — the real StorageManager against a minimal fake
 * IndexedDB: an aborted transaction (Chrome reports QuotaExceededError as an
 * abort) must reject instead of hanging, and a version change from another
 * tab closes the connection so later writes fail loudly.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { StorageManager } from '../storage.js';

interface FakeTx {
    oncomplete: (() => void) | null;
    onerror: (() => void) | null;
    onabort: (() => void) | null;
    error: Error | null;
    objectStore(): { put(): void; delete(): void; get(): object; getAll(): object; getAllKeys(): object };
}

function fakeDb(onTx: (tx: FakeTx) => void) {
    return {
        transaction(): FakeTx {
            const tx: FakeTx = {
                oncomplete: null, onerror: null, onabort: null, error: null,
                objectStore: () => ({ put() {}, delete() {}, get: () => ({}), getAll: () => ({}), getAllKeys: () => ({}) }),
            };
            setTimeout(() => onTx(tx), 0);
            return tx;
        },
        close: vi.fn(),
        onversionchange: null as (() => void) | null,
    };
}

function install(db: unknown): void {
    (StorageManager as unknown as { db: unknown }).db = db;
}

afterEach(() => {
    install(null);
    vi.unstubAllGlobals();
});

describe('V2 aborted transactions reject', () => {
    it('set() rejects on abort (quota) and flush() still settles', async () => {
        install(fakeDb(tx => {
            tx.error = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
            tx.onabort?.();
        }));
        await expect(StorageManager.set('trees', 'k', { a: 1 })).rejects.toThrow('quota');
        await expect(StorageManager.flush()).resolves.toBeUndefined();
    });

    it('delete() rejects on abort', async () => {
        install(fakeDb(tx => tx.onabort?.()));
        await expect(StorageManager.delete('trees', 'k')).rejects.toThrow(/aborted/);
    });

    it('set() without a connection rejects instead of throwing synchronously', async () => {
        install(null);
        const p = StorageManager.set('trees', 'k', 1);
        await expect(p).rejects.toThrow(/not initialized/);
    });
});

describe('S22 connection lifecycle', () => {
    it('closes on versionchange and reports blocked opens', async () => {
        const seen: string[] = [];
        const target = new EventTarget();
        target.addEventListener('strom:storage-blocked', () => seen.push('blocked'));
        target.addEventListener('strom:storage-closed', () => seen.push('closed'));
        vi.stubGlobal('window', target);

        const db = fakeDb(tx => tx.oncomplete?.());
        const request: Record<string, unknown> = { result: db };
        vi.stubGlobal('indexedDB', { open: () => request });

        const opening = StorageManager.init();
        (request.onblocked as () => void)();
        (request.onsuccess as () => void)();
        await opening;
        expect(seen).toEqual(['blocked']);

        await expect(StorageManager.set('trees', 'k', 1)).resolves.toBeUndefined();

        db.onversionchange!();
        expect(db.close).toHaveBeenCalled();
        expect(seen).toEqual(['blocked', 'closed']);
        await expect(StorageManager.set('trees', 'k', 1)).rejects.toThrow(/not initialized/);
    });

    it('init() rejects when the database cannot be opened', async () => {
        const request: Record<string, unknown> = { error: new Error('denied') };
        vi.stubGlobal('indexedDB', { open: () => request });
        const opening = StorageManager.init();
        (request.onerror as () => void)();
        await expect(opening).rejects.toThrow('denied');
    });
});
