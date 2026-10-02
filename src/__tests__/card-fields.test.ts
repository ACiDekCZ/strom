/**
 * The custom card's lines (src/card-fields.ts): one per chosen event, in the
 * chosen order, nothing for a detail the person lacks, the baptism or burial
 * standing in, estimates in words. Invented data.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    cardLines, cardDate, normalizeCardFields, customCardSize, DEFAULT_CARD_FIELDS, CardFieldSettings,
} from '../card-fields.js';
import { setLanguage } from '../strings.js';
import { Person, PersonId, Partnership, PartnershipId, StromData } from '../types.js';

const JAN = 'jan' as PersonId;
const MARIE = 'marie' as PersonId;
const U1 = 'u1' as PartnershipId;
const U2 = 'u2' as PartnershipId;

function tree(): StromData {
    const jan: Person = {
        id: JAN, firstName: 'Jan', lastName: 'Vlk', gender: 'male', isPlaceholder: false,
        birthDate: '1862', birthPlace: 'Horní Lhota',
        deathDate: '1919-03-12', deathPlace: 'Horní Lhota', deathCause: 'souchotiny',
        partnerships: [U1, U2], parentIds: [], childIds: [],
        events: [
            { id: 'e1', type: 'occupation', note: 'mlynář' },
            { id: 'e2', type: 'burial', date: '1919-03-15', place: 'Horní Lhota' },
        ],
    };
    const marie: Person = {
        id: MARIE, firstName: 'Marie', lastName: 'Vlková', gender: 'female', isPlaceholder: false,
        deathDate: '>1919', partnerships: [U1], parentIds: [], childIds: [],
        events: [{ id: 'e3', type: 'baptism', date: '1869-02-02', place: 'Dolní Lhota' }],
    };
    const u1: Partnership = { id: U1, person1Id: JAN, person2Id: MARIE, childIds: [], status: 'divorced',
        startDate: '1888-02-14', startPlace: 'Dolní Lhota', endDate: '1900', endPlace: 'Praha', isPrimary: true };
    const u2: Partnership = { id: U2, person1Id: JAN, person2Id: 'x' as PersonId, childIds: [], status: 'married', startDate: '1901' };
    return { persons: { [JAN]: jan, [MARIE]: marie }, partnerships: { [U1]: u1, [U2]: u2 } };
}

const fields = (over: Partial<CardFieldSettings>): CardFieldSettings => normalizeCardFields({ ...DEFAULT_CARD_FIELDS, ...over });
const texts = (p: PersonId, s: CardFieldSettings) => cardLines(tree().persons[p], tree(), s).map(l => `${l.mark} ${l.text}`.trim());

describe('the custom card', () => {
    beforeEach(() => setLanguage('cs'));

    it('starts as the detailed card: birth and death with places, the occupation, years', () => {
        expect(texts(JAN, fields({}))).toEqual(['* 1862 Horní Lhota', '† 1919 Horní Lhota', 'mlynář']);
    });

    it('adds the cause, full dates, and keeps the chosen order', () => {
        const s = fields({ cause: true, fullDate: true, order: ['death', 'birth', 'baptism', 'burial', 'occupation', 'marriage', 'divorce'] });
        expect(texts(JAN, s)).toEqual(['† 12. 3. 1919 Horní Lhota · souchotiny', '* 1862 Horní Lhota', 'mlynář']);
    });

    it('lets the baptism stand in for a missing birth, unless it has a line of its own', () => {
        expect(texts(MARIE, fields({}))[0]).toBe('≈ 1869 Dolní Lhota');
        expect(texts(MARIE, fields({ on: ['birth', 'baptism', 'death'] }))).toEqual(['≈ 1869 Dolní Lhota', '† po 1919']);
        expect(texts(MARIE, fields({ baptismFallback: false }))).toEqual(['† po 1919']);
    });

    it('writes no line for what the person lacks', () => {
        expect(texts(MARIE, fields({ on: ['occupation', 'burial'] }))).toEqual([]);
    });

    it('shows the primary marriage with "+1" for the others, and its divorce only', () => {
        const s = fields({ on: ['marriage', 'divorce'] });
        expect(texts(JAN, s)).toEqual(['⚭ 1888 Dolní Lhota +1', '⚮ 1900 Praha']);
        expect(texts(MARIE, s)).toEqual(['⚭ 1888 Dolní Lhota', '⚮ 1900 Praha']);
    });

    it('leaves the place out where it is not wanted', () => {
        expect(texts(JAN, fields({ place: [] }))).toEqual(['* 1862', '† 1919', 'mlynář']);
    });

    it('says estimates in words and ranges with a dash', () => {
        expect(cardDate('~1855', false)).toBe('kolem 1855');
        expect(cardDate('<1919-03-12', true)).toBe('před 12. 3. 1919');
        expect(cardDate('1850..1855', false)).toBe('1850–1855');
        setLanguage('en');
        expect(cardDate('~1855', false)).toBe('c. 1855');
    });

    it('repairs stored settings and sizes the card by its lines', () => {
        const s = normalizeCardFields({ order: ['death', 'nope' as never], on: ['birth', 'baptism', 'death', 'burial', 'occupation', 'marriage'] });
        expect(s.order).toHaveLength(7);
        expect(s.order[0]).toBe('death');
        expect(s.on).toHaveLength(5);
        expect(customCardSize(3)).toEqual({ cardWidth: 200, cardHeight: 107 });
        expect(customCardSize(5).cardHeight).toBe(141);
    });
});
