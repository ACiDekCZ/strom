/**
 * What holds pooled images beyond the stored trees and backups: the cleanup's
 * 'memory' references (media-pool.ts, spec 135 D7).
 *
 * The tree in memory holds its images as pool references (`\u0000sm:<id>`),
 * and so do the states around it that no record names: the undo and redo
 * steps, the state a dialog or a batch goes back to, the person dialog's
 * portrait, the research bridge's images held for the next file, the
 * satellite windows (their trees and open edits, asked through the main
 * window), and two stores the trees' and backups' records do not cover: the
 * rescue copies of saves the page left before they landed (localStorage) and
 * the merge sessions and their backups ('merge' store).
 *
 * In-memory holders register themselves (a module not loaded holds nothing).
 * Another tab's memory is out of reach: the cleanup's second phase (a week
 * before a removal) covers it.
 */

import { registerPoolReferences } from './media-pool.js';
import { StorageManager } from './storage.js';
import { poolIdOf } from './image-ref.js';

/** Gives the content ids of the pooled images a holder keeps now. */
export type MemoryImageHolder = () => Iterable<string>;

const holders = new Set<MemoryImageHolder>();

/** Register a holder of pooled images in this window's memory; returns the unregister. */
export function registerMemoryImages(holder: MemoryImageHolder): () => void {
    holders.add(holder);
    return () => { holders.delete(holder); };
}

/** The content ids every holder of this window keeps now (a holder that throws is skipped). */
export function memoryImageIds(): Set<string> {
    const out = new Set<string>();
    for (const holder of holders) {
        try {
            for (const id of holder()) if (typeof id === 'string') out.add(id);
        } catch (err) {
            console.warn('An image holder could not be asked', err);
        }
    }
    return out;
}

/** The content id of a value that is a pool reference, as a list (for holders). */
export function poolIdsOf(values: Iterable<unknown>): string[] {
    const out: string[] = [];
    for (const v of values) {
        const id = poolIdOf(v);
        if (id) out.push(id);
    }
    return out;
}

/** Every pool reference anywhere in `value` (plain objects, arrays, Maps). */
export function collectPoolRefIds(value: unknown, out: Set<string>, depth = 0): Set<string> {
    if (typeof value === 'string') {
        const id = value.length === 46 ? poolIdOf(value) : null;
        if (id) out.add(id);
        return out;
    }
    if (!value || typeof value !== 'object' || depth > 64) return out;
    if (Array.isArray(value)) {
        for (const v of value) collectPoolRefIds(v, out, depth + 1);
    } else if (value instanceof Map) {
        for (const [k, v] of value) { collectPoolRefIds(k, out, depth + 1); collectPoolRefIds(v, out, depth + 1); }
    } else if (!ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer)) {
        for (const v of Object.values(value as Record<string, unknown>)) collectPoolRefIds(v, out, depth + 1);
    }
    return out;
}

/** A pool reference as JSON writes it (the NUL escaped). */
const REF_IN_JSON = /\\u0000sm:([pe]:[0-9a-f]{40})"/g;

/** The images the rescue copies in localStorage name (their JSON read as text). */
async function rescueCopyIds(out: Set<string>): Promise<void> {
    const { RESCUE_PREFIX } = await import('./tree-manager.js');
    try {
        if (typeof localStorage === 'undefined') return;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key?.startsWith(RESCUE_PREFIX)) continue;
            const text = localStorage.getItem(key);
            if (text) for (const m of text.matchAll(REF_IN_JSON)) out.add(m[1]);
        }
    } catch { /* no storage */ }
}

/** The images the merge sessions and the merge's backups name (one record at a time). */
async function mergeStoreIds(out: Set<string>): Promise<void> {
    for (const key of await StorageManager.keys('merge')) {
        collectPoolRefIds(await StorageManager.get<unknown>('merge', key), out);
    }
}

registerPoolReferences('memory', async () => {
    const out = memoryImageIds();
    await rescueCopyIds(out);
    await mergeStoreIds(out);
    return out;
});
