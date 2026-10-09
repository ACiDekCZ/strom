/**
 * What Strom Research writes so a conflict can be decided from the app
 * (under 1 _STROM_CONFLICT: 2 _STROM_TAKE Y, 3 _STROM_SIDE user|research
 * under each 2 VAL, 3 _STROM_RAW M|F|U under the values of a SEX conflict)
 * must be read safely: nothing thrown, every conflict read as from the file's
 * older shape (count, ids, titles, values, sources, state), no person, couple
 * or value changed, and nothing of it going back out in a GEDCOM. First run
 * against the app before it read these lines (the beta after 3.10.1); since
 * then only what the new lines themselves say is set apart before comparing
 * (read in research-conflict-decide.test.ts). Invented data only
 * (e2e/fixtures/research-conflict-decide.ged).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { readResearchHeader, stabilizeIds } from '../research-link.js';
import { diffByPerson, diffValues } from '../research-changes.js';
import { heldConflicts } from '../research-sync.js';
import { validateJsonImport } from '../merge/validation.js';
import { Person, StromData } from '../types.js';

const FIXTURE = readFileSync(new URL('../../e2e/fixtures/research-conflict-decide.ged', import.meta.url), 'utf8');
const TREE = '2c8e4f61-9a3b-4d7e-8f10-6b5a4c3d2e19';

/** The same file as the research wrote it before (no _STROM_TAKE, _STROM_SIDE, _STROM_RAW). */
function todayShape(text: string): string {
    return text.split('\n').filter(line => !/^\d+ _STROM_(TAKE|SIDE|RAW)\b/.test(line)).join('\n');
}

const load = (text: string) => {
    const parsed = parseGedcom(text);
    return { parsed, data: convertToStrom(parsed).data };
};

const byRefn = (data: StromData, refn: string): Person => Object.values(data.persons).find(p => p.refn === refn)!;

