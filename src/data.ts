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
    generatePartnershipId,
    LAST_FOCUSED,
    LastFocusedMarker,
    STROM_DATA_VERSION,
    EmbeddedDataEnvelope,
    isEmbeddedEnvelope
} from './types.js';
import { strings } from './strings.js';
import { TreeManager } from './tree-manager.js';
import { isEncrypted, EncryptedData } from './crypto.js';
import * as CrossTree from './cross-tree.js';
import { AuditLogManager } from './audit-log.js';
import { ValidationIssue } from './validation.js';

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

class DataManagerClass {
    private data: StromData = {
        persons: {} as Record<PersonId, Person>,
        partnerships: {} as Record<PartnershipId, Partnership>
    };

    private currentTreeId: TreeId | null = null;

    // Pending encrypted embedded data (requires password to unlock)
    private pendingEncryptedEmbedded: EncryptedData | null = null;

    // View mode state
    private viewMode = false;
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
    init(): void {
        // Initialize TreeManager first
        TreeManager.init();

        // Check for embedded data (from exported HTML)
        const embedded = (window as Window & { STROM_EMBEDDED_DATA?: EmbeddedDataEnvelope }).STROM_EMBEDDED_DATA;
        const allTrees = (window as Window & { STROM_ALL_TREES?: Record<string, { name: string; data: StromData; isHidden?: boolean }> }).STROM_ALL_TREES;

        if (embedded) {
            // Validate envelope format
            if (!isEmbeddedEnvelope(embedded)) {
                console.error('Invalid embedded data format - missing envelope');
                this.loadStartupTree();
                return;
            }

            this.embeddedEnvelope = embedded;

            // Store all trees if present (from "Export All" functionality)
            if (allTrees && typeof allTrees === 'object' && !isEncrypted(allTrees)) {
                this.embeddedAllTrees = allTrees;
                // Set active tree to first one (or the one matching envelope)
                const treeIds = Object.keys(allTrees);
                this.activeEmbeddedTreeId = treeIds.length > 0 ? treeIds[0] : null;
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
        this.loadStartupTree();
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
            this.data = this.migrateData(data);
            // Set current tree to null in view mode (not editing any localStorage tree)
            this.currentTreeId = null;
        } else {
            // New export - enter view mode
            this.viewMode = true;
            this.data = this.migrateData(data);
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
     * Load decrypted embedded data after password verification
     * @param decryptedData The decrypted StromData
     */
    loadDecryptedEmbeddedData(decryptedData: StromData): void {
        // Clear pending encrypted data
        this.pendingEncryptedEmbedded = null;

        // Handle embedded data with view mode logic
        this.handleEmbeddedData(decryptedData);

        // Notify UI of data change
        window.dispatchEvent(new CustomEvent('strom:data-changed'));
    }

    // ==================== VIEW MODE ====================

    /**
     * Check if currently in view mode (read-only)
     */
    isViewMode(): boolean {
        return this.viewMode;
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
        if (!this.viewMode || !this.embeddedAllTrees) return false;

        const tree = this.embeddedAllTrees[treeId];
        if (!tree) return false;

        this.activeEmbeddedTreeId = treeId;
        this.data = this.migrateData(tree.data);

        window.dispatchEvent(new CustomEvent('strom:data-changed'));
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

        // Add date/time suffix
        const now = new Date();
        const dateStr = now.toLocaleDateString('cs-CZ');
        const timeStr = now.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
        const suffix = `import ze dne ${dateStr} ${timeStr}`;
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
    importAllEmbeddedTrees(): { imported: number; skipped: number } {
        if (!this.viewMode) return { imported: 0, skipped: 0 };

        let imported = 0;
        const skipped = 0;
        const existingNames = new Set(TreeManager.getTrees().map(t => t.name.toLowerCase()));

        // If we have all trees (from "Export All")
        if (this.embeddedAllTrees) {
            for (const [, tree] of Object.entries(this.embeddedAllTrees)) {
                const name = this.getUniqueTreeName(tree.name, existingNames);
                const newTreeId = TreeManager.createTreeFromImport(this.migrateData(tree.data), name);
                // Apply isHidden flag if it was set in the export
                if (tree.isHidden) {
                    TreeManager.setTreeVisibility(newTreeId, true);
                }
                existingNames.add(name.toLowerCase());
                imported++;
            }
        } else if (this.embeddedEnvelope) {
            // Single tree
            const name = this.getUniqueTreeName(this.embeddedEnvelope.treeName, existingNames);
            TreeManager.createTreeFromImport(this.data, name);
            imported = 1;
        }

        // Exit view mode
        this.viewMode = false;
        this.embeddedEnvelope = null;
        this.embeddedAllTrees = null;
        this.activeEmbeddedTreeId = null;

        // Switch to last imported tree
        const trees = TreeManager.getTrees();
        if (trees.length > 0) {
            const lastTree = trees[trees.length - 1];
            this.switchTree(lastTree.id);
        }

        window.dispatchEvent(new CustomEvent('strom:data-changed'));
        window.dispatchEvent(new CustomEvent('strom:tree-switched'));
        window.dispatchEvent(new CustomEvent('strom:view-mode-exit'));

        return { imported, skipped };
    }

    /**
     * Import from view mode with specified action
     * @param action 'new' = create new tree, 'update' = update existing, 'copy' = create copy
     */
    importFromViewMode(action: ViewModeImportAction): void {
        if (!this.embeddedEnvelope || !this.viewMode) return;

        const data = this.data;
        const existingTree = TreeManager.findTreeByExportId(this.embeddedEnvelope.exportId);

        switch (action) {
            case 'new': {
                // Create new tree linked to this export
                const treeId = TreeManager.createTreeFromImport(data, this.embeddedEnvelope.treeName);
                TreeManager.setSourceExportId(treeId, this.embeddedEnvelope.exportId);
                this.currentTreeId = treeId;
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
                break;
            }
        }

        // Import audit log if present
        if (this.embeddedEnvelope.auditLog && this.currentTreeId) {
            AuditLogManager.importForTree(this.currentTreeId, this.embeddedEnvelope.auditLog);
        }

        // Exit view mode
        this.viewMode = false;
        this.embeddedEnvelope = null;

        // Notify UI
        window.dispatchEvent(new CustomEvent('strom:data-changed'));
        window.dispatchEvent(new CustomEvent('strom:tree-switched'));
        window.dispatchEvent(new CustomEvent('strom:view-mode-exit'));
    }

    /**
     * Switch to stored version of the tree (exit view mode, load from localStorage)
     */
    switchToStoredVersion(): void {
        if (!this.embeddedEnvelope) return;

        const existingTree = TreeManager.findTreeByExportId(this.embeddedEnvelope.exportId);
        if (existingTree) {
            // Exit view mode and switch to stored tree
            this.viewMode = false;
            this.embeddedEnvelope = null;
            this.switchTree(existingTree.id);
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
        this.data = this.migrateData(this.pendingNewerVersionData);
        this.currentTreeId = null;

        // Clear pending state
        this.pendingNewerVersionData = null;
        this.pendingNewerVersionInfo = null;
        this.newerVersionSource = null;

        window.dispatchEvent(new CustomEvent('strom:data-changed'));
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
    checkStorageVersion(): { compatible: boolean; dataVersion?: number; currentVersion: number } {
        const activeTreeId = TreeManager.getActiveTreeId();
        if (!activeTreeId) return { compatible: true, currentVersion: STROM_DATA_VERSION };

        const data = TreeManager.getTreeData(activeTreeId);
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
    private loadStartupTree(): void {
        // Get the tree that should be loaded at startup
        const startupTreeId = TreeManager.getStartupTreeId();

        if (startupTreeId) {
            // Set as active tree
            TreeManager.setActiveTree(startupTreeId);
            this.currentTreeId = startupTreeId;

            const treeData = TreeManager.getTreeData(startupTreeId);
            if (treeData) {
                this.data = this.migrateData(treeData);
                return;
            }
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
    switchTree(treeId: TreeId): boolean {
        if (!TreeManager.setActiveTree(treeId)) {
            return false;
        }

        this.currentTreeId = treeId;
        const treeData = TreeManager.getTreeData(treeId);
        if (treeData) {
            this.data = this.migrateData(treeData);
        } else {
            // Data might be encrypted - try async load if session is unlocked
            this.data = this.createEmptyData();
        }

        // Save last tree if setting is LAST_FOCUSED
        TreeManager.saveLastTree(treeId);

        window.dispatchEvent(new CustomEvent('strom:data-changed'));
        return true;
    }

    /**
     * Switch to a different tree (async version for encrypted data)
     * @param treeId The tree to switch to
     * @returns true if successful
     */
    async switchTreeAsync(treeId: TreeId): Promise<boolean> {
        if (!TreeManager.setActiveTree(treeId)) {
            return false;
        }

        this.currentTreeId = treeId;
        const treeData = await TreeManager.getTreeDataAsync(treeId);
        if (treeData) {
            this.data = this.migrateData(treeData);
        } else {
            this.data = this.createEmptyData();
        }

        // Save last tree if setting is LAST_FOCUSED
        TreeManager.saveLastTree(treeId);

        window.dispatchEvent(new CustomEvent('strom:data-changed'));
        return true;
    }

    /**
     * Reload current tree data (async, for encrypted data)
     * Used after unlocking crypto session to load decrypted data
     */
    async reloadCurrentTree(): Promise<void> {
        if (!this.currentTreeId) return;

        const treeData = await TreeManager.getTreeDataAsync(this.currentTreeId);
        if (treeData) {
            this.data = this.migrateData(treeData);
        } else {
            this.data = this.createEmptyData();
        }

        window.dispatchEvent(new CustomEvent('strom:data-changed'));
    }

    /**
     * Get current tree ID
     */
    getCurrentTreeId(): TreeId | null {
        return this.currentTreeId;
    }

    private migrateData(data: unknown): StromData {
        // Type guard and migration for older data formats
        if (!data || typeof data !== 'object') {
            return this.createEmptyData();
        }

        const d = data as Record<string, unknown>;
        const partnerships = (d.partnerships || {}) as Record<PartnershipId, Partnership>;

        // Migrate partnerships without status field
        for (const partnership of Object.values(partnerships)) {
            if (!partnership.status) {
                partnership.status = 'married';
            }
        }

        const result: StromData = {
            persons: (d.persons || {}) as Record<PersonId, Person>,
            partnerships
        };

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

    private createEmptyData(): StromData {
        return {
            persons: {} as Record<PersonId, Person>,
            partnerships: {} as Record<PartnershipId, Partnership>
        };
    }

    private save(): void {
        // Never save in view mode (read-only)
        if (this.viewMode) return;

        if (this.currentTreeId) {
            TreeManager.saveTreeData(this.currentTreeId, this.data);
        }
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
                person.birthDate?.split('-')[0] || '',  // birth year
                person.deathDate?.split('-')[0] || ''   // death year
            ].join(' '));

            // All query parts must match somewhere in searchText
            return queryParts.every(part => searchText.includes(part));
        });
    }

    // ==================== PERSON CRUD ====================

    createPerson(personData: NewPersonData, isPlaceholder = false): Person {
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
        this.save();
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

    updatePerson(id: PersonId, updates: Partial<Person>): Person | null {
        const person = this.data.persons[id];
        if (!person) return null;

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

        if (updates.firstName !== undefined) {
            person.firstName = updates.firstName;
            // If firstName is set and was placeholder, remove placeholder status
            if (person.isPlaceholder && updates.firstName && updates.firstName !== '?') {
                person.isPlaceholder = false;
            }
        }
        if (updates.lastName !== undefined) person.lastName = updates.lastName;
        if (updates.gender !== undefined) person.gender = updates.gender;

        // Extended info
        if (updates.birthDate !== undefined) person.birthDate = updates.birthDate || undefined;
        if (updates.birthPlace !== undefined) person.birthPlace = updates.birthPlace || undefined;
        if (updates.deathDate !== undefined) person.deathDate = updates.deathDate || undefined;
        if (updates.deathPlace !== undefined) person.deathPlace = updates.deathPlace || undefined;

        this.save();
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

    deletePerson(id: PersonId): boolean {
        const person = this.data.persons[id];
        if (!person) return false;

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

        // Remove from children's parentIds
        for (const childId of person.childIds) {
            const child = this.data.persons[childId];
            if (child) {
                child.parentIds = child.parentIds.filter(pid => pid !== id);
            }
        }

        delete this.data.persons[id];
        this.save();
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

        // Check if partnership already exists
        const existing = this.findPartnership(person1Id, person2Id);
        if (existing) return existing;

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

        this.save();
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

        partnership.status = status;
        this.save();
        return true;
    }

    updatePartnership(partnershipId: PartnershipId, updates: PartnershipUpdates): Partnership | null {
        const partnership = this.data.partnerships[partnershipId];
        if (!partnership) return null;

        // Track actual changes
        let changed = false;
        if (updates.status !== undefined && updates.status !== partnership.status) { partnership.status = updates.status; changed = true; }
        if (updates.startDate !== undefined && (updates.startDate || undefined) !== partnership.startDate) { partnership.startDate = updates.startDate || undefined; changed = true; }
        if (updates.startPlace !== undefined && (updates.startPlace || undefined) !== partnership.startPlace) { partnership.startPlace = updates.startPlace || undefined; changed = true; }
        if (updates.endDate !== undefined && (updates.endDate || undefined) !== partnership.endDate) { partnership.endDate = updates.endDate || undefined; changed = true; }
        if (updates.note !== undefined && (updates.note || undefined) !== partnership.note) { partnership.note = updates.note || undefined; changed = true; }
        if (updates.isPrimary !== undefined && (updates.isPrimary || undefined) !== partnership.isPrimary) { partnership.isPrimary = updates.isPrimary || undefined; changed = true; }

        if (!changed) return partnership;

        this.save();
        // Audit log
        const up1 = this.data.persons[partnership.person1Id];
        const up2 = this.data.persons[partnership.person2Id];
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

        // Add to parent's childIds if not already there
        if (!parent.childIds.includes(childId)) {
            parent.childIds.push(childId);
        }

        // Add to child's parentIds if not already there (max 2 parents)
        if (!child.parentIds.includes(parentId) && child.parentIds.length < 2) {
            child.parentIds.push(parentId);
        }

        // If partnership specified, add child to partnership
        if (partnershipId) {
            const partnership = this.data.partnerships[partnershipId];
            if (partnership && !partnership.childIds.includes(childId)) {
                partnership.childIds.push(childId);
            }
        }

        this.save();
        // Audit log
        AuditLogManager.log(
            this.currentTreeId, 'parentChild.add',
            strings.auditLog.addedParentChild(auditPersonName(parent), auditPersonName(child))
        );
        return true;
    }

    removeParentChild(parentId: PersonId, childId: PersonId): boolean {
        const parent = this.data.persons[parentId];
        const child = this.data.persons[childId];
        if (!parent || !child) return false;

        // Capture names before modification for audit log
        const parentName = auditPersonName(parent);
        const childName = auditPersonName(child);

        // Remove from parent's childIds
        parent.childIds = parent.childIds.filter(id => id !== childId);

        // Remove from child's parentIds
        child.parentIds = child.parentIds.filter(id => id !== parentId);

        // Also remove from any partnership's childIds
        for (const partnership of Object.values(this.data.partnerships)) {
            if ((partnership.person1Id === parentId || partnership.person2Id === parentId) &&
                partnership.childIds.includes(childId)) {
                partnership.childIds = partnership.childIds.filter(id => id !== childId);
            }
        }

        this.save();
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
        this.save();
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
        // Capture counts before clearing for audit log
        const personCount = Object.keys(this.data.persons).length;
        const partnershipCount = Object.keys(this.data.partnerships).length;
        this.data = this.createEmptyData();
        this.save();
        // Audit log
        AuditLogManager.log(
            this.currentTreeId, 'data.clear',
            strings.auditLog.clearedData(personCount, partnershipCount)
        );
        window.dispatchEvent(new CustomEvent('strom:data-changed'));
    }

    /**
     * Set the default focus person for the current tree (exports with tree)
     * @param value undefined = first person, LAST_FOCUSED = where user left off, PersonId = specific
     */
    setDefaultPerson(value: PersonId | LastFocusedMarker | undefined): void {
        if (!this.currentTreeId) return;

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
        this.data = this.migrateData(newData);
        this.save();
        // Audit log
        const personCount = Object.keys(this.data.persons).length;
        const partnershipCount = Object.keys(this.data.partnerships).length;
        AuditLogManager.log(
            this.currentTreeId, 'data.load',
            strings.auditLog.loadedData(personCount, partnershipCount)
        );
        // Invalidate cross-tree cache when data is loaded
        CrossTree.invalidateCache();
        window.dispatchEvent(new CustomEvent('strom:data-changed'));
    }

    /**
     * Import data as a new tree
     * @param data The data to import
     * @param treeName Name for the new tree
     * @returns The new tree's ID
     */
    importAsNewTree(data: StromData, treeName: string): TreeId {
        const migratedData = this.migrateData(data);
        const treeId = TreeManager.createTreeFromImport(migratedData, treeName);
        this.currentTreeId = treeId;
        this.data = migratedData;
        // Invalidate cross-tree cache when new tree is imported
        CrossTree.invalidateCache();
        window.dispatchEvent(new CustomEvent('strom:data-changed'));
        window.dispatchEvent(new CustomEvent('strom:tree-switched'));
        return treeId;
    }

    /**
     * Create a new empty tree
     * @param name Tree name
     * @returns The new tree's ID
     */
    createNewTree(name: string): TreeId {
        const treeId = TreeManager.createTree(name);
        this.currentTreeId = treeId;
        TreeManager.setActiveTree(treeId);
        this.data = this.createEmptyData();
        window.dispatchEvent(new CustomEvent('strom:data-changed'));
        window.dispatchEvent(new CustomEvent('strom:tree-switched'));
        return treeId;
    }

    // ==================== EXPORT/IMPORT ====================

    exportJSON(): void {
        const dataStr = JSON.stringify(this.data, null, 2);
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
    async exportTreeJSON(treeId: TreeId, password?: string | null): Promise<void> {
        const treeData = TreeManager.getTreeData(treeId);
        if (!treeData) return;

        // Ensure version is set
        treeData.version = STROM_DATA_VERSION;

        const treeMeta = TreeManager.getTreeMetadata(treeId);
        const treeName = treeMeta?.name || 'family-tree';
        const safeName = treeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

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

    async exportFocusedJSON(visiblePersonIds: Set<PersonId>, password?: string | null): Promise<void> {
        // Filter persons - only visible ones
        const filteredPersons: Record<PersonId, Person> = {} as Record<PersonId, Person>;
        for (const id of visiblePersonIds) {
            const person = this.data.persons[id];
            if (person) {
                filteredPersons[id] = person;
            }
        }

        // Filter partnerships - only those where BOTH partners are visible
        const filteredPartnerships: Record<PartnershipId, Partnership> = {} as Record<PartnershipId, Partnership>;
        for (const [id, partnership] of Object.entries(this.data.partnerships)) {
            if (visiblePersonIds.has(partnership.person1Id) &&
                visiblePersonIds.has(partnership.person2Id)) {
                filteredPartnerships[id as PartnershipId] = partnership;
            }
        }

        const focusedData: StromData = {
            version: STROM_DATA_VERSION,
            persons: filteredPersons,
            partnerships: filteredPartnerships
        };

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

        // 7. Delete the removed person
        delete this.data.persons[removeId];

        this.save();
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

                            this.data = this.migrateData(data);
                            this.save();
                            window.dispatchEvent(new CustomEvent('strom:data-changed'));
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

                this.data = this.migrateData(imported);
                this.save();
                // Dispatch event for UI to re-render
                window.dispatchEvent(new CustomEvent('strom:data-changed'));
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
        'missingChildRef',
        'missingParentRef',
        'missingPartnershipRef',
        'selfPartnership',
        'duplicatePartnership',
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
            this.save();
            AuditLogManager.log(
                this.currentTreeId, 'data.repair',
                strings.auditLog.repairedIssue(issue.message)
            );
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
