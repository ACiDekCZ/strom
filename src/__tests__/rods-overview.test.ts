/**
 * The tree overview's family lines helpers (package 1031 §1): order, the
 * period axis, the search, roman generations, the founder's place and the
 * living count. Invented names only.
 */

import { describe, it, expect } from 'vitest';
import { Rod, RodId } from '../lineage.js';
import { Person, PersonId, StromData } from '../types.js';
import {
    sortRods, rodAxis, rodBar, searchRods, rodMatches, romanNumeral, founderPlace, rodLivingCount, rodSize, isRodSort,
} from '../rods-overview.js';

function rod(id: string, surname: string, opts: Partial<Rod> = {}): Rod {
    return {
        id: id as RodId, rootId: `${id}-1` as PersonId, founderId: `${id}-1` as PersonId, surname,
        forms: [surname], otherForms: [], memberIds: [], spouses: [], familyIds: [],
        realMemberCount: 5, realSpouseCount: 0, period: null, places: [], generations: 2,
        small: false, solitary: false, founderYear: null, founderYearApprox: false, manual: null,
        ...opts,
    } as Rod;
}

function person(id: string, first: string, last: string, extra: Partial<Person> = {}): Person {
    return {
        id: id as PersonId, firstName: first, lastName: last, gender: 'male', isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [], ...extra,
    } as Person;
}

const labelsOf = (list: Rod[]): Map<RodId, string> => new Map(list.map(r => [r.id, r.surname]));

describe('family lines: order', () => {
    const a = rod('a', 'Zelenbach', { realMemberCount: 10, realSpouseCount: 2, period: { from: 1750, to: 1900 } });
    const b = rod('b', 'Ambrosek', { realMemberCount: 8, realSpouseCount: 6, period: { from: 1690, to: 1800 } });
    const c = rod('c', 'Čermelík', { realMemberCount: 6, realSpouseCount: 0, period: null });
    const d = rod('d', 'Bystřec', { realMemberCount: 6, realSpouseCount: 0, period: { from: 1750, to: 1820 } });
    const list = [a, b, c, d];
    const labels = labelsOf(list);
    const ids = (xs: Rod[]): string[] => xs.map(r => r.id);

    it('size counts members and spouses who married in, largest first; ties by name', () => {
        expect(rodSize(b)).toBe(14);
        expect(ids(sortRods(list, 'size', labels, 'cs'))).toEqual(['b', 'a', 'd', 'c']);
    });

    it('oldest by the first year, lineages without a period last', () => {
        expect(ids(sortRods(list, 'oldest', labels, 'cs'))).toEqual(['b', 'a', 'd', 'c']);
    });

    it('alphabetical in the UI language (Czech Č after C, before D)', () => {
        expect(ids(sortRods(list, 'alpha', labels, 'cs'))).toEqual(['b', 'd', 'c', 'a']);
    });

    it('does not reorder the input and accepts only known orders', () => {
        sortRods(list, 'alpha', labels, 'cs');
        expect(ids(list)).toEqual(['a', 'b', 'c', 'd']);
        expect(isRodSort('oldest')).toBe(true);
        expect(isRodSort('newest')).toBe(false);
        expect(isRodSort(null)).toBe(false);
    });
});

describe('family lines: the period axis', () => {
    it('rounds the earliest year down and the latest up to 50 years, with a middle mark', () => {
        const axis = rodAxis([rod('a', 'X', { period: { from: 1702, to: 1958 } }), rod('b', 'Y', { period: { from: 1745, to: 2010 } })]);
        expect(axis).toEqual({ from: 1700, mid: 1900, to: 2050 });
    });

    it('a single year still spans 50 years; no periods: no axis', () => {
        expect(rodAxis([rod('a', 'X', { period: { from: 1800, to: 1800 } })])).toEqual({ from: 1800, mid: null, to: 1850 });
        expect(rodAxis([rod('a', 'X')])).toBeNull();
    });

    it('a bar sits inside the axis and is never thinner than a sliver', () => {
        const axis = { from: 1700, to: 1900 };
        expect(rodBar({ from: 1750, to: 1850 }, axis)).toEqual({ left: 25, width: 50 });
        expect(rodBar({ from: 1800, to: 1800 }, axis).width).toBe(1.5);
        const out = rodBar({ from: 1600, to: 2000 }, axis);
        expect(out).toEqual({ left: 0, width: 100 });
    });
});

