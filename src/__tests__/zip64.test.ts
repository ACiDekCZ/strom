/**
 * An archive past 4 GB (1127: the gift package of a large tree with photos
 * holds them in the app, the pages, the book and the GEDCOM): sizes and
 * offsets too large for their 32-bit fields go into ZIP64 extra fields and
 * the ZIP64 end record. Gigabytes are not written in a test: the writer is
 * told to use ZIP64 from a small size on (`zip64At`), which a reader must
 * read the same way (a field of 0xFFFFFFFF sends it to the extra field).
 * Read back by Python's zipfile and `unzip -t` where the system has them;
 * an archive under the limit stays as it was (no ZIP64 record).
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZipBlobSink, ZipWriter } from '../zip.js';
import { blobBytes, hasUnzip, readZipEntries, unzipTest } from './helpers/zip-read.js';

const WHEN = new Date(2026, 11, 24, 10, 30, 0);
const TEXT = '<p>Rodokmen – Řehoř</p>\n'.repeat(300);
const JPEG = Uint8Array.from({ length: 5000 }, (_, i) => (i * 37) & 0xFF);

async function written(zip64At?: number): Promise<Uint8Array> {
    const sink = new ZipBlobSink();
    const w = new ZipWriter(sink.write, WHEN, { blobParts: true, ...(zip64At ? { zip64At } : {}) });
    await w.addAsync('Dárek/Kniha rodu.html', TEXT);
    await w.addAsync('Dárek/img-1.jpg', JPEG);
    await w.addAsync('Dárek/app.html', new Blob([TEXT, TEXT]));
    await w.addAsync('Dárek/stored.html', TEXT, 'store');
    await w.addAsync('Dárek/small.txt', 'x');
    await w.finishAsync();
    return blobBytes(sink.blob());
}

function hasPython(): boolean {
    try {
        execFileSync('python3', ['-V'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

/** Python's zipfile: every entry's name, size and bytes checked (CRC), as JSON. */
function pythonRead(zip: Uint8Array): { name: string; size: number; sha: string }[] {
    const dir = mkdtempSync(join(tmpdir(), 'strom-zip64-'));
    try {
        const file = join(dir, 'a.zip');
        writeFileSync(file, zip);
        const script = [
            'import sys, zipfile, json, hashlib',
            'z = zipfile.ZipFile(sys.argv[1])',
            'assert z.testzip() is None',
            'print(json.dumps([{"name": i.filename, "size": i.file_size, "sha": hashlib.sha256(z.read(i)).hexdigest()} for i in z.infolist()]))',
        ].join('\n');
        return JSON.parse(execFileSync('python3', ['-I', '-c', script, file], { encoding: 'utf8' }));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

function sha(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

describe('ZIP64 (1127)', () => {
    it('under the limit: no ZIP64 record, read by the plain reader', async () => {
        const zip = await written();
        const text = Buffer.from(zip).toString('latin1');
        expect(text).not.toContain('PK\u0006\u0006');
        expect(readZipEntries(zip).map(e => e.path)).toHaveLength(5);
    });

    it('past the limit: extra fields and the ZIP64 end record, the same entries read back', async () => {
        const plain = readZipEntries(await written());
        const zip = await written(1000);
        const text = Buffer.from(zip).toString('latin1');
        expect(text).toContain('PK\u0006\u0006');
        expect(text).toContain('PK\u0006\u0007');
        // The classic end record points to the ZIP64 one.
        const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
        expect(v.getUint32(zip.length - 22, true)).toBe(0x06054B50);
        expect(v.getUint32(zip.length - 22 + 16, true)).toBe(0xFFFFFFFF);
        if (hasPython()) {
            const read = pythonRead(zip);
            expect(read.map(r => r.name)).toEqual(plain.map(e => e.path));
            expect(read.map(r => r.size)).toEqual(plain.map(e => e.size));
            expect(read.map(r => r.sha)).toEqual(plain.map(e => sha(e.data)));
        }
        if (hasUnzip()) expect(unzipTest(zip)).toMatch(/No errors detected/);
    });
});
