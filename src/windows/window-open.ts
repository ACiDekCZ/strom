/**
 * Whether this window offers "Open in a new window" (⧉, spec 079 §1) and the
 * one way the app's controls open a satellite window. No DOM of its own and
 * nothing of the UI: the toolbar's ⧉ and its menu (window-controls.ts)
 * register the opener; the Table's bar and the view tabs call it.
 *
 * Condition (§1, the same everywhere): the main window, not an exported file,
 * wider than a phone (> 640 px, not a phone held sideways) and a computer's
 * system (Windows, macOS, Linux, ChromeOS), also with a touch screen and
 * without a keyboard; not Android, iOS or iPadOS, not even an iPad with a
 * trackpad. The system, not the pointer: a touch laptop's browser may report
 * its primary pointer as touch (tester, 12 Nov 2026: a Surface lost ⧉). Read
 * again on a resize. Elsewhere nothing is drawn and the shortcuts do nothing.
 */

import { getWindowRole } from './window-role.js';
import type { SatelliteKind } from './window-role.js';
import { MOBILE_MAX, isPhoneBar } from '../breakpoints.js';

/** What tells the system apart (navigator; a test passes its own). */
export interface SystemInfo {
    userAgent: string;
    /** navigator.maxTouchPoints: an iPad says "Macintosh" in its user agent but has touch points. */
    maxTouchPoints: number;
    /** navigator.userAgentData.mobile, where the browser has it. */
    mobile?: boolean;
    /** navigator.userAgentData.platform, where the browser has it ("Windows", "Android", …). */
    platform?: string;
}

/**
 * A computer's system (Windows, macOS, Linux, ChromeOS), whatever its
 * pointer: windows side by side are a desktop's way of working. Android,
 * iOS and iPadOS are not, also with a keyboard and a trackpad.
 */
export function isDesktopSystem(info: SystemInfo): boolean {
    const ua = info.userAgent || '';
    const platform = (info.platform || '').toLowerCase();
    if (info.mobile === true) return false;
    if (platform === 'android' || platform === 'ios') return false;
    if (/Android|iPhone|iPad|iPod/i.test(ua)) return false;
    // iPadOS asks for desktop pages as a Mac; a Mac has no touch points.
    if (/Macintosh|Mac OS X/i.test(ua)) return info.maxTouchPoints <= 1;
    if (/Windows|CrOS|Linux|X11/i.test(ua)) return true;
    return platform === 'windows' || platform === 'macos' || platform === 'linux' || platform === 'chrome os' || platform === 'chromeos';
}

/** This browser's system (navigator). */
export function currentSystem(): SystemInfo {
    if (typeof navigator === 'undefined') return { userAgent: '', maxTouchPoints: 0 };
    const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean; platform?: string } }).userAgentData;
    return {
        userAgent: navigator.userAgent || '',
        maxTouchPoints: navigator.maxTouchPoints || 0,
        mobile: uaData?.mobile,
        platform: uaData?.platform,
    };
}

/** What the condition reads (a test passes its own). */
export interface WindowOfferEnv {
    role: string;
    viewMode: boolean;
    width: number;
    phoneBar: boolean;
    /** A computer's system (isDesktopSystem). */
    desktopSystem: boolean;
}

/** The condition itself (§1). */
export function windowsOffered(env: WindowOfferEnv): boolean {
    return env.role === 'main' && !env.viewMode && env.width > MOBILE_MAX && !env.phoneBar && env.desktopSystem;
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
        desktopSystem: isDesktopSystem(currentSystem()),
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

/** Listen to changes of canOpenWindows() (resize). Returns the unsubscribe. */
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
}

/** The app redrew its chrome (a language switch, a view switch): the window controls follow. */
let refresher: (() => void) | null = null;

export function setWindowControlsRefresher(fn: (() => void) | null): void {
    refresher = fn;
}

export function refreshWindowControls(): void {
    refresher?.();
}
