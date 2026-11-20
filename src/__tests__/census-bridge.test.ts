/**
 * Census records as a source (spec 106, U6 part A): `/status.census` read only
 * from a research with the feature `census`, `POST /census {on}` and every
 * reply of the contract (§2.2), the task kind `census` in the queue's counts
 * and in `GET /queue` (`kind=census`, `known=census` only with the feature),
 * the texts in four languages and a household in the research's file read as
 * one shared event (§2.3). Invented data.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    CENSUS_FEATURE, DISK_FULL_FEATURE, NOT_DOWNLOADED_FEATURE, SEAL_FOREIGN_FEATURE, sanitizeCensus, sanitizeLiveStatus, sanitizeQueueCounts,
} from '../research-link.js';
import { censusReply, postBridgeCensus } from '../history-bridge.js';
import { fetchQueuePage, noteQueueRev, queuePageQuery, requestQueueList, resetQueueLists } from '../research-queue-pages.js';
import { getStringsForLang } from '../strings.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { findDivergentShares } from '../shared-events.js';

const BASE = 'http://127.0.0.1:7777/abc123';
const HEAD = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const PARENT = '0f1e2d3c4b5a69788796a5b4c3d2e1f001234567';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('/status.census (spec 106 §2.1)', () => {
    const status = (features: string[], census?: unknown) =>
        sanitizeLiveStatus({ tree: { id: 'R1' }, features, ...(census !== undefined ? { census } : {}) })!;

    it('is read with the feature: on and the tasks set aside', () => {
        expect(status([CENSUS_FEATURE], { on: false, held: 3 }).census).toEqual({ on: false, held: 3 });
        expect(status([CENSUS_FEATURE], { on: true, held: 0 }).census).toEqual({ on: true, held: 0 });
    });

    it('is never read without the feature', () => {
        expect(status([], { on: true, held: 0 }).census).toBeUndefined();
        expect('census' in status(['stories.history'], { on: false, held: 2 })).toBe(false);
    });

    it('a held that is not a whole count is not known; the row then says nothing of tasks set aside', () => {
        for (const held of [-1, 2.5, '3', null, undefined, Number.NaN, Infinity]) {
            expect(status([CENSUS_FEATURE], { on: false, held }).census).toEqual({ on: false, held: null });
        }
    });

    it('a missing or broken key with the feature is not known (null)', () => {
        expect(status([CENSUS_FEATURE]).census).toBeNull();
        expect(status([CENSUS_FEATURE], 'on').census).toBeNull();
        expect(status([CENSUS_FEATURE], { on: 'yes', held: 0 }).census).toBeNull();
        expect(status([CENSUS_FEATURE], { held: 0 }).census).toBeNull();
        expect(status([CENSUS_FEATURE], [true, 0]).census).toBeNull();
        expect(sanitizeCensus(null)).toBeNull();
    });
});

describe('POST /census (spec 106 §2.2)', () => {
    const all = [CENSUS_FEATURE, SEAL_FOREIGN_FEATURE, NOT_DOWNLOADED_FEATURE, DISK_FULL_FEATURE];

    it('200: the state kept now and its commit (sanitized)', () => {
        expect(censusReply(200, { census: { on: true, held: 0 }, head: HEAD, parent: PARENT }, all))
            .toEqual({ ok: true, census: { on: true, held: 0 }, head: HEAD, parent: PARENT });
        // The same value as before: no commit, head = parent.
        expect(censusReply(200, { census: { on: false, held: 4 }, head: HEAD, parent: HEAD }, all))
            .toEqual({ ok: true, census: { on: false, held: 4 }, head: HEAD, parent: HEAD });
        expect(censusReply(200, { census: { on: false, held: 1.5 }, head: 'nope' }, all))
            .toEqual({ ok: true, census: { on: false, held: null }, head: '', parent: '' });
        expect(censusReply(200, null, all)).toEqual({ ok: true, census: null, head: '', parent: '' });
    });

    it('every refusal of the contract', () => {
        const r = (status: number, code: string, features: string[] = all, extra: object = {}) =>
            censusReply(status, { error: 'Said by the research.', code, params: {}, ...extra }, features);
        expect(r(400, 'census.body')).toMatchObject({ ok: false, code: 'invalid', status: 400, bridgeCode: 'census.body' });
        expect(r(409, 'census.archive')).toMatchObject({ ok: false, code: 'archive', reason: 'Said by the research.' });
        expect(r(409, 'seal.foreign')).toMatchObject({ ok: false, code: 'held', held: { kind: 'seal', said: 'Said by the research.' } });
        expect(r(409, 'tree.not-downloaded', all, { params: { n: 3 } })).toMatchObject({ ok: false, code: 'held', held: { kind: 'cloud', n: 3 } });
        expect(r(507, 'disk.full')).toMatchObject({ ok: false, code: 'held', held: { kind: 'disk' } });
        expect(r(423, 'locked')).toMatchObject({ ok: false, code: 'locked', status: 423 });
        expect(r(503, 'research.busy')).toMatchObject({ ok: false, code: 'busy' });
        expect(r(500, 'census.failed', all, { reasonCode: 'git' })).toMatchObject({ ok: false, code: 'unknown', reason: 'Said by the research.', bridgeCode: 'census.failed' });
        expect(censusReply(500, { code: 'census.failed' }, all)).toMatchObject({ ok: false, code: 'unknown', reason: '' });
    });

    it('without the feature of a held write: an ordinary refusal; a full disk is full', () => {
        expect(censusReply(409, { code: 'seal.foreign', error: 'x' }, [CENSUS_FEATURE])).toMatchObject({ ok: false, code: 'unknown' });
        expect(censusReply(409, { code: 'tree.not-downloaded' }, [CENSUS_FEATURE])).toMatchObject({ ok: false, code: 'unknown' });
        expect(censusReply(507, { code: 'disk.full' }, [CENSUS_FEATURE])).toMatchObject({ ok: false, code: 'full' });
        expect(censusReply(507, { code: 'disk.full' }, null)).toMatchObject({ ok: false, code: 'full' });
    });

    it('the write: its path and exactly {"on": bool}; no answer is the network', async () => {
        const f = vi.fn(async () => new Response(JSON.stringify({ census: { on: true, held: 0 }, head: HEAD, parent: PARENT }), { status: 200 }));
        vi.stubGlobal('fetch', f);
        expect(await postBridgeCensus(BASE, true, all)).toEqual({ ok: true, census: { on: true, held: 0 }, head: HEAD, parent: PARENT });
        const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
        expect(url.split('?')[0]).toBe(`${BASE}/census`);
        expect(init.method).toBe('POST');
        expect(String(init.body)).toBe('{"on":true}');
        await postBridgeCensus(BASE, false, all);
        expect(String((f.mock.calls[1] as unknown as [string, RequestInit])[1].body)).toBe('{"on":false}');
        vi.unstubAllGlobals();
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('down'); }));
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(await postBridgeCensus(BASE, true, all)).toEqual({ ok: false, code: 'network', status: 0, reason: '', bridgeCode: '' });
    });
});

describe('the task kind census (spec 106 §2.4)', () => {
    const census = ['queue.page', 'queue.kind', CENSUS_FEATURE];
    const older = ['queue.page', 'queue.kind'];

    it('kind=census only to a research with the feature', () => {
        expect(queuePageQuery({ kind: 'census' }, 0, 50, census).toString()).toBe('count=50&kind=census');
        expect(queuePageQuery({ kind: 'census' }, 0, 50, older).has('kind')).toBe(false);
        expect(queuePageQuery({ kind: 'census' }, 0, 50).has('kind')).toBe(false);
        expect(queuePageQuery({ kind: 'census' }, 0, 50, null).has('kind')).toBe(false);
    });

    it('kind=other carries known=census only with the feature; other kinds never', () => {
        expect(queuePageQuery({ kind: 'other', research: 'G0001' }, 0, 50, census).toString()).toBe('count=50&research=G0001&kind=other&known=census');
        expect(queuePageQuery({ kind: 'other' }, 0, 50, older).toString()).toBe('count=50&kind=other');
        expect(queuePageQuery({ kind: 'other' }, 0, 50).has('known')).toBe(false);
        expect(queuePageQuery({ kind: 'verify' }, 0, 50, census).toString()).toBe('count=50&kind=verify');
        expect(queuePageQuery({ research: 'G0001' }, 0, 50, census).has('known')).toBe(false);
    });

    it('a page of the queue asks with the research\'s features', async () => {
        const asked: string[] = [];
        vi.stubGlobal('fetch', async (url: string) => {
            asked.push(url);
            return new Response(JSON.stringify({ items: [{ id: 'T0501', text: 'Sčítání 1890, čp. 14', state: 'next', pos: 1, taskKind: 'census' }],
                total: 1, from: 0, rev: 'a1b2c3d4e5f60718' }), { status: 200 });
        });
        const r = await fetchQueuePage(BASE, { kind: 'census' }, 0, 50, undefined, census);
        expect(new URL(asked[0]).searchParams.get('kind')).toBe('census');
        expect(r.ok && r.items[0].taskKind).toBe('census');
        await fetchQueuePage(BASE, { kind: 'other' }, 0, 50, undefined, census);
        expect(new URL(asked[1]).searchParams.get('known')).toBe('census');
        await fetchQueuePage(BASE, { kind: 'other' }, 0, 50);
        expect(new URL(asked[2]).searchParams.has('known')).toBe(false);
    });

    it('the lists of the panel ask with the features of the latest status', async () => {
        const asked: string[] = [];
        vi.stubGlobal('fetch', async (url: string) => {
            asked.push(url);
            return new Response(JSON.stringify({ items: [], total: 0, from: 0, rev: 'a1b2c3d4e5f60718' }), { status: 200 });
        });
        try {
            noteQueueRev(BASE, 'a1b2c3d4e5f60718', census);
            requestQueueList(BASE, { kind: 'other' }, 'queue');
            noteQueueRev(BASE, 'a1b2c3d4e5f60718', older);
            requestQueueList(BASE, { kind: 'census' }, 'search');
            requestQueueList(BASE, { kind: 'other', research: 'G0001' }, 'branch');
            await vi.waitFor(() => expect(asked).toHaveLength(3));
            const query = (u: string) => { const q = new URL(u).searchParams; q.delete('app'); return q.toString(); };
            expect(asked.map(query)).toEqual([
                'count=50&kind=other&known=census', 'count=50', 'count=50&research=G0001&kind=other',
            ]);
        } finally {
            resetQueueLists();
        }
    });

    it('the counts: census on its own, another unknown kind under other', () => {
        const c = sanitizeQueueCounts({
            research: {}, branch: {}, next: 30, parked: 0, rev: 'a1b2c3d4e5f60718',
            kind: { records: 20, census: 6, letters: 3, other: 1 },
        })!;
        expect(c.kind).toEqual({ records: 20, census: 6, other: 4 });
    });

    it('its name in four languages', () => {
        expect(['en', 'cs', 'de', 'pl'].map(l => getStringsForLang(l as never).live.taskKinds.census))
            .toEqual(['Census', 'Sčítání lidu', 'Volkszählung', 'Spis ludności']);
    });
});

describe('the census texts (spec 106 §4.2)', () => {
    it('tasks set aside, with each language\'s plural forms', () => {
        const held = (l: string, n: number) => getStringsForLang(l as never).history.censusHeld(n);
        expect(held('en', 1)).toBe('Set aside: 1 census task. It comes back when this is switched on.');
        expect(held('en', 3)).toBe('Set aside: 3 census tasks. They come back when this is switched on.');
        expect([1, 3, 5].map(n => held('cs', n))).toEqual([
            'Odloženo: 1 úkol sčítání. Po zapnutí se vrátí.',
            'Odloženo: 3 úkoly sčítání. Po zapnutí se vrátí.',
            'Odloženo: 5 úkolů sčítání. Po zapnutí se vrátí.',
        ]);
        expect(held('de', 1)).toBe('Zurückgestellt: 1 Volkszählungsaufgabe. Beim Einschalten kommen diese zurück.');
        expect(held('de', 3)).toBe('Zurückgestellt: 3 Volkszählungsaufgaben. Beim Einschalten kommen diese zurück.');
        expect([1, 3, 5].map(n => held('pl', n))).toEqual([
            'Odłożone: 1 zadanie spisu. Wróci po włączeniu.',
            'Odłożone: 3 zadania spisu. Wrócą po włączeniu.',
            'Odłożone: 5 zadań spisu. Wrócą po włączeniu.',
        ]);
    });

    it('the row\'s group, name and sentence in every language', () => {
        for (const l of ['en', 'cs', 'de', 'pl']) {
            const h = getStringsForLang(l as never).history;
            expect(h.censusSection).toBeTruthy();
            expect(h.censusTitle).toBeTruthy();
            expect(h.censusDesc.length).toBeGreaterThan(80);
        }
    });
});

describe('a household from the research\'s file (spec 106 §2.3)', () => {
    // The shape the research writes (§2.3): one copy per member in the tree, the same date, place, house,
    // note and citation, the age and the role each copy's own; no TYPE and no value on the CENS line.
    const GED = `0 HEAD
1 SOUR STROM_RESEARCH
1 CHAR UTF-8
0 @S12@ SOUR
1 TITL Sčítání lidu 1890, Dolní Lhotka
0 @I3@ INDI
1 NAME Hvozdimír /Ostrozub/
1 SEX M
1 FAMS @F1@
1 CENS
2 DATE 31 DEC 1890
2 PLAC Dolní Lhotka, Medvezin
2 ADDR čp. 14
2 AGE 41y
2 NOTE V domácnosti dále: čeledín, 19 let, rodiště okres Nové Hrady; výměnkářka, 72 let.
2 _STROM_SHARE k7Qm2Rx9
3 _ROLE hlava domácnosti
2 SOUR @S12@
3 PAGE arch 3, ř. 1–6
0 @I8@ INDI
1 NAME Zbyhněva /Ostrozubová/
1 SEX F
1 FAMS @F1@
1 CENS
2 DATE 31 DEC 1890
2 PLAC Dolní Lhotka, Medvezin
2 ADDR čp. 14
2 AGE 36y
2 NOTE V domácnosti dále: čeledín, 19 let, rodiště okres Nové Hrady; výměnkářka, 72 let.
2 _STROM_SHARE k7Qm2Rx9
3 _ROLE manželka
2 SOUR @S12@
3 PAGE arch 3, ř. 1–6
0 @F1@ FAM
1 HUSB @I3@
1 WIFE @I8@
1 MARR
2 DATE 1878
0 TRLR
`;

    const household = () => {
        const data = convertToStrom(parseGedcom(GED)).data;
        const byName = (first: string) => Object.values(data.persons).find(p => p.firstName === first)!;
        const census = (first: string) => byName(first).events!.filter(e => e.type === 'census');
        return { data, head: census('Hvozdimír'), wife: census('Zbyhněva') };
    };

    it('both copies carry the same share; the role and the age are each copy\'s own', () => {
        const { head, wife } = household();
        expect(head).toHaveLength(1);
        expect(wife).toHaveLength(1);
        expect(head[0].shareId).toBe('k7Qm2Rx9');
        expect(wife[0].shareId).toBe('k7Qm2Rx9');
        expect(head[0].shareRole).toBe('hlava domácnosti');
        expect(wife[0].shareRole).toBe('manželka');
        expect(parseInt(head[0].age ?? '')).toBe(41);
        expect(parseInt(wife[0].age ?? '')).toBe(36);
    });

    it('the date, place, house, note and citation are the same on both copies; the note starts with no type', () => {
        const { data, head, wife } = household();
        const [h, w] = [head[0], wife[0]];
        expect(h.date).toBe('1890-12-31');
        expect(w.date).toBe(h.date);
        expect(h.place).toBeTruthy();
        expect(w.place).toBe(h.place);
        expect(h.address).toBe('čp. 14');
        expect(w.address).toBe(h.address);
        expect(h.note).toBe('V domácnosti dále: čeledín, 19 let, rodiště okres Nové Hrady; výměnkářka, 72 let.');
        expect(w.note).toBe(h.note);
        expect(h.sourceIds).toHaveLength(1);
        expect(w.sourceIds).toEqual(h.sourceIds);
        // The cited page is the one citation of both copies.
        expect(data.sources?.[h.sourceIds![0]]?.reference).toBe('arch 3, ř. 1–6');
    });

    it('gives no finding of copies that differ', () => {
        expect(findDivergentShares(household().data)).toEqual([]);
    });
});
