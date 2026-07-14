/**
 * Audit K1: the audit log must not be the one store writing plaintext while
 * encryption is on. Entries encrypt with the session; a locked session skips
 * the write (cache keeps entries); legacy plaintext logs re-encrypt on read.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AuditLogManager } from '../audit-log.js';
import { SettingsManager } from '../settings.js';
import { StorageManager } from '../storage.js';
import { CryptoSession, isEncrypted } from '../crypto.js';
import { TreeId, AuditLog } from '../types.js';

const TREE = 'audit-enc-tree' as TreeId;

// In-memory fake for the IDB store.
let store: Map<string, unknown>;

beforeEach(async () => {
    store = new Map();
    vi.spyOn(StorageManager, 'set').mockImplementation(async (_s, k, v) => { store.set(k as string, v); });
    vi.spyOn(StorageManager, 'get').mockImplementation(async (_s, k) => store.get(k as string) as never);
    vi.spyOn(StorageManager, 'delete').mockImplementation(async (_s, k) => { store.delete(k as string); });
    vi.spyOn(SettingsManager, 'isAuditLogEnabled').mockReturnValue(true);
    AuditLogManager.init();
    (AuditLogManager as unknown as { cache: Map<string, unknown> }).cache.clear();
});

afterEach(() => {
    CryptoSession.lock();
    vi.restoreAllMocks();
});

const flush = () => new Promise(r => setTimeout(r, 20));

describe('audit log encryption', () => {
    it('writes plaintext when encryption is off', async () => {
        vi.spyOn(SettingsManager, 'isEncryptionEnabled').mockReturnValue(false);
        AuditLogManager.log(TREE, 'person.create', 'Jan Novák');
        await flush();
        const stored = store.get(TREE) as AuditLog;
        expect(isEncrypted(stored)).toBe(false);
        expect(JSON.stringify(stored)).toContain('Jan Novák');
    });

    it('writes ciphertext when encryption is on and reads it back', async () => {
        vi.spyOn(SettingsManager, 'isEncryptionEnabled').mockReturnValue(true);
        await CryptoSession.unlock('test-password-123');
        AuditLogManager.log(TREE, 'person.create', 'Jan Novák');
        await flush();
        const stored = store.get(TREE);
        expect(isEncrypted(stored)).toBe(true);
        expect(JSON.stringify(stored)).not.toContain('Jan Novák');

        // Reads back through decryption.
        (AuditLogManager as unknown as { cache: Map<string, unknown> }).cache.clear();
        const log = await AuditLogManager.load(TREE);
        expect(log.entries[0].d).toBe('Jan Novák');
    });

    it('skips the write while locked (no plaintext leak), keeps entries in cache', async () => {
        vi.spyOn(SettingsManager, 'isEncryptionEnabled').mockReturnValue(true);
        CryptoSession.lock();
        AuditLogManager.log(TREE, 'person.create', 'Tajný Člověk');
        await flush();
        expect(store.has(TREE)).toBe(false);           // nothing hit the disk
        const log = await AuditLogManager.load(TREE);  // cache still serves it
        expect(log.entries[0].d).toBe('Tajný Člověk');
    });

    it('re-encrypts a legacy plaintext log on read when encryption is on', async () => {
        vi.spyOn(SettingsManager, 'isEncryptionEnabled').mockReturnValue(true);
        await CryptoSession.unlock('test-password-123');
        store.set(TREE, { version: 1, entries: [{ t: 't', a: 'person.create', d: 'Legacy Name' }] });
        const log = await AuditLogManager.load(TREE);
        expect(log.entries[0].d).toBe('Legacy Name');
        await flush();
        expect(isEncrypted(store.get(TREE))).toBe(true);
    });
});
