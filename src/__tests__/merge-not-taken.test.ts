/**
 * What the tree does not take over from a GEDCOM file (spec 134 K1.2, §3
 * tests): each kind of line with how many and an example ("Name: value"),
 * MyHeritage's bookkeeping (`_UPD`, `_PHOTO_RIN`) not counted; and step 1's
 * line saying it in every language for 1, 2 and 5 lines.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { parseGedcom, convertToStrom, GedcomDroppedTag } from '../ged-parser.js';
import { notTakenLine, NOT_TAKEN_SHOWN } from '../merge/wizard-text.js';
import { setLanguage } from '../strings.js';

const ged = (...records: string[][]): string => [
    '0 HEAD', '1 SOUR MYHERITAGE', '2 NAME MyHeritage Family Tree Builder', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
    ...records.flat(), '0 TRLR',
].join('\n');

const dropped = (text: string): GedcomDroppedTag[] => convertToStrom(parseGedcom(text)).stats.droppedTags;
const byTag = (list: GedcomDroppedTag[]): Record<string, GedcomDroppedTag> => Object.fromEntries(list.map(d => [d.tag, d]));

describe('droppedTags of a GEDCOM file', () => {
    const file = ged(
        ['0 @I1@ INDI', '1 NAME Velemír /Modřín/', '1 SEX M', '1 _UPD 12 MAR 2020 10:00:00 GMT -0500',
            '1 FOOX Mlýn v Křemenné', '1 BIRT', '2 DATE 1850', '2 PLAC Lipová',
            '1 OBJE', '2 FILE https://example.invalid/modřín.jpg', '2 FORM jpg', '2 _PHOTO_RIN MH:P1', '2 _FILESIZE 1234',
            '1 _ZZQ kovář v Mechové'],
        ['0 @I2@ INDI', '1 NAME Hostivít /Jilm/', '1 SEX M', '1 FOOX Hájovna', '1 _UPD 12 MAR 2020',
            '1 OBJE', '2 FILE https://example.invalid/jilm.jpg', '2 _PHOTO_RIN MH:P2'],
    );

    it('names each unknown kind of line with its count and the first value under the person’s name', () => {
        const tags = byTag(dropped(file));
        expect(tags.FOOX).toEqual({ tag: 'FOOX', count: 2, example: 'Velemír Modřín: Mlýn v Křemenné' });
        // Another program's own tag, with the person it was under (not the next person's line).
        expect(tags._ZZQ).toMatchObject({ count: 1, example: 'Velemír Modřín: kovář v Mechové' });
    });

    it('does not count MyHeritage’s bookkeeping (_UPD, _PHOTO_RIN, _FILESIZE)', () => {
        const tags = byTag(dropped(file));
        expect(tags._UPD).toBeUndefined();
        expect(tags._PHOTO_RIN).toBeUndefined();
        expect(tags._FILESIZE).toBeUndefined();
    });

    it('lists the kinds most frequent first and nothing for a file the tree takes over whole', () => {
        const list = dropped(file);
        expect(list[0].tag).toBe('FOOX');
        expect(dropped(ged(['0 @I1@ INDI', '1 NAME Hostivít /Jilm/', '1 SEX M', '1 BIRT', '2 DATE 1820', '1 _UPD 1 JAN 2021']))).toEqual([]);
    });

    it('an unknown line outside a person has its value alone as the example', () => {
        const tags = byTag(dropped(ged(['0 @F1@ FAM', '1 FOOX Svatba v Křemenné'])));
        expect(tags.FOOX?.example).toBe('Svatba v Křemenné');
    });
});

describe('notTakenLine (step 1)', () => {
    afterEach(() => setLanguage('en'));

    const line = (n: number): GedcomDroppedTag[] => [{ tag: 'FOOX', count: n, example: 'Velemír Modřín: Mlýn' }];

    it('is empty when the tree takes over everything', () => {
        expect(notTakenLine(null)).toBe('');
        expect(notTakenLine({ droppedTags: [] })).toBe('');
        expect(notTakenLine({ droppedTags: [{ tag: 'FOOX', count: 0, example: '' }] })).toBe('');
    });

    const expected: Record<'en' | 'cs' | 'de' | 'pl', (n: number) => string> = {
        en: n => `The tree will not take over: FOOX (${n}×, e.g. “Velemír Modřín: Mlýn”).`,
        cs: n => `Strom nepřevezme: FOOX (${n}×, např. „Velemír Modřín: Mlýn“).`,
        de: n => `Nicht übernommen wird: FOOX (${n}×, z. B. „Velemír Modřín: Mlýn“).`,
        pl: n => `Drzewo nie przejmie: FOOX (${n}×, np. „Velemír Modřín: Mlýn”).`,
    };
    for (const lang of ['en', 'cs', 'de', 'pl'] as const) {
        it(`says 1, 2 and 5 lines in ${lang}`, () => {
            setLanguage(lang);
            for (const n of [1, 2, 5]) expect(notTakenLine({ droppedTags: line(n) })).toBe(expected[lang](n));
        });
    }

    it('names at most three kinds, the rest as “…”; a kind without an example has none', () => {
        const many: GedcomDroppedTag[] = ['FOOA', 'FOOB', 'FOOC', 'FOOD'].map((tag, i) => ({ tag, count: 5 - i, example: i === 1 ? '' : `v${i}` }));
        expect(NOT_TAKEN_SHOWN).toBe(3);
        expect(notTakenLine({ droppedTags: many })).toBe('The tree will not take over: FOOA (5×, e.g. “v0”), FOOB (4×), FOOC (3×, e.g. “v2”), ….');
        expect(notTakenLine({ droppedTags: [{ tag: 'FOOX', count: 2, example: '', label: 'Custom fact' }] })).toBe('The tree will not take over: Custom fact (2×).');
    });
});
