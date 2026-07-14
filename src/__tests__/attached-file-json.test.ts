/**
 * DataManager.buildAttachedFileJson: full-tree working-file content, refusing
 * when encryption is enabled but the session is locked, and encrypting via the
 * session when unlocked. Settings/crypto/TreeManager are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

let encryptionEnabled = false;
let unlocked = false;

vi.mock('../settings.js', () => ({
    SettingsManager: { isEncryptionEnabled: () => encryptionEnabled },
}));
vi.mock('../crypto.js', () => ({
    isEncrypted: () => false,
    CryptoSession: {
        isUnlocked: () => unlocked,
        async encrypt(json: string) { return { __encrypted: true, len: json.length }; },
    },
}));

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { TreeId } from '../types.js';

const TREE = 'attached-test' as TreeId;
const tree = { version: 1, persons: { p1: { id: 'p1', firstName: 'A', lastName: 'B', gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [] } }, partnerships: {} };

beforeEach(() => {
    encryptionEnabled = false;
    unlocked = false;
    vi.spyOn(TreeManager, 'getTreeData').mockResolvedValue(tree as never);
});

describe('buildAttachedFileJson', () => {
    it('returns the full tree as pretty JSON when encryption is off', async () => {
        const json = await DataManager.buildAttachedFileJson(TREE);
        const parsed = JSON.parse(json);
        expect(parsed.persons.p1.firstName).toBe('A');
        expect(json).toContain('\n');   // pretty-printed (2-space)
    });

    it('refuses when encryption is enabled but the session is locked', async () => {
        encryptionEnabled = true;
        unlocked = false;
        await expect(DataManager.buildAttachedFileJson(TREE)).rejects.toThrow('locked');
    });

    it('encrypts via the session when unlocked', async () => {
        encryptionEnabled = true;
        unlocked = true;
        const json = await DataManager.buildAttachedFileJson(TREE);
        expect(JSON.parse(json).__encrypted).toBe(true);
    });
});
