/**
 * "Is this tree kept in a file too?" — the rules behind the unsaved-changes
 * indicator, the notice and the storage-status dialog. The trees live only in
 * the browser's storage; unless that storage is persistent, the browser may
 * clear it, and a file (an export, the attached working file, or the file the
 * tree was imported from) is the one copy that survives.
 *
 * Pure: the timestamps live in TreeMetadata (changedAt, fileCopyAt,
 * fileCopyNoticeAt); tree-manager records them, the UI asks these functions.
 */

import type { PersistenceState } from './persistence.js';

export interface FileCopyInfo {
    /** Last edit of the user's (not a research update or a focus save). */
    changedAt?: string;
    /** Last full copy in a file: a full export, the working file, or the import. */
    fileCopyAt?: string;
    /** Last time the "changes only in the browser" notice was shown. */
    fileCopyNoticeAt?: string;
}

/** Trees this small do not raise the notice (the indicator still shows). */
export const FILE_COPY_NOTICE_MIN_PERSONS = 10;

/** A tree still unsaved this long after the notice gets it once more. */
export const FILE_COPY_REMIND_MS = 7 * 24 * 60 * 60 * 1000;

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
 * Raise the notice now? Only when the browser may clear the data, the tree has
 * edits that no file holds, and it is the user's own tree worth protecting.
 * Once per stretch of unsaved work: again only after a newer file copy, or
 * when the work has stayed unsaved for a week since the last notice.
 */
export function shouldNoticeUnsaved(input: {
    state: PersistenceState;
    info: FileCopyInfo;
    personCount: number;
    viewMode: boolean;
    enabled: boolean;
    now: number;
}): boolean {
    const { state, info } = input;
    if (state === 'persistent' || input.viewMode || !input.enabled) return false;
    if (input.personCount < FILE_COPY_NOTICE_MIN_PERSONS) return false;
    if (!hasUnsavedChanges(info)) return false;
    const noticed = time(info.fileCopyNoticeAt);
    if (noticed === 0 || noticed < time(info.fileCopyAt)) return true;
    return input.now - noticed >= FILE_COPY_REMIND_MS;
}

/** The unsaved-changes indicator in the toolbar. */
export function shouldShowUnsavedIndicator(input: {
    state: PersistenceState;
    info: FileCopyInfo;
    personCount: number;
    viewMode: boolean;
}): boolean {
    return input.state !== 'persistent' && !input.viewMode
        && input.personCount > 0 && hasUnsavedChanges(input.info);
}

/**
 * What to recommend on this device:
 * - `install`: the browser offers to install the app (Chromium, desktop or
 *   Android) — an installed app usually gets persistent storage;
 * - `ios-safari`: Safari on iPhone/iPad clears sites unused for 7 days; the
 *   home-screen app is exempt (and has its own storage);
 * - `ios-app`: the home-screen app — iOS still does not guarantee storage;
 * - `file`: nothing better than saving to a file regularly.
 */
export type StorageAdvice = 'install' | 'ios-safari' | 'ios-app' | 'file';

export function storageAdvice(env: { ios: boolean; standalone: boolean; canInstall: boolean }): StorageAdvice {
    if (env.ios) return env.standalone ? 'ios-app' : 'ios-safari';
    if (env.canInstall && !env.standalone) return 'install';
    return 'file';
}

/** Detect iPhone/iPad (iPadOS reports itself as a Mac with touch). */
export function isIosDevice(userAgent: string, platform: string, maxTouchPoints: number): boolean {
    return /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}
