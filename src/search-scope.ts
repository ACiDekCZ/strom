/**
 * The scope of a person search (spec 137 K1): the whole tree, the direct
 * line of a person (the person, all their ancestors and all their
 * descendants, without partners), or the people the view shows now. One
 * state for the toolbar's search and every dialog's picker, kept in memory
 * only (K1.5): after the app starts it is always the whole tree. Narrowing
 * is not a filter: it never counts as one and alone highlights nothing.
 * No DOM here (the picker's head lives in person-picker.ts, the toolbar's
 * and the dialogs' sources in src/ui/search-scope-ui.ts).
 */

import type { PersonId, StromData } from './types.js';
import { selection, type LineageIndex } from './lineage.js';

export type SearchScope = 'tree' | 'line' | 'view';

/** The segments in their order (Alt+←/→ walks them). */
export const SEARCH_SCOPES: readonly SearchScope[] = ['tree', 'line', 'view'];

/** The event a change of the state sends on document. */
export const SEARCH_SCOPE_EVENT = 'strom:search-scope';

let current: SearchScope = 'tree';
const listeners = new Set<(s: SearchScope) => void>();

export function isSearchScope(v: unknown): v is SearchScope {
    return v === 'tree' || v === 'line' || v === 'view';
}

/** The state shared by the toolbar and all dialogs. */
export function getSearchScope(): SearchScope {
    return current;
}

/** Choose the scope: every listener and document hear it when it changes. */
export function setSearchScope(s: SearchScope): void {
    if (!isSearchScope(s) || s === current) return;
    current = s;
    for (const fn of [...listeners]) fn(s);
    if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent(SEARCH_SCOPE_EVENT, { detail: { scope: s } }));
}

/** Listen to changes of the scope; returns the unsubscribe. */
export function onSearchScope(fn: (s: SearchScope) => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}

/** Back to the start (tests): the whole tree, no listeners. */
export function resetSearchScopeForTests(): void {
    current = 'tree';
    listeners.clear();
    lineCache = new WeakMap();
}

/** The direct lines worked out, per tree object: by (revision, person). */
let lineCache = new WeakMap<StromData, { revision: number; byPerson: Map<PersonId, ReadonlySet<PersonId>> }>();

/**
 * The direct line of a person: the person, all their ancestors and all their
 * descendants (every generation, step and foster links excluded as in the
 * lineages), no partners and no placeholders. With `revision` the result is
 * kept until the revision changes (a tree object changed in place).
 */
export function directLineIds(source: StromData | LineageIndex, personId: PersonId, revision?: number): ReadonlySet<PersonId> {
    const data = 'rodByPerson' in source ? source.data : source;
    if (revision !== undefined) {
        const entry = lineCache.get(data);
        if (entry && entry.revision === revision) {
            const hit = entry.byPerson.get(personId);
            if (hit) return hit;
        }
    }
    const out = new Set<PersonId>();
    if (data.persons[personId]) {
        for (const id of selection(source, { kind: 'ancestors', personId }).memberIds) out.add(id);
        for (const id of selection(source, { kind: 'descendants', personId }).memberIds) out.add(id);
        for (const id of [...out]) if (data.persons[id]?.isPlaceholder) out.delete(id);
    }
    if (revision !== undefined) {
        let entry = lineCache.get(data);
        if (!entry || entry.revision !== revision) {
            entry = { revision, byPerson: new Map() };
            lineCache.set(data, entry);
        }
        entry.byPerson.set(personId, out);
    }
    return out;
}

/** The people each narrowed scope keeps; null: that scope is not offered here. */
export interface ScopeSets { line: ReadonlySet<PersonId> | null; view: ReadonlySet<PersonId> | null }

/**
 * The scope in effect: the chosen one where it is offered, else the whole
 * tree (the chosen state itself stays, spec 137 §1.4).
 */
export function effectiveScope(scope: SearchScope, sets: ScopeSets): SearchScope {
    if (scope === 'line' && sets.line) return 'line';
    if (scope === 'view' && sets.view) return 'view';
    return 'tree';
}

/** What a picker narrows to: null = no narrowing (the whole tree, or a state not offered here). */
export function narrowIds(scope: SearchScope, sets: ScopeSets): ReadonlySet<PersonId> | null {
    const s = effectiveScope(scope, sets);
    return s === 'line' ? sets.line : s === 'view' ? sets.view : null;
}

/** The offered scopes in their order (the whole tree always). */
export function offeredScopes(sets: ScopeSets): SearchScope[] {
    return SEARCH_SCOPES.filter(s => s === 'tree' || (s === 'line' ? !!sets.line : !!sets.view));
}

/** The next offered scope from the one in effect (Alt+←/→), wrapping at neither end. */
export function stepScope(scope: SearchScope, sets: ScopeSets, dir: -1 | 1): SearchScope {
    const offered = offeredScopes(sets);
    const i = offered.indexOf(effectiveScope(scope, sets));
    return offered[Math.max(0, Math.min(offered.length - 1, i + dir))];
}
