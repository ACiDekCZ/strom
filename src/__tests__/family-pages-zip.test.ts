/**
 * The set of files (spec 026 §6.4): the zip itself (STORE, CRC-32, the
 * central directory, names in UTF-8) read back by its own reader and by
 * `unzip -t` where the system has it; the set's contents (index.html, a file
 * per page, the shared styles and scripts, the images as files, the search
 * index as a script), its links between the files, no data URL in a page and
 * no living person's name in a path or in the search index.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPageSet, PageSet } from '../family-pages.js';
import { buildPageSetFilesAsync, pageSetZipName } from '../family-pages-html.js';
import { buildLineages, rods } from '../lineage.js';
import { PersonId, StromData } from '../types.js';
import { ZipEntry, buildZip, crc32, dataUrlBytes } from '../zip.js';
import { CLIP_IMG, PHOTO_IMG, familyPagesFixture, FP_NOW } from './helpers/family-pages-fixture.js';

interface Read { path: string; data: Uint8Array; crc: number; method: number; flags: number }

/** A reader of what buildZip writes: the end record, the central directory, each local header. */
function readZip(zip: Uint8Array): Read[] {
    const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const end = zip.length - 22;
    expect(v.getUint32(end, true)).toBe(0x06054B50);
    const n = v.getUint16(end + 10, true);
    let at = v.getUint32(end + 16, true);
    expect(at + v.getUint32(end + 12, true)).toBe(end);
    const dec = new TextDecoder();
    const out: Read[] = [];
    for (let i = 0; i < n; i++) {
        expect(v.getUint32(at, true)).toBe(0x02014B50);
        const nameLen = v.getUint16(at + 28, true);
        const local = v.getUint32(at + 42, true);
        const path = dec.decode(zip.subarray(at + 46, at + 46 + nameLen));
        const crc = v.getUint32(at + 16, true);
        const size = v.getUint32(at + 24, true);
        expect(v.getUint32(at + 20, true)).toBe(size);
        expect(v.getUint32(local, true)).toBe(0x04034B50);
        expect(v.getUint32(local + 14, true)).toBe(crc);
        const lName = v.getUint16(local + 26, true);
        expect(dec.decode(zip.subarray(local + 30, local + 30 + lName))).toBe(path);
        const start = local + 30 + lName + v.getUint16(local + 28, true);
        out.push({ path, data: zip.subarray(start, start + size), crc, method: v.getUint16(at + 10, true), flags: v.getUint16(at + 8, true) });
        at += 46 + nameLen + v.getUint16(at + 30, true) + v.getUint16(at + 32, true);
    }
    return out;
}

