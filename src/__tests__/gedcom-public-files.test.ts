/**
 * The smallest cuts of public GEDCOM test files (gedcom.io remarriage2 and
 * age, the 5.5 torture test, royal92) that "Back to {program}" lost or
 * changed: import → "Back to" → import of that file → "Back to" gives the
 * same file, and the lines the file had come back as written (spec 066).
 * Fixtures: test/fixtures/gedcom/public/.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGedcom, convertToStrom, decodeGedcomBytes } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { migrateData } from '../data.js';
import { applyLivingPrivacy, CONTENT_PRESETS } from '../privacy.js';
import { StromData } from '../types.js';

const fixture = (name: string): string =>
    readFileSync(join(process.cwd(), 'test', 'fixtures', 'gedcom', 'public', name), 'utf-8');

const load = (text: string, file: string): StromData =>
    migrateData(convertToStrom(parseGedcom(text), { importOrigin: { at: '2026-11-08', file, encoding: 'utf-8' } }).data);

const backTo = (data: StromData): string =>
    exportToGedcom(applyLivingPrivacy(data, 'full', 2026, { keepDeceasedSources: true }), 'Public',
        { content: CONTENT_PRESETS.back, origins: true, backTo: data.imports![0].id }).content;

/** The file without the date of the export in its header. */
const undated = (ged: string): string => ged.replace(/^(0 HEAD\n(?:[1-9].*\n)*?)1 DATE [^\n]*\n/, '$1');

/** "Back to" of the file, and "Back to" of that file read again. */
function twice(text: string, file: string): { tree: StromData; back: string; second: string } {
    const tree = load(text, file);
    const back = backTo(tree);
    const second = backTo(load(back, `${file}-back.ged`));
    return { tree, back, second };
}

describe('Picture links by address read again from "Back to" (066 N1, e-obje.ged)', () => {
    const { back, second } = twice(fixture('e-obje.ged'), 'e-obje.ged');

    it('"Back to" writes both OBJE links as the file had them, and so does the next one', () => {
        const links = '1 OBJE\n2 FORM URL\n2 TITL Web site\n2 FILE http://www.example.com\n'
            + '1 OBJE\n2 FORM jpeg\n2 TITL Local photo\n2 FILE photo.jpg\n';
        expect(back).toContain(links);
        expect(second).toContain(links);
        expect(undated(second)).toBe(undated(back));
    });
});

describe('An age with more than 999 days (066 N3, d-age.ged)', () => {
    const { tree, back, second } = twice(fixture('d-age.ged'), 'd-age.ged');

    it('goes back as a GEDCOM AGE, not as words, and the next "Back to" equals the first', () => {
        expect(back).toContain('1 DEAT\n2 DATE 1950\n2 AGE 1y 30m 1100d\n');
        expect(back).not.toMatch(/AGE .*(year|month|day)/);
        expect(undated(second)).toBe(undated(back));
        // The tree shows it in words.
        expect(Object.values(tree.persons)[0].deathAge).toMatch(/1100/);
    });

    it('weeks of a GEDCOM 7 age go back as days, read again the same', () => {
        const file = fixture('d-age.ged').replace('2 AGE 1y 30m 1100d', '2 AGE 1y 30m 100w 400d');
        const again = twice(file, 'age7.ged');
        expect(again.back).toContain('2 AGE 1y 30m 1100d\n');
        expect(undated(again.second)).toBe(undated(again.back));
    });
});

describe('The LDS extensions of ANSEL (066 N4, the 5.5 torture file)', () => {
    // NOTE lines as the torture file writes them: the hex code, the name, the character in parentheses.
    const head = '0 HEAD\n1 SOUR PAF\n1 GEDC\n2 VERS 5.5\n2 FORM LINEAGE-LINKED\n1 CHAR ANSEL\n0 @I1@ INDI\n1 NAME A /X/\n1 NOTE ANSEL\n';
    const rows: [number, string, string][] = [
        [0xBE, 'empty box', '\u25A1'], [0xBF, 'black box', '\u25A0'],
        [0xCD, 'midline e', 'e'], [0xCE, 'midline o', 'o'], [0xC7, 'eszett', '\u00DF'], [0xC8, 'euro', '\u20AC'],
    ];
    const bytes = [...new TextEncoder().encode(head)];
    for (const [code, name] of rows) bytes.push(...new TextEncoder().encode(`2 CONT ${name} (`), code, 0x29, 0x0A);
    bytes.push(...new TextEncoder().encode('0 TRLR\n'));
    const decoded = decodeGedcomBytes(new Uint8Array(bytes).buffer);

    it('read as the characters of the GEDCOM table, none as U+FFFD', () => {
        expect(decoded.encoding).toBe('ansel');
        expect(decoded.text).not.toContain('\uFFFD');
        for (const [, name, char] of rows) expect(decoded.text).toContain(`${name} (${char})`);
    });

    it('the note keeps them in the tree and in "Back to"', () => {
        const { tree, back } = twice(decoded.text, 'ansel.ged');
        expect(Object.values(tree.persons)[0].notes).toContain('empty box (\u25A1)');
        expect(back).toContain('2 CONT black box (\u25A0)');
        expect(back).not.toContain('\uFFFD');
    });
});
