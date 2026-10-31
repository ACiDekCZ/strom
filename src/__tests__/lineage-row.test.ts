/**
 * The "Family line" row of the person card and page (spec 1031 §3.1, §3.4):
 * which lineages it names and how it reads in cs/en/de, and when privacy
 * leaves it out. Invented names only.
 */

import { describe, it, expect } from 'vitest';
import { buildLineages, rodLabels, rodOf, personRodRow, spouseRodsOf, RodId, LineageIndex } from '../lineage.js';
import { personRodRowValue, rodRowText, rodRowShown } from '../lineage-row.js';
import { StromData, PersonId, Person, Partnership, PartnershipId } from '../types.js';
import { Language } from '../strings.js';

type Sex = 'male' | 'female' | 'unknown';
interface Spec { first: string; last?: string; sex: Sex; born?: string; parents?: string[]; placeholder?: boolean }

function tree(people: Record<string, Spec>, unions: [string, string, string, string[]][]): StromData {
    const persons: Record<string, Person> = {};
    for (const [id, s] of Object.entries(people)) {
        persons[id] = {
            id: id as PersonId, firstName: s.first, lastName: s.last ?? '', gender: s.sex,
            isPlaceholder: !!s.placeholder, partnerships: [], parentIds: (s.parents ?? []) as PersonId[],
            childIds: [], birthDate: s.born,
        } as Person;
    }
    for (const p of Object.values(persons)) for (const par of p.parentIds) persons[par]?.childIds.push(p.id);
    const partnerships: Record<string, Partnership> = {};
    for (const [uid, a, b, kids] of unions) {
        partnerships[uid] = { id: uid as PartnershipId, person1Id: a as PersonId, person2Id: b as PersonId, childIds: kids as PersonId[], status: 'married' };
        persons[a].partnerships.push(uid as PartnershipId);
        persons[b].partnerships.push(uid as PartnershipId);
    }
    return { version: 13, persons, partnerships } as StromData;
}

const P = (id: string): PersonId => id as PersonId;

// Brandvold, Tallqvist and Hollberg are lineages over the small threshold;
// Ostrander and Rydbeck small families; Hasselgren a wife with no parents.
const data = tree({
    b1: { first: 'Arvid', last: 'Brandvold', sex: 'male', born: '1700' },
    w1: { first: 'Maja', last: 'Hasselgren', sex: 'female', born: '1703' },
    b2: { first: 'Nils', last: 'Brandvold', sex: 'male', born: '1730', parents: ['b1', 'w1'] },
    b3: { first: 'Per', last: 'Brandvold', sex: 'male', born: '1732', parents: ['b1', 'w1'] },
    b4: { first: 'Karin', last: 'Brandvold', sex: 'female', born: '1735', parents: ['b1', 'w1'] },
    b5: { first: 'Lisa', last: 'Brandvold', sex: 'female', born: '1737', parents: ['b1', 'w1'] },
    b6: { first: 'Olof', last: 'Brandvold', sex: 'male', born: '1760', parents: ['b2', 'w2'] },
    t1: { first: 'Henrik', last: 'Tallqvist', sex: 'male', born: '1720' },
    t2: { first: 'Petter', last: 'Tallqvist', sex: 'male', born: '1745', parents: ['t1'] },
    t3: { first: 'Jonas', last: 'Tallqvist', sex: 'male', born: '1748', parents: ['t1'] },
    t4: { first: 'Ingrid', last: 'Tallqvist', sex: 'female', born: '1750', parents: ['t1'] },
    t5: { first: 'August', last: 'Tallqvist', sex: 'male', born: '1752', parents: ['t1'] },
    h1: { first: 'Gudmund', last: 'Hollberg', sex: 'male', born: '1720' },
    h2: { first: 'Lars', last: 'Hollberg', sex: 'male', born: '1745', parents: ['h1'] },
    h3: { first: 'Mats', last: 'Hollberg', sex: 'male', born: '1747', parents: ['h1'] },
    h4: { first: 'Signe', last: 'Hollberg', sex: 'female', born: '1749', parents: ['h1'] },
    h5: { first: 'Anna', last: 'Hollberg', sex: 'female', born: '1751', parents: ['h1'] },
    o1: { first: 'Anton', last: 'Ostrander', sex: 'male', born: '1705' },
    o2: { first: 'Albin', last: 'Ostrander', sex: 'male', born: '1734', parents: ['o1'] },
    w2: { first: 'Dagny', last: 'Ostrander', sex: 'female', born: '1736', parents: ['o1'] },
    r1: { first: 'Sixten', last: 'Rydbeck', sex: 'male', born: '1705' },
    x1: { first: 'Kim', last: 'Rydbeck', sex: 'unknown', born: '1734', parents: ['r1'] },
    lone: { first: 'Elsa', last: 'Vinterlund', sex: 'female', born: '1740' },
    ph: { first: '', last: '', sex: 'male', placeholder: true, parents: ['b2', 'w2'] },
}, [
    ['u1', 'b1', 'w1', ['b2', 'b3', 'b4', 'b5']],
    ['u2', 'b2', 'w2', ['b6', 'ph']],
    ['u3', 't3', 'b4', []],          // Karin marries into Tallqvist
    ['u4', 't2', 'b5', []],          // Lisa marries into Tallqvist ...
    ['u5', 'h2', 'b5', []],          // ... and then into Hollberg
    ['u6', 'b3', 'x1', []],          // Kim (sex unknown) marries Per Brandvold
]);

