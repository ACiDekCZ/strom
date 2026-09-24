/**
 * What a research tool's GEDCOM carries beyond names, dates and places — the
 * age a register gives, the cause of death, the house number, the source's
 * transcript and call number, the two parents' different ties to a child —
 * must arrive in the tree, and survive a round trip through Strom's own export.
 *
 * None of it gets a field or a form: each detail becomes a labelled line in the
 * note of the fact it belongs to, where a reader already looks. Invented data
 * only.
 */

import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { StromData, Person, Partnership } from '../types.js';
import { strings } from '../strings.js';

const GED = `0 HEAD
1 CHAR UTF-8
0 @R0001@ REPO
1 NAME Státní oblastní archiv v Třeboni
0 @S0001@ SOUR
1 TITL Oddací zápis Josef Novák – Anna Svobodová, Kamenice nad Lipou 1910
1 AUTH Římskokatolická farnost Kamenice nad Lipou
1 REPO @R0001@
2 CALN Sig. 12/7
1 NOTE Fond / svazek: Kamenice nad Lipou 12, O 1901–1920
2 CONT fol. 45, č. 12
1 NOTE Poznámka badatele k zdroji
1 TEXT Anno 1910 die 12 Februarii copulati sunt
2 CONT Josephus Novák, agricola, annorum 25
1 REFN S0001
0 @S0002@ SOUR
1 TITL Křestní zápis Jan Novák 1885
0 @I1@ INDI
1 NAME Josef /Novák/
1 SEX M
1 REFN P0001
2 TYPE strom-research:3f2c
1 BIRT
2 DATE 24 JUN 1885
2 PLAC Vavřinec
2 ADDR čp. 13
3 CITY Vavřinec
2 SOUR @S0002@
3 PAGE fol. 12, č. 3
3 QUAY 3
1 BAPM
2 DATE 25 JUN 1885
2 PLAC Vavřinec
2 _WITN Marie Dvořáková
3 RELA Midwife
2 _WITN Karel Beneš
3 RELA Pate
2 _WITN Rosa Weber
3 RELA Hebamme
1 DEAT
2 DATE @#DJULIAN@ 12 MAR 1946
2 PLAC Kamenice nad Lipou
2 AGE 60y 8m
2 CAUS tuberkulóza
3 CONT plic
2 _WITN Václav Novák
3 RELA Informant
1 FAMS @F0001@
0 @I2@ INDI
1 NAME Anna /Nováková/
2 TYPE married
1 NAME Anna /Svobodová/
2 TYPE birth
2 SOUR @S0002@
3 PAGE pag. 228, 2. zápis
1 SEX F
1 FAMS @F0001@
0 @I3@ INDI
1 NAME Petr /Novák/
1 SEX M
1 FAMC @F0001@
0 @F0001@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
2 _FREL Step
2 _MREL Natural
1 MARR
2 DATE 12 FEB 1910
2 PLAC Kamenice nad Lipou
2 HUSB
3 AGE 25y
2 WIFE
3 AGE 22y
2 SOUR @S0001@
1 RESI
2 DATE 1910
2 PLAC Kamenice nad Lipou
2 ADDR čp. 12
0 TRLR`;

function importGed(text: string): StromData {
    return convertToStrom(parseGedcom(text)).data;
}

const byName = (data: StromData, first: string): Person =>
    Object.values(data.persons).find(p => p.firstName === first)!;
const union = (data: StromData): Partnership => Object.values(data.partnerships)[0];
const sourceTitled = (data: StromData, prefix: string) =>
    Object.values(data.sources ?? {}).find(s => s.title.startsWith(prefix))!;

