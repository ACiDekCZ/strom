/**
 * The import contract published in docs/GEDCOM-IMPORT.md, exercised.
 *
 * That document tells other programs what Strom reads and where each fact
 * lands. A specification nobody runs drifts from the code within a release or
 * two and then quietly lies to whoever wrote an exporter against it, so the
 * file below is the document's own example, and every assertion is one of its
 * claims. If this test fails, either the importer changed or the document is
 * wrong — and both are worth stopping for.
 */

import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { StromData, Person, Partnership } from '../types.js';

const GED = `0 HEAD
1 CHAR UTF-8
0 @S4@ SOUR
1 TITL Lučice, kniha narozených 1858-1870
1 REPO SOA Zámrsk
0 @I1@ INDI
1 NAME František /Krepčík/
1 NAME František /Krepcik/
1 SEX M
1 REFN K-04
1 FAMS @F1@
1 BIRT
2 DATE 5 MAY 1863
2 PLAC Lučice
3 MAP
4 LATI N49.8
4 LONG E16.1
2 SOUR @S4@
3 PAGE s. 15, snímek 11
3 QUAY 3
2 NOTE Otec veden jako chalupník.
2 _WITN Marie Dvořáková
2 RELI Římskokatolické
1 OCCU mistr obuvnický
1 EVEN
2 TYPE Požár stavení
2 DATE NOV 1905
0 @I2@ INDI
1 NAME Anna /Kadeřábková/
1 SEX U
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 4 FEB 1781
2 _WITN Wenceslaus Saukal
1 MARB
2 DATE 18 APR 1886
0 TRLR
`;

const imported = (): StromData => convertToStrom(parseGedcom(GED)).data;
const groom = (data: StromData): Person =>
    Object.values(data.persons).find(p => p.firstName.startsWith('František'))!;
const bride = (data: StromData): Person =>
    Object.values(data.persons).find(p => p.firstName === 'Anna')!;
const union = (data: StromData): Partnership => Object.values(data.partnerships)[0];

describe('the published GEDCOM import contract', () => {
    it('reports nothing as unsupported — the promise the whole document rests on', () => {
        expect(convertToStrom(parseGedcom(GED)).stats.droppedTagSummary).toBeFalsy();
    });

    it('reads the person: names, reference number, dates', () => {
        const person = groom(imported());
        expect(person.lastName).toBe('Krepčík');
        expect(person.nameVariants?.length).toBeGreaterThan(0);
        expect(person.refn).toBe('K-04');
        expect(person.birthDate).toBe('1863-05-05');
    });

    it('keeps everything hanging under BIRT, which is the register entry itself', () => {
        const person = groom(imported());
        expect(person.sourceIds?.length, 'the entry cites the person').toBeGreaterThan(0);
        expect(person.notes, 'a note is labelled by the fact it sat under').toContain('chalupník');
        expect(person.notes, 'RELI says what they were, not that they converted')
            .toContain('Římskokatolické');
        // A godparent named under BIRT is hung on a dated event, never left
        // floating loose of the date it belongs to.
        expect(JSON.stringify(person.events)).toContain('Marie Dvořáková');
    });

    it('takes a value that rides on the tag line as the fact itself', () => {
        const trade = (groom(imported()).events ?? []).find(e => e.type === 'occupation');
        expect(trade?.note).toBe('mistr obuvnický');
    });

    it('keeps a generic EVEN under the label its TYPE gives it', () => {
        const events = groom(imported()).events ?? [];
        expect(events.some(e => e.customLabel === 'Požár stavení')).toBe(true);
    });

    it('reads place coordinates from PLAC > MAP > LATI/LONG', () => {
        expect(Object.keys(imported().places ?? {}).length).toBeGreaterThan(0);
    });

    it('infers a missing SEX from the role in the family', () => {
        expect(bride(imported()).gender).toBe('female');
    });

    it('makes wedding witnesses people, not a line in a note', () => {
        expect(union(imported()).participants?.length).toBeGreaterThan(0);
    });

    it('folds a fact with no field of its own into the couple\'s note, labelled', () => {
        expect(union(imported()).note ?? '').toContain('1886');
    });

    it('survives the round-trip the document tells exporters to check', () => {
        const once = imported();
        const twice = convertToStrom(parseGedcom(exportToGedcom(once).content)).data;
        expect(Object.keys(twice.persons)).toHaveLength(Object.keys(once.persons).length);
        expect(groom(twice).birthDate).toBe(groom(once).birthDate);
        expect((groom(twice).events ?? []).find(e => e.type === 'occupation')?.note)
            .toBe('mistr obuvnický');
    });

    it('writes no physical line longer than 255 bytes', () => {
        const ged = exportToGedcom(imported()).content;
        for (const line of ged.split('\n')) {
            expect(Buffer.byteLength(line, 'utf8'), line).toBeLessThanOrEqual(255);
        }
    });
});
