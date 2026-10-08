/**
 * The custom card's lines (src/card-fields.ts): one per chosen event, in the
 * chosen order, nothing for a detail the person lacks, the baptism or burial
 * standing in, estimates in words. Invented data.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    cardLines, cardDate, normalizeCardFields, customCardSize, DEFAULT_CARD_FIELDS, CardFieldSettings,
    CARD_FIELD_KEYS, cardPreset, matchCardPreset, effectiveCardFields, normalizeCardDensity, isFieldCardDensity, CARD_PRESET_KEYS,
    presetAsCustom, cardTypeForKey,
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

    it('starts as the detailed card: birth and death with places, the age, the occupation, years', () => {
        expect(texts(JAN, fields({}))).toEqual(['* 1862 Horní Lhota', '† 1919 Horní Lhota', 'věk 56', 'mlynář']);
    });

    it('adds the cause, full dates, and keeps the chosen order', () => {
        const s = fields({ cause: true, fullDate: true, order: ['death', 'birth', 'baptism', 'age', 'burial', 'occupation', 'marriage', 'divorce'] });
        expect(texts(JAN, s)).toEqual(['† 12. 3. 1919 Horní Lhota · souchotiny', '* 1862 Horní Lhota', 'věk 56', 'mlynář']);
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
        expect(texts(JAN, fields({ place: [] }))).toEqual(['* 1862', '† 1919', 'věk 56', 'mlynář']);
    });

    it('says estimates in words and ranges with a dash', () => {
        expect(cardDate('~1855', false)).toBe('kolem 1855');
        expect(cardDate('<1919-03-12', true)).toBe('před 12. 3. 1919');
        expect(cardDate('1850..1855', false)).toBe('1850–1855');
        setLanguage('en');
        expect(cardDate('~1855', false)).toBe('c. 1855');
    });

    it('repairs stored settings and sizes the card by its lines, all eight of them', () => {
        const s = normalizeCardFields({ order: ['death', 'nope' as never], on: ['birth', 'baptism', 'death', 'burial', 'occupation', 'marriage'] });
        expect(s.order).toHaveLength(8);
        expect(s.order[0]).toBe('death');
        // No limit: every detail can be on.
        expect(s.on).toEqual(['birth', 'baptism', 'death', 'burial', 'occupation', 'marriage']);
        expect(normalizeCardFields({ on: [...CARD_FIELD_KEYS] }).on).toHaveLength(8);
        expect(customCardSize(3)).toEqual({ cardWidth: 200, cardHeight: 107 });
        expect(customCardSize(5).cardHeight).toBe(141);
        expect(customCardSize(7).cardHeight).toBe(175);
    });
});

describe('the custom card appearance (U02)', () => {
    const LOOK = { style: 'marks', lines: 0, height: 'content', widthCap: 320, years: false };

    it('starts as the brief card: marks, whole details, height by content, medium width, no years', () => {
        expect(DEFAULT_CARD_FIELDS).toMatchObject(LOOK);
        expect(normalizeCardFields(undefined)).toEqual(DEFAULT_CARD_FIELDS);
    });

    it('settings saved before the options existed get their defaults and keep the rest', () => {
        const saved = { order: [...CARD_FIELD_KEYS], on: ['death', 'birth'], place: ['birth'], cause: true,
            baptismFallback: false, burialFallback: true, fullDate: true } as Partial<CardFieldSettings>;
        expect(normalizeCardFields(saved)).toEqual({ ...saved, ...LOOK });
    });

    it('a value it does not know becomes the default; known ones stay', () => {
        const bad = { style: 'bold', lines: 3, height: 'band', widthCap: 500, years: 'yes' } as unknown as Partial<CardFieldSettings>;
        expect(normalizeCardFields(bad)).toMatchObject(LOOK);
        const good = { style: 'labels', lines: 2, height: 'view', widthCap: 240, years: true } as const;
        expect(normalizeCardFields(good)).toMatchObject(good);
        expect(normalizeCardFields({ lines: 1 }).lines).toBe(1);
        expect(normalizeCardFields({ widthCap: 400 }).widthCap).toBe(400);
        expect(normalizeCardFields({ widthCap: '400' as never }).widthCap).toBe(320);
    });
});

describe('card presets (U02)', () => {
    const shown = (s: CardFieldSettings) => s.order.filter(k => s.on.includes(k));

    it('detailed is the default card: birth, death, age, occupation', () => {
        const s = cardPreset('detailed');
        expect(shown(s)).toEqual(['birth', 'death', 'age', 'occupation']);
        expect({ ...s, order: [] }).toEqual({ ...DEFAULT_CARD_FIELDS, order: [] });
        expect(matchCardPreset(DEFAULT_CARD_FIELDS)).toBe('detailed');
        expect(matchCardPreset(normalizeCardFields(undefined))).toBe('detailed');
        expect(s).toMatchObject({ cause: false, fullDate: false, style: 'marks', lines: 0, height: 'content', widthCap: 320, years: false,
            baptismFallback: true, burialFallback: true });
    });

    it('register: the register events with places and the cause, full dates, labels, whole, by content, medium', () => {
        const s = cardPreset('register');
        expect(shown(s)).toEqual(['birth', 'baptism', 'marriage', 'death', 'burial']);
        expect(s).toMatchObject({ cause: true, fullDate: true, style: 'labels', lines: 0, height: 'content', widthCap: 320, years: false,
            baptismFallback: true, burialFallback: true });
        for (const k of ['birth', 'baptism', 'marriage', 'death', 'burial'] as const) expect(s.place).toContain(k);
        // The unticked follow, in the order they had.
        expect(s.order.slice(5)).toEqual(['age', 'occupation', 'divorce']);
        expect(matchCardPreset(s)).toBe('register');
    });

    it('there is no "all" preset any more', () => {
        expect(CARD_PRESET_KEYS).toEqual(['detailed', 'register']);
        const every = normalizeCardFields({ ...cardPreset('register'), on: [...CARD_FIELD_KEYS], widthCap: 400 });
        expect(matchCardPreset(every)).toBeNull();
    });

    it('the unticked details keep their order after the preset\'s', () => {
        const from = normalizeCardFields({ order: ['divorce', 'occupation', 'age', 'burial', 'death', 'marriage', 'baptism', 'birth'] });
        expect(cardPreset('register', from).order).toEqual(['birth', 'baptism', 'marriage', 'death', 'burial', 'divorce', 'occupation', 'age']);
    });

    it('matches on the ticked details in order, their place and cause, the date and the appearance only', () => {
        const reg = cardPreset('register');
        // Ignored: the order of the unticked, places of unticked details, the stand-ins.
        expect(matchCardPreset({ ...reg, order: [...reg.order.slice(0, 5), 'divorce', 'occupation', 'age'] })).toBe('register');
        expect(matchCardPreset({ ...reg, place: reg.place.filter(k => k !== 'divorce') })).toBe('register');
        expect(matchCardPreset({ ...reg, baptismFallback: false, burialFallback: false })).toBe('register');
        const brief = cardPreset('detailed');
        expect(matchCardPreset({ ...brief, place: [...brief.place, 'occupation'] })).toBe('detailed');
        expect(matchCardPreset({ ...brief, place: brief.place.filter(k => k !== 'marriage') })).toBe('detailed');
        // Any of these makes it no preset.
        const off: Partial<CardFieldSettings>[] = [
            { order: ['baptism', 'birth', 'marriage', 'death', 'burial', 'age', 'occupation', 'divorce'] },
            { on: ['birth', 'baptism', 'marriage', 'death'] },
            { on: [...reg.on, 'occupation'] },
            { place: reg.place.filter(k => k !== 'burial') },
            { cause: false }, { fullDate: false }, { style: 'marks' }, { lines: 1 }, { lines: 2 },
            { height: 'view' }, { widthCap: 400 }, { years: true },
        ];
        for (const o of off) expect(matchCardPreset({ ...reg, ...o }), JSON.stringify(o)).toBeNull();
        expect(matchCardPreset({ ...brief, widthCap: 240 })).toBeNull();
        expect(matchCardPreset({ ...brief, lines: 1, height: 'view' })).toBeNull();
    });
});

describe('the age line (U03a)', () => {
    beforeEach(() => setLanguage('cs'));
    const ageOnly = (over: Partial<CardFieldSettings> = {}) => fields({ on: ['age'], ...over });

    it('comes right after the death in the default order, with no mark and no place', () => {
        expect(CARD_FIELD_KEYS).toEqual(['birth', 'baptism', 'death', 'age', 'burial', 'occupation', 'marriage', 'divorce']);
        const [line] = cardLines(tree().persons[JAN], tree(), ageOnly({ place: [...CARD_FIELD_KEYS] }));
        expect(line).toMatchObject({ key: 'age', mark: '', date: '', text: 'věk 56', rest: 'věk 56', wide: true, spoken: 'věk 56', label: 'Věk' });
        expect(line.place).toBeUndefined();
    });

    it('in the labels style is the number under the word "Age"', () => {
        const [line] = cardLines(tree().persons[JAN], tree(), ageOnly({ style: 'labels' }));
        expect(line).toMatchObject({ label: 'Věk', rest: '56', text: '56', spoken: 'věk 56' });
        setLanguage('en');
        expect(cardLines(tree().persons[JAN], tree(), ageOnly({ style: 'labels' }))[0].label).toBe('Age');
        setLanguage('de');
        expect(cardLines(tree().persons[JAN], tree(), ageOnly())[0].text).toBe('Alter 56');
    });

    it('is not drawn without a birth date', () => {
        // Marie has a baptism and "after 1919" only.
        expect(cardLines(tree().persons[MARIE], tree(), ageOnly())).toEqual([]);
        const noBirth = { ...tree().persons[JAN], birthDate: undefined };
        expect(cardLines(noBirth, tree(), ageOnly())).toEqual([]);
    });

    it('old saved Custom settings get the age into the order after the death, but off', () => {
        const old = normalizeCardFields({ order: ['birth', 'baptism', 'death', 'burial', 'occupation', 'marriage', 'divorce'] as never,
            on: ['birth', 'death', 'occupation'] });
        expect(old.order).toEqual(['birth', 'baptism', 'death', 'age', 'burial', 'occupation', 'marriage', 'divorce']);
        expect(old.on).toEqual(['birth', 'death', 'occupation']);
        expect(texts(JAN, old)).toEqual(['* 1862 Horní Lhota', '† 1919 Horní Lhota', 'mlynář']);
        // An order without the death: the age goes to its end.
        expect(normalizeCardFields({ order: ['occupation', 'birth'] as never, on: [] }).order.slice(0, 3)).toEqual(['occupation', 'birth', 'age']);
    });
});

describe('card types (U03a)', () => {
    const stored = normalizeCardFields({ on: ['marriage'], style: 'labels', widthCap: 400 });

    it('an unknown stored type is the Normal card; every known one stays', () => {
        for (const v of [undefined, null, 'all', 'brief', 'DETAILED', 3]) expect(normalizeCardDensity(v)).toBe('normal');
        for (const v of ['compact', 'normal', 'detailed', 'register', 'custom'] as const) expect(normalizeCardDensity(v)).toBe(v);
    });

    it('Detailed and Register draw their preset fields, never the stored Custom ones', () => {
        expect(effectiveCardFields('detailed', stored)).toEqual(cardPreset('detailed'));
        expect(effectiveCardFields('register', stored)).toEqual(cardPreset('register'));
        expect(effectiveCardFields('custom', stored)).toEqual(stored);
        expect(effectiveCardFields('custom', undefined)).toEqual(DEFAULT_CARD_FIELDS);
        expect(effectiveCardFields('compact', stored)).toBeNull();
        expect(effectiveCardFields('normal', stored)).toBeNull();
    });

    it('cards of details are Detailed, Register and Custom', () => {
        expect((['compact', 'normal', 'detailed', 'register', 'custom'] as const).filter(isFieldCardDensity))
            .toEqual(['detailed', 'register', 'custom']);
    });
});

describe('the row of card types (Settings)', () => {
    it('"Edit as Custom": the preset\'s settings, the unticked details in their old order; restorable unless already the preset', () => {
        const mine = normalizeCardFields({ on: ['marriage'], order: ['divorce', 'occupation', 'marriage'], style: 'labels', widthCap: 400 });
        const { fields, restorable } = presetAsCustom('register', mine);
        expect(fields).toEqual(cardPreset('register', mine));
        expect(matchCardPreset(fields)).toBe('register');
        expect(fields.order.slice(5)).toEqual(['divorce', 'occupation', 'age']);
        expect(restorable).toBe(true);
        // Already the preset: nothing worth bringing back; another preset is.
        expect(presetAsCustom('register', fields).restorable).toBe(false);
        expect(presetAsCustom('detailed', fields).restorable).toBe(true);
        expect(presetAsCustom('detailed', DEFAULT_CARD_FIELDS).restorable).toBe(false);
    });

    it('the arrows step through the types and wrap; Home and End; other keys do nothing', () => {
        expect(cardTypeForKey('normal', 'ArrowRight')).toBe('detailed');
        expect(cardTypeForKey('normal', 'ArrowDown')).toBe('detailed');
        expect(cardTypeForKey('normal', 'ArrowLeft')).toBe('compact');
        expect(cardTypeForKey('normal', 'ArrowUp')).toBe('compact');
        expect(cardTypeForKey('custom', 'ArrowRight')).toBe('compact');
        expect(cardTypeForKey('compact', 'ArrowLeft')).toBe('custom');
        expect(cardTypeForKey('register', 'Home')).toBe('compact');
        expect(cardTypeForKey('register', 'End')).toBe('custom');
        expect(cardTypeForKey('register', 'Enter')).toBeNull();
        expect(cardTypeForKey('register', 'a')).toBeNull();
    });
});
