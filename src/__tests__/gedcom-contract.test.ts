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
2 NOTE Tovaryšem od roku 1880.
1 EVEN
2 TYPE Požár stavení
2 DATE NOV 1905
1 _STORY
2 TYPE vypraveni
2 TITL Nemanželský syn z čp. 22
2 STAT hotovo
2 TEXT František se narodil 5. května 1863 v Lučici jako nemanžel
3 CONC ský syn Anny Krepčíkové.
3 CONT
3 CONT Otec není v matrice uveden.
2 DATA BIRT 5 MAY 1863 [M-04]
2 NOTE Odvozeno z matriky, není to pramen.
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
        // The fact first, then the remark written under it — one field here.
        expect(trade?.note).toBe('mistr obuvnický\nTovaryšem od roku 1880.');
    });

    it('reads a narrative whole: prose, the facts it leans on, the caveat', () => {
        const story = groom(imported()).story!;
        expect(story.title).toBe('Nemanželský syn z čp. 22');
        expect(story.status).toBe('final');
        // CONC joins with nothing between, CONT breaks a line, an empty CONT is
        // the blank line between paragraphs.
        // Note where the CONC falls: mid-word, because it joins with NOTHING.
        // Splitting at a space would have produced "jakonemanželský" — which is
        // exactly the mistake the document warns about, and the example in it
        // used to make.
        expect(story.text).toBe('František se narodil 5. května 1863 v Lučici'
            + ' jako nemanželský syn Anny Krepčíkové.\n\nOtec není v matrice uveden.');
        expect(story.facts).toEqual(['BIRT 5 MAY 1863 [M-04]']);
        expect(story.note).toBe('Odvozeno z matriky, není to pramen.');
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

        // Counts alone let a lost note through once. Compare the content.
        expect(Object.keys(twice.persons)).toHaveLength(Object.keys(once.persons).length);
        expect(groom(twice).birthDate).toBe(groom(once).birthDate);
        expect(groom(twice).notes).toBe(groom(once).notes);
        expect(union(twice).note).toBe(union(once).note);
        expect(groom(twice).story).toEqual(groom(once).story);

        const trade = (e: Person) => (e.events ?? []).find(x => x.type === 'occupation')?.note;
        expect(trade(groom(twice))).toBe(trade(groom(once)));
    });

    it('stays GEDCOM even when every free-text field carries a line break', () => {
        // The structure of the file IS its line structure. A newline written
        // into a value emits a physical line with nothing in front of it, and
        // every reader loses the rest of that record. Fields a person types
        // into are where those newlines come from.
        const data = imported();
        const person = groom(data);
        person.notes = 'první řádek\ndruhý řádek';
        person.refn = 'K-04\nnavíc';
        person.birthPlace = 'Lučice\nu Chrudimi';
        person.events = [
            { id: 'x1', type: 'occupation', note: 'kovář\nod roku 1880' },
            { id: 'x2', type: 'custom', customLabel: 'Požár\nstavení', place: 'Lučice\n46' },
        ];
        union(data).note = 'poznámka\nna dvou řádcích';

        const ged = exportToGedcom(data).content;
        for (const line of ged.split('\n')) {
            if (line.length === 0) continue;
            expect(line, 'line without a level').toMatch(/^\d+ /);
        }
        // …and the text is still there, not swallowed by the repair.
        const back = convertToStrom(parseGedcom(ged)).data;
        expect(groom(back).notes).toContain('druhý řádek');
        expect((groom(back).events ?? []).find(e => e.type === 'occupation')?.note)
            .toContain('od roku 1880');
    });

    it('writes GEDCOM: every line carries a level, and none exceeds 255 bytes', () => {
        // A newline written straight onto a tag line produced a physical line
        // with no level in front of it. The file stopped being GEDCOM, and the
        // text after the break was gone on the next import.
        const ged = exportToGedcom(imported()).content;
        for (const line of ged.split('\n')) {
            if (line.length === 0) continue;
            expect(line, 'line without a level').toMatch(/^\d+ /);
            expect(Buffer.byteLength(line, 'utf8'), line).toBeLessThanOrEqual(255);
        }
    });
});