/** What only the new lines say: whether a conflict is decided by a side, each value's side, the raw sex. */
function withoutNewLines(data: StromData): StromData {
    const copy = structuredClone(data);
    for (const p of Object.values(copy.persons)) {
        for (const c of p.research?.conflicts ?? []) {
            delete (c as { take?: unknown }).take;
            for (const v of c.values) {
                delete (v as { side?: unknown }).side;
                delete (v as { raw?: unknown }).raw;
            }
        }
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

describe('a research file with conflicts decidable by a side is read safely', () => {
    it('the fixture really carries the new lines, and the stripped copy none of them', () => {
        expect(FIXTURE).toMatch(/\n2 STAT open\n2 _STROM_TAKE Y\n2 VAL 12\. 3\. 1851\n3 SOUR @S0001@\n3 _STROM_SIDE research\n2 VAL 1852\n3 _STROM_SIDE user\n/);
        expect(FIXTURE).toMatch(/\n2 TYPE SEX\n[\s\S]*?2 VAL muž\n3 SOUR @S0001@\n3 _STROM_SIDE research\n3 _STROM_RAW M\n2 VAL žena\n3 _STROM_SIDE user\n3 _STROM_RAW F\n/);
        // the couple's conflict under both partners
        expect(FIXTURE.match(/1 _STROM_CONFLICT X0009\n2 TYPE MARR\n/g)).toHaveLength(2);
        // and one of the sources alone, without the new lines
        expect(FIXTURE).toMatch(/1 _STROM_CONFLICT X0010\n2 TYPE DEAT\n2 TITL .*\n2 STAT open\n2 VAL 1911\n3 SOUR @S0003@\n2 VAL 1912\n0 /);
        expect(todayShape(FIXTURE)).not.toMatch(/_STROM_TAKE|_STROM_SIDE|_STROM_RAW/);
    });

    it('is read without an error by every way a research file comes in (the same parser)', () => {
        expect(() => convertToStrom(parseGedcom(FIXTURE))).not.toThrow();
        expect(readResearchHeader(FIXTURE)).toMatchObject({ isStromResearch: true, treeId: TREE });
    });

    it('keeps exactly the people, couples, relations, sources and conflicts of today\'s shape', () => {
        const now = load(FIXTURE);
        const before = load(todayShape(FIXTURE));
        expect(now.parsed.droppedTags).toEqual(before.parsed.droppedTags);
        expect(normalize(withoutNewLines(now.data))).toEqual(normalize(before.data));
        expect(Object.keys(now.data.persons)).toHaveLength(3);
        expect(Object.keys(now.data.partnerships)).toHaveLength(1);
        expect(Object.keys(now.data.sources ?? {})).toHaveLength(3);
    });

    it('reads every conflict as before: id, fact, title, state, values and their sources', () => {
        const { data } = load(FIXTURE);
        const plain = withoutNewLines(data);
        const src = (refn: string) => Object.values(data.sources ?? {}).find(s => s.refn === refn)!.id;
        const conflicts = (refn: string) => plain.persons[byRefn(data, refn).id].research?.conflicts;
        const marriage = {
            id: 'X0009', fact: 'MARR', title: 'Datum sňatku Anny a Tomáše', status: 'open',
            values: [{ value: '3. 2. 1875', sourceIds: [src('S0002')] }, { value: '1876' }],
        };
        expect(conflicts('P0001')).toEqual([
            {
                id: 'X0007', fact: 'BIRT', title: 'Rok narození Anny', status: 'open',
                values: [{ value: '12. 3. 1851', sourceIds: [src('S0001')] }, { value: '1852' }],
            },
            marriage,
        ]);
        expect(conflicts('P0002')).toEqual([
            {
                id: 'X0008', fact: 'SEX', title: 'Pohlaví Tomáše', status: 'open',
                values: [{ value: 'muž', sourceIds: [src('S0001')] }, { value: 'žena' }],
            },
            marriage,
            {
                id: 'X0010', fact: 'DEAT', title: 'Rok úmrtí Tomáše', status: 'open',
                values: [{ value: '1911', sourceIds: [src('S0003')] }, { value: '1912' }],
            },
        ]);
        expect(byRefn(data, 'P0003').research).toBeUndefined();
    });

    it('the values of the people and the couple are the file\'s, untouched by the conflicts', () => {
        const { data } = load(FIXTURE);
        const anna = byRefn(data, 'P0001');
        const tomas = byRefn(data, 'P0002');
        expect(anna).toMatchObject({ firstName: 'Anna', lastName: 'Dvořáková', gender: 'female', birthDate: '1851-03-12', birthPlace: 'Lipno' });
        expect(tomas).toMatchObject({ firstName: 'Tomáš', lastName: 'Dvořák', gender: 'male', birthDate: '1849', deathDate: '1911' });
        const couple = Object.values(data.partnerships)[0];
        expect([couple.person1Id, couple.person2Id].sort()).toEqual([anna.id, tomas.id].sort());
        expect(couple.startDate).toBe('1875-02-03');
        expect(couple.startPlace).toBe('Lipno');
        expect(byRefn(data, 'P0003').parentIds.sort()).toEqual([anna.id, tomas.id].sort());
    });

    it('nothing of it goes back out in a GEDCOM: the export is the one of today\'s shape', () => {
        const now = exportToGedcom(load(FIXTURE).data, 'Dvořákovi', { research: { id: TREE } }).content;
        const before = exportToGedcom(load(todayShape(FIXTURE)).data, 'Dvořákovi', { research: { id: TREE } }).content;
        expect(now).not.toMatch(/_STROM_CONFLICT|_STROM_TAKE|_STROM_SIDE|_STROM_RAW/);
        const undated = (ged: string) => ged.replace(/^1 DATE .*\n(2 TIME .*\n)?/m, '');
        expect(undated(now)).toBe(undated(before));
    });

    it('a JSON copy is valid and the same', () => {
        const { data } = load(FIXTURE);
        const json = JSON.stringify(data);
        expect(validateJsonImport(json).valid).toBe(true);
        expect(JSON.parse(json)).toEqual(data);
    });

    it('a load of it over a tree of today\'s shape changes nothing of the user\'s and overwrites no value', () => {
        const here = load(todayShape(FIXTURE)).data;
        const there = stabilizeIds(load(FIXTURE).data, here);
        expect(Object.keys(there.persons).sort()).toEqual(Object.keys(here.persons).sort());
        expect(diffByPerson(here, there)).toEqual([]);
        expect(diffValues(here, there)).toEqual({ rows: [], addedPersons: 0, addedFacts: 0, filled: [] });
        // its conflicts, read without loading the version, are the same ones
        const held = heldConflicts(here, there, 'a', 'b');
        expect(held.takeovers).toEqual([]);
        for (const [id, list] of Object.entries(held.persons)) {
            expect(list.map(c => c.id)).toEqual((here.persons[id as Person['id']].research?.conflicts ?? []).map(c => c.id));
        }
    });
});
