/**
 * The surname after marriage of a person married more than once (spec 010,
 * K4.1–K4.4): the one of her last marriage, not the last name written. The
 * spouse of the latest wedding by date, else of the last marriage in order;
 * a name no spouse carries comes after them. A research's file that puts the
 * current one last itself (`1 _STROM_MARRIED_LAST Y`, which also carries the
 * user's own choice) is taken as it is. A married surname changed in the app
 * keeps the one it replaces as another spelling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseGedcom, convertToStrom, MARRIED_LAST_TAG } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { diffByPerson } from '../research-changes.js';
import { keepMarriedSurname, MARRIED_SURNAME_FEATURE, PRIMARY_NAME_FEATURE, stabilizeIds } from '../research-link.js';
import { lastMarriageSurnameIndex, suggestionHusband } from '../married-suggestion.js';
import { Person, StromData, TreeId } from '../types.js';

const importGed = (ged: string): StromData => convertToStrom(parseGedcom(ged)).data;
const GED = (lines: string[], head: string[] = ['1 SOUR MYHERITAGE']): string =>
    ['0 HEAD', ...head, '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8', ...lines, '0 TRLR'].join('\n');
const marie = (data: StromData): Person => Object.values(data.persons).find(p => p.firstName === 'Marie')!;

/** Marie's record with these name lines, her husbands Karel Horák (I2) and Josef Novák (I3) and an unmarried friend. */
const MARIE = (names: string[], fams = ['@F1@', '@F2@']): string[] => [
    '0 @I1@ INDI', '1 NAME Marie /Dvořáková/', ...names, '1 SEX F', ...fams.map(f => `1 FAMS ${f}`),
    '0 @I2@ INDI', '1 NAME Karel /Horák/', '1 SEX M', '1 FAMS @F1@',
    '0 @I3@ INDI', '1 NAME Josef /Novák/', '1 SEX M', '1 FAMS @F2@',
];
/** The two marriages: F1 with Horák, F2 with Novák, each with its wedding date (none: undated). */
const FAMILIES = (horak?: string, novak?: string, order: ('F1' | 'F2')[] = ['F1', 'F2']): string[] => order.flatMap(f => f === 'F1'
    ? ['0 @F1@ FAM', '1 HUSB @I2@', '1 WIFE @I1@', '1 MARR', ...(horak ? [`2 DATE ${horak}`] : [])]
    : ['0 @F2@ FAM', '1 HUSB @I3@', '1 WIFE @I1@', '1 MARR', ...(novak ? [`2 DATE ${novak}`] : [])]);
/** Novák's name first in the file, Horák's last: the order the research wrote them in when a death record came before the wedding's. */
const NOVAK_FIRST = ['1 NAME Marie /Nováková/', '2 TYPE married', '1 NAME Marie /Horáková/', '2 TYPE married'];

