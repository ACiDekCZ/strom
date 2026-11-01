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

/** The archive of `entries` in their order, every one stored as it is, dated `when`. */
export function buildZip(entries: readonly ZipEntry[], when: Date = new Date()): Uint8Array<ArrayBuffer> {
    const enc = new TextEncoder();
    const { time, date } = dosDateTime(when);
    const files = entries.map(e => {
        const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
        return { name: enc.encode(e.path), data, crc: crc32(data) };
    });
    let size = 22;
    for (const f of files) size += 30 + f.name.length + f.data.length + 46 + f.name.length;
    const out = new Uint8Array(size);
    const v = new DataView(out.buffer);
    let at = 0;
    const offsets: number[] = [];
    const head = (sig: number, f: typeof files[number]): void => {
        v.setUint32(at, sig, true);
        at += 4;
        if (sig === 0x02014B50) { v.setUint16(at, 20, true); at += 2; }   // made by: 2.0, MS-DOS attributes
        v.setUint16(at, 20, true);           // version needed: 2.0
        v.setUint16(at + 2, 0x0800, true);   // UTF-8 names
        v.setUint16(at + 4, 0, true);        // STORE
        v.setUint16(at + 6, time, true);
        v.setUint16(at + 8, date, true);
        v.setUint32(at + 10, f.crc, true);
        v.setUint32(at + 14, f.data.length, true);
        v.setUint32(at + 18, f.data.length, true);
        v.setUint16(at + 22, f.name.length, true);
        v.setUint16(at + 24, 0, true);       // extra field
        at += 26;
    };
    for (const f of files) {
        offsets.push(at);
        head(0x04034B50, f);
        out.set(f.name, at);
        at += f.name.length;
        out.set(f.data, at);
        at += f.data.length;
    }
    const dirAt = at;
    files.forEach((f, i) => {
        head(0x02014B50, f);
        v.setUint16(at, 0, true);            // comment
        v.setUint16(at + 2, 0, true);        // disk
        v.setUint16(at + 4, 0, true);        // internal attributes
        v.setUint32(at + 6, 0, true);        // external attributes
        v.setUint32(at + 10, offsets[i], true);
        at += 14;
        out.set(f.name, at);
        at += f.name.length;
    });
    const dirSize = at - dirAt;
    v.setUint32(at, 0x06054B50, true);
    v.setUint16(at + 4, 0, true);
    v.setUint16(at + 6, 0, true);
    v.setUint16(at + 8, files.length, true);
    v.setUint16(at + 10, files.length, true);
    v.setUint32(at + 12, dirSize, true);
    v.setUint32(at + 16, dirAt, true);
    v.setUint16(at + 20, 0, true);
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