describe('GEDCOM from a research tool', () => {
    const g = strings.gedcomNotes;
    const data = importGed(GED);
    const josef = byName(data, 'Josef');

    it('keeps every NOTE of a source, the whole transcript, the author and the call number', () => {
        const note = sourceTitled(data, 'Oddací').note ?? '';
        expect(note).toContain('Fond / svazek: Kamenice nad Lipou 12, O 1901–1920\nfol. 45, č. 12');
        expect(note).toContain('\n\nPoznámka badatele k zdroji');
        // The entry's wording has its own field; it no longer rides in the note.
        expect(sourceTitled(data, 'Oddací').transcript)
            .toBe('Anno 1910 die 12 Februarii copulati sunt\nJosephus Novák, agricola, annorum 25');
        expect(note).not.toContain('Anno 1910');
        expect(note).toContain(g.sourceAuthor('Římskokatolická farnost Kamenice nad Lipou'));
        expect(note).toContain(g.sourceCallNumber('Sig. 12/7'));
        expect(sourceTitled(data, 'Oddací').repository).toBe('Státní oblastní archiv v Třeboni');
    });

    it('writes age, cause and house number into the note of their fact, in words', () => {
        const notes = josef.notes ?? '';
        expect(notes).toContain(g.deathNote(g.age(`${g.ageUnit(60, 'y')} ${g.ageUnit(8, 'm')}`)));
        expect(notes).toContain(g.deathNote(g.cause('tuberkulóza\nplic')));
        // Only the ADDR value: CITY repeats the place and is left out.
        expect(notes).toContain(g.birthNote(g.address('čp. 13')));
        expect(notes).not.toContain(g.address('čp. 13, Vavřinec'));
    });

    it('keeps the house number out of the place, so the village stays one place', () => {
        expect(josef.birthPlace).toBe('Vavřinec');
        expect(Object.keys(data.places ?? {})).not.toContain('vavrinec cp 13');
    });

    it("gives each partner's age at the wedding", () => {
        const note = union(data).note ?? '';
        expect(note).toContain(g.husbandAge(g.ageUnit(25, 'y')));
        expect(note).toContain(g.wifeAge(g.ageUnit(22, 'y')));
    });

    it('says when a date was written in the Julian calendar', () => {
        expect(josef.deathDate).toBe('1946-03-12');
        expect(josef.notes).toContain(g.deathNote(g.calendarDate(g.calendars.JULIAN, '12 MAR 1946')));
    });

    it('recognises roles in other languages and keeps the word for the ones it has no name for', () => {
        const baptism = josef.events!.find(e => e.type === 'baptism')!;
        const role = (name: string) => baptism.participants!.find(p => p.name === name)!;
        expect(role('Karel Beneš').role).toBe('godparent');
        expect(role('Marie Dvořáková')).toMatchObject({ role: 'other', note: 'Midwife' });
        expect(role('Rosa Weber')).toMatchObject({ role: 'other', note: 'Hebamme' });
        const informant = josef.events!.flatMap(e => e.participants ?? []).find(p => p.name === 'Václav Novák')!;
        expect(informant).toMatchObject({ role: 'other', note: 'Informant' });
    });

    it("records the family's residence in the couple's note", () => {
        expect(union(data).note).toContain(`${g.factLabels.RESI}: čp. 12`);
    });

    it('reads a stepfather and an own mother from _FREL/_MREL', () => {
        const petr = byName(data, 'Petr');
        const anna = byName(data, 'Anna');
        expect(petr.parentRelTypes?.[josef.id]).toBe('step');
        expect(petr.parentRelTypes?.[anna.id]).toBeUndefined();
    });

    it('keeps the REFN together with its TYPE', () => {
        expect(josef.refn).toBe('P0001');
        expect(josef.refnType).toBe('strom-research:3f2c');
    });

    it('files a woman under her birth surname when the file puts the married one first', () => {
        const anna = byName(data, 'Anna');
        expect(anna.lastName).toBe('Svobodová');
        expect(anna.nameVariants).toEqual(['Anna Nováková']);
    });

    it('cites the record a name comes from on the person', () => {
        const anna = byName(data, 'Anna');
        expect(anna.sourceIds).toContain(sourceTitled(data, 'Křestní').id);
    });

    it('comes back unchanged from export and a second import', () => {
        const once = importGed(exportToGedcom(data).content);
        const twice = importGed(exportToGedcom(once).content);
        for (const d of [once, twice]) {
            const j = byName(d, 'Josef');
            expect(j.notes).toBe(josef.notes);
            expect(j.refnType).toBe('strom-research:3f2c');
            expect(union(d).note).toBe(union(data).note);
            expect(sourceTitled(d, 'Oddací').note).toBe(sourceTitled(data, 'Oddací').note);
            expect(byName(d, 'Petr').parentRelTypes?.[j.id]).toBe('step');
            expect(byName(d, 'Petr').parentRelTypes?.[byName(d, 'Anna').id]).toBeUndefined();
            expect(byName(d, 'Anna').lastName).toBe('Svobodová');
            const midwife = j.events!.flatMap(e => e.participants ?? []).find(p => p.name === 'Marie Dvořáková');
            expect(midwife).toMatchObject({ role: 'other', note: 'Midwife' });
        }
    });

    it('reads a MyHeritage empty ADDR with ADR1 junk as nothing', () => {
        const d = importGed(`0 HEAD
0 @I1@ INDI
1 NAME Romana /Test/
1 RESI
2 ADDR
3 ADR1 Email
0 TRLR`);
        const p = byName(d, 'Romana');
        expect(JSON.stringify(p)).not.toContain('Email');
    });
});
