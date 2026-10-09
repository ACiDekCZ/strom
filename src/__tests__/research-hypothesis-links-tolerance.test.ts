/**
 * What Strom Research writes about what each variant of a hypothesis would
 * connect (under 1 _STROM_HYPO: 2 STAT, 2 _CHOSEN, 2 _VAR > 3 TITL / 3 _LINK >
 * 4 _PERS / _FAM / _PAR, 3 SOUR) and where the tree ends (2 _END named, the
 * joins at the edge and on the islands naming their variant: 3 _VAR) must be
 * read safely: nothing thrown, no person, couple or relation lost or invented,
 * everything else read as from the file's older shape, the named end drawn
 * as an open stub, and nothing of it going back out in a GEDCOM. First run
 * against the app before it read these lines (3.10.1); since then only what
 * the new lines themselves say is set apart before comparing (read in
 * research-hypothesis-links.test.ts). Invented data only
 * (e2e/fixtures/research-hypothesis-links.ged).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { edgeShape, edgeView } from '../research-edge.js';
import { readResearchHeader, stabilizeIds } from '../research-link.js';
import { diffByPerson, diffValues } from '../research-changes.js';
import { validateJsonImport } from '../merge/validation.js';
import { stripResearchWork } from '../privacy.js';
import { strings, setLanguage } from '../strings.js';
import { Person, StromData } from '../types.js';

const FIXTURE = readFileSync(new URL('../../e2e/fixtures/research-hypothesis-links.ged', import.meta.url), 'utf8');

/**
 * The same file as the research wrote it before (no STAT, _CHOSEN, _VAR under
 * a hypothesis, no _VAR under the joins, no `_END named`).
 */
function todayShape(text: string): string {
    const out: string[] = [];
    let record = '';
    let skipBelow: number | null = null;
    let underHypo = false;
    for (const line of text.split('\n')) {
        const m = /^(\d+) (\S+)(?: (.*))?$/.exec(line);
        if (!m) { out.push(line); continue; }
        const level = Number(m[1]);
        const tag = m[2];
        if (skipBelow !== null) {
            if (level > skipBelow) continue;
            skipBelow = null;
        }
        if (level === 1) record = tag;
        if (level === 2) underHypo = tag === '_HYPO';
        if (record === '_STROM_HYPO' && level === 2 && (tag === 'STAT' || tag === '_CHOSEN')) continue;
        if (record === '_STROM_HYPO' && level === 2 && tag === '_VAR') { skipBelow = 2; continue; }
        if ((record === '_STROM_EDGE' || record === '_STROM_ISLAND') && underHypo && level === 3 && tag === '_VAR') continue;
        if (record === '_STROM_EDGE' && level === 2 && tag === '_END' && m[3] === 'named') continue;
        out.push(line);
    }
    return out.join('\n');
}

const load = (text: string) => {
    const parsed = parseGedcom(text);
    return { parsed, data: convertToStrom(parsed).data };
};

const byRefn = (data: StromData, refn: string): Person => Object.values(data.persons).find(p => p.refn === refn)!;
const refnsOf = (data: StromData, ids: readonly string[]): string[] => ids.map(id => data.persons[id as Person['id']]?.refn ?? `?${id}`).sort();

/** What only the new lines say: the hypotheses' status, choice and variants, the variants of the joins, the edge end. */
function withoutNewLines(data: StromData): StromData {
    const copy = structuredClone(data);
    for (const p of Object.values(copy.persons)) {
        const r = p.research;
        if (!r) continue;
        for (const h of r.hypotheses ?? []) { delete h.status; delete h.chosen; delete h.variants; }
        for (const h of r.edge?.hypos ?? []) delete h.variants;
        for (const h of r.island?.hypos ?? []) delete h.variants;
        if (r.edge?.end === 'named') delete r.edge.end;
    }
    return copy;
}

