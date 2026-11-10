/**
 * A one-sheet .xlsx workbook without a library: the SpreadsheetML parts
 * (workbook, sheet, styles, shared strings, comments with their legacy VML
 * drawing) in a stored .zip (src/zip.ts). Every value is a text (a shared
 * string): no number, date or formula is ever written. What a sheet can
 * carry is what the table export needs: merged cells, column widths, column
 * and row outline levels, frozen panes, a few cell styles (bold, faint,
 * fills), comments and external hyperlinks.
 */

import { buildZip } from './zip.js';

/** The cell styles of the workbook (indexes into its cellXfs). */
export const XLSX_STYLE = {
    normal: 0,
    bold: 1,
    faint: 2,
    group: 3,
    errorFill: 4,
    warningFill: 5,
} as const;
export type XlsxStyle = typeof XLSX_STYLE[keyof typeof XLSX_STYLE];

export interface XlsxCell {
    text: string;
    style?: XlsxStyle;
    /** A note on the cell (shown as a comment). */
    comment?: string;
    /** An external link (http, https or mailto only; anything else is left out). */
    href?: string;
}

export interface XlsxRow {
    /** Cells by column, from column A; null or a missing entry: no cell. */
    cells: (XlsxCell | null)[];
    /** Outline level (0–7; Excel's level buttons show it one higher). */
    outline?: number;
}

export interface XlsxColumn {
    /** Width in characters of the default font. */
    width: number;
    outline?: number;
}

export interface XlsxSheet {
    name: string;
    columns: XlsxColumn[];
    rows: XlsxRow[];
    /** Merged ranges as zero-based [row, firstCol, lastCol] on one row. */
    merges?: [number, number, number][];
    /** Frozen columns from the left and rows from the top. */
    freeze?: { cols: number; rows: number };
}

/** Excel keeps at most this many characters in a cell. */
export const XLSX_MAX_TEXT = 32767;

/**
 * Text as a sheet can hold it: characters XML 1.0 does not allow (control
 * characters, unpaired surrogates, U+FFFE/U+FFFF) removed, at most 32 767
 * UTF-16 units without splitting a pair. Emoji, combining marks and CJK stay.
 */
export function xlsxText(raw: string): string {
    let s = '';
    let units = 0;
    for (let i = 0; i < raw.length; i++) {
        const c = raw.charCodeAt(i);
        if (c >= 0xD800 && c <= 0xDBFF) {
            const d = i + 1 < raw.length ? raw.charCodeAt(i + 1) : 0;
            if (d >= 0xDC00 && d <= 0xDFFF) {
                if (units + 2 > XLSX_MAX_TEXT) break;
                s += raw[i] + raw[i + 1];
                units += 2;
                i++;
            }
            continue;
        }
        if ((c >= 0xDC00 && c <= 0xDFFF) || c === 0xFFFE || c === 0xFFFF) continue;
        if (c < 0x20 && c !== 0x09 && c !== 0x0A && c !== 0x0D) continue;
        if (units + 1 > XLSX_MAX_TEXT) break;
        s += raw[i];
        units++;
    }
    return s;
}

/** Escape for XML text and attributes (a carriage return as a reference, so it survives). */
export function xmlEscape(s: string): string {
    return s.replace(/[&<>"\r]/g, ch => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#13;'));
}

/** A cell's or a comment's text: escaped, and "_xHHHH_" kept (SpreadsheetML reads it as a character code). */
export function xstr(s: string): string {
    return xmlEscape(s.replace(/_(x[0-9A-Fa-f]{4}_)/g, '_x005F_$1'));
}

/** "A", "B", … "Z", "AA" for a zero-based column. */
export function columnName(i: number): string {
    let n = i + 1;
    let out = '';
    while (n > 0) {
        const r = (n - 1) % 26;
        out = String.fromCharCode(65 + r) + out;
        n = Math.floor((n - 1) / 26);
    }
    return out;
}

/** A sheet's name: no []:*?/\, no apostrophe at the ends, at most 31 characters. */
export function sheetName(raw: string, fallback = 'Sheet1'): string {
    const s = xlsxText(raw).replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '');
    const cut = [...s].slice(0, 31).join('').trim();
    return cut || fallback;
}

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_R = 'http://schemas.openxmlformats.org/package/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** RGB of the fills (the light theme's --danger-soft and --warning-soft). */
export const XLSX_FILL = { error: 'F5E6E2', warning: 'F6ECD3' } as const;

