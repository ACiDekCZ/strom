/**
 * A live load of the research's tree (spec 055): what changed between the
 * tree shown and the one just loaded, person by person, for the transition
 * that follows (src/live-transition.ts, TreeRenderer.renderLive) and for the
 * screen reader's announcement.
 *
 * Runs after stabilizeIds: a person who stays keeps their id. A person who
 * disappears while another one close to them (same surname, birth year ±1,
 * a parent or partner in common) changes reads as merged into that one —
 * the bridge does not say so; the guess only steers the animation (the gone
 * card flows into the one that stays) and the announcement.
 *
 * Pure: no DOM.
 */

import type { PersonId, Person, StromData } from './types.js';
import { yearOf } from './dates.js';

export interface LiveDiff {
    /** People in the new tree only. */
    added: PersonId[];
    /** People in the old tree only (not merged). */
    removed: PersonId[];
    /** People in both whose own data changed: the fields that differ. */
    changed: Map<PersonId, string[]>;
    /** A person gone → the one they were merged into (it stays). */
    merged: Map<PersonId, PersonId>;
    /** People drawn in both states whose place changed (filled by the renderer). */
    moved: PersonId[];
}

/** Fields that are no data of the person's own (relations, the research's bookkeeping). */
const NOT_OWN = new Set<string>([
    'id', 'partnerships', 'parentIds', 'childIds', 'refn', 'refnType', 'research',
    'dismissedMarriedSuggestion', 'gedcomDates',
]);

function same(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === undefined || b === undefined || a === null || b === null) {
        // An empty value and a missing one are the same on a card.
        const empty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
        return empty(a) && empty(b);
    }
    return JSON.stringify(a) === JSON.stringify(b);
}

/** The fields of the person's own data that differ (sorted). */
export function changedFields(a: Person, b: Person): string[] {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const out: string[] = [];
    for (const k of keys) {
        if (NOT_OWN.has(k)) continue;
        if (!same((a as unknown as Record<string, unknown>)[k], (b as unknown as Record<string, unknown>)[k])) out.push(k);
    }
    return out.sort();
}

/** Whether a person's relations differ (parents, children, unions). */
function relationsChanged(a: Person, b: Person): boolean {
    const set = (v: readonly string[] | undefined) => [...(v ?? [])].sort().join('|');
    return set(a.parentIds) !== set(b.parentIds) || set(a.childIds) !== set(b.childIds) || set(a.partnerships) !== set(b.partnerships);
}

/** Lower case, without diacritics and spaces: "Nováková" and "novakova" are one surname. */
export function normalizeSurname(s: string | undefined): string {
    return (s ?? '').normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, '').toLowerCase();
}

function partnersOf(data: StromData, id: PersonId): Set<PersonId> {
    const out = new Set<PersonId>();
    for (const pid of data.persons[id]?.partnerships ?? []) {
        const p = data.partnerships[pid];
        if (!p) continue;
        if (p.person1Id !== id) out.add(p.person1Id);
        if (p.person2Id !== id) out.add(p.person2Id);
    }
    return out;
}

/**
 * Whether the gone person `x` (old tree) reads as merged into `y` (new
 * tree): the same surname, birth years at most one apart (both known), and
 * a parent or a partner in common.
 */
export function looksMerged(oldData: StromData, newData: StromData, x: PersonId, y: PersonId): boolean {
    const px = oldData.persons[x];
    const py = newData.persons[y];
    if (!px || !py || px.isPlaceholder || py.isPlaceholder) return false;
    const sx = normalizeSurname(px.lastName);
    if (!sx || sx !== normalizeSurname(py.lastName)) return false;
    const bx = yearOf(px.birthDate), by = yearOf(py.birthDate);
    if (bx === null || by === null || Math.abs(bx - by) > 1) return false;
    const parentsY = new Set(py.parentIds ?? []);
    if ((px.parentIds ?? []).some(p => parentsY.has(p))) return true;
    const partnersY = partnersOf(newData, y);
    for (const q of partnersOf(oldData, x)) if (partnersY.has(q)) return true;
    return false;
}

/** The difference between the tree shown (`oldData`) and the one just loaded (`newData`). */
export function diffLive(oldData: StromData, newData: StromData): LiveDiff {
    const added: PersonId[] = [];
    const gone: PersonId[] = [];
    const changed = new Map<PersonId, string[]>();
    /** People in both whose data or relations changed (merge candidates). */
    const touched: PersonId[] = [];
    for (const [id, p] of Object.entries(newData.persons) as Array<[PersonId, Person]>) {
        const was = oldData.persons[id];
        if (!was) {
            added.push(id);
            continue;
        }
        const fields = changedFields(was, p);
        if (fields.length > 0) changed.set(id, fields);
        if (fields.length > 0 || relationsChanged(was, p)) touched.push(id);
    }
    for (const id of Object.keys(oldData.persons) as PersonId[]) {
        if (!newData.persons[id]) gone.push(id);
    }
    const merged = new Map<PersonId, PersonId>();
    const removed: PersonId[] = [];
    for (const x of gone) {
        const into = touched.find(y => looksMerged(oldData, newData, x, y));
        if (into) merged.set(x, into);
        else removed.push(x);
    }
    return { added, removed, changed, merged, moved: [] };
}

/** How many people the change touches (added, removed, merged, changed): over a limit the scene is skipped. */
export function liveChangeCount(diff: LiveDiff): number {
    return diff.added.length + diff.removed.length + diff.merged.size + diff.changed.size;
}