/** The data with every generated id replaced by what names the record in the file (REFN, the couple's REFNs). */
function normalize(data: StromData): unknown {
    const names = new Map<string, string>();
    for (const [id, p] of Object.entries(data.persons)) names.set(id, `person:${p.refn}`);
    for (const [id, s] of Object.entries(data.sources ?? {})) names.set(id, `source:${s.refn ?? s.title}`);
    for (const [id, u] of Object.entries(data.partnerships)) {
        names.set(id, `couple:${[data.persons[u.person1Id]?.refn, data.persons[u.person2Id]?.refn].join('+')}`);
    }
    const walk = (v: unknown): unknown => {
        if (typeof v === 'string') return names.get(v) ?? v;
        if (Array.isArray(v)) return v.map(walk);
        if (v && typeof v === 'object') {
            return Object.fromEntries(Object.entries(v).map(([k, x]) => [names.get(k) ?? k, walk(x)]));
        }
        return v;
    };
    return walk(data);
}

afterEach(() => setLanguage('en'));

describe('a research file with hypothesis variants, links and the named edge end is read safely', () => {
    it('the fixture really carries the new lines, and the stripped copy none of them', () => {
        expect(FIXTURE).toMatch(/\n2 STAT decided\n2 _CHOSEN B\n/);
        expect(FIXTURE).toMatch(/\n2 STAT abandoned\n/);
        expect(FIXTURE).toMatch(/\n2 _VAR B\n3 TITL .*\n4 CONC .*\n4 CONC .*\n3 _LINK child\n4 _PERS @P0010@\n4 _FAM @F0042@\n3 SOUR @S0001@\n3 SOUR @S0003@\n/);
        expect(FIXTURE).toMatch(/\n3 _LINK child\n4 _PERS @P0010@\n4 _PAR @P0130@\n/);
        expect(FIXTURE).toMatch(/\n3 _LINK child\n4 _PERS @P0001@\n4 _PAR @P0999@\n/);
        expect(FIXTURE).not.toMatch(/0 @P0999@ INDI/);
        expect(FIXTURE).toMatch(/\n3 _LINK partners\n/);
        expect(FIXTURE).toMatch(/\n3 _LINK same\n/);
        expect(FIXTURE).toMatch(/\n3 _LINK siblings\n/);
        expect(FIXTURE).toMatch(/\n2 _END named\n2 _NEXT decide\n/);
        expect(FIXTURE).toMatch(/\n3 _JOIN P0130\n3 _VAR B\n3 _VAR C\n3 _ISLAND 5\n/);
        expect(FIXTURE).toMatch(/\n1 _STROM_ISLAND 5\n2 _HYPO H0022\n3 _JOIN P0010\n3 _VAR B\n/);
        const before = todayShape(FIXTURE);
        expect(before).not.toMatch(/_VAR|_LINK|_PERS|_PAR|_FAM|_CHOSEN|\n2 STAT|_END named/);
        expect(before).toMatch(/1 _STROM_HYPO H0022\n2 TITL .*\n2 NOTE /);
    });

    it('is read without an error by every way a research file comes in (the same parser)', () => {
        expect(() => convertToStrom(parseGedcom(FIXTURE))).not.toThrow();
        const header = readResearchHeader(FIXTURE);
        expect(header).toMatchObject({ isStromResearch: true, treeId: '7d3f2a10-4b6c-4e8a-9f21-5c0d8e3b1a77' });
    });

    it('keeps exactly the people, couples, relations and sources of today\'s shape (only the edge end differs)', () => {
        const now = load(FIXTURE);
        const before = load(todayShape(FIXTURE));
        expect(now.parsed.droppedTags).toEqual(before.parsed.droppedTags);
        expect(byRefn(now.data, 'P0010').research?.edge?.end).toBe('named');
        expect(byRefn(before.data, 'P0010').research?.edge?.end).toBeUndefined();
        expect(normalize(withoutNewLines(now.data))).toEqual(normalize(before.data));
        // the older shape gives the same with or without the new reading
        expect(normalize(withoutNewLines(before.data))).toEqual(normalize(before.data));
    });

    it('invents no relation: the parents a variant names stay apart from the tree', () => {
        const { data } = load(FIXTURE);
        expect(Object.keys(data.persons)).toHaveLength(14);
        expect(Object.keys(data.partnerships)).toHaveLength(4);
        expect(Object.keys(data.sources ?? {})).toHaveLength(3);
        const vaclav = byRefn(data, 'P0010');
        expect(vaclav.parentIds).toEqual([]);
        expect(refnsOf(data, vaclav.childIds)).toEqual(['P0001']);
        expect(vaclav.partnerships).toHaveLength(1);
        expect(refnsOf(data, byRefn(data, 'P0001').parentIds)).toEqual(['P0010', 'P0011']);
        expect(refnsOf(data, byRefn(data, 'P0011').parentIds)).toEqual(['P0012', 'P0013']);
        expect(refnsOf(data, byRefn(data, 'P0127').parentIds)).toEqual(['P0125', 'P0126']);
        expect(refnsOf(data, byRefn(data, 'P0125').childIds)).toEqual(['P0127']);
        expect(refnsOf(data, byRefn(data, 'P0125').parentIds)).toEqual(['P0128', 'P0129']);
        // the partner, the same person, the siblings and the absent parent of a variant: nothing
        for (const refn of ['P0130', 'P0140', 'P0141', 'P0150']) {
            const p = byRefn(data, refn);
            expect(p.parentIds).toEqual([]);
            expect(p.childIds).toEqual([]);
            expect(p.partnerships).toEqual([]);
        }
        expect(byRefn(data, 'P0011').partnerships).toHaveLength(1);
        expect(byRefn(data, 'P0001').partnerships).toEqual([]);
        // a source a variant names is no citation of the person
        expect(vaclav.sourceIds ?? []).toEqual([]);
    });

    it('reads every hypothesis as before: id, question and note, untouched by the variants', () => {
        const { data } = load(FIXTURE);
        expect(withoutNewLines(data).persons[byRefn(data, 'P0010').id].research?.hypotheses).toEqual([{
            id: 'H0022',
            title: 'Odkud pocházel Václav Horák, ženich z roku 1857?',
            note: 'A: narozen 1818 v Habrech čp. 68, syn Šebestiána(?)\nB: syn Jakuba Horáka a Marie Pokorné (sňatek S0001)\nC: z Nové Vsi, syn Jana Horáka',
        }]);
        expect(withoutNewLines(data).persons[byRefn(data, 'P0011').id].research?.hypotheses).toEqual([
            { id: 'H0024', title: 'Byla Rozálie před sňatkem s Václavem vdaná?', note: 'A: vdova po Martinu Novotném\nB: svobodná' },
            { id: 'H0026', title: 'Kdo byli rodiče Rozálie?', note: 'A: dcera Františka Dvořáčka z Habrů\nB: dcera Antonína Dvořáčka a Ludmily' },
        ]);
        expect(byRefn(data, 'P0001').research?.hypotheses?.map(h => h.id)).toEqual(['H0025', 'H0027']);
        expect(byRefn(data, 'P0125').research?.hypotheses?.map(h => h.id)).toEqual(['H0022', 'H0028']);
        expect(byRefn(data, 'P0012').research?.hypotheses?.map(h => h.id)).toEqual(['H0026', 'H0028']);
        expect(byRefn(data, 'P0013').research).toBeUndefined();
    });

    it('the named end draws an open stub with its own words ("parents named, not linked")', () => {
        const { data } = load(FIXTURE);
        const edge = byRefn(data, 'P0010').research!.edge!;
        expect(edge).toMatchObject({ missing: 'parents', scope: 'in', research: 'G0001', gen: 2, end: 'named', next: 'decide', window: { from: 1815, to: 1821 } });
        expect(edge.est).toEqual({ year: 1818, place: 'Lhota' });
        // the joins read as before (the last one kept)
        expect(edge.hypos).toMatchObject([{ id: 'H0022', join: 'P0130', island: 5, held: 0, tests: [] }]);
        expect(edgeShape(edge.end)).toBe('open');
        const view = edgeView(edge, 'all')!;
        // Without the number of its options no short word; with it, "named · 3 options".
        expect(view).toMatchObject({ kind: 'stub', side: 'center', shape: 'open', tone: 'yours', named: true, label: '' });
        expect(view.endText).toBe('Parents named, not linked');
        expect(edgeView(edge, 'all', {}, 3)!.label).toBe('named · 3 options');
        expect(edgeView(edge, 'mine')).not.toBeNull();
        setLanguage('cs');
        expect(edgeView(edge, 'all')!.endText).toBe('Rodiče jmenováni, nepřipojeno');
        expect(edgeView(edge, 'all', {}, 3)!.label).toBe('jmenováni · 3 možnosti');
        expect(edgeView(edge, 'all', {}, 5)!.label).toBe('jmenováni · 5 možností');
    });

    it('reads the islands as before', () => {
        const { data } = load(FIXTURE);
        const plain = withoutNewLines(data);
        const island = (refn: string) => plain.persons[byRefn(data, refn).id].research?.island;
        for (const refn of ['P0125', 'P0126', 'P0127', 'P0128', 'P0129']) {
            expect(island(refn)).toEqual({ size: 5, hypos: [{ id: 'H0022', join: 'P0010' }, { id: 'H0028', join: 'P0012' }], held: 0 });
        }
        expect(island('P0130')).toEqual({ size: 1, hypos: [{ id: 'H0022', join: 'P0010' }], held: 0 });
        expect(island('P0141')).toEqual({ size: 1, hypos: [{ id: 'H0025', join: 'P0001' }] });
        expect(island('P0150')).toEqual({ size: 1, hypos: [], held: 0 });
    });

    it('nothing of it goes back out in a GEDCOM: the export is the one of today\'s shape', () => {
        const now = exportToGedcom(load(FIXTURE).data, 'Horákovi', { research: { id: '7d3f2a10-4b6c-4e8a-9f21-5c0d8e3b1a77' } }).content;
        const before = exportToGedcom(load(todayShape(FIXTURE)).data, 'Horákovi', { research: { id: '7d3f2a10-4b6c-4e8a-9f21-5c0d8e3b1a77' } }).content;
        expect(now).not.toMatch(/_STROM_HYPO|_STROM_EDGE|_STROM_ISLAND|_VAR|_LINK|_PERS|_PAR\b|_CHOSEN|named/);
        const undated = (ged: string) => ged.replace(/^1 DATE .*\n(2 TIME .*\n)?/m, '');
        expect(undated(now)).toBe(undated(before));
    });

    it('a JSON copy is valid and a copy that leaves the app keeps the edge in the safe shape', () => {
        const { data } = load(FIXTURE);
        const json = JSON.stringify(data);
        const result = validateJsonImport(json);
        expect(result.valid).toBe(true);
        expect(JSON.parse(json)).toEqual(data);
        const copy = stripResearchWork(structuredClone(data));
        const edge = byRefn(copy, 'P0010').research!.edge!;
        expect(edge.end).toBe('named');
        expect(edge.next).toBeUndefined();
        expect(edgeView(edge, 'all')).toMatchObject({ shape: 'open', label: '' });
    });

    it('a load of it over a tree of today\'s shape changes nothing of the user\'s and overwrites no value', () => {
        const here = load(todayShape(FIXTURE)).data;
        const there = stabilizeIds(load(FIXTURE).data, here);
        expect(Object.keys(there.persons).sort()).toEqual(Object.keys(here.persons).sort());
        expect(diffByPerson(here, there)).toEqual([]);
        expect(diffValues(here, there)).toEqual({ rows: [], addedPersons: 0, addedFacts: 0, filled: [] });
    });
});
