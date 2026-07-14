/**
 * CSV person-table export: escaping, header language, relative resolution.
 */

import { describe, it, expect } from 'vitest';
import { buildPersonsCsv } from '../csv-export.js';
import { initLanguage } from '../strings.js';
import { StromData, Person, PersonId, PartnershipId, Gender } from '../types.js';

function person(id: string, first: string, last: string, o: Partial<Person> = {}): Person {
    return {
        id: id as PersonId, firstName: first, lastName: last,
        gender: (o.gender as Gender) ?? 'male', isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [], ...o,
    };
}

const FAMILY: StromData = {
    persons: {
        ['f' as PersonId]: person('f', 'Jan', 'Novák', { childIds: ['c' as PersonId], partnerships: ['u1' as PartnershipId] }),
        ['m' as PersonId]: person('m', 'Eva', 'Nováková', { gender: 'female', childIds: ['c' as PersonId], partnerships: ['u1' as PartnershipId] }),
        ['c' as PersonId]: person('c', 'Petr', 'Novák', {
            parentIds: ['f' as PersonId, 'm' as PersonId],
            birthDate: '~1900', notes: 'Line1\n"quoted"; semicolon',
        }),
    },
    partnerships: {
        ['u1' as PartnershipId]: {
            id: 'u1' as PartnershipId, person1Id: 'f' as PersonId, person2Id: 'm' as PersonId,
            childIds: ['c' as PersonId], status: 'married',
        },
    },
};

describe('buildPersonsCsv', () => {
    it('resolves father/mother/partners and escapes special characters', () => {
        initLanguage('en');
        const csv = buildPersonsCsv(FAMILY);
        const lines = csv.split('\r\n');
        expect(lines[0]).toContain('First name;Last name;Gender');
        const petr = lines.find(l => l.startsWith('Petr'))!;
        expect(petr).toContain('Jan Novák');       // father
        expect(petr).toContain('Eva Nováková');    // mother
        expect(petr).toContain('~1900');
        expect(petr).toContain('"Line1\n""quoted""; semicolon"');
        const jan = lines.find(l => l.startsWith('Jan'))!;
        expect(jan).toContain('Eva Nováková');     // partner
    });

    it('localizes headers and gender in Czech, with a BOM for Excel', () => {
        initLanguage('cs');
        const csv = buildPersonsCsv(FAMILY);
        expect(csv.charCodeAt(0)).toBe(0xFEFF);
        expect(csv).toContain('Jméno;Příjmení;Pohlaví');
        expect(csv).toContain('Žena');
        initLanguage('en');
    });

    it('skips placeholders', () => {
        const d: StromData = {
            persons: {
                ['a' as PersonId]: person('a', 'Real', 'Person'),
                ['ph' as PersonId]: { ...person('ph', '?', ''), isPlaceholder: true },
            },
            partnerships: {},
        };
        const csv = buildPersonsCsv(d);
        expect(csv).toContain('Real');
        expect(csv.split('\r\n')).toHaveLength(2);  // header + 1 person
    });
});
