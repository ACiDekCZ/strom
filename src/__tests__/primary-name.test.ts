/**
 * The surname a person goes by (spec 024, K1.1, K1.4–K1.6):
 * Person.primaryName 'birth' | 'married' — a person with a married surname
 * who goes by the birth one again (e.g. after a divorce) shows the birth
 * surname, the detail with "(dříve Zástěrová)"; GEDCOM `2 _STROM_PRIMARY Y`
 * under the chosen NAME in and out; carried by edits, merges, the research's
 * versions, privacy, the CSV and the family book. Invented data only
 * (e2e/fixtures/research-primary-*.ged were written by the research's CLI).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { DataManager, migrateData } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { mergePersonData } from '../merge/executor.js';
import { applyLivingPrivacy } from '../privacy.js';
import { diffValues } from '../research-changes.js';
import { keepMarriedSurname, keepPrimaryName, PRIMARY_NAME_FEATURE, stabilizeIds } from '../research-link.js';
import {
    shownName, shownNameFull, shownNameParts, shownSurnameIsBirth, nameHtml, formerNoteText,
} from '../person-name.js';
import { hiddenSurnameMatchHtml } from '../person-picker.js';
import { buildPersonsCsv } from '../csv-export.js';
import { buildFamilyBook } from '../book.js';
import { PRIMARY_NAME_TAG } from '../gedcom-names.js';
import { setLanguage } from '../strings.js';
import {
    Person, PrimaryName, StromData, SurnameDisplay, TreeId, toPersonId, toPartnershipId, isPrimaryName, mergedPrimaryName,
} from '../types.js';

const fixture = (name: string): string =>
    readFileSync(new URL(`../../e2e/fixtures/research-primary-${name}.ged`, import.meta.url), 'utf8');
const importGed = (ged: string): StromData => convertToStrom(parseGedcom(ged)).data;
const people = (data: StromData): Person[] => Object.values(data.persons);
const GED = (lines: string[], source = 'MYHERITAGE'): string =>
    ['0 HEAD', `1 SOUR ${source}`, '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8', ...lines, '0 TRLR'].join('\n');
const byFirst = (data: StromData, first: string): Person => people(data).find(p => p.firstName === first)!;
const byRefn = (data: StromData, refn: string): Person => people(data).find(p => p.refn === refn)!;
/** The NAME lines of a person's record (by the given name) with their level-2 lines. */
const nameBlock = (ged: string, first: string): string[] => {
    const lines = ged.split(/\r?\n/);
    const out: string[] = [];
    for (let i = lines.findIndex(l => l.startsWith(`1 NAME ${first}`)); i >= 0 && i < lines.length; i++) {
        if (lines[i].startsWith('0 ') || (lines[i].startsWith('1 ') && !lines[i].startsWith('1 NAME'))) break;
        out.push(lines[i]);
    }
    return out;
};

function person(id: string, firstName: string, lastName: string, extra: Partial<Person> = {}): Person {
    return {
        id: toPersonId(id), firstName, lastName, gender: 'female', isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [], ...extra,
    };
}
const tree = (...ps: Person[]): StromData => ({
    persons: Object.fromEntries(ps.map(p => [p.id, p])) as StromData['persons'],
    partnerships: {},
});
const jana = (primaryName?: PrimaryName, extra: Partial<Person> = {}): Person =>
    person('j', 'Jana', 'Lhotová', { marriedSurname: 'Zástěrová', ...(primaryName ? { primaryName } : {}), ...extra });

beforeEach(() => setLanguage('cs'));
afterEach(() => { vi.restoreAllMocks(); setLanguage('cs'); });

