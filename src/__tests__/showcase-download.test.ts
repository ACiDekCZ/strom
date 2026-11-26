/**
 * Downloading the showcase (spec 143 §2, §3): the `?demo=` value, its
 * progress (MB, percent), why it did not come (offline, the server, no room,
 * a broken file, a newer format), its version on the web and the update
 * offered only when newer. The network is a fake; all data is invented (the
 * Horák family from Dolní Lhota, the test fixture).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    downloadShowcase, fetchShowcaseVersion, fileLooksLikeShowcase, formatShowcaseMb, isQuotaError, newerShowcaseVersion, readShowcaseText,
    readShowcaseValue, showcaseFetchFailure, showcaseWebFileUrl, showcaseFileUrl, showcaseLangParam, showcasePercent, showcaseRoomShort, showcaseSizeFromPrefix,
    type ShowcaseDownloadDeps,
} from '../showcase-download.js';
import { keepShowcaseSettings, showcaseErrorText, showcaseLangOfUi, showcaseProgressStep, showcaseTreeData, showcaseTryDesc } from '../ui/showcase-open-ui.js';
import { setLanguage } from '../strings.js';
import type { PersonId, StromData, TreeSampleMark } from '../types.js';

const FIXTURE = readFileSync(join(__dirname, '../../e2e/fixtures/showcase/strom-ukazka-cs.json'), 'utf-8');

/** An answer whose body comes in `parts` chunks (a stream, as from the network). */
function streamed(text: string, opts: { status?: number; length?: boolean; parts?: number; failAt?: number } = {}): Response {
    const bytes = new TextEncoder().encode(text);
    const parts = opts.parts ?? 4;
    const size = Math.ceil(bytes.length / parts);
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
        pull(ctl) {
            if (opts.failAt !== undefined && i === opts.failAt) { ctl.error(new TypeError('network')); return; }
            if (i * size >= bytes.length) { ctl.close(); return; }
            ctl.enqueue(bytes.subarray(i * size, (i + 1) * size));
            i++;
        },
    });
    const headers = new Headers(opts.length === false ? {} : { 'content-length': String(bytes.length) });
    return new Response(body, { status: opts.status ?? 200, headers });
}

function deps(answer: (url: string, init: RequestInit) => Promise<Response>, more: Partial<ShowcaseDownloadDeps> = {}): ShowcaseDownloadDeps {
    return { fetch: answer, online: () => true, estimate: async () => null, ...more };
}

const signal = (): AbortSignal => new AbortController().signal;

afterEach(() => setLanguage('en'));

describe('?demo= value', () => {
    it('opens only the four languages, any case', () => {
        expect(showcaseLangParam('cs')).toBe('cs');
        expect(showcaseLangParam(' PL ')).toBe('pl');
        expect(showcaseLangParam('sk')).toBeNull();
        expect(showcaseLangParam('')).toBeNull();
        expect(showcaseLangParam(null)).toBeNull();
        expect(showcaseFileUrl('de')).toBe('/demo/de/strom-ukazka-de.json');
    });
});

describe('progress', () => {
    it('says MB in the language and the share done', () => {
        expect(formatShowcaseMb(2.4 * 1024 * 1024, 'cs')).toBe('2,4');
        expect(formatShowcaseMb(2.4 * 1024 * 1024, 'en')).toBe('2.4');
        expect(showcasePercent({ done: 34, total: 100 })).toBe(34);
        expect(showcasePercent({ done: 5, total: null })).toBeNull();
        expect(showcasePercent({ done: 120, total: 100 })).toBe(100);
    });

    it('the toast step: "of" with the percent, or just the MB when the whole is unknown', () => {
        setLanguage('en');
        const mb = 1024 * 1024;
        const known = showcaseProgressStep({ done: 2.4 * mb, total: 7.1 * mb }, 'en');
        expect(known.percent).toBe(33);
        expect(known.step).toContain('2.4');
        expect(known.step).toContain('7.1');
        expect(showcaseProgressStep({ done: mb, total: null }, 'en')).toEqual({ step: '1.0 MB', percent: null });
    });

    it('reads the size from the header in the first bytes', () => {
        expect(showcaseSizeFromPrefix('{"kind":"strom-showcase","sizeBytes": 7340032,')).toBe(7340032);
        expect(showcaseSizeFromPrefix('{"kind":"strom-showcase"')).toBeNull();
    });
});

