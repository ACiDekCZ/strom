/**
 * Source images the research left out of its file: the marker in its GEDCOM,
 * the store that keeps loaded ones with the tree (and never loads one twice),
 * the bridge client, the state of a source and the bulk queue. Invented data.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { Source, StromData } from '../types.js';
import {
    setResearchImageBackend, memoryBackend, ResearchImageBackend, primeResearchImages, loadResearchImage,
    storedImagesOf, shownExcerpts, pendingClips, removeResearchImages, researchImagesTotal, pruneDeliveredImages,
    fetchExcerpt, fetchMissingList, heldImageMode, sourceImageState, ResearchImageQueue, resetKnownImageErrors,
    StoredResearchImage, LoadError, formatImageBytes, hasResearchImages,
} from '../research-images.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const BASE = 'http://127.0.0.1:5998/0123456789abcdef0123456789abcdef';

const GED = `0 HEAD
1 CHAR UTF-8
0 @S0001@ SOUR
1 TITL Křest Jan Novák 1885
1 REFN S0001
1 _STROM_IMG_OMITTED scope
2 _STROM_CLIP c3fa91b0d22
2 _STROM_CLIP c88e01aa7f4
0 @S0002@ SOUR
1 TITL Oddací zápis 1910
1 REFN S0002
1 OBJE
2 FILE ${PNG}
2 _STROM_CLIP a1
1 _STROM_IMG_OMITTED missing
2 _STROM_CLIP a2
0 @S0003@ SOUR
1 TITL Pohřeb 1950
1 REFN S0003
1 _STROM_IMG_OMITTED someday
2 _STROM_CLIP input
0 @S0004@ SOUR
1 TITL Sčítání lidu 1921
1 REFN S0004
0 TRLR
`;

function sources(ged = GED): Record<string, Source> {
    return convertToStrom(parseGedcom(ged)).data.sources ?? {};
}

function byRef(all: Record<string, Source>, ref: string): Source {
    return Object.values(all).find(s => s.refn === ref)!;
}

/** A bridge answering /excerpt and /excerpts from a table. */
function bridge(routes: (url: string) => { status: number; body: unknown }, seen: string[] = []) {
    return async (url: string): Promise<Response> => {
        seen.push(url);
        const r = routes(url);
        return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
    };
}

const okExcerpt = (clip: string) => ({ status: 200, body: { source: 'S0001', level: 'normal', missing: [], excerpts: [{ clip, sha: 'a'.repeat(64), region: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 }, width: 1, height: 1, mime: 'image/png', bytes: 70, dataUrl: PNG }] } });

describe('the marker in the research file', () => {
    it('reads the reason and the held marks, and keeps excerpts that came', () => {
        const all = sources();
        const s1 = byRef(all, 'S0001');
        expect(s1.imageHeld).toBe('scope');
        expect(s1.heldClips).toEqual(['c3fa91b0d22', 'c88e01aa7f4']);
        expect(s1.excerpts ?? []).toHaveLength(0);
        const s2 = byRef(all, 'S0002');
        expect(s2.imageHeld).toBe('missing');
        expect(s2.heldClips).toEqual(['a2']);
        expect(s2.excerpts?.map(e => e.clip)).toEqual(['a1']);
        // A reason this app does not know reads as "other"; the whole input is a mark too.
        expect(byRef(all, 'S0003').imageHeld).toBe('other');
        expect(byRef(all, 'S0003').heldClips).toEqual(['input']);
        // No marker: nothing new.
        expect(byRef(all, 'S0004').imageHeld).toBeUndefined();
        expect(byRef(all, 'S0004').heldClips).toBeUndefined();
    });

    it('is not counted as an unread tag', () => {
        const result = convertToStrom(parseGedcom(GED));
        expect(JSON.stringify(result)).not.toContain('_STROM_IMG_OMITTED"');
    });
});

