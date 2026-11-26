/**
 * Houses of the tree (spec 030 K1.1–K1.2, K3.2), worked out from the facts:
 * a fictional village Bělokamen with the house čp. 16 "U Prouzalů" (numbered
 * 9 before a renumbering), a son-in-law who married in, a house below the
 * threshold, a street with a number and a part of a town without one.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
    collectHouses, hasNumberedHouse, houseContext, houseFacts, houseIdOf, houseInteresting, houseOfFact, housesFor,
    isOverThreshold, keepHouses, sanitizeHouses, withResearchNumbers,
} from '../houses.js';
import { houseKey, placeKey } from '../places.js';
import type { HouseUserData, Partnership, PartnershipId, Person, PersonId, StromData } from '../types.js';

const CASES = new URL('../../test/fixtures/streets/cases.json', import.meta.url);

describe('house key (shared cases with the research)', () => {
    const cases = (JSON.parse(readFileSync(CASES, 'utf8')) as { house: { town: string; house: string; expect: string }[] }).house;

    it('has the cases, Cyrillic among them', () => {
        expect(cases.length).toBeGreaterThan(10);
        expect(cases.some(c => /[\u0400-\u04FF]/.test(c.town + c.house))).toBe(true);
    });

    it.each(cases.map(c => [c.town, c.house, c.expect] as const))('%s + %s = %s', (town, house, expected) => {
        expect(`${placeKey(town)}|${houseKey(house)}`).toBe(expected);
        expect(houseIdOf(town, house)).toBe(expected);
    });

    // The file's inputs are NFC; a GEDCOM file from a Mac may bring them decomposed.
    it.each(cases.map(c => [c.town, c.house, c.expect] as const))('NFD %s + %s = %s', (town, house, expected) => {
        expect(houseIdOf(town.normalize('NFD'), house.normalize('NFD'))).toBe(expected);
    });
});

function person(id: string, first: string, last: string, gender: Person['gender'], o: Partial<Person> = {}): Person {
    return {
        id: id as PersonId, firstName: first, lastName: last, gender,
        isPlaceholder: false, parentIds: [], childIds: [], partnerships: [], ...o,
    };
}

function union(id: string, a: string, b: string, o: Partial<Partnership> = {}): Partnership {
    return { id: id as PartnershipId, person1Id: a as PersonId, person2Id: b as PersonId, childIds: [], status: 'married', ...o };
}

/**
 * Bělokamen čp. 9 → čp. 16 (renumbered about 1860), the Prouzals:
 *   Svatobor Prouzal (1820, čp. 9) ∞ 1845 Radegunda (from Mlýnkovice, † 1890 čp. 16)
 *     ├ Hostivít Prouzal (1848 čp. 9, † 1910 čp. 16)
 *     └ Zdislava Prouzalová (1850 čp. 9) ∞ 1872 Ignác Kvitelka (from Mlýnkovice, † 1915 čp. 16)
 *         └ Radhost Kvitelka (1875 čp. 16)
 * Hroznata Ostružný: Bělokamen čp. 40 from 1900 to 1910 (one generation, 10 years).
 * Kapradin Ostružný: Hvozdnice, Kopřivná 12 (a street with a number), and
 * Bělokamen-Podhradí (a part of the town, no number), a mill without a number.
 */
function village(houses?: StromData['houses']): StromData {
    const persons = [
        person('svatobor', 'Svatobor', 'Prouzal', 'male', {
            birthPlace: 'Bělokamen', birthAddress: 'čp. 9', birthDate: '1820-03-02',
            partnerships: ['u1' as PartnershipId], childIds: ['hostivit', 'zdislava'] as PersonId[],
        }),
        person('radegunda', 'Radegunda', 'Prouzalová', 'female', {
            birthPlace: 'Mlýnkovice', birthDate: '1824',
            deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1890-11-01',
            partnerships: ['u1' as PartnershipId], childIds: ['hostivit', 'zdislava'] as PersonId[],
        }),
        person('hostivit', 'Hostivít', 'Prouzal', 'male', {
            birthPlace: 'Bělokamen', birthAddress: 'č. p. 9', birthDate: '1848',
            deathPlace: 'Bělokamen čp. 16', deathDate: '1910',
            parentIds: ['svatobor', 'radegunda'] as PersonId[],
        }),
        person('zdislava', 'Zdislava', 'Prouzalová', 'female', {
            birthPlace: 'Bělokamen', birthAddress: 'čp. 9', birthDate: '1850',
            parentIds: ['svatobor', 'radegunda'] as PersonId[], partnerships: ['u2' as PartnershipId],
            childIds: ['radhost'] as PersonId[],
        }),
        person('ignac', 'Ignác', 'Kvitelka', 'male', {
            birthPlace: 'Mlýnkovice', birthDate: '1847',
            deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1915',
            partnerships: ['u2' as PartnershipId], childIds: ['radhost'] as PersonId[],
        }),
        person('radhost', 'Radhost', 'Kvitelka', 'male', {
            birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1875',
            parentIds: ['zdislava', 'ignac'] as PersonId[],
        }),
        person('hroznata', 'Hroznata', 'Ostružný', 'male', {
            birthPlace: 'Bělokamen', birthAddress: 'čp. 40', birthDate: '1900',
            events: [{ id: 'e-hroznata-res', type: 'residence', place: 'Bělokamen', address: 'čp. 40', date: '1910' }],
        }),
        person('kapradin', 'Kapradin', 'Ostružný', 'male', {
            birthPlace: 'Bělokamen-Podhradí', birthDate: '1902',
            events: [
                { id: 'e-kapradin-res', type: 'residence', place: 'Hvozdnice', address: 'Kopřivná 12', date: '1930' },
                { id: 'e-kapradin-occ', type: 'occupation', place: 'Bělokamen', address: 'mlýn', date: '1925' },
            ],
        }),
    ];
    return {
        persons: Object.fromEntries(persons.map(p => [p.id, p])) as StromData['persons'],
        partnerships: {
            u1: union('u1', 'svatobor', 'radegunda', { startDate: '1845', startPlace: 'Mlýnkovice', childIds: ['hostivit', 'zdislava'] as PersonId[] }),
            u2: union('u2', 'ignac', 'zdislava', { startDate: '1872-05-04', startPlace: 'Bělokamen', address: 'čp. 16', childIds: ['radhost'] as PersonId[] }),
        } as StromData['partnerships'],
        ...(houses ? { houses } : {}),
    };
}