describe('why it did not come', () => {
    it('tells offline, the server, a cancel and no room apart', () => {
        const abort = new DOMException('stop', 'AbortError');
        expect(showcaseFetchFailure(abort, true)).toBe('cancelled');
        expect(showcaseFetchFailure(new TypeError('Failed to fetch'), true)).toBe('offline');
        expect(showcaseFetchFailure(new Error('x'), false)).toBe('offline');
        expect(showcaseFetchFailure(new Error('x'), true)).toBe('server');
        expect(isQuotaError(new DOMException('full', 'QuotaExceededError'))).toBe(true);
        expect(isQuotaError(new Error('other'))).toBe(false);
        expect(showcaseRoomShort({ quota: 100, usage: 90 }, 6)).toBe(true);
        expect(showcaseRoomShort({ quota: 100, usage: 80 }, 6)).toBe(false);
        expect(showcaseRoomShort(null, 6)).toBe(false);
    });

    it('a broken file, another file and a newer format', () => {
        expect(readShowcaseText('{"kind":')).toEqual({ ok: false, kind: 'broken' });
        expect(readShowcaseText('{"persons":{}}')).toEqual({ ok: false, kind: 'broken' });
        const newer = JSON.parse(FIXTURE) as Record<string, unknown>;
        newer.format = 99;
        expect(readShowcaseText(JSON.stringify(newer))).toEqual({ ok: false, kind: 'newerFormat' });
        expect(readShowcaseText(FIXTURE).ok).toBe(true);
    });

    it('each kind has its dialog text', () => {
        setLanguage('en');
        expect(showcaseErrorText({ kind: 'server', status: 503 }).message).toContain('503');
        expect(showcaseErrorText({ kind: 'space', bytes: 3 * 1024 * 1024 }).message).toContain('6');
        for (const kind of ['offline', 'server', 'space', 'broken', 'newerFormat'] as const) {
            const t = showcaseErrorText({ kind });
            expect(t.title.length).toBeGreaterThan(0);
            expect(t.message.length).toBeGreaterThan(0);
        }
    });
});

describe('downloadShowcase', () => {
    it('reads the file as it comes, its progress to the whole', async () => {
        const seen: Array<number | null> = [];
        const got = await downloadShowcase('/demo/cs/strom-ukazka-cs.json', {
            signal: signal(), onProgress: (p) => seen.push(showcasePercent(p)),
            deps: deps(async () => streamed(FIXTURE)),
        });
        expect(got.ok).toBe(true);
        if (got.ok) expect(got.file.header.exportId).toBe('showcase-cs');
        expect(seen[0]).toBe(0);
        expect(seen[seen.length - 1]).toBe(100);
    });

    it('the server\'s error, offline, a break in the middle', async () => {
        expect(await downloadShowcase('/x', { signal: signal(), deps: deps(async () => streamed('', { status: 503 })) }))
            .toEqual({ ok: false, kind: 'server', status: 503 });
        expect(await downloadShowcase('/x', { signal: signal(), deps: deps(async () => { throw new TypeError('Failed to fetch'); }) }))
            .toEqual({ ok: false, kind: 'offline' });
        expect(await downloadShowcase('/x', { signal: signal(), deps: deps(async () => streamed(FIXTURE), { online: () => false }) }))
            .toEqual({ ok: false, kind: 'offline' });
        expect(await downloadShowcase('/x', { signal: signal(), deps: deps(async () => streamed(FIXTURE, { failAt: 2 })) }))
            .toEqual({ ok: false, kind: 'server' });
    });

    it('stops when cancelled', async () => {
        const ac = new AbortController();
        const got = await downloadShowcase('/x', {
            signal: ac.signal,
            onProgress: () => ac.abort(),
            deps: deps(async (_u, init) => {
                const res = streamed(FIXTURE, { parts: 8 });
                init.signal?.addEventListener('abort', () => undefined);
                return res;
            }),
        });
        expect(got).toEqual({ ok: false, kind: 'cancelled' });
    });

    it('no room for twice its size: stopped at once (Content-Length, else the header)', async () => {
        const tight = { estimate: async () => ({ quota: 3000, usage: 0 }) };
        expect(await downloadShowcase('/x', { signal: signal(), deps: deps(async () => streamed(FIXTURE), tight) }))
            .toMatchObject({ ok: false, kind: 'space' });
        expect(await downloadShowcase('/x', { signal: signal(), deps: deps(async () => streamed(FIXTURE, { length: false }), tight) }))
            .toEqual({ ok: false, kind: 'space', bytes: 2033 });
    });

    it('not UTF-8 or not JSON: broken', async () => {
        const bad = new Response(new Uint8Array([0x7b, 0xff, 0xfe]), { status: 200 });
        expect(await downloadShowcase('/x', { signal: signal(), deps: deps(async () => bad) })).toEqual({ ok: false, kind: 'broken' });
    });
});

