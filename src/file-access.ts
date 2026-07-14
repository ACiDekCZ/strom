/**
 * File System Access: work over a JSON file on disk like a desktop app —
 * attach a tree to a file and save into it directly (Ctrl/Cmd+S), instead of
 * downloading a fresh copy each time. Only where the browser supports it
 * (Chromium, secure context); elsewhere the feature is simply absent and the
 * existing download/upload flow stays the sole path.
 *
 * The file handle is structured-cloneable, so it is persisted per tree in
 * IndexedDB. No DOM dependencies here (testable); the UI wires the pickers.
 */

import { StorageManager } from './storage.js';

// The FSA types aren't in the default TS lib; declare the slice we use.
interface FsaPermissionDescriptor { mode?: 'read' | 'readwrite'; }
export interface FileSystemFileHandleLike {
    name: string;
    kind: 'file';
    getFile(): Promise<File>;
    createWritable(): Promise<{ write(data: string | BufferSource | Blob): Promise<void>; close(): Promise<void> }>;
    queryPermission?(desc?: FsaPermissionDescriptor): Promise<PermissionState>;
    requestPermission?(desc?: FsaPermissionDescriptor): Promise<PermissionState>;
}

interface FsaWindow {
    showSaveFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandleLike>;
    showOpenFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandleLike[]>;
    isSecureContext?: boolean;
}

function fsaWindow(): FsaWindow {
    return (typeof window !== 'undefined' ? window : {}) as unknown as FsaWindow;
}

/** True when the browser exposes the File System Access API in a secure context. */
export function isFileAccessSupported(): boolean {
    const w = fsaWindow();
    return typeof w.showSaveFilePicker === 'function' && w.isSecureContext === true;
}

/** Slug a tree name into a safe .json filename (matches the download naming). */
function suggestedFileName(treeName: string): string {
    const safe = treeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `${safe || 'family-tree'}.json`;
}

/** Prompt for a save location and return the chosen handle (null if cancelled). */
export async function pickSaveFile(treeName: string): Promise<FileSystemFileHandleLike | null> {
    const w = fsaWindow();
    if (!w.showSaveFilePicker) return null;
    try {
        return await w.showSaveFilePicker({
            suggestedName: suggestedFileName(treeName),
            types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
        });
    } catch {
        return null;   // user cancelled
    }
}

/** Prompt to open a file and return its handle + text (null if cancelled). */
export async function pickOpenFile(): Promise<{ handle: FileSystemFileHandleLike; text: string } | null> {
    const w = fsaWindow();
    if (!w.showOpenFilePicker) return null;
    try {
        const [handle] = await w.showOpenFilePicker({
            types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
            multiple: false,
        });
        if (!handle) return null;
        const text = await (await handle.getFile()).text();
        return { handle, text };
    } catch {
        return null;
    }
}

/** Write text into a handle (truncating). */
export async function saveToHandle(handle: FileSystemFileHandleLike, text: string): Promise<void> {
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
}

/**
 * Ensure we hold readwrite permission for a handle, prompting if needed. Returns
 * false when the user denies (the caller should then drop the handle).
 */
export async function ensurePermission(handle: FileSystemFileHandleLike): Promise<boolean> {
    const desc: FsaPermissionDescriptor = { mode: 'readwrite' };
    if (handle.queryPermission) {
        if (await handle.queryPermission(desc) === 'granted') return true;
    }
    if (handle.requestPermission) {
        return await handle.requestPermission(desc) === 'granted';
    }
    // No permission API (older impl): assume usable.
    return true;
}

// ---- per-tree handle persistence ----
// In-memory cache is the source of truth for the session; IndexedDB is a
// best-effort backup so a linked file survives a reload (real FSA handles are
// structured-cloneable). IDB failures never break saving.

const handleCache = new Map<string, FileSystemFileHandleLike>();

export async function storeHandle(treeId: string, handle: FileSystemFileHandleLike): Promise<void> {
    handleCache.set(treeId, handle);
    try { await StorageManager.set('fileHandles', treeId, handle); } catch { /* best-effort */ }
}

export async function loadHandle(treeId: string): Promise<FileSystemFileHandleLike | null> {
    const cached = handleCache.get(treeId);
    if (cached) return cached;
    let stored: FileSystemFileHandleLike | null = null;
    try { stored = await StorageManager.get<FileSystemFileHandleLike>('fileHandles', treeId); } catch { stored = null; }
    if (stored) handleCache.set(treeId, stored);
    return stored;
}

export async function dropHandle(treeId: string): Promise<void> {
    handleCache.delete(treeId);
    try { await StorageManager.delete('fileHandles', treeId); } catch { /* best-effort */ }
}
