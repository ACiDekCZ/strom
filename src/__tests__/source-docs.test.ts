/**
 * "Create a source from this file…" (spec 102 §5): the file's date as the
 * record date and the event "Cite at" offers and preselects.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DataManager } from '../data.js';
import { recordDateOfFile, citeEventPlaces, preselectCitePlace } from '../ui/source-docs-ui.js';
import { Person, StromData } from '../types.js';
import { toPartnershipId, toPersonId } from '../ids.js';

const P = toPersonId('p_hostivit');
const Q = toPersonId('p_borislava');
const U = toPartnershipId('u_hostivit_borislava');

function person(id: typeof P, firstName: string, extra: Partial<Person> = {}): Person {
    return {
        id, firstName, lastName: 'Kvapil', gender: id === P ? 'male' : 'female', isPlaceholder: false,
        partnerships: [U], parentIds: [], childIds: [], ...extra,
    };
}

const dm = DataManager as unknown as { data: StromData };

beforeEach(() => {
    dm.data = {
        persons: {
            [P]: person(P, 'Hostivít', {
                birthDate: '1901-02-03', deathDate: '1960',
                events: [{ id: 'ev_bapt', type: 'baptism', date: '1901-02-10' }, { id: 'ev_cens', type: 'census', date: '1921' }],
            }),
            [Q]: person(Q, 'Borislava'),
        },
        partnerships: {
            [U]: { id: U, person1Id: P, person2Id: Q, childIds: [], status: 'married', startDate: '1925',
                events: [{ id: 'ce_banns', type: 'banns', date: '1925' }] },
        },
    } as unknown as StromData;
});

describe('recordDateOfFile', () => {
    it('keeps a date the app reads and turns a GEDCOM date into one; nothing for a date it cannot read', () => {
        expect(recordDateOfFile('1901-02-03')).toBe('1901-02-03');
        expect(recordDateOfFile('3 FEB 1901')).toBe('1901-02-03');
        expect(recordDateOfFile(undefined)).toBeUndefined();
        expect(recordDateOfFile('sometime')).toBeUndefined();
    });
});

describe('citeEventPlaces', () => {
    it('birth, the person\'s events, the union and its events, death, in that order', () => {
        expect(citeEventPlaces(dm.data.persons[P])).toEqual([
            { personId: P, fact: 'birth' },
            { personId: P, eventId: 'ev_bapt' },
            { personId: P, eventId: 'ev_cens' },
            { partnershipId: U },
            { partnershipId: U, eventId: 'ce_banns' },
            { personId: P, fact: 'death' },
        ]);
    });

    it('no death for a person without one', () => {
        expect(citeEventPlaces(dm.data.persons[Q]).some(p => 'fact' in p && p.fact === 'death')).toBe(false);
    });
});

describe('preselectCitePlace', () => {
    it('a record of the year of the birth is cited at the birth, of the census year at the census', () => {
        expect(preselectCitePlace(dm.data.persons[P], 'record', '3 FEB 1901')).toEqual({ personId: P, fact: 'birth' });
        expect(preselectCitePlace(dm.data.persons[P], 'record', '1921')).toEqual({ personId: P, eventId: 'ev_cens' });
        expect(preselectCitePlace(dm.data.persons[P], 'record', '1925')).toEqual({ partnershipId: U });
    });

    it('nothing chosen for a photo, a file without a date or a year of no event', () => {
        expect(preselectCitePlace(dm.data.persons[P], 'photo', '1901')).toBeNull();
        expect(preselectCitePlace(dm.data.persons[P], 'record', undefined)).toBeNull();
        expect(preselectCitePlace(dm.data.persons[P], 'record', '1933')).toBeNull();
    });
});