describe('the surname after marriage is the one of the last marriage (K4.1)', () => {
    it('two weddings with dates, the names written the other way round: the later wedding\'s', () => {
        const data = importGed(GED([...MARIE(NOVAK_FIRST), ...FAMILIES('1930', '1950')]));
        expect(marie(data)).toMatchObject({ lastName: 'Dvořáková', marriedSurname: 'Nováková' });
        expect(marie(data).nameVariants).toEqual(['Marie Horáková']);
        // The dates decide, not the order of the families.
        const swapped = importGed(GED([...MARIE(NOVAK_FIRST, ['@F2@', '@F1@']), ...FAMILIES('1950', '1930', ['F2', 'F1'])]));
        expect(marie(swapped).marriedSurname).toBe('Horáková');
        expect(marie(swapped).nameVariants).toEqual(['Marie Nováková']);
    });

    it('no dates: the last marriage in order', () => {
        const data = importGed(GED([...MARIE(NOVAK_FIRST), ...FAMILIES()]));
        expect(marie(data).marriedSurname).toBe('Nováková');
        expect(marie(data).nameVariants).toEqual(['Marie Horáková']);
        const other = importGed(GED([...MARIE(NOVAK_FIRST, ['@F2@', '@F1@']), ...FAMILIES(undefined, undefined, ['F2', 'F1'])]));
        expect(marie(other).marriedSurname).toBe('Horáková');
    });

    it('only one wedding dated: that one (the editor\'s suggestion counts the same way)', () => {
        const data = importGed(GED([...MARIE(['1 NAME Marie /Horáková/', '2 TYPE married', '1 NAME Marie /Nováková/', '2 TYPE married']), ...FAMILIES('1930')]));
        expect(marie(data).marriedSurname).toBe('Horáková');
        expect(suggestionHusband(data, marie(data).id)?.lastName).toBe('Horák');
    });

    it('the husband\'s surname made feminine matches, and so does the same surname', () => {
        const data = importGed(GED([
            ...MARIE(['1 NAME Marie /Novák/', '2 TYPE married', '1 NAME Marie /Horáková/', '2 TYPE married']), ...FAMILIES('1930', '1950'),
        ]));
        expect(marie(data).marriedSurname).toBe('Novák');
        const index = lastMarriageSurnameIndex(data, marie(data).id, ['Nováková', 'Horáková']);
        expect(index).toBe(0);
    });

    it('a name no husband carries comes after the ones that match', () => {
        const data = importGed(GED([
            ...MARIE(['1 NAME Marie /Nováková/', '2 TYPE married', '1 NAME Marie /Kovářová/', '2 TYPE married']), ...FAMILIES('1930', '1950'),
        ]));
        expect(marie(data).marriedSurname).toBe('Nováková');
        expect(marie(data).nameVariants).toEqual(['Marie Kovářová']);
        // Two that match nobody: the last one written, as before.
        const none = importGed(GED([
            ...MARIE(['1 NAME Marie /Kovářová/', '2 TYPE married', '1 NAME Marie /Malá/', '2 TYPE married']), ...FAMILIES('1930', '1950'),
        ]));
        expect(marie(none).marriedSurname).toBe('Malá');
    });

    it('_MARNM: the one of the last marriage too, the other stays a spelling', () => {
        const data = importGed(GED([...MARIE(['1 _MARNM Nováková', '1 _MARNM Horáková']), ...FAMILIES('1930', '1950')], ['1 SOUR Legacy']));
        expect(marie(data).marriedSurname).toBe('Nováková');
        expect(marie(data).nameVariants).toEqual(['Marie Horáková']);
    });

    it('a name with given names of its own takes them along; the mark of the name the person goes by follows it', () => {
        const data = importGed(GED([
            ...MARIE(['1 NAME Marie Anna /Nováková/', '2 TYPE married', '2 _STROM_PRIMARY Y', '1 NAME Marie /Horáková/', '2 TYPE married']),
            ...FAMILIES('1930', '1950'),
        ]));
        expect(marie(data)).toMatchObject({ marriedSurname: 'Nováková', marriedFirstName: 'Marie Anna', primaryName: 'married' });
        expect(marie(data).nameVariants).toEqual(['Marie Horáková']);
        // The mark on the name replaced: no longer the married surname's.
        const other = importGed(GED([
            ...MARIE(['1 NAME Marie /Nováková/', '2 TYPE married', '1 NAME Marie /Horáková/', '2 TYPE married', '2 _STROM_PRIMARY Y']),
            ...FAMILIES('1930', '1950'),
        ]));
        expect(marie(other).marriedSurname).toBe('Nováková');
        expect(marie(other).primaryName).toBeUndefined();
    });

    it('the app\'s own file read again gives the same: one married name, the other a spelling', () => {
        const data = importGed(GED([...MARIE(NOVAK_FIRST), ...FAMILIES('1930', '1950')]));
        const again = importGed(exportToGedcom(data, 'T').content);
        expect(marie(again)).toMatchObject({ marriedSurname: 'Nováková', nameVariants: ['Marie Horáková'] });
    });
});

