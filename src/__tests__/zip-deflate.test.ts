/**
 * The archive with compression (spec 093 §5): text deflated (method 8),
 * images and archives stored (method 0), a Blob taken as it is, names in
 * UTF-8, each CRC right; read back by an independent reader (Node's zlib)
 * and by `unzip -t` where the system has it. The synchronous API stays as
 * it was (buildZip and `add` store everything).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ZipBlobSink, ZipWriter, buildZip, canDeflate, crc32, isCompressible } from '../zip.js';
import { blobBytes, hasUnzip, readZipEntries, unzipTest } from './helpers/zip-read.js';

const WHEN = new Date(2026, 11, 24, 10, 30, 0);
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
const TEXT = '<p>Rodokmen</p>\n'.repeat(400);
const NAMES = ['Začít zde.html', 'Kniha rodu – Řehoř.html', 'Für Großmutter ü.html', 'Księga łódź.html', 'Strom 🌳.html'];

async function written(fill: (w: ZipWriter) => Promise<void>): Promise<Uint8Array> {
    const sink = new ZipBlobSink();
    const w = new ZipWriter(sink.write, WHEN, { blobParts: true });
    await fill(w);
    await w.finishAsync();
    return blobBytes(sink.blob());
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('ZipWriter.addAsync', () => {
    it('deflates text, stores images and archives; every entry reads back with its CRC', async () => {
        expect(canDeflate()).toBe(true);
        const inner = buildZip([{ path: 'a.txt', data: TEXT }], WHEN);
        const zip = await written(async (w) => {
            const t = await w.addAsync('dir/index.html', TEXT);
            expect(t.method).toBe(8);
            expect(t.csize).toBeLessThan(t.size);
            expect((await w.addAsync('dir/photo.png', PNG)).method).toBe(0);
            expect((await w.addAsync('dir/inner.zip', inner)).method).toBe(0);
            expect((await w.addAsync('dir/photo.JPG', new Blob([PNG]))).method).toBe(0);
            expect((await w.addAsync('dir/big.html', new Blob([TEXT, TEXT]))).method).toBe(8);
            expect((await w.addAsync('dir/stored.html', TEXT, 'store')).method).toBe(0);
            expect((await w.addAsync('dir/empty.txt', '')).method).toBe(0);
        });
        const read = readZipEntries(zip);
        const dec = new TextDecoder();
        expect(read.map(e => [e.path, e.method])).toEqual([
            ['dir/index.html', 8], ['dir/photo.png', 0], ['dir/inner.zip', 0], ['dir/photo.JPG', 0],
            ['dir/big.html', 8], ['dir/stored.html', 0], ['dir/empty.txt', 0],
        ]);
        expect(dec.decode(read[0].data)).toBe(TEXT);
        expect([...read[1].data]).toEqual([...PNG]);
        expect([...read[2].data]).toEqual([...inner]);
        expect(dec.decode(read[4].data)).toBe(TEXT + TEXT);
        expect(read[0].crc).toBe(crc32(new TextEncoder().encode(TEXT)));
        expect(read[6].size).toBe(0);
        // The archive inside is itself readable.
        expect(dec.decode(readZipEntries(read[2].data)[0].data)).toBe(TEXT);
        if (hasUnzip()) expect(unzipTest(zip)).toMatch(/No errors detected/);
    });

    it('names in UTF-8 (č, ř, ü, ł, emoji) with the UTF-8 flag', async () => {
        const zip = await written(async (w) => {
            for (const n of NAMES) await w.addAsync(`Rodokmen – Eva Berg/${n}`, `<p>${n}</p>`);
        });
        const read = readZipEntries(zip);
        expect(read.map(e => e.path)).toEqual(NAMES.map(n => `Rodokmen – Eva Berg/${n}`));
        for (const e of read) {
            expect(e.flags & 0x0800).toBe(0x0800);
            expect(new TextDecoder().decode(e.data)).toBe(`<p>${e.path.split('/')[1]}</p>`);
        }
        if (hasUnzip()) expect(unzipTest(zip)).toMatch(/No errors detected/);
    });

    it('entries come in the order of the calls even when not awaited one by one', async () => {
        const zip = await written(async (w) => {
            await Promise.all([w.addAsync('1.html', TEXT), w.addAsync('2.png', PNG), w.addAsync('3.html', 'x')]);
        });
        expect(readZipEntries(zip).map(e => e.path)).toEqual(['1.html', '2.png', '3.html']);
    });

    it('without CompressionStream everything is stored and still readable', async () => {
        vi.stubGlobal('CompressionStream', undefined);
        expect(canDeflate()).toBe(false);
        const zip = await written(async (w) => {
            expect((await w.addAsync('index.html', TEXT)).method).toBe(0);
            expect((await w.addAsync('b.html', new Blob([TEXT]))).method).toBe(0);
        });
        const read = readZipEntries(zip);
        expect(read.map(e => e.method)).toEqual([0, 0]);
        expect(new TextDecoder().decode(read[1].data)).toBe(TEXT);
    });

    it('a writer of arrays gets a stored Blob as its bytes', async () => {
        const parts: Uint8Array[] = [];
        const w = new ZipWriter(p => { parts.push(p); }, WHEN);
        await w.addAsync('photo.png', new Blob([PNG]));
        await w.finishAsync();
        expect(parts.every(p => p instanceof Uint8Array)).toBe(true);
        const read = readZipEntries(await blobBytes(new Blob(parts as BlobPart[])));
        expect([...read[0].data]).toEqual([...PNG]);
    });

    it('add() while addAsync() still runs is refused', async () => {
        const w = new ZipWriter(() => { /* nowhere */ }, WHEN);
        const run = w.addAsync('a.html', TEXT);
        expect(() => w.add('b.html', 'x')).toThrow();
        await run;
        expect(() => w.add('b.html', 'x')).not.toThrow();
    });
});

describe('the synchronous API as before', () => {
    it('buildZip stores everything, names in UTF-8', () => {
        const zip = buildZip([{ path: 'Začít zde.html', data: TEXT }, { path: 'a.png', data: PNG }], WHEN);
        const read = readZipEntries(zip);
        expect(read.map(e => [e.path, e.method])).toEqual([['Začít zde.html', 0], ['a.png', 0]]);
        expect(new TextDecoder().decode(read[0].data)).toBe(TEXT);
    });

    it('which names are compressed', () => {
        for (const n of ['a.html', 'b.ged', 'c.svg', 'd.json', 'e.css', 'f.js', 'g']) expect(isCompressible(n)).toBe(true);
        for (const n of ['a.jpg', 'b.JPEG', 'c.png', 'd.zip', 'e.webp', 'f.gif', 'g.pdf']) expect(isCompressible(n)).toBe(false);
    });
});
