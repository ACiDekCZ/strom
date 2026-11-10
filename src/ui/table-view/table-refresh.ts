/**
 * Table view (spec 073 §10.3): what a change of the data does to the rows
 * on screen, without the DOM.
 *
 * - The rows keep their order after an edit (`keepOrder`): a changed row
 *   stays where it was until the next change of the sort, the filter or the
 *   view; a row that no longer passes the filter stays as well, "stale".
 * - Which rows changed: after the person dialog or the relationships panel
 *   opened from the table (`watchEdit` before, `changedKeys` after) and after
 *   a change from the research's bridge (`bridgeChanges`, the data before and
 *   after). The keys are entity keys (`p:` a person, `u:` a union);
 *   `rowKeysFor` turns them into the row keys of a table.
 */

import type { Person, PersonId, Partnership, PartnershipId, Source, StromData } from '../../types.js';
import { rowKey, sameRow, type EventRow, type RowType, type TableModel, type TableRow } from './table-model.js';

/** The rows in their kept order and those of them that no longer pass (their row keys). */
export interface KeptRows {
    rows: TableRow[];
    stale: Set<string>;
}

/**
 * The rows of the last draw in their order, read from the new model: a row
 * gone from the data is dropped, a row that no longer passes is kept and
 * marked stale, a row that passes now and was not shown comes last (in the
 * fresh order).
 */
export function keepOrder(m: TableModel, previous: readonly TableRow[], fresh: readonly TableRow[]): KeptRows {
    const passing = new Set(fresh.map(rowKey));
    const rows: TableRow[] = [];
    const seen = new Set<string>();
    const out = new Set<string>();
    for (const old of previous) {
        const key = rowKey(old);
        const row = sameRow(m, old);
        if (!row || seen.has(key)) continue;
        seen.add(key);
        rows.push(row);
        if (!passing.has(key)) out.add(key);
    }
    for (const row of fresh) {
        const key = rowKey(row);
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(row);
    }
    return { rows, stale: out };
}

/** A person's or a union's stored form, to tell a change. */
function signature(value: Person | Partnership | Source | undefined): string {
    return value ? JSON.stringify(value) : '';
}

/** The person and the people and unions an edit of theirs can touch: partners, parents, children, own unions. */
export function familyKeys(data: StromData, personId: PersonId): string[] {
    const p = data.persons[personId];
    if (!p) return [];
    const keys = new Set<string>([`p:${personId}`]);
    for (const id of p.parentIds ?? []) keys.add(`p:${id}`);
    for (const id of p.childIds ?? []) keys.add(`p:${id}`);
    for (const uid of p.partnerships ?? []) {
        keys.add(`u:${uid}`);
        const u = data.partnerships[uid];
        if (u) { keys.add(`p:${u.person1Id}`); keys.add(`p:${u.person2Id}`); }
    }
    return [...keys];
}

function entity(data: StromData, key: string): Person | Partnership | Source | undefined {
    const id = key.slice(2);
    if (key.startsWith('s:')) return data.sources?.[id];
    return key.startsWith('p:') ? data.persons[id as PersonId] : data.partnerships[id as PartnershipId];
}

/** The stored form of each key now (before an edit). */
export function watchEdit(data: StromData, keys: readonly string[]): Map<string, string> {
    return new Map(keys.map(k => [k, signature(entity(data, k))]));
}

/** The keys watched that differ now (after the edit). */
export function changedKeys(data: StromData, watched: ReadonlyMap<string, string>): string[] {
    const out: string[] = [];
    for (const [key, before] of watched) if (signature(entity(data, key)) !== before) out.push(key);
    return out;
}

/** What changed between two states of a tree: the people and unions (entity keys) and the number of facts. */
export interface DataChanges {
    keys: string[];
    facts: number;
}

/** The fields of two stored forms that differ (one for a whole record added or removed). */
function factsChanged(a: object | undefined, b: object | undefined): number {
    if (!a || !b) return a === b ? 0 : 1;
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    let n = 0;
    for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
        if (JSON.stringify(ra[k]) !== JSON.stringify(rb[k])) n++;
    }
    return n;
}

/** The changes a load from the research's bridge brought (§10.3, 10d). */
export function bridgeChanges(before: StromData, after: StromData): DataChanges {
    const keys: string[] = [];
    let facts = 0;
    const personIds = new Set<string>([...Object.keys(before.persons ?? {}), ...Object.keys(after.persons ?? {})]);
    for (const id of personIds) {
        const a = before.persons?.[id as PersonId];
        const b = after.persons?.[id as PersonId];
        if (signature(a) === signature(b)) continue;
        facts += factsChanged(a, b);
        keys.push(`p:${id}`);
    }
    const unionIds = new Set<string>([...Object.keys(before.partnerships ?? {}), ...Object.keys(after.partnerships ?? {})]);
    for (const id of unionIds) {
        const a = before.partnerships?.[id as PartnershipId];
        const b = after.partnerships?.[id as PartnershipId];
        if (signature(a) === signature(b)) continue;
        facts += factsChanged(a, b);
        keys.push(`u:${id}`);
    }
    return { keys, facts };
}

/**
 * The rows of a table that show changed entities: in the People table a
 * changed person and both partners of a changed union; in the Unions table a
 * changed union and the unions of a changed person; in the Events table
 * (`events`: its rows) the events of a changed person or union.
 */
export function rowKeysFor(data: StromData, type: RowType, keys: readonly string[], events?: readonly EventRow[]): Set<string> {
    const out = new Set<string>();
    if (type === 'events') {
        const ids = new Set(keys);
        for (const r of events ?? []) {
            if ((r.union && ids.has(`u:${r.union.id}`)) || r.persons.some(p => ids.has(`p:${p.id}`))) out.add(rowKey(r));
        }
        return out;
    }
    if (type === 'sources') {
        for (const key of keys) if (key.startsWith('s:')) out.add(key);
        return out;
    }
    for (const key of keys) {
        const id = key.slice(2);
        if (type === 'persons') {
            if (key.startsWith('p:')) out.add(key);
            else {
                const u = data.partnerships[id as PartnershipId];
                if (u) { out.add(`p:${u.person1Id}`); out.add(`p:${u.person2Id}`); }
            }
        } else if (key.startsWith('u:')) out.add(key);
        else for (const uid of data.persons[id as PersonId]?.partnerships ?? []) out.add(`u:${uid}`);
    }
    return out;
}

/** The names in a toast: the first `max`, then "…". */
export function namesList(names: readonly string[], max = 2): string {
    const shown = names.filter(Boolean).slice(0, max).join(', ');
    return names.length > max ? `${shown}…` : shown;
}