describe('the name rule table (one place: person-name.ts)', () => {
    const rows: [SurnameDisplay, PrimaryName | undefined, string, string][] = [
        // setting, primaryName, the name with its note (detail), the name alone (cards)
        ['birth', undefined, 'Jana Lhotová', 'Jana Lhotová'],
        ['birth', 'married', 'Jana Lhotová', 'Jana Lhotová'],
        ['birth', 'birth', 'Jana Lhotová', 'Jana Lhotová'],
        ['both', undefined, 'Jana Zástěrová (roz. Lhotová)', 'Jana Zástěrová'],
        ['both', 'married', 'Jana Zástěrová (roz. Lhotová)', 'Jana Zástěrová'],
        ['both', 'birth', 'Jana Lhotová (dříve Zástěrová)', 'Jana Lhotová'],
        ['married', undefined, 'Jana Zástěrová', 'Jana Zástěrová'],
        ['married', 'married', 'Jana Zástěrová', 'Jana Zástěrová'],
        ['married', 'birth', 'Jana Lhotová (dříve Zástěrová)', 'Jana Lhotová'],
    ];
    for (const [display, pn, full, name] of rows) {
        it(`${display} + ${pn ?? 'none'}: ${full}`, () => {
            const p = jana(pn);
            expect(shownName(p, '', true, display)).toBe(name);
            expect(shownNameFull(p, '', true, display)).toBe(full);
            const parts = shownNameParts(p, '', true, display);
            // "roz." and "dříve" never come together.
            expect(!!parts.birthNote && !!parts.formerNote).toBe(false);
            expect(parts.formerNote).toBe(full.includes('dříve') ? 'Zástěrová' : '');
            expect(shownSurnameIsBirth(p, display)).toBe(name === 'Jana Lhotová');
        });
    }

    it('without a married surname the choice means nothing', () => {
        const p = person('j', 'Jana', 'Lhotová', { primaryName: 'birth' });
        for (const display of ['birth', 'both', 'married'] as const) {
            expect(shownNameFull(p, '', true, display)).toBe('Jana Lhotová');
            expect(shownNameParts(p, '', true, display)).toMatchObject({ birthNote: '', formerNote: '' });
            expect(shownSurnameIsBirth(p, display)).toBe(false);
        }
        const married = person('j', 'Jana', 'Lhotová', { primaryName: 'married' });
        expect(shownName(married, '', true, 'married')).toBe('Jana Lhotová');
    });

    it('a married surname equal to the birth one: no note', () => {
        const p = person('j', 'Jana', 'Lhotová', { marriedSurname: 'Lhotová', primaryName: 'birth' });
        for (const display of ['birth', 'both', 'married'] as const) {
            expect(shownNameFull(p, '', true, display)).toBe('Jana Lhotová');
            expect(nameHtml(p, { display, show: true, former: true })).toBe('Jana Lhotová');
        }
    });

    it('a placeholder has no married surname, so no choice either', () => {
        const p = jana('birth', { isPlaceholder: true, firstName: '?' });
        expect(shownNameFull(p, '', true, 'both')).toBe('? Lhotová');
        expect(shownNameParts(p, '', true, 'married').formerNote).toBe('');
        expect(shownSurnameIsBirth(p, 'birth')).toBe(false);
    });

    it('the note text in each language', () => {
        expect(formerNoteText('Zástěrová')).toBe('dříve Zástěrová');
        expect(formerNoteText('')).toBe('');
        setLanguage('en');
        expect(shownNameFull(jana('birth'), '', true, 'both')).toBe('Jana Lhotová (formerly Zástěrová)');
        setLanguage('de');
        expect(shownNameFull(jana('birth'), '', true, 'married')).toBe('Jana Lhotová (früher Zástěrová)');
    });

    it('titles stay where they are', () => {
        const p = jana('birth', { titleBefore: 'Ing.', titleAfter: 'Ph.D.' });
        expect(shownNameFull(p, '', true, 'both')).toBe('Ing. Jana Lhotová Ph.D. (dříve Zástěrová)');
        expect(shownNameFull(p, '', false, 'both')).toBe('Jana Lhotová (dříve Zástěrová)');
    });
});

