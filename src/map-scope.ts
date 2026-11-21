/**
 * The map's scope (spec 098 §3, §4, §7): which people the map covers.
 * 'view' = the people laid out in the tree view now, 'sel' = the people of
 * the window's selection, 'tree' = everybody. Pure: the DOM side lives in
 * src/ui/map-ui.ts (mapScopePersons, setMapScope, the scope's control).
 */

import type { PersonId } from './types.js';

/** Which people the map covers. */
export type MapScope = 'view' | 'sel' | 'tree';

/** A selection's change as the map follows it (src/ui/view-selection-ui.ts SelectionChange.reason). */
export type MapScopeSelectionReason = 'set' | 'clear' | 'gone' | 'tree' | 'restore' | 'hideOthers';

/**
 * The people of a scope: undefined = everybody (the whole tree); the
 * selection's people for 'sel' (none when the selection is gone: §7 then
 * moves the scope to 'view'); the people laid out now for 'view'.
 */
export function mapScopePersonIds(
    scope: MapScope,
    viewIds: () => ReadonlySet<PersonId>,
    selectionIds: () => ReadonlySet<PersonId> | null,
): ReadonlySet<PersonId> | undefined {
    switch (scope) {
        case 'tree': return undefined;
        case 'sel': return selectionIds() ?? new Set<PersonId>();
        default: return viewIds();
    }
}

/** The scope a tree opens with: the remembered one, 'sel' only while the window has a selection (§7). */
export function mapScopeOnOpen(stored: MapScope | null, hasSelection: boolean): MapScope {
    if (stored === 'sel' && !hasSelection) return 'view';
    return stored ?? 'view';
}

/** The scope after a change of the selection: a selection cleared or gone takes 'sel' back to 'view' (§3, §7). */
export function mapScopeAfterSelection(scope: MapScope, reason: MapScopeSelectionReason, hasSelection: boolean): MapScope {
    if (scope !== 'sel') return scope;
    if (reason === 'clear' || reason === 'gone' || !hasSelection) return 'view';
    return scope;
}
