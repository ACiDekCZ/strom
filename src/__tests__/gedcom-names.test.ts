/**
 * Reading a GEDCOM name by the rules shared with the research CLI (T08):
 * GIVN / SURN first, the surname as the last pair of slashes, "N/A" and the
 * like as "?", a description in place of a name moved to the note.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { DESCRIPTIONS, NO_NAME, noName, notAName, parseName, readGedcomName } from '../gedcom-names.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { Person, StromData } from '../types.js';

const importGed = (ged: string): StromData => convertToStrom(parseGedcom(ged)).data;
const people = (data: StromData): Person[] => Object.values(data.persons);
const nameOf = (p: Person): string => `${p.firstName} | ${p.lastName}`;

describe('the list shared with the research', () => {
    it('pins NO_NAME word for word (the research reads the same list)', () => {
        expect([...NO_NAME]).toEqual([
            'n a', 'nn', 'n n', 'nomen nescio', 'unknown', 'unnamed', 'no name', 'noname',
            'neznamy', 'neznama', 'nezname', 'nezjisteno', 'bez jmena', 'bezejmenny', 'bezejmenna',
            'unbekannt', 'namenlos', 'ohne namen', 'nieznany', 'nieznana', 'nieznane', 'bez imienia',
            'inconnu', 'inconnue', 'sans nom',
        ]);
    });

    it('pins DESCRIPTIONS word for word', () => {
        expect([...DESCRIPTIONS]).toEqual([
            'nn', 'n n', 'nomen nescio', 'unnamed', 'unknown', 'stillborn', 'still born', 'infant', 'child', 'son', 'daughter',
            'mrtve narozeny', 'mrtve narozena', 'mrtve narozene', 'mrtvy narozen', 'mrtva narozena', 'mrtvorozeny', 'mrtvorozena', 'mrtvorozene',
            'nepokrteny', 'nepokrtena', 'nepokrtene', 'nekrtenec', 'bez jmena', 'neznamy', 'neznama', 'dite', 'syn', 'dcera',
            'totgeboren', 'totgeborenes kind', 'ungetauft', 'namenlos', 'kind', 'sohn', 'tochter',
            'martwo urodzony', 'martwo urodzona', 'martwo urodzone', 'nieochrzczony', 'nieochrzczona', 'dziecko',
            'sans nom', 'mort ne', 'mort nee', 'inconnu', 'inconnue', 'enfant', 'proles', 'infans', 'filius', 'filia',
        ]);
    });

    // Where the research's source is at hand (the author's machine), the
    // lists are compared with it directly; elsewhere this is skipped.
    const researchPeople = join(homedir(), 'Projects', 'strom-research', 'src', 'core', 'people.ts');
    it.skipIf(!existsSync(researchPeople))('matches the research source when it is at hand', () => {
        const src = readFileSync(researchPeople, 'utf8');
        const list = (re: RegExp): string[] => {
            const body = re.exec(src)?.[1] ?? '';
            return [...body.matchAll(/"([^"]*)"/g)].map(m => m[1]);
        };
        expect([...NO_NAME]).toEqual(list(/export const NO_NAME = \[([\s\S]*?)\];/));
        expect([...DESCRIPTIONS]).toEqual(list(/const DESCRIPTIONS = new Set\(\[([\s\S]*?)\]\)/));
    });
});

describe('the surname is the last pair of slashes', () => {
    it('reads "N/A /Chrpa/" as N/A + Chrpa, not N + "A Chrpa"', () => {
        expect(parseName('N/A /Chrpa/')).toEqual({ firstName: 'N/A', lastName: 'Chrpa' });
        expect(parseName('N.N. /Novák/')).toEqual({ firstName: 'N.N.', lastName: 'Novák' });
    });

    it('opens a pair only at the start or after a space', () => {
        expect(parseName('/⟨K/Č⟩emenská/')).toEqual({ firstName: '', lastName: '⟨K/Č⟩emenská' });
        expect(parseName('Anna /⟨K/Č⟩emenská/')).toEqual({ firstName: 'Anna', lastName: '⟨K/Č⟩emenská' });
        expect(parseName('Jan/Petr /Novák/')).toEqual({ firstName: 'Jan/Petr', lastName: 'Novák' });
    });

    it('keeps the app\'s conventions: a suffix joins the surname, no slashes split at the first space', () => {
        expect(parseName('John /Smith/ Jr.')).toEqual({ firstName: 'John', lastName: 'Smith Jr.' });
        expect(parseName('//')).toEqual({ firstName: '', lastName: '' });
        expect(parseName('John Smith')).toEqual({ firstName: 'John', lastName: 'Smith' });
        expect(parseName('N/A')).toEqual({ firstName: 'NA', lastName: '' });
    });
});

describe('what stands for no name is "?"', () => {
    it('recognises every placeholder without case, diacritics and punctuation', () => {
        for (const w of ['N/A', 'n.a.', 'NN', 'N.N.', 'N. N.', 'Nomen nescio', 'Unknown', 'UNNAMED', 'No name', 'NoName',
            'Neznámý', 'Neznámá', 'Neznámé', 'Nezjištěno', 'Bez jména', 'Bezejmenný', 'Bezejmenná',
            'Unbekannt', 'Namenlos', 'Ohne Namen', 'Nieznany', 'Nieznana', 'Nieznane', 'Bez imienia',
            'Inconnu', 'Inconnue', 'Sans nom', '?', '—', '??', '-']) {
            expect(noName(w), w).toBe(true);
        }
        // "NA" folds to "na", which is not "n a": only the written N/A, N.A. count
        expect(noName('NA')).toBe(false);
        expect(noName('Nana')).toBe(false);
        expect(noName('Jan')).toBe(false);
        expect(noName('')).toBe(false);
    });

    it('keeps the surname', () => {
        expect(readGedcomName('N/A /Chrpa/')).toMatchObject({ firstName: '?', lastName: 'Chrpa' });
        expect(readGedcomName('N.N. /Novák/')).toMatchObject({ firstName: '?', lastName: 'Novák' });
        expect(readGedcomName('Neznámá /Kovářová/')).toMatchObject({ firstName: '?', lastName: 'Kovářová' });
        expect(readGedcomName('? /Novák/')).toEqual({ firstName: '?', lastName: 'Novák' });
        expect(readGedcomName('N/A')).toMatchObject({ firstName: '?', lastName: '' });
    });
});

describe('GIVN and SURN come before the NAME line', () => {
    it('take the parts over the line', () => {
        expect(readGedcomName('N/A /Chrpa/', { givn: 'Jan', surn: 'Chrpa' })).toEqual({ firstName: 'Jan', lastName: 'Chrpa' });
        expect(readGedcomName('Неизвестный /Иванов/', { givn: 'Иван', surn: 'Иванов' })).toEqual({ firstName: 'Иван', lastName: 'Иванов' });
        expect(readGedcomName('Jan Petr Novák', { givn: 'Jan Petr', surn: 'Novák' })).toEqual({ firstName: 'Jan Petr', lastName: 'Novák' });
    });

    it('apply the placeholder rule to GIVN as well', () => {
        expect(readGedcomName('Marie /Chrpová/', { givn: 'N.N.', surn: 'Chrpová' })).toMatchObject({ firstName: '?', lastName: 'Chrpová' });
    });

    it('read commas in GIVN as spaces', () => {
        expect(readGedcomName('Jan Petr Novák', { givn: 'Jan, Petr', surn: 'Novák' })).toEqual({ firstName: 'Jan Petr', lastName: 'Novák' });
    });

    it('keep the line\'s surname for a SURN list of surnames', () => {
        expect(readGedcomName('Anna /Nováková Svobodová/', { givn: 'Anna', surn: 'Nováková, Svobodová' }))
            .toEqual({ firstName: 'Anna', lastName: 'Nováková Svobodová' });
    });

    it('keep the line\'s surname for a surname with a prefix (SPFX)', () => {
        expect(readGedcomName('Willem /van Berg/', { givn: 'Willem', spfx: 'van', surn: 'Berg' }))
            .toEqual({ firstName: 'Willem', lastName: 'van Berg' });
    });

    it('take GIVN alone with the line\'s surname, SURN alone with the line\'s given name', () => {
        expect(readGedcomName('Johann /Bauer/', { givn: 'Hans' })).toEqual({ firstName: 'Hans', lastName: 'Bauer' });
        expect(readGedcomName('Hans', { givn: 'Hans' })).toEqual({ firstName: 'Hans', lastName: '' });
        expect(readGedcomName('Hans /Baur/', { surn: 'Bauer' })).toEqual({ firstName: 'Hans', lastName: 'Bauer' });
    });

    it('keep a title the tags name (NPFX / NSFX) where the line had it', () => {
        expect(readGedcomName('Ing. Jan /Novák/ ml.', { npfx: 'Ing.', givn: 'Jan', surn: 'Novák', nsfx: 'ml.' }))
            .toEqual({ firstName: 'Ing. Jan', lastName: 'Novák ml.' });
    });
});

describe('a description in place of a name goes to the note', () => {
    it('makes the name "?" and keeps the words as written', () => {
        expect(readGedcomName('Mrtvě narozený /Chrpa/')).toEqual({ firstName: '?', lastName: 'Chrpa', description: 'Mrtvě narozený' });
        expect(readGedcomName('Totgeboren /Bauer/')).toEqual({ firstName: '?', lastName: 'Bauer', description: 'Totgeboren' });
        expect(readGedcomName('(dítě) /Novák/')).toEqual({ firstName: '?', lastName: 'Novák', description: '(dítě)' });
        expect(readGedcomName('Syn /Novák/', { givn: 'Syn', surn: 'Novák' })).toEqual({ firstName: '?', lastName: 'Novák', description: 'Syn' });
        // the research's notAName covers its NO_NAME as well; bare punctuation leaves nothing to keep
        expect(readGedcomName('N.N. /Novák/').description).toBe('N.N.');
        expect(readGedcomName('? /Novák/').description).toBeUndefined();
        expect(notAName('Jan')).toBe(false);
    });

    it('leaves the words a name in a file Strom wrote itself', () => {
        expect(readGedcomName('Syn /Novák/', {}, { descriptions: false })).toEqual({ firstName: 'Syn', lastName: 'Novák' });
        expect(readGedcomName('N/A /Chrpa/', {}, { descriptions: false })).toEqual({ firstName: '?', lastName: 'Chrpa' });
    });
});

describe('import of a family tree file (T08)', () => {
    const ged = [
        '0 HEAD', '1 SOUR MYHERITAGE', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
        '0 @I1@ INDI', '1 NAME N/A /Chrpa/', '1 SEX M',
        '0 @I2@ INDI', '1 NAME Marie /Chrpová/', '2 GIVN N.N.', '2 SURN Chrpová', '1 SEX F',
        '0 @I3@ INDI', '1 NAME Jan Petr Novák', '2 GIVN Jan, Petr', '2 SURN Novák', '1 SEX M',
        '0 @I4@ INDI', '1 NAME Mrtvě narozený /Chrpa/', '1 SEX M', '1 NOTE Pohřben u kostela.',
        '0 @I5@ INDI', '1 NAME Неизвестный /Иванов/', '2 GIVN Иван', '2 SURN Иванов', '1 SEX M',
        '0 @I6@ INDI', '1 NAME Willem /van Berg/', '2 GIVN Willem', '2 SPFX van', '2 SURN Berg', '1 SEX M',
        '0 @I7@ INDI', '1 NAME /⟨K/Č⟩emenská/', '1 SEX F',
        '0 TRLR',
    ].join('\n');

    it('reads the names as the research does', () => {
        const persons = people(importGed(ged));
        expect(persons.map(nameOf)).toEqual([
            '? | Chrpa', '? | Chrpová', 'Jan Petr | Novák', '? | Chrpa', 'Иван | Иванов', 'Willem | van Berg', '? | ⟨K/Č⟩emenská',
        ]);
        // a person with a surname is a known person, not a stand-in
        expect(persons.every(p => !p.isPlaceholder)).toBe(true);
    });

    it('appends the description to the person\'s note without losing the note', () => {
        const persons = people(importGed(ged));
        expect(persons[3].notes).toBe('Pohřben u kostela.\nMrtvě narozený');
        expect(persons[0].notes).toBe('N/A');
        expect(persons[4].notes).toBeUndefined();
    });

    it('writes the names back as before and reads them back the same', () => {
        const first = importGed(ged);
        const out = exportToGedcom(first).content;
        expect(out).toContain('1 NAME ? /Chrpa/');
        expect(out).toContain('1 NAME ? /⟨K/Č⟩emenská/');
        const again = people(importGed(out));
        expect(again.map(nameOf)).toEqual(people(first).map(nameOf));
        expect(again.map(p => p.notes)).toEqual(people(first).map(p => p.notes));
    });

    it('brings a name typed in Strom back from the app\'s own file unchanged', () => {
        const own = ged.replace('1 SOUR MYHERITAGE', '1 SOUR STROM');
        const persons = people(importGed(own));
        expect(nameOf(persons[3])).toBe('Mrtvě narozený | Chrpa');
        expect(nameOf(persons[0])).toBe('? | Chrpa');
    });
});
