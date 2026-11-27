/**
 * A .zip archive without a library: the local headers, the central directory
 * and its end record, names in UTF-8 (flag bit 11), CRC-32 of the IEEE
 * polynomial. Entries are stored (method 0) — enough for a set of pages whose
 * images are JPEG already (spec 026 §6.4) — or, written asynchronously,
 * deflated (method 8) by the browser's `CompressionStream('deflate-raw')`
 * where it pays (text; spec 093 §5): JPEG, PNG and archives stay stored, and
 * without `CompressionStream` everything is stored. Past 4 GB (an entry,
 * an offset, the archive) or 65 535 entries the values go into ZIP64 extra
 * fields and the ZIP64 end record (a gift package of a large tree, 1127);
 * a smaller archive is written as before, byte for byte.
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
    return crc32Update(0, bytes);
}

/** CRC-32 continued over more bytes: `crc32Update(crc32(a), b) === crc32(a + b)`. */
export function crc32Update(crc: number, bytes: Uint8Array): number {
    const t = crcTable();
    let c = (crc ^ 0xFFFFFFFF) >>> 0;
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

/** STORE or DEFLATE. */
export type ZipMethod = 0 | 8;

interface ZipFile { name: Uint8Array; size: number; csize: number; crc: number; offset: number; method: ZipMethod }

/** A size or an offset that does not fit the 32-bit field: the field says 0xFFFFFFFF, the ZIP64 extra field holds it. */
const MAX32 = 0xFFFFFFFF;

function needs64(f: ZipFile, central: boolean, limit: number): boolean {
    return f.size >= limit || f.csize >= limit || (central && f.offset >= limit);
}

/**
 * The ZIP64 extended information extra field (0x0001) of an entry: in a
 * local header both sizes; in the central one only the values too large for
 * their field, in the order size, compressed size, offset. Empty when none is.
 */
function zip64Extra(f: ZipFile, central: boolean, limit: number): Uint8Array<ArrayBuffer> {
    if (!needs64(f, central, limit)) return new Uint8Array(0);
    const values = central
        ? [f.size >= limit ? f.size : -1, f.csize >= limit ? f.csize : -1, f.offset >= limit ? f.offset : -1].filter(n => n >= 0)
        : [f.size, f.csize];
    const out = new Uint8Array(4 + 8 * values.length);
    const v = new DataView(out.buffer);
    v.setUint16(0, 0x0001, true);
    v.setUint16(2, 8 * values.length, true);
    values.forEach((n, i) => v.setBigUint64(4 + 8 * i, BigInt(n), true));
    return out;
}

/** A local or central header (30 or 46 bytes before the name), and its extra field (ZIP64 when a value is too large). */
function header(central: boolean, f: ZipFile, time: number, date: number, limit = MAX32): { head: Uint8Array<ArrayBuffer>; extra: Uint8Array<ArrayBuffer> } {
    const extra = zip64Extra(f, central, limit);
    const version = extra.length ? 45 : 20;
    const out = new Uint8Array(central ? 46 : 30);
    const v = new DataView(out.buffer);
    let at = 0;
    v.setUint32(at, central ? 0x02014B50 : 0x04034B50, true);
    at += 4;
    if (central) { v.setUint16(at, version, true); at += 2; }   // made by: 2.0 (4.5 with ZIP64), MS-DOS attributes
    v.setUint16(at, version, true);      // version needed: 2.0 (4.5 with ZIP64)
    v.setUint16(at + 2, 0x0800, true);   // UTF-8 names
    v.setUint16(at + 4, f.method, true); // STORE / DEFLATE
    v.setUint16(at + 6, time, true);
    v.setUint16(at + 8, date, true);
    v.setUint32(at + 10, f.crc, true);
    const big = !central && extra.length > 0;
    v.setUint32(at + 14, big || f.csize >= limit ? MAX32 : f.csize, true);
    v.setUint32(at + 18, big || f.size >= limit ? MAX32 : f.size, true);
    v.setUint16(at + 22, f.name.length, true);
    v.setUint16(at + 24, extra.length, true);   // extra field
    at += 26;
    if (central) {
        v.setUint16(at, 0, true);            // comment
        v.setUint16(at + 2, 0, true);        // disk
        v.setUint16(at + 4, 0, true);        // internal attributes
        v.setUint32(at + 6, 0, true);        // external attributes
        v.setUint32(at + 10, f.offset >= limit ? MAX32 : f.offset, true);
    }
    return { head: out, extra };
}

/** How many bytes are gathered into one Blob (the sink, a large deflated entry). */
const FOLD_BYTES = 8 * 1024 * 1024;

/** A part of the archive as it is written: bytes, or a stored entry's data as the Blob it already is. */
export type ZipPart = Uint8Array<ArrayBuffer> | Blob;

/** How an entry written asynchronously is kept: deflated where it pays (default), or stored as it is. */
export type ZipCompress = 'auto' | 'store';

/** What an entry became: its size, its size in the archive and how it went in. */
export interface ZipAdded { size: number; csize: number; method: ZipMethod }

/** A file a ZipWriter writes to that can rewrite what it wrote (spool.ts SpoolFile). */
export interface ZipSeek {
    patch(at: number, bytes: Uint8Array<ArrayBuffer>, resume: number): void;
    truncate(at: number): void;
    ready(): Promise<void>;
}

/** Files already compressed (images, archives, PDF, fonts): stored, deflating them gains nothing. */
const STORED_EXT = /\.(jpe?g|png|gif|webp|avif|zip|gz|pdf|woff2?|mp[34]|m4a|ogg|webm)$/i;

/** Whether deflating a file of this name is worth it (text: HTML, CSS, scripts, SVG, GEDCOM, JSON). */
export function isCompressible(path: string): boolean {
    return !STORED_EXT.test(path);
}

/** Whether the browser deflates (`CompressionStream('deflate-raw')`); without it entries are stored. */
export function canDeflate(): boolean {
    if (typeof CompressionStream === 'undefined') return false;
    try {
        new CompressionStream('deflate-raw');
        return true;
    } catch {
        return false;
    }
}

/** The bytes of a Blob a chunk at a time (its stream, else read whole). */
async function* blobChunks(blob: Blob): AsyncGenerator<Uint8Array> {
    if (typeof blob.stream !== 'function') {
        yield new Uint8Array(await blob.arrayBuffer());
        return;
    }
    const reader = blob.stream().getReader();
    try {
        for (;;) {
            const r = await reader.read();
            if (r.done) return;
            if (r.value?.length) yield r.value;
        }
    } finally {
        reader.releaseLock();
    }
}

/**
 * Deflate (raw, as zip's method 8) the chunks while their CRC-32 is counted;
 * null when the browser cannot. The deflated bytes come as chunks too.
 */
async function deflateChunks(
    chunks: AsyncIterable<Uint8Array>, fold = false, onChunk?: (c: Uint8Array<ArrayBuffer>) => Promise<void>,
): Promise<{ out: ZipPart[]; crc: number; size: number; csize: number } | null> {
    if (!canDeflate()) return null;
    const cs = new CompressionStream('deflate-raw');
    const out: ZipPart[] = [];
    // `fold`: the deflated bytes gathered into a Blob every FOLD_BYTES (a large entry not held as arrays).
    let run: Uint8Array<ArrayBuffer>[] = [];
    let runBytes = 0;
    let csize = 0;
    const reading = (async () => {
        const reader = cs.readable.getReader();
        for (;;) {
            const r = await reader.read();
            if (r.done) break;
            csize += r.value.length;
            // `onChunk`: each deflated chunk handed on as it comes (an archive written to a file), nothing kept.
            if (onChunk) { await onChunk(r.value as Uint8Array<ArrayBuffer>); continue; }
            run.push(r.value as Uint8Array<ArrayBuffer>);
            runBytes += r.value.length;
            if (fold && runBytes >= FOLD_BYTES) { out.push(new Blob(run)); run = []; runBytes = 0; }
        }
        if (fold && run.length) out.push(new Blob(run));
        else out.push(...run);
    })();
    const writer = cs.writable.getWriter();
    let crc = 0;
    let size = 0;
    try {
        for await (const c of chunks) {
            crc = crc32Update(crc, c);
            size += c.length;
            await writer.write(c as Uint8Array<ArrayBuffer>);
        }
        await writer.close();
    } catch (e) {
        void writer.abort(e).catch(() => { /* already failed */ });
        await reading.catch(() => { /* the write's error is the one */ });
        throw e;
    }
    await reading;
    return { out, crc, size, csize };
}

/**
 * The archive written an entry at a time (1102 §7.5): each entry becomes its
 * bytes at once and goes to `out` (a Blob's parts, a file's stream), so a set
 * of thousands of pages never holds all its pages as text together; only the
 * central directory waits for the end.
 *
 * `add` stores an entry at once. `addAsync` (spec 093 §5) deflates text where
 * the browser can and takes a Blob as well (a stored Blob goes to `out` as
 * the Blob itself, read only for its CRC); its entries are written in the
 * order of the calls, one after another. `finishAsync` waits for them.
 * Mixing `add` with `addAsync` still running is not allowed.
 *
 * `seek` (1127): `out` is a file that can rewrite what it wrote (spool.ts).
 * A deflated entry then goes out as it is deflated, its local header
 * written first with the sizes unknown and rewritten once they are known —
 * the same bytes as without it, never the entry held whole; `ready` keeps
 * the page from running ahead of the file.
 */
export class ZipWriter {
    private readonly enc = new TextEncoder();
    private readonly files: ZipFile[] = [];
    private readonly time: number;
    private readonly date: number;
    private at = 0;
    private queue: Promise<unknown> = Promise.resolve();
    private pending = 0;
    private readonly out: (part: ZipPart) => void;
    /** Whether `out` takes a Blob as a part (else a stored Blob goes out read into arrays). */
    private readonly blobParts: boolean;
    /** From this size or offset on the ZIP64 fields are written (4 GB; smaller only in tests). */
    private readonly limit: number;
    private readonly seek: ZipSeek | null;

    constructor(out: (part: Uint8Array<ArrayBuffer>) => void, when?: Date, opts?: { zip64At?: number });
    constructor(out: (part: ZipPart) => void, when: Date | undefined, opts: { blobParts: true; zip64At?: number; seek?: ZipSeek });
    constructor(
        out: ((part: Uint8Array<ArrayBuffer>) => void) | ((part: ZipPart) => void),
        when: Date = new Date(), opts?: { blobParts?: boolean; zip64At?: number; seek?: ZipSeek },
    ) {
        this.out = out as (part: ZipPart) => void;
        this.blobParts = !!opts?.blobParts;
        this.seek = opts?.seek ?? null;
        this.limit = Math.min(MAX32, opts?.zip64At ?? MAX32);
        ({ time: this.time, date: this.date } = dosDateTime(when));
    }

    /** Entries written so far. */
    get count(): number { return this.files.length; }
    /** Bytes written so far. */
    get bytes(): number { return this.at; }

    add(path: string, data: Uint8Array | string): void {
        if (this.pending) throw new Error('ZipWriter: add() while addAsync() runs');
        const bytes = (typeof data === 'string' ? this.enc.encode(data) : data) as Uint8Array<ArrayBuffer>;
        this.entry(path, { crc: crc32(bytes), size: bytes.length, csize: bytes.length, method: 0 }, [bytes]);
    }

    /**
     * An entry deflated when `compress` is 'auto', the name is text
     * (isCompressible), the browser deflates and the result is smaller;
     * stored otherwise. Resolves once it is written.
     */
    addAsync(path: string, data: Uint8Array | string | Blob, compress: ZipCompress = 'auto'): Promise<ZipAdded> {
        this.pending++;
        const run = this.queue.then(() => this.addNow(path, data, compress));
        this.queue = run.catch(() => { /* the caller gets the error; the next entry still runs */ });
        return run.finally(() => { this.pending--; });
    }

    /** The central directory and its end record. */
    finish(): void {
        const dirAt = this.at;
        for (const f of this.files) {
            const h = header(true, f, this.time, this.date, this.limit);
            this.write(h.head);
            this.write(f.name as Uint8Array<ArrayBuffer>);
            this.write(h.extra);
        }
        const count = this.files.length;
        const dirSize = this.at - dirAt;
        // Past 4 GB or 65 535 entries: the ZIP64 end record and its locator before the classic end record.
        const zip64 = count > 0xFFFF || dirAt >= this.limit || dirSize >= this.limit;
        if (zip64) {
            const recAt = this.at;
            const rec = new Uint8Array(56);
            const r = new DataView(rec.buffer);
            r.setUint32(0, 0x06064B50, true);
            r.setBigUint64(4, 44n, true);           // the record's size after this field
            r.setUint16(12, 45, true);              // made by 4.5
            r.setUint16(14, 45, true);              // version needed 4.5
            r.setBigUint64(24, BigInt(count), true);
            r.setBigUint64(32, BigInt(count), true);
            r.setBigUint64(40, BigInt(dirSize), true);
            r.setBigUint64(48, BigInt(dirAt), true);
            this.write(rec);
            const loc = new Uint8Array(20);
            const l = new DataView(loc.buffer);
            l.setUint32(0, 0x07064B50, true);
            l.setBigUint64(8, BigInt(recAt), true);
            l.setUint32(16, 1, true);               // disks
            this.write(loc);
        }
        const end = new Uint8Array(22);
        const v = new DataView(end.buffer);
        v.setUint32(0, 0x06054B50, true);
        v.setUint16(8, zip64 ? 0xFFFF : count, true);
        v.setUint16(10, zip64 ? 0xFFFF : count, true);
        v.setUint32(12, zip64 ? MAX32 : dirSize, true);
        v.setUint32(16, zip64 ? MAX32 : dirAt, true);
        this.write(end);
    }

    /** `finish` after every entry added asynchronously is written. */
    async finishAsync(): Promise<void> {
        await this.queue;
        this.finish();
    }

    private async addNow(path: string, data: Uint8Array | string | Blob, compress: ZipCompress): Promise<ZipAdded> {
        const deflate = compress === 'auto' && isCompressible(path) && canDeflate();
        if (deflate && this.seek) {
            const added = await this.deflatedToFile(path, data);
            if (added) return added;
        }
        if (data instanceof Blob) {
            if (deflate) {
                const d = await deflateChunks(blobChunks(data), this.blobParts);
                if (d && d.csize < d.size) return this.entry(path, { crc: d.crc, size: d.size, csize: d.csize, method: 8 }, d.out);
            }
            // Stored: read once for the CRC, then the Blob itself goes out (or its bytes, read again).
            let crc = 0;
            for await (const c of blobChunks(data)) crc = crc32Update(crc, c);
            const added = this.entry(path, { crc, size: data.size, csize: data.size, method: 0 }, this.blobParts ? [data] : []);
            if (!this.blobParts) for await (const c of blobChunks(data)) this.write(c as Uint8Array<ArrayBuffer>);
            return added;
        }
        const bytes = (typeof data === 'string' ? this.enc.encode(data) : data) as Uint8Array<ArrayBuffer>;
        if (deflate && bytes.length > 0) {
            const d = await deflateChunks((async function* () { yield bytes; })(), this.blobParts);
            if (d && d.csize < d.size) return this.entry(path, { crc: d.crc, size: d.size, csize: d.csize, method: 8 }, d.out);
        }
        return this.entry(path, { crc: crc32(bytes), size: bytes.length, csize: bytes.length, method: 0 }, [bytes]);
    }

    /**
     * A deflated entry straight into a `seek` file: the header with the sizes
     * still unknown, the deflated chunks as they come, then the header again
     * with them. Null (the file cut back to where the entry began) when it
     * does not deflate smaller or the browser cannot: the caller stores it.
     */
    private async deflatedToFile(path: string, data: Uint8Array | string | Blob): Promise<ZipAdded | null> {
        const seek = this.seek!;
        const bytes = data instanceof Blob ? null : (typeof data === 'string' ? this.enc.encode(data) : data) as Uint8Array<ArrayBuffer>;
        const size = data instanceof Blob ? data.size : bytes!.length;
        if (size === 0) return null;
        const start = this.at;
        const f: ZipFile = { name: this.enc.encode(path), size, csize: 0, crc: 0, offset: start, method: 8 };
        // The header's length is the same with the sizes known: ZIP64 in it depends on the size (a deflated entry is smaller).
        const first = header(false, f, this.time, this.date, this.limit);
        this.write(first.head);
        this.write(f.name as Uint8Array<ArrayBuffer>);
        const extraAt = this.at;
        this.write(first.extra);
        const chunks = bytes ? (async function* () { yield bytes; })() : blobChunks(data as Blob);
        const d = await deflateChunks(chunks, false, async (c) => {
            this.write(c);
            await seek.ready();
        });
        if (!d || d.csize >= d.size) {
            seek.truncate(start);
            this.at = start;
            return null;
        }
        f.crc = d.crc;
        f.csize = d.csize;
        const h = header(false, f, this.time, this.date, this.limit);
        seek.patch(start, h.head, this.at);
        if (h.extra.length) seek.patch(extraAt, h.extra, this.at);
        this.files.push(f);
        await seek.ready();
        return { size: f.size, csize: f.csize, method: f.method };
    }

    private entry(path: string, e: Omit<ZipFile, 'name' | 'offset'>, body: readonly ZipPart[]): ZipAdded {
        const f: ZipFile = { ...e, name: this.enc.encode(path), offset: this.at };
        this.files.push(f);
        const h = header(false, f, this.time, this.date, this.limit);
        this.write(h.head);
        this.write(f.name as Uint8Array<ArrayBuffer>);
        this.write(h.extra);
        for (const part of body) this.write(part);
        return { size: f.size, csize: f.csize, method: f.method };
    }

    private write(part: ZipPart): void {
        const n = part instanceof Blob ? part.size : part.length;
        if (!n) return;
        this.out(part);
        this.at += n;
    }
}

/** Bytes gathered into a Blob this often, so the parts of a large archive are not all held as arrays. */
const SINK_FOLD_BYTES = FOLD_BYTES;

/**
 * Where a ZipWriter writes to make a Blob: the parts folded into Blobs as
 * they come (every ~8 MB), so the archive is held by the browser's Blob
 * storage rather than as arrays in the script's memory.
 */
export class ZipBlobSink {
    private blobs: Blob[] = [];
    private run: BlobPart[] = [];
    private runBytes = 0;

    readonly write = (part: ZipPart): void => {
        this.run.push(part);
        this.runBytes += part instanceof Blob ? 0 : part.length;
        if (this.runBytes >= SINK_FOLD_BYTES) this.fold();
    };

    /** The archive written so far as one Blob. */
    blob(type = 'application/zip'): Blob {
        this.fold();
        return new Blob(this.blobs, { type });
    }

    /** Drop what was written (a build cancelled). */
    clear(): void {
        this.blobs = [];
        this.run = [];
        this.runBytes = 0;
    }

    private fold(): void {
        if (!this.run.length) return;
        this.blobs.push(new Blob(this.run));
        this.run = [];
        this.runBytes = 0;
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
