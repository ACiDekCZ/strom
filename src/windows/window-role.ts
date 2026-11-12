/**
 * The role of this window among the app's windows (spec 079 §0).
 *
 * - `main`: holds the Web Lock `strom-main` for its whole life; the only
 *   window that reads and writes storage, runs the research and saves.
 * - `satellite`: opened with `?okno=<kind>&tree=<id>&w=<id>`; shows one view
 *   of the main window's tree and sends its edits there. Never takes the lock.
 * - `second-tab`: the lock is held by another window; nothing is loaded or
 *   written (§5).
 * - `none`: an exported file (view mode) or a browser without Web Locks or
 *   BroadcastChannel: everything works as before windows existed.
 *
 * A window never waits for the lock in the queue (only `ifAvailable`): a
 * queued request would take the lock from the main window while it reloads.
 */

import type { TreeId, ViewMode } from '../types.js';

export type WindowRole = 'main' | 'satellite' | 'second-tab' | 'none';

/** What a satellite window shows: one of the views, or the research overview (K3). */
export type SatelliteKind = ViewMode | 'overview';

export const SATELLITE_KINDS: readonly SatelliteKind[] = ['family', 'descendants', 'timeline', 'fan', 'map', 'table', 'overview'];

/** The Web Lock the main window holds. */
export const MAIN_LOCK = 'strom-main';
/** window.name of the main window (window.open('', name) finds it again, also after its reload). */
export const MAIN_WINDOW_NAME = 'strom-main';

/** window.name of a satellite window. */
export function satelliteWindowName(windowId: string): string {
    return `strom-w-${windowId}`;
}

/** A satellite's address parameters. */
export interface SatelliteParams {
    kind: SatelliteKind;
    /** The tree the window was opened for (the main window may have another open: it sends its own). */
    treeId: TreeId | null;
    windowId: string;
    /** `w=` was missing or malformed: a new id was made (the caller writes it into the address). */
    newId: boolean;
}

/** A short random window id (8 hex characters). */
export function newWindowId(): string {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
        }
    } catch { /* no crypto: below */ }
    return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
}

const WINDOW_ID = /^[A-Za-z0-9_-]{4,40}$/;

/**
 * The satellite parameters of an address (`location.search`), or null when it
 * has no `okno=`. A kind this version does not know opens the Table: the
 * window was meant to be a satellite, and a satellite it stays.
 */
export function parseSatelliteParams(search: string): SatelliteParams | null {
    const params = new URLSearchParams(search);
    if (!params.has('okno')) return null;
    const raw = params.get('okno') ?? '';
    const kind: SatelliteKind = (SATELLITE_KINDS as readonly string[]).includes(raw) ? raw as SatelliteKind : 'table';
    const tree = params.get('tree');
    const w = params.get('w') ?? '';
    const valid = WINDOW_ID.test(w);
    return { kind, treeId: tree ? tree as TreeId : null, windowId: valid ? w : newWindowId(), newId: !valid };
}

/**
 * The view a satellite of this kind shows. The research overview has no
 * window of its own before K3: until then it opens the Table.
 */
export function satelliteViewMode(kind: SatelliteKind): ViewMode {
    return kind === 'overview' ? 'table' : kind;
}

/** The address of a satellite window, relative to the app ('./?okno=…'). */
export function satelliteUrl(kind: SatelliteKind, treeId: TreeId | null, windowId: string): string {
    const params = new URLSearchParams();
    params.set('okno', kind);
    if (treeId) params.set('tree', treeId);
    params.set('w', windowId);
    return `./?${params.toString()}`;
}

/** The lock, held until released (the main window never releases it: closing the window does). */
export interface HeldLock {
    release(): void;
}

/** The part of `navigator.locks` the roles use (injectable for tests). */
export interface LocksLike {
    request(name: string, options: { ifAvailable: boolean }, callback: (lock: unknown) => unknown): Promise<unknown>;
    query?(): Promise<{ held?: { name?: string }[] }>;
}

function defaultLocks(): LocksLike | null {
    if (typeof navigator === 'undefined') return null;
    const locks = (navigator as Navigator & { locks?: LocksLike }).locks;
    return locks && typeof locks.request === 'function' ? locks : null;
}

/**
 * Take the main window's lock if no window holds it (never waits in the
 * queue). Resolves with the held lock, or null when another window has it.
 * Used at start and by "Make this the main window" (§3.3).
 */
export function tryBecomeMain(locks: LocksLike | null = defaultLocks()): Promise<HeldLock | null> {
    if (!locks) return Promise.resolve(null);
    return new Promise((resolve) => {
        let settled = false;
        const done = (v: HeldLock | null) => { if (!settled) { settled = true; resolve(v); } };
        locks.request(MAIN_LOCK, { ifAvailable: true }, (lock) => {
            if (!lock) { done(null); return undefined; }
            // Held while this promise is pending: for the window's whole life.
            return new Promise<void>((release) => done({ release: () => release() }));
        }).catch(() => done(null));
    });
}

/**
 * Whether a main window holds the lock now (seen without taking it). A
 * satellite asks before saying the main window is closed: a hidden main
 * window's heartbeat may be throttled. Null when it cannot be told.
 */
export async function isMainAlive(locks: LocksLike | null = defaultLocks()): Promise<boolean | null> {
    if (!locks?.query) return null;
    try {
        const state = await locks.query();
        return (state.held ?? []).some(l => l.name === MAIN_LOCK);
    } catch {
        return null;
    }
}

/** What the start of the app knows when it picks the role. */
export interface RoleEnvironment {
    /** `location.search` */
    search: string;
    /** The page is an exported file (window.STROM_EMBEDDED_DATA): view mode, no windows. */
    embedded: boolean;
    /** `navigator.locks` (null: not supported) */
    locks: LocksLike | null;
    /** BroadcastChannel exists */
    hasChannel: boolean;
}

export interface RoleDecision {
    role: WindowRole;
    /** role 'satellite': its parameters */
    satellite?: SatelliteParams;
    /** role 'main': the lock it holds */
    lock?: HeldLock;
}

function defaultEnvironment(): RoleEnvironment {
    return {
        search: typeof location !== 'undefined' ? location.search : '',
        embedded: typeof window !== 'undefined' && !!(window as Window & { STROM_EMBEDDED_DATA?: unknown }).STROM_EMBEDDED_DATA,
        locks: defaultLocks(),
        hasChannel: typeof BroadcastChannel !== 'undefined',
    };
}

/** Pick this window's role at start (§0 "Start"). */
export async function decideWindowRole(env: Partial<RoleEnvironment> = {}): Promise<RoleDecision> {
    const e: RoleEnvironment = { ...defaultEnvironment(), ...env };
    if (e.embedded || !e.locks || !e.hasChannel) return { role: 'none' };
    const satellite = parseSatelliteParams(e.search);
    if (satellite) return { role: 'satellite', satellite };
    const lock = await tryBecomeMain(e.locks);
    return lock ? { role: 'main', lock } : { role: 'second-tab' };
}

let currentRole: WindowRole = 'none';

/** The role this window has now (set once at start, and by "Make this the main window"). */
export function getWindowRole(): WindowRole {
    return currentRole;
}

export function setWindowRole(role: WindowRole): void {
    currentRole = role;
}
