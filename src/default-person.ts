/**
 * The tree's default person (spec 111): one rule for the person a tree opens
 * on (DataManager.getStartupFocus, the renderer's first focus) and for the
 * target of "Focus default person" (⌂ beside "Focused on", src/ui/default-focus.ts).
 * Pure: reads only the data handed in.
 */

import { type PersonId, type StromData } from './types.js';
import { LAST_FOCUSED } from './model-values.js';

type DefaultData = Pick<StromData, 'persons' | 'defaultPersonId' | 'lastFocusPersonId'>;

/**
 * Why a person is the one a tree opens on: the person set in "Default person
 * and view" ('specific'), the last focused one ('last'), the first person of
 * the tree ('first', also when "Last focused" has none yet) or the first
 * person because the one set is gone ('fallbackFirst').
 */
export type StartupReason = 'specific' | 'last' | 'first' | 'fallbackFirst';

/** The person a tree opens on by its setting; null for an empty tree. */
export function startupPerson(data: DefaultData): { id: PersonId; reason: StartupReason } | null {
    const ids = Object.keys(data.persons) as PersonId[];
    if (ids.length === 0) return null;
    const first = ids[0];
    const setting = data.defaultPersonId;
    if (setting === LAST_FOCUSED) {
        const last = data.lastFocusPersonId;
        if (last && data.persons[last]) return { id: last, reason: 'last' };
        return { id: first, reason: 'first' };
    }
    if (setting !== undefined) {
        return data.persons[setting] ? { id: setting, reason: 'specific' } : { id: first, reason: 'fallbackFirst' };
    }
    return { id: first, reason: 'first' };
}

/**
 * Why a person is the target of ⌂: the person set ('specific'), the first
 * person ('first'), the person the tree was focused on when it opened, for
 * "Last focused" ('opened'), or the first person because the one set is gone
 * ('fallbackFirst').
 */
export type DefaultReason = 'specific' | 'first' | 'opened' | 'fallbackFirst';
export interface DefaultTarget { id: PersonId; reason: DefaultReason }

/**
 * The target of "Focus default person". `openedId`: the person the tree was
 * focused on when it opened (or was switched to). `fallbackToFirst` (spec 111
 * K1.5): true = a person set and gone, or "Last focused" with no opened
 * person, gives the first person, as opening the tree does (variant A);
 * false = no target (variant B). An empty tree has none.
 */
export function defaultTarget(data: DefaultData, openedId: PersonId | null, fallbackToFirst: boolean): DefaultTarget | null {
    const ids = Object.keys(data.persons) as PersonId[];
    if (ids.length === 0) return null;
    const first = ids[0];
    const setting = data.defaultPersonId;
    if (setting === LAST_FOCUSED) {
        if (openedId && data.persons[openedId]) return { id: openedId, reason: 'opened' };
        return fallbackToFirst ? { id: first, reason: 'first' } : null;
    }
    if (setting !== undefined) {
        if (data.persons[setting]) return { id: setting, reason: 'specific' };
        return fallbackToFirst ? { id: first, reason: 'fallbackFirst' } : null;
    }
    return { id: first, reason: 'first' };
}
