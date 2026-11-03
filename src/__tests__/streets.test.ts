/**
 * The street and house-number rules ported from Strom Research (src/streets.ts).
 * The research's shared cases (test/fixtures/streets/cases.json, a copy) are
 * the contract: every case of every section, each input also decomposed (NFD),
 * gives what the research's code gives.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { bareNumber, foldText, houseWith, numberedTown, numbersOnly, splitStreet, streetOfHouse } from '../streets.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const CASES = join(root, 'test', 'fixtures', 'streets', 'cases.json');
const TERMS = join(root, 'src', 'terms', 'streets.json');

interface Cases {
    split: { place: string; known?: Record<string, string[]>; expect: unknown }[];
    bare: { place: string; expect: unknown }[];
    numbered: { name: string; expect: boolean }[];
    houseWith: { street: string; had?: string; expect: string | null }[];
    fold: { text: string; expect: string }[];
}

const cases = JSON.parse(readFileSync(CASES, 'utf8')) as Cases;
const known = (streets: Record<string, string[]>) => (town: string) => (streets[town] ? new Set(streets[town]) : undefined);

describe('the research\'s shared street cases', () => {
    it('has every section', () => {
        expect(cases.split.length).toBeGreaterThan(30);
        expect(cases.bare.length).toBeGreaterThan(5);
        expect(cases.numbered.length).toBeGreaterThan(0);
        expect(cases.houseWith.length).toBeGreaterThan(0);
        expect(cases.fold.length).toBeGreaterThan(0);
    });

    it('split: splitStreet gives each case, NFD the same', () => {
        for (const x of cases.split) {
            const k = x.known ? known(x.known) : undefined;
            expect(splitStreet(x.place, k) ?? null, x.place).toEqual(x.expect);
            expect(splitStreet(x.place.normalize('NFD'), k) ?? null, `${x.place} (NFD)`).toEqual(x.expect);
        }
    });

    it('bare: bareNumber gives each case, NFD the same; never a split by the rules', () => {
        for (const x of cases.bare) {
            expect(bareNumber(x.place) ?? null, x.place).toEqual(x.expect);
            expect(bareNumber(x.place.normalize('NFD')) ?? null, `${x.place} (NFD)`).toEqual(x.expect);
            if (x.expect) expect(splitStreet(x.place), x.place).toBeUndefined();
        }
    });

    it('numbered: numberedTown, NFD the same', () => {
        for (const x of cases.numbered) {
            expect(numberedTown(x.name), x.name).toBe(x.expect);
            expect(numberedTown(x.name.normalize('NFD')), `${x.name} (NFD)`).toBe(x.expect);
        }
    });

    it('houseWith: each case', () => {
        for (const x of cases.houseWith) {
            expect(houseWith(x.street, x.had) ?? null, `${x.street} + ${x.had}`).toBe(x.expect);
        }
    });

    it('fold: foldText, NFD the same', () => {
        for (const x of cases.fold) {
            expect(foldText(x.text), x.text).toBe(x.expect);
            expect(foldText(x.text.normalize('NFD')), `${x.text} (NFD)`).toBe(x.expect);
        }
    });

    it('a Polish house marker is a marker: "nr domu 12" is house 12, never "nr domu nr domu 12" (1103)', () => {
        for (const place of ['Wierzbno Dolne, nr domu 12', 'Wierzbno Dolne nr domu 12', 'Wierzbno Dolne, numer domu 12', 'Wierzbno Dolne, dom nr 12', 'Wierzbno Dolne, nr. domu 12']) {
            expect(splitStreet(place), place).toMatchObject({ town: 'Wierzbno Dolne', house: '12' });
        }
    });

    it('streetOfHouse and numbersOnly read a house', () => {
        expect(streetOfHouse('Dlouhá 88'.normalize('NFD'))).toBe('dlouha');
        expect(streetOfHouse('č. p. 13')).toBe('');
        expect(numbersOnly('13/2')).toBe(true);
        expect(numbersOnly('Dlouhá 12')).toBe(false);
    });
});

// Development only: the copies must stay byte-identical to the research's
// files. CI has no research checkout next to the app, so it skips.
const research = join(root, '..', 'strom-research');
describe.skipIf(!existsSync(join(research, 'assets', 'terms', 'streets.json')))('copies of the research\'s street files', () => {
    it('streets.json and cases.json are byte-identical to ../strom-research', () => {
        expect(readFileSync(TERMS).equals(readFileSync(join(research, 'assets', 'terms', 'streets.json'))),
            'src/terms/streets.json differs from strom-research/assets/terms/streets.json').toBe(true);
        expect(readFileSync(CASES).equals(readFileSync(join(research, 'test', 'fixtures', 'streets', 'cases.json'))),
            'test/fixtures/streets/cases.json differs from strom-research/test/fixtures/streets/cases.json').toBe(true);
    });
});