const index: LineageIndex = buildLineages(data);
const labels = rodLabels(index);
const rod = (id: string): RodId => rodOf(index, P(id))!;
const text = (id: string, lang: Language): string | null => {
    const v = personRodRowValue(index, labels, P(id), lang);
    return v ? rodRowText(v.parts) : null;
};

describe('person family line row: which lineages (§3.1)', () => {
    it('the fixture has the lineages it says', () => {
        for (const id of ['b1', 't1', 'h1']) expect(index.rods.get(rod(id))!.small).toBe(false);
        for (const id of ['o1', 'r1']) expect(index.rods.get(rod(id))!.small).toBe(true);
        expect(index.rods.get(rod('w1'))!.solitary).toBe(true);
    });

    it('a member: the birth lineage', () => {
        expect(personRodRow(index, P('b6'))).toEqual({ kind: 'member', rodId: rod('b1'), marriedInto: [] });
    });

    it('a daughter married elsewhere: her lineage and the one she married into', () => {
        expect(personRodRow(index, P('b4'))).toEqual({ kind: 'member', rodId: rod('b1'), marriedInto: [rod('t1')] });
    });

    it('several marriages: every lineage married into, in the order of the unions', () => {
        expect(spouseRodsOf(index, P('b5'))).toEqual([rod('t1'), rod('h1')]);
        expect(personRodRow(index, P('b5'))).toEqual({ kind: 'member', rodId: rod('b1'), marriedInto: [rod('t1'), rod('h1')] });
    });

    it('a wife from a small family: wife in the lineage, born into her family', () => {
        expect(personRodRow(index, P('w2'))).toEqual({ kind: 'spouse', rodId: rod('b1'), birthRodId: rod('o1') });
    });

    it('a wife with no parents recorded: wife in the lineage, no birth lineage', () => {
        expect(personRodRow(index, P('w1'))).toEqual({ kind: 'spouse', rodId: rod('b1'), birthRodId: null });
    });

    it('a member of a small family not married into a lineage: that family', () => {
        expect(personRodRow(index, P('o2'))).toEqual({ kind: 'member', rodId: rod('o1'), marriedInto: [] });
    });

    it('no row: a placeholder, a person alone, an unknown id', () => {
        expect(personRodRow(index, P('ph'))).toBeNull();
        expect(personRodRow(index, P('lone'))).toBeNull();
        expect(personRodRow(index, P('nobody'))).toBeNull();
    });
});

