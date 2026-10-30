/**
 * "Read a document" (spec 013), the result's view: the transcription's marks,
 * the readers' differing spans, lines on the scan, the entry shown first, the
 * sections a document's kind shows and how a region fits a box.
 * Invented data only (Novák, Lhota).
 */

import { describe, it, expect } from 'vitest';
import {
    parseMarks, parseTranscript, transcriptLines, lineRegion, lineAt, defaultEntryIndex, canPropose,
    sameLanguage, resultSections, glossFlavor, entryName, variantCount, cropLayout,
} from '../read-result.js';
import type { ReadEntry, ReadPerson, ReadResult } from '../research-read.js';

function person(over: Partial<ReadPerson> = {}): ReadPerson {
    return {
        ref: 'p1', role: 'child', roleText: '', given: 'Joannes', surname: 'Novák', written: 'Joannes', sex: 'M',
        age: '', occupation: '', residence: '', uncertain: [], region: null, match: [], ...over,
    };
}

function entry(over: Partial<ReadEntry> = {}): ReadEntry {
    return {
        id: 'e1', page: 1, region: [0.1, 0.2, 0.8, 0.3], transcript: 'Joannes filius', variants: [], translation: '',
        glossary: [], persons: [person()], events: [], relations: [], ...over,
    };
}

function doc(kind: ReadResult['doc']['kind'], language: string[] = ['la']): Pick<ReadResult, 'doc' | 'context'> {
    return { doc: { kind, language, script: '', date: '1846', legible: 'yes', why: null }, context: '' };
}

describe('marks', () => {
    it('makes the word before [?] uncertain', () => {
        expect(parseMarks('Joannes[?] filius')).toEqual([
            { t: 'uncertain', s: 'Joannes' }, { t: 'text', s: ' filius' },
        ]);
    });

    it('makes [...] and […] illegible spots and | a separator', () => {
        expect(parseMarks('domkář [...] z Lhoty | č. 12 […]')).toEqual([
            { t: 'text', s: 'domkář ' }, { t: 'illegible' }, { t: 'text', s: ' z Lhoty' }, { t: 'sep' },
            { t: 'text', s: 'č. 12 ' }, { t: 'illegible' },
        ]);
    });

    it('keeps a lone [?] as a mark without a word', () => {
        expect(parseMarks('[...] [?]')).toEqual([{ t: 'illegible' }, { t: 'text', s: ' ' }, { t: 'uncertain', s: '' }]);
    });

    it('splits lines and drops the empty ones', () => {
        expect(transcriptLines('a\n\n b \nc')).toEqual(['a', ' b', 'c']);
    });
});

describe('transcription', () => {
    it('finds the readers\' differing spans in their lines, each once', () => {
        const parsed = parseTranscript(entry({
            transcript: 'Joannes filius legitimus\nAntonii Novák[?], Lhota 12',
            variants: [{ at: 'Novák[?]', other: 'Nowak' }, { at: 'Lhota', other: 'Lhotka' }],
        }));
        expect(parsed.lines).toHaveLength(2);
        expect(parsed.lines[0].variant).toBe(false);
        expect(parsed.lines[1].variant).toBe(true);
        const segs = parsed.lines[1].segs;
        expect(segs[0]).toEqual({ t: 'text', s: 'Antonii ' });
        expect(segs[1]).toMatchObject({ t: 'variant', a: [{ t: 'uncertain', s: 'Novák' }], b: [{ t: 'text', s: 'Nowak' }] });
        expect(segs[3]).toMatchObject({ t: 'variant', at: 'Lhota', other: 'Lhotka' });
        expect(parsed.marks).toEqual({ uncertain: true, illegible: false, variant: true });
    });

    it('a role, a name field or an event the readers differ in is no text of the line: not lit up there', () => {
        // "other" (a role code) would be found inside "Mother".
        const roleOnly = parseTranscript(entry({ transcript: 'Mother ERIKA MARIA', variants: [{ at: 'other', other: 'writer', field: 'p2.role' }] }));
        expect(roleOnly.lines[0].variant).toBe(false);
        expect(roleOnly.lines[0].segs).toEqual([{ t: 'text', s: 'Mother ERIKA MARIA' }]);
        expect(roleOnly.marks.variant).toBe(false);
        // The transcription's own words (and an older research without a field) still are.
        for (const v of [{ at: 'ERIKA', other: 'ERIKO', field: 'transcript' }, { at: 'ERIKA', other: 'ERIKO' }]) {
            expect(parseTranscript(entry({ transcript: 'Mother ERIKA MARIA', variants: [v] })).lines[0].variant).toBe(true);
        }
    });

    it('says which marks occur (the legend shows only those)', () => {
        expect(parseTranscript(entry({ transcript: 'Anna [...]' })).marks).toEqual({ uncertain: false, illegible: true, variant: false });
        expect(parseTranscript(entry({ transcript: 'Anna Nováková' })).marks).toEqual({ uncertain: false, illegible: false, variant: false });
    });

    it('counts the places that differ over all entries', () => {
        expect(variantCount([entry({ variants: [{ at: 'a', other: 'b' }] }), entry({ variants: [{ at: 'c', other: 'd' }, { at: 'e', other: 'f' }] })])).toBe(3);
    });
});

