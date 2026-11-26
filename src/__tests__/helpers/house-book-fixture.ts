/**
 * A fictional house for the protection of houses in outputs (spec 030 §10)
 * and the book's house selection and index (§8): Bělokamen čp. 16 "U
 * Prouzalů", five generations of the Prouzals, from a founder of 1820 to a
 * living great-great-granddaughter, and Mlýnkovice čp. 3, a house of the
 * 19th century only. Every name is invented.
 *
 *   Svatobor Prouzal (1820–1890, čp. 16) ∞ 1845 Radegunda (1824–1891, from Mlýnkovice čp. 3)
 *     └ Hostivít Prouzal (1850–1912, čp. 16) ∞ 1878 Kunhuta Kvitelková (1855–1920, married in)
 *         └ Lubor Prouzal (1890–1950, čp. 16) ∞ 1920 Bělomíra (1898–1970)
 *             └ Vratislav Prouzal (1925–2001, čp. 16)
 *                 └ Bohuslava Prouzalová (1990, living, čp. 16 in 2015)
 * Radegunda's father Drahobud Ploužník (1795–1860) lived at Mlýnkovice čp. 3.
 */
import type { Partnership, PartnershipId, Person, PersonId, StromData } from '../../types.js';
import type { HouseResearch } from '../../house-bridge.js';

export const HOUSE_NOW = new Date(2026, 10, 20, 14, 0, 0);
export const HOUSE_ID = 'belokamen|16';
export const OLD_HOUSE_ID = 'mlynkovice|3';
/** The living person's own name and the sensitive event's text: never in an output. */
export const LIVING_NAME = 'Bohuslava';
export const SENSITIVE_TEXT = 'Konfiskace statku po únoru';

function person(id: string, first: string, last: string, gender: Person['gender'], o: Partial<Person> = {}): Person {
    return {
        id: id as PersonId, firstName: first, lastName: last, gender,
        isPlaceholder: false, parentIds: [], childIds: [], partnerships: [], ...o,
    };
}

function union(id: string, a: string, b: string, children: string[], o: Partial<Partnership> = {}): Partnership {
    return { id: id as PartnershipId, person1Id: a as PersonId, person2Id: b as PersonId, childIds: children as PersonId[], status: 'married', ...o };
}

const at16 = { place: 'Bělokamen', address: 'čp. 16' };

