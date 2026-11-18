/**
 * Leaving the page while work goes on (waiting buttons §2.7): the browser asks
 * first (`beforeunload`) while something is written to the research or the
 * tree is being loaded from it, and while a file is saved or read. A write also leaves a note in sessionStorage
 * (`strom.busy.pending`), taken away at its end: a note still there when the
 * page loads again means its result is not known, said by a toast with
 * "Find out".
 */

import { strings } from '../strings.js';

/** What was going on (`export` / `import`: a file being saved or read, §2.7 – only asked, no note). */
export type BusyLeaveKind = 'send' | 'adopt' | 'load' | 'export' | 'import';

export const BUSY_PENDING_KEY = 'strom.busy.pending';

/** The note a write leaves. */
export interface BusyPending {
    kind: BusyLeaveKind;
    treeId: string | null;
    startedAt: number;
}

/** Only a write leaves a note (a load interrupted changes nothing). */
function writes(kind: BusyLeaveKind): boolean {
    return kind === 'send' || kind === 'adopt';
}

let held = 0;
let listening = false;
/** The notes of the writes going now (the last one goes into storage). */
const notes: BusyPending[] = [];

function onLeave(e: BeforeUnloadEvent): void {
    if (held <= 0) return;
    e.preventDefault();
    e.returnValue = strings.busy.unknownAfterLeave;
}

function store(): void {
    try {
        if (typeof sessionStorage === 'undefined') return;
        const last = notes[notes.length - 1];
        if (last) sessionStorage.setItem(BUSY_PENDING_KEY, JSON.stringify(last));
        else sessionStorage.removeItem(BUSY_PENDING_KEY);
    } catch { /* storage blocked: only the question on leaving */ }
}

/** Parse a stored note (null: none, or not one). */
export function parseBusyPending(raw: string | null): BusyPending | null {
    if (!raw) return null;
    try {
        const v = JSON.parse(raw) as Partial<BusyPending> | null;
        if (!v || (v.kind !== 'send' && v.kind !== 'adopt' && v.kind !== 'load') || typeof v.startedAt !== 'number') return null;
        return { kind: v.kind, treeId: typeof v.treeId === 'string' ? v.treeId : null, startedAt: v.startedAt };
    } catch {
        return null;
    }
}

/**
 * Work that must not be left unasked starts: the browser asks before leaving until the returned function is
 * called; a write leaves its note meanwhile.
 */
export function holdLeave(kind: BusyLeaveKind, treeId: string | null = null, now = Date.now()): () => void {
    if (!listening && typeof window !== 'undefined') {
        window.addEventListener('beforeunload', onLeave);
        listening = true;
    }
    held++;
    const note: BusyPending | null = writes(kind) ? { kind, treeId, startedAt: now } : null;
    if (note) {
        notes.push(note);
        store();
    }
    let released = false;
    return () => {
        if (released) return;
        released = true;
        held = Math.max(0, held - 1);
        if (note) {
            const i = notes.indexOf(note);
            if (i >= 0) notes.splice(i, 1);
            store();
        }
    };
}

/** Whether leaving now asks first. */
export function leaveHeld(): boolean {
    return held > 0;
}

/** The note a page left before it was closed (taken away: said once). */
export function takeLeftPending(): BusyPending | null {
    try {
        if (typeof sessionStorage === 'undefined') return null;
        const got = parseBusyPending(sessionStorage.getItem(BUSY_PENDING_KEY));
        sessionStorage.removeItem(BUSY_PENDING_KEY);
        return got;
    } catch {
        return null;
    }
}

/** For the tests: nothing held. */
export function resetBusyLeave(): void {
    held = 0;
    notes.length = 0;
    store();
}
