/**
 * Table view (spec 073 §11.3, §14.4): the XLSX of what the table shows,
 * without the DOM. The same columns, lines and texts as the CSV
 * (buildExportTable), on one sheet:
 *  - row 1 the column groups (merged cells), row 2 the head, row 3 the
 *    coverage row (§6.1);
 *  - each group of columns an outline (its first column stays when Excel
 *    collapses it), the pinned columns and the three head rows frozen;
 *  - a cell with an error or a "to check" finding filled (the light theme's
 *    --danger-soft / --warning-soft) with the findings as its comment;
 *  - a person's continuation rows (further unions) one outline level under
 *    the person's row (Excel's level button 2);
 *  - a value a text as the table shows it (no formula neutralising: a shared
 *    string never becomes a formula), except the counts, the ages in whole
 *    years and the completeness percentages, which are numbers (chosen by
 *    the column, never guessed from the text).
 */

import { strings } from '../../strings.js';
import { translateValidationType } from '../../validation.js';
import { buildXlsx, XLSX_STYLE, type XlsxCell, type XlsxColumn, type XlsxRow } from '../../xlsx.js';
import { groupLabel, type ColumnDef, type ColumnGroup } from './table-columns.js';
import { columnCoverage, coverageCell, coverageLabel } from './table-coverage.js';
import { isPlaceColumn, type CellFinding, type CheckIndex } from './table-checks.js';
import { buildExportTable, type ExportLine, type TableCsvInput } from './table-export.js';
import type { CellValue, TableRow } from './table-model.js';
import { lockedColumn } from './table-state.js';
import { coverageUnionsOf } from './table-subrows.js';

export interface TableXlsxInput extends TableCsvInput {
    /** Pinned columns (§4.5) among `columns`, frozen in the sheet. */
    pinned: number;
    /** Column widths in px (desktop), as `columns`. */
    widths?: readonly number[];
    /** The findings shown (§7); null or missing: no fills and comments. */
    checks?: CheckIndex | null;
    /** The sheet's name (the view's). */
    sheetName: string;
    /** The archive's date (default: now). */
    when?: Date;
}

export interface TableXlsx {
    bytes: Uint8Array<ArrayBuffer>;
    /** People or unions written. */
    items: number;
    /** Lines under the head rows (continuation rows included). */
    lines: number;
    /** Columns written (the "Union" column included). */
    columns: number;
    /** Cells with a fill and a comment. */
    marked: number;
}

/** Rows above the data: the groups, the head, the coverage row. */
export const XLSX_HEAD_ROWS = 3;
/** The "Union" column's width in px. */
const UNION_WIDTH = 70;

/** Count columns (kind "number"): written as numbers. Differences, generations and orders stay texts. */
const COUNT_COLUMNS: ReadonlySet<string> = new Set(['nFind', 'unusual', 'uCount', 'uKids', 'sibs', 'srcCount', 'srcPersons', 'srcFacts']);

/**
 * The number a cell is written as, by its column: a count or an age in whole
 * years (a plain integer; "≈ 67", "28–29", "–" stay texts), a completeness
 * as its fraction. Null: a text.
 */
export function xlsxNumber(col: ColumnDef | null, value: CellValue | null, text: string): { number: number; percent: boolean } | null {
    if (!col || !value || value.empty || value.na) return null;
    if (col.kind === 'percent') {
        return typeof value.percent === 'number' && /^\d+ %$/.test(text) ? { number: value.percent / 100, percent: true } : null;
    }
    if ((col.kind === 'number' && COUNT_COLUMNS.has(col.id)) || col.kind === 'age') {
        return /^\d+$/.test(text) ? { number: Number(text), percent: false } : null;
    }
    return null;
}

function capital(s: string): string {
    return s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s;
}

/** The comment of a cell: its reported findings, one per paragraph ("Error: …" and the detail). */
export function findingsComment(list: readonly CellFinding[]): string {
    const sev = strings.table.sev;
    return list.filter(f => !f.dismissed).map(f => {
        const head = `${capital(sev[f.severity])}: ${translateValidationType(f.issue.type)}`;
        return f.issue.detail ? `${head}\n${f.issue.detail}` : head;
    }).join('\n\n');
}

