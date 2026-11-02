/**
 * A .zip archive without compression (method 0, STORE) and without a
 * library: the local headers, the central directory and its end record,
 * names in UTF-8 (flag bit 11), CRC-32 of the IEEE polynomial. Enough for a
 * set of pages whose images are JPEG already (spec 026 §6.4). No ZIP64:
 * an archive stays under 4 GB and 65 535 entries.
 */

export interface ZipEntry {
    /** The path inside the archive, '/' between folders, no leading '/'. */
    path: string;
    data: Uint8Array | string;
}

let table: Uint32Array | null = null;

function crcTable(): Uint32Array {
    if (table) return table;
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
}

/** CRC-32 (IEEE 802.3, as zip, gzip and PNG use it). */
export function crc32(bytes: Uint8Array): number {
    const t = crcTable();
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

/** The MS-DOS time and date of a moment in local time (2-second steps, from 1980). */
function dosDateTime(d: Date): { time: number; date: number } {
    const year = Math.min(Math.max(d.getFullYear(), 1980), 2107);
    return {
        time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
        date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
}

interface ZipFile { name: Uint8Array; size: number; crc: number; offset: number }

/** A local or central header (30 or 46 bytes before the name). */
function header(central: boolean, f: ZipFile, time: number, date: number): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(central ? 46 : 30);
    const v = new DataView(out.buffer);
    let at = 0;
    v.setUint32(at, central ? 0x02014B50 : 0x04034B50, true);
    at += 4;
    if (central) { v.setUint16(at, 20, true); at += 2; }   // made by: 2.0, MS-DOS attributes
    v.setUint16(at, 20, true);           // version needed: 2.0
    v.setUint16(at + 2, 0x0800, true);   // UTF-8 names
    v.setUint16(at + 4, 0, true);        // STORE
    v.setUint16(at + 6, time, true);
    v.setUint16(at + 8, date, true);
    v.setUint32(at + 10, f.crc, true);
    v.setUint32(at + 14, f.size, true);
    v.setUint32(at + 18, f.size, true);
    v.setUint16(at + 22, f.name.length, true);
    v.setUint16(at + 24, 0, true);       // extra field
    at += 26;
    if (central) {
        v.setUint16(at, 0, true);            // comment
        v.setUint16(at + 2, 0, true);        // disk
        v.setUint16(at + 4, 0, true);        // internal attributes
        v.setUint32(at + 6, 0, true);        // external attributes
        v.setUint32(at + 10, f.offset, true);
    }
    return out;
}

/**
 * The archive written an entry at a time (1102 §7.5): each entry becomes its
 * bytes at once and goes to `out` (a Blob's parts, a file's stream), so a set
 * of thousands of pages never holds all its pages as text together; only the
 * central directory waits for the end.
 */
export class ZipWriter {
    private readonly enc = new TextEncoder();
    private readonly files: ZipFile[] = [];
    private readonly time: number;
    private readonly date: number;
    private at = 0;

    constructor(private readonly out: (part: Uint8Array<ArrayBuffer>) => void, when: Date = new Date()) {
        ({ time: this.time, date: this.date } = dosDateTime(when));
    }

    /** Entries written so far. */
    get count(): number { return this.files.length; }
    /** Bytes written so far. */
    get bytes(): number { return this.at; }

    add(path: string, data: Uint8Array | string): void {
        const bytes = (typeof data === 'string' ? this.enc.encode(data) : data) as Uint8Array<ArrayBuffer>;
        const f: ZipFile = { name: this.enc.encode(path), size: bytes.length, crc: crc32(bytes), offset: this.at };
        this.files.push(f);
        this.write(header(false, f, this.time, this.date));
        this.write(f.name as Uint8Array<ArrayBuffer>);
        this.write(bytes);
    }

    /** The central directory and its end record. */
    finish(): void {
        const dirAt = this.at;
        for (const f of this.files) {
            this.write(header(true, f, this.time, this.date));
            this.write(f.name as Uint8Array<ArrayBuffer>);
        }
        const end = new Uint8Array(22);
        const v = new DataView(end.buffer);
        v.setUint32(0, 0x06054B50, true);
        v.setUint16(8, this.files.length, true);
        v.setUint16(10, this.files.length, true);
        v.setUint32(12, this.at - dirAt, true);
        v.setUint32(16, dirAt, true);
        this.write(end);
    }

    private write(part: Uint8Array<ArrayBuffer>): void {
        if (!part.length) return;
        this.out(part);
        this.at += part.length;
    }
}

/** The archive of `entries` in their order, every one stored as it is, dated `when`. */
export function buildZip(entries: readonly ZipEntry[], when: Date = new Date()): Uint8Array<ArrayBuffer> {
    const parts: Uint8Array[] = [];
    const zip = new ZipWriter(p => { parts.push(p); }, when);
    for (const e of entries) zip.add(e.path, e.data);
    zip.finish();
    const out = new Uint8Array(zip.bytes);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
}

/** The bytes of a `data:` URL in base64 (null for anything else). */
export function dataUrlBytes(url: string): { mime: string; bytes: Uint8Array } | null {
    const m = /^data:([\w.+-]+\/[\w.+-]+)(?:;[^,;]*)*;base64,([\s\S]*)$/.exec(url);
    if (!m) return null;
    const bin = atob(m[2].replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { mime: m[1].toLowerCase(), bytes };
}
