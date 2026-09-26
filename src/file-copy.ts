/**
 * "Is this tree kept in a file too?" — the rules behind the unsaved-changes
 * indicator, the notice and the storage-status dialog. The trees live only in
 * the browser's storage; unless that storage is persistent, the browser may
 * clear it, and a file (an export, the attached working file, or the file the
 * tree was imported from) is the one copy that survives.
 *
 * Pure: the timestamps live in TreeMetadata (changedAt, fileCopyAt,
 * fileCopyNoticeClosedAt); tree-manager records them, the UI asks these functions.
 */

import type { PersistenceState } from './persistence.js';

export interface FileCopyInfo {
    /** Last edit of the user's (not a research update or a focus save). */
    changedAt?: string;
    /** Last full copy in a file: a full export, the working file, or the import. */
    fileCopyAt?: string;
    /** Last time the user closed the "changes only in the browser" notice. */
    fileCopyNoticeClosedAt?: string;
}

/** Trees this small do not raise the notice (the indicator still shows). */
export const FILE_COPY_NOTICE_MIN_PERSONS = 10;

function time(iso: string | undefined): number {
    const t = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(t) ? t : 0;
}

/** The tree has edits that no file holds. */
export function hasUnsavedChanges(info: FileCopyInfo): boolean {
    const changed = time(info.changedAt);
    return changed > 0 && changed > time(info.fileCopyAt);
}

/**
 * Show the notice? Only when the browser may clear the data, the tree has
 * edits that no file holds, and it is the user's own tree worth protecting.
 * It stays until closed; a closed notice returns only after the tree is
 * saved to a file and changed again (not on further edits, not on reload).
 */
export function shouldShowNotice(input: {
    state: PersistenceState;
    info: FileCopyInfo;
    personCount: number;
    viewMode: boolean;
    enabled: boolean;
}): boolean {
    const { state, info } = input;
    if (state === 'persistent' || input.viewMode || !input.enabled) return false;
    if (input.personCount < FILE_COPY_NOTICE_MIN_PERSONS) return false;
    if (!hasUnsavedChanges(info)) return false;
    const closed = time(info.fileCopyNoticeClosedAt);
    return closed === 0 || closed < time(info.fileCopyAt);
}

/** Trees with people whose edits no file holds (the indicator covers them all). */
export function unsavedTrees<T extends FileCopyInfo & { personCount: number }>(trees: readonly T[]): T[] {
    return trees.filter(t => t.personCount > 0 && hasUnsavedChanges(t));
}

/**
 * The "only in browser" indicator: some tree has edits no file holds and the
 * browser may clear them — any tree, not just the open one (edit one, switch
 * to another, and the first is still at risk).
 */
export function shouldShowUnsavedIndicator(input: {
    state: PersistenceState;
    unsavedCount: number;
    viewMode: boolean;
}): boolean {
    return input.state !== 'persistent' && !input.viewMode && input.unsavedCount > 0;
}

/**
 * What to recommend on this device:
 * - `install`: the browser offers to install the app right now (Chromium) —
 *   an installed app usually gets persistent storage; the notice gets a button;
 * - `install-menu`: Chromium in a tab without that offer (not yet eligible, or
 *   already installed and opened in a tab) — install / open it from the menu;
 * - `mac-dock`: Safari on a Mac — File → Add to Dock (own storage, like iOS);
 * - `ios-safari`: Safari on iPhone/iPad clears sites unused for 7 days; the
 *   home-screen app is exempt (and has its own storage);
 * - `ios-app`: the home-screen app — iOS still does not guarantee storage;
 * - `firefox`: Firefox on a computer asks before keeping data for good and
 *   cannot install web apps — allow it in the site permissions, or use
 *   Chrome/Edge for the installed app;
 * - `file`: nothing better than saving to a file regularly (installed apps, others).
 */
export type StorageAdvice = 'install' | 'install-menu' | 'mac-dock' | 'firefox' | 'ios-safari' | 'ios-app' | 'file';

export type BrowserFamily = 'chromium' | 'safari' | 'firefox' | 'other';

export function storageAdvice(env: {
    ios: boolean; standalone: boolean; canInstall: boolean; browser: BrowserFamily;
}): StorageAdvice {
    if (env.ios) return env.standalone ? 'ios-app' : 'ios-safari';
    if (env.standalone) return 'file';
    if (env.canInstall) return 'install';
    if (env.browser === 'chromium') return 'install-menu';
    if (env.browser === 'safari') return 'mac-dock';
    if (env.browser === 'firefox') return 'firefox';
    return 'file';
}

/** Chromium (Chrome, Edge, Opera, Brave…), Safari and Firefox on a computer, or anything else. */
export function browserFamily(userAgent: string, brands: readonly string[] = []): BrowserFamily {
    if (brands.some(b => /Chromium|Google Chrome|Microsoft Edge/.test(b))) return 'chromium';
    if (/Firefox|FxiOS/.test(userAgent)) return /Android|Mobile|FxiOS/.test(userAgent) ? 'other' : 'firefox';
    if (/Chrome\/|Chromium\/|Edg\/|OPR\//.test(userAgent)) return 'chromium';
    if (/Safari\//.test(userAgent) && /Macintosh/.test(userAgent)) return 'safari';
    return 'other';
}

/** Detect iPhone/iPad (iPadOS reports itself as a Mac with touch). */
export function isIosDevice(userAgent: string, platform: string, maxTouchPoints: number): boolean {
    return /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}
