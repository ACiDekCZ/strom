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
import { APP_VERSION, Person, StromData } from '../types.js';
import { appUnknownIsNoSurname, compareAppVersions, isAppVersion } from '../app-version.js';

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

    it('keep the surname of a line without slashes with GIVN and no SURN: the rest after the given name', () => {
        expect(readGedcomName('Petr Novotný', { givn: 'Petr' })).toEqual({ firstName: 'Petr', lastName: 'Novotný' });
        expect(readGedcomName('Jan Petr Novák', { givn: 'Jan, Petr' })).toEqual({ firstName: 'Jan Petr', lastName: 'Novák' });
        expect(readGedcomName('Marie Anna Nováková Svobodová', { givn: 'Marie Anna' }))
            .toEqual({ firstName: 'Marie Anna', lastName: 'Nováková Svobodová' });
        // A line that does not start with the GIVN splits after its first word, as without GIVN.
        expect(readGedcomName('Johann Novotný', { givn: 'Hans' })).toEqual({ firstName: 'Hans', lastName: 'Novotný' });
        // "Petra" is not "Petr" followed by a surname.
        expect(readGedcomName('Petra Nová', { givn: 'Petr' })).toEqual({ firstName: 'Petr', lastName: 'Nová' });
        expect(readGedcomName('Ing. Petr Novotný', { givn: 'Petr', npfx: 'Ing.' }))
            .toEqual({ firstName: 'Petr', lastName: 'Novotný', titleBefore: 'Ing.' });
    });

    it('keep a title the tags name (NPFX / NSFX) in a field of its own (T07)', () => {
        expect(readGedcomName('Ing. Jan /Novák/ ml.', { npfx: 'Ing.', givn: 'Jan', surn: 'Novák', nsfx: 'ml.' }))
            .toEqual({ firstName: 'Jan', lastName: 'Novák', titleBefore: 'Ing.', titleAfter: 'ml.' });
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

    it('reads a NAME line without slashes, with GIVN and no SURN, with its surname', () => {
        const file = [
            '0 HEAD', '1 SOUR MYHERITAGE', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
            '0 @I1@ INDI', '1 NAME Petr Novotný', '2 GIVN Petr', '1 SEX M',
            '0 TRLR',
        ].join('\n');
        expect(people(importGed(file)).map(nameOf)).toEqual(['Petr | Novotný']);
    });

    it('brings a name typed in Strom back from the app\'s own file unchanged', () => {
        const own = ged.replace('1 SOUR MYHERITAGE', '1 SOUR STROM');
        const persons = people(importGed(own));
        expect(nameOf(persons[3])).toBe('Mrtvě narozený | Chrpa');
        expect(nameOf(persons[0])).toBe('? | Chrpa');
    });
});

describe('a person of no name and no surname (T08)', () => {
    const tree: StromData = {
        persons: {
            ['p1' as Person['id']]: {
                id: 'p1' as Person['id'], firstName: '?', lastName: '', gender: 'male', isPlaceholder: false,
                partnerships: [], parentIds: [], childIds: [],
            },
        },
        partnerships: {},
    };
    const file = (source: string, name: string[]): string => [
        '0 HEAD', `1 SOUR ${source}`, '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
        '0 @I1@ INDI', ...name, '1 SEX M', '0 TRLR',
    ].join('\n');

    it('is written with an empty pair of slashes, never a surname "Unknown", and comes back the same', () => {
        const out = exportToGedcom(tree).content;
        expect(out).toContain('1 NAME ? //');
        expect(out).not.toContain('Unknown');
        const [again] = people(importGed(out));
        expect(nameOf(again)).toBe('? | ');
        // A person the app knows, not a stand-in (that one the app writes "1 NAME //").
        expect(again.isPlaceholder).toBe(false);
    });

    it('reads the "? /Unknown/" the app wrote before as no surname, from a file of Strom\'s own', () => {
        for (const source of ['STROM', 'STROM_RESEARCH']) {
            expect(people(importGed(file(source, ['1 NAME ? /Unknown/']))).map(nameOf)).toEqual(['? | ']);
            expect(people(importGed(file(source, ['1 NAME ? /Unknown/', '2 GIVN ?']))).map(nameOf)).toEqual(['? | ']);
        }
        expect(people(importGed(file('STROM', ['1 NAME ? /Unknown/'])))[0].isPlaceholder).toBe(false);
    });

    it('keeps the app\'s stand-in ("1 NAME //") a stand-in, and "? //" of another program too', () => {
        expect(people(importGed(file('STROM', ['1 NAME //'])))[0].isPlaceholder).toBe(true);
        expect(people(importGed(file('MYHERITAGE', ['1 NAME ? //'])))[0].isPlaceholder).toBe(true);
    });

    it('keeps a surname Unknown someone gave: with its SURN, with a name, or in another program\'s file', () => {
        expect(people(importGed(file('STROM', ['1 NAME ? /Unknown/', '2 GIVN ?', '2 SURN Unknown']))).map(nameOf)).toEqual(['? | Unknown']);
        expect(people(importGed(file('STROM', ['1 NAME Jan /Unknown/']))).map(nameOf)).toEqual(['Jan | Unknown']);
        expect(people(importGed(file('MYHERITAGE', ['1 NAME ? /Unknown/']))).map(nameOf)).toEqual(['? | Unknown']);
    });
});

