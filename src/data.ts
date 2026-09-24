/**
 * DataManager - CRUD operations for family tree data
 * Handles persons, partnerships, and relationships with type safety
 */

import {
    Person,
    PersonId,
    Partnership,
    PartnershipId,
    PartnershipStatus,
    StromData,
    NewPersonData,
    TreeId,
    generatePersonId,
    generateLifeEventId,
    LifeEvent,
    generateSourceId,
    generateParticipantId,
    ParticipantRole,
    Source,
    generateAttachmentId,
    Attachment,
    ParentChildRelType,
    generatePartnershipId,
    LAST_FOCUSED,
    LastFocusedMarker,
    STROM_DATA_VERSION,
    EmbeddedDataEnvelope,
    isEmbeddedEnvelope,
    FamilyWizardSpec,
    FamilyWizardMember,
    PlaceGeo,
} from './types.js';
import { strings, getCurrentLanguage, getStringsForLang, SUPPORTED_LANGUAGES } from './strings.js';
import { TreeManager } from './tree-manager.js';
import { isEncrypted, EncryptedData, decrypt } from './crypto.js';
import * as CrossTree from './cross-tree.js';
import { AuditLogManager } from './audit-log.js';
import { extractSubtree } from './subtree.js';
import { collectPlaces, renamePlace, placeKey, orphanedPlaceKeys } from './places.js';
import { StorageManager } from './storage.js';
import { surnameForms, addSurnameGroup, removeSurnameGroup } from './surnames.js';
import { ChangePacket, applyPacketOntoData } from './share-diff.js';
import { createSnapshot, getSnapshotJson, SnapshotReason, hasAutoSnapshotOnDay } from './snapshots.js';
import { ValidationIssue, stripUnsafeMediaDataUrls, translateValidationType } from './validation.js';
import { cloneTreeData } from './clone.js';
import { UndoManager } from './undo.js';
import { applyLivingPrivacy, applyContentOptions, ContentOptions, PrivacyMode } from './privacy.js';
import { safeFileName } from './filenames.js';

/** Extended updates for Partnership */
type PartnershipUpdates = Partial<Pick<Partnership, 'status' | 'startDate' | 'startPlace' | 'endDate' | 'note' | 'isPrimary'>>;

/**
 * Normalize text for search - removes diacritics and converts to lowercase
 */
function normalizeText(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');  // Remove diacritics
}

/** Delete keys whose value is undefined (an emptied optional field). */
function dropUndefinedKeys(obj: object): void {
    const rec = obj as Record<string, unknown>;
    for (const key of Object.keys(rec)) {
        if (rec[key] === undefined) delete rec[key];
    }
}

/** Import action types for view mode */
export type ViewModeImportAction = 'new' | 'update' | 'copy';

/** Format person name for audit log: "FirstName LastName (*year)" or "[unknown]" for placeholders */
export function auditPersonName(person: Person | null | undefined): string {
    if (!person) return '?';
    if (person.isPlaceholder) {
        return `[${strings.gender[person.gender].toLowerCase()}]`;
    }
    const name = [person.firstName, person.lastName].filter(Boolean).join(' ') || '?';
    const year = person.birthDate?.split('-')[0];
    return year ? `${name} (*${year})` : name;
}


/** A brand-new, empty tree. */
export function createEmptyData(): StromData {
    return {
        persons: {} as Record<PersonId, Person>,
        partnerships: {} as Record<PartnershipId, Partnership>
    };
}

/** One place that cites a source (see DataManager.listSourceCitations). */
export type SourceCitationRef =
    | { kind: 'person'; personId: PersonId }
    | { kind: 'event'; personId: PersonId; eventId: string }
    | { kind: 'partnership'; partnershipId: PartnershipId };

/**
 * Drop the re-crop link (fromAttachmentId + region) of every excerpt cut from
 * `attachmentId`. The excerpt image itself stays. Mutates `data`.
 */
export function unlinkExcerptsFromAttachment(data: StromData, attachmentId: string): void {
    for (const src of Object.values(data.sources ?? {})) {
        for (const exc of src.excerpts ?? []) {
            if (exc.fromAttachmentId === attachmentId) {
                delete exc.fromAttachmentId;
                delete exc.region;
            }
        }
    }
}

/**
 * Bring loaded data to the current shape. EVERY load goes through here — tree
 * switch, app restart, import, snapshot restore, opening a shared file.
 *
 * The result is built field by field, so ANY StromData field not named below is
 * silently dropped on load. That has bitten twice (Person.refn/question via a
 * different whitelist, and StromData.places, which lost every coordinate a user
 * had looked up). Adding a field to StromData means adding it here — the
 * round-trip test in src/__tests__/whitelist-guard.test.ts will not compile
 * until you do.
 *
 * Exported (not a private method) so that test can call it directly.
 */
export function migrateData(data: unknown): StromData {
    // Type guard and migration for older data formats
    if (!data || typeof data !== 'object') {
        return createEmptyData();
    }

    const d = data as Record<string, unknown>;
    const partnerships = (d.partnerships || {}) as Record<PartnershipId, Partnership>;

    // Migrate partnerships without status field
    for (const partnership of Object.values(partnerships)) {
        if (!partnership.status) {
            partnership.status = 'married';
        }
    }

    // v1 -> v2: Person.events was added. v2 -> v3: the per-tree source
    // catalog (sources) plus citation ids were added. All optional, so older
    // data needs no transformation; the version is re-stamped on next save.

    const result: StromData = {
        persons: (d.persons || {}) as Record<PersonId, Person>,
        partnerships
    };
    // Photos/attachments must be image (or PDF) data URLs — anything else
    // (data:text/html…) from a crafted file is dropped before it can be
    // stored or rendered.
    stripUnsafeMediaDataUrls(result);

    // Preserve the source catalog if present.
    if (d.sources && typeof d.sources === 'object') {
        result.sources = d.sources as StromData['sources'];
    }

    // Preserve place coordinates. This object is rebuilt field by field, so
    // anything not named here is dropped on EVERY load — tree switch, app
    // restart, opening a shared file. Add new StromData fields here too.
    if (d.places && typeof d.places === 'object') {
        result.places = d.places as StromData['places'];
    }

    if (Array.isArray(d.surnameVariants)) {
        result.surnameVariants = d.surnameVariants as StromData['surnameVariants'];
    }

    // Preserve default person settings if present
    if (d.defaultPersonId !== undefined) {
        result.defaultPersonId = d.defaultPersonId as PersonId | LastFocusedMarker;
    }
    if (d.lastFocusPersonId) {
        result.lastFocusPersonId = d.lastFocusPersonId as PersonId;
    }
    if (d.lastFocusDepthUp !== undefined) {
        result.lastFocusDepthUp = d.lastFocusDepthUp as number;
    }
    if (d.lastFocusDepthDown !== undefined) {
        result.lastFocusDepthDown = d.lastFocusDepthDown as number;
    }

    return result;
}

/**
 * Thrown by a mutation attempted while the local data is locked (see
 * DataManager.isLocked). The UI never offers one; this only guarantees that
 * an overlooked path cannot change the unsaved stand-in tree.
 */
export class DataLockedError extends Error {
    constructor() {
        super('Local data is locked; unlock it before editing');
        this.name = 'DataLockedError';
    }
}

class DataManagerClass {
    private data: StromData = {
        persons: {} as Record<PersonId, Person>,
        partnerships: {} as Record<PartnershipId, Partnership>
    };

    private currentTreeId: TreeId | null = null;

    // Undo/redo: deep copy of the data taken at the start of the current mutation.
    private pendingBefore: StromData | null = null;
    /** True while a batch (multiple mutations → one undo step) is in progress. */
    private batchActive = false;
    /** Nesting depth of beginBatch/commitBatch (a batch may run inside a batch). */
    private batchDepth = 0;
    /** Whether any inner mutation committed during the current batch. */
    private batchDirty = false;
    /** Description of the first inner mutation of the current batch. */
    private batchFirstDescription: string | null = null;

    /**
     * Notified after every single user mutation is committed (with the audit-log
     * description). The UI uses it to raise the "Undo" toast. NOT fired for bulk
     * flows (import / merge / batch), which pass `silent` — those have their own
     * UI. Set by the UI layer at startup; a no-op until then.
     */
    onMutationCommitted: ((description: string) => void) | null = null;

    /**
     * Notified after EVERY commit (single or silent bulk flow) and every
     * undo/redo — anything that changes canUndo()/canRedo(). The UI uses it to
     * keep the desktop Undo/Redo toolbar honest. Unlike onMutationCommitted this
     * fires for silent flows too: a silent import/merge/batch/restore still
     * clears the redo stack, so the toolbar must refresh even though no toast is
     * shown. Decoupled from render() because render() can early-return (empty
     * tree, no focus person) before its updateViewModeUI beat runs.
     */
    onUndoRedoChanged: (() => void) | null = null;

    // Pending encrypted embedded data (requires password to unlock)
    private pendingEncryptedEmbedded: EncryptedData | null = null;
    // "Export all" trees of an encrypted file (same password as the envelope)
    private pendingEncryptedAllTrees: EncryptedData | null = null;

    // View mode state
    private viewMode = false;
    /**
     * The tree that follows a running Strom Research (live bridge). While
     * followed it is read-only — the research is its source of truth — and
     * updates arrive through replaceWithSourceData().
     */
    private liveTreeId: TreeId | null = null;
    private embeddedEnvelope: EmbeddedDataEnvelope | null = null;
    private embeddedAllTrees: Record<string, { name: string; data: StromData; isHidden?: boolean }> | null = null;
    private activeEmbeddedTreeId: string | null = null;

    // Newer version detection
    private pendingNewerVersionData: StromData | null = null;
    private pendingNewerVersionInfo: { dataVersion: number; appVersion: string } | null = null;
    private newerVersionSource: 'storage' | 'embedded' | null = null;
    private importBlockedDueToVersion = false;

    // ==================== INITIALIZATION ====================

    /**
     * Initialize the DataManager
     */
    async init(): Promise<void> {
        // Initialize TreeManager first
        await TreeManager.init();

        // Check for embedded data (from exported HTML)
        const embedded = (window as Window & { STROM_EMBEDDED_DATA?: EmbeddedDataEnvelope }).STROM_EMBEDDED_DATA;
        const allTrees = (window as Window & { STROM_ALL_TREES?: Record<string, { name: string; data: StromData; isHidden?: boolean }> }).STROM_ALL_TREES;

        if (embedded) {
            // Validate envelope format
            if (!isEmbeddedEnvelope(embedded)) {
                console.error('Invalid embedded data format - missing envelope');
                await this.loadStartupTree();
                return;
            }

            this.embeddedEnvelope = embedded;

            // Store all trees if present (from "Export All" functionality)
            if (allTrees && typeof allTrees === 'object' && !isEncrypted(allTrees)) {
                this.setEmbeddedAllTrees(allTrees, embedded.data as StromData);
            } else if (isEncrypted(allTrees)) {
                // Password-protected "Export all": decrypted together with the
                // envelope (it used to be dropped, restoring only one tree).
                this.pendingEncryptedAllTrees = allTrees;
            }

            // Check if embedded data is encrypted
            const embeddedData = this.embeddedEnvelope.data;
            if (isEncrypted(embeddedData)) {
                // Store encrypted data - will need password prompt
                this.pendingEncryptedEmbedded = embeddedData;
                // Return early - UI will show password prompt, then call handleEmbeddedData
                return;
            }

            // Handle the embedded data (view mode or dialogs)
            this.handleEmbeddedData(embeddedData as StromData);
            return;
        }

        // Load startup tree based on defaultTreeId setting
        await this.loadStartupTree();
    }

    /**
     * Handle embedded data - enter view mode or show dialog
     * Called after init or after decryption
     */
    private handleEmbeddedData(data: StromData): void {
        if (!this.embeddedEnvelope) return;

        // Check data version compatibility
        const dataVersion = data.version ?? 1;
        if (dataVersion > STROM_DATA_VERSION) {
            // Data is from newer version - allow view mode but block import
            this.pendingNewerVersionData = data;
            this.pendingNewerVersionInfo = {
                dataVersion,
                appVersion: this.embeddedEnvelope.appVersion
            };
            this.newerVersionSource = 'embedded';
            // UI will show warning dialog via initViewMode
            return;
        }

        // Check if same export already exists in localStorage
        const existingTree = TreeManager.findTreeByExportId(this.embeddedEnvelope.exportId);

        if (existingTree) {
            // Tree from this export already exists - UI will show choice dialog
            // For now, enter view mode - UI will handle showing the dialog
            this.viewMode = true;
            this.data = migrateData(data);
            // Set current tree to null in view mode (not editing any localStorage tree)
            this.currentTreeId = null;
        } else {
            // New export - enter view mode
            this.viewMode = true;
            this.data = migrateData(data);
            this.currentTreeId = null;
        }
    }

    /**
     * Check if there is pending encrypted embedded data
     */
    hasPendingEncryptedData(): boolean {
        return this.pendingEncryptedEmbedded !== null;
    }

    /**
     * Get pending encrypted embedded data for password validation
     */
    getPendingEncryptedData(): EncryptedData | null {
        return this.pendingEncryptedEmbedded;
    }

    /**
     * Remember the "Export all" trees and mark the one the envelope shows as
     * active (the switcher used to highlight simply the first tree).
     */
    private setEmbeddedAllTrees(
        allTrees: Record<string, { name: string; data: StromData; isHidden?: boolean }>,
        shown: StromData | null
    ): void {
        this.embeddedAllTrees = allTrees;
        const ids = Object.keys(allTrees);
        const name = this.embeddedEnvelope?.treeName;
        const shownJson = shown ? JSON.stringify(shown) : null;
        const exact = shownJson !== null
            ? ids.find(id => allTrees[id].name === name && JSON.stringify(allTrees[id].data) === shownJson)
            : undefined;
        const byName = ids.find(id => allTrees[id].name === name);
        this.activeEmbeddedTreeId = exact ?? byName ?? ids[0] ?? null;
    }

    /**
     * Decrypt the pending embedded file with ITS password. Uses a key derived
     * just for this file — it must never replace the local session key, or
     * the user's own encrypted trees become unreadable and get overwritten
     * (review K8). Returns false on a wrong password.
     */
    async decryptEmbeddedData(password: string): Promise<boolean> {
        const pending = this.pendingEncryptedEmbedded;
        if (!pending) return false;
        let data: StromData;
        try {
            data = JSON.parse(await decrypt(pending, password)) as StromData;
        } catch {
            return false;
        }
        if (this.pendingEncryptedAllTrees) {
            try {
                const all = JSON.parse(await decrypt(this.pendingEncryptedAllTrees, password));
                if (all && typeof all === 'object') this.setEmbeddedAllTrees(all, data);
            } catch {
                // Different password for the trees bundle: keep the single tree.
            }
            this.pendingEncryptedAllTrees = null;
        }
        this.loadDecryptedEmbeddedData(data);
        return true;
    }

