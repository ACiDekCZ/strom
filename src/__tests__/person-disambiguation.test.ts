/**
 * Who a row of a person search is (1128): a row without years, or of a name
 * another row of the result has too, gets a quiet line — parents, else a
 * partner, else a place or the occupation, last the generation from the
 * focus; in a group of the same name the first detail that sets the row
 * apart. Invented people only.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setLanguage } from '../strings.js';
import { Person, PersonId, StromData, Partnership, LifeEvent } from '../types.js';
import { toPersonId, toPartnershipId } from '../ids.js';
import { generationsFrom, hintLine, personHints } from '../person-disambiguation.js';

function person(id: string, firstName: string, lastName: string, extra: Partial<Person> = {}): Person {
    return {
        id: toPersonId(id), firstName, lastName, gender: 'female', isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [], ...extra,
    };
}

/** A tree from people (children linked to their parents) and couples [id, person1, person2]. */
function tree(persons: Person[], couples: [string, string, string][] = []): StromData {
    const data: StromData = { persons: {}, partnerships: {} } as StromData;
    for (const p of persons) data.persons[p.id] = p;
    for (const p of persons) for (const pid of p.parentIds) data.persons[pid]?.childIds.push(p.id);
    for (const [id, a, b] of couples) {
        const u: Partnership = {
            id: toPartnershipId(id), person1Id: toPersonId(a), person2Id: toPersonId(b), childIds: [], status: 'married',
        } as Partnership;
        data.partnerships[u.id] = u;
        data.persons[toPersonId(a)].partnerships.push(u.id);
        data.persons[toPersonId(b)].partnerships.push(u.id);
    }
    return data;
}

const job = (what: string): LifeEvent => ({ id: `o-${what}`, type: 'occupation', note: what } as LifeEvent);
const ids = (...xs: string[]): PersonId[] => xs.map(toPersonId);
const years = (p: Person): boolean => !!(p.birthDate || p.deathDate);

/** Two Kateřina Brousilová without years (the snímek's case), their parents, a partner, a place. */
function kateriny(): StromData {
    const m = (id: string, first: string, last: string, extra: Partial<Person> = {}): Person => person(id, first, last, { gender: 'male', ...extra });
    return tree([
        m('ob', 'Ondřej', 'Brousil'), person('ak', 'Anna', 'Drnomílová'),
        m('vb', 'Vavřinec', 'Brousil'), person('lp', 'Ludmila', 'Kapradníková'),
        person('k1', 'Kateřina', 'Brousilová', { parentIds: ids('ob', 'ak') }),
        person('k2', 'Kateřina', 'Brousilová', { parentIds: ids('vb', 'lp') }),
        person('k3', 'Kateřina', 'Brousilová', { birthDate: '1804' }),
        m('tf', 'Tobiáš', 'Fiktivní'),
        person('t1', 'Terezie', 'Kloboukovská', { birthDate: '1810', deathDate: '1870' }),
    ], [['u1', 'tf', 'k3']]);
}