function hasUnzip(): boolean {
    try {
        execFileSync('unzip', ['-v'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

function rodsSet(data: StromData): PageSet {
    const rodIds = rods(buildLineages(data)).filter(r => !r.small).map(r => r.id);
    return buildPageSet(data, { kind: 'rods', rods: rodIds }, { lang: 'cs', now: FP_NOW });
}

const text = (e: ZipEntry | undefined): string => typeof e?.data === 'string' ? e.data : new TextDecoder().decode(e?.data);

describe('the zip (§6.4)', () => {
    it('CRC-32 of the IEEE polynomial', () => {
        expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xCBF43926);
        expect(crc32(new Uint8Array(0))).toBe(0);
    });

    it('stored entries read back: names in UTF-8, CRC, the data as it was; unzip -t agrees', () => {
        const bin = new Uint8Array(1000).map((_, i) => (i * 37) & 0xFF);
        const entries: ZipEntry[] = [
            { path: 'index.html', data: '<!doctype html><p>Fíšek</p>' },
            { path: 'obrazky/img-1.jpg', data: bin },
            { path: 'prázdný.txt', data: '' },
        ];
        const zip = buildZip(entries, new Date(2026, 9, 29, 12, 30, 10));
        const back = readZip(zip);
        expect(back.map(e => e.path)).toEqual(['index.html', 'obrazky/img-1.jpg', 'prázdný.txt']);
        for (const e of back) {
            expect(e.method).toBe(0);
            expect(e.flags & 0x0800).toBe(0x0800);
            expect(crc32(e.data)).toBe(e.crc);
        }
        expect(new TextDecoder().decode(back[0].data)).toBe('<!doctype html><p>Fíšek</p>');
        expect([...back[1].data]).toEqual([...bin]);
        // The DOS date of the first local header: 2026-10-29 12:30:10.
        const v = new DataView(zip.buffer);
        expect(v.getUint16(12, true)).toBe(((2026 - 1980) << 9) | (10 << 5) | 29);
        expect(v.getUint16(10, true)).toBe((12 << 11) | (30 << 5) | 5);
        if (!hasUnzip()) return;
        const dir = mkdtempSync(join(tmpdir(), 'strom-zip-'));
        try {
            const file = join(dir, 'a.zip');
            writeFileSync(file, zip);
            expect(execFileSync('unzip', ['-t', file]).toString()).toMatch(/No errors detected/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('data URLs to bytes', () => {
        const img = dataUrlBytes(CLIP_IMG)!;
        expect(img.mime).toBe('image/jpeg');
        expect([...img.bytes.subarray(0, 3)]).toEqual([0xFF, 0xD8, 0xFF]);
        expect(dataUrlBytes('https://example.org/a.jpg')).toBeNull();
    });
});

describe('the set of files (§6.4)', () => {
    it('index.html first, a file per page, the shared styles and scripts, the images as files, the search as a script', async () => {
        const { data } = familyPagesFixture();
        const set = rodsSet(data);
        expect(pageSetZipName(set)).toBe('Rody-Fisek-Repik-Kvapil.zip');
        const one = rods(buildLineages(data)).filter(r => !r.small)[0].id;
        expect(pageSetZipName(buildPageSet(data, { kind: 'rods', rods: [one] }, { lang: 'cs', now: FP_NOW }))).toBe('Rod-Fisek.zip');
        const j = `${set.personSlug.get('josef' as PersonId)}.html`;
        const entries = await buildPageSetFilesAsync(set);
        const paths = entries.map(e => e.path);
        expect(paths[0]).toBe('index.html');
        expect(paths).toEqual(expect.arrayContaining(['styl.css', 'skript.js', 'hledani.js', j, 'mapa-obci.html', 'rejstrik-osoby.html']));
        expect(paths).not.toContain(`${set.introSlug}.html`);
        const by = new Map(entries.map(e => [e.path, e]));
        // The images: bytes in obrazky/, the styles point there; no data URL in a page.
        const imgs = paths.filter(p => p.startsWith('obrazky/'));
        expect(imgs).toEqual(expect.arrayContaining([expect.stringMatching(/^obrazky\/img-\d+\.jpg$/)]));
        const photo = dataUrlBytes(PHOTO_IMG)!.bytes;
        expect(imgs.some(p => { const d = by.get(p)!.data as Uint8Array; return d.length === photo.length && d.every((b, i) => b === photo[i]); })).toBe(true);
        const css = text(by.get('styl.css'));
        for (const p of imgs) expect(css).toContain(`background-image:url("${p}")`);
        for (const e of entries.filter(x => x.path.endsWith('.html'))) {
            const html = text(e);
            expect(html, e.path).not.toContain('data:image');
            expect(html, e.path).toContain('<link rel="stylesheet" href="styl.css">');
            expect(html, e.path).toContain('<script src="hledani.js"></script><script src="skript.js"></script>');
            expect(html.match(/<section class="sp-page /g), e.path).toHaveLength(1);
        }
        // The search: the index as a script, the strings know the files.
        const ix = JSON.parse(text(by.get('hledani.js')).replace(/^window\.__spIndex=/, '').replace(/;\s*$/, ''));
        expect(ix.length).toBe(set.searchIndex.length);
        const strs = JSON.parse(text(by.get('index.html')).match(/<script type="application\/json" id="sp-strings">([^<]*)<\/script>/)![1]);
        expect(strs).toMatchObject({ zip: true, home: set.introSlug });
        expect(text(by.get('skript.js'))).toContain('window.__spIndex');
    });

    it('links between the files: a page, an anchor in a page, the introduction, the map with a place; inside a page as they were', async () => {
        const { data } = familyPagesFixture();
        const set = rodsSet(data);
        const entries = await buildPageSetFilesAsync(set);
        const by = new Map(entries.map(e => [e.path, text(e)]));
        const js = set.personSlug.get('josef' as PersonId)!;
        const home = by.get('index.html')!;
        expect(home).toContain('<nav class="sp-toc-file"');
        expect(home).toContain(`href="${js}.html"`);
        expect(home).not.toMatch(new RegExp(`href="#(?!${set.introSlug}\\b)[a-z]`));
        const josef = by.get(`${js}.html`)!;
        expect(josef).toContain('class="sp-fbar-home" href="index.html"');
        expect(josef).toMatch(new RegExp(`href="#${js}--[^"]+"`));
        expect(josef).not.toContain(`href="${js}.html`);
        // A place of a lineage's header: the map with the place selected.
        const rod = by.get(entries.find(e => /^rod-/.test(e.path))!.path)!;
        expect(rod).toContain('href="mapa-obci.html#mapa-obci--m-capkov" data-sp-place="capkov"');
        // Every link to a file leads to a file of the set.
        const files = new Set(entries.map(e => e.path));
        for (const [path, html] of by) {
            if (!path.endsWith('.html')) continue;
            for (const m of html.matchAll(/href="([^"#:]+\.html)/g)) expect(files.has(m[1]), `${path} → ${m[1]}`).toBe(true);
        }
    });

    it('no living person in a path, the search index or the pages; the zip reads back', async () => {
        const { data } = familyPagesFixture();
        const set = rodsSet(data);
        const entries = await buildPageSetFilesAsync(set);
        for (const e of entries) {
            expect(e.path).not.toMatch(/eva|petr/i);
            if (typeof e.data === 'string') expect(e.data, e.path).not.toMatch(/\bEva\b|\bPetr\b/);
        }
        const zip = buildZip(entries, FP_NOW);
        const back = readZip(zip);
        expect(back.map(e => e.path)).toEqual(entries.map(e => e.path));
        for (const e of back) expect(crc32(e.data)).toBe(e.crc);
    });
});