describe('nameHtml and the former surname', () => {
    it('cards (no former) show the name alone; the detail asks for "(dříve …)"', () => {
        const p = jana('birth');
        expect(nameHtml(p, { display: 'both', show: true })).toBe('Jana Lhotová');
        expect(nameHtml(p, { display: 'both', show: true, former: true }))
            .toBe('<span class="pn-main">Jana Lhotová</span> <span class="pn-note pn-note--former">(dříve Zástěrová)</span>');
        expect(nameHtml(p, { display: 'married', show: true, former: true, note: 'line' }))
            .toBe('<span class="pn-main">Jana Lhotová</span><span class="pn-note pn-note--former pn-note--line">dříve Zástěrová</span>');
        expect(nameHtml(p, { display: 'both', show: true, former: true, note: 'fit' }))
            .toBe('<span class="pn-fit"><span class="pn-main">Jana Lhotová</span><span class="pn-note pn-note--former">(dříve Zástěrová)</span></span>');
        expect(nameHtml(p, { display: 'both', show: true, former: true, note: 'none' })).toBe('Jana Lhotová');
        // The setting 'birth' hides the married surname everywhere: no "dříve".
        expect(nameHtml(p, { display: 'birth', show: true, former: true })).toBe('Jana Lhotová');
    });

    it('"roz." is what it was, with former asked or not', () => {
        const expected = '<span class="pn-main">Jana Zástěrová</span> <span class="pn-note">(roz. Lhotová)</span>';
        expect(nameHtml(jana(), { display: 'both', show: true })).toBe(expected);
        expect(nameHtml(jana('married'), { display: 'both', show: true, former: true })).toBe(expected);
    });

    it('escapes the surname', () => {
        const p = jana('birth', { marriedSurname: '<b>' });
        expect(nameHtml(p, { display: 'both', show: true, former: true })).toContain('(dříve &lt;b&gt;)');
    });
});

describe('GEDCOM out: 2 _STROM_PRIMARY Y under the chosen NAME', () => {
    it('birth: under the first NAME; married: under the married NAME; none: no mark', () => {
        expect(PRIMARY_NAME_TAG).toBe('_STROM_PRIMARY');
        expect(nameBlock(exportToGedcom(tree(jana('birth')), 'T').content, 'Jana'))
            .toEqual(['1 NAME Jana /Lhotová/', '2 _STROM_PRIMARY Y', '1 NAME Jana /Zástěrová/', '2 TYPE married']);
        expect(nameBlock(exportToGedcom(tree(jana('married')), 'T').content, 'Jana'))
            .toEqual(['1 NAME Jana /Lhotová/', '1 NAME Jana /Zástěrová/', '2 TYPE married', '2 _STROM_PRIMARY Y']);
        expect(nameBlock(exportToGedcom(tree(jana()), 'T').content, 'Jana'))
            .toEqual(['1 NAME Jana /Lhotová/', '1 NAME Jana /Zástěrová/', '2 TYPE married']);
    });

    it('no mark without a married surname, and none for the research either way', () => {
        const ged = exportToGedcom(tree(person('j', 'Jana', 'Lhotová', { primaryName: 'birth' })), 'T').content;
        expect(ged).not.toContain('_STROM_PRIMARY');
        const research = exportToGedcom(tree(jana('birth', { refn: 'P0001' })), 'T',
            { research: { id: '0b4c7a52-1c1f-4d7e-9a53-2f4a3c1e8b10' } }).content;
        expect(nameBlock(research, 'Jana'))
            .toEqual(['1 NAME Jana /Lhotová/', '2 _STROM_PRIMARY Y', '1 NAME Jana /Zástěrová/', '2 TYPE married']);
    });
});

