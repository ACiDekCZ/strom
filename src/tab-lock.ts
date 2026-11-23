/**
 * Every window of the app that holds a tree in memory (the main window, a
 * satellite) holds a Web Lock named `strom-tab-<its window id>` for its whole
 * life (spec 135). The image pool's cleanup asks which of them are held: an
 * image nothing stored names may then go at once when no other window of the
 * app runs (another tab's memory — its undo steps, an open dialog — is out of
 * this window's reach), and only after a week otherwise (media-pool.ts).
 * Without Web Locks every other window is taken to be there.
 */

export const TAB_LOCK_PREFIX = 'strom-tab-';

interface LockInfo { name?: string }

/** The part of the Web Locks API used here (a test passes its own). */
export interface TabLocks {
    request(name: string, callback: (lock: unknown) => Promise<unknown>): Promise<unknown>;
    query?(): Promise<{ held?: LockInfo[]; pending?: LockInfo[] }>;
}

function defaultLocks(): TabLocks | null {
    if (typeof navigator === 'undefined') return null;
    const locks = (navigator as Navigator & { locks?: TabLocks }).locks;
    return locks && typeof locks.request === 'function' ? locks : null;
}

/** The ids whose locks this window holds (or asked for). */
const own = new Set<string>();

/** Hold this window's lock for its whole life (once per id). */
export function holdTabLock(id: string, locks: TabLocks | null = defaultLocks()): void {
    if (!locks || !id || own.has(id)) return;
    own.add(id);
    locks.request(TAB_LOCK_PREFIX + id, () => new Promise<void>(() => { /* held until the window goes */ }))
        .catch(() => { own.delete(id); });
}

/**
 * Whether a window of the app other than this one and `known` (the
 * satellites whose memory this window can ask) runs in this browser. True
 * when it cannot be told (no Web Locks, or a failed query).
 */
export async function otherAppWindows(known: Iterable<string>, locks: TabLocks | null = defaultLocks()): Promise<boolean> {
    if (!locks || typeof locks.query !== 'function') return true;
    try {
        const snapshot = await locks.query();
        const skip = new Set([...own, ...known].map(id => TAB_LOCK_PREFIX + id));
        for (const lock of [...(snapshot.held ?? []), ...(snapshot.pending ?? [])]) {
            const name = typeof lock?.name === 'string' ? lock.name : '';
            if (name.startsWith(TAB_LOCK_PREFIX) && !skip.has(name)) return true;
        }
        return false;
    } catch {
        return true;
    }
}

/** Forget the locks this window holds (tests). */
export function resetTabLocksForTest(): void {
    own.clear();
}
