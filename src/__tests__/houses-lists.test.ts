/**
 * Houses in the Table, the lists' rules, the statistics and the search (spec 030 §15). The tree is invented:
 * Bělokamen čp. 16 (once čp. 9, joined by hand), the Prouzals and the Kvitelkas; Mlýnkovice čp. 8.
 */
import { describe, it, expect } from 'vitest';
import type { Partnership, PartnershipId, Person, PersonId, StromData } from '../types.js';
import { buildTableModel } from '../ui/table-view/table-model.js';
import { cellOf, columnById } from '../ui/table-view/table-columns.js';
import { sortRows } from '../ui/table-view/table-filter.js';
import { houseLinkHtml } from '../ui/table-view/table-grid.js';

function person(id: string, first: string, last: string, gender: Person['gender'], o: Partial<Person> = {}): Person {
    return { id: id as PersonId, firstName: first, lastName: last, gender, isPlaceholder: false, parentIds: [], childIds: [], partnerships: [], ...o };
}

function union(id: string, a: string, b: string, children: string[], o: Partial<Partnership> = {}): Partnership {
    return { id: id as PartnershipId, person1Id: a as PersonId, person2Id: b as PersonId, childIds: children as PersonId[], status: 'married', ...o };
}

/**
 * Svatobor Prouzal (1801 čp. 9, † 1856 čp. 16) ∞ 1830 Radegunda (from Mlýnkovice čp. 8)
 *   └ Hostivít Prouzal (1838 čp. 16, census 1880 čp. 16, † 1901 čp. 16) ∞ 1862 Kunhuta Kvitelková (1840, Mlýnkovice čp. 8)
 *       └ Lubor Prouzal (1866 čp. 16, † 1934 čp. 16)
 * Dobromil Kvitelka (1810 Mlýnkovice čp. 8, † 1874 Mlýnkovice čp. 8). Vratislav Hejl (1862 Zálesí, no house).
 */
export function village(): StromData {
    const persons = [
        person('svatobor', 'Svatobor', 'Prouzal', 'male', {
            birthPlace: 'Bělokamen', birthAddress: 'čp. 9', birthDate: '1801', deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1856',
            partnerships: ['u1' as PartnershipId], childIds: ['hostivit'] as PersonId[],
        }),
        person('radegunda', 'Radegunda', 'Prouzalová', 'female', {
            birthPlace: 'Mlýnkovice', birthAddress: 'čp. 8', birthDate: '1806', partnerships: ['u1' as PartnershipId], childIds: ['hostivit'] as PersonId[],
        }),
        person('hostivit', 'Hostivít', 'Prouzal', 'male', {
            birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1838', deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1901',
            parentIds: ['svatobor', 'radegunda'] as PersonId[], partnerships: ['u2' as PartnershipId], childIds: ['lubor'] as PersonId[],
            events: [{ id: 'e-host-census', type: 'census', place: 'Bělokamen', address: 'čp. 16', date: '1880' }],
        }),
        person('kunhuta', 'Kunhuta', 'Kvitelková', 'female', {
            birthPlace: 'Mlýnkovice', birthAddress: 'čp. 8', birthDate: '1840', partnerships: ['u2' as PartnershipId], childIds: ['lubor'] as PersonId[],
        }),
        person('lubor', 'Lubor', 'Prouzal', 'male', {
            birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1866', deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1934',
            parentIds: ['hostivit', 'kunhuta'] as PersonId[],
        }),
        person('dobromil', 'Dobromil', 'Kvitelka', 'male', {
            birthPlace: 'Mlýnkovice', birthAddress: 'čp. 8', birthDate: '1810', deathPlace: 'Mlýnkovice', deathAddress: 'čp. 8', deathDate: '1874',
        }),
        person('vratislav', 'Vratislav', 'Hejl', 'male', { birthPlace: 'Zálesí', birthDate: '1862' }),
    ];
    return {
        persons: Object.fromEntries(persons.map(p => [p.id, p])) as StromData['persons'],
        partnerships: {
            u1: union('u1', 'svatobor', 'radegunda', ['hostivit'], { startDate: '1830', startPlace: 'Bělokamen', address: 'čp. 9' }),
            u2: union('u2', 'hostivit', 'kunhuta', ['lubor'], { startDate: '1862', startPlace: 'Bělokamen', address: 'čp. 16' }),
        } as StromData['partnerships'],
        houses: { 'belokamen|16': { merged: ['belokamen|9'] } },
    };
}

describe('the Table\'s House column (§15)', () => {
    const model = buildTableModel(village(), { rev: 1, homeId: null, lang: 'cs', year: 2026 });
    const col = columnById('persons', 'house')!;
    const cell = (id: string) => cellOf(model, model.persons.find(r => r.id === id)!, col);

    it('a person\'s birth house: the tree\'s house, the older number faint in brackets, none without a house', () => {
        expect(col).toBeTruthy();
        expect(cell('hostivit')).toMatchObject({ text: 'Bělokamen čp. 16', house: { id: 'belokamen|16', title: 'Bělokamen čp. 16' }, empty: false });
        expect(cell('hostivit').house!.old).toBeUndefined();
        expect(cell('svatobor')).toMatchObject({ text: 'Bělokamen čp. 16 (9)', house: { id: 'belokamen|16', old: '9' } });
        expect(cell('kunhuta').house?.id).toBe('mlynkovice|8');
        expect(cell('vratislav')).toMatchObject({ empty: true, text: '' });
        expect(cell('vratislav').house).toBeUndefined();
    });

    it('sorts by town, then number; the people without a house last', () => {
        const order = sortRows(model, 'persons', model.persons, [{ col: 'house', dir: 'asc' }]).map(r => r.id);
        expect(order.indexOf('hostivit')).toBeLessThan(order.indexOf('kunhuta'));
        expect(order[order.length - 1]).toBe('vratislav');
    });

    it('an event\'s house: a census, a wedding and a death', () => {
        const ev = columnById('events', 'evHouse')!;
        expect(ev).toBeTruthy();
        const of = (pred: (r: typeof model.events[number]) => boolean) => cellOf(model, model.events.find(pred)!, ev);
        expect(of(r => r.event?.id === 'e-host-census').house?.id).toBe('belokamen|16');
        expect(of(r => r.source === 'marriage' && r.union?.id === 'u1')).toMatchObject({ text: 'Bělokamen čp. 16 (9)' });
        expect(of(r => r.source === 'death' && r.persons[0]?.id === 'dobromil').house?.id).toBe('mlynkovice|8');
    });

    it('the cell is a link to the house page with the older number outside it', () => {
        const html = houseLinkHtml({ id: 'belokamen|16', title: 'Bělokamen čp. 16', old: '9' });
        expect(html).toContain('class="tv-house" data-house="belokamen|16"');
        expect(html).toContain('<span class="tv-house-old"> (9)</span>');
        expect(houseLinkHtml({ id: 'a|<1>', title: '<b>' })).not.toContain('<b>');
    });
});
