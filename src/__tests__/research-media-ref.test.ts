/**
 * Pictures the research holds go by reference (spec 133 phase 1): an excerpt
 * without its FILE, a file as `_STROM_DATA <sha>` in place of its data URL.
 * The export by reference is the export with data with only those lines
 * changed; without the option it is the export as ever. All data is invented.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { migrateData } from '../data.js';
import { exportToGedcom, type GedcomMediaRef } from '../ged-exporter.js';
import {
    askMediaKnown, cachedDataUrlSha, isMediaRefUnknown, dataUrlBytes, dataUrlSha, excerptOriginalShas, forgetMediaRefMemory, MEDIA_REF_UNKNOWN_CODE,
    mediaRefGate, mediaRefOf, mediaRefUnknownShas, noteMediaRefRefused, prepareMediaRef, SYNC_MEDIA_REF_FEATURE, treeDataUrls, utf8Length,
} from '../research-media-ref.js';
import { MEDIA_KNOWN_MAX } from '../batch.js';
import type { Attachment, MediaPlace, StromData } from '../types.js';

/** Deterministic bytes of picture `n` (long enough for CONC lines). */
function bytesOf(n: number, size = 700): Buffer {
    const b = Buffer.alloc(size);
    let x = n * 2654435761 >>> 0;
    for (let i = 0; i < size; i++) {
        x = (x * 1103515245 + 12345) >>> 0;
        b[i] = x >>> 24;
    }
    return b;
}
const jpeg = (n: number): string => `data:image/jpeg;base64,${bytesOf(n).toString('base64')}`;
const png = (n: number): string => `data:image/png;base64,${bytesOf(n).toString('base64')}`;
const shaOfBytes = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const sha = (n: number): string => shaOfBytes(bytesOf(n));

const ORIG_KNOWN = 'a1'.repeat(32);
const ORIG_UNKNOWN = 'b2'.repeat(32);
const ORIG_OF_CLIP = 'c3'.repeat(32);

const person = (id: string, firstName: string, extra: Record<string, unknown> = {}) => ({
    id, firstName, lastName: 'Bergqvist', gender: 'male', isPlaceholder: false,
    partnerships: ['u1'], parentIds: [], childIds: [], ...extra,
});

/**
 * Two people and their couple; portraits (one known), the couple's photo
 * (unknown), files at one place (known, unknown), at three places (known:
 * one media record by reference, one with data), only an original; a source
 * with excerpts: with a clip, cut from a known original, from an unknown one,
 * without an original.
 */
function tree(): StromData {
    const att = (id: string, n: number, places: MediaPlace[], extra: Partial<Attachment> = {}): Attachment =>
        ({ id, name: `file${n}.png`, mimeType: 'image/png', dataUrl: png(n), sizeBytes: 700, places, ...extra }) as Attachment;
    const p1 = 'p1' as never, p2 = 'p2' as never, u1 = 'u1' as never;
    return migrateData({
        version: 24,
        persons: {
            p1: person('p1', 'Torvald', { photo: jpeg(1), events: [{ id: 'e1', type: 'occupation', note: 'miller' }] }),
            p2: person('p2', 'Sigrun', { gender: 'female', photo: jpeg(2) }),
        },
        partnerships: {
            u1: { id: 'u1', person1Id: 'p1', person2Id: 'p2', status: 'married', childIds: [], photo: jpeg(3) },
        },
        sources: {
            s1: {
                id: 's1', title: 'Parish register of Lindby',
                excerpts: [
                    { id: 'x1', dataUrl: jpeg(20), width: 10, height: 10, sizeBytes: 700, clip: 'K0007', originalSha: ORIG_OF_CLIP, caption: 'Baptism' },
                    { id: 'x2', dataUrl: jpeg(21), width: 10, height: 10, sizeBytes: 700, originalSha: ORIG_KNOWN, pageUrl: 'https://archive.invalid/page/2' },
                    { id: 'x3', dataUrl: jpeg(22), width: 10, height: 10, sizeBytes: 700, originalSha: ORIG_UNKNOWN },
                    { id: 'x4', dataUrl: jpeg(23), width: 10, height: 10, sizeBytes: 700 },
                ],
            },
        },
        media: {
            m1: att('m1', 10, [{ personId: p1 }], { title: 'Mill deed', kind: 'document' }),
            m2: att('m2', 11, [{ personId: p2 }]),
            m3: att('m3', 12, [{ personId: p1, eventId: 'e1' }, { partnershipId: u1 }, { personId: p2 }], { title: 'Letter from the attic, long enough to wrap the title over the line limit of the file '.repeat(4), kind: 'record', note: 'Kept in a box' }),
            m4: att('m4', 13, [{ personId: p1 }, { sourceId: 's1' }, { personId: p2 }]),
            m5: att('m5', 14, [{ personId: p2 }], { originalOnly: true, dataUrl: '', original: { sha256: 'd4'.repeat(32), mimeType: 'image/tiff' } as never }),
            m6: att('m6', 15, [{ sourceId: 's1' }]),
        },
    } as never);
}