describe('the research and the surname after marriage of the last marriage (K4.2–K4.4)', () => {
    const RESEARCH_HEAD = (marked: boolean): string[] =>
        ['1 SOUR STROM_RESEARCH', '2 VERS 1.40.0', '2 NAME Strom Research', ...(marked ? [`1 ${MARRIED_LAST_TAG} Y`] : [])];
    const research = (names: string[], marked: boolean): string => GED([
        ...MARIE(names).flatMap(l => l === '1 SEX F' ? ['1 SEX F', '1 REFN P0001'] : l === '0 @I2@ INDI' ? [l, '1 REFN P0002'] : l === '0 @I3@ INDI' ? [l, '1 REFN P0003'] : [l]),
        ...FAMILIES('1930', '1950'),
    ], RESEARCH_HEAD(marked));
    const FEATURES = [MARRIED_SURNAME_FEATURE, PRIMARY_NAME_FEATURE];

    it('an older research (no mark): the app chooses by the last marriage itself (K4.4)', () => {
        expect(marie(importGed(research(NOVAK_FIRST, false))).marriedSurname).toBe('Nováková');
    });

    it('a research that marks its order is taken as it is: its last one, even against the rule (the user\'s choice, K4.2)', () => {
        const data = importGed(research(['1 NAME Marie /Nováková/', '2 TYPE married', '1 NAME Marie /Horáková/', '2 TYPE married'], true));
        expect(marie(data).marriedSurname).toBe('Horáková');
        expect(marie(data).nameVariants).toEqual(['Marie Nováková']);
    });

    it('a tree loaded before the fix is put right by the next version, and that is no change to send (K4.3)', () => {
        // As an older app read it: the last name written.
        const before = importGed(research(NOVAK_FIRST, true));
        expect(marie(before).marriedSurname).toBe('Horáková');
        const next = importGed(research(NOVAK_FIRST, false));
        const loaded = keepMarriedSurname(stabilizeIds(next, before), before, FEATURES);
        expect(marie(loaded)).toMatchObject({ marriedSurname: 'Nováková', nameVariants: ['Marie Horáková'] });
        expect(diffByPerson(loaded, loaded).length).toBe(0);
    });

    describe('a married surname changed in the app', () => {
        const TREE = 'married-last-test-tree' as TreeId;

        beforeEach(() => {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(new Date('2026-11-20T10:30:00Z'));
            vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
            vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
            const dm = DataManager as unknown as {
                data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null;
            };
            dm.data = importGed(research(NOVAK_FIRST, false));
            dm.currentTreeId = TREE;
            dm.viewMode = false;
            dm.pendingBefore = null;
            UndoManager.setActiveTree(null);
            UndoManager.setActiveTree(TREE);
        });
        afterEach(() => {
            vi.restoreAllMocks();
            vi.useRealTimers();
        });

        it('keeps the one it replaces as a spelling; a spelling fix keeps nothing more', () => {
            const id = marie(DataManager.getData()).id;
            DataManager.updatePerson(id, { marriedSurname: 'Novakova' });
            expect(DataManager.getPerson(id)).toMatchObject({ marriedSurname: 'Novakova', nameVariants: ['Marie Horáková'] });
            DataManager.updatePerson(id, { marriedSurname: 'Svobodová' });
            expect(DataManager.getPerson(id)?.nameVariants).toEqual(['Marie Horáková', 'Marie Novakova']);
            // Cleared: gone, nothing to keep it for.
            DataManager.updatePerson(id, { marriedSurname: '' });
            expect(DataManager.getPerson(id)?.marriedSurname).toBeUndefined();
            expect(DataManager.getPerson(id)?.nameVariants).toEqual(['Marie Horáková', 'Marie Novakova']);
        });

        it('given names of the married name go with the one replaced', () => {
            const id = marie(DataManager.getData()).id;
            (DataManager.getData().persons[id] as Person).marriedFirstName = 'Marie Anna';
            DataManager.updatePerson(id, { marriedSurname: 'Horáková' });
            expect(DataManager.getPerson(id)?.marriedFirstName).toBeUndefined();
            expect(DataManager.getPerson(id)?.nameVariants).toEqual(['Marie Anna Nováková']);
        });

        it('change → send → the research\'s version: the new one stays, the old one is a spelling, nothing removed', () => {
            const base = JSON.parse(JSON.stringify(DataManager.getData())) as StromData;
            const id = marie(base).id;
            DataManager.updatePerson(id, { marriedSurname: 'Horáková' });
            const here = DataManager.getData();
            expect(marie(here)).toMatchObject({ marriedSurname: 'Horáková', nameVariants: ['Marie Nováková'] });
            // What goes to the research: the chosen one as the married name, the other one still there.
            const ged = exportToGedcom(here, 'T', { research: { id: '0b4c7a52-1c1f-4d7e-9a53-2f4a3c1e8b10' } }).content;
            expect(ged).toContain('1 NAME Marie /Horáková/\n2 TYPE married');
            expect(ged).toMatch(/1 NAME Marie \/?Nováková\/?\n/);
            const change = diffByPerson(base, here).find(c => c.personId === id);
            expect(change?.kinds).toEqual(['name']);
            expect(change?.deleted).toBeUndefined();
            // The research made it the current one and says so: it stays after the load.
            const answer = importGed(research(NOVAK_FIRST.slice(0, 2).concat(['1 NAME Marie /Horáková/', '2 TYPE married']), true));
            const loaded = keepMarriedSurname(stabilizeIds(answer, here), here, FEATURES);
            expect(marie(loaded)).toMatchObject({ marriedSurname: 'Horáková', nameVariants: ['Marie Nováková'] });
            // An older research keeps its order: the rule of the last marriage applies again (K4.4).
            const older = importGed(research(NOVAK_FIRST, false));
            expect(marie(keepMarriedSurname(stabilizeIds(older, here), here, FEATURES)).marriedSurname).toBe('Nováková');
        });
    });
});
