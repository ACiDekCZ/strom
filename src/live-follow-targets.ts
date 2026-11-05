/**
 * Following the research agent in the fan (and, later, on the map): which
 * people are worked on, by which session, and what the fan centres on.
 * Pure logic, no DOM: the views draw from it.
 *
 * Sessions: every run of `working[]` that is not paused counts, in the order
 * of the "Now" list; its number is that position (1, 2, …). Numbers are shown
 * only when two or more runs work at once. Session 1 takes the app's primary
 * colour, the others the accent.
 */

import { PersonId } from './types.js';
import type { FanCenterSetting } from './live-follow-prefs.js';

/** What a working row needs here (a subset of LiveWorker). */
export interface WorkingRow {
    who: string;
    task: string;
    person?: string;
    paused?: unknown;
    /** A place of the record ("L0001"), when the research gives one (part of the map work). */
    place?: string;
}

/** One person worked on by one session. */
export interface FollowTarget {
    /** Index of the row in `working[]`. */
    row: number;
    /** 1-based session number (its place among the runs that are not paused). */
    session: number;
    personId: PersonId;
    task: string;
    who: string;
}

/** The session number of each row (null: paused); `numbered`: two or more run at once. */
export function sessionNumbers(working: readonly WorkingRow[]): { numbers: Array<number | null>; numbered: boolean } {
    let n = 0;
    const numbers = working.map(w => (w.paused ? null : ++n));
    return { numbers, numbered: n >= 2 };
}

/** The people worked on: one target per running row whose person is in the tree. */
export function followTargets(working: readonly WorkingRow[], personOf: (refn: string) => PersonId | null): FollowTarget[] {
    const { numbers } = sessionNumbers(working);
    const out: FollowTarget[] = [];
    working.forEach((w, row) => {
        const session = numbers[row];
        if (session === null || !w.person) return;
        const personId = personOf(w.person);
        if (personId) out.push({ row, session, personId, task: w.task, who: w.who });
    });
    return out;
}

/**
 * The rows whose person changed since the last look (a new row counts), and
 * the map to keep for the next look. Only these signal (the pulse).
 */
export function changedTargets(last: ReadonlyMap<number, PersonId>, targets: readonly FollowTarget[]): { changed: Set<number>; next: Map<number, PersonId> } {
    const changed = new Set<number>();
    const next = new Map<number, PersonId>();
    for (const t of targets) {
        next.set(t.row, t.personId);
        if (last.get(t.row) !== t.personId) changed.add(t.row);
    }
    return { changed, next };
}

/** The colour group of a session: the first one primary, the others accent. */
export function sessionTone(session: number): 'primary' | 'accent' {
    return session <= 1 ? 'primary' : 'accent';
}

/**
 * The fan's centre while following:
 * pinned ?? chosen person (setting 'person') ?? default person (setting 'root')
 * ?? the focus before following ?? the default person. A person no longer in
 * the tree is skipped (`exists`).
 */
export function fanCenter(o: {
    pinned: PersonId | null;
    setting: FanCenterSetting;
    chosen: PersonId | null;
    defaultPerson: PersonId | null;
    focusBefore: PersonId | null;
    exists: (id: PersonId) => boolean;
}): PersonId | null {
    const ok = (id: PersonId | null): PersonId | null => (id && o.exists(id) ? id : null);
    return ok(o.pinned)
        ?? (o.setting === 'person' ? ok(o.chosen) : null)
        ?? (o.setting === 'root' ? ok(o.defaultPerson) : null)
        ?? ok(o.focusBefore)
        ?? ok(o.defaultPerson);
}

// ------------------------------------------------------------ the session trail (memory only)

export interface TrailEntry {
    personId: PersonId;
    /** The place worked on (its key on the map), null when none. */
    placeKey: string | null;
    session: number;
    at: number;
    /** The place's position, when it has one (the map's trail draws only those). */
    geo?: { lat: number; lon: number } | null;
}

export const TRAIL_MAX = 8;
export const TRAIL_MAX_AGE_MS = 60 * 60 * 1000;
const TRAIL_OPACITY = [0.85, 0.7, 0.6, 0.5, 0.42, 0.35, 0.3, 0.25];

/** The trail with a new entry in front: at most 8, none older than 60 min (dropped here, not by a timer). */
export function pushTrail(trail: readonly TrailEntry[], entry: TrailEntry, now: number): TrailEntry[] {
    return [entry, ...trail].filter(e => now - e.at <= TRAIL_MAX_AGE_MS).slice(0, TRAIL_MAX);
}

/** The strength of the n-th trail entry (0 = the newest). */
export function trailOpacity(index: number): number {
    return TRAIL_OPACITY[Math.max(0, Math.min(TRAIL_OPACITY.length - 1, index))];
}
