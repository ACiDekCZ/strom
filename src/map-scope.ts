/**
 * The map's scope (spec 098 §3, §4, §7): the map's names for the shared
 * scope of src/view-scope.ts (kept while code still imports them).
 */

export type { ViewScope as MapScope, ScopeSelectionReason as MapScopeSelectionReason } from './view-scope.js';
export {
    scopePersonIds as mapScopePersonIds,
    scopeOnOpen as mapScopeOnOpen,
    scopeAfterSelection as mapScopeAfterSelection,
} from './view-scope.js';