/** The research holds: portrait 1, files 10 and 12 (the record), 15 (at the source), the original of excerpt x2. */
const KNOWN = new Set([sha(1), sha(10), sha(12), sha(15), ORIG_KNOWN]);

/**
 * The export with data turned into what it is by reference: an excerpt the
 * research holds loses FILE and its CONC; a file it holds has `_STROM_DATA`
 * in place of FILE (a media record's FORM, TYPE and TITL one level up).
 */
function byReference(ged: string, excerpt: (clip?: string, orig?: string) => boolean, shaOf: (url: string) => string | undefined): string {
    const lines = ged.split('\n');
    const out: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        const m = /^(\d+) FILE (data:.*)$/.exec(lines[i]);
        if (!m) {
            out.push(lines[i]);
            continue;
        }
        const lvl = Number(m[1]);
        let url = m[2];
        let j = i + 1;
        const conc = `${lvl + 1} CONC `;
        while (j < lines.length && lines[j].startsWith(conc)) url += lines[j++].slice(conc.length);
        const whole = lines.slice(i, j);
        i = j - 1;
        let k = out.length - 1;
        while (k >= 0 && !out[k].startsWith(`${lvl - 1} OBJE`) && !/^0 @M\d+@ OBJE$/.test(out[k])) k--;
        const block = out.slice(k);
        if (block.includes(`${lvl} _STROM_KIND excerpt`)) {
            const clip = block.find(l => l.startsWith(`${lvl} _STROM_CLIP `))?.split(' ')[2];
            const orig = block.find(l => l.startsWith(`${lvl} _STROM_SHA `))?.split(' ')[2];
            if (!excerpt(clip, orig)) out.push(...whole);
            continue;
        }
        const ref = shaOf(url);
        if (!ref) {
            out.push(...whole);
            continue;
        }
        out.push(`${lvl} _STROM_DATA ${ref}`);
        if (lvl === 1) {
            // A media record: what stood under FILE goes right under the record.
            while (i + 1 < lines.length && /^[2-9] /.test(lines[i + 1])) {
                const l = lines[++i];
                out.push(`${Number(l[0]) - 1}${l.slice(1)}`);
            }
        }
    }
    return out.join('\n');
}

const OPTIONS = { research: { id: 'r-1', head: 'h1', appTree: 't1', sent: 'fp' }, appMedia: true, mediaDates: true } as const;

