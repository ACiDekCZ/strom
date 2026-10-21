/**
 * Long values are CONC-wrapped to the 255-byte line limit. A cut must never
 * tear a character apart: half of a surrogate pair is written as U+FFFD, so an
 * emoji right at the cut came back from the research as "��" (and a source
 * renamed with it). Each physical line must be valid text on its own, and
 * export → import must return every value exactly. Invented text only.
 */

import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { StromData } from '../types.js';
import { clipText } from '../text-clip.js';

const GED = `0 HEAD
1 GEDC
2 VERS 5.5.1
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Anna /Test/
1 SEX F
1 BIRT
2 DATE 1 JAN 1900
2 PLAC Somewhere
1 SOUR @S1@
0 @S1@ SOUR
1 TITL Register
0 TRLR`;

const importGed = (ged: string): StromData => convertToStrom(parseGedcom(ged)).data;

/** Characters that span more than one UTF-16 unit or one code point. */
const TRICKY = ['🔴', '🟢', '⭐', '👨‍👩‍👧', '👍🏽', '🇨🇿🇩🇪', 'é', 'ů', 'č', '1️⃣', '@'];

const encoder = new TextEncoder();
const strictDecoder = new TextDecoder('utf-8', { fatal: true });

/** Every line on its own: no lone surrogate, valid UTF-8, within 255 bytes. */
function expectWholeLines(ged: string): void {
    for (const line of ged.split('\n')) {
        expect(line).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
        expect(line).not.toContain('�');
        const bytes = encoder.encode(line);
        expect(strictDecoder.decode(bytes)).toBe(line);
        expect(bytes.length).toBeLessThanOrEqual(255);
    }
}

/** A value with `ch` placed at every offset around the first CONC cut. */
function* valuesAroundCut(ch: string): Generator<string> {
    for (let pad = 182; pad <= 202; pad++) {
        yield 'x'.repeat(pad) + ch + ' Past 125.';
        yield 'x'.repeat(pad - 3) + ' ' + ch + ' Past 125.';
        yield 'ř'.repeat(Math.floor(pad / 2)) + ch + ch + 'tail';
        yield 'word '.repeat(Math.floor(pad / 5)) + ch + ' ' + ch + ' ' + 'z'.repeat(250) + ch;
    }
}

describe('GEDCOM CONC wrapping keeps characters whole', () => {
    for (const ch of TRICKY) {
        it(`source title, note and place with ${ch} at the cut (plain export and for the research)`, () => {
            const base = importGed(GED);
            const person = Object.values(base.persons)[0];
            const source = Object.values(base.sources ?? {})[0];
            let wrapped = 0;
            for (const value of valuesAroundCut(ch)) {
                person.notes = value;
                person.birthPlace = value;
                source.title = value;
                for (const ged of [
                    exportToGedcom(base).content,
                    exportToGedcom(base, 'T', { research: { id: '0b4c7a52-1c1f-4d7e-9a53-2f4a3c1e8b10' } }).content,
                ]) {
                    if (ged.includes(' CONC ')) wrapped++;
                    expectWholeLines(ged);
                    const back = importGed(ged);
                    const p = Object.values(back.persons)[0];
                    expect(p.notes).toBe(value);
                    expect(p.birthPlace).toBe(value);
                    expect(Object.values(back.sources ?? {})[0].title).toBe(value);
                }
            }
            expect(wrapped).toBeGreaterThan(70);
        });
    }

    it('a note with line breaks and emoji on every line round-trips exactly', () => {
        const base = importGed(GED);
        const person = Object.values(base.persons)[0];
        const line = (ch: string) => 'y'.repeat(199) + ch + ' and more ' + ch;
        person.notes = TRICKY.map(line).join('\n');
        const ged = exportToGedcom(base).content;
        expectWholeLines(ged);
        expect(Object.values(importGed(ged).persons)[0].notes).toBe(person.notes);
    });
});

describe('clipText', () => {
    it('never ends on half of a surrogate pair', () => {
        expect(clipText('ab🔴cd', 3)).toBe('ab');
        expect(clipText('ab🔴cd', 4)).toBe('ab🔴');
        expect(clipText('abc', 5)).toBe('abc');
        for (let max = 1; max < 40; max++) {
            const out = clipText('x🔴 '.repeat(20), max);
            expect(out.length).toBeLessThanOrEqual(max);
            expect(out).not.toMatch(/[\uD800-\uDBFF]$/);
        }
    });
});