describe('GEDCOM in: the mark', () => {
    const indi = (...names: string[]): string => GED(['0 @I1@ INDI', ...names, '1 SEX F']);

    it('on the birth name gives birth, on the married name married', () => {
        expect(byFirst(importGed(indi('1 NAME Jana /Lhotová/', '2 _STROM_PRIMARY Y', '1 NAME Jana /Zástěrová/', '2 TYPE married')), 'Jana'))
            .toMatchObject({ lastName: 'Lhotová', marriedSurname: 'Zástěrová', primaryName: 'birth' });
        expect(byFirst(importGed(indi('1 NAME Jana /Lhotová/', '1 NAME Jana /Zástěrová/', '2 TYPE married', '2 _STROM_PRIMARY Y')), 'Jana'))
            .toMatchObject({ lastName: 'Lhotová', marriedSurname: 'Zástěrová', primaryName: 'married' });
    });

    it('Y / yes in any case; anything else is no mark; the first mark counts', () => {
        for (const v of ['y', 'YES', 'Yes']) {
            expect(byFirst(importGed(indi('1 NAME Jana /Lhotová/', `2 _STROM_PRIMARY ${v}`, '1 NAME Jana /Zástěrová/', '2 TYPE married')), 'Jana').primaryName).toBe('birth');
        }
        for (const v of ['N', '', '1']) {
            expect('primaryName' in byFirst(importGed(indi('1 NAME Jana /Lhotová/', `2 _STROM_PRIMARY ${v}`, '1 NAME Jana /Zástěrová/', '2 TYPE married')), 'Jana')).toBe(false);
        }
        expect(byFirst(importGed(indi(
            '1 NAME Jana /Lhotová/', '2 _STROM_PRIMARY Y', '1 NAME Jana /Zástěrová/', '2 TYPE married', '2 _STROM_PRIMARY Y',
        )), 'Jana').primaryName).toBe('birth');
    });

    it('on another name (a spelling) gives nothing, and the spelling stays', () => {
        const p = byFirst(importGed(indi(
            '1 NAME Jana /Lhotová/', '1 NAME Jana /Zástěrová/', '2 TYPE married', '1 NAME Janička /Lhotová/', '2 _STROM_PRIMARY Y',
        )), 'Jana');
        expect(p).toMatchObject({ marriedSurname: 'Zástěrová', nameVariants: ['Janička Lhotová'] });
        expect('primaryName' in p).toBe(false);
    });

    it('without a married surname a mark means nothing', () => {
        const p = byFirst(importGed(indi('1 NAME Jana /Lhotová/', '2 _STROM_PRIMARY Y')), 'Jana');
        expect('primaryName' in p).toBe(false);
    });

    it('follows the married name put first in the file (another NAME with TYPE birth)', () => {
        expect(byFirst(importGed(indi('1 NAME Jana /Zástěrová/', '2 TYPE married', '2 _STROM_PRIMARY Y', '1 NAME Jana /Lhotová/', '2 TYPE birth')), 'Jana'))
            .toMatchObject({ lastName: 'Lhotová', marriedSurname: 'Zástěrová', primaryName: 'married' });
        expect(byFirst(importGed(indi('1 NAME Jana /Zástěrová/', '2 TYPE married', '1 NAME Jana /Lhotová/', '2 TYPE birth', '2 _STROM_PRIMARY Y')), 'Jana'))
            .toMatchObject({ lastName: 'Lhotová', marriedSurname: 'Zástěrová', primaryName: 'birth' });
    });

    it('is never counted as unsupported', () => {
        const result = convertToStrom(parseGedcom(indi('1 NAME Jana /Lhotová/', '2 _STROM_PRIMARY Y', '1 NAME Jana /Zástěrová/', '2 TYPE married')));
        expect(result.stats.unsupportedTags).toBe(0);
        expect(result.stats.droppedTagSummary ?? '').not.toMatch(/_STROM_PRIMARY/);
    });
});

describe('a round trip with the research (files from its CLI)', () => {
    const essentials = (d: StromData) => people(d).map(p => ({
        refn: p.refn, firstName: p.firstName, lastName: p.lastName, marriedSurname: p.marriedSurname, nameVariants: p.nameVariants,
    })).sort((a, b) => (a.refn ?? '').localeCompare(b.refn ?? ''));

    it('a file without the mark (as 3.17 read it) loads as before: no choice', () => {
        const none = importGed(fixture('none'));
        expect(fixture('none')).not.toContain('_STROM_PRIMARY');
        expect(byRefn(none, 'P0001')).toMatchObject({ lastName: 'Lhotová', marriedSurname: 'Zástěrová' });
        expect('primaryName' in byRefn(none, 'P0001')).toBe(false);
        // The marked files differ from it in the choice alone.
        expect(essentials(importGed(fixture('birth')))).toEqual(essentials(none));
        expect(essentials(importGed(fixture('married')))).toEqual(essentials(none));
    });

    for (const [file, pn, block] of [
        ['birth', 'birth', ['1 NAME Jana /Lhotová/', '2 _STROM_PRIMARY Y', '1 NAME Jana /Zástěrová/', '2 TYPE married']],
        ['married', 'married', ['1 NAME Jana /Lhotová/', '1 NAME Jana /Zástěrová/', '2 TYPE married', '2 _STROM_PRIMARY Y']],
    ] as const) {
        it(`"strom name primary" ${file}: read, written back to the research, read again`, () => {
            const result = convertToStrom(parseGedcom(fixture(file)));
            expect(result.stats.unsupportedTags).toBe(0);
            const data = result.data;
            expect(byRefn(data, 'P0001')).toMatchObject({ lastName: 'Lhotová', marriedSurname: 'Zástěrová', primaryName: pn });
            expect('primaryName' in byRefn(data, 'P0002')).toBe(false);
            const out = exportToGedcom(data, 'T', { research: { id: '2e4f0f5c-391c-4f79-81c6-ce625bc411ff' } }).content;
            expect(nameBlock(out, 'Jana')).toEqual([...block]);
            expect(byRefn(importGed(out), 'P0001').primaryName).toBe(pn);
        });
    }
});

