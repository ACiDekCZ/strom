/**
 * Where an entry stands, field by field (spec 075 U3 §5, src/source-location.ts).
 * The research's shared cases (test/fixtures/source-locations.json, a copy of
 * strom-research/test/fixtures/source-locations.json, 1.31) are the contract
 * of recognition: every case gives what the research's code gives.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
    composePage, hasPlaceFields, locatorOverlap, recognizeLocation, sourceEntryText, sourcePlaceKey, sourcePlaceLine,
    sourcePlaceParts, sourcePlaceSearchText, splitSource, withSplit,
} from '../source-location.js';
import { setLanguage } from '../strings.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const CASES_FILE = join(root, 'test', 'fixtures', 'source-locations.json');
const CASES = JSON.parse(readFileSync(CASES_FILE, 'utf8')) as { locator: string; lang: string; folio: string | null; image: string | null; rest: string | null; why?: string }[];

beforeAll(() => setLanguage('cs'));

describe('the research\'s shared cases (test/fixtures/source-locations.json)', () => {
    it('has all of them: cs, en, de, pl, another script, NFD, the edition\'s two pages', () => {
        expect(CASES.length).toBe(38);
        for (const lang of ['cs', 'en', 'de', 'pl']) expect(CASES.some(c => c.lang === lang), lang).toBe(true);
        expect(CASES.some(c => c.locator !== c.locator.normalize('NFC'))).toBe(true);
    });

    it('every one recognised as the table says, its rest too, and the split of a source without fields the same', () => {
        for (const c of CASES) {
            const found = recognizeLocation(c.locator);
            expect([found?.folio ?? null, found?.image ?? null], c.locator).toEqual([c.folio, c.image]);
            expect(found ? found.rest || null : null, c.locator).toBe(c.rest);
            if (found?.rest) expect(found.rest).toBe(found.rest.normalize('NFC'));
            const split = splitSource({ reference: c.locator });
            const expected = c.folio || c.image
                ? { ...(c.rest ? { reference: c.rest } : {}), ...(c.folio ? { folio: c.folio } : {}), ...(c.image ? { image: c.image } : {}) }
                : null;
            expect(split ?? null, c.locator).toEqual(expected);
        }
    });
});

// Development only: the copy must stay byte-identical to the research's
// file. CI has no research checkout next to the app, so it skips.
const research = join(root, '..', 'strom-research', 'test', 'fixtures', 'source-locations.json');
describe.skipIf(!existsSync(research))('the copy of the research\'s cases', () => {
    it('is byte-identical to ../strom-research', () => {
        expect(readFileSync(CASES_FILE).equals(readFileSync(research)),
            'test/fixtures/source-locations.json differs from strom-research/test/fixtures/source-locations.json').toBe(true);
    });
});

describe('recognizeLocation', () => {
    it('null for nothing recognised, empty or absent', () => {
        expect(recognizeLocation('č. 3, řádek 2')).toBeNull();
        expect(recognizeLocation('')).toBeNull();
        expect(recognizeLocation(undefined)).toBeNull();
    });

    it('given a source: what of its location its fields say too (the editor\'s conflict)', () => {
        const r = recognizeLocation({ reference: 'fol. 12, snímek 3', image: '4' });
        expect(r?.overlap).toEqual({ image: { named: '3', same: false }, rest: 'fol. 12' });
        expect(recognizeLocation({ reference: 'fol. 12, č. 5', folio: 'f. 12' })?.overlap?.folio).toEqual({ named: 'fol. 12', same: true });
        expect(recognizeLocation({ reference: 'fol. 12, snímek 3' })?.overlap).toBeUndefined();
    });
});

describe('composePage (the research\'s composedPage, N1)', () => {
    it('an older source: its reference exactly', () => {
        expect(composePage({ reference: 'fol. 12, č. 3' }, 'cs')).toBe('fol. 12, č. 3');
        expect(composePage({ reference: '  fol. 12  ' }, 'cs')).toBe('  fol. 12  ');
        expect(composePage({}, 'cs')).toBeUndefined();
    });

    it('the folio, the rest, the image in the app\'s language', () => {
        expect(composePage({ folio: 'pag. 112', reference: 'č. 3', image: '57' }, 'cs')).toBe('pag. 112, č. 3, snímek 57');
        expect(composePage({ folio: 'fol. 12v', image: '34' }, 'en')).toBe('fol. 12v, image 34');
        expect(composePage({ image: '7' }, 'de')).toBe('Bild 7');
        expect(composePage({ image: '7' }, 'pl')).toBe('skan 7');
        expect(composePage({ folio: 'strona 40' }, 'pl')).toBe('strona 40');
        expect(composePage({ folio: 'pag. 112', reference: 'pag. 112, č. 3' }, 'cs')).toBe('pag. 112, č. 3');
    });

    it('one number of an image and a folio: the same as the reference says it, another the field\'s; the reference unchanged', () => {
        expect(composePage({ reference: 'fol. 12, snímek 3', image: '4' }, 'cs')).toBe('fol. 12, snímek 4');
        expect(composePage({ reference: 'fol. 12, snímek 3', image: '3' }, 'cs')).toBe('fol. 12, snímek 3');
        expect(composePage({ reference: 'f. 9, scan 101', image: '101' }, 'cs')).toBe('f. 9, scan 101');
        expect(composePage({ reference: 'f. 9, scan 101', image: '102' }, 'cs')).toBe('f. 9, snímek 102');
        expect(composePage({ reference: 'Taufe Nr. 5, snímek 34', image: '35' }, 'de')).toBe('Taufe Nr. 5, Bild 35');
        expect(composePage({ reference: 'entry 4, Bild 7–8', image: '7-8' }, 'en')).toBe('entry 4, Bild 7–8');
        expect(composePage({ reference: 'entry 4 (img. 7)', image: '9' }, 'en')).toBe('entry 4, image 9');
        expect(composePage({ reference: 'fol. 12, č. 5', folio: 'f. 12' }, 'cs')).toBe('fol. 12, č. 5');
        expect(composePage({ reference: 'fol. 12, č. 5', folio: 'fol. 13' }, 'cs')).toBe('fol. 13, č. 5');
        expect(composePage({ reference: 'fol. 12, č. 5', folio: 'fol. 1' }, 'cs')).toBe('fol. 1, č. 5');
        expect(composePage({ reference: 'č. 12', folio: '12' }, 'cs')).toBe('12, č. 12');
        expect(composePage({ reference: 'лист 3, kadr 9', image: '10' }, 'cs')).toBe('лист 3, snímek 10');
    });
});

describe('splitSource (§5: the folio only when the field is missing, the image the same)', () => {
    it('a field given stays; the same part named is taken out; another stays in the location', () => {
        // the folio is a field already: only the image is taken
        expect(splitSource({ reference: 'fol. 12, č. 5, snímek 34', folio: 'fol. 12' }))
            .toEqual({ reference: 'č. 5', folio: 'fol. 12', image: '34' });
        // the image field says another number: the location keeps its own (the person's)
        expect(splitSource({ reference: 'fol. 12, snímek 3', image: '4' }))
            .toEqual({ reference: 'snímek 3', folio: 'fol. 12', image: '4' });
        // everything taken: no location left
        expect(splitSource({ reference: 'str. 9, obr. 16' })).toEqual({ folio: 'str. 9', image: '16' });
        expect(splitSource({ reference: 'č. 8' })).toBeUndefined();
        expect(splitSource({ reference: 'fol. 12', folio: 'fol. 12' })).toEqual({ folio: 'fol. 12' });
        expect(splitSource({ reference: 'č. 5', folio: 'fol. 12', image: '3' })).toBeUndefined();
        expect(splitSource({ folio: 'fol. 12' })).toBeUndefined();
    });

    it('withSplit: the other fields kept, an empty location removed', () => {
        const s = { id: 's1', title: 'Křty', repository: 'Zemský archiv Vzorov', callNumber: 'N 7', reference: 'str. 9, obr. 16' };
        const out = withSplit(s, splitSource(s)!);
        expect(out).toEqual({ id: 's1', title: 'Křty', repository: 'Zemský archiv Vzorov', callNumber: 'N 7', folio: 'str. 9', image: '16' });
        expect('reference' in out).toBe(false);
    });
});

describe('the place shown', () => {
    const s = { repository: 'Zemský archiv Vzorov', callNumber: 'N 7', folio: 'fol. 12v', image: '34', reference: 'č. 5' };
    const old = { repository: 'Zemský archiv Vzorov', reference: 'fol. 12v, č. 5, snímek 34' };

    it('sourcePlaceParts: the book and the entry; an older source whole', () => {
        expect(sourcePlaceParts(s, 'cs')).toEqual({ book: ['Zemský archiv Vzorov', 'N 7'], entry: ['fol. 12v', 'snímek 34', 'č. 5'] });
        expect(sourcePlaceParts(old, 'cs')).toEqual({ book: ['Zemský archiv Vzorov'], entry: [], whole: 'fol. 12v, č. 5, snímek 34' });
        expect(sourcePlaceParts({}, 'cs')).toEqual({ book: [], entry: [] });
        expect(sourceEntryText(s, ', ', 'en')).toBe('fol. 12v, image 34, č. 5');
        expect(sourceEntryText(old)).toBe('fol. 12v, č. 5, snímek 34');
    });

    it('sourcePlaceLine long, short, list-phone, in four languages; nothing undefined', () => {
        expect(sourcePlaceLine(s, 'long', 'cs')).toBe('Zemský archiv Vzorov · N 7 · fol. 12v · snímek 34 · č. 5');
        expect(sourcePlaceLine(s, 'short', 'cs')).toBe('Zemský archiv Vzorov · N 7 · fol. 12v · sn. 34');
        expect(sourcePlaceLine(s, 'list-phone', 'cs')).toBe('N 7 · fol. 12v · sn. 34');
        expect(sourcePlaceLine(s, 'short', 'en')).toBe('Zemský archiv Vzorov · N 7 · fol. 12v · img. 34');
        expect(sourcePlaceLine(s, 'long', 'de')).toBe('Zemský archiv Vzorov · N 7 · fol. 12v · Bild 34 · č. 5');
        expect(sourcePlaceLine(s, 'short', 'pl')).toBe('Zemský archiv Vzorov · N 7 · fol. 12v · skan 34');
        expect(sourcePlaceLine({ repository: 'Zemský archiv Vzorov', image: '34' }, 'list-phone', 'cs')).toBe('Zemský archiv Vzorov · sn. 34');
        for (const form of ['long', 'short', 'list-phone'] as const) {
            expect(sourcePlaceLine(old, form, 'cs')).toBe('Zemský archiv Vzorov · fol. 12v, č. 5, snímek 34');
            expect(sourcePlaceLine({}, form, 'cs')).toBe('');
            expect(sourcePlaceLine({ folio: 'fol. 3' }, form, 'cs')).not.toContain('undefined');
        }
    });

    it('the search text, the key of the place, which sources have fields', () => {
        expect(sourcePlaceSearchText(s)).toContain('N 7');
        expect(sourcePlaceSearchText(s)).toContain('34');
        expect(sourcePlaceKey({ folio: 'fol. 12v', image: '34', reference: 'č. 5' }, 'cs')).toBe(sourcePlaceKey({ reference: 'fol. 12v, č. 5, snímek 34' }, 'cs'));
        expect(hasPlaceFields(old)).toBe(false);
        expect(hasPlaceFields({ callNumber: 'N 7' })).toBe(true);
        expect(hasPlaceFields({ folio: '  ' })).toBe(false);
    });
});

/**
 * Recognition and taking out at a text's edges: an emoji, a decomposed letter
 * (NFD) and CJK right beside a part — the part taken out and the rest lose no
 * other text than the separators.
 */
