/**
 * A window that is not the main one becomes it (spec 079 §3.3 "Make this the
 * main window", §5 a second tab once the main window closed).
 *
 * The window takes the lock first (`ifAvailable`, never queued: when another
 * window holds it, nothing happens), then starts again as the main window
 * with a reload: the main window's start (storage, the tree from IndexedDB,
 * the toolbar, the research) is main.ts's own and a satellite or a second tab
 * has skipped all of it. The reload releases the lock for a moment; the new
 * page takes it again at its start, and for a few seconds it tries again if
 * it was not free yet (the mark below). A satellite never takes the lock by
 * itself, only on a click, so no window is waiting for that moment.
 *
 * A satellite keeps its tree and its view (the Table, with its state): the
 * reload point of the tab (view and person) and the Table's state go with
 * the mark in sessionStorage; the address loses `okno=` and names the tree.
 */

import type { HeldLock } from './window-role.js';

/** sessionStorage: this tab is starting as the main window (a satellite or a second tab before its reload). */
export const BECOME_MAIN_KEY = 'strom.win.becomeMain';
/** How long the mark counts after it was written (the reload takes far less). */
export const BECOME_MAIN_MARK_MS = 15000;
/** How long the new page keeps trying for the lock the old one released. */
export const BECOME_MAIN_RETRY_MS = 3000;
export const BECOME_MAIN_RETRY_STEP_MS = 100;

export interface BecomeMainMark {
    /** The tree the window showed (the main window opens it). */
    tree: string | null;
    /** The Table's state of a satellite (row type, view, filters, sort, search, row). */
    table?: unknown;
    at: number;
}

type SessionLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function sessionOrNull(): SessionLike | null {
    try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch { return null; }
}

export function writeBecomeMainMark(mark: BecomeMainMark, storage: SessionLike | null = sessionOrNull()): void {
    try { storage?.setItem(BECOME_MAIN_KEY, JSON.stringify(mark)); } catch { /* storage blocked */ }
}

/** The mark while it counts (null when missing, malformed or old); it stays until taken. */
export function peekBecomeMainMark(now = Date.now(), storage: SessionLike | null = sessionOrNull()): BecomeMainMark | null {
    let raw: string | null = null;
    try { raw = storage?.getItem(BECOME_MAIN_KEY) ?? null; } catch { return null; }
    if (!raw) return null;
    try {
        const d = JSON.parse(raw) as Partial<BecomeMainMark>;
        if (typeof d.at !== 'number' || now - d.at > BECOME_MAIN_MARK_MS || now < d.at - 1000) return null;
        return { tree: typeof d.tree === 'string' && d.tree ? d.tree : null, table: d.table, at: d.at };
    } catch {
        return null;
    }
}

/** The mark, used once: removed whatever it says. */
export function takeBecomeMainMark(now = Date.now(), storage: SessionLike | null = sessionOrNull()): BecomeMainMark | null {
    const mark = peekBecomeMainMark(now, storage);
    try { storage?.removeItem(BECOME_MAIN_KEY); } catch { /* storage blocked */ }
    return mark;
}

/**
 * The page that was to become the main window did not get the lock at its
 * start (the old page's release not through yet): try again for a while.
 */
export async function retryBecomeMain(
    tryLock: () => Promise<HeldLock | null>,
    wait: (ms: number) => Promise<void> = (ms) => new Promise(r => setTimeout(r, ms)),
    totalMs = BECOME_MAIN_RETRY_MS,
): Promise<HeldLock | null> {
    for (let spent = 0; spent < totalMs; spent += BECOME_MAIN_RETRY_STEP_MS) {
        await wait(BECOME_MAIN_RETRY_STEP_MS);
        const lock = await tryLock();
        if (lock) return lock;
    }
    return null;
}

export interface BecomeMainDeps {
    tryLock: () => Promise<HeldLock | null>;
    /** What the window writes before it starts again (the mark, the reload point, its address). */
    prepare: () => void;
    /** The start as the main window (a reload). */
    restart: () => void;
}

let becoming = false;

/**
 * Take the lock and start again as the main window. False when another window
 * holds it (or the window is already on its way): nothing happens then.
 */
export async function becomeMain(deps: BecomeMainDeps): Promise<boolean> {
    if (becoming) return false;
    becoming = true;
    let lock: HeldLock | null = null;
    try { lock = await deps.tryLock(); } catch { lock = null; }
    if (!lock) {
        becoming = false;
        return false;
    }
    // The lock is this window's until the reload releases it: no other window becomes the main one meanwhile.
    deps.prepare();
    deps.restart();
    return true;
}

/** Tests: another start. */
export function resetBecomeMainForTests(): void {
    becoming = false;
}
