/**
 * An independent reader of a zip archive for tests: the end record, the
 * central directory and each local header checked against each other, a
 * deflated entry inflated by Node's zlib, each entry's CRC-32 counted again.
 */

import { inflateRawSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from '../../zip.js';

export interface ZipRead {
    path: string;
    data: Uint8Array;
    method: number;
    flags: number;
    crc: number;
    size: number;
    csize: number;
}

/** Read the archive; throws on any inconsistency (a header, a size, a CRC). */
export function readZipEntries(zip: Uint8Array): ZipRead[] {
    const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const end = zip.length - 22;
    const fail = (what: string): never => { throw new Error(`zip: ${what}`); };
    if (v.getUint32(end, true) !== 0x06054B50) fail('no end record');
    const n = v.getUint16(end + 10, true);
    let at = v.getUint32(end + 16, true);
    if (at + v.getUint32(end + 12, true) !== end) fail('directory size');
    const dec = new TextDecoder('utf-8', { fatal: true });
    const out: ZipRead[] = [];
    for (let i = 0; i < n; i++) {
        if (v.getUint32(at, true) !== 0x02014B50) fail('central header');
        const flags = v.getUint16(at + 8, true);
        const method = v.getUint16(at + 10, true);
        const crc = v.getUint32(at + 16, true);
        const csize = v.getUint32(at + 20, true);
        const size = v.getUint32(at + 24, true);
        const nameLen = v.getUint16(at + 28, true);
        const local = v.getUint32(at + 42, true);
        const path = dec.decode(zip.subarray(at + 46, at + 46 + nameLen));
        if (v.getUint32(local, true) !== 0x04034B50) fail(`local header of ${path}`);
        if (v.getUint16(local + 8, true) !== method) fail(`method of ${path}`);
        if (v.getUint32(local + 14, true) !== crc) fail(`local CRC of ${path}`);
        if (v.getUint32(local + 18, true) !== csize || v.getUint32(local + 22, true) !== size) fail(`local sizes of ${path}`);
        const lName = v.getUint16(local + 26, true);
        if (dec.decode(zip.subarray(local + 30, local + 30 + lName)) !== path) fail(`local name of ${path}`);
        const start = local + 30 + lName + v.getUint16(local + 28, true);
        const raw = zip.subarray(start, start + csize);
        let data: Uint8Array;
        if (method === 0) data = raw;
        else if (method === 8) data = new Uint8Array(inflateRawSync(raw));
        else return fail(`method ${method} of ${path}`);
        if (data.length !== size) fail(`size of ${path}`);
        if (crc32(data) !== crc) fail(`CRC of ${path}`);
        out.push({ path, data, method, flags, crc, size, csize });
        at += 46 + nameLen + v.getUint16(at + 30, true) + v.getUint16(at + 32, true);
    }
    return out;
}

/** The archive's entries as a map path → bytes. */
export function zipFiles(zip: Uint8Array): Map<string, Uint8Array> {
    return new Map(readZipEntries(zip).map(e => [e.path, e.data]));
}

export async function blobBytes(blob: Blob): Promise<Uint8Array> {
    return new Uint8Array(await blob.arrayBuffer());
}

export function hasUnzip(): boolean {
    try {
        execFileSync('unzip', ['-v'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

/** `unzip -t` over the archive written to a temporary file; its output. */
export function unzipTest(zip: Uint8Array): string {
    const dir = mkdtempSync(join(tmpdir(), 'strom-zip-'));
    try {
        const file = join(dir, 'test.zip');
        writeFileSync(file, zip);
        return execFileSync('unzip', ['-t', file], { encoding: 'utf8' });
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}
