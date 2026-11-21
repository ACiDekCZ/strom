/**
 * The scope of a view that lists or draws people of the tree (spec 098 §3,
 * §4, §7, §11): the Map, the Timeline and the Table share one switch
 * "This view / Selection ▾ / Whole tree". 'view' = the people laid out in
 * the tree view now, 'sel' = the people of the window's selection, 'tree' =
 * everybody. Pure: the switch itself lives in src/ui/scope-seg-ui.ts, each
 * view takes its people through scopePersonIds.
 */

import type { PersonId } from './types.js';

/** Which people a view covers. */
export type ViewScope = 'view' | 'sel' | 'tree';

/** The views with a scope of their own. */
export type ScopedView = 'map' | 'timeline' | 'table';

export const SCOPED_VIEWS: readonly ScopedView[] = ['map', 'timeline', 'table'];

export const VIEW_SCOPES: readonly ViewScope[] = ['view', 'sel', 'tree'];

/** A selection's change as a scope follows it (src/ui/view-selection-ui.ts SelectionChange.reason). */
export type ScopeSelectionReason = 'set' | 'clear' | 'gone' | 'tree' | 'restore' | 'hideOthers';

export function isViewScope(v: unknown): v is ViewScope {
    return v === 'view' || v === 'sel' || v === 'tree';
}

export function isScopedView(v: unknown): v is ScopedView {
    return v === 'map' || v === 'timeline' || v === 'table';
}

/** A view's scope when none was chosen: the Table lists the whole tree, the Map and the Timeline this view. */
export function scopeDefault(view: ScopedView): ViewScope {
    return view === 'table' ? 'tree' : 'view';
}

/**
 * The people of a scope: undefined = everybody (the whole tree); the
 * selection's people for 'sel' (none when the selection is gone: §7 then
 * moves the scope away from 'sel'); the people laid out now for 'view'.
 */
export function scopePersonIds(
    scope: ViewScope,
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
export function scopeOnOpen(stored: ViewScope | null, hasSelection: boolean, view: ScopedView = 'map'): ViewScope {
    if (stored === 'sel' && !hasSelection) return scopeDefault(view);
    return stored ?? scopeDefault(view);
}

/**
 * The scope after a change of the selection: a selection cleared or gone
 * takes 'sel' back to the view's default (This view; the Table's Whole tree).
 */
export function scopeAfterSelection(
    scope: ViewScope,
    reason: ScopeSelectionReason,
    hasSelection: boolean,
    view: ScopedView = 'map',
): ViewScope {
    if (scope !== 'sel') return scope;
    if (reason === 'clear' || reason === 'gone' || !hasSelection) return scopeDefault(view);
    return scope;
}

/**
 * The people a view highlights (spec 098 §11.0): with a selection in the
 * window and a scope other than Selection, the selection's people stand out
 * and the rest is dimmed. Null: nothing highlighted (no selection, or the
 * scope Selection that shows only them). The Table never highlights.
 */
export function scopeHighlightIds(
    view: ScopedView,
    scope: ViewScope,
    selectionIds: () => ReadonlySet<PersonId> | null,
): ReadonlySet<PersonId> | null {
    if (view === 'table' || scope === 'sel') return null;
    return selectionIds();
}
