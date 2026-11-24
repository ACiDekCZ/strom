/**
 * K052: a research writes a person's census it keeps as a custom fact as
 * `1 EVEN` / `2 TYPE Sčítání lidu`. The tree stores it as a census (data
 * version 20, migrateData); the research's version read for "Load the
 * research version?" and the other comparisons is the one the load saves,
 * so the same file read again changes nothing — no row "Census → –", no
 * added fact, the same content. A custom event of another name stays one.
 * Invented data (the Křemenáček family of Horní Bludovec).
 */
import { describe, it, expect } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { migrateData } from '../data.js';
import { contentFingerprint, stabilizeIds } from '../research-link.js';
import { diffValues, pairEvents } from '../research-changes.js';
import type { LifeEvent, Person, StromData } from '../types.js';

const UUID = '7f3e2a10-5b4c-4d8e-9f01-23456789abcd';

/** The research's file: Bořivoj's census as EVEN / TYPE, with a note and a citation; `extra` in his record. */
function researchGed(extra: string[] = [], head = 'a1b2c3d4e5f6'): string {
    return [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '2 NAME Strom Research', '1 DATE 24 NOV 2026',
        `1 _STROM_TREE ${UUID}`, `1 _STROM_HEAD ${head}`, '1 CHAR UTF-8',
        '0 @P0001@ INDI', '1 NAME Bořivoj /Křemenáček/', '1 SEX M', '1 REFN P0001', '2 TYPE strom-research', '1 FAMS @F0001@',
        '1 BIRT', '2 DATE 1851',
        '1 EVEN', '2 TYPE Sčítání lidu', '2 DATE 31 DEC 1890', '2 PLAC Horní Bludovec',
        '2 NOTE Zápis: „Křemenáček Bořivoj, hospodář“', '3 CONT Zápis: „Křemenáček Bořivoj, hospodář“', '2 SOUR @S0001@', '3 PAGE fol. 3',
        '1 EVEN', '2 TYPE Sčítání lidu', '2 DATE 31 DEC 1880', '2 PLAC Horní Bludovec',
        ...extra,
        '0 @P0002@ INDI', '1 NAME Vratislavka /Ořechovská/', '1 SEX F', '1 REFN P0002', '2 TYPE strom-research', '1 FAMS @F0001@',
        '1 EVEN', '2 TYPE Sčítání lidu', '2 DATE 31 DEC 1890', '2 PLAC Horní Bludovec',
        '1 CENS', '2 DATE 31 DEC 1890', '2 PLAC Horní Bludovec', '2 AGE 34',
        '1 EVEN', '2 TYPE Sčítání lidu 1890', '2 DATE 1890', '2 NOTE Soupis farnosti',
        '0 @F0001@ FAM', '1 HUSB @P0001@', '1 WIFE @P0002@', '1 MARR', '2 DATE 1878',
        '0 @S0001@ SOUR', '1 TITL Sčítání lidu Horní Bludovec 1890', '1 REFN S0001',
        '0 TRLR',
    ].join('\n');
}

/** The research's version as the app reads it from the file. */
const read = (text: string): StromData => convertToStrom(parseGedcom(text)).data;
/** The tree as the load stored it (DataManager.loadStromData → migrateData). */
const stored = (text: string): StromData => migrateData(read(text));
const person = (d: StromData, first: string): Person => Object.values(d.persons).find(p => p.firstName === first)!;
const kinds = (p: Person): string[] => (p.events ?? []).map(e => e.type === 'custom' ? `custom:${e.customLabel}` : e.type);

