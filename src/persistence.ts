/**
 * Persistent storage: ask the browser not to evict this origin's data
 * (navigator.storage.persist), report the result, and decide when the user
 * should hear that the browser may clear the trees.
 *
 * "Best-effort" storage (the default) can be cleared silently under storage
 * pressure. Chromium and Safari grant persistence by their own heuristics
 * (installed app, bookmark, engagement) without a prompt; Firefox asks.
 */

export type PersistenceState = 'persistent' | 'best-effort' | 'unsupported';

/** Window event fired once the request settles; detail: PersistenceState. */
export const PERSISTENCE_EVENT = 'strom:persistence';

interface StorageLike {
    persist?: () => Promise<boolean>;
    persisted?: () => Promise<boolean>;
}

function storageApi(): StorageLike | undefined {
    try {
        return typeof navigator !== 'undefined'
            ? (navigator as { storage?: StorageLike }).storage
            : undefined;
    } catch {
        return undefined;
    }
}

/** Current state without asking. Never throws. */
export async function getPersistenceState(): Promise<PersistenceState> {
    const storage = storageApi();
    if (!storage || typeof storage.persist !== 'function') return 'unsupported';
    try {
        if (typeof storage.persisted === 'function' && await storage.persisted()) return 'persistent';
    } catch {
        /* fall through */
    }
    return 'best-effort';
}

let persistenceAsked = false;
let lastRequestedState: PersistenceState | null = null;
let pendingRequest: Promise<PersistenceState | null> | null = null;

/** Outcome of this load's request, or null while none has settled. */
export function getRequestedPersistenceState(): PersistenceState | null {
    return lastRequestedState;
}

/**
 * Ask for persistent storage once per page load. Called when a tree with
 * people is saved — that follows a user action, and Firefox shows its
 * permission prompt only then, not on a bare visit. Chromium may grant it on a
 * later load, hence once per load rather than once ever. Fires
 * PERSISTENCE_EVENT with the outcome. Never throws.
 */
export function requestPersistentStorage(): Promise<PersistenceState | null> {
    if (persistenceAsked) return Promise.resolve(null);
    persistenceAsked = true;
    pendingRequest = askPersistence();
    return pendingRequest;
}

async function askPersistence(): Promise<PersistenceState> {
    let state = await getPersistenceState();
    if (state === 'best-effort') {
        try {
            if (await storageApi()!.persist!()) state = 'persistent';
        } catch {
            /* stays best-effort */
        }
    }
    lastRequestedState = state;
    if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
        window.dispatchEvent(new CustomEvent(PERSISTENCE_EVENT, { detail: state }));
    }
    return state;
}

/**
 * The state to act on now: waits for this load's request when one is still in
 * flight (a save asks, and a notice raised before the answer would warn about
 * storage the browser is about to make persistent). Never throws.
 */
export async function settledPersistenceState(): Promise<PersistenceState> {
    if (pendingRequest) await pendingRequest;
    return lastRequestedState ?? getPersistenceState();
}

/** Test hook: forget that persistence was asked in this page load. */
export function resetPersistenceRequestForTests(): void {
    persistenceAsked = false;
    lastRequestedState = null;
    pendingRequest = null;
}
