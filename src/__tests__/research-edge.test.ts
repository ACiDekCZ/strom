/**
 * The research edge (GEDCOM _STROM_EDGE / _STROM_ISLAND from Strom Research):
 * how it is read, and how the three axes turn into a drawing and words.
 * Invented data only (the example of the research's assignment).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { edgeMoves, edgeView, edgeShape, edgeTone, effectiveNext, edgeEndText, edgeNextText, edgeFactsLine, edgeEstimateText, edgeTimeline } from '../research-edge.js';
import { getStringsForLang, setLanguage } from '../strings.js';
import { applyContentOptions } from '../privacy.js';
import { ResearchEdge, StromData } from '../types.js';

const head = (research: boolean): string => `0 HEAD
1 CHAR UTF-8
${research ? '1 SOUR STROM_RESEARCH\n1 _STROM_TREE 0b4c7a52-1c1f-4d7e-9a53-2f4a3c1e8b10\n1 _STROM_ASOF 2026-09-30\n' : ''}`;

const BODY = `0 @I4@ INDI
1 NAME Václav /Novák/
1 SEX M
1 REFN P0004
1 BIRT
2 DATE 1790
2 PLAC Lhota
1 _STROM_HYPO H0001
2 TITL Byl Matouš otcem Václava?
2 NOTE A: ano
3 CONT B: ne
1 _STROM_EDGE parents
2 _SCOPE in
2 _RESEARCH G0001
2 _GEN 3
2 _END unsearched
2 _NEXT queued
2 _EST 1790
3 PLAC Lhota
2 DATE FROM 1787 TO 1793
2 _BOOK B0001
3 TITL Lhota, narození 1784–1830
3 DATE FROM 1784 TO 1830
3 _ACCESS online-free
2 _TASK T0002
3 _LEVEL link
3 STAT open
3 TITL Křest Václava: otec Matouš?
3 _POS 1
2 _HYPO H0001
3 _JOIN P0005
3 _ISLAND 2
3 _HELD 1
3 _TEST T0002
0 @I5@ INDI
1 NAME Matouš /Novák/
1 SEX M
1 REFN P0005
0 @I6@ INDI
1 NAME Dorota /Nováková/
1 SEX F
1 REFN P0006
1 _STROM_ISLAND 2
2 _HYPO H0001
3 _JOIN P0004
2 _HELD 1
0 TRLR
`;

const load = (research: boolean, body = BODY): StromData => convertToStrom(parseGedcom(head(research) + body)).data;
const byRefn = (data: StromData, refn: string) => Object.values(data.persons).find(p => p.refn === refn)!;

const EDGE = (over: Partial<ResearchEdge> = {}): ResearchEdge => ({
    missing: 'parents', books: [], covered: [], noRecords: [], tasks: [], tried: [], conflicts: [], hypos: [], ...over,
});

afterEach(() => setLanguage('en'));

describe('reading _STROM_EDGE and _STROM_ISLAND', () => {
    it('reads the example of the assignment exactly', () => {
        const data = load(true);
        const vaclav = byRefn(data, 'P0004');
        expect(vaclav.research?.edge).toEqual({
            missing: 'parents',
            scope: 'in',
            research: 'G0001',
            gen: 3,
            end: 'unsearched',
            next: 'queued',
            est: { year: 1790, place: 'Lhota' },
            window: { from: 1787, to: 1793 },
            books: [{ id: 'B0001', title: 'Lhota, narození 1784–1830', from: 1784, to: 1830, access: 'online-free' }],
            covered: [],
            noRecords: [],
            tasks: [{ id: 'T0002', level: 'link', stat: 'open', title: 'Křest Václava: otec Matouš?', pos: 1 }],
            tried: [],
            conflicts: [],
            hypos: [{ id: 'H0001', join: 'P0005', island: 2, held: 1, tests: ['T0002'] }],
        });
        expect(vaclav.research?.hypotheses).toEqual([{ id: 'H0001', title: 'Byl Matouš otcem Václava?', note: 'A: ano\nB: ne' }]);
        expect(byRefn(data, 'P0006').research?.island).toEqual({ size: 2, hypos: [{ id: 'H0001', join: 'P0004' }], held: 1 });
        expect(data.researchAsOf).toBe('2026-09-30');
    });

    it('takes any sub-tag missing, skips unknown tags and drops invalid ids and numbers', () => {
        const body = `0 @I1@ INDI
1 NAME Jan /X/
1 REFN P0001
1 _STROM_EDGE father
2 _FUTURE something
3 _DEEPER more
2 _END no-such-end
2 _GEN many
2 _RESEARCH Q0001
2 _TASK not-an-id
3 TITL lost task
2 _TRIED T0009
2 _TRIED T00X
2 _COVERED FROM 1780 TO 1785
2 _COVERED FROM 1790
2 _NORECORDS FROM 1770 TO 1779
2 _SESSIONS 3
3 _COST 4.20
3 _PARTIAL Y
2 _LAST 2026-09-12
2 _CONFLICT X0003
2 _HYPO H0002
3 _JOIN somebody
0 TRLR
`;
        const edge = byRefn(load(true, body), 'P0001').research!.edge!;
        expect(edge.missing).toBe('father');
        expect(edge.end).toBe('no-such-end');
        expect(edge.gen).toBeUndefined();
        expect(edge.research).toBeUndefined();
        expect(edge.tasks).toEqual([]);
        expect(edge.tried).toEqual(['T0009']);
        expect(edge.covered).toEqual([{ from: 1780, to: 1785 }]);
        expect(edge.noRecords).toEqual([{ from: 1770, to: 1779 }]);
        expect(edge.sessions).toEqual({ n: 3, cost: 4.2, partial: true });
        expect(edge.last).toBe('2026-09-12');
        expect(edge.conflicts).toEqual(['X0003']);
        expect(edge.hypos).toEqual([{ id: 'H0002', tests: [] }]);
    });

    it('a foreign GEDCOM keeps nothing of it', () => {
        const data = load(false);
        expect(byRefn(data, 'P0004').research).toBeUndefined();
        expect(byRefn(data, 'P0006').research).toBeUndefined();
        expect(data.researchAsOf).toBeUndefined();
    });

    it('never goes back out in a GEDCOM', () => {
        const ged = exportToGedcom(load(true), 'Test', { research: { id: '0b4c7a52-1c1f-4d7e-9a53-2f4a3c1e8b10' } }).content;
        expect(ged).not.toMatch(/_STROM_EDGE|_STROM_ISLAND|_STROM_HYPO/);
    });
});

describe('a copy that leaves the app', () => {
    it('keeps what the records say, drops how the research works on it', () => {
        const data = load(true);
        const out = applyContentOptions(data, false);
        expect(byRefn(out, 'P0004').research?.edge).toEqual({
            missing: 'parents',
            end: 'unsearched',
            est: { year: 1790, place: 'Lhota' },
            window: { from: 1787, to: 1793 },
            books: [{ id: 'B0001', title: 'Lhota, narození 1784–1830', from: 1784, to: 1830, access: 'online-free' }],
            covered: [],
            noRecords: [],
            tasks: [],
            tried: [],
            conflicts: [],
            hypos: [{ id: 'H0001', join: 'P0005', island: 2, tests: [] }],
        });
        expect(byRefn(out, 'P0006').research?.island).toEqual({ size: 2, hypos: [{ id: 'H0001', join: 'P0004' }] });
        expect(byRefn(out, 'P0004').research?.hypotheses?.[0].title).toBe('Byl Matouš otcem Václava?');
        // The tree itself keeps everything (the research replaces it with the next load).
        expect(byRefn(data, 'P0004').research?.edge?.next).toBe('queued');
        expect(byRefn(data, 'P0004').research?.edge?.tasks).toHaveLength(1);
    });

    it('keeps a scope that is a fact, drops the plan; the copy draws grey', () => {
        const data = load(true);
        const edge = byRefn(data, 'P0004').research!.edge!;
        edge.scope = 'living';
        edge.sessions = { n: 2, cost: 3.1 };
        edge.last = '2026-09-12';
        edge.searches = 5;
        edge.research = 'G0001';
        const copied = byRefn(applyContentOptions(data, false), 'P0004').research!.edge!;
        expect(copied.scope).toBe('living');
        expect(copied.sessions).toBeUndefined();
        expect(copied.last).toBeUndefined();
        expect(copied.searches).toBeUndefined();
        expect(copied.research).toBeUndefined();
        edge.scope = 'paused';
        const plain = byRefn(applyContentOptions(data, false), 'P0004').research!.edge!;
        expect(plain.scope).toBeUndefined();
        expect(edgeView(plain, 'all')).toMatchObject({ kind: 'stub', tone: 'none', nextText: '' });
    });
});

describe('the three axes', () => {
    it('shape follows the end: closed where the records end, open elsewhere (unknown too)', () => {
        for (const end of ['unnamed', 'lost', 'before-records', 'gap', 'not-found']) expect(edgeShape(end)).toBe('closed');
        for (const end of ['offline', 'partly', 'unsearched', 'no-books', 'no-place', 'no-clue', 'whatever', undefined]) expect(edgeShape(end)).toBe('open');
    });

    it('colour follows next', () => {
        expect(edgeTone(undefined)).toBe('none');
        expect(edgeTone('none')).toBe('none');
        expect(['queued', 'proposed', 'working'].map(edgeTone)).toEqual(['searching', 'searching', 'searching']);
        expect(['waiting', 'decide'].map(edgeTone)).toEqual(['yours', 'yours']);
        expect(edgeTone('held')).toBe('held');
        expect(edgeTone('new-word')).toBe('none');
    });

    it('the live status beats the snapshot', () => {
        expect(effectiveNext(EDGE({ next: 'queued' }), { working: true })).toBe('working');
        expect(effectiveNext(EDGE({ next: 'queued' }), { waiting: true })).toBe('waiting');
        expect(effectiveNext(EDGE({ next: 'none' }), { queued: true })).toBe('queued');
        expect(effectiveNext(EDGE({ next: 'held' }), { queued: true })).toBe('held');
    });

    it('modes: off draws nothing, "for you" only what waits for the user (never muted), all everything', () => {
        const queued = EDGE({ end: 'unsearched', next: 'queued' });
        const waiting = EDGE({ end: 'unsearched', next: 'waiting' });
        const decide = EDGE({ end: 'not-found', next: 'decide' });
        const muted = EDGE({ end: 'unsearched', next: 'waiting', scope: 'paused' });
        expect(edgeView(queued, 'off')).toBeNull();
        expect(edgeView(queued, 'mine')).toBeNull();
        expect(edgeView(waiting, 'mine')?.tone).toBe('yours');
        expect(edgeView(decide, 'mine')?.shape).toBe('closed');
        expect(edgeView(muted, 'mine')).toBeNull();
        expect(edgeView(muted, 'all')?.kind).toBe('muted');
        expect(edgeView(queued, 'all')?.tone).toBe('searching');
        expect(edgeView(queued, 'mine', { working: true })).toBeNull();
    });

    it('father and mother put the stub on their side; proof is the dashed line', () => {
        expect(edgeView(EDGE({ missing: 'father' }), 'all')?.side).toBe('father');
        expect(edgeView(EDGE({ missing: 'mother' }), 'all')?.side).toBe('mother');
        expect(edgeView(EDGE(), 'all')?.side).toBe('center');
        expect(edgeView(EDGE({ missing: 'proof' }), 'all')?.kind).toBe('proof');
    });

    it('moves only live, switched on and without reduced motion', () => {
        const v = edgeView(EDGE({ end: 'unsearched', next: 'working' }), 'all')!;
        expect(edgeMoves(v, { live: true, motion: true, reducedMotion: false })).toBe(true);
        expect(edgeMoves(v, { live: false, motion: true, reducedMotion: false })).toBe(false);
        expect(edgeMoves(v, { live: true, motion: false, reducedMotion: false })).toBe(false);
        expect(edgeMoves(v, { live: true, motion: true, reducedMotion: true })).toBe(false);
        const closed = edgeView(EDGE({ end: 'not-found', next: 'working' }), 'all')!;
        expect(edgeMoves(closed, { live: true, motion: true, reducedMotion: false })).toBe(false);
    });

    it('only an open stub moves while the agent works', () => {
        expect(edgeView(EDGE({ end: 'unsearched' }), 'all', { working: true })?.working).toBe(true);
        const closed = edgeView(EDGE({ end: 'not-found' }), 'all', { working: true })!;
        expect(closed.working).toBe(true);
        expect(closed.shape).toBe('closed');
    });
});

describe('words', () => {
    it('every end and next of the assignment has its sentence, in every language', () => {
        const ends = ['unnamed', 'lost', 'before-records', 'gap', 'not-found', 'offline', 'partly', 'unsearched', 'no-books', 'no-place', 'no-clue'];
        const nexts = ['working', 'waiting', 'queued', 'proposed', 'held', 'decide', 'none'];
        for (const lang of ['en', 'cs', 'de'] as const) {
            setLanguage(lang);
            const unknown = getStringsForLang(lang).researchEdge.end.unknown;
            for (const end of ends) {
                const text = edgeEndText(EDGE({ end, records: 1785 }));
                expect(text, `${lang} ${end}`).toBeTruthy();
                expect(text, `${lang} ${end}`).not.toBe(unknown);
            }
            expect(edgeEndText(EDGE({ end: 'brand-new' }))).toBe(unknown);
            for (const next of nexts) expect(edgeNextText(EDGE({ next }), next), `${lang} ${next}`).toBeTruthy();
        }
    });

    it('Czech sentences of the assignment', () => {
        setLanguage('cs');
        expect(edgeEndText(EDGE({ end: 'before-records', records: 1785 }))).toBe('Známé matriky začínají 1785');
        expect(edgeEndText(EDGE({ missing: 'proof' }))).toBe('Rodiče nejsou doloženi záznamem');
        expect(edgeNextText(EDGE({ tasks: [{ id: 'T1', title: 'x', pos: 2 }] }), 'queued')).toBe('Ve frontě jako 2.');
        expect(edgeNextText(EDGE({ tasks: [{ id: 'T1', title: 'x', held: 'paused' }] }), 'held')).toBe('Čeká mimo frontu (pozastavený směr)');
        expect(edgeNextText(EDGE({ tasks: [{ id: 'T1', title: 'x', held: 'parked', until: '2026-11-01' }] }), 'held')).toBe('Čeká mimo frontu (odloženo do 1. 11. 2026)');
        expect(edgeNextText(EDGE({ scope: 'living' }), 'queued')).toBe('Nejspíš žijící, nezkoumá se');
        const v = edgeView(EDGE({ end: 'unsearched', next: 'queued' }), 'all', { working: true })!;
        expect(v.aria).toBe('Rodiče: Zatím nehledáno. Agent na tom právě pracuje');
        expect(v.label).toBe('nehledáno');
        expect(edgeView(EDGE({ end: 'before-records', records: 1785 }), 'all')!.label).toBe('od 1785');
    });

    it('the facts line, the estimate and the timeline', () => {
        setLanguage('cs');
        const edge = byRefn(load(true), 'P0004').research!.edge!;
        expect(edgeFactsLine(edge)).toBe('Křest 1787–1793 · Lhota, narození 1784–1830 · online zdarma');
        expect(edgeEstimateText(edge)).toBe('narozen 1790');
        expect(edgeEstimateText(EDGE({ est: { year: 1783, basis: 'MARR 1810' } }))).toBe('odhad 1783 ze sňatku 1810');
        expect(edgeEstimateText(EDGE({ est: { year: 1783, basis: 'child 1811' } }))).toBe('odhad 1783 z dítěte 1811');
        expect(edgeTimeline(EDGE({
            window: { from: 1773, to: 1793 },
            noRecords: [{ from: 1773, to: 1784 }],
            covered: [{ from: 1785, to: 1788 }],
        }))).toEqual([
            { kind: 'norecords', from: 1773, to: 1784 },
            { kind: 'covered', from: 1785, to: 1788 },
            { kind: 'rest', from: 1789, to: 1793 },
        ]);
    });
});