    /**
     * Load decrypted embedded data after password verification
     * @param decryptedData The decrypted StromData
     */
    loadDecryptedEmbeddedData(decryptedData: StromData): void {
        // Clear pending encrypted data
        this.pendingEncryptedEmbedded = null;

        // Handle embedded data with view mode logic
        this.handleEmbeddedData(decryptedData);

        // Notify UI of data change
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('strom:data-changed'));
    }

    // ==================== VIEW MODE ====================

    /**
     * Check if a person is locked (either individually or via tree lock)
     */
    isPersonLocked(personId: PersonId): boolean {
        if (this.isLocked()) return true;
        const person = this.data.persons[personId];
        if (person?.isLocked) return true;
        return this.isTreeLocked();
    }

    /**
     * Check if the active tree is locked
     */
    isTreeLocked(): boolean {
        if (this.liveTreeId !== null && this.liveTreeId === this.currentTreeId) return true;
        const meta = TreeManager.getActiveTreeMetadata();
        return meta?.isLocked === true;
    }

    /** Mark the tree that follows a live research (null = none). */
    setLiveTree(treeId: TreeId | null): void {
        this.liveTreeId = treeId;
    }

    /** The tree that follows a live research, if any. */
    getLiveTreeId(): TreeId | null {
        return this.liveTreeId;
    }

    /** The open tree is following a live research (read-only meanwhile). */
    isLiveFollowing(): boolean {
        return this.liveTreeId !== null && this.liveTreeId === this.currentTreeId;
    }

    /**
     * Check if currently in view mode (read-only)
     */
    isViewMode(): boolean {
        return this.viewMode;
    }

    /**
     * The local data is locked: encryption is on and the session was not
     * unlocked (startup prompt cancelled), the open tree could not be
     * decrypted with the session key, or an encrypted embedded file still
     * waits for its password. The in-memory tree is then an empty stand-in
     * that is never saved, so nothing may be edited until unlocking.
     */
    isLocked(): boolean {
        if (this.viewMode) return false;
        if (this.pendingEncryptedEmbedded) return true;
        return this.currentTreeId !== null && TreeManager.isTreeUnreadable(this.currentTreeId);
    }

    /** No edits allowed: read-only view of an embedded file, or locked data. */
    isReadOnly(): boolean {
        return this.viewMode || this.isLocked();
    }

    /**
     * Get the embedded envelope (for UI dialogs)
     */
    getEmbeddedEnvelope(): EmbeddedDataEnvelope | null {
        return this.embeddedEnvelope;
    }

    /**
     * Check if there is an existing tree from the same export
     */
    getExistingTreeFromExport(): { id: TreeId; name: string } | null {
        if (!this.embeddedEnvelope) return null;
        const tree = TreeManager.findTreeByExportId(this.embeddedEnvelope.exportId);
        if (tree) {
            return { id: tree.id, name: tree.name };
        }
        return null;
    }

    /**
     * Get list of embedded trees for view mode tree switcher
     */
    getEmbeddedTrees(): Array<{ id: string; name: string; isActive: boolean }> {
        if (!this.viewMode) return [];

        // If we have all trees (from "Export All"), use those
        if (this.embeddedAllTrees) {
            return Object.entries(this.embeddedAllTrees).map(([id, tree]) => ({
                id,
                name: tree.name,
                isActive: id === this.activeEmbeddedTreeId
            }));
        }

        // Single tree from envelope
        if (this.embeddedEnvelope) {
            return [{
                id: 'main',
                name: this.embeddedEnvelope.treeName,
                isActive: true
            }];
        }

        return [];
    }

    /**
     * Switch to a different embedded tree (view mode only)
     */
    switchEmbeddedTree(treeId: string): boolean {
        this.rollbackEditSession();   // whole-data replacement ends a staged dialog
        if (!this.viewMode || !this.embeddedAllTrees) return false;

        const tree = this.embeddedAllTrees[treeId];
        if (!tree) return false;

        this.activeEmbeddedTreeId = treeId;
        this.data = migrateData(tree.data);

        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('strom:data-changed'));
        return true;
    }

    /**
     * Get current embedded tree name
     */
    getCurrentEmbeddedTreeName(): string | null {
        if (!this.viewMode) return null;

        if (this.embeddedAllTrees && this.activeEmbeddedTreeId) {
            return this.embeddedAllTrees[this.activeEmbeddedTreeId]?.name || null;
        }

        return this.embeddedEnvelope?.treeName || null;
    }

    /**
     * Generate unique tree name - add date suffix if name already exists
     */
    private getUniqueTreeName(baseName: string, existingNames: Set<string>): string {
        if (!existingNames.has(baseName.toLowerCase())) {
            return baseName;
        }

        // Add date/time suffix (in the UI language and its locale)
        const now = new Date();
        const lang = getCurrentLanguage();
        const locale = lang === 'cs' ? 'cs-CZ' : lang === 'de' ? 'de-DE' : 'en-US';
        const dateStr = now.toLocaleDateString(locale);
        const timeStr = now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
        const suffix = strings.storageSafety.importedSuffix(dateStr, timeStr);
        let name = `${baseName} (${suffix})`;

        // If still exists (unlikely), add counter
        if (existingNames.has(name.toLowerCase())) {
            let counter = 2;
            while (existingNames.has(`${baseName} (${suffix} ${counter})`.toLowerCase())) {
                counter++;
            }
            name = `${baseName} (${suffix} ${counter})`;
        }

        return name;
    }

    /**
     * Import all embedded trees to storage
     * @returns Number of trees imported
     */
    async importAllEmbeddedTrees(): Promise<{ imported: number; skipped: number }> {
        if (!this.viewMode) return { imported: 0, skipped: 0 };

        let imported = 0;
        const skipped = 0;
        const existingNames = new Set(TreeManager.getTrees().map(t => t.name.toLowerCase()));
        const exportId = this.embeddedEnvelope?.exportId;
        let lastImportedId: TreeId | null = null;

        // If we have all trees (from "Export All")
        if (this.embeddedAllTrees) {
            for (const [embeddedId, tree] of Object.entries(this.embeddedAllTrees)) {
                const name = this.getUniqueTreeName(tree.name, existingNames);
                const newTreeId = TreeManager.createTreeFromImport(migrateData(tree.data), name);
                // Apply isHidden flag if it was set in the export
                if (tree.isHidden) {
                    TreeManager.setTreeVisibility(newTreeId, true);
                }
                // The envelope's tree carries the export id, so reopening the
                // same file offers this tree instead of another copy (V7).
                if (exportId && embeddedId === this.activeEmbeddedTreeId) {
                    TreeManager.setSourceExportId(newTreeId, exportId);
                }
                existingNames.add(name.toLowerCase());
                lastImportedId = newTreeId;
                imported++;
            }
        } else if (this.embeddedEnvelope) {
            // Single tree
            const name = this.getUniqueTreeName(this.embeddedEnvelope.treeName, existingNames);
            const newTreeId = TreeManager.createTreeFromImport(this.data, name);
            if (exportId) TreeManager.setSourceExportId(newTreeId, exportId);
            if (this.embeddedEnvelope.auditLog) {
                await AuditLogManager.importForTree(newTreeId, this.embeddedEnvelope.auditLog);
            }
            lastImportedId = newTreeId;
            imported = 1;
        }

        // Remove empty default tree after import
        if (imported > 0) {
            await this.removeEmptyDefaultTree();
        }

        // Exit view mode
        this.viewMode = false;
        this.embeddedEnvelope = null;
        this.embeddedAllTrees = null;
        this.activeEmbeddedTreeId = null;

        // Switch to last imported tree
        const trees = TreeManager.getTrees();
        const target = lastImportedId && TreeManager.getTreeMetadata(lastImportedId)
            ? lastImportedId
            : trees.length > 0 ? trees[trees.length - 1].id : null;
        if (target) {
            await this.switchTree(target);
        }

        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('strom:data-changed'));
        window.dispatchEvent(new CustomEvent('strom:tree-switched'));
        window.dispatchEvent(new CustomEvent('strom:view-mode-exit'));

        return { imported, skipped };
    }

    /**
     * Restore an "Export all" backup: every entry becomes a NEW tree (names
     * made unique), with its audit log when the backup carries one. Switches
     * to the last imported tree. Returns the new tree ids.
     */
    async importTreesAsNew(
        entries: Array<{ name: string; data: StromData; isHidden?: boolean; auditLog?: import('./types.js').AuditLog }>
    ): Promise<TreeId[]> {
        if (this.viewMode) return [];
        const existingNames = new Set(TreeManager.getTrees().map(t => t.name.toLowerCase()));
        const ids: TreeId[] = [];
        for (const entry of entries) {
            const name = this.getUniqueTreeName(entry.name || strings.treeManager.importTreeName, existingNames);
            const id = TreeManager.createTreeFromImport(migrateData(entry.data), name);
            if (entry.isHidden) TreeManager.setTreeVisibility(id, true);
            if (entry.auditLog) await AuditLogManager.importForTree(id, entry.auditLog);
            existingNames.add(name.toLowerCase());
            ids.push(id);
        }
        if (ids.length === 0) return ids;
        await this.removeEmptyDefaultTree();
        CrossTree.invalidateCache();
        // Land on a visible imported tree (never activate a hidden one).
        const target = [...ids].reverse().find(id => !TreeManager.getTreeMetadata(id)?.isHidden) ?? null;
        if (target) await this.switchTree(target);
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('strom:data-changed'));
            window.dispatchEvent(new CustomEvent('strom:tree-switched'));
        }
        return ids;
    }

    /**
     * Import from view mode with specified action
     * @param action 'new' = create new tree, 'update' = update existing, 'copy' = create copy
     */
    async importFromViewMode(action: ViewModeImportAction): Promise<void> {
        this.rollbackEditSession();   // whole-data replacement ends a staged dialog
        if (!this.embeddedEnvelope || !this.viewMode) return;

        const data = this.data;
        const existingTree = TreeManager.findTreeByExportId(this.embeddedEnvelope.exportId);

        switch (action) {
            case 'new': {
                // Create new tree linked to this export
                const treeId = TreeManager.createTreeFromImport(data, this.embeddedEnvelope.treeName);
                TreeManager.setSourceExportId(treeId, this.embeddedEnvelope.exportId);
                this.currentTreeId = treeId;
                // Remove empty default tree(s) after import
                await this.removeEmptyDefaultTree();
                break;
            }

            case 'update': {
                // Update existing tree
                if (existingTree) {
                    TreeManager.updateTreeFromImport(existingTree.id, data);
                    this.currentTreeId = existingTree.id;
                    TreeManager.setActiveTree(existingTree.id);
                }
                break;
            }

            case 'copy': {
                // Create copy with new name (no sourceExportId - it's a new lineage)
                const copyName = `${this.embeddedEnvelope.treeName} (${strings.treeManager.duplicateSuffix})`;
                const treeId = TreeManager.createTreeFromImport(data, copyName);
                this.currentTreeId = treeId;
                // Remove empty default tree(s) after import
                await this.removeEmptyDefaultTree();
                break;
            }
        }

        // Import audit log if present
        if (this.embeddedEnvelope.auditLog && this.currentTreeId) {
            await AuditLogManager.importForTree(this.currentTreeId, this.embeddedEnvelope.auditLog);
        }

        // Exit view mode
        this.viewMode = false;
        this.embeddedEnvelope = null;

        // Notify UI
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('strom:data-changed'));
        window.dispatchEvent(new CustomEvent('strom:tree-switched'));
        window.dispatchEvent(new CustomEvent('strom:view-mode-exit'));
    }

    /**
     * Switch to stored version of the tree (exit view mode, load from localStorage)
     */
    async switchToStoredVersion(): Promise<void> {
        if (!this.embeddedEnvelope) return;

        const existingTree = TreeManager.findTreeByExportId(this.embeddedEnvelope.exportId);
        if (existingTree) {
            // Exit view mode and switch to stored tree
            this.viewMode = false;
            this.embeddedEnvelope = null;
            await this.switchTree(existingTree.id);
        }
    }

    // ==================== VERSION COMPATIBILITY ====================

    /**
     * Check if there is pending newer version data
     */
    hasNewerVersionData(): boolean {
        return this.pendingNewerVersionData !== null;
    }

    /**
     * Get info about the newer version data
     */
    getNewerVersionInfo(): { dataVersion: number; appVersion: string; currentVersion: number } | null {
        if (!this.pendingNewerVersionInfo) return null;
        return {
            ...this.pendingNewerVersionInfo,
            currentVersion: STROM_DATA_VERSION
        };
    }

    /**
     * Export the newer version data as JSON (for user to import in newer app)
     */
    exportNewerVersionData(): void {
        if (!this.pendingNewerVersionData) return;

        const dataStr = JSON.stringify(this.pendingNewerVersionData, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'family-tree-export.json';
        a.click();
        URL.revokeObjectURL(a.href);
    }

    /**
     * Enter view mode with newer version data (read-only, import blocked)
     */
    viewNewerVersionData(): void {
        if (!this.pendingNewerVersionData) return;

        // Load data in view mode - import will be blocked
        this.viewMode = true;
        this.importBlockedDueToVersion = true;
        this.data = migrateData(this.pendingNewerVersionData);
        this.currentTreeId = null;

        // Clear pending state
        this.pendingNewerVersionData = null;
        this.pendingNewerVersionInfo = null;
        this.newerVersionSource = null;

        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('strom:data-changed'));
    }

    /**
     * Check if import is blocked due to version mismatch
     */
    isImportBlocked(): boolean {
        return this.importBlockedDueToVersion;
    }

    /**
     * Get the source of newer version data (for UI to show correct dialog)
     */
    getNewerVersionSource(): 'storage' | 'embedded' | null {
        return this.newerVersionSource;
    }

    /**
     * Check localStorage data version on startup
     * @returns true if data is compatible, false if newer version detected
     */
    async checkStorageVersion(): Promise<{ compatible: boolean; dataVersion?: number; currentVersion: number }> {
        const activeTreeId = TreeManager.getActiveTreeId();
        if (!activeTreeId) return { compatible: true, currentVersion: STROM_DATA_VERSION };

        const data = await TreeManager.getTreeData(activeTreeId);
        if (!data) return { compatible: true, currentVersion: STROM_DATA_VERSION };

        const dataVersion = data.version ?? 1;
        if (dataVersion > STROM_DATA_VERSION) {
            this.newerVersionSource = 'storage';
            this.pendingNewerVersionInfo = {
                dataVersion,
                appVersion: 'unknown'
            };
            return {
                compatible: false,
                dataVersion,
                currentVersion: STROM_DATA_VERSION
            };
        }

        return { compatible: true, currentVersion: STROM_DATA_VERSION };
    }

    /**
     * Check if JSON data version is compatible before import
     * @returns true if compatible, false if newer version
     */
    checkJsonVersion(data: StromData): { compatible: boolean; dataVersion: number; currentVersion: number } {
        const dataVersion = data.version ?? 1;
        return {
            compatible: dataVersion <= STROM_DATA_VERSION,
            dataVersion,
            currentVersion: STROM_DATA_VERSION
        };
    }

    /**
     * Load the startup tree based on defaultTreeId setting
     */
    private async loadStartupTree(): Promise<void> {
        // Get the tree that should be loaded at startup
        const startupTreeId = TreeManager.getStartupTreeId();

        if (startupTreeId) {
            // Set as active tree
            TreeManager.setActiveTree(startupTreeId);
            this.currentTreeId = startupTreeId;

            // Load audit log cache for startup tree
            await AuditLogManager.loadForTree(startupTreeId);

            // Locked / undecryptable data loads as an empty stand-in, but
            // TreeManager refuses to save over it (review K8).
            const treeData = await TreeManager.getTreeData(startupTreeId);
            if (treeData) {
                this.data = migrateData(treeData);
                return;
            }
            this.data = this.createEmptyData();
            return;
        }

        // No startup tree or tree data not found - create empty data
        this.currentTreeId = TreeManager.getActiveTreeId();
        this.data = this.createEmptyData();
    }

    /**
     * Switch to a different tree
     * @param treeId The tree to switch to
     * @returns true if successful
     */
    /** Collaboration: leave embedded view mode and open a local tree (reply-merge flow). */
    async leaveViewModeToTree(treeId: TreeId): Promise<boolean> {
        this.viewMode = false;
        return this.switchTree(treeId);
    }

    async switchTree(treeId: TreeId): Promise<boolean> {
        this.rollbackEditSession();   // whole-data replacement ends a staged dialog
        // Flush pending writes (including the per-tree save queues) before
        // switching (ensure current tree data is persisted)
        await TreeManager.flush();

        if (!TreeManager.setActiveTree(treeId)) {
            return false;
        }

        this.currentTreeId = treeId;
        const treeData = await TreeManager.getTreeData(treeId);
        if (treeData) {
            this.data = migrateData(treeData);
        } else {
            this.data = this.createEmptyData();
            // Locked / wrong key: an empty stand-in that is never saved (K8);
            // let the UI offer unlocking.
            if (TreeManager.isTreeUnreadable(treeId) && typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('strom:tree-unreadable', { detail: { treeId } }));
            }
        }

        // Load audit log cache for the new tree
        await AuditLogManager.loadForTree(treeId);

        // Save last tree if setting is LAST_FOCUSED
        TreeManager.saveLastTree(treeId);

        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('strom:data-changed'));
        return true;
    }

    /**
     * Reload current tree data (async, for encrypted data)
     * Used after unlocking crypto session to load decrypted data
     */
    async reloadCurrentTree(): Promise<void> {
        this.rollbackEditSession();   // whole-data replacement ends a staged dialog
        if (!this.currentTreeId) return;

        const treeId = this.currentTreeId;
        const treeData = await TreeManager.getTreeData(treeId);
        if (treeData) {
            this.data = migrateData(treeData);
        } else {
            this.data = this.createEmptyData();
            // Unlocked, but this tree carries another key (e.g. the startup
            // prompt opened a different tree's password): let the UI ask for
            // this tree's own password (K8).
            if (TreeManager.isTreeUnreadable(treeId) && typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('strom:tree-unreadable', { detail: { treeId } }));
            }
        }

        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('strom:data-changed'));
    }

    /**
     * Get current tree ID
     */
    getCurrentTreeId(): TreeId | null {
        return this.currentTreeId;
    }

    private createEmptyData(): StromData {
        return createEmptyData();
    }

    private save(): void {
        // Never save in view mode (read-only) or over locked data (the
        // in-memory tree is a stand-in; TreeManager would refuse it anyway).
        if (this.viewMode || this.isLocked()) return;
        // A staged dialog persists on commit only; a rollback re-saves.
        if (this.editSession) return;

        if (this.currentTreeId) {
            TreeManager.saveTreeData(this.currentTreeId, this.data);
        }
    }

    // ==================== UNDO / REDO ====================

    /**
     * Snapshot the data as it is now (before the current mutation changes it).
     * Called at the start of every undoable mutation. No-op in view mode.
     */
    private beginMutation(): void {
        // Locked data is an empty stand-in: refuse before anything changes
        // (defense in depth — the UI hides every edit entry point).
        if (this.isLocked()) throw new DataLockedError();
        if (this.viewMode) return;
        // Inside a batch the pre-state was captured once by beginBatch; the inner
        // mutations must not re-snapshot (that would split the batch into steps).
        if (this.batchActive) return;
        this.pendingBefore = cloneTreeData(this.data);
    }

    /**
     * Finish an undoable mutation: push the pre-mutation snapshot onto the undo
     * stack with a description, then persist. Replaces this.save() at the end of
     * mutation methods. During a batch this defers to commitBatch (no push/save).
     */
    private commitMutation(description: string, silent = false): void {
        if (this.batchActive) {
            this.batchDirty = true;
            if (this.batchFirstDescription === null) this.batchFirstDescription = description;
            return;
        }
        UndoManager.setActiveTree(this.currentTreeId);
        if (this.pendingBefore) {
            // Auto-backup the FIRST mutation of the day (state before it).
            this.maybeAutoSnapshot(this.pendingBefore);
            UndoManager.push({ data: this.pendingBefore, description });
            this.pendingBefore = null;
        }
        this.save();
        // The Undo/Redo availability just changed (a push clears the redo stack)
        // — refresh the toolbar for EVERY commit, silent flows included. Doing it
        // here rather than piggy-backing on the next render keeps the toolbar
        // honest even when render() early-returns (empty tree / no focus).
        this.onUndoRedoChanged?.();
        // Single user actions raise the Undo toast; bulk flows (import / merge /
        // batch) pass silent — they surface their own result UI instead.
        if (!silent && !this.viewMode) this.onMutationCommitted?.(description);
    }

    /** Description a single undo would reverse (for the ⋯ menu label), or null. */
    lastUndoDescription(): string | null {
        UndoManager.setActiveTree(this.currentTreeId);
        return UndoManager.peekUndoDescription();
    }

    /**
     * Batch mode: record a whole series of mutations as ONE undo step. Wrap a
     * group of createPerson/addParentChild/createPartnership calls in
     * beginBatch() … commitBatch(desc); the inner methods' own begin/commit
     * become no-ops, so a single Ctrl+Z reverts the whole group (used by the
     * family wizard). Non-invasive: no mutation method needs to change.
     */
    beginBatch(): void {
        if (this.viewMode || this.isLocked()) return;
        // Nested batches (e.g. the family wizard inside a UI-level runBatch)
        // join the outermost one: only the outermost commit records the step.
        if (this.batchActive) {
            this.batchDepth++;
            return;
        }
        this.beginMutation();      // one pre-state snapshot for the whole batch
        this.batchActive = true;
        this.batchDepth = 1;
        this.batchDirty = false;
        this.batchFirstDescription = null;
    }

    /**
     * Commit the batch as a single undo entry, then persist. Only the
     * outermost commit of nested batches records the step; a batch in which
     * nothing was committed records no step at all. `silent` (the default,
     * for flows with their own result UI such as the family wizard) skips the
     * Undo toast. `description === null` uses the first inner mutation's.
     */
    commitBatch(description: string | null, silent = true): void {
        if (!this.batchActive) return;
        if (--this.batchDepth > 0) return;
        this.batchActive = false;
        const dirty = this.batchDirty;
        const desc = description ?? this.batchFirstDescription ?? '';
        this.batchDirty = false;
        this.batchFirstDescription = null;
        if (!dirty) {
            this.pendingBefore = null;   // nothing changed — no undo step
            return;
        }
        this.commitMutation(desc, silent);
    }

    /**
     * Run one user action made of several mutations as ONE undo step with ONE
     * Undo toast (review V12). The batch is closed on every path, including a
     * throw. `description === null` names the step after the first inner
     * mutation (e.g. "adding Jan Novák" for a create-then-edit save).
     */
    runBatch<T>(description: string | null, fn: () => T): T {
        this.beginBatch();
        try {
            return fn();
        } finally {
            this.commitBatch(description, false);
        }
    }

    // ==================== EDIT SESSIONS (staged dialogs) ====================

    /**
     * An edit session makes a dialog "staged" from the user's point of view
     * while its operations still apply live (review S9): everything between
     * beginEditSession() and commitEditSession() lands as ONE undo step, and
     * rollbackEditSession() restores the state captured at the start without
     * recording anything. It is a batch underneath, so nested runBatch calls
     * of the individual operations join it instead of recording their own
     * steps; nothing is persisted and no audit entry is written until commit.
     */
    private editSession: { treeId: TreeId | null; before: StromData } | null = null;

    /** Start a session. Returns false (and does nothing) when one cannot start. */
    beginEditSession(): boolean {
        if (this.isReadOnly() || this.editSession || this.batchActive) return false;
        this.editSession = { treeId: this.currentTreeId, before: cloneTreeData(this.data) };
        this.beginBatch();
        AuditLogManager.beginHold();
        return true;
    }

    isEditSessionActive(): boolean {
        return this.editSession !== null;
    }

    /** Whether the data now differs from the state at the start of the session. */
    editSessionHasChanges(): boolean {
        const s = this.editSession;
        if (!s) return false;
        return JSON.stringify(this.data) !== JSON.stringify(s.before);
    }

    /** Leave batch mode without recording anything (session end paths). */
    private resetBatchState(): void {
        this.batchActive = false;
        this.batchDepth = 0;
        this.batchDirty = false;
        this.batchFirstDescription = null;
        this.pendingBefore = null;
    }

    /**
     * Keep the session's changes: one undo step (with the Undo toast), one
     * save, and the held audit entries written. `description === null` names
     * the step after the first operation of the session.
     */
    commitEditSession(description: string | null): void {
        const s = this.editSession;
        if (!s) return;
        this.editSession = null;
        if (this.currentTreeId !== s.treeId || !this.batchActive) {
            // The tree changed under the session: its data is gone anyway.
            this.resetBatchState();
            AuditLogManager.dropHold();
            return;
        }
        AuditLogManager.flushHold();
        this.batchDepth = 1;   // an operation left unbalanced must not keep it open
        this.commitBatch(description, false);
    }

    /**
     * Throw the session's changes away: restore the data captured at the
     * start. No undo step, no audit entry. Returns true when data changed
     * (the caller re-renders).
     */
    rollbackEditSession(): boolean {
        const s = this.editSession;
        if (!s) return false;
        this.editSession = null;
        this.resetBatchState();
        AuditLogManager.dropHold();
        if (this.currentTreeId !== s.treeId) return false;
        if (JSON.stringify(this.data) === JSON.stringify(s.before)) return false;
        this.data = s.before;
        this.save();
        if (this.currentTreeId) CrossTree.invalidateCacheForTree(this.currentTreeId);
        return true;
    }

    // ==================== VERSIONED BACKUPS (snapshots) ====================

    /** In-session guard so only the first mutation of a day auto-snapshots. */
    private lastAutoSnapshotDay = new Map<TreeId, string>();

    private maybeAutoSnapshot(before: StromData): void {
        if (this.viewMode || !this.currentTreeId) return;
        // An empty pre-state has nothing worth restoring — don't create a
        // useless "0 people" backup, and don't consume the daily slot either
        // (the first MEANINGFUL mutation of the day should still snapshot).
        if (!Object.values(before.persons).some(p => !p.isPlaceholder)) return;
        const treeId = this.currentTreeId;
        const now = Date.now();
        const today = new Date(now).toISOString().slice(0, 10);
        if (this.lastAutoSnapshotDay.get(treeId) === today) return;
        this.lastAutoSnapshotDay.set(treeId, today);
        // Fire-and-forget; backups are best-effort (storage may be unavailable).
        // The in-memory guard resets on reload — check the store too, so the
        // first edit after every reload does not replace the day's backup
        // with a later state.
        void hasAutoSnapshotOnDay(treeId, now)
            .then(exists => exists ? undefined : createSnapshot(treeId, before, 'auto', now))
            .catch(() => {});
    }

    /** Take a snapshot of the current tree now (manual / pre-import / pre-merge). */
    async snapshotNow(reason: SnapshotReason): Promise<void> {
        if (this.viewMode || !this.currentTreeId) return;
        await createSnapshot(this.currentTreeId, this.data, reason, Date.now());
    }

    /**
     * Restore a snapshot into the current tree. Goes through migrateData (a
     * snapshot may be from an older data version) and the undo path, so Ctrl+Z
     * reverts the restore. Returns true on success.
     */
    async restoreSnapshot(snapshotId: string): Promise<boolean> {
        this.rollbackEditSession();   // whole-data replacement ends a staged dialog
        if (this.isReadOnly() || !this.currentTreeId) return false;
        const json = await getSnapshotJson(snapshotId);
        if (!json) return false;
        const migrated = migrateData(JSON.parse(json));

        this.beginMutation();
        this.data = migrated;
        this.commitMutation(strings.undo.restoreBackup, true);
        AuditLogManager.log(this.currentTreeId, 'data.load', strings.auditLog.restoredBackup);
        if (this.currentTreeId) CrossTree.invalidateCacheForTree(this.currentTreeId);
        return true;
    }

    canUndo(): boolean {
        if (this.isLocked()) return false;
        UndoManager.setActiveTree(this.currentTreeId);
        return UndoManager.canUndo();
    }

    canRedo(): boolean {
        if (this.isLocked()) return false;
        UndoManager.setActiveTree(this.currentTreeId);
        return UndoManager.canRedo();
    }

    /**
     * Restore the previous data snapshot. Returns the undone action's
     * description (for the toast), or null when there is nothing to undo.
     */
    undo(): { description: string } | null {
        if (this.isReadOnly() || !this.currentTreeId) return null;
        // A staged dialog is open: its own Save/Discard settle the data.
        if (this.editSession) return null;
        // A locked tree is read-only — undo would rewrite it (review S21).
        if (this.isTreeLocked()) return null;
        UndoManager.setActiveTree(this.currentTreeId);
        const restored = UndoManager.undo(cloneTreeData(this.data));
        if (!restored) return null;
        this.applyRestoredData(restored.data);
        AuditLogManager.log(this.currentTreeId, 'undo', strings.auditLog.undoAction(restored.description));
        return { description: restored.description };
    }

    /** Replay the last undone snapshot. Symmetric to undo(). */
    redo(): { description: string } | null {
        if (this.isReadOnly() || !this.currentTreeId) return null;
        // A staged dialog is open: its own Save/Discard settle the data.
        if (this.editSession) return null;
        if (this.isTreeLocked()) return null;
        UndoManager.setActiveTree(this.currentTreeId);
        const restored = UndoManager.redo(cloneTreeData(this.data));
        if (!restored) return null;
        this.applyRestoredData(restored.data);
        AuditLogManager.log(this.currentTreeId, 'redo', strings.auditLog.redoAction(restored.description));
        return { description: restored.description };
    }

    /** Swap in restored data and persist it, without recording a new undo step. */
    private applyRestoredData(data: StromData): void {
        this.data = cloneTreeData(data);
        this.pendingBefore = null;
        if (!this.viewMode && this.currentTreeId) {
            TreeManager.saveTreeData(this.currentTreeId, this.data);
            CrossTree.invalidateCacheForTree(this.currentTreeId);
        }
    }

    // ==================== SURNAMES ====================

    /**
     * Record that these spellings mean the same family. Tree-level on purpose:
     * a spelling belongs to the NAME, so it is said once and holds for everyone,
     * including people added later.
     */
    addSurnameGroup(names: string[]): void {
        const next = addSurnameGroup(this.data, names);
        if (next === this.data.surnameVariants || next.length === 0) return;
        this.beginMutation();
        this.data.surnameVariants = next;
        this.commitMutation(strings.undo.addSurnameGroup(names.join(', ')));
    }

    removeSurnameGroup(surname: string): void {
        const next = removeSurnameGroup(this.data, surname);
        if (next.length === (this.data.surnameVariants ?? []).length) return;
        this.beginMutation();
        this.data.surnameVariants = next.length > 0 ? next : undefined;
        this.commitMutation(strings.undo.removeSurnameGroup(surname));
    }

    // ==================== PLACES ====================

    /**
     * Store coordinates for places (keyed by placeKey). Written into the tree's
     * own data so they travel with the file and the map keeps working offline.
     * Goes through the normal mutation path, so undo covers it.
     */
    setPlaceGeos(geos: ReadonlyMap<string, PlaceGeo>): void {
        if (geos.size === 0) return;
        this.beginMutation();
        this.data.places = { ...this.data.places };
        for (const [key, geo] of geos) this.data.places[key] = geo;
        this.commitMutation(strings.undo.geocodePlaces(geos.size));
    }

    /**
     * Rename a place everywhere it is used (a typo, or a name only the family
     * would recognise). Renaming changes the place's KEY, so any coordinates
     * already found must move with it — otherwise a rename would silently drop
     * the pin off the map.
     *
     * @returns how many fields changed
     */
    renamePlaceTo(key: string, newName: string): number {
        const target = newName.trim();
        if (!target) return 0;
        const { data: renamed, changed } = renamePlace(this.data, key, target);
        if (changed === 0) return 0;

        this.beginMutation();
        this.data = renamed;

        const geo = this.data.places?.[key];
        const newKey = placeKey(target);
        if (geo && newKey !== key) {
            const places = { ...this.data.places };
            delete places[key];
            // If the name it merges into is already on the map, that pin wins —
            // it was placed for this spelling, so it is the more specific answer.
            if (!places[newKey]) places[newKey] = geo;
            this.data.places = places;
        }
        this.commitMutation(strings.undo.renamePlace(target));
        return changed;
    }

    /**
     * Forget a place's coordinates (a wrong match). The place itself and every
     * person's record of it stay untouched — only the pin is removed.
     */
    clearPlaceGeo(key: string): void {
        if (!this.data.places?.[key]) return;
        this.beginMutation();
        const places = { ...this.data.places };
        delete places[key];
        this.data.places = places;
        this.commitMutation(strings.undo.clearPlaceGeo);
    }

    /**
     * Drop coordinate entries for places nothing in the tree refers to any more
     * (see orphanedPlaceKeys). Housekeeping after edits/deletes leave stale
     * geocache behind. Normal mutation path: one undo step, one audit entry,
     * the Undo toast. Returns how many were removed.
     */
    clearOrphanPlaces(): number {
        const orphans = orphanedPlaceKeys(this.data);
        if (orphans.length === 0) return 0;
        this.beginMutation();
        const places = { ...this.data.places };
        for (const key of orphans) delete places[key];
        this.data.places = places;
        this.commitMutation(strings.undo.cleanOrphanPlaces(orphans.length));
        if (this.currentTreeId) {
            AuditLogManager.log(this.currentTreeId, 'place.clean',
                strings.auditLog.cleanedOrphanPlaces(orphans.length));
        }
        return orphans.length;
    }

    // ==================== GETTERS ====================

    getData(): StromData {
        return this.data;
    }

    getPerson(id: PersonId): Person | null {
        return this.data.persons[id] ?? null;
    }

    getPartnership(id: PartnershipId): Partnership | null {
        return this.data.partnerships[id] ?? null;
    }

    getAllPersons(): Person[] {
        return Object.values(this.data.persons);
    }

    getAllPartnerships(): Partnership[] {
        return Object.values(this.data.partnerships);
    }

    /**
     * Search persons by query (case/accent insensitive)
     * Query is split into words, all must match somewhere in person data
     */
    searchPersons(query: string): Person[] {
        const normalizedQuery = normalizeText(query);
        const queryParts = normalizedQuery.split(/\s+/).filter(p => p.length > 0);

        if (queryParts.length === 0) return [];

        return this.getAllPersons().filter(person => {
            // Build searchable text from person data
            const searchText = normalizeText([
                person.firstName,
                person.lastName,
                // Every spelling of this surname counts as this person's name:
                // someone searching "Víšek" must find the great-grandfather they
                // entered as "Vyšek", or they decide he is missing and add him
                // twice. Written down once per tree, not per person.
                ...surnameForms(person.lastName, this.data).slice(1),
                // Plus anything that belongs to this person alone (alias, the
                // farm the family was known by).
                ...(person.nameVariants ?? []),
                person.birthDate?.split('-')[0] || '',  // birth year
                person.deathDate?.split('-')[0] || ''   // death year
            ].join(' '));

            // All query parts must match somewhere in searchText
            return queryParts.every(part => searchText.includes(part));
        });
    }

    // ==================== PERSON CRUD ====================

    createPerson(personData: NewPersonData, isPlaceholder = false): Person {
        this.beginMutation();
        const person: Person = {
            id: generatePersonId(),
            firstName: isPlaceholder ? '?' : personData.firstName,
            lastName: personData.lastName,
            gender: personData.gender,
            isPlaceholder,
            partnerships: [],
            parentIds: [],
            childIds: [],
            birthDate: personData.birthDate,
            birthPlace: personData.birthPlace,
            deathDate: personData.deathDate,
            deathPlace: personData.deathPlace
        };

        this.data.persons[person.id] = person;
        this.commitMutation(strings.undo.addPerson(auditPersonName(person)));
        // Audit log
        if (isPlaceholder) {
            AuditLogManager.log(this.currentTreeId, 'person.create', strings.auditLog.createdPlaceholder(strings.gender[person.gender]));
        } else {
            AuditLogManager.log(this.currentTreeId, 'person.create', strings.auditLog.createdPerson(auditPersonName(person)));
        }
        // Invalidate cross-tree cache when person is created
        if (this.currentTreeId) {
            CrossTree.invalidateCacheForTree(this.currentTreeId);
        }
        return person;
    }

    /**
     * Add a whole family around an anchor person in ONE undo step (family
     * wizard). Empty members are skipped; a member with `existingId` links to
     * that person instead of creating a duplicate. Returns the number of NEW
     * persons created. All the inner mutations run inside a batch, so a single
     * Ctrl+Z reverts the entire family.
     */
    addFamily(spec: FamilyWizardSpec): number {
        const anchor = this.data.persons[spec.anchorId];
        if (this.isReadOnly() || !anchor) return 0;

        let created = 0;
        // Resolve a member to a person id: link existing, create new, or skip.
        const resolve = (m?: FamilyWizardMember): PersonId | null => {
            if (!m) return null;
            if (m.existingId && this.data.persons[m.existingId]) return m.existingId;
            if (!m.firstName.trim() && !m.lastName.trim()) return null;
            const p = this.createPerson({
                firstName: m.firstName.trim(),
                lastName: m.lastName.trim(),
                gender: m.gender,
                ...(m.birthDate ? { birthDate: m.birthDate } : {}),
            });
            created++;
            return p.id;
        };

        this.beginBatch();
        AuditLogManager.beginBatch();

        // A throw with batchActive left set would silently disable every later
        // begin/commitMutation (no undo entries, no saves) until reload — the
        // batch MUST close on every path.
        try {
            // The anchor keeps the parents it already has: a wizard parent is
            // either one of them (linked by existingId) or fills a FREE slot.
            // With both slots taken, a new parent is not even created — it
            // could only become a third parent (review V11).
            let freeSlots = 2 - anchor.parentIds.length;
            const resolveParent = (m?: FamilyWizardMember): PersonId | null => {
                if (!m) return null;
                if (m.existingId && anchor.parentIds.includes(m.existingId)) return m.existingId;
                if (freeSlots <= 0) return null;
                const id = resolve(m);
                if (!id) return null;
                if (!this.canAddParentChild(id, spec.anchorId)) return null;
                freeSlots--;
                return id;
            };
            const fatherId = resolveParent(spec.father);
            const motherId = resolveParent(spec.mother);
            for (const pid of [fatherId, motherId]) {
                if (pid) this.addParentChild(pid, spec.anchorId);
            }
            // Parents' partnership (so anchor + siblings share the same couple)
            // — only between the anchor's actual two parents, never between a
            // new parent and someone who is not the anchor's other parent.
            let parentUnion: PartnershipId | undefined;
            const parents = [...anchor.parentIds];
            if (parents.length === 2) {
                const u = this.createPartnership(parents[0], parents[1]);
                parentUnion = u?.id;
                if (parentUnion) this.addParentChild(parents[0], spec.anchorId, parentUnion);
            }

            // Siblings share the anchor's parents.
            for (const s of spec.siblings) {
                const sid = resolve(s);
                if (!sid) continue;
                for (const pid of parents) {
                    this.addParentChild(pid, sid, parentUnion);
                }
            }

            // Partner + shared children.
            const partnerId = resolve(spec.partner);
            let coupleUnion: PartnershipId | undefined;
            if (partnerId) {
                const u = this.createPartnership(spec.anchorId, partnerId);
                coupleUnion = u?.id;
                if (u && spec.partner?.weddingDate) u.startDate = spec.partner.weddingDate;
            }
            for (const c of spec.children) {
                const cid = resolve(c);
                if (!cid) continue;
                this.addParentChild(spec.anchorId, cid, coupleUnion);
                if (partnerId) this.addParentChild(partnerId, cid, coupleUnion);
            }
        } finally {
            this.commitBatch(strings.undo.addFamily(auditPersonName(anchor)));
            AuditLogManager.endBatch(this.currentTreeId, 'person.create',
                strings.auditLog.addedFamily(auditPersonName(anchor), created));
        }
        if (this.currentTreeId) CrossTree.invalidateCacheForTree(this.currentTreeId);
        return created;
    }

    updatePerson(id: PersonId, updates: Partial<Person>): Person | null {
        const person = this.data.persons[id];
        if (!person) return null;

        this.beginMutation();
        // To tell a real edit from "Save without changes" (no undo step then).
        const personBefore = JSON.stringify(person);

        // Allow toggling isLocked even when person is locked
        if (updates.isLocked !== undefined) {
            person.isLocked = updates.isLocked || undefined;
            // If only isLocked changed, save and return early
            const otherKeys = Object.keys(updates).filter(k => k !== 'isLocked');
            if (otherKeys.length === 0) {
                this.commitMutation(strings.undo.editPerson(auditPersonName(person)));
                return person;
            }
        }

        // Block updates on locked persons (except isLocked which is handled
        // above). If isLocked WAS just changed alongside other fields, that
        // change must still be committed — the old early return left it in
        // memory only (never saved, no undo entry).
        if (this.isPersonLocked(id)) {
            if (updates.isLocked !== undefined) {
                this.commitMutation(strings.undo.editPerson(auditPersonName(person)));
            } else {
                this.pendingBefore = null;
            }
            return person;
        }

        // Track changed fields with old→new values for audit log
        const changedFields: string[] = [];
        const diff = (label: string, oldVal: string | undefined, newVal: string | undefined) => {
            const o = oldVal || '–';
            const n = newVal || '–';
            changedFields.push(`${label}: ${o} → ${n}`);
        };
        if (updates.firstName !== undefined && updates.firstName !== person.firstName) diff(strings.labels.firstName, person.firstName, updates.firstName);
        if (updates.lastName !== undefined && updates.lastName !== person.lastName) diff(strings.labels.lastName, person.lastName, updates.lastName);
        if (updates.gender !== undefined && updates.gender !== person.gender) diff(strings.labels.gender, strings.gender[person.gender], strings.gender[updates.gender]);
        if (updates.birthDate !== undefined && (updates.birthDate || undefined) !== person.birthDate) diff(strings.labels.birthDate, person.birthDate, updates.birthDate);
        if (updates.birthPlace !== undefined && (updates.birthPlace || undefined) !== person.birthPlace) diff(strings.labels.birthPlace, person.birthPlace, updates.birthPlace);
        if (updates.deathDate !== undefined && (updates.deathDate || undefined) !== person.deathDate) diff(strings.labels.deathDate, person.deathDate, updates.deathDate);
        if (updates.deathPlace !== undefined && (updates.deathPlace || undefined) !== person.deathPlace) diff(strings.labels.deathPlace, person.deathPlace, updates.deathPlace);
        if (updates.notes !== undefined && (updates.notes || undefined) !== person.notes) diff(strings.labels.notes, person.notes, updates.notes);
        if (updates.refn !== undefined && (updates.refn || undefined) !== person.refn) diff(strings.labels.refn, person.refn, updates.refn);
        if (updates.question !== undefined && (updates.question || undefined) !== person.question) diff(strings.labels.question, person.question, updates.question);

        const lastNameBefore = person.lastName ?? '';
        if (updates.firstName !== undefined) person.firstName = updates.firstName;
        if (updates.lastName !== undefined) person.lastName = updates.lastName;
        // A placeholder that got a real name — first OR last — is a person now
        // (a surname alone is enough, like in the relation modal). A surname
        // the placeholder was created with (the "?" father of a new sibling)
        // does not count until it is actually edited.
        if (person.isPlaceholder && (updates.firstName !== undefined || updates.lastName !== undefined)) {
            const first = (person.firstName ?? '').trim();
            const last = (person.lastName ?? '').trim();
            if ((first && first !== '?') || (last && person.lastName !== lastNameBefore)) {
                person.isPlaceholder = false;
                if (first === '?') person.firstName = '';
            }
        }
        if (updates.gender !== undefined) person.gender = updates.gender;

        // Extended info
        if (updates.birthDate !== undefined) person.birthDate = updates.birthDate || undefined;
        if (updates.birthPlace !== undefined) person.birthPlace = updates.birthPlace || undefined;
        if (updates.deathDate !== undefined) person.deathDate = updates.deathDate || undefined;
        if (updates.deathPlace !== undefined) person.deathPlace = updates.deathPlace || undefined;
        if (updates.notes !== undefined) person.notes = updates.notes || undefined;
        if (updates.refn !== undefined) {
            // The number's issuer (GEDCOM REFN > TYPE) describes the number it
            // came with; a number typed over it is no longer theirs.
            if ((updates.refn || undefined) !== person.refn) delete person.refnType;
            person.refn = updates.refn || undefined;
        }
        if (updates.question !== undefined) person.question = updates.question || undefined;
        // Empty list means none — do not keep an empty array around.
        if (updates.nameVariants !== undefined) {
            const kept = updates.nameVariants.map(v => v.trim()).filter(Boolean);
            person.nameVariants = kept.length > 0 ? kept : undefined;
        }
        // The narrative: an empty text means there is none.
        if ('story' in updates) {
            person.story = updates.story?.text.trim() ? updates.story : undefined;
        }
        // isDeceased is tri-state (true / false / undefined); apply verbatim when provided.
        if ('isDeceased' in updates) person.isDeceased = updates.isDeceased;
        if ('photo' in updates) person.photo = updates.photo || undefined;

        if (JSON.stringify(person) === personBefore) {
            this.pendingBefore = null;   // nothing changed — no undo step, no toast
            return person;
        }
        this.commitMutation(strings.undo.editPerson(auditPersonName(person)));
        // Audit log
        if (changedFields.length > 0) {
            AuditLogManager.log(this.currentTreeId, 'person.update', strings.auditLog.updatedPerson(auditPersonName(person), changedFields.join(', ')));
        }
        // Invalidate cross-tree cache when person is updated
        if (this.currentTreeId) {
            CrossTree.invalidateCacheForTree(this.currentTreeId);
        }
        return person;
    }

    // ==================== LIFE EVENTS ====================

    /**
     * Add a life event to a person. birth/death are represented by first-class
     * fields and are rejected here. Returns the created event, or null.
     */
    addLifeEvent(personId: PersonId, event: Omit<LifeEvent, 'id'>): LifeEvent | null {
        const person = this.data.persons[personId];
        if (!person) return null;
        if (this.isPersonLocked(personId)) return null;
        if (event.type === 'birth' || event.type === 'death') return null;
        if (event.type === 'custom' && !event.customLabel?.trim()) return null;

        this.beginMutation();
        const newEvent: LifeEvent = { ...event, id: generateLifeEventId() };
        if (!person.events) person.events = [];
        person.events.push(newEvent);
        this.commitMutation(strings.undo.addEvent(auditPersonName(person)));
        AuditLogManager.log(this.currentTreeId, 'event.add', strings.auditLog.addedEvent(auditPersonName(person)));
        return newEvent;
    }

    updateLifeEvent(personId: PersonId, eventId: string, updates: Partial<Omit<LifeEvent, 'id'>>): boolean {
        const person = this.data.persons[personId];
        if (!person?.events) return false;
        if (this.isPersonLocked(personId)) return false;
        const ev = person.events.find(e => e.id === eventId);
        if (!ev) return false;
        const nextType = updates.type ?? ev.type;
        if (nextType === 'birth' || nextType === 'death') return false;
        const nextLabel = updates.customLabel ?? ev.customLabel;
        if (nextType === 'custom' && !nextLabel?.trim()) return false;

        this.beginMutation();
        Object.assign(ev, updates);
        // An explicit undefined means "field emptied" — drop the key, or the
        // old value would survive the save (Object.assign never removes keys).
        dropUndefinedKeys(ev);
        // An empty participants array means "all participants removed" — drop the
        // property so exported JSON stays clean (Object.assign would keep []).
        if (Array.isArray(updates.participants) && updates.participants.length === 0) {
            delete ev.participants;
        }
        this.commitMutation(strings.undo.editEvent(auditPersonName(person)));
        AuditLogManager.log(this.currentTreeId, 'event.update', strings.auditLog.updatedEvent(auditPersonName(person)));
        return true;
    }

    removeLifeEvent(personId: PersonId, eventId: string): boolean {
        const person = this.data.persons[personId];
        if (!person?.events) return false;
        if (this.isPersonLocked(personId)) return false;
        if (!person.events.some(e => e.id === eventId)) return false;

        this.beginMutation();
        person.events = person.events.filter(e => e.id !== eventId);
        if (person.events.length === 0) delete person.events;
        this.commitMutation(strings.undo.removeEvent(auditPersonName(person)));
        AuditLogManager.log(this.currentTreeId, 'event.remove', strings.auditLog.removedEvent(auditPersonName(person)));
        return true;
    }

    // ==================== SOURCES / CITATIONS ====================

    /** Add a source to the per-tree catalog. Title is required. Returns it or null. */
    addSource(source: Omit<Source, 'id'>): Source | null {
        if (this.isTreeLocked()) return null;
        if (!source.title?.trim()) return null;

        this.beginMutation();
        const newSource: Source = { ...source, id: generateSourceId() };
        if (!this.data.sources) this.data.sources = {};
        this.data.sources[newSource.id] = newSource;
        this.commitMutation(strings.undo.addSource(newSource.title));
        AuditLogManager.log(this.currentTreeId, 'source.add', strings.auditLog.addedSource(newSource.title));
        return newSource;
    }

    updateSource(sourceId: string, updates: Partial<Omit<Source, 'id'>>): boolean {
        const src = this.data.sources?.[sourceId];
        if (!src) return false;
        if (this.isTreeLocked()) return false;
        if (updates.title !== undefined && !updates.title.trim()) return false;

        this.beginMutation();
        Object.assign(src, updates);
        // Explicit undefined = field emptied (see updateLifeEvent).
        dropUndefinedKeys(src);
        this.commitMutation(strings.undo.editSource(src.title));
        AuditLogManager.log(this.currentTreeId, 'source.update', strings.auditLog.updatedSource(src.title));
        return true;
    }

    /** Remove a source and cascade-delete every citation of it (persons + events). */
    removeSource(sourceId: string): boolean {
        const src = this.data.sources?.[sourceId];
        if (!src) return false;
        if (this.isTreeLocked()) return false;

        this.beginMutation();
        delete this.data.sources![sourceId];
        if (Object.keys(this.data.sources!).length === 0) delete this.data.sources;
        for (const person of Object.values(this.data.persons)) {
            if (person.sourceIds) {
                person.sourceIds = person.sourceIds.filter(id => id !== sourceId);
                if (person.sourceIds.length === 0) delete person.sourceIds;
            }
            for (const ev of person.events ?? []) {
                if (ev.sourceIds) {
                    ev.sourceIds = ev.sourceIds.filter(id => id !== sourceId);
                    if (ev.sourceIds.length === 0) delete ev.sourceIds;
                }
            }
            for (const att of person.attachments ?? []) {
                if (att.sourceId === sourceId) delete att.sourceId;
            }
        }
        for (const partnership of Object.values(this.data.partnerships)) {
            if (partnership.sourceIds) {
                partnership.sourceIds = partnership.sourceIds.filter(id => id !== sourceId);
                if (partnership.sourceIds.length === 0) delete partnership.sourceIds;
            }
        }
        this.commitMutation(strings.undo.removeSource(src.title));
        AuditLogManager.log(this.currentTreeId, 'source.remove', strings.auditLog.removedSource(src.title));
        return true;
    }

    /** How many persons + events currently cite a source. */
    /**
     * Every place citing `sourceId`, in tree order: person citations, then
     * their events, then partnerships. Feeds the source viewer's "Supports" list.
     */
    listSourceCitations(sourceId: string): SourceCitationRef[] {
        const out: SourceCitationRef[] = [];
        for (const person of Object.values(this.data.persons)) {
            if (person.sourceIds?.includes(sourceId)) out.push({ kind: 'person', personId: person.id });
            for (const ev of person.events ?? []) {
                if (ev.sourceIds?.includes(sourceId)) out.push({ kind: 'event', personId: person.id, eventId: ev.id });
            }
        }
        for (const partnership of Object.values(this.data.partnerships)) {
            if (partnership.sourceIds?.includes(sourceId)) {
                out.push({ kind: 'partnership', partnershipId: partnership.id });
            }
        }
        return out;
    }

    countSourceCitations(sourceId: string): number {
        let count = 0;
        for (const person of Object.values(this.data.persons)) {
            if (person.sourceIds?.includes(sourceId)) count++;
            for (const ev of person.events ?? []) {
                if (ev.sourceIds?.includes(sourceId)) count++;
            }
        }
        for (const partnership of Object.values(this.data.partnerships)) {
            if (partnership.sourceIds?.includes(sourceId)) count++;
        }
        return count;
    }

    /** Add a citation of `sourceId` on a person. */
    citePerson(personId: PersonId, sourceId: string): boolean {
        const person = this.data.persons[personId];
        if (!person || !this.data.sources?.[sourceId]) return false;
        if (this.isPersonLocked(personId)) return false;
        if (person.sourceIds?.includes(sourceId)) return false;

        this.beginMutation();
        if (!person.sourceIds) person.sourceIds = [];
        person.sourceIds.push(sourceId);
        this.commitMutation(strings.undo.cite(auditPersonName(person)));
        AuditLogManager.log(this.currentTreeId, 'source.cite', strings.auditLog.citedSource(auditPersonName(person)));
        return true;
    }

    /** Remove a citation of `sourceId` from a person. */
    uncitePerson(personId: PersonId, sourceId: string): boolean {
        const person = this.data.persons[personId];
        if (!person?.sourceIds?.includes(sourceId)) return false;
        if (this.isPersonLocked(personId)) return false;

        this.beginMutation();
        person.sourceIds = person.sourceIds.filter(id => id !== sourceId);
        if (person.sourceIds.length === 0) delete person.sourceIds;
        this.commitMutation(strings.undo.uncite(auditPersonName(person)));
        AuditLogManager.log(this.currentTreeId, 'source.uncite', strings.auditLog.uncitedSource(auditPersonName(person)));
        return true;
    }

    /** Add a citation of `sourceId` on a partnership (marriage record etc.). */
    citePartnership(partnershipId: PartnershipId, sourceId: string): boolean {
        const partnership = this.data.partnerships[partnershipId];
        if (!partnership || !this.data.sources?.[sourceId]) return false;
        if (this.isTreeLocked()) return false;
        if (partnership.sourceIds?.includes(sourceId)) return false;

        this.beginMutation();
        if (!partnership.sourceIds) partnership.sourceIds = [];
        partnership.sourceIds.push(sourceId);
        const names = this.partnershipNames(partnership);
        this.commitMutation(strings.undo.cite(names));
        AuditLogManager.log(this.currentTreeId, 'source.cite', strings.auditLog.citedSource(names));
        return true;
    }

    /** Remove a citation of `sourceId` from a partnership. */
    uncitePartnership(partnershipId: PartnershipId, sourceId: string): boolean {
        const partnership = this.data.partnerships[partnershipId];
        if (!partnership?.sourceIds?.includes(sourceId)) return false;
        if (this.isTreeLocked()) return false;

        this.beginMutation();
        partnership.sourceIds = partnership.sourceIds.filter(id => id !== sourceId);
        if (partnership.sourceIds.length === 0) delete partnership.sourceIds;
        const names = this.partnershipNames(partnership);
        this.commitMutation(strings.undo.uncite(names));
        AuditLogManager.log(this.currentTreeId, 'source.uncite', strings.auditLog.uncitedSource(names));
        return true;
    }

    /**
     * Add a witness to a wedding. Registers name two of them at every marriage
     * and they are the same kind of lead as a godparent — usually neighbours or
     * relatives who are not (yet) in the tree, hence the free-text name.
     */
    addPartnershipParticipant(partnershipId: PartnershipId, participant: {
        name?: string; personId?: PersonId; role?: ParticipantRole; note?: string;
    }): boolean {
        const partnership = this.data.partnerships[partnershipId];
        if (!partnership) return false;
        if (this.isTreeLocked()) return false;
        const name = participant.name?.trim();
        if (!name && !participant.personId) return false;

        this.beginMutation();
        (partnership.participants ??= []).push({
            id: generateParticipantId(),
            role: participant.role ?? 'witness',
            ...(participant.personId ? { personId: participant.personId } : {}),
            ...(name ? { name } : {}),
            ...(participant.note ? { note: participant.note } : {}),
        });
        const p1 = auditPersonName(this.data.persons[partnership.person1Id]);
        const p2 = auditPersonName(this.data.persons[partnership.person2Id]);
        this.commitMutation(strings.undo.editPartnership(p1, p2));
        AuditLogManager.log(this.currentTreeId, 'partnership.update',
            strings.auditLog.updatedPartnership(p1, p2));
        return true;
    }

    /** Remove a wedding witness. */
    removePartnershipParticipant(partnershipId: PartnershipId, participantId: string): boolean {
        const partnership = this.data.partnerships[partnershipId];
        if (!partnership?.participants?.some(p => p.id === participantId)) return false;
        if (this.isTreeLocked()) return false;

        this.beginMutation();
        partnership.participants = partnership.participants.filter(p => p.id !== participantId);
        if (partnership.participants.length === 0) delete partnership.participants;
        this.commitMutation(strings.undo.editPartnership(
            auditPersonName(this.data.persons[partnership.person1Id]),
            auditPersonName(this.data.persons[partnership.person2Id])));
        return true;
    }

    /** "Jan Novák & Marie Nováková" — for undo/audit labels. */
    private partnershipNames(partnership: Partnership): string {
        return [partnership.person1Id, partnership.person2Id]
            .map(id => this.data.persons[id])
            .filter((p): p is Person => !!p)
            .map(p => auditPersonName(p))
            .join(' & ');
    }

    /** Add a citation of `sourceId` on a person's life event. */
    citeEvent(personId: PersonId, eventId: string, sourceId: string): boolean {
        const person = this.data.persons[personId];
        const ev = person?.events?.find(e => e.id === eventId);
        if (!person || !ev || !this.data.sources?.[sourceId]) return false;
        if (this.isPersonLocked(personId)) return false;
        if (ev.sourceIds?.includes(sourceId)) return false;

        this.beginMutation();
        if (!ev.sourceIds) ev.sourceIds = [];
        ev.sourceIds.push(sourceId);
        this.commitMutation(strings.undo.cite(auditPersonName(person)));
        AuditLogManager.log(this.currentTreeId, 'source.cite', strings.auditLog.citedSource(auditPersonName(person)));
        return true;
    }

    /** Remove a citation of `sourceId` from a person's life event. */
    unciteEvent(personId: PersonId, eventId: string, sourceId: string): boolean {
        const person = this.data.persons[personId];
        const ev = person?.events?.find(e => e.id === eventId);
        if (!person || !ev?.sourceIds?.includes(sourceId)) return false;
        if (this.isPersonLocked(personId)) return false;

        this.beginMutation();
        ev.sourceIds = ev.sourceIds.filter(id => id !== sourceId);
        if (ev.sourceIds.length === 0) delete ev.sourceIds;
        this.commitMutation(strings.undo.uncite(auditPersonName(person)));
        AuditLogManager.log(this.currentTreeId, 'source.uncite', strings.auditLog.uncitedSource(auditPersonName(person)));
        return true;
    }

    // ==================== ATTACHMENTS ====================

    /** Attach a document to a person. Returns the created attachment, or null. */
    addAttachment(personId: PersonId, attachment: Omit<Attachment, 'id'>): Attachment | null {
        const person = this.data.persons[personId];
        if (!person) return null;
        if (this.isPersonLocked(personId)) return null;

        this.beginMutation();
        const newAttachment: Attachment = { ...attachment, id: generateAttachmentId() };
        if (!person.attachments) person.attachments = [];
        person.attachments.push(newAttachment);
        this.commitMutation(strings.undo.addAttachment(auditPersonName(person)));
        AuditLogManager.log(this.currentTreeId, 'attachment.add', strings.auditLog.addedAttachment(auditPersonName(person)));
        return newAttachment;
    }

    removeAttachment(personId: PersonId, attachmentId: string): boolean {
        const person = this.data.persons[personId];
        if (!person?.attachments?.some(a => a.id === attachmentId)) return false;
        if (this.isPersonLocked(personId)) return false;

        this.beginMutation();
        person.attachments = person.attachments.filter(a => a.id !== attachmentId);
        if (person.attachments.length === 0) delete person.attachments;
        // Excerpts cut from this page keep their image; they just can no
        // longer be re-cropped.
        unlinkExcerptsFromAttachment(this.data, attachmentId);
        this.commitMutation(strings.undo.removeAttachment(auditPersonName(person)));
        AuditLogManager.log(this.currentTreeId, 'attachment.remove', strings.auditLog.removedAttachment(auditPersonName(person)));
        return true;
    }

    updateAttachmentNote(personId: PersonId, attachmentId: string, note: string): boolean {
        const person = this.data.persons[personId];
        const att = person?.attachments?.find(a => a.id === attachmentId);
        if (!person || !att) return false;
        if (this.isPersonLocked(personId)) return false;

        this.beginMutation();
        if (note.trim()) att.note = note.trim();
        else delete att.note;
        this.commitMutation(strings.undo.editAttachment(auditPersonName(person)));
        AuditLogManager.log(this.currentTreeId, 'attachment.update', strings.auditLog.updatedAttachment(auditPersonName(person)));
        return true;
    }

    // ==================== PARENT-CHILD RELATIONSHIP TYPE ====================

    /**
     * Set the relationship type of a parent→child edge. 'biological' clears the
     * record (it is the default). The parent must already be a parent of child.
     */
    setParentRelType(childId: PersonId, parentId: PersonId, type: ParentChildRelType): boolean {
        const child = this.data.persons[childId];
        if (!child || !child.parentIds.includes(parentId)) return false;
        if (this.isPersonLocked(childId) || this.isPersonLocked(parentId)) return false;

        this.beginMutation();
        if (type === 'biological') {
            if (child.parentRelTypes) {
                delete child.parentRelTypes[parentId];
                if (Object.keys(child.parentRelTypes).length === 0) delete child.parentRelTypes;
            }
        } else {
            if (!child.parentRelTypes) child.parentRelTypes = {};
            child.parentRelTypes[parentId] = type;
        }
        const parent = this.data.persons[parentId];
        this.commitMutation(strings.undo.setParentRelType(auditPersonName(child)));
        AuditLogManager.log(this.currentTreeId, 'parentRel.update',
            strings.auditLog.setParentRelType(parent ? auditPersonName(parent) : '?', auditPersonName(child)));
        return true;
    }

    deletePerson(id: PersonId): boolean {
        const person = this.data.persons[id];
        if (!person) return false;

        // Block deletion of locked persons
        if (this.isPersonLocked(id)) return false;

        this.beginMutation();

        // Capture name before deletion for audit log
        const deletedName = auditPersonName(person);

        // Remove from all partnerships
        for (const partnershipId of [...person.partnerships]) {
            this.removeFromPartnership(id, partnershipId);
        }

        // Remove from parents' childIds
        for (const parentId of person.parentIds) {
            const parent = this.data.persons[parentId];
            if (parent) {
                parent.childIds = parent.childIds.filter(cid => cid !== id);
            }
        }

        // Remove from children's parentIds (and the per-parent relationship
        // type keyed by the deleted id — it would dangle forever otherwise)
        for (const childId of person.childIds) {
            const child = this.data.persons[childId];
            if (child) {
                child.parentIds = child.parentIds.filter(pid => pid !== id);
                if (child.parentRelTypes && id in child.parentRelTypes) {
                    delete child.parentRelTypes[id];
                    if (Object.keys(child.parentRelTypes).length === 0) delete child.parentRelTypes;
                }
            }
        }

        // A linked godparent/witness in anyone's event keeps their written name
        // instead of a dangling id — the record loses the link, not the fact.
        // (Same contract as merge and split.)
        const writtenName = `${person.firstName ?? ''} ${person.lastName ?? ''}`.trim();
        const unlinkParticipant = (part: { personId?: PersonId; name?: string }) => {
            if (part.personId !== id) return;
            if (!part.name && writtenName && writtenName !== '?' && !person.isPlaceholder) {
                part.name = writtenName;
            }
            delete part.personId;
        };
        for (const other of Object.values(this.data.persons)) {
            for (const event of other.events ?? []) {
                for (const part of event.participants ?? []) unlinkParticipant(part);
            }
        }
        // Wedding witnesses of other couples, likewise (review S6).
        for (const union of Object.values(this.data.partnerships)) {
            for (const part of union.participants ?? []) unlinkParticipant(part);
        }

        delete this.data.persons[id];
        this.commitMutation(strings.undo.deletePerson(deletedName));
        // Audit log
        AuditLogManager.log(this.currentTreeId, 'person.delete', strings.auditLog.deletedPerson(deletedName));
        // Invalidate cross-tree cache when person is deleted
        if (this.currentTreeId) {
            CrossTree.invalidateCacheForTree(this.currentTreeId);
        }
        return true;
    }

    // ==================== PARTNERSHIP OPERATIONS ====================

    createPartnership(person1Id: PersonId, person2Id: PersonId, status: PartnershipStatus = 'married'): Partnership | null {
        const p1 = this.data.persons[person1Id];
        const p2 = this.data.persons[person2Id];
        if (!p1 || !p2) return null;

        // Block if either person is locked
        if (this.isPersonLocked(person1Id) || this.isPersonLocked(person2Id)) return null;

        // Check if partnership already exists
        const existing = this.findPartnership(person1Id, person2Id);
        if (existing) return existing;

        this.beginMutation();

        const partnership: Partnership = {
            id: generatePartnershipId(),
            person1Id,
            person2Id,
            childIds: [],
            status
        };

        this.data.partnerships[partnership.id] = partnership;
        p1.partnerships.push(partnership.id);
        p2.partnerships.push(partnership.id);

        this.commitMutation(strings.undo.addPartnership(auditPersonName(p1), auditPersonName(p2)));
        // Audit log
        AuditLogManager.log(
            this.currentTreeId, 'partnership.create',
            strings.auditLog.createdPartnership(auditPersonName(p1), auditPersonName(p2), strings.partnershipStatus[status])
        );
        return partnership;
    }

    updatePartnershipStatus(partnershipId: PartnershipId, status: PartnershipStatus): boolean {
        const partnership = this.data.partnerships[partnershipId];
        if (!partnership) return false;

        if (partnership.status === status) return true;
        this.beginMutation();
        partnership.status = status;
        const sp1 = this.data.persons[partnership.person1Id];
        const sp2 = this.data.persons[partnership.person2Id];
        this.commitMutation(strings.undo.editPartnership(auditPersonName(sp1), auditPersonName(sp2)));
        return true;
    }

    updatePartnership(partnershipId: PartnershipId, updates: PartnershipUpdates): Partnership | null {
        const partnership = this.data.partnerships[partnershipId];
        if (!partnership) return null;

        this.beginMutation();

        // Track actual changes
        let changed = false;
        if (updates.status !== undefined && updates.status !== partnership.status) { partnership.status = updates.status; changed = true; }
        if (updates.startDate !== undefined && (updates.startDate || undefined) !== partnership.startDate) { partnership.startDate = updates.startDate || undefined; changed = true; }
        if (updates.startPlace !== undefined && (updates.startPlace || undefined) !== partnership.startPlace) { partnership.startPlace = updates.startPlace || undefined; changed = true; }
        if (updates.endDate !== undefined && (updates.endDate || undefined) !== partnership.endDate) { partnership.endDate = updates.endDate || undefined; changed = true; }
        if (updates.note !== undefined && (updates.note || undefined) !== partnership.note) { partnership.note = updates.note || undefined; changed = true; }
        if (updates.isPrimary !== undefined && (updates.isPrimary || undefined) !== partnership.isPrimary) { partnership.isPrimary = updates.isPrimary || undefined; changed = true; }

        if (!changed) {
            this.pendingBefore = null;   // nothing changed — no undo step
            return partnership;
        }

        // Audit log
        const up1 = this.data.persons[partnership.person1Id];
        const up2 = this.data.persons[partnership.person2Id];
        this.commitMutation(strings.undo.editPartnership(auditPersonName(up1), auditPersonName(up2)));
        AuditLogManager.log(
            this.currentTreeId, 'partnership.update',
            strings.auditLog.updatedPartnership(auditPersonName(up1), auditPersonName(up2))
        );
        return partnership;
    }

    getPartnershipBetween(person1Id: PersonId, person2Id: PersonId): Partnership | null {
        return this.findPartnership(person1Id, person2Id);
    }

    private findPartnership(person1Id: PersonId, person2Id: PersonId): Partnership | null {
        return Object.values(this.data.partnerships).find(p =>
            (p.person1Id === person1Id && p.person2Id === person2Id) ||
            (p.person1Id === person2Id && p.person2Id === person1Id)
        ) ?? null;
    }

    private removeFromPartnership(personId: PersonId, partnershipId: PartnershipId): void {
        const partnership = this.data.partnerships[partnershipId];
        if (!partnership) return;

        const partnerId = partnership.person1Id === personId
            ? partnership.person2Id
            : partnership.person1Id;

        const partner = this.data.persons[partnerId];
        if (partner) {
            partner.partnerships = partner.partnerships.filter(pid => pid !== partnershipId);
        }

        delete this.data.partnerships[partnershipId];
    }

    getPartnerships(personId: PersonId): Partnership[] {
        const person = this.data.persons[personId];
        if (!person) return [];

        return person.partnerships
            .map(pid => this.data.partnerships[pid])
            .filter((p): p is Partnership => p !== undefined);
    }

    getPartners(personId: PersonId): Person[] {
        const partnerships = this.getPartnerships(personId);
        return partnerships
            .map(p => {
                const partnerId = p.person1Id === personId ? p.person2Id : p.person1Id;
                return this.data.persons[partnerId];
            })
            .filter((p): p is Person => p !== undefined);
    }

    getCurrentPartner(personId: PersonId): Person | null {
        const partners = this.getPartners(personId);
        return partners.length > 0 ? partners[partners.length - 1] : null;
    }

    getAllPartners(personId: PersonId): Person[] {
        return this.getPartners(personId);
    }

    // ==================== PARENT-CHILD OPERATIONS ====================

    addParentChild(parentId: PersonId, childId: PersonId, partnershipId?: PartnershipId): boolean {
        const parent = this.data.persons[parentId];
        const child = this.data.persons[childId];
        if (!parent || !child) return false;

        // Block if either person is locked
        if (this.isPersonLocked(parentId) || this.isPersonLocked(childId)) return false;
        // No third parent, no cycle — refused without touching anything.
        if (!this.canAddParentChild(parentId, childId)) return false;

        this.beginMutation();

        // Add to parent's childIds if not already there
        if (!parent.childIds.includes(childId)) {
            parent.childIds.push(childId);
        }

        // Add to child's parentIds if not already there (max 2 parents,
        // guaranteed by canAddParentChild above)
        if (!child.parentIds.includes(parentId)) {
            child.parentIds.push(parentId);
        }

        // If partnership specified, add child to partnership
        if (partnershipId) {
            const partnership = this.data.partnerships[partnershipId];
            if (partnership && !partnership.childIds.includes(childId)) {
                partnership.childIds.push(childId);
            }
        }

        this.commitMutation(strings.undo.addRelation(auditPersonName(parent), auditPersonName(child)));
        // Audit log
        AuditLogManager.log(
            this.currentTreeId, 'parentChild.add',
            strings.auditLog.addedParentChild(auditPersonName(parent), auditPersonName(child))
        );
        return true;
    }

    /**
     * Whether `parentId` may become a parent of `childId`: an existing link is
     * fine (idempotent); otherwise the child must have a free parent slot (at
     * most two parents) and the parent must be neither the child itself nor
     * one of its descendants (that would be a cycle in the ancestry). Pickers
     * use it to offer only people the link would accept.
     */
    canAddParentChild(parentId: PersonId, childId: PersonId): boolean {
        const parent = this.data.persons[parentId];
        const child = this.data.persons[childId];
        if (!parent || !child) return false;
        if (child.parentIds.includes(parentId)) return true;
        if (child.parentIds.length >= 2) return false;
        return !this.isSelfOrDescendantOf(parentId, childId);
    }

    /** True when `candidateId` is `rootId` itself or one of its descendants. */
    private isSelfOrDescendantOf(candidateId: PersonId, rootId: PersonId): boolean {
        const seen = new Set<PersonId>([rootId]);
        const stack: PersonId[] = [rootId];
        while (stack.length > 0) {
            const id = stack.pop()!;
            if (id === candidateId) return true;
            for (const ch of this.data.persons[id]?.childIds ?? []) {
                if (!seen.has(ch)) { seen.add(ch); stack.push(ch); }
            }
        }
        return false;
    }

    /**
     * Move a parent→child link to a different parent in one step ("I linked
     * the person to the wrong one"). Keeps the relationship type (step,
     * adoptive…), hangs the child under the new parent's partnership with the
     * child's remaining parent when there is one, refuses cycles, and rolls
     * back to the original state when the new link cannot be made.
     */
    reassignParentChild(childId: PersonId, oldParentId: PersonId, newParentId: PersonId): boolean {
        const child = this.data.persons[childId];
        if (!child || !this.data.persons[oldParentId] || !this.data.persons[newParentId]) return false;
        if (oldParentId === newParentId || child.parentIds.includes(newParentId)) return false;
        if (!child.parentIds.includes(oldParentId)) return false;
        // A parent from the child's own descendants would be a cycle.
        if (this.isSelfOrDescendantOf(newParentId, childId)) return false;
        // Locked people cannot be relinked — refuse before touching anything.
        if (this.isPersonLocked(childId) || this.isPersonLocked(oldParentId) || this.isPersonLocked(newParentId)) return false;

        // One user action = one undo step: a single Ctrl+Z must not leave the
        // child with the old link removed and the new one still present.
        return this.runBatch(
            strings.undo.addRelation(auditPersonName(this.data.persons[newParentId]), auditPersonName(child)),
            () => this.reassignParentChildInner(child, childId, oldParentId, newParentId));
    }

    private reassignParentChildInner(child: Person, childId: PersonId, oldParentId: PersonId, newParentId: PersonId): boolean {
        const keptType = child.parentRelTypes?.[oldParentId];
        const oldUnion = Object.values(this.data.partnerships).find(u =>
            (u.person1Id === oldParentId || u.person2Id === oldParentId) && u.childIds.includes(childId));

        if (!this.removeParentChild(oldParentId, childId)) return false;

        // The child follows the new parent into their union with the child's
        // remaining parent — otherwise it would hang beside the couple, not
        // under it.
        const otherParentId = child.parentIds[0];
        const newUnion = otherParentId ? Object.values(this.data.partnerships).find(u =>
            (u.person1Id === newParentId && u.person2Id === otherParentId) ||
            (u.person2Id === newParentId && u.person1Id === otherParentId)) : undefined;

        if (!this.addParentChild(newParentId, childId, newUnion?.id)) {
            // Restore what removeParentChild took apart, union attachment included.
            this.addParentChild(oldParentId, childId, oldUnion?.id);
            if (keptType && keptType !== 'biological') this.setParentRelType(childId, oldParentId, keptType);
            return false;
        }
        if (keptType && keptType !== 'biological') this.setParentRelType(childId, newParentId, keptType);
        return true;
    }

    removeParentChild(parentId: PersonId, childId: PersonId): boolean {
        const parent = this.data.persons[parentId];
        const child = this.data.persons[childId];
        if (!parent || !child) return false;

        // Block if either person is locked
        if (this.isPersonLocked(parentId) || this.isPersonLocked(childId)) return false;

        this.beginMutation();

        // Capture names before modification for audit log
        const parentName = auditPersonName(parent);
        const childName = auditPersonName(child);

        // Remove from parent's childIds
        parent.childIds = parent.childIds.filter(id => id !== childId);

        // Remove from child's parentIds
        child.parentIds = child.parentIds.filter(id => id !== parentId);

        // Clean up any parent-relationship-type record for this pair.
        if (child.parentRelTypes && child.parentRelTypes[parentId]) {
            delete child.parentRelTypes[parentId];
            if (Object.keys(child.parentRelTypes).length === 0) delete child.parentRelTypes;
        }

        // Also remove from any partnership's childIds
        for (const partnership of Object.values(this.data.partnerships)) {
            if ((partnership.person1Id === parentId || partnership.person2Id === parentId) &&
                partnership.childIds.includes(childId)) {
                partnership.childIds = partnership.childIds.filter(id => id !== childId);
            }
        }

        this.commitMutation(strings.undo.removeRelation(parentName, childName));
        // Audit log
        AuditLogManager.log(
            this.currentTreeId, 'parentChild.remove',
            strings.auditLog.removedParentChild(parentName, childName)
        );
        return true;
    }

    removePartnership(person1Id: PersonId, person2Id: PersonId): boolean {
        const partnership = this.findPartnership(person1Id, person2Id);
        if (!partnership) return false;

        // Block if either person is locked
        if (this.isPersonLocked(person1Id) || this.isPersonLocked(person2Id)) return false;

        this.beginMutation();

        const p1 = this.data.persons[person1Id];
        const p2 = this.data.persons[person2Id];

        // Capture names before modification for audit log
        const p1Name = auditPersonName(p1);
        const p2Name = auditPersonName(p2);

        if (p1) {
            p1.partnerships = p1.partnerships.filter(pid => pid !== partnership.id);
        }
        if (p2) {
            p2.partnerships = p2.partnerships.filter(pid => pid !== partnership.id);
        }

        delete this.data.partnerships[partnership.id];
        this.commitMutation(strings.undo.removePartnership(p1Name, p2Name));
        // Audit log
        AuditLogManager.log(
            this.currentTreeId, 'partnership.delete',
            strings.auditLog.removedPartnership(p1Name, p2Name)
        );
        return true;
    }

    getSiblings(personId: PersonId): Person[] {
        const person = this.data.persons[personId];
        if (!person) return [];

        const siblingIds = new Set<PersonId>();

        // Get siblings through parents
        for (const parentId of person.parentIds) {
            const parent = this.data.persons[parentId];
            if (parent) {
                for (const childId of parent.childIds) {
                    if (childId !== personId) {
                        siblingIds.add(childId);
                    }
                }
            }
        }

        return Array.from(siblingIds)
            .map(id => this.data.persons[id])
            .filter((p): p is Person => p !== undefined);
    }

    /**
     * Check if a person has "dual context" - meaning they have both:
     * 1. Birth family (parents) - they are someone's child
     * 2. Own family (children or partner) - they are a parent or have a partner
     *
     * Persons with dual context can navigate "up" to their parents' view
     * or "down" to their own family view (via branch tabs).
     */
    hasDualContext(personId: PersonId): boolean {
        const person = this.data.persons[personId];
        if (!person) return false;

        // Must have parents (birth family)
        const hasBirthFamily = person.parentIds.length > 0;

        // Must have children OR partners (own family)
        const hasOwnFamily = person.childIds.length > 0 || person.partnerships.length > 0;

        // Show branch tabs for anyone with both birth family and own family
        // Even without siblings, user may want to navigate to parents' view
        return hasBirthFamily && hasOwnFamily;
    }

    // ==================== GENERATION CALCULATION ====================

    /**
     * Calculate generation for a person.
     * Partners are always in the same generation.
     * Generation = max(parent generations) + 1, aligned with partner's generation.
     */
    getGeneration(personId: PersonId, cache: Map<PersonId, number> = new Map(), visited: Set<PersonId> = new Set()): number {
        // Prevent infinite loops
        if (visited.has(personId)) {
            return cache.get(personId) ?? 0;
        }
        visited.add(personId);

        // Return cached value
        if (cache.has(personId)) {
            return cache.get(personId)!;
        }

        const person = this.data.persons[personId];
        if (!person) {
            cache.set(personId, 0);
            return 0;
        }

        // If no parents, check partners for their generation
        if (person.parentIds.length === 0) {
            const partners = this.getPartners(personId);
            for (const partner of partners) {
                if (partner.parentIds.length > 0) {
                    const partnerGen = this.getGeneration(partner.id, cache, visited);
                    cache.set(personId, partnerGen);
                    return partnerGen;
                }
            }
            cache.set(personId, 0);
            return 0;
        }

        // Calculate from parents
        let maxParentGen = -1;
        for (const parentId of person.parentIds) {
            const parentGen = this.getGeneration(parentId, cache, visited);
            maxParentGen = Math.max(maxParentGen, parentGen);
        }

        const gen = maxParentGen + 1;
        cache.set(personId, gen);

        // NOTE: Partner alignment was removed from here!
        // It caused a bug where a partner's generation would be set BEFORE
        // the partner calculated their own generation from their parents.
        // Partner alignment now happens ONLY in calculateAllGenerations() post-processing.

        return gen;
    }

    /**
     * Calculate generations for all persons, ensuring partners are aligned.
     */
    calculateAllGenerations(): Map<PersonId, number> {
        const cache = new Map<PersonId, number>();
        const persons = this.getAllPersons();

        // First pass: calculate all generations
        for (const person of persons) {
            this.getGeneration(person.id, cache);
        }

        // Multiple passes to align partners
        let changed = true;
        let iterations = 0;
        const maxIterations = 10;

        while (changed && iterations < maxIterations) {
            changed = false;
            iterations++;

            for (const partnership of Object.values(this.data.partnerships)) {
                const gen1 = cache.get(partnership.person1Id) ?? 0;
                const gen2 = cache.get(partnership.person2Id) ?? 0;

                if (gen1 !== gen2) {
                    const maxGen = Math.max(gen1, gen2);
                    cache.set(partnership.person1Id, maxGen);
                    cache.set(partnership.person2Id, maxGen);
                    changed = true;
                }
            }
        }

        return cache;
    }

    /**
     * Calculate max generations up (ancestors) and down (descendants) from a person.
     * Returns { up: number, down: number } where each is at least 1.
     */
    getMaxGenerations(personId: PersonId): { up: number; down: number } {
        const person = this.data.persons[personId];
        if (!person) return { up: 1, down: 1 };

        // Calculate max depth up (ancestors)
        const maxUp = this.getMaxAncestorDepth(personId, new Set());

        // Calculate max depth down (descendants)
        const maxDown = this.getMaxDescendantDepth(personId, new Set());

        return {
            up: Math.max(1, maxUp),
            down: Math.max(1, maxDown)
        };
    }

    /**
     * Calculate max generations including siblings' descendants.
     * Siblings are at the same generation level, so their descendants
     * count toward the "down" depth (nieces, nephews, and their children).
     */
    getMaxGenerationsWithSiblings(personId: PersonId): { up: number; down: number } {
        const person = this.data.persons[personId];
        if (!person) return { up: 1, down: 1 };

        // Calculate max depth up (ancestors) - unchanged
        const maxUp = this.getMaxAncestorDepth(personId, new Set());

        // Calculate max depth down INCLUDING siblings' descendants
        let maxDown = this.getMaxDescendantDepth(personId, new Set());

        // Also check siblings' descendants
        const siblings = this.getSiblings(personId);
        for (const sibling of siblings) {
            const siblingDown = this.getMaxDescendantDepth(sibling.id, new Set());
            maxDown = Math.max(maxDown, siblingDown);
        }

        return {
            up: Math.max(1, maxUp),
            down: Math.max(1, maxDown)
        };
    }

    /**
     * Recursively find the maximum ancestor depth from a person.
     */
    private getMaxAncestorDepth(personId: PersonId, visited: Set<PersonId>): number {
        if (visited.has(personId)) return 0;
        visited.add(personId);

        const person = this.data.persons[personId];
        if (!person) return 0;

        let maxDepth = 0;

        // Check direct parents
        for (const parentId of person.parentIds) {
            const parentDepth = 1 + this.getMaxAncestorDepth(parentId, visited);
            maxDepth = Math.max(maxDepth, parentDepth);
        }

        return maxDepth;
    }

    /**
     * Recursively find the maximum descendant depth from a person.
     */
    private getMaxDescendantDepth(personId: PersonId, visited: Set<PersonId>): number {
        if (visited.has(personId)) return 0;
        visited.add(personId);

        const person = this.data.persons[personId];
        if (!person) return 0;

        let maxDepth = 0;

        // Check children from all partnerships
        for (const partnershipId of person.partnerships) {
            const partnership = this.data.partnerships[partnershipId];
            if (!partnership) continue;

            for (const childId of partnership.childIds) {
                const childDepth = 1 + this.getMaxDescendantDepth(childId, visited);
                maxDepth = Math.max(maxDepth, childDepth);
            }
        }

        // Also check direct childIds (for older data format)
        for (const childId of person.childIds) {
            if (!visited.has(childId)) {
                const childDepth = 1 + this.getMaxDescendantDepth(childId, visited);
                maxDepth = Math.max(maxDepth, childDepth);
            }
        }

        return maxDepth;
    }

    // ==================== DATA MANAGEMENT ====================

    /**
     * Check if there is any data in the tree
     */
    hasData(): boolean {
        return Object.keys(this.data.persons).length > 0;
    }

    /**
     * Clear all data and start fresh (in current tree)
     */
    clearData(): void {
        this.rollbackEditSession();   // whole-data replacement ends a staged dialog
        // Capture counts before clearing for audit log
        const personCount = Object.keys(this.data.persons).length;
        const partnershipCount = Object.keys(this.data.partnerships).length;
        // Through the undo choke point: bypassing it used to leave a STALE
        // undo stack (Ctrl+Z after "clear all" resurrected an old snapshot).
        // As a bonus, clearing is now itself undoable.
        this.beginMutation();
        this.data = this.createEmptyData();
        this.commitMutation(strings.undo.clearedData);
        // Audit log
        AuditLogManager.log(
            this.currentTreeId, 'data.clear',
            strings.auditLog.clearedData(personCount, partnershipCount)
        );
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('strom:data-changed'));
    }

    /**
     * Set the default focus person for the current tree (exports with tree)
     * @param value undefined = first person, LAST_FOCUSED = where user left off, PersonId = specific
     */
    setDefaultPerson(value: PersonId | LastFocusedMarker | undefined): void {
        if (!this.currentTreeId || this.isLocked()) return;

        if (value === undefined) {
            delete this.data.defaultPersonId;
        } else {
            this.data.defaultPersonId = value;
        }

        this.save();
    }

    /**
     * Get the default focus person setting for the current tree
     */
    getDefaultPerson(): PersonId | LastFocusedMarker | undefined {
        return this.data.defaultPersonId;
    }

    /**
     * Save the current focus state if the setting is LAST_FOCUSED
     */
    saveLastFocus(personId: PersonId, depthUp: number, depthDown: number): void {
        if (!this.currentTreeId) return;

        // Only save if the setting is LAST_FOCUSED
        if (this.data.defaultPersonId === LAST_FOCUSED) {
            this.data.lastFocusPersonId = personId;
            this.data.lastFocusDepthUp = depthUp;
            this.data.lastFocusDepthDown = depthDown;
            this.save();
        }
    }

    /**
     * Get the startup focus state for the current tree
     * Returns { personId, depthUp, depthDown } or null for "use first person with default depths"
     */
    getStartupFocus(): { personId: PersonId; depthUp?: number; depthDown?: number } | null {
        const setting = this.data.defaultPersonId;

        if (setting === undefined) {
            // First person
            return null;
        }

        if (setting === LAST_FOCUSED) {
            // Last focused, with depths
            if (this.data.lastFocusPersonId && this.data.persons[this.data.lastFocusPersonId]) {
                return {
                    personId: this.data.lastFocusPersonId,
                    depthUp: this.data.lastFocusDepthUp,
                    depthDown: this.data.lastFocusDepthDown
                };
            }
            // Fallback to first person
            return null;
        }

        // Specific person ID - check if valid
        if (this.data.persons[setting]) {
            return { personId: setting };
        }

        // Fallback to first person
        return null;
    }

    /**
     * Load new data, replacing existing data in current tree
     */
    loadStromData(newData: StromData): void {
        this.rollbackEditSession();   // whole-data replacement ends a staged dialog
        // Undo choke point (see clearData) — an accidental import-over is
        // now one Ctrl+Z away instead of silently corrupting the stack.
        this.beginMutation();
        this.data = migrateData(newData);
        this.commitMutation(strings.undo.loadedData, true);
        // Audit log
        const personCount = Object.keys(this.data.persons).length;
        const partnershipCount = Object.keys(this.data.partnerships).length;
        AuditLogManager.log(
            this.currentTreeId, 'data.load',
            strings.auditLog.loadedData(personCount, partnershipCount)
        );
        // Invalidate cross-tree cache when data is loaded
        CrossTree.invalidateCache();
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('strom:data-changed'));
    }

    /**
     * Replace the open tree with a newer state from its source (the live
     * research bridge). Not an edit of the user's: no undo step — the history
     * before it described a state that no longer exists, so it is dropped.
     */
    replaceWithSourceData(newData: StromData): void {
        this.rollbackEditSession();   // whole-data replacement ends a staged dialog
        if (this.viewMode || this.isLocked() || !this.currentTreeId) return;
        this.data = migrateData(newData);
        this.save();
        UndoManager.setActiveTree(this.currentTreeId);
        UndoManager.clear();
        this.onUndoRedoChanged?.();
        CrossTree.invalidateCacheForTree(this.currentTreeId);
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('strom:data-changed'));
    }

    /**
     * Apply a collaboration change packet straight onto the current tree as a
     * single undoable step (the "Accept" path). Goes through the same
     * begin/commitMutation choke point as every other edit, so one Ctrl+Z
     * reverts the whole acceptance. The caller surfaces its own result toast.
     */
    applyChangePacketDirect(packet: ChangePacket): void {
        this.rollbackEditSession();   // whole-data replacement ends a staged dialog
        const sender = packet.senderName || strings.share.unknownSender;
        this.beginMutation();
        this.data = applyPacketOntoData(this.data, packet);
        this.commitMutation(strings.undo.applyChanges(sender), true);
        AuditLogManager.log(this.currentTreeId, 'data.import', strings.auditLog.appliedChanges(sender));
        if (this.currentTreeId) CrossTree.invalidateCacheForTree(this.currentTreeId);
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('strom:data-changed'));
    }

    /**
     * Import data as a new tree
     * @param data The data to import
     * @param treeName Name for the new tree
     * @returns The new tree's ID
     */
    async importAsNewTree(data: StromData, treeName: string): Promise<TreeId> {
        this.rollbackEditSession();   // whole-data replacement ends a staged dialog
        const migratedData = migrateData(data);
        const treeId = TreeManager.createTreeFromImport(migratedData, treeName);
        this.currentTreeId = treeId;
        this.data = migratedData;
        // Remove empty default tree(s) after import
        await this.removeEmptyDefaultTree();
        // Invalidate cross-tree cache when new tree is imported
        CrossTree.invalidateCache();
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('strom:data-changed'));
        window.dispatchEvent(new CustomEvent('strom:tree-switched'));
        return treeId;
    }

    /**
     * Create a new empty tree
     * @param name Tree name
     * @returns The new tree's ID
     */
    createNewTree(name: string): TreeId {
        this.rollbackEditSession();   // whole-data replacement ends a staged dialog
        const treeId = TreeManager.createTree(name);
        this.currentTreeId = treeId;
        TreeManager.setActiveTree(treeId);
        this.data = this.createEmptyData();
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('strom:data-changed'));
        window.dispatchEvent(new CustomEvent('strom:tree-switched'));
        return treeId;
    }

    /**
     * Remove the auto-created default tree if it's still empty and untouched.
     * Only deletes the first tree if it has 0 persons and still has the default name.
     */
    private async removeEmptyDefaultTree(): Promise<void> {
        const trees = TreeManager.getTrees();
        if (trees.length < 2) return; // Need at least the default + imported tree

        const first = trees[0];
        if (first.personCount !== 0) return;

        // Only remove if it still has the default name (not renamed by user)
        // — in ANY UI language (the tree may predate a language switch).
        const defaultNames = SUPPORTED_LANGUAGES.map(l => getStringsForLang(l.code).treeManager.defaultTreeName);
        if (!defaultNames.includes(first.name)) return;

        await TreeManager.deleteTree(first.id);
    }

    // ==================== EXPORT/IMPORT ====================

    exportJSON(privacyMode: PrivacyMode = 'full', content: boolean | ContentOptions = false): void {
        let out = applyLivingPrivacy(this.data, privacyMode);
        out = applyContentOptions(out, content);
        const dataStr = JSON.stringify(out, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'family-tree.json';
        a.click();
        URL.revokeObjectURL(a.href);
    }

    /**
     * Export a specific tree's data as JSON file
     * @param treeId The tree to export
     * @param password Optional password for encryption
     */
    /**
     * Build the JSON text for a tree's ATTACHED working file (File System
     * Access). This is the full tree (no privacy stripping — it is your own
     * working copy), encrypted with the current session when encryption is on
     * (mirrors saveTreeData / snapshots). Throws 'locked' when encryption is
     * enabled but the session is locked. The unencrypted content is byte-for-byte
     * the same as a full JSON download.
     */
    async buildAttachedFileJson(treeId: TreeId): Promise<string> {
        const data = await TreeManager.getTreeData(treeId);
        if (!data) throw new Error('no tree data');
        data.version = STROM_DATA_VERSION;
        const json = JSON.stringify(data, null, 2);

        const { SettingsManager } = await import('./settings.js');
        if (SettingsManager.isEncryptionEnabled()) {
            const { CryptoSession } = await import('./crypto.js');
            if (!CryptoSession.isUnlocked()) throw new Error('locked');
            const encrypted = await CryptoSession.encrypt(json);
            return JSON.stringify(encrypted, null, 2);
        }
        return json;
    }

    async exportTreeJSON(treeId: TreeId, password?: string | null, privacyMode: PrivacyMode = 'full', content: boolean | ContentOptions = false): Promise<void> {
        const rawTreeData = await TreeManager.getTreeData(treeId);
        if (!rawTreeData) return;

        const treeData = applyContentOptions(applyLivingPrivacy(rawTreeData, privacyMode), content);
        // Ensure version is set
        treeData.version = STROM_DATA_VERSION;

        const treeMeta = TreeManager.getTreeMetadata(treeId);
        const treeName = treeMeta?.name || 'family-tree';
        const safeName = safeFileName(treeName, 'family-tree');

        let dataStr: string;
        if (password) {
            const { encrypt } = await import('./crypto.js');
            const encrypted = await encrypt(JSON.stringify(treeData), password);
            dataStr = JSON.stringify(encrypted, null, 2);
        } else {
            dataStr = JSON.stringify(treeData, null, 2);
        }

        const blob = new Blob([dataStr], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${safeName || 'family-tree'}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    async exportFocusedJSON(visiblePersonIds: Set<PersonId>, password?: string | null, privacyMode: PrivacyMode = 'full', content: boolean | ContentOptions = false): Promise<void> {
        // Self-consistent slice (glue + cleaned relations + pruned sources),
        // shared with "make a tree from this view".
        const sliced = extractSubtree(this.data, visiblePersonIds);
        let focusedData: StromData = applyLivingPrivacy({
            version: STROM_DATA_VERSION,
            ...sliced,
        }, privacyMode);
        focusedData = applyContentOptions(focusedData, content);

        let dataStr: string;
        if (password) {
            const { encrypt } = await import('./crypto.js');
            const encrypted = await encrypt(JSON.stringify(focusedData), password);
            dataStr = JSON.stringify(encrypted, null, 2);
        } else {
            dataStr = JSON.stringify(focusedData, null, 2);
        }

        const blob = new Blob([dataStr], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'family-tree-focus.json';
        a.click();
        URL.revokeObjectURL(a.href);
    }

    /**
     * Merge two persons into one, keeping the first person
     * @param keepId The person to keep
     * @param removeId The person to merge into keepId (will be deleted)
     * @param resolvedFields Field values to apply (already resolved conflicts)
     * @param partnershipResolutions How to handle conflicting partnerships
     * @returns true if successful
     */
    mergePersons(
        keepId: PersonId,
        removeId: PersonId,
        resolvedFields: { [key: string]: string | undefined },
        partnershipResolutions: Map<PartnershipId, 'merge' | 'keep_both'>
    ): boolean {
        const keepPerson = this.data.persons[keepId];
        const removePerson = this.data.persons[removeId];

        if (!keepPerson || !removePerson || keepId === removeId) {
            return false;
        }

        this.beginMutation();

        // Capture names and changes before merge for audit log
        const removedName = auditPersonName(removePerson);
        const keptName = auditPersonName(keepPerson);
        const mergeDetails: string[] = [];
        if (resolvedFields.firstName !== undefined && resolvedFields.firstName !== keepPerson.firstName) mergeDetails.push(`${strings.labels.firstName}: ${resolvedFields.firstName}`);
        if (resolvedFields.lastName !== undefined && resolvedFields.lastName !== keepPerson.lastName) mergeDetails.push(`${strings.labels.lastName}: ${resolvedFields.lastName}`);
        if (resolvedFields.birthDate !== undefined && resolvedFields.birthDate !== (keepPerson.birthDate || '')) mergeDetails.push(`${strings.labels.birthDate}: ${resolvedFields.birthDate || '–'}`);
        if (resolvedFields.birthPlace !== undefined && resolvedFields.birthPlace !== (keepPerson.birthPlace || '')) mergeDetails.push(`${strings.labels.birthPlace}: ${resolvedFields.birthPlace || '–'}`);
        if (resolvedFields.deathDate !== undefined && resolvedFields.deathDate !== (keepPerson.deathDate || '')) mergeDetails.push(`${strings.labels.deathDate}: ${resolvedFields.deathDate || '–'}`);
        if (resolvedFields.deathPlace !== undefined && resolvedFields.deathPlace !== (keepPerson.deathPlace || '')) mergeDetails.push(`${strings.labels.deathPlace}: ${resolvedFields.deathPlace || '–'}`);

        // 1. Apply resolved field values
        if (resolvedFields.firstName !== undefined) keepPerson.firstName = resolvedFields.firstName;
        if (resolvedFields.lastName !== undefined) keepPerson.lastName = resolvedFields.lastName;
        if (resolvedFields.birthDate !== undefined) keepPerson.birthDate = resolvedFields.birthDate || undefined;
        if (resolvedFields.birthPlace !== undefined) keepPerson.birthPlace = resolvedFields.birthPlace || undefined;
        if (resolvedFields.deathDate !== undefined) keepPerson.deathDate = resolvedFields.deathDate || undefined;
        if (resolvedFields.deathPlace !== undefined) keepPerson.deathPlace = resolvedFields.deathPlace || undefined;

        // Clear placeholder status if we have a real name now
        if (keepPerson.firstName && keepPerson.firstName !== '?') {
            keepPerson.isPlaceholder = false;
        }

        // 2. Transfer parentIds (max 2 parents)
        for (const parentId of removePerson.parentIds) {
            if (!keepPerson.parentIds.includes(parentId) && keepPerson.parentIds.length < 2) {
                keepPerson.parentIds.push(parentId);
                // Update parent's childIds
                const parent = this.data.persons[parentId];
                if (parent && !parent.childIds.includes(keepId)) {
                    parent.childIds.push(keepId);
                }
            }
        }

        // 3. Transfer childIds and update children's parentIds
        for (const childId of removePerson.childIds) {
            if (!keepPerson.childIds.includes(childId)) {
                keepPerson.childIds.push(childId);
            }
            // Update child's parentIds to point to keepPerson
            const child = this.data.persons[childId];
            if (child) {
                const removeIdx = child.parentIds.indexOf(removeId);
                if (removeIdx >= 0) {
                    if (!child.parentIds.includes(keepId)) {
                        child.parentIds[removeIdx] = keepId;
                    } else {
                        // keepId already in parentIds, just remove removeId
                        child.parentIds.splice(removeIdx, 1);
                    }
                }
                // parentRelTypes is keyed by parent id — re-key removeId → keepId
                // (an existing keepId entry wins)
                const relType = child.parentRelTypes?.[removeId];
                if (relType !== undefined) {
                    delete child.parentRelTypes![removeId];
                    if (!(keepId in child.parentRelTypes!)) {
                        child.parentRelTypes![keepId] = relType;
                    }
                    if (Object.keys(child.parentRelTypes!).length === 0) {
                        delete child.parentRelTypes;
                    }
                }
            }
        }

        // 4. Handle partnerships - find conflicts first
        const keepPartnerIds = new Map<PersonId, PartnershipId>();
        for (const pid of keepPerson.partnerships) {
            const p = this.data.partnerships[pid];
            if (p) {
                const partnerId = p.person1Id === keepId ? p.person2Id : p.person1Id;
                keepPartnerIds.set(partnerId, pid);
            }
        }

        for (const removePartnershipId of [...removePerson.partnerships]) {
            const removePartnership = this.data.partnerships[removePartnershipId];
            if (!removePartnership) continue;

            const partnerId = removePartnership.person1Id === removeId
                ? removePartnership.person2Id
                : removePartnership.person1Id;

            // Check if keepPerson already has a partnership with this partner
            const existingPartnershipId = keepPartnerIds.get(partnerId);

            if (existingPartnershipId) {
                // Conflict - partnership with same partner exists
                const resolution = partnershipResolutions.get(removePartnershipId);

                if (resolution === 'merge') {
                    // Merge partnerships - transfer children and data
                    const existingPartnership = this.data.partnerships[existingPartnershipId];
                    if (existingPartnership) {
                        // Transfer children from remove partnership
                        for (const childId of removePartnership.childIds) {
                            if (!existingPartnership.childIds.includes(childId)) {
                                existingPartnership.childIds.push(childId);
                            }
                        }
                        // Optionally merge partnership info if existing doesn't have it
                        if (!existingPartnership.startDate && removePartnership.startDate) {
                            existingPartnership.startDate = removePartnership.startDate;
                        }
                        if (!existingPartnership.startPlace && removePartnership.startPlace) {
                            existingPartnership.startPlace = removePartnership.startPlace;
                        }
                        if (!existingPartnership.endDate && removePartnership.endDate) {
                            existingPartnership.endDate = removePartnership.endDate;
                        }
                        if (!existingPartnership.note && removePartnership.note) {
                            existingPartnership.note = removePartnership.note;
                        }
                    }
                    // Delete the duplicate partnership
                    const partner = this.data.persons[partnerId];
                    if (partner) {
                        partner.partnerships = partner.partnerships.filter(pid => pid !== removePartnershipId);
                    }
                    delete this.data.partnerships[removePartnershipId];
                } else {
                    // keep_both - transfer the partnership to keepPerson (rare case)
                    if (removePartnership.person1Id === removeId) {
                        removePartnership.person1Id = keepId;
                    } else {
                        removePartnership.person2Id = keepId;
                    }
                    if (!keepPerson.partnerships.includes(removePartnershipId)) {
                        keepPerson.partnerships.push(removePartnershipId);
                    }
                }
            } else {
                // No conflict - just transfer the partnership
                if (removePartnership.person1Id === removeId) {
                    removePartnership.person1Id = keepId;
                } else {
                    removePartnership.person2Id = keepId;
                }
                if (!keepPerson.partnerships.includes(removePartnershipId)) {
                    keepPerson.partnerships.push(removePartnershipId);
                }
            }
        }

        // 5. Update all partnership childIds that reference removeId
        for (const partnership of Object.values(this.data.partnerships)) {
            const idx = partnership.childIds.indexOf(removeId);
            if (idx >= 0) {
                if (!partnership.childIds.includes(keepId)) {
                    partnership.childIds[idx] = keepId;
                } else {
                    partnership.childIds.splice(idx, 1);
                }
            }
        }

        // 6. Remove removeId from all parents' childIds
        for (const parentId of removePerson.parentIds) {
            const parent = this.data.persons[parentId];
            if (parent) {
                parent.childIds = parent.childIds.filter(cid => cid !== removeId);
            }
        }

        // 6b. Carry over the removed person's life events and source citations
        // (union) so neither is lost in the merge.
        if (removePerson.events && removePerson.events.length > 0) {
            if (!keepPerson.events) keepPerson.events = [];
            const seen = new Set(keepPerson.events.map(e => e.id));
            for (const ev of removePerson.events) {
                if (!seen.has(ev.id)) keepPerson.events.push(ev);
            }
        }
        if (removePerson.sourceIds && removePerson.sourceIds.length > 0) {
            keepPerson.sourceIds = [...new Set([...(keepPerson.sourceIds ?? []), ...removePerson.sourceIds])];
        }
        if (removePerson.attachments && removePerson.attachments.length > 0) {
            if (!keepPerson.attachments) keepPerson.attachments = [];
            const seenAtt = new Set(keepPerson.attachments.map(a => a.id));
            for (const att of removePerson.attachments) {
                if (!seenAtt.has(att.id)) keepPerson.attachments.push(att);
            }
        }
        // Carry the removed person's own parent relationship types for parents
        // the kept person actually ended up with (keep's own entry wins).
        if (removePerson.parentRelTypes) {
            for (const [pid, type] of Object.entries(removePerson.parentRelTypes)) {
                if (!keepPerson.parentIds.includes(pid as PersonId)) continue;
                if (keepPerson.parentRelTypes?.[pid as PersonId] !== undefined) continue;
                if (!keepPerson.parentRelTypes) keepPerson.parentRelTypes = {};
                keepPerson.parentRelTypes[pid as PersonId] = type;
            }
        }

        // 6c. Remap event participants (godparents / witnesses) that pointed at
        // the removed person to the kept one. If the kept person already stands
        // in the same event with the same role, drop the now-duplicate row
        // instead of listing them twice.
        for (const p of Object.values(this.data.persons)) {
            for (const event of p.events ?? []) {
                const parts = event.participants;
                if (!parts) continue;
                for (let i = parts.length - 1; i >= 0; i--) {
                    if (parts[i].personId !== removeId) continue;
                    const dupe = parts.some((q, j) =>
                        j !== i && q.personId === keepId && q.role === parts[i].role);
                    if (dupe) parts.splice(i, 1);
                    else parts[i].personId = keepId;
                }
            }
        }

        // 7. Delete the removed person
        delete this.data.persons[removeId];

        // Person merge has its own completion toast — no Undo toast.
        this.commitMutation(strings.undo.mergePersons(keptName), true);
        // Audit log
        AuditLogManager.log(
            this.currentTreeId, 'persons.merge',
            strings.auditLog.mergedPersons(removedName, keptName, mergeDetails.join(', '))
        );
        return true;
    }

    importJSON(event: Event): void {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const imported = JSON.parse(e.target?.result as string);

                // Check if data is encrypted
                const { isEncrypted, decrypt } = await import('./crypto.js');
                if (isEncrypted(imported)) {
                    // Close any open dialogs first
                    window.Strom?.UI?.closeImportDialog();
                    window.Strom?.UI?.closeTreeManagerDialog();

                    // Show password prompt for decryption
                    window.Strom?.UI?.showPasswordPrompt(async (password: string) => {
                        try {
                            const decrypted = await decrypt(imported, password);
                            const data = JSON.parse(decrypted) as StromData;

                            // Check version compatibility
                            if (!window.Strom?.UI?.checkJsonVersionBeforeImport(data)) {
                                return;
                            }

                            this.beginMutation();
                            this.data = migrateData(data);
                            this.commitMutation(strings.undo.loadedData, true);
                            if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('strom:data-changed'));
                        } catch {
                            window.Strom?.UI?.showAlert(strings.encryption.wrongPassword, 'error');
                        }
                    });
                    return;
                }

                // Check version compatibility before import
                if (!window.Strom?.UI?.checkJsonVersionBeforeImport(imported as StromData)) {
                    return;
                }

                this.beginMutation();
                this.data = migrateData(imported);
                this.commitMutation(strings.undo.loadedData, true);
                // Dispatch event for UI to re-render
                if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('strom:data-changed'));
            } catch (error) {
                // Use window.Strom.UI to avoid circular dependency
                window.Strom?.UI?.showAlert(strings.errors.invalidJson, 'error');
            }
        };
        reader.readAsText(file);

        // Reset input so same file can be re-imported
        input.value = '';
    }

    // ==================== VALIDATION REPAIR ====================

    /** Set of issue types that can be auto-fixed */
    private static readonly FIXABLE_TYPES = new Set([
        'orphanedParentRef',
        'orphanedChildRef',
        'orphanedPartnershipRef',
        'orphanedPartnerRef',
        'orphanedPartnershipChildRef',
        'orphanedParticipantRef',
        'missingChildRef',
        'missingParentRef',
        'missingPartnershipRef',
        'selfPartnership',
        'duplicatePartnership',
        'placeSpelling',
    ]);

    /**
     * Check if a validation issue type is auto-fixable
     */
    isFixableIssue(issue: ValidationIssue): boolean {
        return DataManagerClass.FIXABLE_TYPES.has(issue.type);
    }

    /**
     * Repair a single validation issue
     * @returns true if the issue was successfully repaired
     */
    repairValidationIssue(issue: ValidationIssue): boolean {
        let repaired = false;
        // Undo choke point: repairs are real data mutations.
        this.beginMutation();

        switch (issue.type) {
            case 'orphanedParentRef': {
                // Remove non-existent parent ID from person.parentIds
                const personId = issue.personIds?.[0];
                if (!personId) break;
                const person = this.data.persons[personId];
                if (!person) break;
                const before = person.parentIds.length;
                person.parentIds = person.parentIds.filter(id => this.data.persons[id] !== undefined);
                repaired = person.parentIds.length < before;
                break;
            }

            case 'orphanedChildRef': {
                // Remove non-existent child ID from person.childIds
                const personId = issue.personIds?.[0];
                if (!personId) break;
                const person = this.data.persons[personId];
                if (!person) break;
                const before = person.childIds.length;
                person.childIds = person.childIds.filter(id => this.data.persons[id] !== undefined);
                repaired = person.childIds.length < before;
                break;
            }

            case 'orphanedPartnershipRef': {
                // Remove non-existent partnership ID from person.partnerships
                const personId = issue.personIds?.[0];
                if (!personId) break;
                const person = this.data.persons[personId];
                if (!person) break;
                const before = person.partnerships.length;
                person.partnerships = person.partnerships.filter(id => this.data.partnerships[id] !== undefined);
                repaired = person.partnerships.length < before;
                break;
            }

            case 'orphanedPartnerRef': {
                // Delete partnership with non-existent partner
                const partnershipId = issue.partnershipIds?.[0];
                if (!partnershipId) break;
                const partnership = this.data.partnerships[partnershipId];
                if (!partnership) break;
                // Remove partnership ref from existing partners
                const p1 = this.data.persons[partnership.person1Id];
                const p2 = this.data.persons[partnership.person2Id];
                if (p1) p1.partnerships = p1.partnerships.filter(id => id !== partnershipId);
                if (p2) p2.partnerships = p2.partnerships.filter(id => id !== partnershipId);
                delete this.data.partnerships[partnershipId];
                repaired = true;
                break;
            }

            case 'orphanedPartnershipChildRef': {
                // Remove non-existent child ID from partnership.childIds
                const partnershipId = issue.partnershipIds?.[0];
                if (!partnershipId) break;
                const partnership = this.data.partnerships[partnershipId];
                if (!partnership) break;
                const before = partnership.childIds.length;
                partnership.childIds = partnership.childIds.filter(id => this.data.persons[id] !== undefined);
                repaired = partnership.childIds.length < before;
                break;
            }

            case 'orphanedParticipantRef': {
                // Drop the dangling personId from event participants of this
                // person; keep whatever written name the row still carries.
                // (The linked person is already gone, so its name cannot be
                // recovered here — the snapshot has to happen at delete time.)
                // A wedding witness (the issue names the partnership instead).
                const unionId = issue.partnershipIds?.[0];
                if (unionId) {
                    for (const part of this.data.partnerships[unionId]?.participants ?? []) {
                        if (part.personId && !this.data.persons[part.personId]) {
                            delete part.personId;
                            repaired = true;
                        }
                    }
                    break;
                }
                const personId = issue.personIds?.[0];
                if (!personId) break;
                const person = this.data.persons[personId];
                if (!person?.events) break;
                for (const event of person.events) {
                    for (const part of event.participants ?? []) {
                        if (part.personId && !this.data.persons[part.personId]) {
                            delete part.personId;
                            repaired = true;
                        }
                    }
                }
                break;
            }

            case 'missingChildRef': {
                // Parent is missing child in childIds - add it
                // personIds: [childId, parentId]
                const childId = issue.personIds?.[0];
                const parentId = issue.personIds?.[1];
                if (!childId || !parentId) break;
                const parent = this.data.persons[parentId];
                if (!parent) break;
                if (!parent.childIds.includes(childId)) {
                    parent.childIds.push(childId);
                    repaired = true;
                }
                break;
            }

            case 'missingParentRef': {
                // Child is missing parent in parentIds - add it
                // personIds: [parentId, childId]
                const parentId = issue.personIds?.[0];
                const childId = issue.personIds?.[1];
                if (!parentId || !childId) break;
                const child = this.data.persons[childId];
                if (!child) break;
                if (!child.parentIds.includes(parentId) && child.parentIds.length < 2) {
                    child.parentIds.push(parentId);
                    repaired = true;
                }
                break;
            }

            case 'missingPartnershipRef': {
                // Person is missing partnership ref - add it
                // personIds: [personId], partnershipIds: [partnershipId]
                const personId = issue.personIds?.[0];
                const partnershipId = issue.partnershipIds?.[0];
                if (!personId || !partnershipId) break;
                const person = this.data.persons[personId];
                if (!person) break;
                if (!person.partnerships.includes(partnershipId)) {
                    person.partnerships.push(partnershipId);
                    repaired = true;
                }
                break;
            }

            case 'placeSpelling': {
                // detail lists the spellings ("Děčín (2×)  ·  decin (1×)"); every
                // variant shares one key, so the first one gives it. Unify to
                // the most-used spelling (see src/places.ts).
                const firstSpelling = issue.detail?.split('  ·  ')[0]?.replace(/\s*\(\d+×\)$/, '');
                const key = firstSpelling ? placeKey(firstSpelling) : '';
                if (!key) break;
                const place = collectPlaces(this.data).get(key);
                if (!place) break;
                const { data: fixed, changed } = renamePlace(this.data, key, place.display);
                if (changed > 0) {
                    this.data = fixed;
                    repaired = true;
                }
                break;
            }

            case 'selfPartnership': {
                // Delete partnership where person1Id === person2Id
                const partnershipId = issue.partnershipIds?.[0];
                if (!partnershipId) break;
                const partnership = this.data.partnerships[partnershipId];
                if (!partnership) break;
                const person = this.data.persons[partnership.person1Id];
                if (person) {
                    person.partnerships = person.partnerships.filter(id => id !== partnershipId);
                }
                delete this.data.partnerships[partnershipId];
                repaired = true;
                break;
            }

            case 'duplicatePartnership': {
                // Delete duplicate partnership (keep first, remove second)
                // partnershipIds: [keptId, duplicateId]
                const keptId = issue.partnershipIds?.[0];
                const duplicateId = issue.partnershipIds?.[1];
                if (!keptId || !duplicateId) break;
                const duplicate = this.data.partnerships[duplicateId];
                const kept = this.data.partnerships[keptId];
                if (!duplicate || !kept) break;
                // Move children from duplicate to kept
                for (const childId of duplicate.childIds) {
                    if (!kept.childIds.includes(childId)) {
                        kept.childIds.push(childId);
                    }
                }
                // Remove duplicate ref from partners
                const dp1 = this.data.persons[duplicate.person1Id];
                const dp2 = this.data.persons[duplicate.person2Id];
                if (dp1) dp1.partnerships = dp1.partnerships.filter(id => id !== duplicateId);
                if (dp2) dp2.partnerships = dp2.partnerships.filter(id => id !== duplicateId);
                delete this.data.partnerships[duplicateId];
                repaired = true;
                break;
            }
        }

        if (repaired) {
            this.commitMutation(strings.undo.repairedIssue);
            // Log the localized issue type (issue.message is English-only
            // diagnostic text) plus the people it concerned.
            const who = (issue.personIds ?? [])
                .map(id => this.data.persons[id])
                .filter(Boolean)
                .map(p => auditPersonName(p));
            const desc = translateValidationType(issue.type) + (who.length ? ` (${who.join(', ')})` : '');
            AuditLogManager.log(
                this.currentTreeId, 'data.repair',
                strings.auditLog.repairedIssue(desc)
            );
        } else {
            this.pendingBefore = null;   // nothing changed — drop the snapshot
        }

        return repaired;
    }

    /**
     * Repair all fixable validation issues in batch
     * @returns number of issues repaired
     */
    repairAllFixableIssues(issues: ValidationIssue[]): number {
        const fixable = issues.filter(i => this.isFixableIssue(i));
        let count = 0;
        for (const issue of fixable) {
            if (this.repairValidationIssue(issue)) {
                count++;
            }
        }
        return count;
    }
}

// Export singleton instance
export const DataManager = new DataManagerClass();