const PROUZALS: Record<string, HouseUserData> = { 'belokamen|16': { name: 'U Prouzalů', merged: ['belokamen|9'] } };

describe('houseOfFact', () => {
    const ctx = houseContext(village());
    it('reads the house from the house field or from the place', () => {
        expect(houseOfFact({ place: 'Bělokamen', house: 'čp. 16' }, ctx)).toEqual({ town: 'Bělokamen', house: 'čp. 16' });
        expect(houseOfFact({ place: 'Bělokamen čp. 16' }, ctx)).toEqual({ town: 'Bělokamen', house: '16' });
        expect(houseOfFact({ place: 'Hvozdnice', house: 'Kopřivná 12' }, ctx)).toEqual({ town: 'Hvozdnice', house: 'Kopřivná 12' });
    });
    it('is no house without a number: a part of a town, a mill, a street alone, no place', () => {
        expect(houseOfFact({ place: 'Bělokamen-Podhradí' }, ctx)).toBeNull();
        expect(houseOfFact({ place: 'Bělokamen', house: 'mlýn' }, ctx)).toBeNull();
        expect(houseOfFact({ place: 'Hvozdnice', house: 'Kopřivná' }, ctx)).toBeNull();
        expect(houseOfFact({ house: 'čp. 16' }, ctx)).toBeNull();
    });
});

describe('collectHouses', () => {
    it('without a word of a person, the two numbers are two houses', () => {
        const ids = collectHouses(village()).map(h => h.id);
        expect(ids).toEqual(['belokamen|9', 'belokamen|16', 'belokamen|40', 'hvozdnice|koprivna 12']);
    });

    it('joins the renumbered house: numbers 9 → 16, its name, generations, the surnames and who married in', () => {
        const houses = collectHouses(village(PROUZALS));
        expect(houses.map(h => h.id)).toEqual(['belokamen|16', 'belokamen|40', 'hvozdnice|koprivna 12']);
        const h = houses[0]!;
        expect(h.name).toBe('U Prouzalů');
        expect(h.ref).toEqual({ town: 'Bělokamen', house: '16' });
        expect(h.numbers).toEqual([
            { house: 'čp. 9', from: 1820, to: 1850, source: 'merge' },
            { house: 'čp. 16', from: 1872, to: 1915, source: 'tree' },
        ]);
        expect(h.period).toEqual({ from: 1820, to: 1915 });
        expect(h.generations).toBe(3);
        expect(h.persons).toBe(6);
        expect(h.surnames).toEqual(['Prouzal', 'Kvitelka']);
        expect(h.marriedIn).toEqual([
            { personId: 'radegunda', year: 1845, sex: 'f' },
            { personId: 'ignac', year: 1872, sex: 'm' },
        ]);
        expect(h.familyYears).toBe(95);
        expect(h.overThreshold).toBe(true);
        expect(houseInteresting(h)).toEqual([
            { kind: 'family', years: 95 },
            { kind: 'numbers', count: 2 },
            { kind: 'oldest', year: 1820 },
        ]);
    });

    it('marks nobody who married in without the joined number, nor a person of unknown sex', () => {
        // At čp. 16 alone nobody was born before Ignác and Radegunda came.
        expect(collectHouses(village()).find(x => x.id === 'belokamen|16')!.marriedIn).toEqual([]);
        const data = village(PROUZALS);
        data.persons['ignac' as PersonId]!.gender = 'unknown';
        expect(collectHouses(data)[0]!.marriedIn.map(m => m.personId)).toEqual(['radegunda']);
    });

    it('keeps houses told apart apart, whatever joins them', () => {
        const ids = collectHouses(village({ 'belokamen|16': { merged: ['belokamen|9'] }, 'belokamen|9': { split: ['belokamen|16'] } }))
            .map(h => h.id);
        expect(ids).toContain('belokamen|9');
        expect(ids).toContain('belokamen|16');
    });

    it('a house below the threshold: one generation, ten years', () => {
        const h = collectHouses(village()).find(x => x.id === 'belokamen|40')!;
        expect(h.generations).toBe(1);
        expect(h.period).toEqual({ from: 1900, to: 1910 });
        expect(h.overThreshold).toBe(false);
        expect(houseInteresting(h)).toEqual([{ kind: 'oldest', year: 1900 }]);
        expect(isOverThreshold({ generations: 1, period: { from: 1900, to: 1930 } })).toBe(true);
        expect(isOverThreshold({ generations: 2 })).toBe(true);
    });

    it('a street with a number is a house of its town', () => {
        const h = collectHouses(village()).find(x => x.id === 'hvozdnice|koprivna 12')!;
        expect(h.ref.town).toBe('Hvozdnice');
        expect(h.text).toBe('Kopřivná 12');
        expect(houseFacts(h)).toEqual([{ personId: 'kapradin', year: 1930, kind: 'residence', factRef: 'event:e-kapradin-res' }]);
    });

    it('lists the facts of a house by year, a couple\'s fact once for each partner', () => {
        const h = collectHouses(village(PROUZALS))[0]!;
        const rows = houseFacts(h);
        expect(rows[0]).toEqual({ personId: 'svatobor', year: 1820, kind: 'birth', factRef: 'birth:svatobor' });
        expect(rows.filter(r => r.factRef === 'wedding:u2').map(r => r.personId).sort()).toEqual(['ignac', 'zdislava']);
        expect(rows[rows.length - 1]).toEqual({ personId: 'ignac', year: 1915, kind: 'death', factRef: 'death:ignac' });
        expect(houseFacts(h, 2)).toHaveLength(2);
    });
});

