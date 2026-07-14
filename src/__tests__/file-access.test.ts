/**
 * File System Access module (pure). The FSA globals and StorageManager are
 * mocked; no real browser API is touched.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mem = new Map<string, unknown>();
vi.mock('../storage.js', () => ({
    StorageManager: {
        async get<T>(_s: string, k: string): Promise<T | null> { return (mem.get(k) as T) ?? null; },
        set(_s: string, k: string, v: unknown): Promise<void> { mem.set(k, v); return Promise.resolve(); },
        async delete(_s: string, k: string): Promise<void> { mem.delete(k); },
    },
}));

import {
    isFileAccessSupported, pickSaveFile, saveToHandle, ensurePermission,
    storeHandle, loadHandle, dropHandle, FileSystemFileHandleLike,
} from '../file-access.js';

/** A fake handle that records what was written. */
function fakeHandle(name = 'tree.json', perm: PermissionState = 'granted'): FileSystemFileHandleLike & { written: string } {
    const h = {
        name, kind: 'file' as const, written: '',
        async getFile() { return new File([h.written], name); },
        async createWritable() {
            return { async write(d: string) { h.written = d as string; }, async close() {} };
        },
        async queryPermission() { return perm; },
        async requestPermission() { return perm; },
    };
    return h;
}

const g = globalThis as unknown as { window?: unknown };

beforeEach(() => { mem.clear(); g.window = undefined; });

describe('isFileAccessSupported', () => {
    it('is false without the API', () => {
        g.window = { isSecureContext: true };
        expect(isFileAccessSupported()).toBe(false);
    });
    it('is false in an insecure context', () => {
        g.window = { showSaveFilePicker: () => {}, isSecureContext: false };
        expect(isFileAccessSupported()).toBe(false);
    });
    it('is true with the API in a secure context', () => {
        g.window = { showSaveFilePicker: () => {}, isSecureContext: true };
        expect(isFileAccessSupported()).toBe(true);
    });
});

describe('pickSaveFile + saveToHandle', () => {
    it('returns the picked handle and writes text into it', async () => {
        const handle = fakeHandle('my-tree.json');
        g.window = { isSecureContext: true, showSaveFilePicker: vi.fn().mockResolvedValue(handle) };
        const picked = await pickSaveFile('My Tree');
        expect(picked).toBe(handle);
        await saveToHandle(picked!, '{"hello":1}');
        expect(handle.written).toBe('{"hello":1}');
    });
    it('returns null when the picker is cancelled', async () => {
        g.window = { isSecureContext: true, showSaveFilePicker: vi.fn().mockRejectedValue(new Error('abort')) };
        expect(await pickSaveFile('X')).toBeNull();
    });
});

describe('ensurePermission', () => {
    it('grants when already granted', async () => {
        expect(await ensurePermission(fakeHandle('a', 'granted'))).toBe(true);
    });
    it('prompts and grants', async () => {
        const h = fakeHandle('a', 'prompt');
        h.queryPermission = async () => 'prompt';
        h.requestPermission = async () => 'granted';
        expect(await ensurePermission(h)).toBe(true);
    });
    it('fails when denied', async () => {
        const h = fakeHandle('a', 'denied');
        h.queryPermission = async () => 'denied';
        h.requestPermission = async () => 'denied';
        expect(await ensurePermission(h)).toBe(false);
    });
});

describe('handle persistence', () => {
    it('stores, loads and drops a handle per tree', async () => {
        const h = fakeHandle('t.json');
        await storeHandle('tree-1', h);
        expect(await loadHandle('tree-1')).toBe(h);
        await dropHandle('tree-1');
        expect(await loadHandle('tree-1')).toBeNull();
    });
});
