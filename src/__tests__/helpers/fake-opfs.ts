/**
 * A stand-in for the origin private file system in Node (spool.ts): folders
 * and files in memory, a file written through a writable stream that
 * appends, writes at a position, seeks and truncates as the browser's does.
 */

function bytesOf(data: unknown): Promise<Uint8Array> | Uint8Array {
    if (typeof data === 'string') return new TextEncoder().encode(data);
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (data instanceof Blob) return data.arrayBuffer().then(b => new Uint8Array(b));
    throw new Error('fake-opfs: unknown data');
}

class FakeWritable {
    private buf = new Uint8Array(1024);
    private len = 0;
    private pos = 0;
    constructor(private readonly file: FakeFileHandle) {
        this.file.writers++;
    }

    async write(chunk: unknown): Promise<void> {
        let data = chunk;
        if (chunk && typeof chunk === 'object' && (chunk as { type?: string }).type === 'write') {
            const c = chunk as { position?: number; data: unknown };
            if (typeof c.position === 'number') this.pos = c.position;
            data = c.data;
        }
        const bytes = await bytesOf(data);
        const end = this.pos + bytes.length;
        if (end > this.buf.length) {
            const grown = new Uint8Array(Math.max(end, this.buf.length * 2));
            grown.set(this.buf.subarray(0, this.len));
            this.buf = grown;
        }
        this.buf.set(bytes, this.pos);
        this.pos = end;
        this.len = Math.max(this.len, end);
        this.file.written += bytes.length;
    }

    async seek(at: number): Promise<void> { this.pos = at; }

    async truncate(at: number): Promise<void> {
        this.len = at;
        if (this.pos > at) this.pos = at;
    }

    async close(): Promise<void> {
        this.file.bytes = this.buf.slice(0, this.len);
        this.file.writers--;
    }

    async abort(): Promise<void> {
        this.file.writers--;
    }
}

export class FakeFileHandle {
    readonly kind = 'file';
    bytes = new Uint8Array(0);
    /** Bytes written through its streams; streams still open. */
    written = 0;
    writers = 0;
    constructor(readonly name: string) {}
    async createWritable(): Promise<FakeWritable> { return new FakeWritable(this); }
    async getFile(): Promise<File> { return new File([this.bytes], this.name); }
}

export class FakeDirectoryHandle {
    readonly kind = 'directory';
    readonly entries = new Map<string, FakeFileHandle | FakeDirectoryHandle>();
    constructor(readonly name: string) {}

    async getFileHandle(name: string, o: { create?: boolean } = {}): Promise<FakeFileHandle> {
        let e = this.entries.get(name);
        if (!e && o.create) this.entries.set(name, e = new FakeFileHandle(name));
        if (!(e instanceof FakeFileHandle)) throw new DOMException(name, 'NotFoundError');
        return e;
    }

    async getDirectoryHandle(name: string, o: { create?: boolean } = {}): Promise<FakeDirectoryHandle> {
        let e = this.entries.get(name);
        if (!e && o.create) this.entries.set(name, e = new FakeDirectoryHandle(name));
        if (!(e instanceof FakeDirectoryHandle)) throw new DOMException(name, 'NotFoundError');
        return e;
    }

    async removeEntry(name: string): Promise<void> {
        if (!this.entries.delete(name)) throw new DOMException(name, 'NotFoundError');
    }

    async *keys(): AsyncGenerator<string> {
        yield* [...this.entries.keys()];
    }

    /** Every file below it. */
    files(): FakeFileHandle[] {
        return [...this.entries.values()].flatMap(e => (e instanceof FakeFileHandle ? [e] : e.files()));
    }
}

/** A Spool's constructor arguments: the parent folder, the spool's folder, its name. */
export function fakeSpoolFolders(name = 'test-1'): [FileSystemDirectoryHandle, FileSystemDirectoryHandle, string, FakeDirectoryHandle] {
    const parent = new FakeDirectoryHandle('page');
    const dir = new FakeDirectoryHandle(name);
    parent.entries.set(name, dir);
    return [parent as unknown as FileSystemDirectoryHandle, dir as unknown as FileSystemDirectoryHandle, name, dir];
}

/**
 * Count the bytes the page puts into Blobs in memory (strings and arrays
 * as Blob parts; a Blob made of Blobs or a file adds nothing): the global
 * Blob replaced until `restore`, `instanceof Blob` still true of any Blob.
 */
export function countMemoryBlobs(): { bytes: () => number; restore: () => void } {
    const Real = globalThis.Blob;
    let n = 0;
    class Counting extends Real {
        constructor(parts?: BlobPart[], opts?: BlobPropertyBag) {
            super(parts, opts);
            for (const p of parts ?? []) {
                if (p instanceof Real) continue;
                n += typeof p === 'string' ? Buffer.byteLength(p) : (p as ArrayBufferView | ArrayBuffer).byteLength;
            }
        }
        static [Symbol.hasInstance](x: unknown): boolean {
            return x instanceof Real;
        }
    }
    globalThis.Blob = Counting as typeof Blob;
    return { bytes: () => n, restore: () => { globalThis.Blob = Real; } };
}
