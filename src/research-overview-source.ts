/**
 * What the Research overview draws without following (spec 057 §7.2): from
 * the bridge when it answers, else only what the tree holds and what the
 * research said last on this device. Pure helpers (no DOM).
 *
 * Without the bridge (or on a phone, which never asks it) the sections of
 * the agent's work (Now, Progress, Queue) have nothing to show: they are left
 * out, and one line under the sections names those the user did not hide.
 */

import type { ResearchLine, StromData } from './types.js';
import type { PrefKey, SectionPrefs } from './ui/live-section-prefs.js';

/** Where the overview's content comes from. */
export type OverviewSourceKind = 'live' | 'bridge' | 'tree';

/** The sections only the bridge fills (left out without it). */
export const BRIDGE_ONLY_SECTIONS: readonly PrefKey[] = ['working', 'changes', 'queue'];

/** The sections a bridge-less overview draws (when they have anything). */
export const TREE_SECTIONS: readonly PrefKey[] = ['waiting', 'directions', 'knows'];

/**
 * The sections the line "…: once the research is on." names: those only the
 * bridge fills, in the user's order, without the hidden ones (none: no line).
 */
export function afterTurnOnKeys(order: readonly PrefKey[], prefs: Readonly<SectionPrefs>): PrefKey[] {
    return order.filter(k => BRIDGE_ONLY_SECTIONS.includes(k) && prefs[k] !== 'hidden');
}

/** A line of the research as its file says it: its name and how many people stand in it. */
export interface SkeletonLine {
    id: string;
    name: string;
    persons: number;
}

/**
 * The research's lines from the tree's file (HEAD `_STROM_DIRECTION`), in its
 * order, each with its people (INDI places naming it); nothing of the work
 * on them (that is the bridge's). Empty: the file names none.
 */
export function skeletonLines(data: Pick<StromData, 'persons' | 'researchDirections'>): SkeletonLine[] {
    const lines: readonly ResearchLine[] = data.researchDirections?.lines ?? [];
    if (lines.length === 0) return [];
    const count = new Map<string, number>();
    for (const p of Object.values(data.persons)) {
        const seen = new Set<string>();
        for (const place of p.research?.places ?? []) {
            if (place.line && !seen.has(place.line)) {
                seen.add(place.line);
                count.set(place.line, (count.get(place.line) ?? 0) + 1);
            }
        }
    }
    return lines.map(l => ({ id: l.id, name: l.name || l.id, persons: count.get(l.id) ?? 0 }));
}
