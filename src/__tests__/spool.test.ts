/**
 * Large outputs written to the page's own files (1127, spool.ts): an
 * archive written into a spool's file — its deflated entries streamed, the
 * local headers rewritten once their sizes are known, an entry that does
 * not deflate smaller cut back and stored — is byte for byte the archive
 * written as Blobs in memory, under the ZIP64 limit and past it. A spool's
 * files go when dropped or disposed; without the file system there is none.
 */

import { describe, it, expect } from 'vitest';
import { ZipBlobSink, ZipWriter } from '../zip.js';
import { memoryOut, Spool, spoolFor } from '../spool.js';
import { fakeSpoolFolders } from './helpers/fake-opfs.js';
import { blobBytes, readZipEntries } from './helpers/zip-read.js';

const WHEN = new Date(2026, 11, 24, 10, 30, 0);
const TEXT = '<p>Rodokmen – Řehoř</p>\n'.repeat(400);
const JPEG = Uint8Array.from({ length: 5000 }, (_, i) => (i * 37) & 0xFF);
/** Bytes that do not deflate smaller, under a name that is deflated where it pays. */
const NOISE = (() => {
    const b = new Uint8Array(20000);
    let x = 12345;
    for (let i = 0; i < b.length; i++) { x = (x * 1103515245 + 12345) >>> 0; b[i] = x >>> 24; }
    return b;
})();

async function entries(w: ZipWriter): Promise<void> {
    w.add('Dárek/readme.txt', 'first, at once');
    await w.addAsync('Dárek/Kniha rodu.html', TEXT);
    await w.addAsync('Dárek/img-1.jpg', JPEG);
    await w.addAsync('Dárek/app.html', new Blob([TEXT, 'x', TEXT]));
    await w.addAsync('Dárek/noise.html', NOISE);
    await w.addAsync('Dárek/noise-blob.html', new Blob([NOISE]));
    await w.addAsync('Dárek/empty.html', '');
    await w.addAsync('Dárek/stored.html', TEXT, 'store');
    await w.addAsync('Dárek/small.txt', 'x');
    await w.finishAsync();
}

async function inMemory(zip64At?: number): Promise<Uint8Array> {
    const sink = new ZipBlobSink();
    await entries(new ZipWriter(sink.write, WHEN, { blobParts: true, ...(zip64At ? { zip64At } : {}) }));
    return blobBytes(sink.blob());
}

async function inFile(zip64At?: number): Promise<{ bytes: Uint8Array; spool: Spool; blob: Blob }> {
    const spool = new Spool(...fakeSpoolFolders().slice(0, 3) as [FileSystemDirectoryHandle, FileSystemDirectoryHandle, string]);
    const file = await spool.file();
    await entries(new ZipWriter(file.write, WHEN, { blobParts: true, seek: file, ...(zip64At ? { zip64At } : {}) }));
    const blob = await file.close('application/zip');
    return { bytes: await blobBytes(blob), spool, blob };
}

describe('an archive written into a spool file (1127)', () => {
    it('is byte for byte the archive in memory, its entries read back', async () => {
        const mem = await inMemory();
        const { bytes, blob } = await inFile();
        expect(blob.type).toBe('application/zip');
        expect(Buffer.from(bytes).equals(Buffer.from(mem))).toBe(true);
        const read = readZipEntries(bytes);
        expect(read.map(e => e.path)).toContain('Dárek/noise.html');
        expect(Buffer.from(read.find(e => e.path === 'Dárek/noise.html')!.data).equals(Buffer.from(NOISE))).toBe(true);
        expect(new TextDecoder().decode(read.find(e => e.path === 'Dárek/app.html')!.data)).toBe(`${TEXT}x${TEXT}`);
    });

    it('past the ZIP64 limit too (its extra fields rewritten with the sizes)', async () => {
        const mem = await inMemory(1000);
        const { bytes } = await inFile(1000);
        expect(Buffer.from(bytes).toString('latin1')).toContain('PK\u0006\u0006');
        expect(Buffer.from(bytes).equals(Buffer.from(mem))).toBe(true);
    });
});

describe('a spool (1127)', () => {
    it('writes a text with its parts as memoryOut does; drop and dispose remove its files', async () => {
        const [parent, dir, name, fake] = fakeSpoolFolders();
        const spool = new Spool(parent, dir, name);
        const parts = ['<html>', new Uint8Array([65, 66]), new Blob(['<img src="data:x">']), '</html>'] as const;
        const mem = memoryOut();
        const file = await spool.file();
        for (const out of [mem, file]) {
            for (const p of parts) out.write(p as never);
            await out.ready();
        }
        const a = await mem.close('text/html');
        const b = await file.close('text/html');
        expect(await b.text()).toBe(await a.text());
        expect(b.type).toBe('text/html');
        expect(spool.holds(b)).toBe(true);
        const other = await (await spool.file()).close();
        expect(fake.files()).toHaveLength(2);
        await spool.drop(b);
        await spool.drop(new Blob(['not of the spool']));
        expect(fake.files()).toHaveLength(1);
        // A file given up leaves nothing.
        const gone = await spool.file();
        gone.write('half');
        await gone.abort();
        await Promise.resolve();
        expect(fake.files()).toHaveLength(1);
        expect(other.size).toBe(0);
        await spool.dispose();
        expect((parent as unknown as { entries: Map<string, unknown> }).entries.has(name)).toBe(false);
        await expect(spool.file()).rejects.toThrow();
    });

    it('a write that fails: ready and close throw it, the file is given up', async () => {
        const [parent, dir, name, fake] = fakeSpoolFolders();
        const spool = new Spool(parent, dir, name);
        const file = await spool.file();
        // A Blob the browser cannot read (its Blob memory broken: "network error").
        const broken = new Blob(['x']);
        broken.arrayBuffer = () => Promise.reject(new TypeError('network error'));
        file.write(broken);
        await expect(file.ready()).resolves.toBeUndefined();
        await expect(file.close()).rejects.toThrow('network error');
        expect(fake.files().every(f => f.writers === 0)).toBe(true);
    });

    it('none without the file system (Node) or under the size it is for', async () => {
        expect(await spoolFor('test', 10)).toBeNull();
        expect(await spoolFor('test', 10 * 1024 * 1024 * 1024)).toBeNull();
    });
});
