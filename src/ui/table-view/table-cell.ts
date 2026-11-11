/**
 * Table view (T54 F4, F9): what a cell offers by itself.
 *
 * The active cell (a click, the arrows) is copied by Ctrl/Cmd+C as the text
 * it shows (no marks, icons or pills), and the row's menu and the row's sheet
 * start with the cell's part: Copy · Only "{value}" · Without "{value}".
 * An empty cell offers only empty / only filled; a cell without one value to
 * compare (a research mark, several names, a completeness, a count of
 * unions) offers Copy alone; an enumeration (union status, a reliability
 * step, a level) sets its values filter (§8.2). A cell naming a person
 * compares the person, so a column Father's Only "{father}" lists siblings.
 */

import type { ColumnDef } from './table-columns.js';
import type { CellValue, RowType, TableModel } from './table-model.js';
import type { GridLine } from './table-subrows.js';
import { cellPersonOf, cellShownText, columnValues, enumValueOf, filterKindOf, type ColumnFilter } from './table-filter.js';

/** How long the value is in the menu's words before it ends with "…". */
export const CELL_VALUE_CHARS = 24;

export interface CellChoices {
    /** The text Copy puts on the clipboard; '' when there is nothing. */
    copy: string;
    /** The value as the menu names it (shortened to CELL_VALUE_CHARS with "…"). */
    label: string;
    /** "Only {value}" and "Without {value}": the column's filter each sets. */
    only?: ColumnFilter;
    without?: ColumnFilter;
    /** An empty cell: only empty / only filled. */
    empty?: true;
}

/** A value shortened for the menu (~24 characters, then "…"). */
export function shortValue(text: string, max = CELL_VALUE_CHARS): string {
    const t = text.replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * The column that names the row itself (a person's name, a source's title):
 * its Only would keep the one row, so the menu and the sheet keep their
 * actions alone there; Ctrl/Cmd+C still copies it.
 */
const ROW_NAME_COLUMN: Partial<Record<RowType, string>> = { persons: 'name', sources: 'srcTitle' };

/** A cell without one value to compare: a research mark, several names, a completeness, a count of unions. */
function notComparable(value: CellValue): boolean {
    return !!value.research || value.percent !== undefined || !!value.aggregate || (value.names?.length ?? 0) > 1;
}

/**
 * What a cell offers (the menu's and the sheet's part of the cell); null:
 * nothing (the "more" line, a collapsed group's band, the row's own name,
 * a person's cell on a union's sub-row, a union's cell on a person's row
 * whose unions are sub-rows).
 */
export function cellChoices(model: TableModel, type: RowType, line: GridLine, col: ColumnDef, value: CellValue): CellChoices | null {
    if (line.kind === 'more') return null;
    if (line.kind === 'sub' && !col.unionScoped) return null;
    if (ROW_NAME_COLUMN[type] === col.id) return null;
    const copy = cellShownText(value);
    if (line.kind === 'row' && line.union === null && line.row.kind === 'person' && col.unionScoped) {
        return copy ? { copy, label: shortValue(copy) } : null;
    }
    if (value.na) return copy ? { copy, label: shortValue(copy) } : null;
    if (value.empty) return { copy: '', label: '', empty: true };
    if (!copy) return null;
    const label = shortValue(copy);
    if (notComparable(value)) return { copy, label };
    if (filterKindOf(col) === 'values') {
        const key = enumValueOf(value);
        const others = columnValues(model, type, col).map(v => v.value).filter(v => v !== key);
        return {
            copy, label,
            only: { col: col.id, kind: col.kind, values: [key] },
            // Without the only value there is: the cells without one.
            without: others.length ? { col: col.id, kind: col.kind, values: others } : { col: col.id, kind: col.kind, empty: true },
        };
    }
    const personId = cellPersonOf(value);
    const eq = (match: 'equals' | 'notEquals'): ColumnFilter => ({ col: col.id, kind: col.kind, match, text: copy, ...(personId ? { personId } : {}) });
    return { copy, label, only: eq('equals'), without: eq('notEquals') };
}

/**
 * Put a text on the clipboard within the user's gesture: the copy event of
 * `execCommand('copy')` carries it (no selection needed), else the async
 * clipboard.
 */
export function copyPlainText(text: string): void {
    if (!text) return;
    let done = false;
    const onCopy = (e: ClipboardEvent): void => {
        if (!e.clipboardData) return;
        e.clipboardData.setData('text/plain', text);
        e.preventDefault();
        done = true;
    };
    document.addEventListener('copy', onCopy, true);
    try { document.execCommand('copy'); } catch { /* the clipboard below */ }
    document.removeEventListener('copy', onCopy, true);
    if (!done) void navigator.clipboard?.writeText(text).catch(() => { /* nothing more to try */ });
}
