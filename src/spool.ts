/**
 * Large outputs put together in files of the page's own storage (the origin
 * private file system) rather than as Blobs in the browser's memory (1127).
 * Chrome keeps Blobs in memory up to a share of the computer's memory and
 * moves the rest to its disk as fast as it can; Blobs made faster than that
 * — the gift package of a tree whose photos weigh gigabytes, a few hundred
 * megabytes a second — come out broken: reading them fails ("network
 * error"), the file cannot be made. A file written here has its bytes on
 * the disk at once, and the Blob it gives is read from there (the archive,
 * the download, sharing).
 *
 * A spool is one making's files (a folder). Its Blobs stay readable until
 * it is disposed: a newer spool of the same owner disposes the older one,
 * and the spools of a page that is gone are removed by the next page that
 * opens one (Web Locks tell which pages still live). Without the file
 * system (a page opened as a file, an older browser) there is no spool: the
 * caller builds its Blobs in memory as before (memoryOut).
 */

/** Where a file is written a part at a time: a spool's file, or Blobs in memory. */
export interface BlobOut {
    /** Append a part (queued: `ready` waits for it). */
    write(part: string | Uint8Array<ArrayBuffer> | Blob): void;
    /** Resolves once what was written is out of the page's hands (on the disk, or folded into a Blob); throws a write's error. */
    ready(): Promise<void>;
    /** Everything written: the file as a Blob of `type`. */
    close(type?: string): Promise<Blob>;
    /** Give the file up (an error, a cancel): nothing of it is kept. */
    abort(): Promise<void>;
}

/** A spool's file: a BlobOut that can also rewrite what it wrote (an archive's headers, written once their sizes are known). */
export interface SpoolFile extends BlobOut {
    /** Rewrite `bytes` at `at`, then go on writing at `resume` (the file's end). */
    patch(at: number, bytes: Uint8Array<ArrayBuffer>, resume: number): void;
    /** Cut the file at `at` and go on writing there. */
    truncate(at: number): void;
}

/** Parts in memory: each `ready` gathers the parts since the last one into a Blob (the page lets go of them). */
export function memoryOut(): BlobOut {
    let blobs: Blob[] = [];
    let run: BlobPart[] = [];
    const fold = (): void => {
        if (!run.length) return;
        blobs.push(new Blob(run));
        run = [];
    };
    return {
        write: (part) => { run.push(part); },
        ready: async () => { fold(); },
        close: async (type) => {
            fold();
            const blob = new Blob(blobs, type ? { type } : undefined);
            blobs = [];
            return blob;
        },
        abort: async () => { blobs = []; run = []; },
    };
}

/** The spool's file when there is a spool, else parts in memory. */
export async function blobOut(spool: Spool | null | undefined): Promise<BlobOut> {
    return spool ? spool.file() : memoryOut();
}

/** Bytes queued for the disk before `ready` waits for them. */
const QUEUE_BYTES = 16 * 1024 * 1024;

class DiskFile implements SpoolFile {
    private chain: Promise<void> = Promise.resolve();
    private queued = 0;
    private error: unknown = null;
    private done = false;

    constructor(
        private readonly handle: FileSystemFileHandle,
        private readonly w: FileSystemWritableFileStream,
        private readonly gone: (file: DiskFile, blob: Blob | null) => void,
    ) {}

    get name(): string { return this.handle.name; }

    private queue(bytes: number, step: () => Promise<void>): void {
        if (this.done) throw new Error('The file is closed.');
        this.queued += bytes;
        this.chain = this.chain.then(async () => {
            try {
                if (!this.error) await step();
            } catch (e) {
                this.error = e;
            } finally {
                this.queued -= bytes;
            }
        });
    }

    readonly write = (part: string | Uint8Array<ArrayBuffer> | Blob): void => {
        const bytes = typeof part === 'string' ? part.length : part instanceof Blob ? 0 : part.length;
        if (typeof part === 'string' ? !part.length : part instanceof Blob ? !part.size : !part.length) return;
        this.queue(bytes, () => this.w.write(part));
    };

    /** Every part queued so far written (a Blob part read whole). */
    async flushed(): Promise<void> {
        await this.chain;
    }

    readonly ready = async (): Promise<void> => {
        if (this.queued > QUEUE_BYTES) await this.chain;
        if (this.error) throw this.error;
    };

    patch(at: number, bytes: Uint8Array<ArrayBuffer>, resume: number): void {
        this.queue(bytes.length, async () => {
            await this.w.write({ type: 'write', position: at, data: bytes });
            await this.w.seek(resume);
        });
    }

    truncate(at: number): void {
        this.queue(0, async () => {
            await this.w.truncate(at);
            await this.w.seek(at);
        });
    }

    async close(type?: string): Promise<Blob> {
        await this.chain;
        if (this.error) {
            const e = this.error;
            await this.abort();
            throw e;
        }
        this.done = true;
        await this.w.close();
        const file = await this.handle.getFile();
        const blob = file.slice(0, file.size, type ?? '');
        this.gone(this, blob);
        return blob;
    }

