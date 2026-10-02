/**
 * The register details of data version 9 survive every way out and back in:
 * GEDCOM export → import, and a JSON file → import. Each field is checked on
 * its own, so a failure names the one that was lost. Ages are kept in the
 * user's words ("75 years"); GEDCOM carries them as AGE 75y. The waiting new
 * version of an approved story is the research's work in progress: copies
 * leaving the app never carry it (stripResearchWork, the GEDCOM exporter).
 */

import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { validateJsonImport } from '../merge/validation.js';
import { validateTreeData } from '../validation.js';
import { applyLivingPrivacy, stripResearchWork } from '../privacy.js';
import { StromData, Person, Partnership, toPersonId, toPartnershipId, STROM_DATA_VERSION } from '../types.js';

const JAN = toPersonId('p_jan');
const ANNA = toPersonId('p_anna');
const UNION = toPartnershipId('u_jan_anna');

function tree(): StromData {
    const jan: Person = {
        id: JAN, firstName: 'Jan', lastName: 'Novak', gender: 'male', isPlaceholder: false,
        partnerships: [UNION], parentIds: [], childIds: [],
        birthDate: '1825-03-14', birthPlace: 'Kolín', birthAddress: 'čp. 12',
        deathDate: '1899-11-02', deathPlace: 'Praha', deathCause: 'zápal plic', deathAge: '75 years', deathAddress: 'Vinohrady 1412',
        events: [
            { id: 'e1', type: 'burial', date: '1899-11-05', place: 'Praha', cause: 'mor', age: '74 years 7 months', address: 'Olšany' },
        ],
        story: {
            status: 'final', text: 'Jan was a carpenter.',
            draft: { title: 'A carpenter in Prague', text: 'Jan worked as a carpenter in Prague.', facts: ['occupation 1870'], note: 'not a source', at: '2026-09-30' },
        },
    };
    const anna: Person = {
        id: ANNA, firstName: 'Anna', lastName: 'Novakova', gender: 'female', isPlaceholder: false,
        partnerships: [UNION], parentIds: [], childIds: [], birthDate: '1830',
    };
    const union: Partnership = {
        id: UNION, person1Id: JAN, person2Id: ANNA, childIds: [], status: 'divorced',
        startDate: '1850-06-02', startPlace: 'Kolín', address: 'čp. 3',
        ages: { [JAN]: '25 years', [ANNA]: '20 years' },
        endDate: '1860', endPlace: 'Praha',
    };
    return { version: STROM_DATA_VERSION, persons: { [JAN]: jan, [ANNA]: anna }, partnerships: { [UNION]: union } };
}

function byName(data: StromData, firstName: string): Person {
    return Object.values(data.persons).find(p => p.firstName === firstName)!;
}

describe('data version 9: register details', () => {
    it('is part of the current version', () => {
        expect(STROM_DATA_VERSION).toBeGreaterThanOrEqual(9);
    });

    describe('GEDCOM export → import', () => {
        const source = tree();
        const back = convertToStrom(parseGedcom(exportToGedcom(source).content)).data;
        const jan = byName(back, 'Jan');
        const anna = byName(back, 'Anna');
        const union = Object.values(back.partnerships)[0];

        it('keeps the person\'s birth house, cause, age and house of the death', () => {
            expect(jan.birthAddress).toBe('čp. 12');
            expect(jan.deathCause).toBe('zápal plic');
            expect(jan.deathAge).toBe('75 years');
            expect(jan.deathAddress).toBe('Vinohrady 1412');
        });

        it('keeps an event\'s cause, age and house', () => {
            const burial = jan.events?.find(e => e.type === 'burial');
            expect(burial?.cause).toBe('mor');
            expect(burial?.age).toBe('74 years 7 months');
            expect(burial?.address).toBe('Olšany');
        });

        it('keeps the wedding house, each partner\'s age and the divorce place', () => {
            expect(union.address).toBe('čp. 3');
            expect(union.ages?.[jan.id]).toBe('25 years');
            expect(union.ages?.[anna.id]).toBe('20 years');
            expect(union.endPlace).toBe('Praha');
            expect(union.status).toBe('divorced');
        });

        it('keeps the approved story; its waiting new version stays with the research (never exported)', () => {
            expect(jan.story?.status).toBe('final');
            expect(jan.story?.text).toBe('Jan was a carpenter.');
            expect(jan.story?.draft).toBeUndefined();
        });

        it('comes back as a valid tree', () => {
            expect(validateTreeData(back).issues.filter(i => i.severity === 'error')).toEqual([]);
        });
    });

    describe('the app\'s own copy (full data): research work stripped, privacy applied', () => {
        const source = tree();
        const copy = applyLivingPrivacy(stripResearchWork(structuredClone(source)), 'full');

        it('keeps every register detail; only the story\'s waiting version stays behind', () => {
            const jan = copy.persons[JAN];
            expect(jan.birthAddress).toBe('čp. 12');
            expect(jan.deathCause).toBe('zápal plic');
            expect(jan.deathAge).toBe('75 years');
            expect(jan.deathAddress).toBe('Vinohrady 1412');
            expect(jan.events).toEqual(source.persons[JAN].events);
            expect(copy.partnerships[UNION]).toEqual(source.partnerships[UNION]);
            expect(jan.story?.text).toBe('Jan was a carpenter.');
            expect(jan.story?.draft).toBeUndefined();
        });
    });

    describe('JSON export → import', () => {
        const source = tree();
        const result = validateJsonImport(JSON.stringify(source));

        it('keeps every person and partnership field as it was', () => {
            expect(result.valid).toBe(true);
            expect(result.data!.persons).toEqual(source.persons);
            expect(result.data!.partnerships).toEqual(source.partnerships);
        });
    });
});