function styles(): string {
    const font = (extra: string): string => `<font>${extra}<sz val="11"/><name val="Calibri"/><family val="2"/></font>`;
    const fill = (rgb: string): string => `<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
    // xf: numFmtId 49 is "@" (text): a value typed into the cell later stays text too.
    const xf = (font: number, fill: number, extra = ''): string =>
        `<xf numFmtId="49" fontId="${font}" fillId="${fill}" borderId="0" xfId="0" applyNumberFormat="1"`
        + `${font ? ' applyFont="1"' : ''}${fill ? ' applyFill="1"' : ''}${extra ? ` applyAlignment="1">${extra}</xf>` : '/>'}`;
    return HEAD + `<styleSheet xmlns="${NS}">`
        + `<fonts count="3">${font('')}${font('<b/>')}${font('<i/><color rgb="FF6B6B6B"/>')}</fonts>`
        + `<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fill(XLSX_FILL.error)}${fill(XLSX_FILL.warning)}</fills>`
        + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        + `<cellXfs count="6">${xf(0, 0)}${xf(1, 0)}${xf(2, 0)}${xf(1, 0, '<alignment horizontal="center"/>')}${xf(0, 2)}${xf(0, 3)}</cellXfs>`
        + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        + '</styleSheet>';
}

function safeHref(href: string | undefined): string | null {
    if (!href) return null;
    const h = xlsxText(href).trim();
    return /^(https?:|mailto:)/i.test(h) && h.length <= 2079 ? h : null;
}

interface Placed { ref: string; row: number; col: number; text: string }

/** The legacy drawing Excel shows comments with (one hidden note shape per comment). */
function vmlDrawing(comments: readonly Placed[]): string {
    // A shape id block covers 1024 ids; the shapes start at 1025.
    const blocks = Math.floor((1024 + comments.length) / 1024);
    const ids = Array.from({ length: blocks }, (_v, i) => i + 1).join(',');
    let out = '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">'
        + `<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="${ids}"/></o:shapelayout>`
        + '<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe">'
        + '<v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>';
    comments.forEach((c, i) => {
        out += `<v:shape id="_x0000_s${1025 + i}" type="#_x0000_t202" style="position:absolute;margin-left:80pt;margin-top:2pt;width:160pt;height:60pt;z-index:${i + 1};visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto">`
            + '<v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/>'
            + '<v:textbox style="mso-direction-alt:auto"><div style="text-align:left"></div></v:textbox>'
            + `<x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>${c.col + 1}, 15, ${c.row}, 2, ${c.col + 4}, 15, ${c.row + 4}, 4</x:Anchor>`
            + `<x:AutoFill>False</x:AutoFill><x:Row>${c.row}</x:Row><x:Column>${c.col}</x:Column></x:ClientData></v:shape>`;
    });
    return out + '</xml>';
}

/** The workbook of one sheet as the bytes of an .xlsx file. */
export function buildXlsx(sheet: XlsxSheet, when: Date = new Date()): Uint8Array<ArrayBuffer> {
    const shared = new Map<string, number>();
    const strs: string[] = [];
    let uses = 0;
    const stringIndex = (s: string): number => {
        uses++;
        let i = shared.get(s);
        if (i === undefined) {
            i = strs.length;
            shared.set(s, i);
            strs.push(s);
        }
        return i;
    };
    const comments: Placed[] = [];
    const links: { ref: string; href: string }[] = [];
    const width = Math.max(sheet.columns.length, ...sheet.rows.map(r => r.cells.length), 1);

    let data = '';
    sheet.rows.forEach((row, r) => {
        const outline = Math.min(7, Math.max(0, row.outline ?? 0));
        let cells = '';
        row.cells.forEach((cell, c) => {
            if (!cell) return;
            const ref = `${columnName(c)}${r + 1}`;
            const text = xlsxText(cell.text);
            const s = cell.style ? ` s="${cell.style}"` : '';
            cells += text ? `<c r="${ref}"${s} t="s"><v>${stringIndex(text)}</v></c>` : (s ? `<c r="${ref}"${s}/>` : '');
            const note = cell.comment ? xlsxText(cell.comment) : '';
            if (note) comments.push({ ref, row: r, col: c, text: note });
            const href = text ? safeHref(cell.href) : null;
            if (href) links.push({ ref, href });
        });
        data += `<row r="${r + 1}"${outline ? ` outlineLevel="${outline}"` : ''}>${cells}</row>`;
    });

    const colOutline = Math.max(0, ...sheet.columns.map(c => Math.min(7, c.outline ?? 0)));
    const rowOutline = Math.max(0, ...sheet.rows.map(r => Math.min(7, r.outline ?? 0)));
    const lastRef = `${columnName(width - 1)}${Math.max(sheet.rows.length, 1)}`;
    const freeze = sheet.freeze && (sheet.freeze.cols > 0 || sheet.freeze.rows > 0) ? sheet.freeze : null;
    let view = '<sheetView workbookViewId="0"';
    if (freeze) {
        const top = `${columnName(freeze.cols)}${freeze.rows + 1}`;
        const pane = freeze.cols && freeze.rows ? 'bottomRight' : freeze.cols ? 'topRight' : 'bottomLeft';
        view += '>' + `<pane${freeze.cols ? ` xSplit="${freeze.cols}"` : ''}${freeze.rows ? ` ySplit="${freeze.rows}"` : ''} topLeftCell="${top}" activePane="${pane}" state="frozen"/>`
            + `<selection pane="${pane}" activeCell="${top}" sqref="${top}"/></sheetView>`;
    } else view += '/>';

    const rels: string[] = [];
    const rel = (type: string, target: string, external = false): string => {
        const id = `rId${rels.length + 1}`;
        rels.push(`<Relationship Id="${id}" Type="${REL}/${type}" Target="${xmlEscape(target)}"${external ? ' TargetMode="External"' : ''}/>`);
        return id;
    };
    let tail = '';
    if (sheet.merges?.length) {
        tail += `<mergeCells count="${sheet.merges.length}">`
            + sheet.merges.map(([r, a, b]) => `<mergeCell ref="${columnName(a)}${r + 1}:${columnName(b)}${r + 1}"/>`).join('')
            + '</mergeCells>';
    }
    if (links.length) tail += `<hyperlinks>${links.map(l => `<hyperlink ref="${l.ref}" r:id="${rel('hyperlink', l.href, true)}"/>`).join('')}</hyperlinks>`;
    tail += '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>';
    if (comments.length) {
        rel('comments', '../comments1.xml');
        tail += `<legacyDrawing r:id="${rel('vmlDrawing', '../drawings/vmlDrawing1.vml')}"/>`;
    }

    const cols = sheet.columns.length
        ? '<cols>' + sheet.columns.map((c, i) => {
            const w = Math.round(Math.max(2, Math.min(255, c.width)) * 100) / 100;
            const o = Math.min(7, c.outline ?? 0);
            return `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"${o ? ` outlineLevel="${o}"` : ''}/>`;
        }).join('') + '</cols>'
        : '';
    const ws = HEAD + `<worksheet xmlns="${NS}" xmlns:r="${NS_R}">`
        + '<sheetPr><outlinePr summaryBelow="0" summaryRight="0"/></sheetPr>'
        + `<dimension ref="A1:${lastRef}"/>`
        + `<sheetViews>${view}</sheetViews>`
        + `<sheetFormatPr defaultRowHeight="15"${rowOutline ? ` outlineLevelRow="${rowOutline}"` : ''}${colOutline ? ` outlineLevelCol="${colOutline}"` : ''}/>`
        + cols + `<sheetData>${data}</sheetData>` + tail + '</worksheet>';

    const sst = HEAD + `<sst xmlns="${NS}" count="${uses}" uniqueCount="${strs.length}">`
        + strs.map(s => `<si><t xml:space="preserve">${xstr(s)}</t></si>`).join('') + '</sst>';
    const workbook = HEAD + `<workbook xmlns="${NS}" xmlns:r="${NS_R}"><bookViews><workbookView/></bookViews>`
        + `<sheets><sheet name="${xmlEscape(sheetName(sheet.name))}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
    const pkgRel = (id: string, type: string, target: string): string => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`;
    const wbRels = HEAD + `<Relationships xmlns="${NS_PKG_R}">${pkgRel('rId1', 'worksheet', 'worksheets/sheet1.xml')}`
        + `${pkgRel('rId2', 'styles', 'styles.xml')}${pkgRel('rId3', 'sharedStrings', 'sharedStrings.xml')}</Relationships>`;
    const rootRels = HEAD + `<Relationships xmlns="${NS_PKG_R}">${pkgRel('rId1', 'officeDocument', 'xl/workbook.xml')}</Relationships>`;
    const ct = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
    const types = HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + (comments.length ? '<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>' : '')
        + `<Override PartName="/xl/workbook.xml" ContentType="${ct}.sheet.main+xml"/>`
        + `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="${ct}.worksheet+xml"/>`
        + `<Override PartName="/xl/styles.xml" ContentType="${ct}.styles+xml"/>`
        + `<Override PartName="/xl/sharedStrings.xml" ContentType="${ct}.sharedStrings+xml"/>`
        + (comments.length ? `<Override PartName="/xl/comments1.xml" ContentType="${ct}.comments+xml"/>` : '')
        + '</Types>';

    const entries = [
        { path: '[Content_Types].xml', data: types },
        { path: '_rels/.rels', data: rootRels },
        { path: 'xl/workbook.xml', data: workbook },
        { path: 'xl/_rels/workbook.xml.rels', data: wbRels },
        { path: 'xl/styles.xml', data: styles() },
        { path: 'xl/sharedStrings.xml', data: sst },
        { path: 'xl/worksheets/sheet1.xml', data: ws },
    ];
    if (rels.length) entries.push({ path: 'xl/worksheets/_rels/sheet1.xml.rels', data: HEAD + `<Relationships xmlns="${NS_PKG_R}">${rels.join('')}</Relationships>` });
    if (comments.length) {
        entries.push({
            path: 'xl/comments1.xml',
            data: HEAD + `<comments xmlns="${NS}"><authors><author>Strom</author></authors><commentList>`
                + comments.map(c => `<comment ref="${c.ref}" authorId="0"><text><r><t xml:space="preserve">${xstr(c.text)}</t></r></text></comment>`).join('')
                + '</commentList></comments>',
        });
        entries.push({ path: 'xl/drawings/vmlDrawing1.vml', data: vmlDrawing(comments) });
    }
    return buildZip(entries, when);
}
