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
import { parseGedcom, convertToStrom } from '../ged-parser.js';
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
