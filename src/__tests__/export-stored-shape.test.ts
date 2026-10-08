/**
 * Exports of a stored tree (N32): the record a tree keeps in storage has the
 * shape of the version that last saved it until the tree is saved again (a
 * person without a sex, an invalid one). A file stamped with the current data
 * version must carry the current shape — one this app reads back.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../settings.js', () => ({
    SettingsManager: { isEncryptionEnabled: () => false },
}));

import { DataManager, storedTreeForExport } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { validateJsonImport } from '../merge/validation.js';
import { STROM_DATA_VERSION, TreeId } from '../types.js';

const TREE = 'stored-v11' as TreeId;
const person = (id: string, gender?: unknown) => ({
    id, firstName: id, lastName: 'Kos', ...(gender !== undefined ? { gender } : {}),
    isPlaceholder: false, partnerships: [], parentIds: [], childIds: [],
});
/** As an older app stored it: one person without a sex, one with an invalid one. */
const storedTree = () => ({
    version: 11,
    persons: { p1: person('p1', 'male'), p2: person('p2'), p3: person('p3', 'X') },
    partnerships: {},
});

let downloaded: Blob | null = null;

beforeEach(() => {
    downloaded = null;
    vi.spyOn(TreeManager, 'getTreeData').mockImplementation(async () => storedTree() as never);
    vi.spyOn(TreeManager, 'getTreeMetadata').mockReturnValue(null);
    vi.spyOn(TreeManager, 'noteFileCopy').mockImplementation(() => {});
    vi.stubGlobal('document', { createElement: () => ({ click() {}, href: '', download: '' }) });
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => { downloaded = b as Blob; return 'blob:x'; });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('exports of a stored tree from an older data version (N32)', () => {
    it('storedTreeForExport: the current shape with the current version (no sex = unknown)', async () => {
        const data = await storedTreeForExport(TREE);
        expect(data?.version).toBe(STROM_DATA_VERSION);
        expect(data?.persons['p1' as never].gender).toBe('male');
        expect(data?.persons['p2' as never].gender).toBe('unknown');
        expect(data?.persons['p3' as never].gender).toBe('unknown');
    });

    it('the JSON export is a valid current-version file that imports back', async () => {
        await DataManager.exportTreeJSON(TREE);
        expect(downloaded).not.toBeNull();
        const text = await downloaded!.text();
        expect(JSON.parse(text).version).toBe(STROM_DATA_VERSION);
        const result = validateJsonImport(text);
        expect(result.errors).toEqual([]);
        expect(result.valid).toBe(true);
        expect(result.data?.persons['p2' as never].gender).toBe('unknown');
        expect(result.data?.persons['p3' as never].gender).toBe('unknown');
    });

    it('the attached working file carries the same', async () => {
        const result = validateJsonImport(await DataManager.buildAttachedFileJson(TREE));
        expect(result.valid).toBe(true);
        expect(result.data?.persons['p3' as never].gender).toBe('unknown');
    });
});