describe('the research\'s census as EVEN / TYPE "Sčítání lidu" (K052)', () => {
    it('is read as the census the tree stores; a label of another name stays a custom event', () => {
        const there = read(researchGed());
        expect(kinds(person(there, 'Bořivoj'))).toEqual(['census', 'census']);
        expect(kinds(person(there, 'Vratislavka'))).toEqual(['census', 'census', 'custom:Sčítání lidu 1890']);
        const census = person(there, 'Bořivoj').events!.find(e => e.date === '1890-12-31')!;
        expect(census.customLabel).toBeUndefined();
        expect(census.note).toBe('Zápis: „Křemenáček Bořivoj, hospodář“\nZápis: „Křemenáček Bořivoj, hospodář“');
        expect(census.place).toBe('Horní Bludovec');
        expect(census.sourceIds).toHaveLength(1);
        // What the load stores is the same as what was read.
        expect(kinds(person(stored(researchGed()), 'Vratislavka'))).toEqual(kinds(person(there, 'Vratislavka')));
    });

    it('the same file read again: "Load the research version?" has no row and no added fact, the same content', () => {
        const here = stored(researchGed());
        const there = stabilizeIds(read(researchGed([], 'f6e5d4c3b2a1')), here);
        const diff = diffValues(here, there);
        expect(diff.rows).toEqual([]);
        expect(diff.addedFacts).toBe(0);
        // The very same tree under a new head: taken without asking (researchTakeSameVersion).
        expect(contentFingerprint(there)).toBe(contentFingerprint(here));
    });

    it('a tree stored since 3.28 (its censuses converted when it was saved) pairs with the version read now', () => {
        // How 3.28–3.32 read the file: the EVEN a custom event; the load stored it converted.
        const older = read(researchGed());
        for (const p of Object.values(older.persons)) {
            for (const e of p.events ?? []) if (e.type === 'census' && !e.age) { e.type = 'custom'; e.customLabel = 'Sčítání lidu'; }
        }
        const here = migrateData(older);
        expect(kinds(person(here, 'Bořivoj'))).toEqual(['census', 'census']);
        const diff = diffValues(here, stabilizeIds(read(researchGed()), here));
        expect(diff.rows).toEqual([]);
        expect(diff.addedFacts).toBe(0);
    });

    it('a real change of the research still shows: a census gone, one more fact', () => {
        const here = stored(researchGed());
        const text = researchGed(['1 OCCU tesař']).replace('1 EVEN\n2 TYPE Sčítání lidu\n2 DATE 31 DEC 1880\n2 PLAC Horní Bludovec\n', '');
        const diff = diffValues(here, stabilizeIds(read(text), here));
        expect(diff.rows.map(r => [r.field, r.of, r.here, r.there])).toEqual([['event', 'census', '1880-12-31', '']]);
        expect(diff.addedFacts).toBe(1);
    });
});

describe('pairEvents: a custom "Census" is the census (K052)', () => {
    const ev = (id: string, type: LifeEvent['type'], date: string, extra: Partial<LifeEvent> = {}): LifeEvent => ({ id, type, date, ...extra });

    it('pairs a census here with the research\'s custom "Sčítání lidu" of the same date, not one of another label', () => {
        const here = [ev('h1', 'census', '1890-12-31', { place: 'Horní Bludovec' }), ev('h2', 'custom', '1890', { customLabel: 'Sčítání lidu 1890' })];
        const there = [ev('t1', 'custom', '1890-12-31', { customLabel: 'Sčítání lidu', place: 'Horní Bludovec' }), ev('t2', 'custom', '1890', { customLabel: 'Sčítání lidu 1890' })];
        const paired = pairEvents(here, there);
        expect(paired.get(here[0])).toBe(there[0]);
        expect(paired.get(here[1])).toBe(there[1]);
    });

    it('never pairs two censuses of the same year that differ: the one left here goes', () => {
        const here = [
            ev('h1', 'census', '1890-12-31', { place: 'Horní Bludovec', note: 'čp. 12' }),
            ev('h2', 'census', '1890-12-31', { place: 'Dolní Bludovec', note: 'čp. 4' }),
        ];
        const there = [ev('t1', 'custom', '1890-12-31', { customLabel: 'Census', place: 'Dolní Bludovec', note: 'čp. 4' })];
        const paired = pairEvents(here, there);
        expect(paired.get(here[1])).toBe(there[0]);
        expect(paired.has(here[0])).toBe(false);
    });
});