describe('the choice in the data', () => {
    const TREE = 'primary-name-test-tree' as TreeId;

    beforeEach(() => {
        vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
        vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
        const dm = DataManager as unknown as {
            data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null;
        };
        dm.data = { persons: {}, partnerships: {} };
        dm.currentTreeId = TREE;
        dm.viewMode = false;
        dm.pendingBefore = null;
        UndoManager.setActiveTree(null);
        UndoManager.setActiveTree(TREE);
    });

    const lastLog = (): string => {
        const calls = vi.mocked(AuditLogManager.log).mock.calls;
        return String(calls[calls.length - 1]?.[2] ?? '');
    };

    it('a load keeps birth / married with a married surname and drops anything else', () => {
        expect(isPrimaryName('birth') && isPrimaryName('married')).toBe(true);
        for (const bad of ['', 'Birth', 'both', 42, null, { x: 1 }]) {
            expect(isPrimaryName(bad)).toBe(false);
            const loaded = migrateData({ persons: { j: { ...jana(), primaryName: bad } }, partnerships: {} });
            expect('primaryName' in loaded.persons[toPersonId('j')]).toBe(false);
        }
        const noMarried = migrateData({ persons: { j: person('j', 'Jana', 'Lhotová', { primaryName: 'birth' }) }, partnerships: {} });
        expect('primaryName' in noMarried.persons[toPersonId('j')]).toBe(false);
        const ok = migrateData({ persons: { j: jana('birth') }, partnerships: {} });
        expect(ok.persons[toPersonId('j')].primaryName).toBe('birth');
        // A file without the field loads unchanged.
        const older = { version: 13, persons: { j: jana() }, partnerships: {} };
        const text = JSON.stringify(older.persons);
        expect(JSON.stringify(migrateData(JSON.parse(JSON.stringify(older))).persons)).toBe(text);
    });

    it('set with the person (only with a married surname)', () => {
        const a = DataManager.createPerson({ firstName: 'Jana', lastName: 'Lhotová', gender: 'female', marriedSurname: 'Zástěrová', primaryName: 'birth' });
        expect(DataManager.getPerson(a.id)?.primaryName).toBe('birth');
        const b = DataManager.createPerson({ firstName: 'Eva', lastName: 'Lhotová', gender: 'female', primaryName: 'birth' });
        expect('primaryName' in DataManager.getPerson(b.id)!).toBe(false);
    });

    it('an edit: absent keeps it, a value sets it, present-but-undefined clears it; a history line; undo', () => {
        const p = DataManager.createPerson({ firstName: 'Jana', lastName: 'Lhotová', gender: 'female', marriedSurname: 'Zástěrová' });
        DataManager.updatePerson(p.id, { primaryName: 'birth' });
        expect(DataManager.getPerson(p.id)?.primaryName).toBe('birth');
        expect(lastLog()).toContain('Používané příjmení: – → rodné');
        DataManager.updatePerson(p.id, { birthPlace: 'Tábor' });
        expect(DataManager.getPerson(p.id)?.primaryName).toBe('birth');
        expect(lastLog()).not.toContain('Používané příjmení');
        DataManager.updatePerson(p.id, { primaryName: 'married' });
        expect(DataManager.getPerson(p.id)?.primaryName).toBe('married');
        expect(lastLog()).toContain('Používané příjmení: rodné → po sňatku');
        DataManager.updatePerson(p.id, { primaryName: undefined });
        expect('primaryName' in DataManager.getPerson(p.id)!).toBe(false);
        expect(lastLog()).toContain('Používané příjmení: po sňatku → –');
        DataManager.undo();
        expect(DataManager.getPerson(p.id)?.primaryName).toBe('married');
    });

    it('it goes with the married surname, and an edit cannot set it without one', () => {
        const p = DataManager.createPerson({ firstName: 'Jana', lastName: 'Lhotová', gender: 'female', marriedSurname: 'Zástěrová', primaryName: 'birth' });
        DataManager.updatePerson(p.id, { marriedSurname: '  ' });
        expect(DataManager.getPerson(p.id)).not.toHaveProperty('primaryName');
        expect(lastLog()).toContain('Používané příjmení: rodné → –');
        DataManager.updatePerson(p.id, { primaryName: 'birth' });
        expect(DataManager.getPerson(p.id)).not.toHaveProperty('primaryName');
        // Both at once: the married surname back with the choice.
        DataManager.updatePerson(p.id, { marriedSurname: 'Zástěrová', primaryName: 'birth' });
        expect(DataManager.getPerson(p.id)).toMatchObject({ marriedSurname: 'Zástěrová', primaryName: 'birth' });
    });

    it('a merge of two persons: the choice travels with the married surname', () => {
        const a = DataManager.createPerson({ firstName: 'Jana', lastName: 'Lhotová', gender: 'female' });
        const b = DataManager.createPerson({ firstName: 'Jana', lastName: 'Lhotová', gender: 'female', marriedSurname: 'Zástěrová', primaryName: 'birth' });
        expect(DataManager.mergePersons(a.id, b.id, {}, new Map())).toBe(true);
        expect(DataManager.getPerson(a.id)).toMatchObject({ marriedSurname: 'Zástěrová', primaryName: 'birth' });
        // Another married surname coming: neither it nor its choice.
        const c = DataManager.createPerson({ firstName: 'Jana', lastName: 'Lhotová', gender: 'female', marriedSurname: 'Svobodová', primaryName: 'married' });
        expect(DataManager.mergePersons(a.id, c.id, {}, new Map())).toBe(true);
        expect(DataManager.getPerson(a.id)).toMatchObject({ marriedSurname: 'Zástěrová', primaryName: 'birth' });
    });
});