describe('the export by reference (spec 133 U1)', () => {
    beforeEach(() => forgetMediaRefMemory());

    it('equals the export with data with only the pictures\' data lines changed', async () => {
        const data = tree();
        const shaOf = new Map<string, string>();
        for (const url of treeDataUrls(data)) shaOf.set(url, (await dataUrlSha(url))!);
        const ref = mediaRefOf({ known: true }, KNOWN, new Set(), url => shaOf.get(url));
        const withData = exportToGedcom(data, 'T', OPTIONS);
        const withRefs = exportToGedcom(data, 'T', { ...OPTIONS, mediaRef: ref });
        const expected = byReference(withData.content,
            (clip, orig) => !!clip || (!!orig && KNOWN.has(orig)),
            url => { const s = shaOf.get(url); return s && KNOWN.has(s) ? s : undefined; });
        expect(withRefs.content).toBe(expected);
        expect(withRefs.content).not.toBe(withData.content);

        // What went by reference, in its places.
        const c = withRefs.content;
        expect(c).toContain(`2 _STROM_KIND photo\n2 _STROM_DATA ${sha(1)}`);
        expect(c).toMatch(/2 _STROM_KIND photo\n2 FILE data:image\/jpeg;base64,/);
        expect(c).toMatch(/\n0 @M\d+@ OBJE\n1 _STROM_DATA [0-9a-f]{64}\n1 FORM png\n2 TYPE record\n1 TITL Letter/);
        expect(c).toMatch(/\n0 @M\d+@ OBJE\n1 FILE data:image\/png;base64,/);
        expect(c).toContain(`2 _STROM_DATA ${sha(15)}`);
        expect(c).toContain(`2 _STROM_DATA ${sha(10)}`);
        // Only the original: as ever (its name and hash, never a reference).
        expect(c).toContain('2 FILE file14.png');
        expect(c).toContain(`_STROM_SHA ${'d4'.repeat(32)}`);
        // The couple's photo and the second portrait: unknown, with data.
        expect(c.match(/_STROM_DATA/g)).toHaveLength(4);
        // Excerpts: x1 (clip) and x2 (known original) without FILE, x3 and x4 with.
        const excerpts = c.split('\n1 OBJE\n').filter(b => b.includes('_STROM_KIND excerpt'));
        expect(excerpts).toHaveLength(4);
        expect(excerpts.map(b => b.includes('2 FILE data:'))).toEqual([false, false, true, true]);
        expect(excerpts[0]).toContain('2 _STROM_CLIP K0007');

        expect(withData.media).toEqual({ excerptsRef: 0, excerptsData: 4, filesRef: 0, filesData: 8 });
        expect(withRefs.media).toEqual({ excerptsRef: 2, excerptsData: 2, filesRef: 4, filesData: 4 });
    });

    it('without the option, or one that holds nothing, the export is byte for byte as ever', () => {
        const data = tree();
        const plain = exportToGedcom(data, 'T', OPTIONS).content;
        const none: GedcomMediaRef = { excerpt: () => false, dataSha: () => undefined };
        expect(exportToGedcom(data, 'T', { ...OPTIONS, mediaRef: none }).content).toBe(plain);
        expect(plain).not.toContain('_STROM_DATA');
        expect(plain.match(/ FILE data:/g)).toHaveLength(12);
    });

    it('a hash that is not one is never written as a reference', () => {
        const data = tree();
        const bad: GedcomMediaRef = { excerpt: () => false, dataSha: () => 'not-a-hash' };
        expect(exportToGedcom(data, 'T', { ...OPTIONS, mediaRef: bad }).content).toBe(exportToGedcom(data, 'T', OPTIONS).content);
    });
});

describe('the gate and the choice', () => {
    beforeEach(() => forgetMediaRefMemory());

    it('sync.mediaRef alone: excerpts with a clip only; with media.known also what the research holds', () => {
        expect(SYNC_MEDIA_REF_FEATURE).toBe('sync.mediaRef');
        expect(mediaRefGate(null)).toBeNull();
        expect(mediaRefGate(['media.known', 'media.app'])).toBeNull();
        expect(mediaRefGate(['sync.mediaRef'])).toEqual({ known: false });
        expect(mediaRefGate(['sync.mediaRef', 'media.known'])).toEqual({ known: true });

        const shaOf = () => sha(1);
        const clipsOnly = mediaRefOf({ known: false }, KNOWN, new Set(), shaOf);
        expect(clipsOnly.excerpt({ clip: 'K1' })).toBe(true);
        expect(clipsOnly.excerpt({ originalSha: ORIG_KNOWN })).toBe(false);
        expect(clipsOnly.dataSha(jpeg(1))).toBeUndefined();

        const all = mediaRefOf({ known: true }, KNOWN, new Set([ORIG_KNOWN]), shaOf);
        // A refused hash goes with data; a clip never needs asking.
        expect(all.excerpt({ originalSha: ORIG_KNOWN })).toBe(false);
        expect(all.excerpt({ clip: 'K1', originalSha: ORIG_KNOWN })).toBe(true);
        expect(all.excerpt({ originalSha: ORIG_UNKNOWN.toUpperCase() })).toBe(false);
        expect(all.excerpt({})).toBe(false);
        expect(all.dataSha(jpeg(1))).toBe(sha(1));
    });

    it('the tree\'s data URLs and the originals of excerpts without a clip, each once', () => {
        const data = tree();
        const urls = treeDataUrls(data);
        // Portraits, the couple's photo, the files with a preview (not the original alone, not the excerpts).
        expect(urls.sort()).toEqual([jpeg(1), jpeg(2), jpeg(3), png(10), png(11), png(12), png(13), png(15)].sort());
        expect(excerptOriginalShas(data).sort()).toEqual([ORIG_KNOWN, ORIG_UNKNOWN].sort());
    });
});

