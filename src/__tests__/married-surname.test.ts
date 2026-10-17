/**
 * The surname after marriage (spec 010, K1.1 data, K1.2, K1.4, K2.1, K2.2):
 * Person.marriedSurname — GEDCOM NAME > TYPE married and _MARNM in, a second
 * NAME with TYPE married out, kept through the research's versions, carried
 * by edits, merges and privacy, and found by search. Nothing is shown yet.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { DataManager, migrateData } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { nameMatchesQuery, surnameMatchesQuery } from '../name-search.js';
import { findMatches } from '../merge/matching.js';
import { mergePersonData } from '../merge/executor.js';
import { applyLivingPrivacy } from '../privacy.js';
import { diffByPerson, diffValues } from '../research-changes.js';
import { keepMarriedSurname, MARRIED_SURNAME_FEATURE, stabilizeIds } from '../research-link.js';
import { conflictTakeovers } from '../research-sync.js';
import { shownName } from '../person-name.js';
import { buildPersonsCsv } from '../csv-export.js';
import { initLanguage } from '../strings.js';
import { Person, PersonId, StromData, TreeId, toPersonId } from '../types.js';

const importGed = (ged: string): StromData => convertToStrom(parseGedcom(ged)).data;
const people = (data: StromData): Person[] => Object.values(data.persons);
const GED = (lines: string[], source = 'MYHERITAGE'): string =>
    ['0 HEAD', `1 SOUR ${source}`, '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8', ...lines, '0 TRLR'].join('\n');
const marie = (data: StromData): Person => people(data).find(p => p.firstName === 'Marie')!;
/** The NAME lines of Marie's record with their level-2 lines. */
const nameBlock = (ged: string): string[] => {
    const lines = ged.split(/\r?\n/);
    const out: string[] = [];
    for (let i = lines.findIndex(l => l.startsWith('1 NAME Marie')); i < lines.length; i++) {
        if (lines[i].startsWith('1 ') && !lines[i].startsWith('1 NAME')) break;
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

describe('reading the surname after marriage from GEDCOM', () => {
    it('a NAME with TYPE married gives the field and is no other spelling', () => {
        const data = importGed(GED([
            '0 @I1@ INDI', '1 NAME Marie /Dvořáková/', '1 NAME Marie /Nováková/', '2 TYPE married', '1 NAME Mařenka /Dvořáková/', '1 SEX F',
        ]));
        expect(marie(data)).toMatchObject({ firstName: 'Marie', lastName: 'Dvořáková', marriedSurname: 'Nováková' });
        expect(marie(data).nameVariants).toEqual(['Mařenka Dvořáková']);
    });

    it('of several married names the last one in the file is the field, the earlier ones stay spellings', () => {
        const data = importGed(GED([
            '0 @I1@ INDI', '1 NAME Marie /Dvořáková/', '1 NAME Marie /Horáková/', '2 TYPE married',
            '1 NAME Marie /Nováková/', '2 TYPE MARRIED', '1 SEX F',
        ]));
        expect(marie(data).marriedSurname).toBe('Nováková');
        expect(marie(data).nameVariants).toEqual(['Marie Horáková']);
    });

    it('_MARNM on level 1 and under NAME gives the field, never reported as unsupported', () => {
        for (const lines of [
            ['0 @I1@ INDI', '1 NAME Marie /Dvořáková/', '1 _MARNM Nováková', '1 SEX F'],
            ['0 @I1@ INDI', '1 NAME Marie /Dvořáková/', '2 _MARNM Nováková', '1 SEX F'],
            ['0 @I1@ INDI', '1 NAME Marie /Dvořáková/', '1 _MARNM Marie /Nováková/', '1 SEX F'],
        ]) {
            const result = convertToStrom(parseGedcom(GED(lines, 'Legacy')));
            expect(marie(result.data)).toMatchObject({ lastName: 'Dvořáková', marriedSurname: 'Nováková' });
            expect(marie(result.data).nameVariants).toBeUndefined();
            expect(result.stats.droppedTagSummary).not.toMatch(/_MARNM/);
            expect(result.stats.unsupportedTags).toBe(0);
        }
    });

    it('priorities: a NAME with TYPE married before _MARNM; of several _MARNM the last one', () => {
        const typed = importGed(GED([
            '0 @I1@ INDI', '1 NAME Marie /Dvořáková/', '2 _MARNM Horáková', '1 NAME Marie /Nováková/', '2 TYPE married', '1 _MARNM Svobodová', '1 SEX F',
        ]));
        expect(marie(typed).marriedSurname).toBe('Nováková');
        const tags = importGed(GED([
            '0 @I1@ INDI', '1 NAME Marie /Dvořáková/', '2 _MARNM Horáková', '1 _MARNM Nováková', '1 SEX F',
        ]));
        expect(marie(tags).marriedSurname).toBe('Nováková');
    });

    it('another spelling that only repeats the field goes (an older Strom file wrote it so)', () => {
        const data = importGed(GED([
            '0 @I1@ INDI', '1 NAME Marie /Dvořáková/', '1 NAME Marie Nováková', '1 _MARNM Nováková', '1 NAME u Kovářů', '1 SEX F',
        ]));
        expect(marie(data).marriedSurname).toBe('Nováková');
        expect(marie(data).nameVariants).toEqual(['u Kovářů']);
    });

    it('a married name put first beside the birth one is still swapped: the birth surname stays, the married one is the field', () => {
        const data = importGed(GED([
            '0 @I1@ INDI', '1 NAME Marie /Nováková/', '2 TYPE married', '1 NAME Marie /Dvořáková/', '2 TYPE birth', '1 SEX F',
        ]));
        expect(marie(data)).toMatchObject({ lastName: 'Dvořáková', marriedSurname: 'Nováková' });
        expect(marie(data).nameVariants).toBeUndefined();
    });

    it('a married name put first with no birth name stays the surname, the field empty (the birth one is not known)', () => {
        const data = importGed(GED([
            '0 @I1@ INDI', '1 NAME Marie /Nováková/', '2 TYPE married', '1 NAME Marie /Horáková/', '2 TYPE married', '1 SEX F',
        ]));
        expect(marie(data).lastName).toBe('Nováková');
        expect(marie(data).marriedSurname).toBeUndefined();
        expect(marie(data).nameVariants).toEqual(['Marie Horáková']);
    });
});

describe('writing the surname after marriage to GEDCOM', () => {
    const one = (extra: Partial<Person> = {}): StromData =>
        tree(person('p1', 'Marie', 'Dvořáková', { marriedSurname: 'Nováková', ...extra }));

    it('a second NAME with TYPE married right after the primary one, other spellings after it', () => {
        const ged = exportToGedcom(one({ nameVariants: ['Mařenka Dvořáková'] })).content;
        expect(nameBlock(ged)).toEqual(['1 NAME Marie /Dvořáková/', '1 NAME Marie /Nováková/', '2 TYPE married', '1 NAME Mařenka Dvořáková']);
    });

    it('nothing more for a person without one', () => {
        const ged = exportToGedcom(tree(person('p1', 'Marie', 'Dvořáková'))).content;
        expect(ged).not.toMatch(/TYPE married/);
    });

    it('import → export → import gives the same field and no new spelling', () => {
        for (const [expected, lines] of [
            ['Nováková', ['0 @I1@ INDI', '1 NAME Marie /Dvořáková/', '1 NAME Marie /Nováková/', '2 TYPE married', '1 SEX F']],
            ['Nováková', ['0 @I1@ INDI', '1 NAME Marie /Dvořáková/', '1 _MARNM Nováková', '1 SEX F']],
            ['Nováková', ['0 @I1@ INDI', '1 NAME Marie /Dvořáková/', '2 _MARNM Nováková', '1 NAME Marie Nováková', '1 SEX F']],
            ['Nováková', ['0 @I1@ INDI', '1 NAME Marie /Dvořáková/', '1 NAME Marie /Horáková/', '2 TYPE married', '1 NAME Marie /Nováková/', '2 TYPE married', '1 SEX F']],
            ['Nováková', ['0 @I1@ INDI', '1 NAME Marie /Nováková/', '2 TYPE married', '1 NAME Marie /Dvořáková/', '2 TYPE birth', '1 SEX F']],
            [undefined, ['0 @I1@ INDI', '1 NAME Marie /Nováková/', '2 TYPE married', '1 SEX F']],
        ] as const) {
            const once = importGed(GED([...lines]));
            expect(marie(once).marriedSurname).toBe(expected);
            const twice = importGed(exportToGedcom(once).content);
            const thrice = importGed(exportToGedcom(twice).content);
            for (const d of [twice, thrice]) {
                expect(marie(d).lastName).toBe(marie(once).lastName);
                expect(marie(d).marriedSurname).toBe(marie(once).marriedSurname);
                expect(marie(d).nameVariants).toEqual(marie(once).nameVariants);
            }
        }
    });

    it('the research gets it the same way: the birth surname in the primary NAME, the married one as TYPE married', () => {
        const ged = exportToGedcom(one(), 'T', { research: { id: '0b4c7a52-1c1f-4d7e-9a53-2f4a3c1e8b10' } }).content;
        expect(nameBlock(ged)).toEqual(['1 NAME Marie /Dvořáková/', '1 NAME Marie /Nováková/', '2 TYPE married']);
    });
});

describe('the surname after marriage in the data', () => {
    const TREE = 'married-surname-test-tree' as TreeId;

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
    afterEach(() => vi.restoreAllMocks());

    it('a file of an older version (no field) loads and saves unchanged', () => {
        const older: StromData = {
            version: 12,
            persons: { [toPersonId('p1')]: person('p1', 'Marie', 'Dvořáková', { nameVariants: ['Marie Nováková'] }) },
            partnerships: {},
        };
        const text = JSON.stringify(older.persons);
        const loaded = migrateData(JSON.parse(JSON.stringify(older)));
        // The persons as they were (the version is stamped again on save).
        expect(JSON.stringify(loaded.persons)).toBe(text);
        expect(loaded.persons[toPersonId('p1')].marriedSurname).toBeUndefined();
        expect(loaded.persons[toPersonId('p1')].nameVariants).toEqual(['Marie Nováková']);
    });

    it('a load keeps a text and drops anything else (empty, a number, an object)', () => {
        for (const bad of ['', '   ', 42, { x: 1 }, null]) {
            const loaded = migrateData({ persons: { p1: { ...person('p1', 'Marie', 'Dvořáková'), marriedSurname: bad } }, partnerships: {} });
            expect('marriedSurname' in loaded.persons[toPersonId('p1')]).toBe(false);
        }
        const ok = migrateData({ persons: { p1: { ...person('p1', 'Marie', 'Dvořáková'), marriedSurname: 'Nováková' } }, partnerships: {} });
        expect(ok.persons[toPersonId('p1')].marriedSurname).toBe('Nováková');
    });

    it('an edit sets it trimmed, an empty one removes it, undo brings it back; set with the person too', () => {
        const p = DataManager.createPerson({ firstName: 'Marie', lastName: 'Dvořáková', gender: 'female', marriedSurname: ' Nováková ' });
        expect(DataManager.getPerson(p.id)?.marriedSurname).toBe('Nováková');
        DataManager.updatePerson(p.id, { marriedSurname: 'Svobodová  ' });
        expect(DataManager.getPerson(p.id)?.marriedSurname).toBe('Svobodová');
        DataManager.updatePerson(p.id, { marriedSurname: '  ' });
        expect(DataManager.getPerson(p.id)?.marriedSurname).toBeUndefined();
        DataManager.undo();
        expect(DataManager.getPerson(p.id)?.marriedSurname).toBe('Svobodová');
        // A placeholder takes none.
        const ph = DataManager.createPerson({ firstName: '?', lastName: '', gender: 'female', marriedSurname: 'Nováková' }, true);
        expect(DataManager.getPerson(ph.id)?.marriedSurname).toBeUndefined();
    });

    it('the name as shown does not change (the birth surname)', () => {
        expect(shownName(person('p1', 'Marie', 'Dvořáková', { marriedSurname: 'Nováková' }))).toBe('Marie Dvořáková');
    });

    it('search over the tree finds her by the surname after marriage, with or without diacritics, and its forms', () => {
        const p = DataManager.createPerson({ firstName: 'Marie', lastName: 'Dvořáková', gender: 'female', marriedSurname: 'Nováková' });
        DataManager.createPerson({ firstName: 'Josef', lastName: 'Svoboda', gender: 'male' });
        expect(DataManager.searchPersons('Nováková').map(x => x.id)).toEqual([p.id]);
        expect(DataManager.searchPersons('marie novakova').map(x => x.id)).toEqual([p.id]);
        // The masculine form of the surname (Czech rules: a tree with Czech letters).
        expect(DataManager.searchPersons('Novák').map(x => x.id)).toEqual([p.id]);
        expect(DataManager.searchPersons('Dvořáková').map(x => x.id)).toEqual([p.id]);
    });

    it('merging two persons keeps the kept one\'s and fills a missing one', () => {
        const a = DataManager.createPerson({ firstName: 'Marie', lastName: 'Dvořáková', gender: 'female' });
        const b = DataManager.createPerson({ firstName: 'Marie', lastName: 'Dvořáková', gender: 'female', marriedSurname: 'Nováková' });
        expect(DataManager.mergePersons(a.id, b.id, {}, new Map())).toBe(true);
        expect(DataManager.getPerson(a.id)?.marriedSurname).toBe('Nováková');
        const c = DataManager.createPerson({ firstName: 'Marie', lastName: 'Dvořáková', gender: 'female', marriedSurname: 'Svobodová' });
        expect(DataManager.mergePersons(a.id, c.id, {}, new Map())).toBe(true);
        expect(DataManager.getPerson(a.id)?.marriedSurname).toBe('Nováková');
    });
});

describe('the person search by the surname after marriage (picker, filter)', () => {
    const data = tree(person('p1', 'Marie', 'Dvořáková', { marriedSurname: 'Nováková' }));
    const m = data.persons[toPersonId('p1')];

    it('the name and the surname query match it, diacritics or not, and its forms', () => {
        expect(nameMatchesQuery(m, 'Marie Nováková', data)).toBe(true);
        expect(nameMatchesQuery(m, 'novakova', data)).toBe(true);
        expect(surnameMatchesQuery(m, 'Novakova', data)).toBe(true);
        expect(surnameMatchesQuery(m, 'Novák', data)).toBe(true);
        expect(surnameMatchesQuery(m, 'Dvořák', data)).toBe(true);
        expect(surnameMatchesQuery(m, 'Svoboda', data)).toBe(false);
    });
});

describe('the surname after marriage across trees', () => {
    it('a tree merge fills a missing one and keeps the existing tree\'s', () => {
        const existing = person('p1', 'Marie', 'Dvořáková');
        mergePersonData(existing, person('x1', 'Marie', 'Dvořáková', { marriedSurname: 'Nováková' }), []);
        expect(existing.marriedSurname).toBe('Nováková');
        mergePersonData(existing, person('x2', 'Marie', 'Dvořáková', { marriedSurname: 'Svobodová' }), []);
        expect(existing.marriedSurname).toBe('Nováková');
    });

    it('matching finds her in a tree that has the surname after marriage as THE surname', () => {
        // The name alone: nothing else to say they are one person.
        const existing = tree(person('a', 'Marie', 'Dvořáková', { marriedSurname: 'Nováková' }));
        const incoming = tree(person('b', 'Marie', 'Nováková'));
        const matches = findMatches(existing, incoming).filter(x => x.existingPerson && x.incomingPerson);
        expect(matches).toHaveLength(1);
        expect(matches[0].existingPerson?.id).toBe(toPersonId('a'));
        // …and the other way round.
        expect(findMatches(incoming, existing).filter(x => x.existingPerson && x.incomingPerson)).toHaveLength(1);
    });

    it('privacy drops it from a living person, the initials mode shortens it like the surname', () => {
        const data = tree(person('p1', 'Marie', 'Dvořáková', { birthDate: '1990-01-01', marriedSurname: 'Nováková' }),
            person('p2', 'Anna', 'Dvořáková', { birthDate: '1850-01-01', deathDate: '1920-01-01', marriedSurname: 'Horáková' }));
        for (const mode of ['anonymous', 'minimal'] as const) {
            const out = applyLivingPrivacy(data, mode, 2026);
            expect(out.persons[toPersonId('p1')].marriedSurname).toBeUndefined();
            expect(out.persons[toPersonId('p2')].marriedSurname).toBe('Horáková');
        }
        const initials = applyLivingPrivacy(data, 'initials', 2026);
        expect(initials.persons[toPersonId('p1')]).toMatchObject({ firstName: 'M.', lastName: 'D.', marriedSurname: 'N.' });
        expect(initials.persons[toPersonId('p2')].marriedSurname).toBe('Horáková');
        // The input is not changed.
        expect(data.persons[toPersonId('p1')].marriedSurname).toBe('Nováková');
    });

    it('the CSV has a column of its own', () => {
        initLanguage('en');
        const [header, row] = buildPersonsCsv(tree(person('p1', 'Marie', 'Dvořáková', { marriedSurname: 'Nováková' }))).split('\r\n');
        expect(header).toContain('First name;Last name;Married surname;Gender');
        expect(row).toContain('Marie;Dvořáková;Nováková;');
    });
});

describe('the surname after marriage and the research', () => {
    const RESEARCH = (married: string[]): string => [
        '0 HEAD', '1 SOUR STROM_RESEARCH', '2 VERS 1.14.0', '2 NAME Strom Research', '1 CHAR UTF-8',
        '0 @P0001@ INDI', '1 NAME Marie /Dvořáková/', ...married, '1 SEX F', '1 REFN P0001',
        '0 @P0002@ INDI', '1 NAME Josef /Novák/', '1 SEX M', '1 REFN P0002',
        '0 TRLR',
    ].join('\n');
    const byRefn = (d: StromData, refn: string): Person => Object.values(d.persons).find(p => p.refn === refn)!;
    /** The tree here: Marie with her surname after marriage entered in the app. */
    const here = (): StromData => {
        const d = importGed(RESEARCH([]));
        byRefn(d, 'P0001').marriedSurname = 'Nováková';
        return d;
    };

    it('the research\'s own TYPE married name reads into the field (K2.1)', () => {
        const d = importGed(RESEARCH(['1 NAME Marie /Nováková/', '2 TYPE married']));
        expect(byRefn(d, 'P0001')).toMatchObject({ lastName: 'Dvořáková', marriedSurname: 'Nováková' });
        expect(byRefn(d, 'P0001').nameVariants).toBeUndefined();
    });

    it('a change of it is a change of the name to send, never of the birth surname (K2.2)', () => {
        const before = importGed(RESEARCH([]));
        const after = here();
        const id = byRefn(before, 'P0001').id;
        const changes = diffByPerson(before, stabilizeIds(after, before));
        expect(changes.find(c => c.personId === id)?.kinds).toEqual(['name']);
        const ged = exportToGedcom(after, 'T', { research: { id: '0b4c7a52-1c1f-4d7e-9a53-2f4a3c1e8b10' } }).content;
        expect(nameBlock(ged)).toEqual(['1 NAME Marie /Dvořáková/', '1 NAME Marie /Nováková/', '2 TYPE married']);
    });

    it('a research without person.marriedSurname gives it back as a bare spelling: the field stays, the spelling goes', () => {
        const previous = here();
        const next = importGed(RESEARCH(['1 NAME Marie /Nováková/']));
        expect(byRefn(next, 'P0001').nameVariants).toEqual(['Marie Nováková']);
        for (const features of [null, undefined, [], ['sync.ids', 'person.titles']]) {
            const out = keepMarriedSurname(next, previous, features);
            expect(byRefn(out, 'P0001')).toMatchObject({ lastName: 'Dvořáková', marriedSurname: 'Nováková' });
            expect(byRefn(out, 'P0001').nameVariants).toBeUndefined();
            expect(byRefn(out, 'P0002').marriedSurname).toBeUndefined();
        }
        // Neither input changed.
        expect(byRefn(next, 'P0001').marriedSurname).toBeUndefined();
        expect(byRefn(next, 'P0001').nameVariants).toEqual(['Marie Nováková']);
        // A version that has not got it yet keeps it too, and other spellings stay.
        const notYet = importGed(RESEARCH(['1 NAME u Kovářů']));
        const kept = byRefn(keepMarriedSurname(notYet, previous, null), 'P0001');
        expect(kept).toMatchObject({ marriedSurname: 'Nováková', nameVariants: ['u Kovářů'] });
    });

    it('the research\'s own surname after marriage stays, with or without the feature', () => {
        const next = importGed(RESEARCH(['1 NAME Marie /Svobodová/', '2 TYPE married']));
        for (const features of [null, [MARRIED_SURNAME_FEATURE]]) {
            expect(byRefn(keepMarriedSurname(next, here(), features), 'P0001').marriedSurname).toBe('Svobodová');
        }
    });

    it('a research with person.marriedSurname decides it: one taken off there goes here too', () => {
        const next = importGed(RESEARCH([]));
        const out = keepMarriedSurname(next, here(), [MARRIED_SURNAME_FEATURE]);
        expect(out).toBe(next);
        expect(byRefn(out, 'P0001').marriedSurname).toBeUndefined();
    });

    it('…except one it holds only as the bare spelling an older research made of it (never had it as married)', () => {
        const next = importGed(RESEARCH(['1 NAME Marie /Nováková/']));
        const out = keepMarriedSurname(next, here(), [MARRIED_SURNAME_FEATURE]);
        expect(byRefn(out, 'P0001')).toMatchObject({ marriedSurname: 'Nováková' });
        expect(byRefn(out, 'P0001').nameVariants).toBeUndefined();
        // Once it has had them (received), its version is taken as it is.
        expect(keepMarriedSurname(next, here(), [MARRIED_SURNAME_FEATURE], true)).toBe(next);
    });

    it('a version that takes it away is a value the load overwrites, named as the field', () => {
        const previous = here();
        const there = stabilizeIds(importGed(RESEARCH(['1 NAME Marie /Svobodová/', '2 TYPE married'])), previous);
        const rows = diffValues(previous, there).rows;
        expect(rows).toEqual([expect.objectContaining({ field: 'marriedSurname', here: 'Nováková', there: 'Svobodová' })]);
        // The same name and surname after marriage: nothing overwritten.
        expect(diffValues(previous, stabilizeIds(importGed(RESEARCH(['1 NAME Marie /Nováková/', '2 TYPE married'])), previous)).rows).toEqual([]);
    });

    it('a version that drops it over an open conflict there is a takeover', () => {
        const previous = here();
        const next = importGed(RESEARCH([]));
        const p = byRefn(next, 'P0001');
        p.research = { conflicts: [{ id: 'c1', fact: 'NAME', status: 'open', values: [] }] } as unknown as Person['research'];
        expect(conflictTakeovers(previous, stabilizeIds(next, previous))).toEqual([byRefn(previous, 'P0001').id as PersonId]);
    });
});
