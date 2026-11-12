/**
 * Whether this window offers "Open in a new window" (⧉, spec 079 §1) and the
 * one way the app's controls open a satellite window. No DOM of its own and
 * nothing of the UI: the toolbar's ⧉ and its menu (window-controls.ts)
 * register the opener; the Table's bar and the view tabs call it.
 *
 * Condition (§1, the same everywhere): the main window, not an exported file,
 * wider than a phone (> 640 px, not a phone held sideways) and a mouse
 * (`(hover: hover) and (pointer: fine)`). Read again on a resize and a change
 * of the pointer media query. Elsewhere nothing is drawn and the shortcuts do
 * nothing.
 */

import { getWindowRole } from './window-role.js';
import type { SatelliteKind } from './window-role.js';
import { MOBILE_MAX, isPhoneBar } from '../breakpoints.js';

/** A mouse (or a pen with hover): the windows are for a desktop's pointer. */
export const MQ_FINE_POINTER = '(hover: hover) and (pointer: fine)';

/** What the condition reads (a test passes its own). */
export interface WindowOfferEnv {
    role: string;
    viewMode: boolean;
    width: number;
    phoneBar: boolean;
    finePointer: boolean;
}

/** The condition itself (§1). */
export function windowsOffered(env: WindowOfferEnv): boolean {
    return env.role === 'main' && !env.viewMode && env.width > MOBILE_MAX && !env.phoneBar && env.finePointer;
}

let viewModeCheck: () => boolean = () => false;
let opener: ((kind: SatelliteKind, initial?: unknown) => void) | null = null;
const listeners = new Set<() => void>();
let lastOffered: boolean | null = null;
let watching = false;

/** The exported file's check (DataManager.isViewMode), given at start so this module needs no DataManager. */
export function setViewModeCheck(check: () => boolean): void {
    viewModeCheck = check;
}

function currentEnv(): WindowOfferEnv {
    const hasWindow = typeof window !== 'undefined';
    return {
        role: getWindowRole(),
        viewMode: viewModeCheck(),
        width: hasWindow ? window.innerWidth : 0,
        phoneBar: hasWindow ? isPhoneBar() : false,
        finePointer: hasWindow && typeof window.matchMedia === 'function' && window.matchMedia(MQ_FINE_POINTER).matches,
    };
}

/** This window may open satellite windows now (§1). */
export function canOpenWindows(): boolean {
    return opener !== null && windowsOffered(currentEnv());
}

/** The main window's way to open a satellite (window-controls.ts). */
export function setWindowOpener(fn: ((kind: SatelliteKind, initial?: unknown) => void) | null): void {
    opener = fn;
    watchOffer();
    notifyOffer(true);
}

/**
 * Open a view in a new window, when this window offers it. Call it from a
 * click's handler only (a browser blocks a window opened later). True when
 * it was asked for (a blocked window is said by the opener).
 */
export function openInNewWindow(kind: SatelliteKind, initial?: unknown): boolean {
    if (!opener || !canOpenWindows()) return false;
    opener(kind, initial);
    return true;
}

/** Listen to changes of canOpenWindows() (resize, pointer). Returns the unsubscribe. */
export function onWindowOfferChange(cb: () => void): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
}

function notifyOffer(force: boolean): void {
    const now = canOpenWindows();
    if (!force && now === lastOffered) return;
    lastOffered = now;
    for (const cb of [...listeners]) {
        try { cb(); } catch (err) { console.error('window offer listener failed', err); }
    }
}

function watchOffer(): void {
    if (watching || typeof window === 'undefined') return;
    watching = true;
    window.addEventListener('resize', () => notifyOffer(false));
    if (typeof window.matchMedia === 'function') {
        const mq = window.matchMedia(MQ_FINE_POINTER);
        const changed = () => notifyOffer(false);
        if (typeof mq.addEventListener === 'function') mq.addEventListener('change', changed);
        else if (typeof (mq as MediaQueryList).addListener === 'function') (mq as MediaQueryList).addListener(changed);
    }
}

/** The app redrew its chrome (a language switch, a view switch): the window controls follow. */
let refresher: (() => void) | null = null;

export function setWindowControlsRefresher(fn: (() => void) | null): void {
    refresher = fn;
}

export function refreshWindowControls(): void {
    refresher?.();
}
