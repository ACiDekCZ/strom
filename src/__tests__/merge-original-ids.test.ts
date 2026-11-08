/**
 * Merging by the ids the loaded GEDCOM files gave a record (spec 066 K3.2):
 * a strong id (`_UID`, `UID`, `_FSFTID`, `AFN`, `EXID` + TYPE) both files give
 * is the same person whatever the names say (a man and a woman only a
 * candidate; `_UID` and `UID` one kind); a global id (`_FSFTID`, `AFN`,
 * `EXID` + TYPE) that differs keeps a name match below the auto-confirm bar,
 * a UUID that differs says nothing; an xref or RIN counts only between files
 * of one program,
 * only on top of a name match.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { createMergeState } from '../merge/matching.js';
import { AUTO_CONFIRM_SCORE, executeMerge, isEffectivelyConfirmed } from '../merge/executor.js';
import { MergeState, PersonMatch } from '../merge/types.js';
import { Person, StromData } from '../types.js';
import { StorageManager } from '../storage.js';

interface Indi {
    xref: string;
    name: string;
    sex: 'M' | 'F';
    birth?: string;
    lines?: string[];
}

/** A file `program` wrote with these people (no families needed). */
function ged(program: string, people: Indi[]): string {
    const out = ['0 HEAD', `1 SOUR ${program.toUpperCase().replace(/\s/g, '_')}`, `2 NAME ${program}`, '1 CHAR UTF-8'];
    for (const p of people) {
        out.push(`0 @${p.xref}@ INDI`, `1 NAME ${p.name}`, `1 SEX ${p.sex}`);
        if (p.birth) out.push('1 BIRT', `2 DATE ${p.birth}`);
        out.push(...(p.lines ?? []));
    }
    out.push('0 TRLR', '');
    return out.join('\n');
}

function load(text: string, file: string): StromData {
    return convertToStrom(parseGedcom(text), { importOrigin: { at: '2026-11-08', file } }).data;
}

function byName(data: StromData, first: string): Person {
    const p = Object.values(data.persons).find(x => x.firstName === first);
    if (!p) throw new Error(`no ${first}`);
    return p;
}

function matchOf(state: MergeState, incoming: Person): PersonMatch | undefined {
    return state.matches.find(m => m.incomingId === incoming.id);
}

const UID = '5F3A1B2C3D4E5F60718293A4B5C6D7E8';

