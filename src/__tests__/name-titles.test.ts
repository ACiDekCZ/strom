/**
 * Titles of the name (T07): Person.titleBefore / titleAfter — GEDCOM NAME >
 * NPFX / NSFX in and out, shown with the name while Settings → "Show titles"
 * is on, never weighed by search or duplicate / merge matching, carried by
 * the person's edits, merges, privacy and the research's change list.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readGedcomName } from '../gedcom-names.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { shownName, shownNameParts, titlesShown } from '../person-name.js';
import { SettingsManager } from '../settings.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { nameMatchesQuery } from '../name-search.js';
import { findSimilarPersons, quickMatchScore } from '../merge/matching.js';
import { mergePersonData } from '../merge/executor.js';
import { applyLivingPrivacy } from '../privacy.js';
import { diffByPerson } from '../research-changes.js';
import { Person, PersonId, StromData, TreeId, toPersonId } from '../types.js';

const importGed = (ged: string): StromData => convertToStrom(parseGedcom(ged)).data;
const people = (data: StromData): Person[] => Object.values(data.persons);
const GED = (lines: string[], source = 'MYHERITAGE'): string =>
    ['0 HEAD', `1 SOUR ${source}`, '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8', ...lines, '0 TRLR'].join('\n');

function person(id: string, firstName: string, lastName: string, extra: Partial<Person> = {}): Person {
    return {
        id: toPersonId(id), firstName, lastName, gender: 'male', isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [], ...extra,
    };
}

describe('reading NPFX / NSFX', () => {
    it('takes the titles out of the NAME line the tags name, with or without GIVN / SURN', () => {
        expect(readGedcomName('Ing. Jan /Novák/ ml.', { npfx: 'Ing.', nsfx: 'ml.' }))
            .toEqual({ firstName: 'Jan', lastName: 'Novák', titleBefore: 'Ing.', titleAfter: 'ml.' });
        expect(readGedcomName('MUDr. Marie /Svobodová/', { npfx: 'MUDr.' }))
            .toEqual({ firstName: 'Marie', lastName: 'Svobodová', titleBefore: 'MUDr.' });
    });

    it('keeps a title the line does not write (the tag alone)', () => {
        expect(readGedcomName('Jan /Novák/', { npfx: 'hrabě', nsfx: 'st.' }))
            .toEqual({ firstName: 'Jan', lastName: 'Novák', titleBefore: 'hrabě', titleAfter: 'st.' });
    });

    it('never searches a line without the tags for titles', () => {
        expect(readGedcomName('Ing. Jan /Novák/ ml.')).toEqual({ firstName: 'Ing. Jan', lastName: 'Novák ml.' });
        expect(readGedcomName('Dr. Jan /Novák/', { givn: 'Dr. Jan', surn: 'Novák' }))
            .toEqual({ firstName: 'Dr. Jan', lastName: 'Novák' });
    });

    it('reads a list of titles (GEDCOM commas in the tag, spaces in the line) and a comma before a title after', () => {
        expect(readGedcomName('Prof. Dr. Jan /Novák/', { npfx: 'Prof., Dr.' }))
            .toEqual({ firstName: 'Jan', lastName: 'Novák', titleBefore: 'Prof., Dr.' });
        expect(readGedcomName('Jan /Novák/, Ph.D.', { nsfx: 'Ph.D.' }))
            .toEqual({ firstName: 'Jan', lastName: 'Novák', titleAfter: 'Ph.D.' });
    });

    it('takes a title only as a whole word at the line\'s start or end', () => {
        // "Ing" is no prefix of "Ingrid", "st." no end of "/Kost./"-like text
        expect(readGedcomName('Ingrid /Nováková/', { npfx: 'Ing' }))
            .toEqual({ firstName: 'Ingrid', lastName: 'Nováková', titleBefore: 'Ing' });
        expect(readGedcomName('Jan /Novák/ml.', { nsfx: 'ml.' }))
            .toEqual({ firstName: 'Jan', lastName: 'Novák', titleAfter: 'ml.' });
    });

    it('keeps the line\'s surname with a prefix (SPFX) and no title after it', () => {
        expect(readGedcomName('Willem /van Berg/ Jr.', { givn: 'Willem', spfx: 'van', surn: 'Berg', nsfx: 'Jr.' }))
            .toEqual({ firstName: 'Willem', lastName: 'van Berg', titleAfter: 'Jr.' });
    });

    it('imports the titles onto the person', () => {
        const data = importGed(GED([
            '0 @I1@ INDI', '1 NAME Ing. Jan /Novák/ ml.', '2 NPFX Ing.', '2 GIVN Jan', '2 SURN Novák', '2 NSFX ml.', '1 SEX M',
            '0 @I2@ INDI', '1 NAME Ing. Petr /Novák/', '1 SEX M',
        ]));
        const [jan, petr] = people(data);
        expect(jan).toMatchObject({ firstName: 'Jan', lastName: 'Novák', titleBefore: 'Ing.', titleAfter: 'ml.' });
        expect(petr).toMatchObject({ firstName: 'Ing. Petr', lastName: 'Novák' });
        expect(petr.titleBefore).toBeUndefined();
        expect(petr.titleAfter).toBeUndefined();
    });

    it('never reports NPFX / NSFX as unsupported', () => {
        const result = convertToStrom(parseGedcom(GED([
            '0 @I1@ INDI', '1 NAME Ing. Jan /Novák/ ml.', '2 NPFX Ing.', '2 NSFX ml.', '1 SEX M',
        ])));
        expect(result.stats.droppedTagSummary).not.toMatch(/NPFX|NSFX/);
        expect(result.stats.unsupportedTags).toBe(0);
    });
});

describe('writing NPFX / NSFX', () => {
    const tree = (): StromData => ({
        persons: {
            [toPersonId('p1')]: person('p1', 'Jan', 'Novák', { titleBefore: 'Ing.', titleAfter: 'ml.' }),
            [toPersonId('p2')]: person('p2', 'Marie', 'Nováková', { gender: 'female' }),
            [toPersonId('p3')]: person('p3', 'Eva', 'Svobodová', { gender: 'female', titleAfter: 'Ph.D.' }),
        },
        partnerships: {},
    });

    it('writes the whole name in the line and its parts below, for a name with a title only', () => {
        const out = exportToGedcom(tree()).content.split(/\r?\n/);
        const at = out.indexOf('1 NAME Ing. Jan /Novák/ ml.');
        expect(at).toBeGreaterThan(-1);
        expect(out.slice(at, at + 5)).toEqual([
            '1 NAME Ing. Jan /Novák/ ml.', '2 NPFX Ing.', '2 GIVN Jan', '2 SURN Novák', '2 NSFX ml.',
        ]);
        const plain = out.indexOf('1 NAME Marie /Nováková/');
        expect(plain).toBeGreaterThan(-1);
        expect(out[plain + 1]).not.toMatch(/^2 (NPFX|GIVN|SURN|NSFX)/);
        const eva = out.indexOf('1 NAME Eva /Svobodová/ Ph.D.');
        expect(out.slice(eva, eva + 4)).toEqual(['1 NAME Eva /Svobodová/ Ph.D.', '2 GIVN Eva', '2 SURN Svobodová', '2 NSFX Ph.D.']);
    });

    it('comes back from its own file as it went out', () => {
        const again = importGed(exportToGedcom(tree()).content);
        const shape = (p: Person) => ({ firstName: p.firstName, lastName: p.lastName, titleBefore: p.titleBefore, titleAfter: p.titleAfter });
        expect(people(again).map(shape)).toEqual(people(tree()).map(shape));
    });

    it('comes back the same from another program\'s file too (the line read as the research reads it)', () => {
        const out = exportToGedcom(tree()).content.replace(/^1 SOUR .*$/m, '1 SOUR MYHERITAGE');
        const jan = people(importGed(out)).find(p => p.firstName === 'Jan');
        expect(jan).toMatchObject({ lastName: 'Novák', titleBefore: 'Ing.', titleAfter: 'ml.' });
    });
});

describe('the name as shown', () => {
    const jan = person('p1', 'Jan', 'Novák', { titleBefore: 'Ing.', titleAfter: 'ml.' });

    it('shows the titles with the name, the given name and the surname each with its own', () => {
        expect(shownName(jan, '', true)).toBe('Ing. Jan Novák ml.');
        expect(shownNameParts(jan, '?', true)).toEqual({ given: 'Ing. Jan', surname: 'Novák ml.' });
    });

    it('shows the bare name with the setting off', () => {
        expect(shownName(jan, '', false)).toBe('Jan Novák');
        expect(shownNameParts(jan, '?', false)).toEqual({ given: 'Jan', surname: 'Novák' });
    });

    it('follows the setting (on by default)', () => {
        expect(titlesShown()).toBe(true);
        expect(shownName(jan)).toBe('Ing. Jan Novák ml.');
        const off = vi.spyOn(SettingsManager, 'isShowTitles').mockReturnValue(false);
        expect(shownName(jan)).toBe('Jan Novák');
        off.mockRestore();
    });

    it('gives a placeholder no titles and a missing given name its stand-in', () => {
        expect(shownName({ ...jan, isPlaceholder: true, firstName: '?' }, '', true)).toBe('? Novák');
        expect(shownName({ ...jan, firstName: '' }, '?', true)).toBe('Ing. ? Novák ml.');
        expect(shownName(person('p9', '', ''), '', true)).toBe('?');
    });
});

describe('titles never weigh in matching', () => {
    const plain = person('p1', 'Jan', 'Novák', { birthDate: '1900-01-01' });
    const titled = person('p2', 'Jan', 'Novák', { birthDate: '1900-01-01', titleBefore: 'Ing.', titleAfter: 'ml.' });
    const data: StromData = { persons: { [plain.id]: plain }, partnerships: {} };

    it('search finds no one by a title, the titled person by the name', () => {
        expect(nameMatchesQuery(titled, 'Ing', data)).toBe(false);
        expect(nameMatchesQuery(titled, 'ml', data)).toBe(false);
        expect(nameMatchesQuery(titled, 'Jan Novák', data)).toBe(true);
    });

    it('scores a titled and an untitled record of one man the same as two untitled ones', () => {
        expect(quickMatchScore(plain, titled)).toBe(quickMatchScore(plain, { ...titled, titleBefore: undefined, titleAfter: undefined }));
        expect(quickMatchScore(plain, titled)).toBeGreaterThanOrEqual(50);
    });

    it('a draft hints the same duplicate with or without a title', () => {
        const hits = findSimilarPersons(data, { firstName: 'Jan', lastName: 'Novák', gender: 'male', birthDate: '1900-01-01' });
        expect(hits.map(h => h.person.id)).toEqual([plain.id]);
    });
});

describe('titles in the data', () => {
    const TREE = 'titles-test-tree' as TreeId;

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

    it('an edit sets them trimmed, an empty one removes them, and undo brings them back', () => {
        const p = DataManager.createPerson({ firstName: 'Jan', lastName: 'Novák', gender: 'male' });
        DataManager.updatePerson(p.id, { titleBefore: '  Ing. ', titleAfter: 'ml.' });
        expect(DataManager.getPerson(p.id)).toMatchObject({ titleBefore: 'Ing.', titleAfter: 'ml.' });
        DataManager.updatePerson(p.id, { titleBefore: '', titleAfter: '  ' });
        expect(DataManager.getPerson(p.id)?.titleBefore).toBeUndefined();
        expect(DataManager.getPerson(p.id)?.titleAfter).toBeUndefined();
        DataManager.undo();
        expect(DataManager.getPerson(p.id)).toMatchObject({ titleBefore: 'Ing.', titleAfter: 'ml.' });
    });

    it('search over the tree ignores them', () => {
        const p = DataManager.createPerson({ firstName: 'Jan', lastName: 'Novák', gender: 'male' });
        DataManager.updatePerson(p.id, { titleBefore: 'Ing.' });
        expect(DataManager.searchPersons('Ing')).toEqual([]);
        expect(DataManager.searchPersons('Jan').map(x => x.id)).toEqual([p.id]);
    });

    it('merging two persons keeps the kept one\'s titles and fills the missing ones', () => {
        const a = DataManager.createPerson({ firstName: 'Jan', lastName: 'Novák', gender: 'male' });
        const b = DataManager.createPerson({ firstName: 'Jan', lastName: 'Novák', gender: 'male' });
        DataManager.updatePerson(a.id, { titleBefore: 'Ing.' });
        DataManager.updatePerson(b.id, { titleBefore: 'MUDr.', titleAfter: 'st.' });
        expect(DataManager.mergePersons(a.id, b.id, {}, new Map())).toBe(true);
        expect(DataManager.getPerson(a.id)).toMatchObject({ titleBefore: 'Ing.', titleAfter: 'st.' });
    });
});

describe('titles across trees', () => {
    it('a tree merge fills missing titles and keeps the existing tree\'s', () => {
        const existing = person('p1', 'Jan', 'Novák', { titleAfter: 'ml.' });
        mergePersonData(existing, person('x1', 'Jan', 'Novák', { titleBefore: 'Ing.', titleAfter: 'st.' }), []);
        expect(existing).toMatchObject({ titleBefore: 'Ing.', titleAfter: 'ml.' });
    });

    it('privacy strips them from a living person', () => {
        const data: StromData = {
            persons: { [toPersonId('p1')]: person('p1', 'Jan', 'Novák', { birthDate: '1990-01-01', titleBefore: 'Ing.', titleAfter: 'ml.' }) },
            partnerships: {},
        };
        const out = applyLivingPrivacy(data, 'initials', 2026);
        const p = out.persons[toPersonId('p1')];
        expect(p.titleBefore).toBeUndefined();
        expect(p.titleAfter).toBeUndefined();
    });

    it('a changed title is a change of the name for the research', () => {
        const before: StromData = { persons: { [toPersonId('p1')]: person('p1', 'Jan', 'Novák') }, partnerships: {} };
        const after: StromData = { persons: { [toPersonId('p1')]: person('p1', 'Jan', 'Novák', { titleBefore: 'Ing.' }) }, partnerships: {} };
        const changes = diffByPerson(before, after);
        expect(changes.find(c => c.personId === ('p1' as PersonId))?.kinds).toEqual(['name']);
    });
});

describe('the image export shows the name as the cards do', () => {
    it('with its titles, initials from the bare name, and without them when the setting is off', async () => {
        const { buildTreeSvg } = await import('../export-image.js');
        const jan = person('a', 'Jan', 'Novák', { titleBefore: 'Ing.', titleAfter: 'ml.' });
        const data: StromData = { persons: { [jan.id]: jan }, partnerships: {} };
        const layout = { positions: new Map([[jan.id, { x: 0, y: 0 }]]), connections: [], spouseLines: [] };
        const svg = buildTreeSvg(data, layout);
        expect(svg).toContain('Ing. Jan Novák ml.');
        expect(svg).toContain('>JN<');
        const off = vi.spyOn(SettingsManager, 'isShowTitles').mockReturnValue(false);
        const bare = buildTreeSvg(data, layout);
        off.mockRestore();
        expect(bare).not.toContain('Ing.');
        expect(bare).toContain('Jan Novák');
    });
});
