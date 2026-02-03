/**
 * AuditLogManager - Records changes to tree data
 * Stored per-tree in localStorage, separate from tree data.
 * Max 500 entries with rotation of oldest.
 */

import { AuditAction, AuditEntry, AuditLog, AUDIT_LOG_PREFIX, TreeId } from './types.js';
import { SettingsManager } from './settings.js';

const MAX_ENTRIES = 500;
const AUDIT_LOG_VERSION = 1;

class AuditLogManagerClass {
    private enabled = false;
    private batching = false;

    init(): void {
        this.enabled = SettingsManager.isAuditLogEnabled();
    }

    /** Check if currently batching */
    isBatching(): boolean {
        return this.batching;
    }

    /** Suppress individual log calls until endBatch */
    beginBatch(): void {
        this.batching = true;
    }

    /** End batch and log a single summary entry */
    endBatch(
        treeId: TreeId | null,
        action: AuditAction,
        description: string
    ): void {
        this.batching = false;
        this.log(treeId, action, description);
    }

    /** Cancel batch without logging */
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

    log(
        treeId: TreeId | null,
        action: AuditAction,
        description: string
    ): void {
        if (!this.enabled || !treeId || this.batching) return;

        const log = this.load(treeId);
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

        this.save(treeId, log);
    }

    load(treeId: TreeId): AuditLog {
        try {
            const key = AUDIT_LOG_PREFIX + treeId;
            const stored = localStorage.getItem(key);
            if (stored) {
                const parsed = JSON.parse(stored) as AuditLog;
                if (parsed && Array.isArray(parsed.entries)) {
                    return parsed;
                }
            }
        } catch {
            // Return empty log on error
        }
        return { version: AUDIT_LOG_VERSION, entries: [] };
    }

    private save(treeId: TreeId, log: AuditLog): void {
        try {
            const key = AUDIT_LOG_PREFIX + treeId;
            localStorage.setItem(key, JSON.stringify(log));
        } catch {
            // Storage full - silently fail
        }
    }

    clear(treeId: TreeId): void {
        const key = AUDIT_LOG_PREFIX + treeId;
        localStorage.setItem(key, JSON.stringify({ version: AUDIT_LOG_VERSION, entries: [] }));
    }

    deleteForTree(treeId: TreeId): void {
        const key = AUDIT_LOG_PREFIX + treeId;
        localStorage.removeItem(key);
    }

    exportForTree(treeId: TreeId): AuditLog | null {
        const log = this.load(treeId);
        if (log.entries.length === 0) return null;
        return log;
    }

    importForTree(treeId: TreeId, log: AuditLog): void {
        if (!log || !Array.isArray(log.entries)) return;
        this.save(treeId, log);
    }

    hasEntries(treeId: TreeId): boolean {
        const log = this.load(treeId);
        return log.entries.length > 0;
    }

    /**
     * Get total storage size of all audit logs
     */
    getTotalSize(): number {
        let total = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(AUDIT_LOG_PREFIX)) {
                const value = localStorage.getItem(key);
                if (value) {
                    total += key.length + value.length;
                }
            }
        }
        return total * 2; // UTF-16 = 2 bytes per char
    }
}

export const AuditLogManager = new AuditLogManagerClass();
