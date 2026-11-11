/**
 * Table view (spec 073 §6.1): the coverage row — how much of a column is
 * filled in the rows shown now.
 *
 * The denominator leaves out the rows a column does not apply to (the living
 * for the death columns, people without a union for the union columns, people
 * without a parent for the parents' ages: cells marked `na`). For a union
 * column of the People table the unit is the union (§3.3: the passing unions
 * of the filtered people). A substitute value (a baptism for the birth) is
 * not counted as filled (§5.2). A completeness column (a percentage per
 * row) shows the average of its rows instead (T54 G12): each of its cells
 * holds a value, so a share of filled cells was always 100 %. Pure
 * functions, no DOM.
 */

import { strings } from '../../strings.js';
import { cellOf, type ColumnDef } from './table-columns.js';
import type { CellValue, PersonRow, TableModel, TableRow } from './table-model.js';

export interface Coverage {
    filled: number;
    /** Rows (unions) the column applies to. */
    total: number;
    /** Rounded percentage; null without a denominator. */
    percent: number | null;
    /** The percentage is the average of the rows' percentages (a completeness column). */
    average?: true;
}

/** Whether a cell counts as filled (§6.1). */
export function cellFilled(v: CellValue): boolean {
    return !v.empty && !v.na && !v.subst;
}

/**
 * A column's coverage over the rows. `unionsOf` gives, for a union column
 * of the People table, the unions of a person that count (default: all).
 */
export function columnCoverage(
    model: TableModel, rows: readonly TableRow[], col: ColumnDef,
    unionsOf?: (row: PersonRow) => readonly number[],
): Coverage {
    let filled = 0;
    let total = 0;
    let sum = 0;
    const average = col.kind === 'percent';
    const count = (v: CellValue): void => {
        if (v.na) return;
        total++;
        if (cellFilled(v)) filled++;
        if (average) sum += v.percent ?? 0;
    };
    for (const row of rows) {
        if (col.unionScoped && row.kind === 'person') {
            const idx = unionsOf ? unionsOf(row) : row.unions.map((_u, i) => i);
            for (const i of idx) count(cellOf(model, row, col, i));
        } else count(cellOf(model, row, col));
    }
    if (average) return { filled, total, percent: total ? Math.round(sum / total) : null, average: true };
    return { filled, total, percent: total ? Math.round((filled / total) * 100) : null };
}

/** What the coverage row's cell shows (§6.1): "{p} %", bold under 50 %, "–" without a denominator; its title "{a} of {b}" or "average of {n}". */
export interface CoverageCell {
    text: string;
    /** Under 50 %: drawn bold in the text colour. */
    low: boolean;
    /** "{a} of {b}" ("average of {n}" for a completeness column). */
    title: string;
    /** The cell is the row's label ("filled", in the name column). */
    label?: boolean;
}

export function coverageCell(c: Coverage): CoverageCell {
    if (c.percent === null) return { text: '–', low: false, title: strings.table.na };
    const title = c.average ? strings.table.coverageAverage(c.total) : strings.table.coverageOf(c.filled, c.total);
    return { text: `${c.percent} %`, low: c.percent < 50, title };
}

/** The coverage row's label cell (§6.1: "filled" in the name column). */
export function coverageLabel(): CoverageCell {
    return { text: strings.table.coverage, low: false, title: '', label: true };
}
