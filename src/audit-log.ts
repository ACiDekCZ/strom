/**
 * AuditLogManager - Records changes to tree data
 * Stored per-tree in IndexedDB 'audit' store.
 * Max 500 entries with rotation of oldest.
 *
 * Design:
 * - In-memory cache per tree for sync log() calls
 * - IDB writes are fire-and-forget
 * - Cache is loaded on switchTree via loadForTree()
 */

import { AuditAction, AuditEntry, AuditLog, TreeId } from './types.js';
import { SettingsManager } from './settings.js';
import { StorageManager } from './storage.js';
import { CryptoSession, isEncrypted, EncryptedData } from './crypto.js';

const MAX_ENTRIES = 500;
const AUDIT_LOG_VERSION = 1;

function emptyLog(): AuditLog {
    return { version: AUDIT_LOG_VERSION, entries: [] };
}

class AuditLogManagerClass {
    private enabled = false;
    private batching = false;

    /**
     * Persist a log, encrypted with the session when encryption is on — the
     * audit store used to be the ONLY path writing plaintext (person names,
     * full action history) while everything else was encrypted (audit K1).
     * With the session locked the write is skipped; the in-memory cache keeps
     * the entries and the next write while unlocked flushes them.
     */
    private async persist(treeId: TreeId, log: AuditLog): Promise<void> {
        if (SettingsManager.isEncryptionEnabled()) {
            if (!CryptoSession.isUnlocked()) return;
            const encrypted = await CryptoSession.encrypt(JSON.stringify(log));
            await StorageManager.set('audit', treeId, encrypted);
            return;
        }
        await StorageManager.set('audit', treeId, log);
    }

    /** Read a stored log, decrypting when needed. null = unreadable now (locked). */
    private async readStored(treeId: TreeId): Promise<AuditLog | null> {
        const stored = await StorageManager.get<AuditLog | EncryptedData>('audit', treeId);
        if (!stored) return emptyLog();
        if (isEncrypted(stored)) {
            if (!CryptoSession.isUnlocked()) return null;
            try {
                return JSON.parse(await CryptoSession.decrypt(stored)) as AuditLog;
            } catch {
                return null;
            }
        }
        const plain = stored as AuditLog;
        if (!Array.isArray(plain.entries)) return emptyLog();
        // Legacy plaintext log under enabled encryption: re-persist encrypted.
        if (SettingsManager.isEncryptionEnabled() && CryptoSession.isUnlocked()) {
            void this.persist(treeId, plain);
        }
        return plain;
    }

    /** In-memory cache: treeId -> AuditLog */
    private cache = new Map<string, AuditLog>();
    /** Currently loaded tree ID (for fast log() calls) */
    private currentTreeId: TreeId | null = null;

    init(): void {
        this.enabled = SettingsManager.isAuditLogEnabled();
    }

    isBatching(): boolean {
        return this.batching;
    }

    beginBatch(): void {
        this.batching = true;
    }

    endBatch(
        treeId: TreeId | null,
        action: AuditAction,
        description: string
    ): void {
        this.batching = false;
        this.log(treeId, action, description);
    }

    cancelBatch(): void {
        this.batching = false;
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    setEnabled(value: boolean): void {
        this.enabled = value;
        SettingsManager.setAuditLog(value);
    }

    /**
     * Load audit log for a tree into cache
     * Call on switchTree / init
     */
    async loadForTree(treeId: TreeId): Promise<void> {
        this.currentTreeId = treeId;
        const stored = await StorageManager.get<AuditLog>('audit', treeId);
        if (stored && Array.isArray(stored.entries)) {
            this.cache.set(treeId, stored);
        } else {
            this.cache.set(treeId, emptyLog());
        }
    }

    /**
     * Synchronous log - writes to in-memory cache, fire-and-forget to IDB
     */
    log(
        treeId: TreeId | null,
        action: AuditAction,
        description: string
    ): void {
        if (!this.enabled || !treeId || this.batching) return;

        let log = this.cache.get(treeId);
        if (!log) {
            log = emptyLog();
            this.cache.set(treeId, log);
        }

        const entry: AuditEntry = {
            t: new Date().toISOString(),
            a: action,
            d: description
        };

        log.entries.push(entry);

        // Rotate oldest entries if over limit
        if (log.entries.length > MAX_ENTRIES) {
            log.entries = log.entries.slice(log.entries.length - MAX_ENTRIES);
        }

        // Fire-and-forget write to IDB (encrypted when encryption is on)
        void this.persist(treeId, log);
    }

    /**
     * Load audit log from IDB (or cache)
     */
    async load(treeId: TreeId): Promise<AuditLog> {
        // Check cache first
        const cached = this.cache.get(treeId);
        if (cached) return cached;

        const stored = await this.readStored(treeId);
        if (stored === null) return emptyLog();   // locked — do NOT cache empty
        if (Array.isArray(stored.entries)) {
            this.cache.set(treeId, stored);
            return stored;
        }
        const empty = emptyLog();
        this.cache.set(treeId, empty);
        return empty;
    }

    async clear(treeId: TreeId): Promise<void> {
        const empty = emptyLog();
        this.cache.set(treeId, empty);
        await StorageManager.set('audit', treeId, empty);   // plain empty is fine
    }

    async deleteForTree(treeId: TreeId): Promise<void> {
        this.cache.delete(treeId);
        await StorageManager.delete('audit', treeId);
    }

    async exportForTree(treeId: TreeId): Promise<AuditLog | null> {
        const log = await this.load(treeId);
        if (log.entries.length === 0) return null;
        return log;
    }

    async importForTree(treeId: TreeId, log: AuditLog): Promise<void> {
        if (!log || !Array.isArray(log.entries)) return;
        this.cache.set(treeId, log);
        await this.persist(treeId, log);
    }

    async hasEntries(treeId: TreeId): Promise<boolean> {
        const log = await this.load(treeId);
        return log.entries.length > 0;
    }

    /**
     * Get total storage size of all audit logs (estimate from metadata)
     */
    async getTotalSize(): Promise<number> {
        const keys = await StorageManager.keys('audit');
        let total = 0;
        for (const key of keys) {
            const log = await StorageManager.get<AuditLog>('audit', key);
            if (log) {
                total += JSON.stringify(log).length * 2; // rough UTF-16 estimate
            }
        }
        return total;
    }
}

export const AuditLogManager = new AuditLogManagerClass();