describe('stored research images', () => {
    let rows: ResearchImageBackend;
    let puts = 0;
    beforeEach(() => {
        const mem = memoryBackend();
        puts = 0;
        rows = { ...mem, put: async (img) => { puts++; await mem.put(img); } };
        setResearchImageBackend(rows);
        resetKnownImageErrors();
    });

    it('loads an excerpt once, keeps it across a reload and does not ask again', async () => {
        const all = sources();
        const s1 = byRef(all, 'S0001');
        const seen: string[] = [];
        const fetchImpl = bridge(url => okExcerpt(new URL(url).searchParams.get('clip')!), seen);
        await primeResearchImages('t1');
        expect(pendingClips('t1', s1)).toEqual(['c3fa91b0d22', 'c88e01aa7f4']);
        const got = await loadResearchImage('t1', BASE, 'h1', 'S0001', 'c3fa91b0d22', undefined, { fetchImpl });
        expect((got as StoredResearchImage).excerpt.clip).toBe('c3fa91b0d22');
        expect(seen[0]).toContain('/excerpt/S0001?clip=c3fa91b0d22');
        expect(seen[0]).toContain('app=');
        expect(pendingClips('t1', s1)).toEqual(['c88e01aa7f4']);

        // A new tab: the cache is gone, the store is not.
        const kept = rows;
        setResearchImageBackend(kept);
        await primeResearchImages('t1');
        expect(storedImagesOf('t1', s1).map(r => r.clip)).toEqual(['c3fa91b0d22']);
        expect(shownExcerpts('t1', s1)).toHaveLength(1);
        expect(pendingClips('t1', s1)).toEqual(['c88e01aa7f4']);
        expect(puts).toBe(1);
        // Another tree has nothing.
        await primeResearchImages('t2');
        expect(storedImagesOf('t2', s1)).toEqual([]);
    });

    it('is not tree data: removing gives the sizes back, the total counts per source', async () => {
        const fetchImpl = bridge(url => okExcerpt(new URL(url).searchParams.get('clip')!));
        await loadResearchImage('t1', BASE, 'h1', 'S0001', 'c3fa91b0d22', undefined, { fetchImpl });
        await loadResearchImage('t1', BASE, 'h1', 'S0001', 'c88e01aa7f4', undefined, { fetchImpl });
        await loadResearchImage('t1', BASE, 'h1', 'S0003', 'input', undefined, { fetchImpl });
        const total = researchImagesTotal('t1');
        expect(total.sources).toBe(2);
        expect(total.images).toBe(3);
        expect(total.bytes).toBeGreaterThan(0);
        const gone = await removeResearchImages('t1', 'S0001');
        expect(gone.n).toBe(2);
        expect(researchImagesTotal('t1').images).toBe(1);
        expect((await removeResearchImages('t1')).n).toBe(1);
        expect(researchImagesTotal('t1').images).toBe(0);
    });

    it('drops a stored copy quietly once the research file brings that excerpt', async () => {
        const fetchImpl = bridge(url => okExcerpt(new URL(url).searchParams.get('clip')!));
        await loadResearchImage('t1', BASE, 'h1', 'S0001', 'c3fa91b0d22', undefined, { fetchImpl });
        await loadResearchImage('t1', BASE, 'h1', 'S0001', 'c88e01aa7f4', undefined, { fetchImpl });
        const next = GED.replace(`1 _STROM_IMG_OMITTED scope
2 _STROM_CLIP c3fa91b0d22
2 _STROM_CLIP c88e01aa7f4`, `1 OBJE
2 FILE ${PNG}
2 _STROM_CLIP c3fa91b0d22`);
        const data = convertToStrom(parseGedcom(next)).data as StromData;
        // Shown once even before the clean-up.
        const s1 = byRef(data.sources!, 'S0001');
        expect(shownExcerpts('t1', s1).map(e => e.clip)).toEqual(['c3fa91b0d22', 'c88e01aa7f4']);
        expect(await pruneDeliveredImages('t1', data)).toBe(1);
        expect(researchImagesTotal('t1').images).toBe(1);
    });

    it('remembers a missing scan and a gone source until the next research version', async () => {
        const s1 = byRef(sources(), 'S0001');
        const missing = bridge(() => ({ status: 200, body: { source: 'S0001', excerpts: [], missing: ['c3fa91b0d22'] } }));
        expect(await loadResearchImage('t1', BASE, 'h1', 'S0001', 'c3fa91b0d22', undefined, { fetchImpl: missing })).toBe('missingScan');
        expect(pendingClips('t1', s1, 'h1')).toEqual(['c88e01aa7f4']);
        const gone = bridge(() => ({ status: 404, body: { error: 'x', code: 'source.unknown' } }));
        expect(await loadResearchImage('t1', BASE, 'h1', 'S0001', 'c88e01aa7f4', undefined, { fetchImpl: gone })).toBe('revoked');
        expect(pendingClips('t1', s1, 'h1')).toEqual([]);
        // The research changed: worth asking again.
        expect(pendingClips('t1', s1, 'h2')).toEqual(['c3fa91b0d22', 'c88e01aa7f4']);
        // A missing-scan source has nothing to load at all.
        expect(pendingClips('t1', byRef(sources(), 'S0002'), 'h1')).toEqual([]);
    });

    it('a tree with neither held nor stored images has nothing to do with them', async () => {
        await primeResearchImages('t9');
        const plain = { persons: {}, partnerships: {}, sources: { a: { id: 'a', title: 'x' } } } as unknown as StromData;
        expect(hasResearchImages('t9', plain)).toBe(false);
        const held = { ...plain, sources: { a: { id: 'a', title: 'x', refn: 'S1', imageHeld: 'limit', heldClips: ['c1'] } } } as unknown as StromData;
        expect(hasResearchImages('t9', held)).toBe(true);
    });
});

