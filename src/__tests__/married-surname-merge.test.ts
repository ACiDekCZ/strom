/**
 * The surname after marriage brought into an existing tree by a merge (spec
 * 010, K1.2): a tree imported from a MyHeritage file before _MARNM was read
 * has no married surnames; merging the same file into it fills them on the
 * paired persons and changes nothing else. A different married surname on
 * both sides is a conflict of the wizard, never a silent keep.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { createMergeState, detectConflicts, updateConflictResolution } from '../merge/matching.js';
import { executeMerge, isEffectivelyConfirmed, mergePersonData } from '../merge/executor.js';
import { StorageManager } from '../storage.js';
import { Person, PersonId, StromData, toPersonId } from '../types.js';

/** A MyHeritage-style export: NAME with the birth surname, GIVN, SURN and _MARNM. */
const MH_GED = [
    '0 HEAD', '1 SOUR MYHERITAGE', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
    '0 @I1@ INDI', '1 NAME Jan /Novák/', '2 GIVN Jan', '2 SURN Novák', '1 SEX M',
    '1 BIRT', '2 DATE 3 MAR 1901', '1 FAMS @F1@',
    '0 @I2@ INDI', '1 NAME Marie /Dvořáková/', '2 GIVN Marie', '2 SURN Dvořáková', '2 _MARNM Nováková', '1 SEX F',
    '1 BIRT', '2 DATE 12 JUN 1904', '1 FAMS @F1@',
    '0 @I3@ INDI', '1 NAME Eva /Nováková/', '2 GIVN Eva', '2 SURN Nováková', '2 _MARNM Svobodová', '1 SEX F',
    '1 BIRT', '2 DATE 7 JAN 1930', '1 FAMC @F1@', '1 FAMS @F2@',
    '0 @I4@ INDI', '1 NAME Petr /Svoboda/', '2 GIVN Petr', '2 SURN Svoboda', '1 SEX M',
    '1 BIRT', '2 DATE 20 AUG 1928', '1 FAMS @F2@',
    '0 @I5@ INDI', '1 NAME Karel /Novák/', '2 GIVN Karel', '2 SURN Novák', '1 SEX M',
    '1 BIRT', '2 DATE 15 MAY 1933', '1 FAMC @F1@',
    '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 CHIL @I3@', '1 CHIL @I5@', '1 MARR', '2 DATE 1928',
    '0 @F2@ FAM', '1 HUSB @I4@', '1 WIFE @I3@', '1 MARR', '2 DATE 1952',
    '0 TRLR',
].join('\n');

const importGed = (ged: string): StromData => convertToStrom(parseGedcom(ged)).data;
/** The same file as an import made before _MARNM was read: no married surnames. */
function importedTheOldWay(ged: string): StromData {
    const data = importGed(ged);
    for (const p of Object.values(data.persons)) delete p.marriedSurname;
    return data;
}
const byName = (data: StromData, first: string): Person =>
    Object.values(data.persons).find(p => p.firstName === first)!;
/** Everything of a person but the married surname, to see nothing else moved. */
const withoutMarried = ({ marriedSurname: _m, ...rest }: Person) => rest;

beforeEach(() => {
    vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never);
});

describe('merging a MyHeritage file into a tree imported before _MARNM was read', () => {
    it('every person pairs on its own, the married surnames fill in, nothing else changes', async () => {
        const existing = importedTheOldWay(MH_GED);
        const incoming = importGed(MH_GED);
        expect(Object.values(existing.persons).some(p => p.marriedSurname)).toBe(false);

        const state = createMergeState(existing, incoming);
        expect(state.unmatchedIncoming).toEqual([]);
        expect(state.matches.every(m => isEffectivelyConfirmed(state, m))).toBe(true);
        expect(state.matches.flatMap(m => m.conflicts)).toEqual([]);

        const result = await executeMerge(state);
        expect(result.success).toBe(true);
        const merged = result.mergedData;

        expect(Object.keys(merged.persons).sort()).toEqual(Object.keys(existing.persons).sort());
        expect(Object.keys(merged.partnerships).sort()).toEqual(Object.keys(existing.partnerships).sort());
        expect(byName(merged, 'Marie').marriedSurname).toBe('Nováková');
        expect(byName(merged, 'Eva').marriedSurname).toBe('Svobodová');
        for (const id of Object.keys(existing.persons) as PersonId[]) {
            expect(withoutMarried(merged.persons[id])).toEqual(withoutMarried(existing.persons[id]));
        }
        expect(byName(merged, 'Marie').lastName).toBe('Dvořáková');
        expect(byName(merged, 'Jan').marriedSurname).toBeUndefined();
    });

    it('a different married surname already in the tree is a conflict: kept by default, the chosen one wins', async () => {
        const existing = importedTheOldWay(MH_GED);
        byName(existing, 'Eva').marriedSurname = 'Procházková';
        const incoming = importGed(MH_GED);

        const kept = createMergeState(existing, incoming);
        const evaMatch = kept.matches.find(m => m.incomingPerson.firstName === 'Eva')!;
        expect(evaMatch.conflicts).toEqual([expect.objectContaining({
            field: 'marriedSurname', existingValue: 'Procházková', incomingValue: 'Svobodová', resolution: 'keep_existing',
        })]);
        const keptResult = await executeMerge(kept);
        expect(byName(keptResult.mergedData, 'Eva').marriedSurname).toBe('Procházková');
        // The other one is not lost: a later import still finds her by it.
        expect(byName(keptResult.mergedData, 'Eva').nameVariants).toEqual(['Svobodová']);
        // Marie had none: filled without asking.
        expect(byName(keptResult.mergedData, 'Marie').marriedSurname).toBe('Nováková');

        const chosen = createMergeState(existing, incoming);
        const eva = chosen.matches.find(m => m.incomingPerson.firstName === 'Eva')!;
        updateConflictResolution(chosen, eva.incomingId, 'marriedSurname', 'use_incoming');
        const chosenResult = await executeMerge(chosen);
        expect(byName(chosenResult.mergedData, 'Eva').marriedSurname).toBe('Svobodová');
        expect(byName(chosenResult.mergedData, 'Eva').nameVariants).toEqual(['Procházková']);
        expect(byName(chosenResult.mergedData, 'Eva').lastName).toBe('Nováková');
    });
});

describe('the married surname as a merge conflict', () => {
    const p = (id: string, extra: Partial<Person> = {}): Person => ({
        id: toPersonId(id), firstName: 'Marie', lastName: 'Dvořáková', gender: 'female', isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [], ...extra,
    });

    it('only two different values conflict; one side alone fills, the same one is no conflict', () => {
        expect(detectConflicts(p('a'), p('b', { marriedSurname: 'Nováková' }))).toEqual([]);
        expect(detectConflicts(p('a', { marriedSurname: 'Nováková' }), p('b'))).toEqual([]);
        expect(detectConflicts(p('a', { marriedSurname: 'Nováková' }), p('b', { marriedSurname: 'Nováková' }))).toEqual([]);
        expect(detectConflicts(p('a', { marriedSurname: 'Nováková' }), p('b', { marriedSurname: 'Svobodová' }))
            .map(c => c.field)).toEqual(['marriedSurname']);
    });

    it('a losing value that is already a spelling of the name adds nothing', () => {
        const existing = p('a', { marriedSurname: 'Nováková', nameVariants: ['Svobodová'] });
        const incoming = p('b', { marriedSurname: 'Svobodová' });
        mergePersonData(existing, incoming, detectConflicts(existing, incoming));
        expect(existing.marriedSurname).toBe('Nováková');
        expect(existing.nameVariants).toEqual(['Svobodová']);
    });
});
