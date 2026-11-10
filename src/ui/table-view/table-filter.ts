/**
 * Table view (spec 073 §8): sorting the rows (filters and search come with §8).
 *
 * Works over the cells' sort keys (cached in the rows). Rows without a value
 * sort last in both directions; ties keep the base order, so the order never
 * wobbles between renders.
 */

import { cellOf, columnById } from './table-columns.js';
import type { SortSpec } from './table-columns.js';
import type { RowType, TableModel, TableRow } from './table-model.js';

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

function compareKeys(a: number | string, b: number | string): number {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return collator.compare(String(a), String(b));
}

/**
 * The rows sorted by the specs (the first spec first); unknown columns are
 * skipped. A union column of the People table sorts each person by the union
 * `unionOf` gives (§3.3: the first passing one; default the first by date).
 */
export function sortRows(
    model: TableModel, type: RowType, rows: readonly TableRow[], specs: readonly SortSpec[],
    unionOf?: (row: TableRow) => number,
): TableRow[] {
    const cols = specs.map(s => ({ col: columnById(type, s.col), dir: s.dir === 'desc' ? -1 : 1 })).filter(x => !!x.col);
    if (!cols.length) return [...rows];
    const keyed = rows.map((row, i) => ({
        row, i,
        keys: cols.map(c => cellOf(model, row, c.col!, c.col!.unionScoped && unionOf ? unionOf(row) : undefined).sortKey),
    }));
    keyed.sort((x, y) => {
        for (let k = 0; k < cols.length; k++) {
            const a = x.keys[k], b = y.keys[k];
            if (a === null || a === '') { if (b === null || b === '') continue; return 1; }
            if (b === null || b === '') return -1;
            const c = compareKeys(a, b);
            if (c !== 0) return c * cols[k].dir;
        }
        return x.i - y.i;
    });
    return keyed.map(x => x.row);
}
