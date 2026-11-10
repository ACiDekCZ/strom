/**
 * Table view (spec 073 §11): the CSV of what the table shows, without the DOM.
 *
 * The shown columns in their order (a collapsed group with all its columns:
 * collapsing only draws), the rows as filtered, searched and sorted, each
 * value as the table writes it (dates in the app's notation — a spreadsheet
 * cannot hold dates before 1900 —, "abt. 1822", "≈ 67", "bap. …", "–").
 * Findings and colours stay out. A person with two or more unions is a row
 * with the first passing union and a continuation row per further passing
 * union, its person cells empty; then a "Union" column ("1 of 3") follows
 * the name. Written like src/csv-export.ts: UTF-8 with a BOM, `;`, CRLF,
 * formulas neutralised.
 */

import { strings } from '../../strings.js';
import { neutralizeFormula } from '../../csv-export.js';
import { cellOf, cellPlainText, columnLabel, type ColumnDef } from './table-columns.js';
import type { CellValue, RowType, TableModel, TableRow } from './table-model.js';
import { passingUnions, type UnionPredicate } from './table-subrows.js';

const SEP = ';';
const BOM = '﻿';

/** One CSV field: neutralised, quoted when it holds a quote, a separator (`;` or `,`) or a line break. */
export function tableCsvField(raw: string): string {
    if (raw === '') return '';
    const value = neutralizeFormula(raw);
    return /[";,\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export interface TableCsvInput {
    model: TableModel;
    type: RowType;
    /** The rows as shown (filtered, searched, sorted). */
    rows: readonly TableRow[];
    /** The shown columns in their order, the columns of collapsed groups included. */
    columns: readonly ColumnDef[];
    /** The union filters' predicate (§3.3): only passing unions are written; null: all. */
    pass?: UnionPredicate | null;
}

export interface TableCsv {
    csv: string;
    /** People or unions written. */
    items: number;
    /** Lines under the head (continuation rows included). */
    lines: number;
    /** Columns written (the "Union" column included). */
    columns: number;
}

/** One written line of the export: a row, or a further union of a person (a continuation row). */
export interface ExportLine {
    row: TableRow;
    /** The union the union columns read (People), null otherwise. */
    union: number | null;
    /** A continuation row (§11.2): only its union's cells are written. */
    continuation: boolean;
    /** Per written column: the cell (null where nothing is written: a continuation row's person cells, the "Union" column). */
    cells: (CellValue | null)[];
    /** Per written column: the text as the table shows it. */
    texts: string[];
}

/** What an export writes (§11.2): the head, its columns and the lines, as CSV and XLSX share them. */
export interface ExportTable {
    head: string[];
    /** Per written column its definition; null for the "Union" column. */
    columns: (ColumnDef | null)[];
    /** Where the "Union" column is (−1: none). */
    unionAt: number;
    lines: ExportLine[];
    /** People or unions written. */
    items: number;
}

/** The lines of the table as shown (§11.2), the "Union" column after the name when a person has 2+ passing unions. */
export function buildExportTable(input: TableCsvInput): ExportTable {
    const { model, type, rows, columns } = input;
    const persons = type === 'persons';
    const unionsOf = (row: TableRow): number[] => (row.kind === 'person' ? passingUnions(row, input.pass) : []);
    const unionCol = persons && rows.some(r => r.kind === 'person' && r.unions.length > 1 && unionsOf(r).length > 0);
    const nameAt = columns.findIndex(c => c.id === 'name');
    const head = columns.map(c => columnLabel(c));
    const cols: (ColumnDef | null)[] = [...columns];
    const unionAt = unionCol ? nameAt + 1 : -1;
    if (unionCol) {
        head.splice(unionAt, 0, strings.table.csvUnionCol);
        cols.splice(unionAt, 0, null);
    }
    const lines: ExportLine[] = [];
    const push = (row: TableRow, union: number | null, continuation: boolean, cells: (CellValue | null)[], unionText: string): void => {
        const texts = cells.map(v => (v ? cellPlainText(v) : ''));
        if (unionCol) {
            cells.splice(unionAt, 0, null);
            texts.splice(unionAt, 0, unionText);
        }
        lines.push({ row, union, continuation, cells, texts });
    };
    for (const row of rows) {
        const unions = unionsOf(row);
        const multi = row.kind === 'person' && row.unions.length > 1;
        const first = unions[0] ?? 0;
        const n = row.kind === 'person' ? row.unions.length : 0;
        push(row, row.kind === 'person' ? first : null, false,
            columns.map(c => cellOf(model, row, c, c.unionScoped ? first : undefined)),
            multi && unions.length ? strings.table.csvUnionOf(first + 1, n) : '');
        if (!multi || row.kind !== 'person') continue;
        for (const u of unions.slice(1)) {
            push(row, u, true, columns.map(c => (c.unionScoped ? cellOf(model, row, c, u) : null)), strings.table.csvUnionOf(u + 1, n));
        }
    }
    return { head, columns: cols, unionAt, lines, items: rows.length };
}

/** The CSV of the table as shown (§11.2). */
export function buildTableCsv(input: TableCsvInput): TableCsv {
    const t = buildExportTable(input);
    const out = [t.head, ...t.lines.map(l => l.texts)];
    return {
        csv: BOM + out.map(r => r.map(tableCsvField).join(SEP)).join('\r\n') + '\r\n',
        items: t.items,
        lines: t.lines.length,
        columns: t.head.length,
    };
}

/** Letters NFD cannot fold (as src/filenames.ts), both cases. */
const STANDALONE: Record<string, string> = {
    'ß': 'ss', 'æ': 'ae', 'Æ': 'AE', 'œ': 'oe', 'Œ': 'OE', 'ø': 'o', 'Ø': 'O', 'đ': 'd', 'Đ': 'D', 'ð': 'd', 'Ð': 'D',
    'þ': 'th', 'Þ': 'TH', 'ł': 'l', 'Ł': 'L', 'ħ': 'h', 'Ħ': 'H', 'ı': 'i', 'ŧ': 't', 'Ŧ': 'T', 'ŋ': 'n', 'Ŋ': 'N',
};

/** A file name part: ASCII without diacritics, its case kept, anything else a hyphen ("Dolní Lhota" → "Dolni-Lhota"). */
export function fileNamePart(text: string): string {
    return text
        .replace(/[ßæÆœŒøØđĐðÐþÞłŁħĦıŧŦŋŊ]/g, ch => STANDALONE[ch] ?? ch)
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Za-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/** `{tree}_{view}_{YYYY-MM-DD}.csv` (§11.1; `.xlsx` for §11.3), the date in local time. */
export function tableCsvFileName(tree: string, view: string, now: Date, ext: 'csv' | 'xlsx' = 'csv'): string {
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return `${fileNamePart(tree) || 'family-tree'}_${fileNamePart(view) || 'table'}_${day}.${ext}`;
}