describe('fuzz: emoji, combining marks and CJK at the edges', () => {
    // A small deterministic generator (no flaky seeds).
    let seed = 0x2f6b;
    const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const pick = <T>(xs: readonly T[]): T => xs[rnd(xs.length)];
    const EDGES = ['🙂', '👨‍👩‍👧', '漢字', 'é'.normalize('NFD'), 'Ř'.normalize('NFD'), 'č. 5', 'zápis 3', '名簿', 'ẞ', ''];
    const SEPS = [', ', '; ', ' · ', ' = ', ' — ', ' (', ') '];
    const PARTS = ['fol. 12v', 'pag. 7', 'S. 15', 'snímek 34', 'scan 9', 'Bild 7–8', 'skan nr 3', 'obr. 16'];
    const letters = (t: string): string => t.normalize('NFC').replace(/[\s,;:·=()[\]–—-]+/gu, '');

    it('what is recognised and the rest together keep every other character', () => {
        for (let n = 0; n < 400; n++) {
            const before = pick(EDGES);
            const after = pick(EDGES);
            const p = pick(PARTS);
            const text = `${before}${before ? pick(SEPS) : ''}${p}${after ? pick(SEPS) : ''}${after}`;
            const found = recognizeLocation(text);
            const split = splitSource({ reference: text });
            if (!found) {
                // nothing taken: the location stays whole
                expect(split, text).toBeUndefined();
                continue;
            }
            const taken = [found.folio ?? '', found.image ?? ''].join('');
            // the rest keeps the edges' text (nothing else lost than separators and the part)
            for (const edge of [before, after].filter(Boolean)) {
                expect(found.rest.normalize('NFC').includes(edge.normalize('NFC')) || !letters(edge), `${text} → ${found.rest}`).toBe(true);
            }
            // the image word and the folio's word are the only letters gone
            const gone = letters(text).length - letters(found.rest).length;
            expect(gone, text).toBeGreaterThanOrEqual(letters(taken).length);
            expect(gone, text).toBeLessThanOrEqual(letters(p).length);
            if (split) expect(withSplit({ reference: text }, split).reference ?? '').toBe(found.rest);
        }
    });

    it('a word glued to a letter of another script is no part ("漢fol. 3" is, an emoji before is a separator)', () => {
        expect(recognizeLocation('🙂fol. 3')?.folio).toBe('fol. 3');
        expect(recognizeLocation('fol. 3🙂')?.folio).toBe('fol. 3');
        expect(recognizeLocation('漢fol. 3')).toBeNull();
        expect(recognizeLocation(`${'é'}fol. 3`)).toBeNull();
        expect(recognizeLocation('snímek 34漢')).toBeNull();
    });
});
