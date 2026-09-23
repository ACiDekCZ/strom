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
        // A log whose stored copy was never read (locked at load time) holds
        // only the NEW entries: fold the stored history in first, or skip
        // while it is still unreadable — writing now would replace the whole
        // encrypted history with a handful of entries (review K7).
        if (!this.loaded.has(treeId)) {
            const stored = await this.readStored(treeId, false);
            if (stored === null) return;
            const merged: AuditLog = { version: AUDIT_LOG_VERSION, entries: [...stored.entries, ...log.entries] };
            if (merged.entries.length > MAX_ENTRIES) {
                merged.entries = merged.entries.slice(merged.entries.length - MAX_ENTRIES);
            }
            log.entries = merged.entries;
            this.cache.set(treeId, log);
            this.loaded.add(treeId);
        }
        if (SettingsManager.isEncryptionEnabled()) {
            if (!CryptoSession.isUnlocked()) return;
            const encrypted = await CryptoSession.encrypt(JSON.stringify(log));
            await StorageManager.set('audit', treeId, encrypted);
            return;
        }
        await StorageManager.set('audit', treeId, log);
    }

    /** Read a stored log, decrypting when needed. null = unreadable now (locked). */
    private async readStored(treeId: TreeId, reencodeLegacy = true): Promise<AuditLog | null> {
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
        if (reencodeLegacy && SettingsManager.isEncryptionEnabled() && CryptoSession.isUnlocked()) {
            this.loaded.add(treeId);
            this.persist(treeId, plain).catch(err => console.error('Audit log write failed', err));
        }
        return plain;
    }

    /** In-memory cache: treeId -> AuditLog */
    private cache = new Map<string, AuditLog>();
    /** Trees whose cached log includes the stored history (safe to persist). */
    private loaded = new Set<string>();
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

    /**
     * Hold: entries logged from now on are kept aside instead of written.
     * A staged dialog (DataManager edit session) writes them on Save
     * (flushHold) and forgets them on Discard (dropHold) — a rolled-back
     * change must not appear in the history.
     */
    private held: Array<{ treeId: TreeId; entry: AuditEntry }> | null = null;

    beginHold(): void {
        this.held = [];
    }

    flushHold(): void {
        const held = this.held;
        this.held = null;
        for (const { treeId, entry } of held ?? []) this.append(treeId, entry);
    }

    dropHold(): void {
        this.held = null;
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
        // Decrypt like load() does — reading the raw record cached an EMPTY
        // log for encrypted data, and the next log() overwrote the ciphertext
        // (review K7). Locked: cache nothing; persist() merges later.
        const stored = await this.readStored(treeId);
        if (stored === null) {
            if (!this.loaded.has(treeId)) this.cache.delete(treeId);
            return;
        }
        this.cache.set(treeId, stored);
        this.loaded.add(treeId);
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

        const entry: AuditEntry = {
            t: new Date().toISOString(),
            a: action,
            d: description
        };
        if (this.held) {
            this.held.push({ treeId, entry });
            return;
        }
        this.append(treeId, entry);
    }

    /** Write one entry into the tree's log (cache + fire-and-forget persist). */
    private append(treeId: TreeId, entry: AuditEntry): void {
        let log = this.cache.get(treeId);
        if (!log) {
            log = emptyLog();
            this.cache.set(treeId, log);
        }

        log.entries.push(entry);

        // Rotate oldest entries if over limit
        if (log.entries.length > MAX_ENTRIES) {
            log.entries = log.entries.slice(log.entries.length - MAX_ENTRIES);
        }

        // Fire-and-forget write to IDB (encrypted when encryption is on)
        this.persist(treeId, log).catch(err => console.error('Audit log write failed', err));
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
            this.loaded.add(treeId);
            return stored;
        }
        const empty = emptyLog();
        this.cache.set(treeId, empty);
        this.loaded.add(treeId);
        return empty;
    }

    async clear(treeId: TreeId): Promise<void> {
        const empty = emptyLog();
        this.cache.set(treeId, empty);
        this.loaded.add(treeId);
        await StorageManager.set('audit', treeId, empty);   // plain empty is fine
    }

    async deleteForTree(treeId: TreeId): Promise<void> {
        this.cache.delete(treeId);
        this.loaded.delete(treeId);
        await StorageManager.delete('audit', treeId);
    }

    /**
     * Re-write every stored log in the CURRENT encryption mode (called when
     * encryption is switched on/off, with the session unlocked). Returns the
     * number of logs that could not be converted (left untouched).
     */
    async reencodeAll(): Promise<number> {
        let failed = 0;
        for (const key of await StorageManager.keys('audit')) {
            const treeId = key as TreeId;
            const stored = await StorageManager.get<AuditLog | EncryptedData>('audit', treeId);
            if (!stored) continue;
            let log: AuditLog;
            try {
                if (isEncrypted(stored)) {
                    if (!CryptoSession.isUnlocked()) { failed++; continue; }
                    log = JSON.parse(await CryptoSession.decrypt(stored)) as AuditLog;
                } else {
                    log = stored as AuditLog;
                }
                if (!Array.isArray(log.entries)) continue;
                // Keep entries logged in memory since the last successful write.
                const cached = this.cache.get(treeId);
                if (cached && this.loaded.has(treeId)) log = cached;
                if (SettingsManager.isEncryptionEnabled()) {
                    if (!CryptoSession.isUnlocked()) { failed++; continue; }
                    await StorageManager.set('audit', treeId, await CryptoSession.encrypt(JSON.stringify(log)));
                } else {
                    await StorageManager.set('audit', treeId, log);
                }
                this.cache.set(treeId, log);
                this.loaded.add(treeId);
            } catch (err) {
                console.error('Audit log re-encoding failed', treeId, err);
                failed++;
            }
        }
        return failed;
    }

    async exportForTree(treeId: TreeId): Promise<AuditLog | null> {
        const log = await this.load(treeId);
        if (log.entries.length === 0) return null;
        return log;
    }

    async importForTree(treeId: TreeId, log: AuditLog): Promise<void> {
        if (!log || !Array.isArray(log.entries)) return;
        this.cache.set(treeId, log);
        this.loaded.add(treeId);   // an imported log replaces the stored one
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
