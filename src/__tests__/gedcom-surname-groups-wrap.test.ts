/**
 * A long surname-variant group line in the header NOTE: the exporter wraps it
 * onto `3 CONC` lines (pushWrapped), and reading it back must glue the line
 * together again — the cut, then the join, gives the very text that went out,
 * whatever character sits at the cut (emoji, combining marks, CJK, an escaped
 * '@'). Before, the reader took only the `2 CONT` line and lost the rest of the
 * group. Invented names only.
 */

import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom, SURNAME_GROUPS_MARKER, SURNAME_GROUP_SEP } from '../ged-exporter.js';
import { StromData, PersonId } from '../types.js';

/** Characters that span more than one UTF-16 unit, one code point or one byte. */
const TRICKY = [
    '🔴', '👨‍👩‍👧', '👍🏽', '🇨🇿🇩🇪', '1️⃣', // emoji: surrogate pairs, ZWJ sequences, modifiers, flags, keycaps
    'é', 'ů', 'ạ̈', '각', // combining marks, Hangul jamo
    '李', '渡邊', '𠮷', 'ř', '@', // CJK (BMP and astral), two-byte Czech, an escaped '@'
];

function tree(groups: string[][]): StromData {
    return {
        persons: {
            ['p1' as PersonId]: {
                id: 'p1' as PersonId, firstName: 'Jan', lastName: 'Lhoták', gender: 'male',
                isPlaceholder: false, parentIds: [], childIds: [], partnerships: [],
            },
        },
        partnerships: {},
        surnameVariants: groups,
    };
}

/** The header NOTE's group lines, each with its `3 CONC` / `3 CONT` lines joined (GEDCOM's own rule). */
function joinedGroupLines(ged: string): string[] {
    const lines = ged.split('\n');
    const at = lines.indexOf(`1 NOTE ${SURNAME_GROUPS_MARKER}`);
    expect(at).toBeGreaterThanOrEqual(0);
    const out: string[] = [];
    for (const line of lines.slice(at + 1)) {
        const m = /^(\d+) (CONT|CONC) ?(.*)$/.exec(line);
        if (!m || m[1] === '1' || m[1] === '0') break;
        if (m[1] === '2') out.push(m[3]);
        else out[out.length - 1] += m[2] === 'CONT' ? `\n${m[3]}` : m[3];
    }
    return out.map(l => l.replace(/@@/g, '@'));
}

const roundTrip = (groups: string[][]): string[][] | undefined =>
    convertToStrom(parseGedcom(exportToGedcom(tree(groups)).content)).data.surnameVariants;

/** A group whose line puts `ch` at every offset around the first and the second cut. */
function* groupsAroundCut(ch: string): Generator<string[]> {
    for (let pad = 176; pad <= 204; pad++) {
        // `ch` inside a name, right at the byte limit.
        yield ['x'.repeat(pad) + ch + 'ová', 'Lhoták', 'Lhota' + ch];
        // `ch` beside the separator.
        yield ['y'.repeat(pad - 3) + ch, ch + 'Lhotak', 'Lhottekk'];
        // Two-byte letters before it: the cut lands at another character offset.
        yield ['ř'.repeat(Math.floor(pad / 2)) + ch + ch, 'Lhoták'];
        // Long enough for several cuts, `ch` around each.
        yield [ch + 'z'.repeat(pad) + ch, 'w'.repeat(pad) + ch + ch, ch.repeat(40), 'Lhotáková'];
    }
}

describe('surname-variant groups: a wrapped group line reads back whole', () => {
    it('a long group goes out on 3 CONC lines (the case the reader missed)', () => {
        const long = ['Lhoták', 'Lhotak', 'Lhottekk', ...Array.from({ length: 30 }, (_, i) => `Lhotáková${i}`)];
        const ged = exportToGedcom(tree([long, ['Novák', 'Nowak']])).content;
        expect(ged).toMatch(/^3 CONC /m);
        expect(roundTrip([long, ['Novák', 'Nowak']])).toEqual([long, ['Novák', 'Nowak']]);
    });

    for (const ch of TRICKY) {
        it(`cut, then join, is the text that went out: ${JSON.stringify(ch)} at the cut`, () => {
            for (const group of groupsAroundCut(ch)) {
                const groups = [group, ['Novák', 'Nowak']];
                const ged = exportToGedcom(tree(groups)).content;
                // The lines as written, joined: exactly each group line.
                expect(joinedGroupLines(ged)).toEqual(groups.map(g => g.join(SURNAME_GROUP_SEP)));
                // And the app's reader gets every group back, the one after it still apart.
                expect(roundTrip(groups)).toEqual(groups);
            }
        });
    }

    it('a 3 CONT under a group line continues the same group (a line break is only a space)', () => {
        const ged = [
            '0 HEAD', '1 CHAR UTF-8', `1 NOTE ${SURNAME_GROUPS_MARKER}`,
            '2 CONT Lhoták | Lhotak |', '3 CONT Lhottekk', '3 CONC ová | Lhota', '2 CONT Novák | Nowak',
            '0 @I1@ INDI', '1 NAME Jan /Lhoták/', '0 TRLR',
        ].join('\n');
        expect(convertToStrom(parseGedcom(ged)).data.surnameVariants).toEqual([
            ['Lhoták', 'Lhotak', 'Lhottekková', 'Lhota'], ['Novák', 'Nowak'],
        ]);
    });

    it('a 3 CONC under another header line is no group', () => {
        const ged = [
            '0 HEAD', '1 CHAR UTF-8', '1 NOTE Lhotákovi', '2 CONT Lhoták | Lhotak', '3 CONC | Lhota',
            '0 @I1@ INDI', '1 NAME Jan /Lhoták/', '0 TRLR',
        ].join('\n');
        expect(convertToStrom(parseGedcom(ged)).data.surnameVariants).toBeUndefined();
    });
});
