/**
 * The readings of a research (`GET reads`) and a source's reading marks on
 * their way through a research update (tree.ged → stabilizeIds →
 * carryOverMedia) and a merge.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sanitizeReadHistory, fetchReads } from '../research-read.js';
import { stabilizeIds, carryOverMedia } from '../research-link.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { createMergeState } from '../merge/matching.js';
import { executeMerge } from '../merge/executor.js';
import { StorageManager } from '../storage.js';
import { StromData, Source, STROM_DATA_VERSION } from '../types.js';

const READ = 'D20261019153012-a1b2';
const READ2 = 'D20261020091500-c3d4';
const SHA = 'b'.repeat(64);

beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never);
});

describe('GET reads: the history', () => {
    const item = (o: Record<string, unknown>) => ({ id: READ, state: 'done', version: 1, at: '2026-10-19T15:30:12Z', since: '2026-10-19T15:34:00Z', files: 1, pages: 1, readers: 1, done: 1, entries: 2, name: 'krest.jpg', person: 'P0001', from: 'app', ...o });

    it('newest first, inSource only when true, duplicates and junk left out', () => {
        const list = sanitizeReadHistory({ reads: [
            item({ inSource: true }),
            item({ id: READ2, at: '2026-10-20T09:15:00Z', inSource: 'yes', from: 'research' }),
            item({ inSource: false }),
            { id: 'nope', state: 'done' },
            item({ id: 'D20261018100000-0000', state: 'weird' }),
            'x', null,
        ] })!;
        expect(list.map(r => r.id)).toEqual([READ2, READ]);
        expect(list[0]).toMatchObject({ inSource: false, from: 'research' });
        expect(list[1]).toMatchObject({ inSource: true, entries: 2, person: 'P0001', name: 'krest.jpg' });
    });

    it('a bad person reference and a long name are cleaned', () => {
        const [r] = sanitizeReadHistory({ reads: [item({ person: '<b>', name: 'x'.repeat(500) })] })!;
        expect(r.person).toBe('');
        expect(r.name.length).toBeLessThanOrEqual(200);
    });

    it('not a history: null', () => {
        expect(sanitizeReadHistory(null)).toBeNull();
        expect(sanitizeReadHistory({ reads: 'x' })).toBeNull();
        expect(sanitizeReadHistory({})).toBeNull();
        expect(sanitizeReadHistory({ reads: [] })).toEqual([]);
    });

    it('capped at 200', () => {
        const many = Array.from({ length: 300 }, (_, i) => item({ id: `D20261019${String(100000 + i).padStart(6, '0')}-0000` }));
        expect(sanitizeReadHistory({ reads: many })!.length).toBe(200);
    });

    it('an older research without the history (404, no code) is down; an archive is none', async () => {
        const reply = (status: number, body: unknown) => vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
            new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        reply(404, {});
        const older = await fetchReads('http://127.0.0.1:1/t');
        expect(older.ok ? null : older.failure.kind).toBe('down');
        reply(404, { error: 'No readings here', code: 'read.none' });
        const archive = await fetchReads('http://127.0.0.1:1/t');
        expect(archive.ok ? null : archive.failure.kind).toBe('none');
        reply(200, { reads: [item({ inSource: true })] });
        const ok = await fetchReads('http://127.0.0.1:1/t');
        expect(ok.ok && ok.value.map(r => r.inSource)).toEqual([true]);
    });
});

// ---------- a source's reading marks through a research update ----------

const GED = (source: string[]) => [
    '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
    '0 @I1@ INDI', '1 NAME Jan /Novák/', '1 SEX M', '1 REFN P0001', '1 SOUR @S1@',
    '0 @S1@ SOUR', '1 TITL Křest, Lhota 1846', '1 REFN S0001', '1 TEXT Joannes filius legitimus', ...source,
    '0 TRLR',
].join('\n');

const load = (ged: string): StromData => convertToStrom(parseGedcom(ged)).data;
const onlySource = (d: StromData): Source => Object.values(d.sources ?? {})[0];
/** What the app does with a research version (applyResearch). */
const update = (ged: string, previous: StromData): StromData => carryOverMedia(stabilizeIds(load(ged), previous), previous).data;

describe('a research update keeps the reading of a source', () => {
    const marks = ['1 _STROM_READING ' + READ, '2 _STROM_ENTRY e2', '1 _STROM_SHA ' + SHA];

    it('the research sends the marks: kept as sent', () => {
        const first = load(GED(marks));
        expect(onlySource(first)).toMatchObject({ reading: READ, readingEntry: 'e2', readingSha: SHA });
        const next = update(GED(marks), first);
        expect(onlySource(next)).toMatchObject({ reading: READ, readingEntry: 'e2', readingSha: SHA });
    });

    it('a research version without the marks: the app keeps them on the same source', () => {
        const first = load(GED(marks));
        const next = update(GED([]), first);
        expect(Object.keys(next.sources ?? {})).toEqual(Object.keys(first.sources ?? {}));
        expect(onlySource(next)).toMatchObject({ reading: READ, readingEntry: 'e2', readingSha: SHA });
    });

    it('the research names another reading: the research\'s wins', () => {
        const first = load(GED(marks));
        const next = update(GED(['1 _STROM_READING ' + READ2, '2 _STROM_ENTRY e1']), first);
        expect(onlySource(next)).toMatchObject({ reading: READ2, readingEntry: 'e1' });
        expect(onlySource(next).readingSha).toBeUndefined();
    });
});

describe('a merge keeps the reading of a source', () => {
    it('the same source (refn) without the marks gains them from the incoming one', async () => {
        const existing: StromData = { version: STROM_DATA_VERSION, persons: {}, partnerships: {},
            sources: { s1: { id: 's1', title: 'Křest, Lhota 1846', refn: 'S0001' } } } as unknown as StromData;
        const incoming: StromData = { version: STROM_DATA_VERSION, persons: {}, partnerships: {},
            sources: { t1: { id: 't1', title: 'Křest, Lhota 1846', refn: 'S0001', reading: READ, readingEntry: 'e2', readingSha: SHA } } } as unknown as StromData;
        const { mergedData } = await executeMerge(createMergeState(existing, incoming));
        const sources = Object.values(mergedData.sources ?? {});
        expect(sources).toHaveLength(1);
        expect(sources[0]).toMatchObject({ id: 's1', reading: READ, readingEntry: 'e2', readingSha: SHA });
    });
});