describe('merges, privacy, CSV, the book and the search', () => {
    it('mergedPrimaryName: own choice first, theirs only with the same married surname', () => {
        expect(mergedPrimaryName(jana(), jana('birth'), 'Zástěrová')).toBe('birth');
        expect(mergedPrimaryName(jana('married'), jana('birth'), 'Zástěrová')).toBe('married');
        expect(mergedPrimaryName(jana(), jana('birth', { marriedSurname: 'Svobodová' }), 'Zástěrová')).toBeUndefined();
        expect(mergedPrimaryName(person('j', 'Jana', 'Lhotová', { primaryName: 'birth' }), jana('married'), '')).toBeUndefined();
        // The married surname came from the other one: its choice wins.
        expect(mergedPrimaryName(jana('married'), jana('birth'), '')).toBe('birth');
    });

    it('a tree merge fills it with the married surname and keeps the existing tree\'s', () => {
        const existing = person('p1', 'Jana', 'Lhotová');
        mergePersonData(existing, jana('birth', { id: toPersonId('x1') }), []);
        expect(existing).toMatchObject({ marriedSurname: 'Zástěrová', primaryName: 'birth' });
        mergePersonData(existing, jana('married', { id: toPersonId('x2') }), []);
        expect(existing.primaryName).toBe('birth');
        const other = person('p2', 'Jana', 'Lhotová', { marriedSurname: 'Svobodová' });
        mergePersonData(other, jana('birth', { id: toPersonId('x3') }), []);
        expect(other).not.toHaveProperty('primaryName');
    });

    it('privacy drops it from a living person in every mode, a deceased one keeps it', () => {
        const data = tree(jana('birth', { birthDate: '1990-01-01' }),
            person('d', 'Anna', 'Lhotová', { birthDate: '1850-01-01', deathDate: '1920-01-01', marriedSurname: 'Horáková', primaryName: 'birth' }));
        for (const mode of ['anonymous', 'minimal', 'initials'] as const) {
            const out = applyLivingPrivacy(data, mode, 2026);
            expect(out.persons[toPersonId('j')]).not.toHaveProperty('primaryName');
            expect(out.persons[toPersonId('d')].primaryName).toBe('birth');
        }
        expect(data.persons[toPersonId('j')].primaryName).toBe('birth');
    });

    it('the CSV says it in a column of its own', () => {
        setLanguage('en');
        const csv = (p: Person) => buildPersonsCsv(tree(p)).split('\r\n');
        expect(csv(jana('birth'))[0]).toContain('Married surname;Surname in use;Gender');
        expect(csv(jana('birth'))[1]).toContain('Jana;Lhotová;Zástěrová;birth;');
        expect(csv(jana('married'))[1]).toContain('Jana;Lhotová;Zástěrová;married;');
        expect(csv(jana())[1]).toContain('Jana;Lhotová;Zástěrová;;');
        expect(csv(person('j', 'Jana', 'Lhotová', { primaryName: 'birth' }))[1]).toContain('Jana;Lhotová;;;');
        setLanguage('cs');
        expect(csv(jana('married'))[1]).toContain('Jana;Lhotová;Zástěrová;po sňatku;');
    });

    it('the family book index: "dříve Zástěrová" for one who goes by the birth surname', () => {
        // Jana in a family (only people in the book are in its index).
        const family = (j: Person): StromData => {
            const d = tree(
                { ...j, partnerships: [toPartnershipId('u')], childIds: [toPersonId('c')] },
                person('h', 'Petr', 'Zástěra', { gender: 'male', birthDate: '1918', isDeceased: true, partnerships: [toPartnershipId('u')], childIds: [toPersonId('c')] }),
                person('c', 'Ota', 'Zástěra', { gender: 'male', birthDate: '1950', deathDate: '2010', parentIds: [toPersonId('h'), toPersonId('j')] }),
            );
            d.partnerships = { [toPartnershipId('u')]: { id: toPartnershipId('u'), person1Id: toPersonId('h'), person2Id: toPersonId('j'), status: 'married', childIds: [toPersonId('c')] } };
            return d;
        };
        const book = (p: Person, lang: 'cs' | 'en' = 'cs') => buildFamilyBook(family(p), { lang, privacy: 'full' });
        const dead = { birthDate: '1921', isDeceased: true };
        expect(book(jana('birth', dead))).toContain('>Lhotová Jana, dříve Zástěrová (* 1921)<');
        expect(book(jana('married', dead))).toContain('>Lhotová Jana, provd. Zástěrová (* 1921)<');
        expect(book(jana(undefined, dead))).toContain('>Lhotová Jana, provd. Zástěrová (* 1921)<');
        expect(book(jana('birth', dead), 'en')).toContain('Lhotová Jana, formerly Zástěrová');
    });

    it('the search row under the name says which surname matched', () => {
        const p = jana('birth');
        expect(hiddenSurnameMatchHtml(p, 'Zástěrová', null, 'both')).toBe('<div class="person-picker-match">dříve <mark>Zástěrová</mark></div>');
        expect(hiddenSurnameMatchHtml(p, 'zaster', null, 'married')).toContain('dříve <mark>Zástěrová</mark>');
        expect(hiddenSurnameMatchHtml(p, 'Zástěrová', null, 'birth')).toContain('po sňatku <mark>Zástěrová</mark>');
        expect(hiddenSurnameMatchHtml(p, 'Lhotová', null, 'both')).toBe('');
        expect(hiddenSurnameMatchHtml(p, 'Jana', null, 'both')).toBe('');
        // Without the choice: as before.
        expect(hiddenSurnameMatchHtml(jana(), 'Lhotová', null, 'married')).toContain('roz. <mark>Lhotová</mark>');
        expect(hiddenSurnameMatchHtml(jana(), 'Lhotová', null, 'both')).toBe('');
        expect(hiddenSurnameMatchHtml(jana(), 'Zástěrová', null, 'birth')).toContain('po sňatku <mark>Zástěrová</mark>');
        expect(hiddenSurnameMatchHtml(jana('married'), 'Lhotová', null, 'married')).toContain('roz. <mark>Lhotová</mark>');
    });
});