describe('the bridge client', () => {
    it('asks again on 202 until the excerpt is made', async () => {
        let calls = 0;
        const fetchImpl = bridge(() => (++calls < 3 ? { status: 202, body: { later: true, made: 1, left: 1 } } : okExcerpt('c1')));
        const res = await fetchExcerpt(BASE, 'S0001', 'c1', undefined, { fetchImpl, retryDelayMs: 1 });
        expect(res.ok).toBe(true);
        expect(calls).toBe(3);
    });

    it('turns refusals into reasons', async () => {
        const answer = (status: number, body: unknown) => fetchExcerpt(BASE, 'S0001', 'c1', undefined, { fetchImpl: bridge(() => ({ status, body })) });
        expect(await answer(404, { code: 'source.unknown' })).toEqual({ ok: false, error: 'revoked' });
        expect(await answer(410, { code: 'source.retracted', movedTo: 'S0040' })).toEqual({ ok: false, error: { merged: 'S0040' } });
        expect(await answer(410, { code: 'source.retracted' })).toEqual({ ok: false, error: 'revoked' });
        expect(await answer(404, { code: 'excerpt.unknown' })).toEqual({ ok: false, error: 'failed' });
        expect(await answer(500, {})).toEqual({ ok: false, error: 'failed' });
        // A payload that is not a raster image is not taken.
        expect(await answer(200, { excerpts: [{ clip: 'c1', dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' }], missing: [] }))
            .toEqual({ ok: false, error: 'failed' });
    });

    it('gives up after the timeout', async () => {
        const fetchImpl = bridge(() => ({ status: 202, body: { later: true } }));
        expect(await fetchExcerpt(BASE, 'S0001', 'c1', undefined, { fetchImpl, timeoutMs: 30, retryDelayMs: 5 }))
            .toEqual({ ok: false, error: 'timeout' });
    });

    it('reads the list of what is only in the research', async () => {
        const fetchImpl = bridge(() => ({ status: 200, body: { head: 'h1', level: 'normal', count: 2, clips: 3, bytes: 300000, estimated: true,
            sources: [{ source: 'S0001', why: 'scope', clips: ['c1', 'c2'], bytes: 200000, ready: true }, { source: 'bad' },
                { source: 'S0003', why: 'limit', clips: ['input'], bytes: 100000, ready: false, estimated: true }] } }));
        const list = await fetchMissingList(BASE, undefined, fetchImpl);
        expect(list?.sources.map(s => s.source)).toEqual(['S0001', 'S0003']);
        expect(list?.bytes).toBe(300000);
        expect(list?.sources[0].ready).toBe(true);
        expect(await fetchMissingList(BASE, undefined, bridge(() => ({ status: 404, body: {} })))).toBeNull();
    });
});

describe('what a source shows', () => {
    const held = { id: 's', title: 'x', refn: 'S0001', imageHeld: 'scope', heldClips: ['c1'] } as Source;

    it('an older research (no excerpt.get) or none running behaves as before', () => {
        expect(heldImageMode({ onComputer: true, linked: true, bridgeUp: true, features: ['log'] })).toBe('older');
        expect(heldImageMode({ onComputer: true, linked: true, bridgeUp: true, features: null })).toBe('older');
        expect(heldImageMode({ onComputer: true, linked: true, bridgeUp: false })).toBe('bridgeOff');
        expect(heldImageMode({ onComputer: false, linked: true, bridgeUp: true, features: ['excerpt.get'] })).toBe('device');
        expect(heldImageMode({ onComputer: true, linked: true, bridgeUp: true, features: ['excerpt.get'] })).toBe('fetch');
    });

    it('names one state', () => {
        expect(sourceImageState(held, { pending: 1, shown: 0, stored: 0 }, 'fetch', false)).toBe('canLoad');
        expect(sourceImageState(held, { pending: 1, shown: 0, stored: 0 }, 'fetch', true)).toBe('loading');
        expect(sourceImageState(held, { pending: 1, shown: 1, stored: 0 }, 'fetch', false)).toBe('partial');
        expect(sourceImageState(held, { pending: 0, shown: 1, stored: 1 }, 'fetch', false)).toBe('loaded');
        expect(sourceImageState(held, { pending: 1, shown: 0, stored: 0 }, 'older', false)).toBe('older');
        expect(sourceImageState({ id: 'p', title: 'y' }, { pending: 0, shown: 0, stored: 0 }, 'fetch', false)).toBeNull();
    });

    it('sizes read the way the language writes them', () => {
        expect(formatImageBytes(3.1 * 1024 * 1024, 'cs')).toBe('3,1 MB');
        expect(formatImageBytes(3.1 * 1024 * 1024, 'en')).toBe('3.1 MB');
        expect(formatImageBytes(280 * 1024, 'de')).toBe('280 kB');
    });
});

describe('the bulk queue', () => {
    const stored = (ref: string, clip: string): StoredResearchImage => ({
        key: `t|${ref}|${clip}`, treeId: 't', sourceRef: ref, clip, loadedAt: 0,
        excerpt: { id: clip, dataUrl: PNG, width: 1, height: 1, sizeBytes: 100 },
    });

    it('loads ready sources first, counts failures by reason', async () => {
        const order: string[] = [];
        const q = new ResearchImageQueue([
            { sourceRef: 'S1', clips: ['a'] },
            { sourceRef: 'S2', clips: ['b', 'c'], ready: true },
            { sourceRef: 'S3', clips: ['d'] },
        ], async (ref, clip): Promise<StoredResearchImage | LoadError> => {
            order.push(`${ref}:${clip}`);
            return clip === 'd' ? 'missingScan' : stored(ref, clip);
        });
        const end = await q.start();
        expect(order).toEqual(['S2:b', 'S2:c', 'S1:a', 'S3:d']);
        expect(end).toMatchObject({ phase: 'done', done: 3, loaded: 2, total: 3, bytes: 300, failedSources: 1, failed: { missingScan: 1 } });
    });

    it('pauses, resumes and stops', async () => {
        let release: (() => void) | null = null;
        const q = new ResearchImageQueue([{ sourceRef: 'S1', clips: ['a'] }, { sourceRef: 'S2', clips: ['b'] }, { sourceRef: 'S3', clips: ['c'] }],
            (ref, clip, signal) => new Promise(resolve => {
                release = () => resolve(stored(ref, clip));
                signal.addEventListener('abort', () => resolve('failed'));
            }));
        void q.start();
        await Promise.resolve();
        q.pause();
        release!();
        await new Promise(r => setTimeout(r, 0));
        expect(q.snapshot).toMatchObject({ phase: 'paused', done: 1 });
        q.resume();
        await new Promise(r => setTimeout(r, 0));
        q.stop();
        const end = await q.finished;
        expect(end).toMatchObject({ phase: 'stopped', done: 1, loaded: 1 });
    });

    it('ends when the research stops running, keeping the source for later', async () => {
        let up = true;
        const q = new ResearchImageQueue([{ sourceRef: 'S1', clips: ['a'] }, { sourceRef: 'S2', clips: ['b'] }],
            async (ref, clip) => {
                if (ref === 'S2') { up = false; return 'failed'; }
                return stored(ref, clip);
            }, () => up);
        const end = await q.start();
        expect(end).toMatchObject({ phase: 'bridgeOff', done: 1, loaded: 1, failedSources: 0 });
    });
});
