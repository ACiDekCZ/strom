/**
 * What was said about houses in the tree's data (data version 27, spec 030):
 * a load keeps valid houses only, an import keeps them, and a change is one
 * undo step with a change-log entry.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { DataManager, migrateData } from '../data.js';
import { validateJsonImport } from '../merge/validation.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { setLanguage } from '../strings.js';
import type { PersonId, StromData, TreeId } from '../types.js';
import { STROM_DATA_VERSION } from '../version.js';

const TREE = 'tree-houses' as TreeId;

function tree(houses?: unknown): StromData {
    return {
        version: 26,
        persons: {
            a: {
                id: 'a' as PersonId, firstName: 'Svatobor', lastName: 'Prouzal', gender: 'male', isPlaceholder: false,
                parentIds: [], childIds: [], partnerships: [], birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1820',
            },
        },
        partnerships: {},
        ...(houses !== undefined ? { houses } : {}),
    } as StromData;
}

function reset(data: StromData): void {
    vi.restoreAllMocks();
    vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
    vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
    const dm = DataManager as unknown as { data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null };
    dm.data = data;
    dm.currentTreeId = TREE;
    dm.viewMode = false;
    dm.pendingBefore = null;
    UndoManager.setActiveTree(null);
    UndoManager.setActiveTree(TREE);
}

beforeAll(() => setLanguage('en'));

describe('data version 27', () => {
    it('is the current version', () => {
        expect(STROM_DATA_VERSION).toBe(27);
    });

    it('a load keeps valid houses, drops junk, and adds nothing to a tree without them', () => {
        const loaded = migrateData(tree({
            'belokamen|16': { name: 'U Prouzalů', merged: ['belokamen|9'], junk: true },
            'belokamen|9': { split: 'not a list' },
            'nobar': { name: 'x' },
        }));
        expect(loaded.houses).toEqual({ 'belokamen|16': { name: 'U Prouzalů', merged: ['belokamen|9'] } });
        expect(migrateData(tree()).houses).toBeUndefined();
        expect(migrateData(tree('junk')).houses).toBeUndefined();
    });

    it('an import of a JSON file keeps them', () => {
        const result = validateJsonImport(JSON.stringify(tree({ 'belokamen|16': { name: 'U Prouzalů' } })));
        expect(result.data?.houses).toEqual({ 'belokamen|16': { name: 'U Prouzalů' } });
    });
});

describe('DataManager.setHouseUserData', () => {
    beforeEach(() => reset(migrateData(tree())));

    it('stores, changes and forgets as undo steps with change-log entries', () => {
        expect(DataManager.setHouseUserData('belokamen|16', { name: 'U Prouzalů' }, 'Bělokamen 16')).toBe(true);
        expect(DataManager.getData().houses).toEqual({ 'belokamen|16': { name: 'U Prouzalů' } });
        expect(AuditLogManager.log).toHaveBeenCalledWith(TREE, 'house.edit', expect.stringContaining('Bělokamen 16'));
        expect(DataManager.setHouseUserData('belokamen|16', { name: 'U Prouzalů' }, 'Bělokamen 16')).toBe(false);

        expect(DataManager.setHouseUserData('belokamen|16', { name: 'U Prouzalů', merged: ['belokamen|9'] }, 'Bělokamen 16')).toBe(true);
        expect(DataManager.setHouseUserData('belokamen|16', undefined, 'Bělokamen 16')).toBe(true);
        expect(DataManager.getData().houses).toBeUndefined();

        DataManager.undo();
        expect(DataManager.getData().houses).toEqual({ 'belokamen|16': { name: 'U Prouzalů', merged: ['belokamen|9'] } });
        DataManager.undo();
        expect(DataManager.getData().houses).toEqual({ 'belokamen|16': { name: 'U Prouzalů' } });
    });

    it('refuses a bad id and does nothing while read-only', () => {
        expect(DataManager.setHouseUserData('no bar', { name: 'x' }, 'x')).toBe(false);
        (DataManager as unknown as { viewMode: boolean }).viewMode = true;
        expect(DataManager.setHouseUserData('belokamen|16', { name: 'x' }, 'x')).toBe(false);
        expect(DataManager.getData().houses).toBeUndefined();
    });
});