describe('person family line row: wording in cs/en/de (§0.3, §3.1)', () => {
    const cases: [string, Record<Language, string>][] = [
        ['b6', { cs: 'Brandvold', en: 'Brandvold', de: 'Brandvold' }],
        ['b4', {
            cs: 'Brandvold · vdala se do rodu Tallqvist',
            en: 'Brandvold · married into Tallqvist',
            de: 'Brandvold · heiratete in Stammlinie Tallqvist',
        }],
        ['b5', {
            cs: 'Brandvold · vdala se do rodů Tallqvist, Hollberg',
            en: 'Brandvold · married into Tallqvist, Hollberg',
            de: 'Brandvold · heiratete in Stammlinien Tallqvist, Hollberg',
        }],
        ['w2', {
            cs: 'manželka v rodu Brandvold · rodný rod Ostrander',
            en: 'wife in Brandvold line · born into Ostrander',
            de: 'Ehefrau in Stammlinie Brandvold · Herkunft: Ostrander',
        }],
        ['w1', { cs: 'manželka v rodu Brandvold', en: 'wife in Brandvold line', de: 'Ehefrau in Stammlinie Brandvold' }],
        ['x1', {
            cs: 'sňatkem v rodu Brandvold · rodný rod Rydbeck',
            en: 'by marriage in Brandvold line · born into Rydbeck',
            de: 'durch Heirat in Stammlinie Brandvold · Herkunft: Rydbeck',
        }],
        ['o2', { cs: 'Ostrander', en: 'Ostrander', de: 'Ostrander' }],
    ];
    for (const [id, want] of cases) {
        for (const lang of ['cs', 'en', 'de'] as Language[]) {
            it(`${id} in ${lang}`, () => expect(text(id, lang)).toBe(want[lang]));
        }
    }

    it('the label and the lineage names as their own pieces (the links)', () => {
        const v = personRodRowValue(index, labels, P('w2'), 'de')!;
        expect(v.label).toBe('Stammlinie');
        expect(v.parts.filter(p => 'rodId' in p)).toEqual([
            { rodId: rod('b1'), label: 'Brandvold' }, { rodId: rod('o1'), label: 'Ostrander' },
        ]);
        expect(personRodRowValue(index, labels, P('b6'), 'cs')!.label).toBe('Rod');
        expect(personRodRowValue(index, labels, P('b6'), 'en')!.label).toBe('Family line');
    });

    it('a husband who married in reads "husband in … line"', () => {
        // Lisa's child carries her name: the father (no parents recorded) is a spouse in her lineage.
        const d = tree({
            ...Object.fromEntries(Object.entries(data.persons).map(([id, p]) => [id, {
                first: p.firstName, last: p.lastName, sex: p.gender, born: p.birthDate, parents: p.parentIds, placeholder: p.isPlaceholder,
            } as Spec])),
            v: { first: 'Viktor', last: 'Ekhammar', sex: 'male', born: '1735' },
            e: { first: 'Emma', last: 'Brandvold', sex: 'female', born: '1760', parents: ['b5', 'v'] },
        }, [
            ['u1', 'b1', 'w1', ['b2', 'b3', 'b4', 'b5']],
            ['u7', 'v', 'b5', ['e']],
        ]);
        const idx = buildLineages(d);
        const lab = rodLabels(idx);
        // The child of the unmarried union: her lineage as computed, no explanation.
        expect(rodRowText(personRodRowValue(idx, lab, P('e'), 'cs')!.parts)).toBe('Brandvold');
        expect(rodRowText(personRodRowValue(idx, lab, P('v'), 'cs')!.parts)).toBe('manžel v rodu Brandvold');
        expect(rodRowText(personRodRowValue(idx, lab, P('v'), 'en')!.parts)).toBe('husband in Brandvold line');
        expect(rodRowText(personRodRowValue(idx, lab, P('v'), 'de')!.parts)).toBe('Ehemann in Stammlinie Brandvold');
    });
});

describe('person family line row: privacy of the living (§3.4)', () => {
    it('full data and surname only keep it for the living; initials and hidden names leave it out', () => {
        expect(rodRowShown('full', true)).toBe(true);
        expect(rodRowShown('minimal', true)).toBe(true);
        expect(rodRowShown('initials', true)).toBe(false);
        expect(rodRowShown('anonymous', true)).toBe(false);
    });

    it('the dead have it in every mode', () => {
        for (const m of ['full', 'minimal', 'initials', 'anonymous'] as const) expect(rodRowShown(m, false)).toBe(true);
    });
});
