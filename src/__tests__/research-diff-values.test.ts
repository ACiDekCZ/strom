import { describe, it, expect } from 'vitest';
import { diffValues } from '../research-changes.js';
import { StromData, Person, PersonId } from '../types.js';

function person(id: string, first: string, extra: Partial<Person> = {}): Person {
    return { id: id as PersonId, firstName: first, lastName: 'Berg', gender: 'female', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra };
}

function tree(persons: Person[], sources: Record<string, { id: string; title: string }> = {}): StromData {
    return { version: 11, persons: Object.fromEntries(persons.map(p => [p.id, p])), partnerships: {}, sources } as unknown as StromData;
}

describe('values the research version would overwrite', () => {
    it('one row per value here that changes or goes; values only there are counted as added', () => {
        const here = tree([person('a', 'Ida', { birthDate: '1825-03-12', birthPlace: 'Voss', deathPlace: '' })]);
        const there = tree([person('a', 'Ida', { birthDate: '1825-03-12', birthPlace: 'Bergen', deathPlace: 'Oslo' })]);
        const d = diffValues(here, there);
        expect(d.rows).toEqual([{ personId: 'a', name: 'Ida Berg', field: 'birthPlace', here: 'Voss', there: 'Bergen' }]);
        expect(d.addedFacts).toBe(1);
        expect(d.addedPersons).toBe(0);
    });

    it('B18-1: a title the version takes away is a value it overwrites ("Nothing is overwritten" never hides it)', () => {
        const here = tree([person('a', 'Ida', { titleBefore: 'Ing.', titleAfter: 'st.' })]);
        const there = tree([person('a', 'Ida')]);
        expect(diffValues(here, there).rows).toEqual([{ personId: 'a', name: 'Ida Berg', field: 'name', here: 'Ing. Ida Berg st.', there: 'Ida Berg' }]);
        // A title the version adds changes the name as any name change does.
        expect(diffValues(there, here).rows).toEqual([{ personId: 'a', name: 'Ida Berg', field: 'name', here: 'Ida Berg', there: 'Ing. Ida Berg st.' }]);
    });

    it('a citation cited here and not there goes (V-J), with the source titles', () => {
        const sources = { s1: { id: 's1', title: 'Křest – Ida Berg · s. 112' }, s2: { id: 's2', title: 'Křest – Ida Berg · s. 113' } };
        const here = tree([person('a', 'Ida', { birthSourceIds: ['s1', 's2'] })], sources);
        const there = tree([person('a', 'Ida', { birthSourceIds: ['s1'] })], sources);
        expect(diffValues(here, there).rows).toEqual([
            { personId: 'a', name: 'Ida Berg', field: 'citation', of: 'birth', here: 'Křest – Ida Berg · s. 113', there: 'Křest – Ida Berg · s. 112' },
        ]);
    });

    it('a person missing there, events by id, an open conflict marked, added people and their facts', () => {
        const here = tree([
            person('a', 'Ole', { events: [{ id: 'e1', type: 'occupation', note: 'sedlák' }, { id: 'e2', type: 'residence', place: 'Voss' }] }),
            person('b', 'Karl'),
        ]);
        const there = tree([
            person('a', 'Ole', { events: [{ id: 'e1', type: 'occupation', note: 'chalupník' }],
                research: { conflicts: [{ id: 'X0001', fact: 'OCCU', status: 'open', values: [] }] } as never }),
            person('c', 'Nils', { birthDate: '1850' }),
        ]);
        const d = diffValues(here, there);
        expect(d.rows).toEqual([
            { personId: 'b', name: 'Karl Berg', field: 'person', here: 'Karl Berg', there: '' },
            { personId: 'a', name: 'Ole Berg', field: 'eventValue', here: 'sedlák', there: 'chalupník', of: 'occupation', conflict: true },
            { personId: 'a', name: 'Ole Berg', field: 'event', here: 'Voss', there: '', of: 'residence' },
        ]);
        expect(d.addedPersons).toBe(1);
        expect(d.addedFacts).toBe(1);
    });

    it('nothing overwritten: no rows', () => {
        const here = tree([person('a', 'Ida')]);
        const there = tree([person('a', 'Ida', { birthDate: '1825' })]);
        expect(diffValues(here, there)).toEqual({
            rows: [], addedPersons: 0, addedFacts: 1,
            filled: [{ personId: 'a', name: 'Ida Berg', field: 'birthDate', here: '', there: '1825', date: true }],
        });
    });

    it('events read anew from the research\'s file (new ids each reading) pair by what they say: nothing goes that stays (the showcase round)', () => {
        const ev = (id: string, extra: object) => ({ id, ...extra }) as never;
        const here = tree([person('a', 'Ida', { events: [
            ev('h1', { type: 'baptism', date: '1931-01-18', place: 'Voss' }),
            ev('h2', { type: 'custom', customLabel: 'Pověst', note: 'Vodítko' }),
            ev('h3', { type: 'occupation', note: 'sedlák' }),
            ev('h4', { type: 'residence', place: 'Voss', date: '1950' }),
        ] })]);
        // The same file read again: other ids, the same events — nothing to say.
        const same = tree([person('a', 'Ida', { events: [
            ev('t1', { type: 'baptism', date: '1931-01-18', place: 'Voss' }),
            ev('t2', { type: 'custom', customLabel: 'Pověst', note: 'Vodítko' }),
            ev('t3', { type: 'occupation', note: 'sedlák' }),
            ev('t4', { type: 'residence', place: 'Voss', date: '1950' }),
        ] })]);
        expect(diffValues(here, same)).toEqual({ rows: [], addedPersons: 0, addedFacts: 0, filled: [] });
        // Changed there: the occupation's value (one of its type each side), the residence's place (same date);
        // the custom one gone; a new one added.
        const there = tree([person('a', 'Ida', { events: [
            ev('t1', { type: 'baptism', date: '1931-01-18', place: 'Voss' }),
            ev('t3', { type: 'occupation', note: 'chalupník' }),
            ev('t4', { type: 'residence', place: 'Bergen', date: '1950' }),
            ev('t5', { type: 'emigration', date: '1951' }),
        ] })]);
        const d = diffValues(here, there);
        expect(d.rows.map(r => [r.field, r.of, r.here, r.there])).toEqual([
            ['event', 'custom', 'Vodítko', ''],
            ['eventValue', 'occupation', 'sedlák', 'chalupník'],
            ['eventPlace', 'residence', 'Voss', 'Bergen'],
        ]);
        expect(d.addedFacts).toBe(1);
    });
});