describe('the choice and the research', () => {
    const RESEARCH = (names: string[], extra: string[] = []): string => [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '2 VERS 1.22.0', '2 NAME Strom Research', '1 CHAR UTF-8',
        '0 @P0001@ INDI', '1 NAME Jana /Lhotová/', ...names, '1 SEX F', '1 REFN P0001', ...extra,
        '0 @P0002@ INDI', '1 NAME Karel /Zástěra/', '1 SEX M', '1 REFN P0002',
        '0 TRLR',
    ].join('\n');
    const MARRIED = ['1 NAME Jana /Zástěrová/', '2 TYPE married'];
    /** The tree here: Jana goes by her birth surname (chosen in the app). */
    const here = (): StromData => {
        const d = importGed(RESEARCH(MARRIED));
        byRefn(d, 'P0001').primaryName = 'birth';
        return d;
    };

    it('a research without person.primary gives the names back without the mark: the choice stays', () => {
        const next = importGed(RESEARCH(MARRIED));
        for (const features of [null, undefined, [], ['person.marriedSurname']]) {
            expect(byRefn(keepPrimaryName(next, here(), features), 'P0001').primaryName).toBe('birth');
            // keepMarriedSurname (what every load runs) carries it too.
            expect(byRefn(keepMarriedSurname(next, here(), features), 'P0001').primaryName).toBe('birth');
        }
        expect(byRefn(next, 'P0001')).not.toHaveProperty('primaryName');
        // Not onto a person without a married surname.
        const noMarried = importGed(RESEARCH([]));
        expect(byRefn(keepPrimaryName(noMarried, here(), null), 'P0001')).not.toHaveProperty('primaryName');
        // The version's own choice stays.
        const own = importGed(RESEARCH([...MARRIED, '2 _STROM_PRIMARY Y']));
        expect(byRefn(keepPrimaryName(own, here(), null), 'P0001').primaryName).toBe('married');
    });

    it('a research with person.primary decides it: a mark taken off there goes here too', () => {
        const next = importGed(RESEARCH(MARRIED));
        expect(keepPrimaryName(next, here(), [PRIMARY_NAME_FEATURE])).toBe(next);
        expect(byRefn(keepMarriedSurname(next, here(), ['person.marriedSurname', PRIMARY_NAME_FEATURE], true), 'P0001'))
            .not.toHaveProperty('primaryName');
    });

    it('a version with another choice is a value the load overwrites', () => {
        const previous = here();
        const there = stabilizeIds(importGed(RESEARCH([...MARRIED, '2 _STROM_PRIMARY Y'])), previous);
        expect(diffValues(previous, there).rows)
            .toEqual([expect.objectContaining({ field: 'primaryName', here: 'birth', there: 'married' })]);
        const same = stabilizeIds(importGed(RESEARCH(['2 _STROM_PRIMARY Y', ...MARRIED])), previous);
        expect(diffValues(previous, same).rows).toEqual([]);
    });

    it('a NAME conflict with an empty side (the name not chosen) is read without an error', () => {
        const ged = RESEARCH([...MARRIED, '2 _STROM_PRIMARY Y'], [
            '1 _STROM_CONFLICT X0001', '2 TYPE NAME', '2 STAT open',
            '2 VAL Jana /Zástěrová/', '3 _STROM_SIDE research', '2 VAL', '3 _STROM_SIDE user',
        ]);
        let data: StromData | undefined;
        expect(() => { data = importGed(ged); }).not.toThrow();
        const p = byRefn(data!, 'P0001');
        expect(p.primaryName).toBe('married');
        const conflict = p.research?.conflicts?.find(c => c.id === 'X0001');
        expect(conflict?.values.map(v => [v.value, v.side])).toEqual([['Jana /Zástěrová/', 'research'], ['', 'user']]);
    });
});
