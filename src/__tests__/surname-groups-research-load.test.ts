/**
 * The surname-variant groups through a research update: the app sends them in
 * the header NOTE, a research that does not read it sends its version without
 * them, and loading that version used to drop every group. Invented family
 * (the Lhoták family) only.
 */

import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom, SURNAME_GROUPS_MARKER, SURNAME_REJECTIONS_MARKER } from '../ged-exporter.js';
import { carryOverTreeDecisions } from '../quality-dismiss.js';
import { keepSurnameVariants, keepMarriedSurname, keepTitles, stabilizeIds, contentFingerprint } from '../research-link.js';
import { StromData } from '../types.js';

const GED = (header: string[] = []) => [
    '0 HEAD', '1 SOUR STROM_RESEARCH', '1 CHAR UTF-8', ...header,
    '0 @I1@ INDI', '1 NAME Jan /Lhoták/', '1 SEX M', '1 REFN P0001',
    '0 @I2@ INDI', '1 NAME Marie /Lhotáková/', '1 SEX F', '1 REFN P0002',
    '0 TRLR',
].join('\n');
const groupsNote = (lines: string[]) => [`1 NOTE ${SURNAME_GROUPS_MARKER}`, ...lines.map(l => `2 CONT ${l}`)];
const rejectionsNote = (lines: string[]) => [`1 NOTE ${SURNAME_REJECTIONS_MARKER}`, ...lines.map(l => `2 CONT ${l}`)];

const load = (ged: string): StromData => convertToStrom(parseGedcom(ged)).data;
/** What a research load does with the version before it goes over the tree (applyResearch). */
const asLoaded = (next: StromData, previous: StromData): StromData =>
    stabilizeIds(keepSurnameVariants(keepMarriedSurname(keepTitles(next, previous, null), previous, null), previous), previous);

describe('surname-variant groups through a research update', () => {
    const here = (): StromData => {
        const d = load(GED());
        d.surnameVariants = [['Lhoták', 'Lhotak', 'Lhottekk']];
        return d;
    };

    it('a version without the groups NOTE keeps the groups of the tree', () => {
        const out = asLoaded(load(GED()), here());
        expect(out.surnameVariants).toEqual([['Lhoták', 'Lhotak', 'Lhottekk']]);
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

    it('the groups marker with nothing under it is the research\'s "none": no group of the tree comes back', () => {
        const out = asLoaded(load(GED(groupsNote([]))), here());
        expect(out.surnameVariants ?? []).toEqual([]);
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
        out.surnameVariants![0].push('Lhottek');
        expect(previous.surnameVariants).toEqual([['Lhoták', 'Lhotak', 'Lhottekk']]);
    });
});

describe('rejected spelling suggestions through a research update (like the groups)', () => {
    const here = (): StromData => {
        const d = load(GED());
        d.surnameRejections = [{ forms: ['Lhoták', 'Lhota'], id: 'sg-7', at: '2026-10-20T10:00:00.000Z' }];
        return d;
    };

    it('a version without the rejections NOTE keeps the tree rejections (with their id and date)', () => {
        const out = asLoaded(load(GED()), here());
        expect(out.surnameRejections).toEqual([{ forms: ['Lhoták', 'Lhota'], id: 'sg-7', at: '2026-10-20T10:00:00.000Z' }]);
        expect(carryOverTreeDecisions(load(GED()), here()).surnameRejections).toEqual(here().surnameRejections);
    });

    it('the rejections marker with nothing under it is the research "none": no rejection comes back', () => {
        const out = asLoaded(load(GED(rejectionsNote([]))), here());
        expect(out.surnameRejections ?? []).toEqual([]);
        expect(carryOverTreeDecisions(load(GED(rejectionsNote([]))), here()).surnameRejections).toBeUndefined();
    });

    it('a version with rejections is the research list; the same forms keep the tree id and date', () => {
        const next = load(GED(rejectionsNote(['Lhota | Lhoták', 'Nováková | Nowak'])));
        const out = asLoaded(next, here());
        expect(out.surnameRejections).toEqual([
            { forms: ['Lhota', 'Lhoták'], id: 'sg-7', at: '2026-10-20T10:00:00.000Z' },
            { forms: ['Nováková', 'Nowak'] },
        ]);
        expect(carryOverTreeDecisions(load(GED(rejectionsNote(['Lhota | Lhoták']))), here()).surnameRejections)
            .toEqual([{ forms: ['Lhota', 'Lhoták'], id: 'sg-7', at: '2026-10-20T10:00:00.000Z' }]);
    });

    it('the round trip without the NOTE: the tree stays in step', () => {
        const previous = here();
        expect(exportToGedcom(previous).content).toContain(SURNAME_REJECTIONS_MARKER);
        expect(contentFingerprint(asLoaded(load(GED()), previous))).toBe(contentFingerprint(previous));
    });

    it('nothing to keep: the version itself; the inputs are not changed', () => {
        const next = load(GED());
        expect(keepSurnameVariants(next, load(GED()))).toBe(next);
        const previous = here();
        const out = keepSurnameVariants(next, previous);
        expect(next.surnameRejections).toBeUndefined();
        out.surnameRejections![0].forms.push('Lhottek');
        expect(previous.surnameRejections![0].forms).toEqual(['Lhoták', 'Lhota']);
    });
});
