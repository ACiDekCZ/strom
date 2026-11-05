/**
 * Settings › Research following: where following the agent runs and how the
 * fan is centred while it does. Kept per device (localStorage); the chosen
 * fan centre per tree. Missing or unreadable values give the defaults.
 */

import { PersonId } from './types.js';

export type FollowView = 'family' | 'fan' | 'map';
export type FanCenterSetting = 'focus' | 'root' | 'person';

export const FOLLOW_VIEWS: readonly FollowView[] = ['family', 'fan', 'map'];
export const FAN_CENTER_SETTINGS: readonly FanCenterSetting[] = ['focus', 'root', 'person'];

export const FOLLOW_PREF_KEYS = {
    view: 'strom-live-follow-view',
    fanCenter: 'strom-live-follow-fan-center',
    fanPersonPrefix: 'strom-live-follow-fan-person:',
    trail: 'strom-live-follow-trail',
    /** Motion when a live load brings changes (spec 055 §4): '0' off, missing or '1' on. */
    motion: 'strom-live-motion',
    /** The focus before following, per tree (not a setting: what the fan centres on when following starts again). */
    focusBeforePrefix: 'strom-live-follow-focus-before:',
} as const;

function read(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
}

function write(key: string, value: string | null): void {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    } catch { /* not kept */ }
}

function allKeys(): string[] {
    try {
        const out: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k) out.push(k);
        }
        return out;
    } catch { return []; }
}

/** The view following starts in (and Back to the agent returns to when nothing else is known). */
export function getFollowView(): FollowView {
    const v = read(FOLLOW_PREF_KEYS.view);
    return (FOLLOW_VIEWS as readonly string[]).includes(v ?? '') ? v as FollowView : 'family';
}

export function setFollowView(view: FollowView): void {
    write(FOLLOW_PREF_KEYS.view, view === 'family' ? null : view);
}

export function getFanCenterSetting(): FanCenterSetting {
    const v = read(FOLLOW_PREF_KEYS.fanCenter);
    return (FAN_CENTER_SETTINGS as readonly string[]).includes(v ?? '') ? v as FanCenterSetting : 'focus';
}

export function setFanCenterSetting(setting: FanCenterSetting): void {
    write(FOLLOW_PREF_KEYS.fanCenter, setting === 'focus' ? null : setting);
}

/** The person chosen as the fan's centre for one tree (null: none). */
export function getFanPerson(treeId: string): PersonId | null {
    const v = read(FOLLOW_PREF_KEYS.fanPersonPrefix + treeId);
    return v ? v as PersonId : null;
}

export function setFanPerson(treeId: string, personId: PersonId | null): void {
    write(FOLLOW_PREF_KEYS.fanPersonPrefix + treeId, personId);
}

/** Another tree that has a chosen person (the last one found), for the "set for the tree …" note. */
export function fanPersonOtherTree(treeId: string | null): string | null {
    let found: string | null = null;
    for (const k of allKeys()) {
        if (!k.startsWith(FOLLOW_PREF_KEYS.fanPersonPrefix)) continue;
        const id = k.slice(FOLLOW_PREF_KEYS.fanPersonPrefix.length);
        if (id && id !== treeId) found = id;
    }
    return found;
}

/**
 * The person focused before following, kept per tree over a reload: the tree
 * opens again on the person the last jump focused, and the fan must not take
 * that one for the user's own focus.
 */
export function getFocusBefore(treeId: string): PersonId | null {
    const v = read(FOLLOW_PREF_KEYS.focusBeforePrefix + treeId);
    return v ? v as PersonId : null;
}

export function setFocusBefore(treeId: string, personId: PersonId | null): void {
    write(FOLLOW_PREF_KEYS.focusBeforePrefix + treeId, personId);
}

/** The session trail in the fan and on the map (on by default). */
export function getFollowTrail(): boolean {
    return read(FOLLOW_PREF_KEYS.trail) !== '0';
}

export function setFollowTrail(on: boolean): void {
    write(FOLLOW_PREF_KEYS.trail, on ? null : '0');
}

/** Motion when changes load (on by default): new people grow out of their line, the others move. */
export function getLiveMotion(): boolean {
    return read(FOLLOW_PREF_KEYS.motion) !== '0';
}

export function setLiveMotion(on: boolean): void {
    write(FOLLOW_PREF_KEYS.motion, on ? null : '0');
}

function followKeys(): string[] {
    return allKeys().filter(k => k === FOLLOW_PREF_KEYS.view || k === FOLLOW_PREF_KEYS.fanCenter
        || k === FOLLOW_PREF_KEYS.trail || k === FOLLOW_PREF_KEYS.motion || k.startsWith(FOLLOW_PREF_KEYS.fanPersonPrefix));
}

/** Something differs from the defaults (Reset to defaults has work to do). */
export function hasFollowPrefs(): boolean {
    return followKeys().length > 0;
}

/** Back to the defaults; the snapshot brings them back (Undo). */
export function resetFollowPrefs(): Record<string, string> {
    const snap: Record<string, string> = {};
    for (const k of followKeys()) {
        const v = read(k);
        if (v !== null) snap[k] = v;
        write(k, null);
    }
    return snap;
}

export function restoreFollowPrefs(snap: Record<string, string>): void {
    for (const [k, v] of Object.entries(snap)) write(k, v);
}
