/**
 * Table view (spec 073 §13): the states drawn in place of the grid, without
 * the DOM. An empty tree (13a, 13b), a Unions table without unions (13e),
 * an Events table without events (§14.1),
 * the built-in Checks view without findings (13f) and the built-in Gaps
 * view when nothing is missing (13g). "Nothing matches the filter" (13c,
 * 13d) stays under the head of the grid (`GridInput.noMatch`).
 */

import { strings } from '../../strings.js';
import type { RowType } from './table-model.js';
import { builtinId } from './table-views.js';

export type TableEmptyKind = 'empty' | 'noUnions' | 'noEvents' | 'noFindings' | 'nothingMissing';

export interface TableEmptyInput {
    persons: number;
    unions: number;
    /** The events of the tree (§14.1); not given: not counted. */
    events?: number;
    type: RowType;
    /** The open view's id and whether the table differs from it (§9.3). */
    viewId: string;
    viewChanged: boolean;
    /** The search text as typed. */
    search: string;
    /** The rows that pass now. */
    shown: number;
    /** The findings are computed (13i: until then the Checks view waits). */
    checksDone: boolean;
    /** Leads (findings of the lowest level) of the tree: they stay in Data quality. */
    leads: number;
    /** Every shown person has all tracked fields (§6.2); asked only for the Gaps view. */
    allComplete: () => boolean;
    /** No edits: no Add person. */
    readOnly: boolean;
}

export interface TableEmptyState {
    kind: TableEmptyKind;
    title: string;
    text: string;
    /** The primary action (Add person) or the quiet link (Data quality ›). */
    action: { id: 'add' | 'quality'; label: string } | null;
}

/** The state to draw in place of the grid, or null for the grid. */
export function tableEmptyState(i: TableEmptyInput): TableEmptyState | null {
    const t = strings.table;
    if (i.persons === 0) {
        return {
            kind: 'empty', title: t.emptyTitle, text: t.emptyText,
            action: i.readOnly ? null : { id: 'add', label: `＋ ${strings.toolbar.addPerson}` },
        };
    }
    if (i.type === 'unions' && i.unions === 0) return { kind: 'noUnions', title: t.noUnionsTitle, text: t.noUnionsText, action: null };
    if (i.type === 'events' && i.events === 0) return { kind: 'noEvents', title: t.noEventsTitle, text: t.noEventsText, action: null };
    const asView = !i.viewChanged && !i.search.trim();
    if (asView && i.type === 'persons' && i.viewId === builtinId('checks') && i.checksDone && i.shown === 0) {
        return {
            kind: 'noFindings', title: t.noFindingsTitle, text: t.noFindingsText(i.leads),
            action: i.leads > 0 ? { id: 'quality', label: t.toQuality } : null,
        };
    }
    if (asView && i.type === 'persons' && i.viewId === builtinId('gaps') && i.shown > 0 && i.allComplete()) {
        return { kind: 'nothingMissing', title: t.nothingMissingTitle, text: t.nothingMissingText(i.shown), action: null };
    }
    return null;
}
