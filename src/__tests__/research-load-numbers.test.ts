/**
 * "Load the research version?": a source whose place the research's version
 * only adds a number to (an image or a folio it lacked here, the location the
 * same) is one sentence of the dialog, not a row "here → from research" at
 * every citation of it. A location changed is still a row at each citation.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { diffValues, placeNumberAdded } from '../research-changes.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { stabilizeIds } from '../research-link.js';
import { setLanguage, getStringsForLang } from '../strings.js';
import { STROM_DATA_VERSION, type Source, type StromData } from '../types.js';

beforeAll(() => setLanguage('cs'));

/** Two people citing source s1 (at the birth and at an occupation), s2 at the death; the sources as given. */
function tree(s1: Partial<Source>, s2: Partial<Source> = { reference: 's. 7' }): StromData {
    return {
        version: STROM_DATA_VERSION,
        persons: {
            p1: {
                id: 'p1', firstName: 'Ludmila', lastName: 'Vzorová', gender: 'female', isPlaceholder: false,
                partnerships: [], parentIds: [], childIds: [], birthDate: '1865-02-03', birthSourceIds: ['s1'],
                events: [{ id: 'e1', type: 'occupation', note: 'švadlena', sourceIds: ['s1'] }],
            },
            p2: {
                id: 'p2', firstName: 'Otakar', lastName: 'Vzor', gender: 'male', isPlaceholder: false,
                partnerships: [], parentIds: [], childIds: [], deathDate: '1901', deathSourceIds: ['s2'], sourceIds: ['s1'],
            },
        },
        partnerships: {},
        sources: {
            s1: { id: 's1', title: 'Křty Vzorov', ...s1 },
            s2: { id: 's2', title: 'Zemřelí Vzorov', ...s2 },
        },
    } as unknown as StromData;
}

const citationRows = (here: StromData, there: StromData) => diffValues(here, there).rows.filter(r => r.field === 'citation');

describe('a number added to a source\'s place: a sentence, no rows', () => {
    it('the location the same, the image \'\' → \'51\': no row, the sentence once', () => {
        const here = tree({ reference: 'pag. 110, 2. zápis' });
        const there = tree({ reference: 'pag. 110, 2. zápis', image: '51' });
        const d = diffValues(here, there);
        expect(d.rows).toEqual([]);
        expect(d.numbersAdded).toEqual({ image: 1, folio: 0 });
        expect(d.addedFacts).toBe(0);
    });

    it('the image found from the scans, the location naming an index\'s image: the same, no row', () => {
        const here = tree({ reference: 'č. 12; rejstřík obr. 70 Lit. C' });
        const there = tree({ reference: 'č. 12; rejstřík obr. 70 Lit. C', image: '35', imageDerived: true });
        expect(citationRows(here, there)).toEqual([]);
        expect(diffValues(here, there).numbersAdded.image).toBe(1);
        // an older research (no mark) likewise: the location as written is the same
        const older = tree({ reference: 'č. 12; rejstřík obr. 70 Lit. C', image: '35' });
        expect(citationRows(here, older)).toEqual([]);
    });

    it('a folio added (split out of the location, the page reads the same): no row, the folio\'s sentence', () => {
        const here = tree({ reference: 'fol. 49, 3. zápis' });
        const there = tree({ folio: 'fol. 49', reference: '3. zápis' });
        expect(placeNumberAdded(here.sources!.s1, there.sources!.s1)).toEqual({ image: false, folio: true });
        const d = diffValues(here, there);
        expect(d.rows).toEqual([]);
        expect(d.numbersAdded).toEqual({ image: 0, folio: 1 });
        // with the image beside it: both counted
        const both = tree({ folio: 'fol. 49', reference: '3. zápis', image: '51' });
        expect(diffValues(here, both).numbersAdded).toEqual({ image: 1, folio: 1 });
        expect(diffValues(here, both).rows).toEqual([]);
    });

    it('the location changed: a row at every citation as before', () => {
        const here = tree({ reference: 'pag. 110, 2. zápis' });
        const moved = tree({ reference: 'pag. 111, 2. zápis' });
        expect(citationRows(here, moved).map(r => r.of).sort()).toEqual(['birth', 'occupation', 'person']);
        expect(diffValues(here, moved).numbersAdded).toEqual({ image: 0, folio: 0 });
    });

    it('the image added and the location changed: rows as before, no sentence', () => {
        const here = tree({ reference: 'pag. 110, 2. zápis' });
        const there = tree({ reference: 'pag. 111, 2. zápis', image: '51' });
        expect(citationRows(here, there)).toHaveLength(3);
        expect(diffValues(here, there).numbersAdded).toEqual({ image: 0, folio: 0 });
    });

    it('an image changed or taken away is no number added: rows', () => {
        expect(citationRows(tree({ reference: 'č. 5', image: '50' }), tree({ reference: 'č. 5', image: '51' }))).toHaveLength(3);
        expect(citationRows(tree({ reference: 'č. 5', image: '50' }), tree({ reference: 'č. 5' }))).toHaveLength(3);
        expect(placeNumberAdded({ id: 's', title: 'x', callNumber: 'N 7' }, { id: 's', title: 'x', callNumber: 'N 8', image: '3' })).toBeNull();
    });

    it('the same place: nothing at all', () => {
        const here = tree({ reference: 'č. 5', image: '51' });
        expect(diffValues(here, tree({ reference: 'č. 5', image: '51' })).numbersAdded).toEqual({ image: 0, folio: 0 });
    });
});

describe('read from the research\'s files: an older one (PAGE only) and one with the image from the scans', () => {
    const ged = (image: boolean): string => [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '2 VERS 1.36.0', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME Ludmila /Vzorová/', '1 SEX F', '1 REFN P0001',
        '1 BIRT', '2 DATE 3 FEB 1865', '2 SOUR @S1@', '3 PAGE fol. 49, 3. zápis (prosinec 1869)',
        '1 OCCU švadlena', '2 SOUR @S1@', '3 PAGE fol. 49, 3. zápis (prosinec 1869)',
        '0 @S1@ SOUR', '1 TITL Křty Vzorov', '1 PAGE fol. 49, 3. zápis (prosinec 1869)',
        ...(image ? ['1 _STROM_IMAGE 51', '2 _STROM_DERIVED Y', '1 _STROM_LOCATOR fol. 49, 3. zápis (prosinec 1869)'] : []),
        '1 REFN S0173', '0 TRLR',
    ].join('\n');
    const read = (text: string): StromData => convertToStrom(parseGedcom(text)).data;

    it('the image coming: no citation row, one source in the sentence', () => {
        const before = read(ged(false));
        const after = stabilizeIds(read(ged(true)), before);
        const d = diffValues(before, after);
        expect(d.rows).toEqual([]);
        expect(d.numbersAdded).toEqual({ image: 1, folio: 0 });
    });
});

describe('the sentence in every language', () => {
    it('says the count and no address of the user', () => {
        for (const lang of ['cs', 'en', 'de', 'pl'] as const) {
            const s = getStringsForLang(lang).sync;
            for (const n of [1, 3, 125]) {
                expect(s.loadImageNumbers(n)).toContain(String(n));
                expect(s.loadFolioNumbers(n)).toContain(String(n));
            }
        }
        expect(getStringsForLang('cs').sync.loadImageNumbers(1)).toBe('U 1 pramene přibylo číslo snímku.');
        expect(getStringsForLang('cs').sync.loadImageNumbers(125)).toBe('U 125 pramenů přibylo číslo snímku.');
        expect(getStringsForLang('en').sync.loadImageNumbers(1)).toBe('Image number added in 1 source.');
    });
});