describe('"? /Unknown/" by the version of the app that wrote the file (T08, N13)', () => {
    /** A file of the app: its version as HEAD > SOUR STROM > VERS (none: `null`). */
    const appFile = (vers: string | null, name: string[], source = 'STROM'): string => [
        '0 HEAD', `1 SOUR ${source}`, ...(vers === null ? [] : [`2 VERS ${vers}`]), '2 NAME Strom Family Tree',
        '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
        '0 @I1@ INDI', ...name, '1 SEX M', '0 TRLR',
    ].join('\n');
    const read = (ged: string): string[] => people(importGed(ged)).map(nameOf);

    it('the export says the app\'s version in its header', () => {
        const out = exportToGedcom({ persons: {}, partnerships: {} }).content;
        expect(out).toMatch(new RegExp(`^0 HEAD\n1 SOUR STROM\n2 VERS ${APP_VERSION.replace(/[.+]/g, '\\$&')}\n2 NAME Strom Family Tree\n`));
        expect(out).not.toContain('2 VERS 1.0');
        expect(isAppVersion(APP_VERSION)).toBe(true);
    });

    it('an app of no version it names (1.0, none, not a version) or before 3.10.0-beta.7: no surname', () => {
        for (const vers of ['1.0', null, '', 'Strom', '3.10', '3.9.2', '3.10.0-beta.6', '3.10.0-alpha.9']) {
            expect(read(appFile(vers, ['1 NAME ? /Unknown/'])), String(vers)).toEqual(['? | ']);
        }
    });

    it('an app from 3.10.0-beta.7 on (it writes "? //"): the surname Unknown someone typed', () => {
        for (const vers of ['3.10.0-beta.7', '3.10.0-beta.8', '3.10.0-beta.10', '3.10.0-rc.1', '3.10.0', '3.10.1', '4.0.0', '3.10.0+build.5']) {
            expect(read(appFile(vers, ['1 NAME ? /Unknown/'])), vers).toEqual(['? | Unknown']);
        }
    });

    it('"? //" is no surname in every version; another program\'s and the research\'s files as before', () => {
        for (const vers of ['1.0', null, '3.10.0-beta.6', '3.10.0-beta.7', '3.10.0']) {
            expect(read(appFile(vers, ['1 NAME ? //'])), String(vers)).toEqual(['? | ']);
        }
        // Another program: Unknown is a surname, whatever its VERS.
        expect(read(appFile('1.0', ['1 NAME ? /Unknown/'], 'MYHERITAGE'))).toEqual(['? | Unknown']);
        // The research's file (its own version under SOUR): its "? /Unknown/" stays no surname.
        expect(read(appFile('1.13.0', ['1 NAME ? /Unknown/'], 'STROM_RESEARCH'))).toEqual(['? | ']);
        // A VERS of another header line (GEDC) is not the app's.
        expect(read(appFile(null, ['1 NAME ? /Unknown/']).replace('2 VERS 5.5.1', '2 VERS 3.10.0'))).toEqual(['? | ']);
    });

    it('"?" with the surname Unknown entered in the app survives export and import', () => {
        const tree: StromData = {
            persons: {
                ['p1' as Person['id']]: {
                    id: 'p1' as Person['id'], firstName: '?', lastName: 'Unknown', gender: 'male', isPlaceholder: false,
                    partnerships: [], parentIds: [], childIds: [],
                },
                ['p2' as Person['id']]: {
                    id: 'p2' as Person['id'], firstName: '?', lastName: '', gender: 'female', isPlaceholder: false,
                    partnerships: [], parentIds: [], childIds: [],
                },
            },
            partnerships: {},
        };
        const out = exportToGedcom(tree).content;
        expect(out).toContain('1 NAME ? /Unknown/');
        expect(out).toContain('1 NAME ? //');
        const again = people(importGed(out));
        expect(again.map(nameOf)).toEqual(['? | Unknown', '? | ']);
        expect(again.every(p => !p.isPlaceholder)).toBe(true);
    });

    it('reads the research\'s surname Unknown (with its SURN) and its "? /Unknown/" without one as no surname', () => {
        const research = (name: string[]): string => appFile('1.13.0-beta.3', name, 'STROM_RESEARCH');
        expect(read(research(['1 NAME ? /Unknown/', '2 GIVN ?', '2 SURN Unknown']))).toEqual(['? | Unknown']);
        expect(read(research(['1 NAME ? /Unknown/']))).toEqual(['? | ']);
        expect(read(research(['1 NAME ? /Unknown/', '2 GIVN ?']))).toEqual(['? | ']);
        expect(read(research(['1 NAME ? //']))).toEqual(['? | ']);
    });

    it('writes "?" with the surname Unknown with its GIVN and SURN, so a reader of any version keeps the surname', () => {
        const person = (id: string, extra: Partial<Person>): Person => ({
            id: id as Person['id'], firstName: '?', lastName: 'Unknown', gender: 'male', isPlaceholder: false,
            partnerships: [], parentIds: [], childIds: [], ...extra,
        });
        const tree: StromData = {
            persons: {
                ['p1' as Person['id']]: person('p1', {}),
                ['p2' as Person['id']]: person('p2', { lastName: '' }),
                ['p3' as Person['id']]: person('p3', { titleBefore: 'Ing.' }),
                ['p4' as Person['id']]: person('p4', { firstName: 'Jan' }),
            },
            partnerships: {},
        };
        const out = exportToGedcom(tree).content;
        // The name lines of the people (the submitter's record has a NAME too).
        const names = out.split(/\r?\n/).filter(l => /^(1 NAME|2 (NPFX|GIVN|SURN|NSFX)) /.test(l) && l !== '1 NAME Strom User');
        expect(names).toEqual([
            '1 NAME ? /Unknown/', '2 GIVN ?', '2 SURN Unknown',
            '1 NAME ? //',
            '1 NAME Ing. ? /Unknown/', '2 NPFX Ing.', '2 GIVN ?', '2 SURN Unknown',
            '1 NAME Jan /Unknown/',
        ]);
        const expected = ['? | Unknown', '? | ', '? | Unknown', 'Jan | Unknown'];
        expect(read(out)).toEqual(expected);
        // An app before 3.10.0-beta.7 and the research read "? /Unknown/" alone as no surname; the SURN keeps it.
        expect(read(out.replace(`2 VERS ${APP_VERSION}`, '2 VERS 3.9.2'))).toEqual(expected);
        expect(read(out.replace('1 SOUR STROM\n', '1 SOUR STROM_RESEARCH\n'))).toEqual(expected);
    });

    it('compares app versions by semver precedence', () => {
        const order = ['3.9.0', '3.10.0-alpha.1', '3.10.0-beta.6', '3.10.0-beta.7', '3.10.0-beta.9', '3.10.0-beta.10',
            '3.10.0-rc.1', '3.10.0-rc.2', '3.10.0', '3.10.1', '3.11.0', '10.0.0'];
        for (let i = 0; i < order.length; i++) {
            for (let j = 0; j < order.length; j++) {
                expect(Math.sign(compareAppVersions(order[i], order[j])), `${order[i]} vs ${order[j]}`).toBe(Math.sign(i - j));
            }
        }
        expect(compareAppVersions('3.10.0-beta', '3.10.0-beta.1')).toBeLessThan(0);
        expect(compareAppVersions('3.10.0+a', '3.10.0+b')).toBe(0);
        expect(isAppVersion('1.0')).toBe(false);
        expect(appUnknownIsNoSurname(undefined)).toBe(true);
        expect(appUnknownIsNoSurname(' 3.10.0-beta.7 ')).toBe(false);
    });
});