describe('the hash of a data URL', () => {
    beforeEach(() => forgetMediaRefMemory());

    it('is the SHA-256 of its bytes, as the research reads them', async () => {
        const b = bytesOf(5, 1000);
        const b64 = b.toString('base64');
        expect(await dataUrlSha(`data:image/jpeg;base64,${b64}`)).toBe(shaOfBytes(b));
        // Whitespace and the URL-safe alphabet read as the research reads them.
        const wrapped = b64.replace(/(.{76})/g, '$1\r\n');
        expect(await dataUrlSha(`data:image/jpeg;base64,${wrapped}`)).toBe(shaOfBytes(b));
        const urlSafe = b64.replace(/\+/g, '-').replace(/\//g, '_');
        expect(await dataUrlSha(`data:image/jpeg;BASE64,${urlSafe}`)).toBe(shaOfBytes(b));
        expect(await dataUrlSha('data:image/svg+xml;charset=utf-8,<svg/>')).toBeNull();
        expect(await dataUrlSha('data:image/png;base64,')).toBeNull();
        expect(await dataUrlSha('data:image/png;base64,ab$c')).toBeNull();
        expect(dataUrlBytes('https://example.invalid/a.jpg')).toBeNull();
    });

    it('is hashed once and known later without hashing (a send leaving the page)', async () => {
        const url = jpeg(7);
        expect(cachedDataUrlSha(url)).toBeUndefined();
        expect(await dataUrlSha(url)).toBe(sha(7));
        expect(cachedDataUrlSha(url)).toBe(sha(7));
    });
});

describe('media/known and a refusal', () => {
    beforeEach(() => forgetMediaRefMemory());

    const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

    it('only {id, …} is held; queued, null and not answered are not', async () => {
        const asked: string[][] = [];
        const f = (async (_url: string, init?: { body?: string }) => {
            asked.push(JSON.parse(String(init?.body)).shas);
            return answer({ known: { [sha(1)]: { id: 'I0001', kind: 'image', mime: 'image/jpeg', bytes: 700, here: true }, [sha(2)]: { queued: true }, [sha(3)]: null } });
        }) as unknown as typeof fetch;
        const known = await askMediaKnown('http://127.0.0.1:47321/t0k3n', [sha(1), sha(2), sha(3), sha(4)], f);
        expect([...known!]).toEqual([sha(1)]);
        expect(asked).toEqual([[sha(1), sha(2), sha(3), sha(4)]]);
    });

    it('asked in parts of at most MEDIA_KNOWN_MAX; a failed or odd answer holds nothing', async () => {
        const shas = Array.from({ length: MEDIA_KNOWN_MAX + 3 }, (_, i) => i.toString(16).padStart(64, '0'));
        const sizes: number[] = [];
        const ok = (async (_url: string, init?: { body?: string }) => {
            const part: string[] = JSON.parse(String(init?.body)).shas;
            sizes.push(part.length);
            return answer({ known: Object.fromEntries(part.map(s => [s, { id: 'I1' }])) });
        }) as unknown as typeof fetch;
        expect((await askMediaKnown('http://b', shas, ok))!.size).toBe(MEDIA_KNOWN_MAX + 3);
        expect(sizes).toEqual([MEDIA_KNOWN_MAX, 3]);
        expect(await askMediaKnown('http://b', shas.slice(0, 2), (async () => answer({ error: 'x' }, 500)) as unknown as typeof fetch)).toBeNull();
        expect(await askMediaKnown('http://b', shas.slice(0, 2), (async () => answer({ nope: 1 })) as unknown as typeof fetch)).toBeNull();
        expect(await askMediaKnown('http://b', shas.slice(0, 2), (async () => { throw new TypeError('gone'); }) as unknown as typeof fetch)).toBeNull();
    });

    it('a refusal\'s hashes: valid ones, each once; they go with data for the rest of the page', async () => {
        expect(MEDIA_REF_UNKNOWN_CODE).toBe('sync.media-ref-unknown');
        expect(mediaRefUnknownShas({ ok: false, code: MEDIA_REF_UNKNOWN_CODE, shas: [sha(1), sha(1).toUpperCase(), 'x', 7] })).toEqual([sha(1)]);
        expect(mediaRefUnknownShas({ code: MEDIA_REF_UNKNOWN_CODE })).toEqual([]);
        expect(mediaRefUnknownShas(null)).toEqual([]);
        // The code as the research writes it (not lower case: read from the body itself).
        expect(isMediaRefUnknown({ ok: false, code: 'sync.media-ref-unknown' })).toBe(true);
        expect(isMediaRefUnknown({ ok: false, code: 'sync.mediaref-unknown' })).toBe(false);
        expect(isMediaRefUnknown(null)).toBe(false);

        const data = tree();
        const f = (async (_url: string, init?: { body?: string }) => {
            const part: string[] = JSON.parse(String(init?.body)).shas;
            return answer({ known: Object.fromEntries(part.filter(s => KNOWN.has(s)).map(s => [s, { id: 'I1' }])) });
        }) as unknown as typeof fetch;
        const features = ['sync.mediaRef', 'media.known'];
        const first = await prepareMediaRef({ researchId: 'r-1', base: 'http://b', features, data, fetchFn: f });
        expect(first!.dataSha(jpeg(1))).toBe(sha(1));
        noteMediaRefRefused('r-1', [sha(1)]);
        const after = await prepareMediaRef({ researchId: 'r-1', base: 'http://b', features, data, fetchFn: f });
        expect(after!.dataSha(jpeg(1))).toBeUndefined();
        expect(after!.dataSha(png(10))).toBe(sha(10));
        // Another research is not touched by it.
        expect((await prepareMediaRef({ researchId: 'r-2', base: 'http://b', features, data, fetchFn: f }))!.dataSha(jpeg(1))).toBe(sha(1));
    });

    it('leaving the page asks nothing: what was said before, of files hashed before; a bridge without the feature gets nothing', async () => {
        const data = tree();
        let asks = 0;
        const f = (async (_url: string, init?: { body?: string }) => {
            asks++;
            const part: string[] = JSON.parse(String(init?.body)).shas;
            return answer({ known: Object.fromEntries(part.filter(s => KNOWN.has(s)).map(s => [s, { id: 'I1' }])) });
        }) as unknown as typeof fetch;
        const features = ['sync.mediaRef', 'media.known'];
        const cold = await prepareMediaRef({ researchId: 'r-1', base: 'http://b', features, data, keepalive: true, fetchFn: f });
        expect(asks).toBe(0);
        expect(cold!.excerpt({ clip: 'K1' })).toBe(true);
        expect(cold!.dataSha(jpeg(1))).toBeUndefined();
        await prepareMediaRef({ researchId: 'r-1', base: 'http://b', features, data, fetchFn: f });
        expect(asks).toBe(1);
        const warm = await prepareMediaRef({ researchId: 'r-1', base: 'http://b', features, data, keepalive: true, fetchFn: f });
        expect(asks).toBe(1);
        expect(warm!.dataSha(jpeg(1))).toBe(sha(1));
        expect(warm!.excerpt({ originalSha: ORIG_KNOWN })).toBe(true);
        expect(await prepareMediaRef({ researchId: 'r-1', base: 'http://b', features: ['media.known'], data, fetchFn: f })).toBeUndefined();
        expect(asks).toBe(1);
        // A failed ask: only clips by reference.
        const failed = await prepareMediaRef({ researchId: 'r-1', base: 'http://b', features, data,
            fetchFn: (async () => { throw new TypeError('gone'); }) as unknown as typeof fetch });
        expect(failed!.dataSha(jpeg(1))).toBeUndefined();
        expect(failed!.excerpt({ originalSha: ORIG_KNOWN })).toBe(false);
        expect(failed!.excerpt({ clip: 'K1' })).toBe(true);
    });

    it('utf8Length counts as TextEncoder does', () => {
        for (const t of ['', 'abc', 'Příliš žluťoučký kůň', '🌳 tree 🌳', 'x\ud800y']) {
            expect(utf8Length(t)).toBe(new TextEncoder().encode(t).length);
        }
    });
});
