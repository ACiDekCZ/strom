/**
 * Origin of facts from a loaded GEDCOM file (spec 066, data version 15):
 * the migration only adds, marks end with an edit, merge / split / delete
 * keep them consistent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migrateData, DataManager } from '../data.js';
import {
    StromData, Person, Partnership, PersonId, PartnershipId, TreeId, toPersonId, toPartnershipId,
} from '../types.js';
import {
    factImportParts, factValue, importedValueOf, isFromImport, keepImports, markTreeImported,
    nextImportId, sanitizeImports, addImportRecords,
} from '../import-origin.js';
import { extractSubtree } from '../subtree.js';
import { executeMerge } from '../merge/executor.js';
import { MergeState } from '../merge/types.js';
import { StorageManager } from '../storage.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';

const Z = toPersonId('p_zbyhnev');
const B = toPersonId('p_borislava');
const K = toPersonId('p_kid');
const U = toPartnershipId('u_zb');

function tree(): StromData {
    const persons = {
        [Z]: { id: Z, firstName: 'Zbyhněv', lastName: 'Lanýžek', gender: 'male', birthDate: '1850-01-01', birthPlace: 'Kvasilov',
            partnerships: [U], parentIds: [], childIds: [K],
            events: [{ id: 'ev_occ', type: 'occupation', note: 'Pecivál' }] },
        [B]: { id: B, firstName: 'Bořislava', lastName: 'Hvězdoňová', gender: 'female',
            partnerships: [U], parentIds: [], childIds: [K] },
        [K]: { id: K, firstName: 'Drahomil', lastName: 'Lanýžek', gender: 'male',
            partnerships: [], parentIds: [Z, B], childIds: [] },
    } as unknown as Record<PersonId, Person>;
    const partnerships: Record<PartnershipId, Partnership> = {
        [U]: { id: U, person1Id: Z, person2Id: B, childIds: [K], status: 'married', startDate: '1875-05-02', startPlace: 'Úlehle' },
    };
    return { persons, partnerships };
}

function imported(): StromData {
    const data = tree();
    data.imports = [{ id: 'I1', program: 'Rodokmenář', version: '5.2', fileDate: '12 MAR 2024', at: '2026-11-08', file: 'rodokmen.ged' }];
    markTreeImported(data, 'I1');
    return data;
}

describe('marks: a fact is from the file while its value is the stored one', () => {
    it('marks every fact, link and partner of a foreign file', () => {
        const d = imported();
        const z = d.persons[Z];
        expect(z.importId).toBe('I1');
        expect(isFromImport(z, 'firstName')).toBe(true);
        expect(isFromImport(z, 'birthPlace')).toBe(true);
        expect(isFromImport(z, 'deathDate')).toBe(false);          // no value: nothing to mark
        expect(z.importedValues?.['event:ev_occ.value']).toEqual({ from: 'I1', value: 'Pecivál' });
        expect(d.persons[K].importedParents).toEqual({ [Z]: 'I1', [B]: 'I1' });
        expect(d.partnerships[U].importId).toBe('I1');
        expect(isFromImport(d.partnerships[U], 'startDate')).toBe(true);
    });

    it('an edit ends the mark, the other part stays', () => {
        const d = imported();
        const z = d.persons[Z];
        z.birthPlace = 'Drahotuš';
        expect(isFromImport(z, 'birthPlace')).toBe(false);
        expect(importedValueOf(z, 'birthDate')?.from).toBe('I1');
        expect(factImportParts(z, 'birth')).toEqual({ importId: 'I1', fromImport: ['DATE'], changed: ['PLAC'] });
        z.birthPlace = 'Kvasilov';                                 // back to the file's value: from the file again
        expect(isFromImport(z, 'birthPlace')).toBe(true);
    });

    it('an unknown sex and a placeholder "?" are no value', () => {
        const p = { ...tree().persons[Z], gender: 'unknown' as const, firstName: '?' };
        expect(factValue(p, 'gender')).toBe('');
        expect(factValue(p, 'firstName')).toBe('');
    });

    it('next import ids', () => {
        expect(nextImportId(undefined)).toBe('I1');
        expect(nextImportId([{ id: 'I1', program: '', at: '2026-01-01' }, { id: 'R4', program: '', at: '2026-01-01' }, { id: 'I3', program: '', at: '2026-01-01' }])).toBe('I4');
    });
});

describe('data version 15 migration only adds', () => {
    it('an older tree loads unchanged, with no origin guessed', () => {
        const v14 = { ...tree(), version: 14 };
        const loaded = migrateData(structuredClone(v14));
        expect(loaded.imports).toBeUndefined();
        expect(loaded.persons[Z].importedValues).toBeUndefined();
        expect(loaded.persons[Z]).toEqual(tree().persons[Z]);
        expect(loaded.partnerships[U]).toEqual(tree().partnerships[U]);
    });

    it('a v15 tree keeps its records and marks through a load', () => {
        const d = imported();
        const loaded = migrateData(structuredClone(d));
        expect(loaded.imports).toEqual(d.imports);
        expect(loaded.persons[Z].importedValues).toEqual(d.persons[Z].importedValues);
        expect(loaded.persons[K].importedParents).toEqual(d.persons[K].importedParents);
        expect(loaded.partnerships[U].importId).toBe('I1');
    });

    it('drops marks without a record, of facts that are gone, of parents that are not', () => {
        const d = imported();
        d.persons[Z].importedValues!['event:ev_gone.date'] = { from: 'I1', value: '1900' };
        d.persons[Z].importedValues!.lastName = { from: 'I9', value: 'Lanýžek' };
        d.persons[Z].importedValues!.bogus = { from: 'I1', value: 'x' };
        d.persons[K].importedParents![toPersonId('p_stranger')] = 'I1';
        (d.persons[B] as unknown as Record<string, unknown>).importedValues = 'junk';
        const loaded = migrateData(structuredClone(d));
        const marks = loaded.persons[Z].importedValues!;
        expect(marks['event:ev_gone.date']).toBeUndefined();
        expect(marks.lastName).toBeUndefined();
        expect(marks.bogus).toBeUndefined();
        expect(marks.firstName).toEqual({ from: 'I1', value: 'Zbyhněv' });
        expect(loaded.persons[K].importedParents).toEqual({ [Z]: 'I1', [B]: 'I1' });
        expect(loaded.persons[B].importedValues).toBeUndefined();
    });

    it('records: valid ones only', () => {
        expect(sanitizeImports([
            { id: 'I1', program: 'X', at: '2026-11-08', sha: 'a'.repeat(64) },
            { id: 'I1', program: 'dup', at: '2026-11-08' },
            { id: '<script>', program: 'X', at: '2026-11-08' },
            { id: 'I2', program: 'X', at: 'yesterday' },
            { id: 'I3', program: 'X', at: '2026-11-08', sha: 'nope' },
        ])).toEqual([
            { id: 'I1', program: 'X', at: '2026-11-08', sha: 'a'.repeat(64) },
            { id: 'I3', program: 'X', at: '2026-11-08' },
        ]);
    });
});

describe('split, merge and delete keep marks consistent', () => {
    it('a split keeps the records; a link to a parent left behind loses its mark', () => {
        const both = extractSubtree(imported(), new Set([Z, K]));      // the other parent is glued in
        expect(both.imports?.[0].id).toBe('I1');
        expect(both.persons[K].importedParents).toEqual({ [Z]: 'I1', [B]: 'I1' });
        expect(both.persons[Z].importedValues?.firstName?.from).toBe('I1');
        const alone = extractSubtree(imported(), new Set([K]));
        expect(alone.persons[K].importedParents).toBeUndefined();
        expect(alone.persons[K].importedValues?.firstName?.from).toBe('I1');
    });

    it('records of two trees: the same import keeps one id, another gets the next', () => {
        const target = imported();
        const map = addImportRecords(target, [
            { ...target.imports![0] },
            { id: 'I1', program: 'Jiný program', at: '2026-11-09' },
        ]);
        expect(target.imports!.map(r => r.id)).toEqual(['I1', 'I2']);
        expect([...map.entries()]).toEqual([['I1', 'I2']]);
    });

    describe('tree merge', () => {
        beforeEach(() => { vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never); });

        it('marks only what came from the file; a value the tree had stays a person’s', async () => {
            const existing = tree();
            delete existing.persons[Z].birthPlace;                  // the file brings it
            const incoming = imported();
            incoming.imports![0].at = '2026-11-08';
            const match = { incomingId: Z, existingId: Z, incomingPerson: incoming.persons[Z], conflicts: [], score: 100 };
            const state = {
                existingData: existing, incomingData: incoming,
                matches: [match], unmatchedExisting: [B, K], unmatchedIncoming: [B, K],
                decisions: new Map([[Z, { type: 'confirm' }], [B, { type: 'skip' }], [K, { type: 'skip' }]]),
                conflictResolutions: new Map(), phase: 'executing',
            } as unknown as MergeState;
            const result = await executeMerge(state);
            expect(result.success).toBe(true);
            const z = result.mergedData.persons[Z];
            expect(result.mergedData.imports?.map(r => r.id)).toEqual(['I1']);
            expect(z.birthPlace).toBe('Kvasilov');
            expect(z.importedValues?.birthPlace).toEqual({ from: 'I1', value: 'Kvasilov' });
            // The same name and birth date were already in the tree: still a person's.
            expect(z.importedValues?.firstName).toBeUndefined();
            expect(z.importedValues?.birthDate).toBeUndefined();
        });

        it('people and couples added from the file bring their marks, renamed', async () => {
            const existing = tree();
            existing.imports = [{ id: 'I1', program: 'Starší', at: '2026-01-01' }];
            existing.persons[Z].importedValues = { firstName: { from: 'I1', value: 'Zbyhněv' } };
            const incoming = imported();
            const state = {
                existingData: { persons: { [Z]: existing.persons[Z] }, partnerships: {}, imports: existing.imports },
                incomingData: incoming,
                matches: [], unmatchedExisting: [Z], unmatchedIncoming: [Z, B, K],
                decisions: new Map(), conflictResolutions: new Map(), phase: 'executing',
            } as unknown as MergeState;
            const result = await executeMerge(state);
            const data = result.mergedData;
            expect(data.imports?.map(r => r.id)).toEqual(['I1', 'I2']);
            expect(data.persons[Z].importedValues?.firstName?.from).toBe('I1');
            const added = Object.values(data.persons).filter(p => p.id !== Z);
            expect(added.length).toBe(3);
            for (const p of added) expect(p.importId).toBe('I2');
            const kid = added.find(p => p.firstName === 'Drahomil')!;
            expect(Object.keys(kid.importedParents ?? {}).sort()).toEqual([...kid.parentIds].sort());
            expect(Object.values(kid.importedParents ?? {})).toEqual(['I2', 'I2']);
            const couple = Object.values(data.partnerships)[0];
            expect(couple.importId).toBe('I2');
            expect(couple.importedValues?.startDate?.from).toBe('I2');
            // The incoming tree is left as it was.
            expect(incoming.persons[Z].importId).toBe('I1');
        });
    });

    describe('in the open tree', () => {
        const TREE = 'origin-test' as TreeId;
        beforeEach(() => {
            vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
            vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
            const dm = DataManager as unknown as { data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null };
            dm.data = imported();
            dm.currentTreeId = TREE;
            dm.viewMode = false;
            dm.pendingBefore = null;
            UndoManager.setActiveTree(null);
            UndoManager.setActiveTree(TREE);
        });

        it('deleting a parent drops the child’s mark of that link', () => {
            DataManager.deletePerson(B);
            expect(DataManager.getPerson(K)?.importedParents).toEqual({ [Z]: 'I1' });
        });

        it('removing a parent link drops its mark', () => {
            DataManager.removeParentChild(Z, K);
            expect(DataManager.getPerson(K)?.importedParents).toEqual({ [B]: 'I1' });
        });

        it('editing a fact ends its mark without touching the stored value', () => {
            DataManager.updatePerson(Z, { birthDate: '1851-02-02' });
            const z = DataManager.getPerson(Z)!;
            expect(isFromImport(z, 'birthDate')).toBe(false);
            expect(isFromImport(z, 'birthPlace')).toBe(true);
        });
    });
});

describe('a research version keeps the app’s link marks and records', () => {
    it('matched by the research numbers', () => {
        const previous = imported();
        for (const [id, refn] of [[Z, 'P1'], [B, 'P2'], [K, 'P3']] as const) previous.persons[id].refn = refn;
        const next = tree();
        // The research's own ids differ.
        const remap = (id: PersonId) => toPersonId(`r_${id}`);
        const persons: Record<PersonId, Person> = {};
        for (const p of Object.values(next.persons)) {
            persons[remap(p.id)] = { ...p, id: remap(p.id), refn: previous.persons[p.id].refn,
                parentIds: p.parentIds.map(remap), childIds: p.childIds.map(remap) };
        }
        const research: StromData = {
            persons, partnerships: { [U]: { ...next.partnerships[U], person1Id: remap(Z), person2Id: remap(B), childIds: [remap(K)] } },
            imports: [{ id: 'R1', program: 'Jiný program', at: '2026-11-07' }],
        };
        research.persons[remap(Z)].researchOrigins = { birth: { kind: 'user' } };
        const kept = keepImports(research, previous);
        expect(kept.imports?.map(r => r.id)).toEqual(['R1', 'I1']);
        expect(kept.persons[remap(K)].importedParents).toEqual({ [remap(Z)]: 'I1', [remap(B)]: 'I1' });
        expect(kept.partnerships[U].importId).toBe('I1');
        // The research said whose the birth is: the app's stored birth values do not come along.
        expect(kept.persons[remap(Z)].importedValues?.birthDate).toBeUndefined();
        expect(kept.persons[remap(Z)].importedValues?.firstName?.from).toBe('I1');
        expect(research.persons[remap(K)].importedParents).toBeUndefined();
    });
});
