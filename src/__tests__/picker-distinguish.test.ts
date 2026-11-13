/**
 * Same names in a person search list (1113, §1): a row whose name repeats in
 * the result gets a quiet line with the shortest details that set it apart —
 * years → ⚭ partner → parents → place; a row with a name of its own gets none.
 * The design's example table (four Alžběta, three Anna), a find by a detail
 * ("chol", two Kateřina with the same find) and a list that writes the birth
 * year after the name. Invented people only.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setLanguage } from '../strings.js';
import { Person, StromData, Partnership, toPersonId, toPartnershipId, LifeEvent } from '../types.js';
import { distinguishFeatures, distinguishLine, PickerDistinguisher, rowKey } from '../picker-distinguish.js';

function person(id: string, firstName: string, lastName: string, extra: Partial<Person> = {}): Person {
    return {
        id: toPersonId(id), firstName, lastName, gender: 'female', isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [], ...extra,
    };
}

/** A tree from people and couples [id, person1, person2]. */
function tree(persons: Person[], couples: [string, string, string][] = []): StromData {
    const data: StromData = { persons: {}, partnerships: {} } as StromData;
    for (const p of persons) data.persons[p.id] = p;
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

const residence = (place: string, date?: string): LifeEvent => ({ id: `r-${place}`, type: 'residence', place, date } as LifeEvent);

/** The design's people (DR Hledat): four Alžběta, three Anna, and the people they are tied to. */
function designTree(): StromData {
    const m = (id: string, first: string, last: string): Person => person(id, first, last, { gender: 'male' });
    return tree([
        person('al1', 'Alžběta', '', { birthDate: '1852', parentIds: [toPersonId('jk'), toPersonId('ma')] }),
        person('al2', 'Alžběta', '', { birthDate: '1852' }),
        person('al3', 'Alžběta', '', { birthDate: '1879', deathDate: '1880', parentIds: [toPersonId('jm'), toPersonId('al1')] }),
        person('al4', 'Alžběta', '', { parentIds: [toPersonId('mb'), toPersonId('jb')] }),
        m('ak', 'Alois', 'Fikcín'),
        person('an1', 'Anna', '', { birthDate: '1861', deathDate: '1930' }),
        person('an2', 'Anna', ''),
        person('an3', 'Anna', '', { events: [residence('Dolní Smyšlenice')] }),
        m('jm', 'Jan', 'Mlynařík'), m('vs', 'Václav', 'Zkoušek'), m('jk', 'Josef', 'Fikcín'), person('ma', 'Marie', ''),
        m('jb', 'Josef', 'Návrhář'), person('mb', 'Marie', 'Návrhářová'), m('mh', 'Matěj', 'Vymyšlený'),
    ], [['u1', 'jm', 'al1'], ['u2', 'vs', 'al2'], ['u3', 'mh', 'an1']]);
}

const lineOf = (d: PickerDistinguisher, data: StromData, id: string): string | null => d.line(data.persons[toPersonId(id)]);

describe('distinguishLine', () => {
    beforeEach(() => setLanguage('cs'));
    afterEach(() => setLanguage('cs'));

    it('tells apart the design table: four Alžběta and three Anna (the top search, no year in the row)', () => {
        const data = designTree();
        const result = ['al1', 'al2', 'al3', 'al4', 'ak', 'an1', 'an2', 'an3'].map(id => data.persons[toPersonId(id)]);
        const d = new PickerDistinguisher(result, data, false);
        // The year is shared with another Alžběta: the partner is added.
        expect(lineOf(d, data, 'al1')).toBe('* 1852 · ⚭ Jan Mlynařík');
        expect(lineOf(d, data, 'al2')).toBe('* 1852 · ⚭ Václav Zkoušek');
        // The years are enough.
        expect(lineOf(d, data, 'al3')).toBe('* 1879 – † 1880');
        // No years, no partner: the first known detail, the parents (father first).
        expect(lineOf(d, data, 'al4')).toBe('dcera: Josef Návrhář a Marie Návrhářová');
        // The partner is no longer needed.
        expect(lineOf(d, data, 'an1')).toBe('* 1861 – † 1930');
        // Nothing known: said so, nothing made up.
        expect(lineOf(d, data, 'an2')).toBe('bez dalších údajů');
        // Only the place sets her apart from the one before.
        expect(lineOf(d, data, 'an3')).toBe('bydliště Dolní Smyšlenice');
        // A name of its own: no line.
        expect(lineOf(d, data, 'ak')).toBeNull();
        expect(d.count(data.persons[toPersonId('al1')])).toBe(4);
        expect(d.count(data.persons[toPersonId('ak')])).toBe(1);
    });

    it('compares against the whole group of the result, also rows not drawn yet', () => {
        const data = designTree();
        const result = ['al1', 'al2', 'al3', 'al4'].map(id => data.persons[toPersonId(id)]);
        const d = new PickerDistinguisher(result, data, false);
        // Only the first row asked (drawn): still set apart from al2 by the partner.
        expect(lineOf(d, data, 'al1')).toBe('* 1852 · ⚭ Jan Mlynařík');
    });

    it('a find by a detail ("chol"): two Kateřina with the same find get the birth year, † 1866 not said twice', () => {
        const data = tree([
            person('k1', 'Kateřina', '', { birthDate: '1820', deathDate: '1866', deathPlace: 'Horní Smyšlenice', deathCause: 'cholera' }),
            person('k2', 'Kateřina', '', { birthDate: '1863', deathDate: '1866', deathPlace: 'Horní Smyšlenice', deathCause: 'cholera' }),
            person('ms', 'Matěj', 'Zkoušek', { gender: 'male', birthDate: '1818', deathDate: '1866' }),
        ]);
        const match = '† 1866 Horní Smyšlenice · cholera';
        const result = ['k1', 'k2', 'ms'].map(id => data.persons[toPersonId(id)]);
        const d = new PickerDistinguisher(result, data, false, () => match);
        expect(lineOf(d, data, 'k1')).toBe('* 1820');
        expect(lineOf(d, data, 'k2')).toBe('* 1863');
        expect(lineOf(d, data, 'ms')).toBeNull();
        // The years leave out what the find already says.
        expect(distinguishFeatures(data.persons[toPersonId('k1')], data, { showBirthYear: false, matchText: match })[0]).toBe('* 1820');
        expect(distinguishFeatures(data.persons[toPersonId('k1')], data, { showBirthYear: false })[0]).toBe('* 1820 – † 1866');
    });

    it('a list with the birth year in the row ("Add parent", "al"): the year is part of the name', () => {
        const data = designTree();
        const result = ['al1', 'al2', 'al3', 'al4', 'ak'].map(id => data.persons[toPersonId(id)]);
        const d = new PickerDistinguisher(result, data, true);
        // "Alžběta 1879" and the Alžběta without a year are of their own.
        expect(lineOf(d, data, 'al3')).toBeNull();
        expect(lineOf(d, data, 'al4')).toBeNull();
        // The two "Alžběta 1852": the partner (the year is in the row, not repeated).
        expect(lineOf(d, data, 'al1')).toBe('⚭ Jan Mlynařík');
        expect(lineOf(d, data, 'al2')).toBe('⚭ Václav Zkoušek');
        expect(rowKey(data.persons[toPersonId('al1')], true)).toBe(rowKey(data.persons[toPersonId('al2')], true));
        expect(rowKey(data.persons[toPersonId('al1')], true)).not.toBe(rowKey(data.persons[toPersonId('al3')], true));
    });

    it('keys fold diacritics and case as the search does', () => {
        const a = person('a', 'Alžběta', 'Nováková');
        const b = person('b', 'ALZBETA', 'novakova');
        expect(rowKey(a, false)).toBe(rowKey(b, false));
    });

    it('a partner the other rows also have is skipped for one they do not', () => {
        const data = tree([
            person('x1', 'Eliška', 'Pokusná', { birthDate: '1900' }),
            person('x2', 'Eliška', 'Pokusná', { birthDate: '1900' }),
            person('h1', 'Bořek', 'Smyšlený', { gender: 'male' }),
            person('h2', 'Ctibor', 'Zkoušek', { gender: 'male' }),
        ], [['u1', 'h1', 'x1'], ['u2', 'h1', 'x2'], ['u3', 'h2', 'x2']]);
        const d = new PickerDistinguisher([data.persons[toPersonId('x1')], data.persons[toPersonId('x2')]], data, false);
        // The year both have tells nothing and is left out.
        expect(lineOf(d, data, 'x2')).toBe('⚭ Ctibor Zkoušek');
        // x1 has only the shared partner: it is still the one shown, then the next details decide.
        expect(lineOf(d, data, 'x1')).toBe('⚭ Bořek Smyšlený');
    });

    it('a detail the whole group shares is left out: sisters with the same parents, told apart by the birthplace', () => {
        const data = tree([
            person('s1', 'Alžběta Marie', 'Fikcínová-Pokusná', { parentIds: [toPersonId('f'), toPersonId('m')], birthPlace: 'Dolní Smyšlenice' }),
            person('s2', 'Alžběta Marie', 'Fikcínová-Pokusná', { parentIds: [toPersonId('f'), toPersonId('m')], birthPlace: 'Horní Smyšlenice' }),
            person('s3', 'Alžběta Marie', 'Fikcínová-Pokusná', { parentIds: [toPersonId('f'), toPersonId('m')] }),
            person('f', 'Maximilián Bartoloměj', 'Hrubohorský-Zvěřinovský', { gender: 'male' }),
            person('m', 'Alžběta', 'Hrubohorská-Zvěřinovská'),
        ]);
        const result = ['s1', 's2', 's3'].map(id => data.persons[toPersonId(id)]);
        const d = new PickerDistinguisher(result, data, false);
        expect(lineOf(d, data, 's1')).toBe('rodiště Dolní Smyšlenice');
        expect(lineOf(d, data, 's2')).toBe('rodiště Horní Smyšlenice');
        // Only an unknown birthplace sets her apart, the parents tell nothing: said so.
        expect(lineOf(d, data, 's3')).toBe('bez dalších údajů');
        // A detail only some of the group share still counts: the third sister has other parents.
        const other = tree([
            ...Object.values(data.persons).filter(p => p.id !== toPersonId('s3')),
            person('s3', 'Alžběta Marie', 'Fikcínová-Pokusná', { birthPlace: 'Dolní Smyšlenice' }),
        ]);
        const d2 = new PickerDistinguisher(['s1', 's2', 's3'].map(id => other.persons[toPersonId(id)]), other, false);
        expect(lineOf(d2, other, 's1')).toBe('dcera: Maximilián Bartoloměj Hrubohorský-Zvěřinovský a Alžběta Hrubohorská-Zvěřinovská · rodiště Dolní Smyšlenice');
        expect(lineOf(d2, other, 's3')).toBe('rodiště Dolní Smyšlenice');
    });

    it('the place: the birthplace, else the latest residence; parents by the person\'s gender', () => {
        const data = tree([
            person('s', 'Radim', 'Testák', { gender: 'male', parentIds: [toPersonId('f')] }),
            person('f', 'Hynek', 'Testák', { gender: 'male' }),
            person('w', 'Radim', 'Testák', { gender: 'unknown', events: [residence('Smyšlenice', '1890'), residence('Pokusov', '1900'), residence('Bez data')] }),
        ]);
        const s = distinguishFeatures(data.persons[toPersonId('s')], data, { showBirthYear: false });
        expect(s[2]).toBe('syn: Hynek Testák');
        const w = distinguishFeatures(data.persons[toPersonId('w')], data, { showBirthYear: false });
        expect(w[3]).toBe('bydliště Pokusov');
        const born = distinguishFeatures(person('b', 'Radim', 'Testák', { birthPlace: 'Ukázkov', events: [residence('Pokusov')] }), data, { showBirthYear: false });
        expect(born[3]).toBe('rodiště Ukázkov');
    });

    it('the line itself: the shortest distinguishing run, nothing known → the "no other details" text', () => {
        expect(distinguishLine(['* 1900', null, null, null], [['* 1901', null, null, null]])).toBe('* 1900');
        expect(distinguishLine([null, null, null, null], [[null, null, null, 'x']])).toBe('bez dalších údajů');
        // Nothing sets them apart: everything known is shown.
        expect(distinguishLine(['* 1900', '⚭ A', null, null], [['* 1900', '⚭ A', null, null]])).toBe('* 1900 · ⚭ A');
        // Shared details are left out of a line that sets the row apart.
        expect(distinguishLine(['* 1900', '⚭ A', 'p', 'x'], [['* 1900', '⚭ A', 'p', 'y']])).toBe('x');
        expect(distinguishLine(['* 1900', null, 'p', null], [['* 1900', null, 'p', 'y']])).toBe('bez dalších údajů');
        setLanguage('en');
        expect(distinguishLine([null, null, null, null], [[null, null, null, 'x']])).toBe('no other details');
    });
});