describe('hasNumberedHouse', () => {
    it('is true with a house number, false with only a town part, a mill or bare towns', () => {
        expect(hasNumberedHouse(village())).toBe(true);
        const bare: StromData = {
            persons: {
                a: person('a', 'Kapradin', 'Ostružný', 'male', {
                    birthPlace: 'Bělokamen-Podhradí',
                    events: [{ id: 'e1', type: 'occupation', place: 'Bělokamen', address: 'mlýn' }],
                }),
            } as StromData['persons'],
            partnerships: {},
        };
        expect(hasNumberedHouse(bare)).toBe(false);
    });
});

describe('numbers from the research', () => {
    it('adds a found number, not a proposal, not one told apart, not one the tree has', () => {
        const h = collectHouses(village(PROUZALS))[0]!;
        const numbers = withResearchNumbers(h, [
            { number: 'čp. 7', from: '1790', to: '1819' },
            { number: '16', from: '1860' },
            { number: '21', proposed: true },
            { number: '33', from: '1700' },
        ], { split: ['belokamen|33'] });
        expect(numbers.map(n => [n.house, n.source])).toEqual([
            ['čp. 7', 'research'], ['čp. 9', 'merge'], ['čp. 16', 'tree'],
        ]);
    });
});

describe('stored house data', () => {
    it('keeps valid fields only, drops empty houses and bad ids', () => {
        expect(sanitizeHouses({
            'belokamen|16': { name: ' U Prouzalů ', merged: ['belokamen|9', 'belokamen|16', 7, 'bad'], junk: 1 },
            'belokamen|40': {},
            'no-bar': { name: 'x' },
            'hvozdnice|koprivna 12': { location: { lat: 49.5, lng: 15.2, how: 'manual' }, revealInOutputs: ['E3', '<x>'] },
        })).toEqual({
            'belokamen|16': { name: 'U Prouzalů', merged: ['belokamen|9'] },
            'hvozdnice|koprivna 12': { location: { lat: 49.5, lng: 15.2, how: 'manual' }, revealInOutputs: ['E3'] },
        });
        expect(sanitizeHouses({})).toBeUndefined();
        expect(sanitizeHouses([])).toBeUndefined();
    });

    it('a version from the research keeps what was said about houses', () => {
        const previous = village(PROUZALS);
        const next = village();
        expect(keepHouses(next, previous).houses).toEqual(PROUZALS);
        expect(keepHouses(next, village())).toBe(next);
    });

    it('a part of the tree carries only its houses', () => {
        const part = village();
        delete part.persons['svatobor' as PersonId];
        delete part.persons['hostivit' as PersonId];
        delete part.persons['zdislava' as PersonId];
        expect(housesFor(part, { ...PROUZALS, 'belokamen|40': { name: 'Na Výsluní' } })).toEqual({
            'belokamen|16': PROUZALS['belokamen|16'], 'belokamen|40': { name: 'Na Výsluní' },
        });
        delete part.persons['hroznata' as PersonId];
        expect(housesFor(part, { 'belokamen|40': { name: 'Na Výsluní' } })).toBeUndefined();
    });
});