describe('version on the web', () => {
    const mark: TreeSampleMark = { exportId: 'showcase-cs', lang: 'cs', sampleVersion: '3.33.0', asOf: '2026-11-01T09:00:00.000Z' };

    it('reads VERSION; any failure is silence', async () => {
        expect(await fetchShowcaseVersion('cs', deps(async () => new Response('3.34.0\n')))).toBe('3.34.0');
        expect(await fetchShowcaseVersion('cs', deps(async () => new Response('<html>', { status: 200 })))).toBeNull();
        expect(await fetchShowcaseVersion('cs', deps(async () => new Response('', { status: 404 })))).toBeNull();
        expect(await fetchShowcaseVersion('cs', deps(async () => { throw new TypeError('offline'); }))).toBeNull();
    });

    it('an update is offered only for a newer version', () => {
        expect(newerShowcaseVersion(mark, '3.34.0')).toBe('3.34.0');
        expect(newerShowcaseVersion(mark, '3.33.0')).toBeNull();
        expect(newerShowcaseVersion(mark, '3.33.0-beta.2')).toBeNull();
        expect(newerShowcaseVersion(mark, null)).toBeNull();
        expect(newerShowcaseVersion(undefined, '9.0.0')).toBeNull();
    });
});

describe('the showcase tree', () => {
    it('is the research GEDCOM read as a research file, with its research id', () => {
        const read = readShowcaseText(FIXTURE);
        if (!read.ok) throw new Error('fixture');
        const { data, research } = showcaseTreeData(read.file);
        expect(research.treeId).toBe('943fce29-c1c6-5433-8031-96ce4bbbcd8d');
        const names = Object.values(data.persons).map(p => p.lastName);
        expect(names).toContain('Horáková');
        expect(names.length).toBeGreaterThanOrEqual(5);
    });

    it('an update keeps the tree\'s own settings while they still fit', () => {
        const anna = 'p_anna' as PersonId;
        const next = { persons: { [anna]: {} }, partnerships: {} } as unknown as StromData;
        const prev = {
            persons: {}, partnerships: {}, defaultPersonId: anna, defaultView: 'last',
            lastFocusPersonId: 'p_gone' as PersonId, tableViews: [{ id: 'v' }],
        } as unknown as StromData;
        const kept = keepShowcaseSettings(next, prev);
        expect(kept.defaultPersonId).toBe(anna);
        expect(kept.defaultView).toBe('last');
        expect(kept.tableViews).toHaveLength(1);
        expect(kept.lastFocusPersonId).toBeUndefined();
        expect(keepShowcaseSettings(next, { ...prev, defaultPersonId: 'p_gone' as PersonId }).defaultPersonId).toBeUndefined();
    });
});

describe('a showcase file opened or dropped (§4)', () => {
    it('its first bytes say it, before the whole file is read', async () => {
        expect(await fileLooksLikeShowcase(new Blob([FIXTURE]))).toBe(true);
        expect(await fileLooksLikeShowcase(new Blob(['\ufeff' + FIXTURE]))).toBe(true);
        expect(await fileLooksLikeShowcase(new Blob([JSON.stringify({ persons: {}, partnerships: {} })]))).toBe(false);
        // The header later in the file: told only once read whole (the JSON import's check).
        expect(await fileLooksLikeShowcase(new Blob([JSON.stringify({ tree: null, kind: 'strom-showcase' })]))).toBe(false);
    });

    it('read as parsed JSON the same as from its text', () => {
        const fromText = readShowcaseText(FIXTURE);
        const fromValue = readShowcaseValue(JSON.parse(FIXTURE));
        expect(fromValue.ok).toBe(true);
        expect(fromValue).toEqual(fromText);
        expect(readShowcaseValue({ kind: 'strom-showcase', format: 2 })).toEqual({ ok: false, kind: 'newerFormat' });
        expect(readShowcaseValue({ kind: 'strom-showcase', format: 1 })).toEqual({ ok: false, kind: 'broken' });
    });

    it('a standalone file links to the file on the web and says it does not download it', () => {
        expect(showcaseWebFileUrl('de')).toBe('https://stromapp.info/demo/de/strom-ukazka-de.json');
        setLanguage('cs');
        expect(showcaseLangOfUi()).toBe('cs');
        expect(showcaseTryDesc(false)).toMatch(/^Vymyšlená rodina s výzkumem jen k prohlížení · stáhne se \d+,\d MB$/);
        expect(showcaseTryDesc(true)).toContain('(.json)');
        setLanguage('en');
        expect(showcaseTryDesc(false)).toMatch(/· \d+\.\d MB download$/);
    });
});