describe('strong ids', () => {
    it('MyHeritage: the same _UID pairs a person whose name and birth changed, and the match confirms itself', () => {
        const existing = load(ged('MyHeritage Family Tree Builder', [
            { xref: 'I500001', name: 'Hromoslav /Ozubec/', sex: 'M', birth: '1880', lines: [`1 _UID ${UID}`, '1 RIN MH:I500001'] },
        ]), 'older.ged');
        const incoming = load(ged('MyHeritage Family Tree Builder', [
            { xref: 'I500007', name: 'Jaromil /Vrbecký/', sex: 'M', birth: '3 MAR 1884', lines: [`1 _UID ${UID.toLowerCase()}`] },
        ]), 'newer.ged');
        const state = createMergeState(existing, incoming);
        const match = matchOf(state, byName(incoming, 'Jaromil'));
        expect(match?.existingId).toBe(byName(existing, 'Hromoslav').id);
        expect(match?.score).toBe(100);
        expect(match?.confidence).toBe('high');
        expect(match?.reasons).toEqual(['id']);
        expect(isEffectivelyConfirmed(state, match!)).toBe(true);
    });

    it('a _UID with the 4-digit checksum, or hyphenated, is the same id', () => {
        const existing = load(ged('Legacy', [
            { xref: 'I1', name: 'Hromoslav /Ozubec/', sex: 'M', lines: [`1 _UID ${UID}A1B2`] },
        ]), 'a.ged');
        const incoming = load(ged('RootsMagic', [
            { xref: 'I9', name: 'Mlhoň /Šťovík/', sex: 'M', lines: ['1 _UID {5f3a1b2c-3d4e-5f60-7182-93a4b5c6d7e8}'] },
        ]), 'b.ged');
        expect(matchOf(createMergeState(existing, incoming), byName(incoming, 'Mlhoň'))?.score).toBe(100);
    });

    it('_FSFTID: the same FamilySearch id pairs people from files of different programs', () => {
        const existing = load(ged('RootsMagic', [
            { xref: 'I3', name: 'Libuna /Šťovíková/', sex: 'F', birth: '1902', lines: ['1 _FSFTID KWCB-HZ2'] },
        ]), 'rm.ged');
        const incoming = load(ged('Ancestry.com Family Trees', [
            { xref: 'I77', name: 'Libuna /Ozubcová/', sex: 'F', birth: '1903', lines: ['1 _FSFTID KWCB-HZ2'] },
        ]), 'anc.ged');
        const state = createMergeState(existing, incoming);
        const match = matchOf(state, byName(incoming, 'Libuna'));
        expect(match?.existingId).toBe(byName(existing, 'Libuna').id);
        expect(match?.score).toBe(100);
        expect(isEffectivelyConfirmed(state, match!)).toBe(true);
    });

    it('EXID counts only with the same TYPE', () => {
        const file = (type: string, first: string): string => ged('Some Program', [
            { xref: 'I1', name: `${first} /Ozubec/`, sex: 'M', lines: ['1 EXID 4711', `2 TYPE ${type}`] },
        ]);
        const existing = load(file('https://example.org/people', 'Hromoslav'), 'a.ged');
        const same = load(file('https://example.org/people', 'Mlhoň'), 'b.ged');
        const other = load(file('https://example.net/other', 'Mlhoň'), 'c.ged');
        expect(matchOf(createMergeState(existing, same), byName(same, 'Mlhoň'))?.score).toBe(100);
        expect(matchOf(createMergeState(existing, other), byName(other, 'Mlhoň'))).toBeUndefined();
    });

    it('a man and a woman with the same _UID: only offered, with the reason', () => {
        const existing = load(ged('MyHeritage Family Tree Builder', [
            { xref: 'I1', name: 'Hromoslav /Ozubec/', sex: 'M', birth: '1880', lines: [`1 _UID ${UID}`] },
        ]), 'a.ged');
        const incoming = load(ged('MyHeritage Family Tree Builder', [
            { xref: 'I1', name: 'Hromoslava /Ozubcová/', sex: 'F', birth: '1880', lines: [`1 _UID ${UID}`] },
        ]), 'b.ged');
        const state = createMergeState(existing, incoming);
        const match = matchOf(state, byName(incoming, 'Hromoslava'));
        expect(match?.existingId).toBe(byName(existing, 'Hromoslav').id);
        expect(match?.reasons).toContain('id');
        expect(match!.score).toBeLessThan(AUTO_CONFIRM_SCORE);
        expect(isEffectivelyConfirmed(state, match!)).toBe(false);
    });

    it('a _UID that differs says nothing: two MyHeritage trees give one person different UUIDs, the match confirms itself', () => {
        // Different xrefs too: two trees, nothing of one tree's numbering in common.
        const person = (xref: string, uid: string): string => ged('MyHeritage Family Tree Builder', [
            { xref, name: 'Hromoslav /Ozubec/', sex: 'M', birth: '2 FEB 1880', lines: [`1 _UID ${uid}`] },
        ]);
        const existing = load(person('I500001', UID), 'a.ged');
        const incoming = load(person('I700042', '9D3A1B2C3D4E5F60718293A4B5C6D7E8'), 'b.ged');
        const state = createMergeState(existing, incoming);
        const match = matchOf(state, byName(incoming, 'Hromoslav'));
        expect(match!.score).toBeGreaterThanOrEqual(AUTO_CONFIRM_SCORE);
        expect(isEffectivelyConfirmed(state, match!)).toBe(true);
        // The same as without ids.
        delete byName(existing, 'Hromoslav').originalIds;
        const plain = createMergeState(existing, incoming);
        expect(matchOf(plain, byName(incoming, 'Hromoslav'))!.score).toBe(match!.score);
    });

    it('an _FSFTID that differs keeps an exact name and birth date match below the bar: it is offered', () => {
        const person = (uid: string, fsid: string): string => ged('MyHeritage Family Tree Builder', [
            { xref: 'I1', name: 'Hromoslav /Ozubec/', sex: 'M', birth: '2 FEB 1880', lines: [`1 _UID ${uid}`, `1 _FSFTID ${fsid}`] },
        ]);
        const existing = load(person(UID, 'KWCB-HZ2'), 'a.ged');
        const incoming = load(person('9D3A1B2C3D4E5F60718293A4B5C6D7E8', 'LZ7M-Q41'), 'b.ged');
        const state = createMergeState(existing, incoming);
        const match = matchOf(state, byName(incoming, 'Hromoslav'));
        expect(match).toBeDefined();
        expect(match!.score).toBeLessThan(AUTO_CONFIRM_SCORE);
        expect(isEffectivelyConfirmed(state, match!)).toBe(false);
        // Without ids the same pair confirms itself.
        delete byName(existing, 'Hromoslav').originalIds;
        const plain = createMergeState(existing, incoming);
        expect(isEffectivelyConfirmed(plain, matchOf(plain, byName(incoming, 'Hromoslav'))!)).toBe(true);
    });

    it('_UID and UID are one kind: the same UUID written the GEDCOM 5.5.1 and the GEDCOM 7 way is the same person', () => {
        const existing = load(ged('Legacy', [
            { xref: 'I1', name: 'Hromoslav /Ozubec/', sex: 'M', lines: [`1 _UID ${UID}`] },
        ]), 'a.ged');
        const incoming = load(ged('GEDCOM 7 Program', [
            { xref: 'I9', name: 'Mlhoň /Šťovík/', sex: 'M', lines: ['1 UID 5f3a1b2c-3d4e-5f60-7182-93a4b5c6d7e8'] },
        ]), 'b.ged');
        const match = matchOf(createMergeState(existing, incoming), byName(incoming, 'Mlhoň'));
        expect(match?.existingId).toBe(byName(existing, 'Hromoslav').id);
        expect(match?.score).toBe(100);
    });

    it('the id decides before a name: another person with the same name does not take the one the id names', () => {
        const existing = load(ged('MyHeritage Family Tree Builder', [
            { xref: 'I1', name: 'Hromoslav /Ozubec/', sex: 'M', birth: '2 FEB 1880', lines: [`1 _UID ${UID}`] },
        ]), 'a.ged');
        const incoming = load(ged('Gramps', [
            { xref: 'I0001', name: 'Hromoslav /Ozubec/', sex: 'M', birth: '2 FEB 1880' },
            { xref: 'I0002', name: 'Bořivoj /Ozubec/', sex: 'M', lines: [`1 _UID ${UID}`] },
        ]), 'b.ged');
        const state = createMergeState(existing, incoming);
        expect(matchOf(state, byName(incoming, 'Bořivoj'))?.existingId).toBe(byName(existing, 'Hromoslav').id);
        expect(matchOf(state, byName(incoming, 'Hromoslav'))).toBeUndefined();
    });
});

