/**
 * Copies of a shared event that went apart (spec 085 §4, 4b–4d): the Data
 * quality finding, the copies that differ, the Unify dialog's defaults (the
 * majority; on a tie the opener's value) and the values a choice writes.
 * The own fields (age, role) are never compared. Invented data.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { validateTreeData } from '../validation.js';
import { findDivergentShares } from '../shared-events.js';
import {
    divergentCopies, divergentPersons, divergenceSentence, takeAllFrom, unifyDefaults, unifyValues, sameFields,
} from '../shared-divergence.js';
import { setLanguage } from '../strings.js';
import { STROM_DATA_VERSION, toPersonId, type Person, type PersonId, type StromData } from '../types.js';

const OTAKAR = toPersonId('p_otakar');
const LUDMILA = toPersonId('p_ludmila');
const VRATISLAV = toPersonId('p_vratislav');

function person(id: PersonId, firstName: string, lastName: string, gender: 'male' | 'female', events: Person['events']): Person {
    return { id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], events };
}

function tree(vDate: string, lPlace = 'Horní Kotlinov'): StromData {
    const census = { type: 'census' as const, shareId: 'sh_c' };
    return {
        version: STROM_DATA_VERSION,
        persons: {
            [OTAKAR]: person(OTAKAR, 'Hostivít', 'Šmidlovský', 'male', [{ id: 'c_o', ...census, date: '1910-12-31', place: 'Horní Kotlinov', age: '40' }]),
            [LUDMILA]: person(LUDMILA, 'Radegunda', 'Šmidlovská', 'female', [{ id: 'c_l', ...census, date: '1910-12-31', place: lPlace, age: '36' }]),
            [VRATISLAV]: person(VRATISLAV, 'Zbyhněv', 'Šmidlovský', 'male', [{ id: 'c_v', ...census, date: vDate, place: 'Horní Kotlinov', age: '11', shareRole: 'son' }]),
        },
        partnerships: {},
    } as StromData;
}

beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T10:30:00Z'));
    setLanguage('en');
});
afterAll(() => { vi.useRealTimers(); });

describe('copies of a shared event that differ', () => {
    it('copies alike (own ages and roles apart) give no finding', () => {
        const res = validateTreeData(tree('1910-12-31'));
        expect(res.issues.filter(i => i.type === 'sharedCopiesDiffer')).toEqual([]);
    });

    it('one copy with another date: a warning naming that person, with the share id', () => {
        const data = tree('1911-01-01');
        const found = validateTreeData(data).issues.filter(i => i.type === 'sharedCopiesDiffer');
        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({ severity: 'warning', shareId: 'sh_c', personIds: [VRATISLAV] });
        const d = findDivergentShares(data)[0];
        expect(divergentCopies(d).map(c => c.personId)).toEqual([VRATISLAV]);
        expect(divergenceSentence(data, d, 'en')).toMatch(/^Census 1910 · Zbyhněv Šmidlovský: date differs \(.*1911.*; others .*1910.*\)\.$/);
        expect(sameFields(d)).not.toContain('date');
        expect(sameFields(d)).toContain('place');
    });

    it('several copies differing: the count and the fields', () => {
        const data = tree('1911-01-01', 'Dolní Kotlinov');
        const d = findDivergentShares(data)[0];
        expect(divergentPersons(d).sort()).toEqual([LUDMILA, VRATISLAV].sort());
        expect(divergenceSentence(data, d, 'en')).toBe('Census 1910 · 2 copies differ: date, place.');
    });

    it('the Unify defaults: the majority, the opener on a tie; take all from a person; the values written', () => {
        const data = tree('1911-01-01');
        const d = findDivergentShares(data)[0];
        const date = d.fields.find(f => f.field === 'date')!;
        const majority = unifyDefaults(d, VRATISLAV);
        expect(date.values[majority.get('date')!].value).toBe('1910-12-31');
        expect(unifyValues(d, takeAllFrom(d, VRATISLAV, majority))).toEqual({ date: '1911-01-01' });

        // Two persons, a tie: the opener's value leads.
        delete data.persons[OTAKAR];
        const tie = findDivergentShares(data)[0];
        const tieDate = tie.fields.find(f => f.field === 'date')!;
        expect(tieDate.values[unifyDefaults(tie, VRATISLAV).get('date')!].value).toBe('1911-01-01');
        expect(tieDate.values[unifyDefaults(tie, LUDMILA).get('date')!].value).toBe('1910-12-31');
    });
});