    async abort(): Promise<void> {
        if (this.done) return;
        this.done = true;
        await this.chain;
        await this.w.abort().catch(() => { /* already closed */ });
        this.gone(this, null);
    }
}

/** One making's files (see the module's comment). */
export class Spool {
    private n = 0;
    private disposed = false;
    private readonly open = new Set<DiskFile>();
    /** The Blobs its closed files gave, by the file's name (drop). */
    private readonly made = new Map<Blob, string>();

    constructor(private readonly parent: FileSystemDirectoryHandle, private readonly dir: FileSystemDirectoryHandle, readonly name: string) {}

    /** A new file to write. */
    async file(): Promise<SpoolFile> {
        if (this.disposed) throw new Error('The spool is disposed.');
        const handle = await this.dir.getFileHandle(`${++this.n}.part`, { create: true });
        const w = await handle.createWritable();
        const f = new DiskFile(handle, w, (file, blob) => {
            this.open.delete(file);
            if (blob) this.made.set(blob, file.name);
            else void this.dir.removeEntry(file.name).catch(() => { /* gone already */ });
        });
        this.open.add(f);
        return f;
    }

    /** Whether `blob` is a file of this spool. */
    holds(blob: Blob): boolean {
        return this.made.has(blob);
    }

    /**
     * Remove the file `blob` is (a part already in the archive); any other
     * Blob is left as it is. Once the open files have written what they
     * queued: a part of them may be this Blob, still to be read.
     */
    async drop(blob: Blob): Promise<void> {
        const name = this.made.get(blob);
        if (name === undefined) return;
        this.made.delete(blob);
        await Promise.all([...this.open].map(f => f.flushed()));
        await this.dir.removeEntry(name).catch(() => { /* gone already */ });
    }

    /** Remove all its files: their Blobs cannot be read any more. */
    async dispose(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true;
        await Promise.all([...this.open].map(f => f.abort()));
        this.made.clear();
        await this.parent.removeEntry(this.name, { recursive: true }).catch(() => { /* gone already */ });
    }
}

const ROOT = 'strom-spool';
const LOCK = 'strom-spool:';
const PAGE = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

let pageDir: Promise<FileSystemDirectoryHandle | null> | null = null;
let seq = 0;
const owners = new Map<string, Spool>();

/** Whether the browser writes files of the page's own storage (Safari before 26 cannot). */
function canSpool(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function'
        && typeof FileSystemFileHandle !== 'undefined' && typeof FileSystemFileHandle.prototype.createWritable === 'function';
}

/** This page's folder of spools; the folders of pages gone removed the first time. */
function pageFolder(): Promise<FileSystemDirectoryHandle | null> {
    pageDir ??= (async () => {
        if (!canSpool()) return null;
        try {
            const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(ROOT, { create: true });
            const locks = navigator.locks;
            if (locks) {
                // The page's lock, held while it lives: another page knows this folder is in use.
                await new Promise<void>(held => {
                    void locks.request(LOCK + PAGE, () => {
                        held();
                        return new Promise<void>(() => { /* held until the page goes */ });
                    });
                });
                const live = new Set(((await locks.query()).held ?? []).map(l => l.name));
                const names: string[] = [];
                for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name);
                for (const name of names) {
                    if (name !== PAGE && !live.has(LOCK + name)) await root.removeEntry(name, { recursive: true }).catch(() => { /* in use */ });
                }
            }
            return await root.getDirectoryHandle(PAGE, { create: true });
        } catch {
            return null;
        }
    })();
    return pageDir;
}

/** A new spool for `owner` (the older one of the same owner disposed); null without the file system. */
export async function openSpool(owner: string): Promise<Spool | null> {
    await dropSpool(owner);
    const parent = await pageFolder();
    if (!parent) return null;
    const name = `${owner}-${++seq}`;
    try {
        const spool = new Spool(parent, await parent.getDirectoryHandle(name, { create: true }), name);
        owners.set(owner, spool);
        return spool;
    } catch {
        return null;
    }
}

/** Dispose `owner`'s spool (its Blobs no longer needed). */
export async function dropSpool(owner: string): Promise<void> {
    const old = owners.get(owner);
    owners.delete(owner);
    await old?.dispose();
}

/** From this many bytes of output on, a making writes to a spool; smaller ones are Blobs in memory, as before. */
export const SPOOL_FROM_BYTES = 64 * 1024 * 1024;

/**
 * The spool for a making of about `bytes` (null under SPOOL_FROM_BYTES or
 * without the file system: Blobs in memory). Tests may set the threshold
 * (`__STROM_SPOOL_FROM`).
 */
export async function spoolFor(owner: string, bytes: number): Promise<Spool | null> {
    const set = (globalThis as { __STROM_SPOOL_FROM?: unknown }).__STROM_SPOOL_FROM;
    const from = typeof set === 'number' ? set : SPOOL_FROM_BYTES;
    if (bytes < from) {
        await dropSpool(owner);
        return null;
    }
    return openSpool(owner);
}