describe('lines on the scan', () => {
    it('splits the entry\'s region evenly', () => {
        const r = lineRegion([0.1, 0.2, 0.8, 0.4], 1, 4);
        expect(r[0]).toBe(0.1);
        expect(r[1]).toBeCloseTo(0.3);
        expect(r[2]).toBe(0.8);
        expect(r[3]).toBeCloseTo(0.1);
    });

    it('finds the line under a point, -1 outside the region', () => {
        expect(lineAt([0.1, 0.2, 0.8, 0.4], 0.5, 0.21, 4)).toBe(0);
        expect(lineAt([0.1, 0.2, 0.8, 0.4], 0.5, 0.59, 4)).toBe(3);
        expect(lineAt([0.1, 0.2, 0.8, 0.4], 0.5, 0.1, 4)).toBe(-1);
        expect(lineAt([0.1, 0.2, 0.8, 0.4], 0.95, 0.3, 4)).toBe(-1);
    });
});

describe('the entry shown first', () => {
    const entries = [
        entry({ id: 'e1', persons: [person({ given: 'Anna', match: [{ person: 'P9', why: '', score: 0.4 }] })] }),
        entry({ id: 'e2', persons: [person({ given: 'Joannes', match: [{ person: 'P12', why: '', score: 0.9 }] })] }),
    ];
    it('is the one with the dialog\'s person', () => {
        expect(defaultEntryIndex(entries, 'P12')).toBe(1);
    });
    it('is the first without a person or a match', () => {
        expect(defaultEntryIndex(entries, '')).toBe(0);
        expect(defaultEntryIndex(entries, 'P77')).toBe(0);
    });
});

describe('sections by kind', () => {
    it('offers a suggestion only with a person other than mentioned', () => {
        expect(canPropose(entry())).toBe(true);
        expect(canPropose(entry({ persons: [person({ role: 'mentioned' })] }))).toBe(false);
        expect(canPropose(entry({ persons: [] }))).toBe(false);
    });

    it('drops the translation in the app\'s language', () => {
        expect(sameLanguage(['cs'], 'cs')).toBe(true);
        expect(sameLanguage(['de-AT'], 'de')).toBe(true);
        expect(sameLanguage(['la', 'cs'], 'cs')).toBe(false);
        expect(sameLanguage([], 'cs')).toBe(false);
        const e = entry({ translation: 'Jan, syn' });
        expect(resultSections(doc('register.baptism', ['cs']), e, 'cs').translation).toBe(false);
        expect(resultSections(doc('register.baptism', ['la']), e, 'cs').translation).toBe(true);
    });

    it('draws no section without data', () => {
        const s = resultSections(doc('register.baptism'), entry(), 'en');
        expect(s).toMatchObject({ transcript: true, translation: false, gloss: false, about: false, mentioned: false, propose: true });
        const withGloss = resultSections({ ...doc('register.baptism'), context: 'A baptism register.' }, entry(), 'en');
        expect(withGloss).toMatchObject({ gloss: true, about: true });
    });

    it('lists only-mentioned persons as Mentioned, without a suggestion (back of a photo)', () => {
        const s = resultSections(doc('photo.back', ['cs']), entry({ persons: [person({ role: 'mentioned' })] }), 'en');
        expect(s).toMatchObject({ mentioned: true, propose: false });
    });

    it('heads the explanation by kind and names a gravestone\'s text an inscription', () => {
        expect(glossFlavor('register.death')).toBe('terms');
        expect(glossFlavor('certificate')).toBe('terms');
        expect(glossFlavor('gravestone')).toBe('symbols');
        expect(glossFlavor('letter')).toBe('context');
        expect(glossFlavor('photo.back')).toBe('short');
        expect(resultSections(doc('gravestone'), entry(), 'en').inscription).toBe(true);
    });

    it('names an entry by its first person not merely mentioned', () => {
        expect(entryName(entry({ persons: [person({ role: 'mentioned', given: 'Pavel' }), person({ given: 'Anna', surname: 'Nováková' })] }))).toBe('Anna Nováková');
        expect(entryName(entry({ persons: [] }))).toBe('');
    });
});

describe('a region in a box', () => {
    it('fits the whole page without a region', () => {
        const c = cropLayout(null, 400, 200, 0.75);
        expect(c.height).toBeCloseTo(200);
        expect(c.width).toBeCloseTo(150);
        expect(c.left).toBeCloseTo(125);
        expect(c.top).toBeCloseTo(0);
    });

    it('zooms a region so it shows whole, centred and covering the box', () => {
        const c = cropLayout([0.1, 0.4, 0.8, 0.1], 360, 210, 0.75, 0);
        // The region's width fits the box: 0.8 · width = 360.
        expect(c.width).toBeCloseTo(450);
        const regionTop = 0.4 * c.height + c.top;
        const regionBottom = 0.5 * c.height + c.top;
        expect(regionTop).toBeGreaterThanOrEqual(-0.01);
        expect(regionBottom).toBeLessThanOrEqual(210.01);
        expect(c.left).toBeLessThanOrEqual(0);
        expect(c.left + c.width).toBeGreaterThanOrEqual(360);
    });

    it('keeps the sheet over the box at the page\'s edge', () => {
        const c = cropLayout([0, 0, 0.5, 0.1], 300, 100, 1, 0);
        expect(c.left).toBe(0);
        expect(c.top).toBe(0);
    });
});
