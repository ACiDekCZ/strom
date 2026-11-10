/**
 * A reader of what src/xlsx.ts writes, for tests: the stored .zip (its end
 * record, central directory and local headers, every entry's CRC-32 and size
 * checked) and the one sheet's cells, with the shared strings decoded.
 */

import { crc32 } from '../../zip.js';

export interface ZipRead { path: string; text: string }

/** The entries of a stored zip; throws when a header, a size or a CRC does not match. */
export function readStoredZip(zip: Uint8Array): Map<string, string> {
    const fail = (why: string): never => { throw new Error(`zip: ${why}`); };
    const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const end = zip.length - 22;
    if (v.getUint32(end, true) !== 0x06054B50) fail('no end record');
    const n = v.getUint16(end + 10, true);
    let at = v.getUint32(end + 16, true);
    if (at + v.getUint32(end + 12, true) !== end) fail('central directory size');
    const dec = new TextDecoder('utf-8', { fatal: true });
    const out = new Map<string, string>();
    for (let i = 0; i < n; i++) {
        if (v.getUint32(at, true) !== 0x02014B50) fail('central header');
        if (v.getUint16(at + 10, true) !== 0) fail('not stored');
        const nameLen = v.getUint16(at + 28, true);
        const local = v.getUint32(at + 42, true);
        const path = dec.decode(zip.subarray(at + 46, at + 46 + nameLen));
        const crc = v.getUint32(at + 16, true);
        const size = v.getUint32(at + 24, true);
        if (v.getUint32(at + 20, true) !== size) fail(`${path}: sizes`);
        if (v.getUint32(local, true) !== 0x04034B50) fail(`${path}: local header`);
        if (v.getUint32(local + 14, true) !== crc || v.getUint32(local + 18, true) !== size || v.getUint32(local + 22, true) !== size) fail(`${path}: local header fields`);
        const lName = v.getUint16(local + 26, true);
        if (dec.decode(zip.subarray(local + 30, local + 30 + lName)) !== path) fail(`${path}: local name`);
        const start = local + 30 + lName + v.getUint16(local + 28, true);
        const data = zip.subarray(start, start + size);
        if (crc32(data) !== crc) fail(`${path}: CRC`);
        out.set(path, dec.decode(data));
        at += 46 + nameLen + v.getUint16(at + 30, true) + v.getUint16(at + 32, true);
    }
    return out;
}

/** XML text back to its characters (the five entities, numeric references, SpreadsheetML's _xHHHH_). */
export function xmlText(s: string): string {
    return s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_m, e: string) => {
        if (e === 'amp') return '&';
        if (e === 'lt') return '<';
        if (e === 'gt') return '>';
        if (e === 'quot') return '"';
        if (e === 'apos') return "'";
        return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    }).replace(/_x([0-9A-Fa-f]{4})_/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
}

export interface SheetCell { ref: string; style: number; type: string; text: string }
export interface SheetRow { r: number; outline: number; cells: Map<string, SheetCell> }

export interface XlsxRead {
    files: Map<string, string>;
    sheet: string;
    rows: SheetRow[];
    /** A cell by its reference ("B4"). */
    cell(ref: string): SheetCell | undefined;
    /** The comments by cell reference. */
    comments: Map<string, string>;
}

/** Read back a workbook written by buildXlsx. */
export function readXlsx(bytes: Uint8Array): XlsxRead {
    const files = readStoredZip(bytes);
    const sheet = files.get('xl/worksheets/sheet1.xml') ?? '';
    const sst = [...(files.get('xl/sharedStrings.xml') ?? '').matchAll(/<si><t xml:space="preserve">([\s\S]*?)<\/t><\/si>/g)].map(m => xmlText(m[1]));
    const rows: SheetRow[] = [];
    const byRef = new Map<string, SheetCell>();
    for (const m of sheet.matchAll(/<row r="(\d+)"([^>]*)>([\s\S]*?)<\/row>/g)) {
        const outline = /outlineLevel="(\d+)"/.exec(m[2]);
        const cells = new Map<string, SheetCell>();
        for (const c of m[3].matchAll(/<c r="([A-Z]+\d+)"((?:\s[a-z]+="[^"]*")*)\s*(?:\/>|>([\s\S]*?)<\/c>)/g)) {
            const attrs = c[2];
            const type = /\st="([^"]*)"/.exec(attrs)?.[1] ?? '';
            const style = Number(/\ss="(\d+)"/.exec(attrs)?.[1] ?? 0);
            const v = c[3] ? /<v>([\s\S]*?)<\/v>/.exec(c[3])?.[1] : undefined;
            const inline = c[3] ? /<is><t[^>]*>([\s\S]*?)<\/t><\/is>/.exec(c[3])?.[1] : undefined;
            const text = type === 's' && v !== undefined ? sst[Number(v)] : inline !== undefined ? xmlText(inline) : v ?? '';
            const cell = { ref: c[1], style, type, text };
            cells.set(c[1], cell);
            byRef.set(c[1], cell);
        }
        rows.push({ r: Number(m[1]), outline: outline ? Number(outline[1]) : 0, cells });
    }
    const comments = new Map<string, string>();
    for (const m of (files.get('xl/comments1.xml') ?? '').matchAll(/<comment ref="([A-Z]+\d+)"[^>]*>([\s\S]*?)<\/comment>/g)) {
        comments.set(m[1], [...m[2].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(t => xmlText(t[1])).join(''));
    }
    return { files, sheet, rows, cell: ref => byRef.get(ref), comments };
}