/** The findings of a written cell (as the grid's: the union of a union column, the value of a place column). */
function findingsOf(checks: CheckIndex, line: ExportLine, col: ColumnDef, at: number): CellFinding[] {
    const value = line.cells[at];
    if (!value) return [];
    const row: TableRow = line.row;
    const union = col.unionScoped && row.kind === 'person' && line.union !== null ? row.unions[line.union] ?? null : null;
    return checks.cellAll(row, col.id, union, isPlaceColumn(col.id) ? value.text : '');
}

/** The XLSX of the table as shown (§11.3). */
export function buildTableXlsx(input: TableXlsxInput): TableXlsx {
    const t = buildExportTable(input);
    const width = t.columns.length;
    // The "Union" column belongs to the name's group and is frozen with it.
    const groupAt = (i: number): ColumnGroup | null => {
        const c = t.columns[i];
        if (c) return c.group;
        return i > 0 ? groupAt(i - 1) : null;
    };
    const frozen = Math.min(width, Math.max(1, input.pinned) + (t.unionAt >= 0 && t.unionAt <= input.pinned ? 1 : 0));

    // Column widths and outline: a group's columns after its first one (or after the frozen part) on level 1.
    const columns: XlsxColumn[] = t.columns.map((c, i) => {
        const srcAt = c ? input.columns.indexOf(c) : -1;
        const px = c ? (input.widths?.[srcAt] ?? c.width) : UNION_WIDTH;
        const outline = i > 0 && i >= frozen && groupAt(i) !== null && groupAt(i) === groupAt(i - 1) ? 1 : 0;
        return { width: Math.max(6, Math.round((px / 7) * 10) / 10), outline };
    });

    // Row 1: the groups, a run of columns of one group as one merged cell.
    const groups: (XlsxCell | null)[] = new Array(width).fill(null);
    const merges: [number, number, number][] = [];
    for (let i = 0; i < width;) {
        const g = groupAt(i);
        let j = i;
        while (j + 1 < width && groupAt(j + 1) === g) j++;
        if (g) groups[i] = { text: groupLabel(g), style: XLSX_STYLE.group };
        if (j > i) merges.push([0, i, j]);
        i = j + 1;
    }

    // Row 2: the head; row 3: the coverage row (§6.1) over the rows written.
    const head: XlsxCell[] = t.head.map(text => ({ text, style: XLSX_STYLE.bold }));
    const unitsOf = coverageUnionsOf(input.pass);
    const coverage: (XlsxCell | null)[] = t.columns.map((c, i) => {
        if (!c) return null;
        if (c.id === lockedColumn(input.type)) return { text: coverageLabel().text, style: XLSX_STYLE.faint };
        const cov = columnCoverage(input.model, input.rows, c, unitsOf);
        const cell = coverageCell(cov);
        const style = cell.low ? XLSX_STYLE.bold : XLSX_STYLE.faint;
        // The share as a number shown "0%" ("–" where nothing applies stays a text).
        return cov.percent === null ? { text: cell.text, style } : { text: cell.text, number: cov.percent / 100, percent: true, style };
    });

    let marked = 0;
    const rows: XlsxRow[] = [{ cells: groups }, { cells: head }, { cells: coverage }];
    for (const line of t.lines) {
        const cells: (XlsxCell | null)[] = line.texts.map((raw, i) => {
            const text = raw;
            const col = t.columns[i];
            const value = line.cells[i];
            const cell: XlsxCell = { text };
            const num = xlsxNumber(col ?? null, value ?? null, text);
            if (num) {
                cell.number = num.number;
                cell.percent = num.percent;
            }
            const href = value?.link?.href;
            if (href) cell.href = href;
            if (col && input.checks) {
                const list = findingsOf(input.checks, line, col, i);
                const top = list[0]?.severity;
                if (top === 'error' || top === 'warning') {
                    cell.style = top === 'error' ? XLSX_STYLE.errorFill : XLSX_STYLE.warningFill;
                    cell.comment = findingsComment(list);
                    marked++;
                }
            }
            return text || cell.style ? cell : null;
        });
        rows.push({ cells, outline: line.continuation ? 1 : 0 });
    }

    const bytes = buildXlsx({
        name: input.sheetName || strings.table.rows[input.type],
        columns, rows, merges,
        freeze: { cols: frozen, rows: XLSX_HEAD_ROWS },
    }, input.when);
    return { bytes, items: t.items, lines: t.lines.length, columns: width, marked };
}