describe('weak ids (xref, RIN)', () => {
    const gramps = (program: string, first: string, birth: string): string => ged(program, [
        { xref: 'I0001', name: `${first} /Kvasil/`, sex: 'M', birth },
    ]);

    it('Gramps: the same xref in two Gramps files lifts a name match over the bar', () => {
        const existing = load(gramps('Gramps', 'Zbyhněv', '1901'), 'a.ged');
        const incoming = load(gramps('Gramps', 'Zbyhněv', '5 MAY 1901'), 'b.ged');
        const state = createMergeState(existing, incoming);
        const match = matchOf(state, byName(incoming, 'Zbyhněv'));
        expect(match?.reasons[0]).toBe('id');
        expect(match!.score).toBeGreaterThanOrEqual(AUTO_CONFIRM_SCORE);
        expect(isEffectivelyConfirmed(state, match!)).toBe(true);
    });

    it('the same xref from files of different programs counts for nothing', () => {
        const existing = load(gramps('Gramps', 'Zbyhněv', '1901'), 'a.ged');
        const incoming = load(gramps('RootsMagic', 'Zbyhněv', '5 MAY 1901'), 'b.ged');
        const state = createMergeState(existing, incoming);
        const match = matchOf(state, byName(incoming, 'Zbyhněv'));
        expect(match?.reasons).not.toContain('id');
        expect(match!.score).toBeLessThan(AUTO_CONFIRM_SCORE);
        expect(isEffectivelyConfirmed(state, match!)).toBe(false);
    });

    it('an xref alone never pairs people whose names are not alike', () => {
        const existing = load(gramps('Gramps', 'Zbyhněv', '1901'), 'a.ged');
        const incoming = load(ged('Gramps', [{ xref: 'I0001', name: 'Mlhoň /Šťovík/', sex: 'M', birth: '1950' }]), 'b.ged');
        expect(createMergeState(existing, incoming).matches).toEqual([]);
    });

    it('RIN of one program counts like the xref', () => {
        const file = (xref: string, birth: string): string => ged('Gramps', [
            { xref, name: 'Zbyhněv /Kvasil/', sex: 'M', birth, lines: ['1 RIN 37'] },
        ]);
        const existing = load(file('I0001', '1901'), 'a.ged');
        const incoming = load(file('I0099', '5 MAY 1901'), 'b.ged');
        const match = matchOf(createMergeState(existing, incoming), byName(incoming, 'Zbyhněv'));
        expect(match?.reasons).toContain('id');
        expect(match!.score).toBeGreaterThanOrEqual(AUTO_CONFIRM_SCORE);
    });
});

describe('the merged person', () => {
    beforeEach(() => { vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never); });

    it('carries the ids of both files', async () => {
        const existing = load(ged('MyHeritage Family Tree Builder', [
            { xref: 'I500001', name: 'Hromoslav /Ozubec/', sex: 'M', lines: [`1 _UID ${UID}`, '1 RIN MH:I500001'] },
        ]), 'older.ged');
        const incoming = load(ged('MyHeritage Family Tree Builder', [
            { xref: 'I500007', name: 'Jaromil /Vrbecký/', sex: 'M', lines: [`1 _UID ${UID}`, '1 RIN MH:I500007'] },
        ]), 'newer.ged');
        const result = await executeMerge(createMergeState(existing, incoming));
        expect(result.success).toBe(true);
        const people = Object.values(result.mergedData.persons);
        expect(people).toHaveLength(1);
        expect(result.mergedData.imports?.map(r => r.id)).toEqual(['I1', 'I2']);
        expect(people[0].originalIds).toEqual([
            { from: 'I1', xref: 'I500001', ids: [{ tag: '_UID', value: UID }, { tag: 'RIN', value: 'MH:I500001' }] },
            { from: 'I2', xref: 'I500007', ids: [{ tag: '_UID', value: UID }, { tag: 'RIN', value: 'MH:I500007' }] },
        ]);
    });
});