export function houseTree(): StromData {
    const persons = [
        person('drahobud', 'Drahobud', 'Ploužník', 'male', {
            birthPlace: 'Mlýnkovice', birthAddress: 'čp. 3', birthDate: '1795', deathPlace: 'Mlýnkovice', deathAddress: 'čp. 3', deathDate: '1860',
            childIds: ['radegunda'] as PersonId[], refn: 'P0009',
        }),
        person('svatobor', 'Svatobor', 'Prouzal', 'male', {
            birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1820-03-02',
            deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1890-11-01',
            partnerships: ['u1' as PartnershipId], childIds: ['hostivit'] as PersonId[], refn: 'P0001',
        }),
        person('radegunda', 'Radegunda', 'Prouzalová', 'female', {
            birthPlace: 'Mlýnkovice', birthAddress: 'čp. 3', birthDate: '1824', deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1891',
            partnerships: ['u1' as PartnershipId], childIds: ['hostivit'] as PersonId[], parentIds: ['drahobud'] as PersonId[],
        }),
        person('hostivit', 'Hostivít', 'Prouzal', 'male', {
            birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1850', deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1912',
            parentIds: ['svatobor', 'radegunda'] as PersonId[], partnerships: ['u2' as PartnershipId], childIds: ['lubor'] as PersonId[],
            refn: 'P0002',
        }),
        person('kunhuta', 'Kunhuta', 'Kvitelková', 'female', {
            birthPlace: 'Hvozdnice', birthDate: '1855', deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1920',
            marriedSurname: 'Prouzalová', partnerships: ['u2' as PartnershipId], childIds: ['lubor'] as PersonId[],
        }),
        person('lubor', 'Lubor', 'Prouzal', 'male', {
            birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1890', deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1950',
            parentIds: ['hostivit', 'kunhuta'] as PersonId[], partnerships: ['u3' as PartnershipId], childIds: ['vratislav'] as PersonId[],
            refn: 'P0003',
        }),
        person('belomira', 'Bělomíra', 'Prouzalová', 'female', {
            birthPlace: 'Hvozdnice', birthDate: '1898', deathPlace: 'Hvozdnice', deathDate: '1970',
            partnerships: ['u3' as PartnershipId], childIds: ['vratislav'] as PersonId[],
        }),
        person('vratislav', 'Vratislav', 'Prouzal', 'male', {
            birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1925', deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '2001',
            parentIds: ['lubor', 'belomira'] as PersonId[], childIds: ['bohuslava'] as PersonId[], refn: 'P0004',
        }),
        person('bohuslava', LIVING_NAME, 'Prouzalová', 'female', {
            birthPlace: 'Hvozdnice', birthDate: '1990-06-12', parentIds: ['vratislav'] as PersonId[], refn: 'P0005',
            events: [{ id: 'e-bohuslava-res', type: 'residence', ...at16, date: '2015' }],
        }),
    ];
    return {
        persons: Object.fromEntries(persons.map(p => [p.id, p])) as StromData['persons'],
        partnerships: {
            u1: union('u1', 'svatobor', 'radegunda', ['hostivit'], { startDate: '1845', startPlace: 'Mlýnkovice' }),
            u2: union('u2', 'hostivit', 'kunhuta', ['lubor'], { startDate: '1878', startPlace: 'Bělokamen', address: 'čp. 16' }),
            u3: union('u3', 'lubor', 'belomira', ['vratislav'], { startDate: '1920', startPlace: 'Hvozdnice' }),
        } as StromData['partnerships'],
        houses: {
            [HOUSE_ID]: { name: 'U Prouzalů', location: { lat: 49.5, lng: 15.2, how: 'manual' } },
            [OLD_HOUSE_ID]: { name: 'Na Mlýnku', location: { lat: 49.6, lng: 15.3, how: 'confirmed' } },
        },
    };
}

/** The research's result of čp. 16: holders with and without a source, a stranger of today, a sensitive event. */
export function houseResearch(): HouseResearch {
    return {
        id: 'A0001', key: HOUSE_ID, place: { key: 'belokamen', id: 'L0001', name: 'Bělokamen' }, house: '16', name: 'U Prouzalů',
        state: 'done', persons: ['P0001', 'P0002', 'P0003'], years: { from: 1820, to: 1950 },
        numbers: [], location: { lat: 49.51, lon: 15.21, confirmed: null, sources: [] },
        timeline: [
            { id: 'e1', kind: 'built', date: '1830', text: 'Stavení postaveno po rozdělení gruntu', sources: [{ source: 'S0001' }] },
            { id: 'e2', kind: 'fire', date: '1868', text: 'Požár obce', sources: [] },
            { id: 'e9', kind: 'other', date: '1948', text: SENSITIVE_TEXT, sources: [{ source: 'S0002' }] },
            { id: 'e10', kind: 'rebuilt', date: '1962', text: 'Přestavba stodoly', sources: [] },
            { id: 'e11', kind: 'transfer', text: 'Předání gruntu bez data', sources: [] },
        ],
        holders: [
            { id: 'h1', name: 'Svatobor Prouzal', person: 'P0001', from: '1845', to: '1890', how: 'inheritance', sources: [{ source: 'S0001' }] },
            { id: 'h2', name: 'Hostivít Prouzal', person: 'P0002', from: '1890', to: '1912', sources: [] },
            { id: 'h3', name: 'Lubor Prouzal', person: 'P0003', from: '1912', to: '1950', how: 'inheritance', sources: [{ source: 'S0003' }] },
            { id: 'h4', name: 'Kvido Stranný', from: '1951', sources: [{ source: 'S0004' }] },
        ],
        residents: [
            { id: 'r1', name: 'Radegunda Prouzalová', role: 'farmer', from: '1845', to: '1891', sources: [] },
            { id: 'r2', name: 'Bohuslava Prouzalová', person: 'P0005', role: 'other', from: '2015', sources: [] },
        ],
        maps: [], passed: [], manual: [], unknown: [], archiveOnly: [], materials: [],
        sensitive: ['e9'], same: [],
    };
}
