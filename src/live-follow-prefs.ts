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

/** The session trail in the fan and on the map (on by default). */
export function getFollowTrail(): boolean {
    return read(FOLLOW_PREF_KEYS.trail) !== '0';
}

export function setFollowTrail(on: boolean): void {
    write(FOLLOW_PREF_KEYS.trail, on ? null : '0');
}

function followKeys(): string[] {
    return allKeys().filter(k => k === FOLLOW_PREF_KEYS.view || k === FOLLOW_PREF_KEYS.fanCenter
        || k === FOLLOW_PREF_KEYS.trail || k.startsWith(FOLLOW_PREF_KEYS.fanPersonPrefix));
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
