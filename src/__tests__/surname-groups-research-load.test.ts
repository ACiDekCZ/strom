/**
 * The surname-variant groups through a research update: the app sends them in
 * the header NOTE, a research that does not read it sends its version without
 * them, and loading that version used to drop every group. Invented family
 * (the Lhoták family) only.
 */

import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom, SURNAME_GROUPS_MARKER } from '../ged-exporter.js';
import { keepSurnameVariants, keepMarriedSurname, keepTitles, stabilizeIds, contentFingerprint } from '../research-link.js';
import { StromData } from '../types.js';

const GED = (header: string[] = []) => [
    '0 HEAD', '1 SOUR STROM_RESEARCH', '1 CHAR UTF-8', ...header,
    '0 @I1@ INDI', '1 NAME Jan /Lhoták/', '1 SEX M', '1 REFN P0001',
    '0 @I2@ INDI', '1 NAME Marie /Lhotáková/', '1 SEX F', '1 REFN P0002',
    '0 TRLR',
].join('\n');
const groupsNote = (lines: string[]) => [`1 NOTE ${SURNAME_GROUPS_MARKER}`, ...lines.map(l => `2 CONT ${l}`)];

const load = (ged: string): StromData => convertToStrom(parseGedcom(ged)).data;
/** What a research load does with the version before it goes over the tree (applyResearch). */
const asLoaded = (next: StromData, previous: StromData): StromData =>
    stabilizeIds(keepSurnameVariants(keepMarriedSurname(keepTitles(next, previous, null), previous, null), previous), previous);

describe('surname-variant groups through a research update', () => {
    const here = (): StromData => {
        const d = load(GED());
        d.surnameVariants = [['Lhoták', 'Lhotak', 'Lhottak']];
        return d;
    };

    it('a version without the groups NOTE keeps the groups of the tree', () => {
        const out = asLoaded(load(GED()), here());
        expect(out.surnameVariants).toEqual([['Lhoták', 'Lhotak', 'Lhottak']]);
    });

    it('the round trip the research makes without reading the NOTE: the tree stays in step', () => {
        const previous = here();
        // The app sends the groups; a research that ignores them answers without the NOTE.
        expect(exportToGedcom(previous).content).toContain(SURNAME_GROUPS_MARKER);
        const out = asLoaded(load(GED()), previous);
        expect(contentFingerprint(out)).toBe(contentFingerprint(previous));
    });

    it('a version with groups is the research\'s word: taken as it is, not merged again', () => {
        const out = asLoaded(load(GED(groupsNote(['Lhoták | Lhota', 'Nováková | Nowak']))), here());
        expect(out.surnameVariants).toEqual([['Lhoták', 'Lhota'], ['Nováková', 'Nowak']]);
    });

    it('nothing to keep: the version itself, unchanged', () => {
        const next = load(GED());
        expect(keepSurnameVariants(next, load(GED()))).toBe(next);
        expect(next.surnameVariants).toBeUndefined();
    });

    it('neither input is changed, and the kept groups are copies', () => {
        const previous = here();
        const next = load(GED());
        const out = keepSurnameVariants(next, previous);
        expect(next.surnameVariants).toBeUndefined();
        out.surnameVariants![0].push('Lhotta');
        expect(previous.surnameVariants).toEqual([['Lhoták', 'Lhotak', 'Lhottak']]);
    });
});