describe('family lines: search', () => {
    const data = {
        persons: {
            m1: person('m1', 'Radovan', 'Zelenbach'),
            m2: person('m2', 'Ludmila', 'Zelenbachová', { marriedSurname: 'Kvítková', gender: 'female' }),
            ph: person('ph', 'Skrytoslav', 'Zelenbach', { isPlaceholder: true }),
        },
        partnerships: {},
    } as unknown as StromData;
    const z = rod('z', 'Zelenbach', {
        forms: ['Zelenbach', 'Zelenbachová'], otherForms: ['Zelinbach'],
        places: [{ name: 'Horní Pilníkov', count: 3 }], memberIds: ['m1', 'm2', 'ph'] as PersonId[],
    });
    const q = rod('q', 'Ambrosek');
    const labels = new Map<RodId, string>([[z.id, 'Zelenbach (Horní Pilníkov)'], [q.id, 'Ambrosek']]);

    it('finds a lineage by its label, a spelling, a place or a member, ignoring case and accents', () => {
        for (const text of ['zelenbach', 'ZELINBACH', 'pilnikov', 'horni piln', 'radovan', 'kvitkova', 'ludmila zelenbachova']) {
            expect(searchRods([z, q], text, data, labels).map(r => r.id)).toEqual(['z']);
        }
    });

    it('every word must match; placeholders are not searched; an empty query keeps all', () => {
        expect(rodMatches(z, 'radovan ambrosek', data, labels.get(z.id)!)).toBe(false);
        expect(rodMatches(z, 'skrytoslav', data, labels.get(z.id)!)).toBe(false);
        expect(searchRods([z, q], '  ', data, labels).map(r => r.id)).toEqual(['z', 'q']);
    });
});

describe('family lines: small facts', () => {
    it('roman numerals for generations', () => {
        expect([1, 2, 4, 9, 14, 40, 0].map(romanNumeral)).toEqual(['I', 'II', 'IV', 'IX', 'XIV', 'XL', '0']);
    });

    it("the founder's place: birth, else baptism, else the first event with a place", () => {
        expect(founderPlace(person('a', 'Radovan', 'Zelenbach', { birthPlace: ' Lhotkov ' }))).toBe('Lhotkov');
        expect(founderPlace(person('a', 'Radovan', 'Zelenbach', {
            events: [{ id: 'e1', type: 'residence', place: 'Dolní Mlýnec' }, { id: 'e2', type: 'baptism', place: 'Kostelec' }],
        } as Partial<Person>))).toBe('Kostelec');
        expect(founderPlace(person('a', 'Radovan', 'Zelenbach', {
            events: [{ id: 'e1', type: 'residence', place: 'Dolní Mlýnec' }],
        } as Partial<Person>))).toBe('Dolní Mlýnec');
        expect(founderPlace(person('a', 'Radovan', 'Zelenbach'))).toBeNull();
    });

    it('living members: no death and born within a lifetime; placeholders not counted', () => {
        const data = {
            persons: {
                old: person('old', 'Radovan', 'Zelenbach', { birthDate: '1850' }),
                dead: person('dead', 'Bohumil', 'Zelenbach', { birthDate: '1950', deathDate: '2001' }),
                young: person('young', 'Kvido', 'Zelenbach', { birthDate: '1980' }),
                ph: person('ph', '', 'Zelenbach', { isPlaceholder: true }),
            },
            partnerships: {},
        } as unknown as StromData;
        const r = rod('z', 'Zelenbach', { memberIds: ['old', 'dead', 'young', 'ph'] as PersonId[] });
        expect(rodLivingCount(r, data, 2026, new Map())).toBe(1);
    });
});