describe('personHints (1128)', () => {
    beforeEach(() => setLanguage('cs'));
    afterEach(() => setLanguage('en'));

    it('two people of the same name without years: a different line each, by their parents', () => {
        const d = kateriny();
        const result = ['k1', 'k2'].map(id => d.persons[toPersonId(id)]);
        const h = personHints(result, d, { hasYears: years, rootId: null });
        expect(h.get(toPersonId('k1'))).toBe('dcera: Ondřej Brousil a Anna Drnomílová');
        expect(h.get(toPersonId('k2'))).toBe('dcera: Vavřinec Brousil a Ludmila Kapradníková');
        expect(h.get(toPersonId('k1'))).not.toBe(h.get(toPersonId('k2')));
    });

    it('a name repeated with years still gets a line; a row with years and a name of its own none', () => {
        const d = kateriny();
        const result = ['k1', 'k2', 'k3', 't1'].map(id => d.persons[toPersonId(id)]);
        const h = personHints(result, d, { hasYears: years, rootId: null });
        // No parents known: the partner sets her apart.
        expect(h.get(toPersonId('k3'))).toBe('⚭ Tobiáš Fiktivní');
        expect(h.has(toPersonId('t1'))).toBe(false);
    });

    it('the word follows the sex: son, daughter, child', () => {
        const d = tree([
            person('f', 'Ivo', 'Lískový', { gender: 'male' }),
            person('s', 'Emil', 'Lískový', { gender: 'male', parentIds: ids('f') }),
            person('u', 'Jindra', 'Lískový', { gender: 'unknown', parentIds: ids('f') }),
            person('g', 'Bára', 'Lísková', { parentIds: ids('f') }),
        ]);
        const h = personHints(['s', 'u', 'g'].map(id => d.persons[toPersonId(id)]), d, { hasYears: years, rootId: null });
        expect(h.get(toPersonId('s'))).toBe('syn: Ivo Lískový');
        expect(h.get(toPersonId('u'))).toBe('dítě: Ivo Lískový');
        expect(h.get(toPersonId('g'))).toBe('dcera: Ivo Lískový');
        setLanguage('en');
        const en = personHints(['s', 'u', 'g'].map(id => d.persons[toPersonId(id)]), d, { hasYears: years, rootId: null });
        expect(en.get(toPersonId('s'))).toBe('son of Ivo Lískový');
        expect(en.get(toPersonId('u'))).toBe('child of Ivo Lískový');
        expect(en.get(toPersonId('g'))).toBe('daughter of Ivo Lískový');
    });

    it('falls back: partner, then place, then occupation, then the generation from the focus', () => {
        const d = tree([
            person('root', 'Hedvika', 'Ohnivcová', { birthDate: '1900', gender: 'female' }),
            person('p1', 'Bedřich', 'Ohnivec', { gender: 'male' }),
            person('p2', 'Marta', 'Ohnivcová'),
            person('a', 'Rozálie', 'Zvonková'),
            person('b', 'Rozálie', 'Zvonková', { birthPlace: 'Horní Vymyšlov' }),
            person('c', 'Rozálie', 'Zvonková', { events: [job('švadlena')] }),
            person('e', 'Rozálie', 'Zvonková'),
            person('x', 'Prokop', 'Cimbálek', { gender: 'male' }),
        ], [['u1', 'x', 'a'], ['u2', 'p1', 'p2']]);
        d.persons[toPersonId('root')].parentIds.push(toPersonId('p1'), toPersonId('p2'));
        d.persons[toPersonId('p1')].childIds.push(toPersonId('root'));
        d.persons[toPersonId('p2')].childIds.push(toPersonId('root'));
        // Rozálie "e": Bedřich's mother, the focus's grandmother.
        d.persons[toPersonId('p1')].parentIds.push(toPersonId('e'));
        d.persons[toPersonId('e')].childIds.push(toPersonId('p1'));
        // Her parents are not known, so the generation tells her apart.
        const result = ['a', 'b', 'c', 'e'].map(id => d.persons[toPersonId(id)]);
        const h = personHints(result, d, { hasYears: years, rootId: toPersonId('root') });
        expect(h.get(toPersonId('a'))).toBe('⚭ Prokop Cimbálek');
        expect(h.get(toPersonId('b'))).toBe('rodiště Horní Vymyšlov');
        expect(h.get(toPersonId('c'))).toBe('povolání švadlena');
        expect(h.get(toPersonId('e'))).toBe('generace −2');
        setLanguage('de');
        expect(personHints(result, d, { hasYears: years, rootId: toPersonId('root') }).get(toPersonId('e'))).toBe('Generation −2');
    });

    it('a name alone without years: its first known detail; nothing known and alone: no line', () => {
        const d = tree([
            person('n', 'Vratislava', 'Nikdová'),
            person('o', 'Kunhuta', 'Osamělá', { birthPlace: 'Dlouhý Vymyšlov' }),
        ]);
        const h = personHints([d.persons[toPersonId('n')], d.persons[toPersonId('o')]], d, { hasYears: years, rootId: null });
        expect(h.has(toPersonId('n'))).toBe(false);
        expect(h.get(toPersonId('o'))).toBe('rodiště Dlouhý Vymyšlov');
    });

    it('sisters of the same name: the parents tell nothing, the next detail that differs does', () => {
        const d = tree([
            person('f', 'Kryštof', 'Mechový', { gender: 'male' }),
            person('s1', 'Johana', 'Mechová', { parentIds: ids('f'), birthPlace: 'Mechov' }),
            person('s2', 'Johana', 'Mechová', { parentIds: ids('f'), events: [job('přadlena')] }),
        ]);
        const h = personHints(['s1', 's2'].map(id => d.persons[toPersonId(id)]), d, { hasYears: years, rootId: null });
        expect(h.get(toPersonId('s1'))).toBe('rodiště Mechov');
        expect(h.get(toPersonId('s2'))).toBe('povolání přadlena');
    });
});

describe('hintLine', () => {
    beforeEach(() => setLanguage('cs'));
    afterEach(() => setLanguage('en'));

    it('the same details in a group: the first known; nothing at all: "no other details"', () => {
        expect(hintLine(['a', null, null, null], [['a', null, null, null]])).toBe('a');
        expect(hintLine([null, null, null, null], [[null, null, null, null]])).toBe('bez dalších údajů');
        expect(hintLine([null, null, null, null], [])).toBeNull();
    });
});

describe('generationsFrom', () => {
    it('parents up, children down, partners level', () => {
        const d = tree([
            person('gp', 'A', 'A'), person('p', 'B', 'B', { parentIds: ids('gp') }),
            person('me', 'C', 'C', { parentIds: ids('p') }), person('kid', 'D', 'D', { parentIds: ids('me') }),
            person('wife', 'E', 'E'), person('far', 'F', 'F'),
        ], [['u', 'me', 'wife']]);
        const g = generationsFrom(d, toPersonId('me'));
        expect(g.get(toPersonId('gp'))).toBe(-2);
        expect(g.get(toPersonId('p'))).toBe(-1);
        expect(g.get(toPersonId('kid'))).toBe(1);
        expect(g.get(toPersonId('wife'))).toBe(0);
        expect(g.has(toPersonId('far'))).toBe(false);
    });
});
