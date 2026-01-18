/**
 * TreeManager - Manages multiple family trees in the application
 * Handles tree CRUD operations, storage, and migration from legacy format
 */

import {
    TreeId,
    TreeMetadata,
    TreeIndex,
    StorageInfo,
    StromData,
    PersonId,
    PartnershipId,
    Person,
    Partnership,
    generateTreeId,
    TREE_INDEX_KEY,
    TREE_DATA_PREFIX,
    LEGACY_STORAGE_KEY,
    LAST_FOCUSED,
    LastFocusedMarker,
    STROM_DATA_VERSION
} from './types.js';
import { strings } from './strings.js';
import { isEncrypted, EncryptedData, CryptoSession } from './crypto.js';
import { SettingsManager } from './settings.js';

/** Key for legacy session state (to be cleaned up on first run) */
const LEGACY_SESSION_KEY = 'strom-session';

/** Current tree index version */
const TREE_INDEX_VERSION = 1;

/** Estimated localStorage limit (conservative, most browsers support 5-10MB) */
const ESTIMATED_STORAGE_LIMIT = 5 * 1024 * 1024; // 5 MB

/**
 * Convert string to URL-friendly slug
 * "Rodina Novák" → "rodina-novak"
 */
function slugify(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')  // Remove diacritics
        .replace(/[^a-z0-9]+/g, '-')       // Replace non-alphanumeric with hyphens
        .replace(/^-+|-+$/g, '')           // Trim leading/trailing hyphens
        .replace(/-+/g, '-');              // Collapse multiple hyphens
}

class TreeManagerClass {
    private index: TreeIndex = {
        version: TREE_INDEX_VERSION,
        activeTreeId: null,
        trees: []
    };

    private initialized = false;

    // ==================== INITIALIZATION ====================

    /**
     * Initialize the tree manager
     * - Loads existing tree index or creates new one
     * - Migrates legacy data if present
     * @returns true if migration occurred
     */
    init(): boolean {
        if (this.initialized) return false;

        let migrated = false;

        // Clean up legacy session state (no longer used - all state is now in tree data)
        localStorage.removeItem(LEGACY_SESSION_KEY);

        // Try to load existing tree index
        const storedIndex = localStorage.getItem(TREE_INDEX_KEY);
        if (storedIndex) {
            try {
                this.index = JSON.parse(storedIndex);
                this.initialized = true;
                return false;
            } catch {
                console.error('Failed to parse tree index, creating new');
            }
        }

        // Check for legacy data to migrate
        const legacyData = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (legacyData) {
            try {
                const data = JSON.parse(legacyData) as StromData;
                const personCount = Object.keys(data.persons || {}).length;
                const partnershipCount = Object.keys(data.partnerships || {}).length;

                if (personCount > 0) {
                    // Create new tree from legacy data
                    const treeId = generateTreeId();
                    const now = new Date().toISOString();
                    const sizeBytes = new Blob([legacyData]).size;

                    const metadata: TreeMetadata = {
                        id: treeId,
                        name: strings.treeManager.defaultTreeName,
                        createdAt: now,
                        lastModifiedAt: now,
                        personCount,
                        partnershipCount,
                        sizeBytes
                    };

                    // Save tree data with new key
                    localStorage.setItem(TREE_DATA_PREFIX + treeId, legacyData);

                    // Create index with migrated tree
                    this.index = {
                        version: TREE_INDEX_VERSION,
                        activeTreeId: treeId,
                        trees: [metadata]
                    };

                    // Remove legacy key
                    localStorage.removeItem(LEGACY_STORAGE_KEY);

                    migrated = true;
                }
            } catch {
                console.error('Failed to migrate legacy data');
            }
        }

        // If still no trees, create a default empty tree
        if (this.index.trees.length === 0) {
            const treeId = generateTreeId();
            const now = new Date().toISOString();

            const emptyData: StromData = {
                version: STROM_DATA_VERSION,
                persons: {} as Record<PersonId, Person>,
                partnerships: {} as Record<PartnershipId, Partnership>
            };

            const metadata: TreeMetadata = {
                id: treeId,
                name: strings.treeManager.defaultTreeName,
                createdAt: now,
                lastModifiedAt: now,
                personCount: 0,
                partnershipCount: 0,
                sizeBytes: 0
            };

            // Save empty tree data
            localStorage.setItem(TREE_DATA_PREFIX + treeId, JSON.stringify(emptyData));

            // Add to index and set as active
            this.index.trees.push(metadata);
            this.index.activeTreeId = treeId;
        }

        // Save the index
        this.saveIndex();
        this.initialized = true;
        return migrated;
    }

    // ==================== INDEX MANAGEMENT ====================

    private saveIndex(): void {
        localStorage.setItem(TREE_INDEX_KEY, JSON.stringify(this.index));
    }

    /**
     * Get all tree metadata
     */
    getTrees(): TreeMetadata[] {
        return [...this.index.trees];
    }

    /**
     * Get active tree ID
     */
    getActiveTreeId(): TreeId | null {
        return this.index.activeTreeId;
    }

    /**
     * Get active tree metadata
     */
    getActiveTreeMetadata(): TreeMetadata | null {
        if (!this.index.activeTreeId) return null;
        return this.index.trees.find(t => t.id === this.index.activeTreeId) || null;
    }

    // ==================== TREE CRUD ====================

    /**
     * Create a new empty tree
     * @param name Tree name
     * @returns The new tree's ID
     */
    createTree(name: string): TreeId {
        const treeId = generateTreeId();
        const now = new Date().toISOString();

        const emptyData: StromData = {
            version: STROM_DATA_VERSION,
            persons: {} as Record<string, never>,
            partnerships: {} as Record<string, never>
        };

        const dataStr = JSON.stringify(emptyData);
        const sizeBytes = new Blob([dataStr]).size;

        const metadata: TreeMetadata = {
            id: treeId,
            name,
            createdAt: now,
            lastModifiedAt: now,
            personCount: 0,
            partnershipCount: 0,
            sizeBytes
        };

        // Save tree data
        localStorage.setItem(TREE_DATA_PREFIX + treeId, dataStr);

        // Add to index
        this.index.trees.push(metadata);
        this.saveIndex();

        return treeId;
    }

    /**
     * Delete a tree
     * @param id Tree ID to delete
     * @returns true if deleted, false if tree not found or is the only tree
     */
    deleteTree(id: TreeId): boolean {
        const idx = this.index.trees.findIndex(t => t.id === id);
        if (idx === -1) return false;

        // Remove tree data
        localStorage.removeItem(TREE_DATA_PREFIX + id);

        // Remove from index
        this.index.trees.splice(idx, 1);

        // If this was the active tree, switch to another or null
        if (this.index.activeTreeId === id) {
            this.index.activeTreeId = this.index.trees.length > 0
                ? this.index.trees[0].id
                : null;
        }

        this.saveIndex();
        return true;
    }

    /**
     * Rename a tree
     * @param id Tree ID
     * @param name New name
     */
    renameTree(id: TreeId, name: string): void {
        const tree = this.index.trees.find(t => t.id === id);
        if (tree) {
            tree.name = name;
            tree.lastModifiedAt = new Date().toISOString();
            this.saveIndex();
        }
    }

    /**
     * Duplicate a tree
     * @param id Tree ID to duplicate
     * @param newName Name for the copy
     * @returns The new tree's ID, or null if source not found
     */
    duplicateTree(id: TreeId, newName: string): TreeId | null {
        const sourceData = this.getTreeData(id);
        if (!sourceData) return null;

        const newId = generateTreeId();
        const now = new Date().toISOString();
        const dataStr = JSON.stringify(sourceData);
        const sizeBytes = new Blob([dataStr]).size;

        const metadata: TreeMetadata = {
            id: newId,
            name: newName,
            createdAt: now,
            lastModifiedAt: now,
            personCount: Object.keys(sourceData.persons).length,
            partnershipCount: Object.keys(sourceData.partnerships).length,
            sizeBytes
        };

        // Save tree data
        localStorage.setItem(TREE_DATA_PREFIX + newId, dataStr);

        // Add to index
        this.index.trees.push(metadata);
        this.saveIndex();

        return newId;
    }

    // ==================== DATA OPERATIONS ====================

    /**
     * Get tree data by ID (sync version for compatibility)
     * NOTE: This returns unencrypted data. For encrypted data, use getTreeDataAsync
     * @param id Tree ID
     * @returns Tree data or null if not found/encrypted
     */
    getTreeData(id: TreeId): StromData | null {
        const dataStr = localStorage.getItem(TREE_DATA_PREFIX + id);
        if (!dataStr) return null;

        try {
            const parsed = JSON.parse(dataStr);

            // If data is encrypted, check if session is unlocked
            if (isEncrypted(parsed)) {
                if (CryptoSession.isUnlocked()) {
                    // Cannot decrypt synchronously - return null
                    // Caller should use getTreeDataAsync
                    console.warn('Encrypted data found, use getTreeDataAsync');
                }
                return null;
            }

            return parsed as StromData;
        } catch {
            console.error('Failed to parse tree data:', id);
            return null;
        }
    }

    /**
     * Get tree data by ID (async version for encrypted data)
     * @param id Tree ID
     * @returns Tree data or null if not found
     */
    async getTreeDataAsync(id: TreeId): Promise<StromData | null> {
        const dataStr = localStorage.getItem(TREE_DATA_PREFIX + id);
        if (!dataStr) return null;

        try {
            const parsed = JSON.parse(dataStr);

            // If data is encrypted, decrypt it
            if (isEncrypted(parsed)) {
                if (!CryptoSession.isUnlocked()) {
                    console.error('Crypto session not unlocked');
                    return null;
                }
                const decrypted = await CryptoSession.decrypt(parsed);
                return JSON.parse(decrypted) as StromData;
            }

            return parsed as StromData;
        } catch (err) {
            console.error('Failed to parse/decrypt tree data:', id, err);
            return null;
        }
    }

    /**
     * Check if tree data is encrypted
     */
    isTreeDataEncrypted(id: TreeId): boolean {
        const dataStr = localStorage.getItem(TREE_DATA_PREFIX + id);
        if (!dataStr) return false;

        try {
            const parsed = JSON.parse(dataStr);
            return isEncrypted(parsed);
        } catch {
            return false;
        }
    }

    /**
     * Get raw encrypted data for password validation
     */
    getEncryptedData(id: TreeId): EncryptedData | null {
        const dataStr = localStorage.getItem(TREE_DATA_PREFIX + id);
        if (!dataStr) return null;

        try {
            const parsed = JSON.parse(dataStr);
            if (isEncrypted(parsed)) {
                return parsed;
            }
            return null;
        } catch {
            return null;
        }
    }

    /**
     * Check if any tree has encrypted data (for startup password prompt)
     * Returns the first encrypted data found, or null if none
     */
    getFirstEncryptedData(): EncryptedData | null {
        for (const tree of this.index.trees) {
            const encrypted = this.getEncryptedData(tree.id);
            if (encrypted) {
                return encrypted;
            }
        }
        return null;
    }

    /**
     * Check if storage has encrypted trees that need unlocking
     */
    hasEncryptedTrees(): boolean {
        return this.getFirstEncryptedData() !== null;
    }

    /**
     * Save tree data (sync version for unencrypted data)
     * For encrypted data, use saveTreeDataAsync
     * @param id Tree ID
     * @param data Tree data
     */
    saveTreeData(id: TreeId, data: StromData): void {
        // Ensure version is set
        data.version = STROM_DATA_VERSION;

        // If encryption is enabled and session is unlocked, save async
        if (SettingsManager.isEncryptionEnabled() && CryptoSession.isUnlocked()) {
            this.saveTreeDataAsync(id, data);
            return;
        }

        const dataStr = JSON.stringify(data);
        const sizeBytes = new Blob([dataStr]).size;

        // Save data
        localStorage.setItem(TREE_DATA_PREFIX + id, dataStr);

        // Update metadata
        const tree = this.index.trees.find(t => t.id === id);
        if (tree) {
            tree.lastModifiedAt = new Date().toISOString();
            tree.personCount = Object.keys(data.persons).length;
            tree.partnershipCount = Object.keys(data.partnerships).length;
            tree.sizeBytes = sizeBytes;
            this.saveIndex();
        }
    }

    /**
     * Save tree data with encryption (async)
     * @param id Tree ID
     * @param data Tree data
     */
    async saveTreeDataAsync(id: TreeId, data: StromData): Promise<void> {
        // Ensure version is set
        data.version = STROM_DATA_VERSION;

        let dataStr: string;

        // Encrypt if enabled and session is unlocked
        if (SettingsManager.isEncryptionEnabled() && CryptoSession.isUnlocked()) {
            const plainText = JSON.stringify(data);
            const encrypted = await CryptoSession.encrypt(plainText);
            dataStr = JSON.stringify(encrypted);
        } else {
            dataStr = JSON.stringify(data);
        }

        const sizeBytes = new Blob([dataStr]).size;

        // Save data
        localStorage.setItem(TREE_DATA_PREFIX + id, dataStr);

        // Update metadata
        const tree = this.index.trees.find(t => t.id === id);
        if (tree) {
            tree.lastModifiedAt = new Date().toISOString();
            tree.personCount = Object.keys(data.persons).length;
            tree.partnershipCount = Object.keys(data.partnerships).length;
            tree.sizeBytes = sizeBytes;
            this.saveIndex();
        }
    }

    /**
     * Set the active tree
     * @param id Tree ID to activate
     * @returns true if switched, false if tree not found
     */
    setActiveTree(id: TreeId): boolean {
        const tree = this.index.trees.find(t => t.id === id);
        if (!tree) return false;

        this.index.activeTreeId = id;
        this.saveIndex();
        return true;
    }

    // ==================== IMPORT ====================

    /**
     * Create a new tree from imported data
     * @param data Imported StromData
     * @param name Name for the new tree
     * @returns The new tree's ID
     */
    createTreeFromImport(data: StromData, name: string): TreeId {
        // Set current version on import
        data.version = STROM_DATA_VERSION;

        const treeId = generateTreeId();
        const now = new Date().toISOString();
        const dataStr = JSON.stringify(data);
        const sizeBytes = new Blob([dataStr]).size;

        const metadata: TreeMetadata = {
            id: treeId,
            name,
            createdAt: now,
            lastModifiedAt: now,
            personCount: Object.keys(data.persons).length,
            partnershipCount: Object.keys(data.partnerships).length,
            sizeBytes
        };

        // Save tree data
        localStorage.setItem(TREE_DATA_PREFIX + treeId, dataStr);

        // Add to index
        this.index.trees.push(metadata);

        // Auto-switch to the new tree
        this.index.activeTreeId = treeId;

        this.saveIndex();
        return treeId;
    }

    // ==================== STORAGE MONITORING ====================

    /**
     * Get storage usage information
     */
    getStorageUsage(): StorageInfo {
        const trees: StorageInfo['trees'] = [];
        let used = 0;

        // Calculate index size
        const indexStr = localStorage.getItem(TREE_INDEX_KEY);
        if (indexStr) {
            used += new Blob([indexStr]).size;
        }

        // Calculate each tree's size
        for (const tree of this.index.trees) {
            const dataStr = localStorage.getItem(TREE_DATA_PREFIX + tree.id);
            const size = dataStr ? new Blob([dataStr]).size : tree.sizeBytes;
            used += size;
            trees.push({
                id: tree.id,
                name: tree.name,
                size
            });
        }

        return {
            used,
            total: ESTIMATED_STORAGE_LIMIT,
            trees
        };
    }

    /**
     * Format bytes to human readable string
     */
    formatBytes(bytes: number): string {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    // ==================== HELPERS ====================

    /**
     * Check if there are any trees
     */
    hasTrees(): boolean {
        return this.index.trees.length > 0;
    }

    /**
     * Get tree count
     */
    getTreeCount(): number {
        return this.index.trees.length;
    }

    /**
     * Get tree metadata by ID
     */
    getTreeMetadata(id: TreeId): TreeMetadata | null {
        return this.index.trees.find(t => t.id === id) || null;
    }

    /**
     * Get the first tree (default tree when no setting)
     */
    getFirstTree(): TreeMetadata | null {
        return this.index.trees.length > 0 ? this.index.trees[0] : null;
    }

    /**
     * Find tree by slug (URL-friendly name)
     * Returns first match if multiple trees have same slug
     */
    getTreeBySlug(slug: string): TreeMetadata | null {
        const normalizedSlug = slug.toLowerCase().replace(/^-+|-+$/g, '');
        return this.index.trees.find(t => slugify(t.name) === normalizedSlug) || null;
    }

    /**
     * Get URL-friendly slug for a tree
     */
    getTreeSlug(treeId: TreeId): string | null {
        const tree = this.getTreeMetadata(treeId);
        return tree ? slugify(tree.name) : null;
    }

    // ==================== DEFAULT TREE SETTINGS (EXPORTS WITH "EXPORT ALL") ====================

    /**
     * Set the default tree setting
     * @param value undefined = first tree, LAST_FOCUSED = where user left off, TreeId = specific tree
     */
    setDefaultTree(value: TreeId | LastFocusedMarker | undefined): void {
        if (value === undefined) {
            delete this.index.defaultTreeId;
        } else {
            this.index.defaultTreeId = value;
        }
        this.saveIndex();
    }

    /**
     * Get the default tree setting
     */
    getDefaultTree(): TreeId | LastFocusedMarker | undefined {
        return this.index.defaultTreeId;
    }

    /**
     * Save the last focused tree (called when switching trees, if defaultTreeId === LAST_FOCUSED)
     */
    saveLastTree(treeId: TreeId): void {
        if (this.index.defaultTreeId === LAST_FOCUSED) {
            this.index.lastTreeId = treeId;
            this.saveIndex();
        }
    }

    /**
     * Get the startup tree ID based on settings
     * Returns the tree that should be active when the app starts
     */
    getStartupTreeId(): TreeId | null {
        const setting = this.index.defaultTreeId;

        if (setting === undefined) {
            // First tree
            return this.index.trees.length > 0 ? this.index.trees[0].id : null;
        }

        if (setting === LAST_FOCUSED) {
            // Last focused tree, fallback to first
            const lastId = this.index.lastTreeId;
            if (lastId && this.index.trees.some(t => t.id === lastId)) {
                return lastId;
            }
            return this.index.trees.length > 0 ? this.index.trees[0].id : null;
        }

        // Specific tree ID
        if (this.index.trees.some(t => t.id === setting)) {
            return setting;
        }

        // Fallback to first
        return this.index.trees.length > 0 ? this.index.trees[0].id : null;
    }

    // ==================== DEFAULT PERSON MANAGEMENT (EXPORTS WITH TREE) ====================

    /**
     * Set the default person for a tree
     * @param treeId The tree ID
     * @param value undefined = first person, LAST_FOCUSED = where user left off, PersonId = specific person
     */
    setDefaultPerson(treeId: TreeId, value: PersonId | LastFocusedMarker | undefined): void {
        const data = this.getTreeData(treeId);
        if (!data) return;

        if (value === undefined) {
            delete data.defaultPersonId;
        } else {
            data.defaultPersonId = value;
        }

        this.saveTreeData(treeId, data);
    }

    /**
     * Get the default person setting for a tree
     */
    getDefaultPerson(treeId: TreeId): PersonId | LastFocusedMarker | undefined {
        const data = this.getTreeData(treeId);
        return data?.defaultPersonId;
    }

    /**
     * Save the last focus state for a tree (called when focus changes, if defaultPersonId === LAST_FOCUSED)
     */
    saveLastFocus(treeId: TreeId, personId: PersonId, depthUp: number, depthDown: number): void {
        const data = this.getTreeData(treeId);
        if (!data) return;

        // Only save if the setting is LAST_FOCUSED
        if (data.defaultPersonId === LAST_FOCUSED) {
            data.lastFocusPersonId = personId;
            data.lastFocusDepthUp = depthUp;
            data.lastFocusDepthDown = depthDown;
            this.saveTreeData(treeId, data);
        }
    }

    /**
     * Get the startup focus state for a tree based on settings
     * Returns { personId, depthUp, depthDown } or null for "use first person with default depths"
     */
    getStartupFocus(treeId: TreeId): { personId: PersonId; depthUp?: number; depthDown?: number } | null {
        const data = this.getTreeData(treeId);
        if (!data) return null;

        const setting = data.defaultPersonId;

        if (setting === undefined) {
            // First person
            return null; // Let caller handle first person logic
        }

        if (setting === LAST_FOCUSED) {
            // Last focused, with depths
            if (data.lastFocusPersonId && data.persons[data.lastFocusPersonId]) {
                return {
                    personId: data.lastFocusPersonId,
                    depthUp: data.lastFocusDepthUp,
                    depthDown: data.lastFocusDepthDown
                };
            }
            // Fallback to first person
            return null;
        }

        // Specific person ID
        if (data.persons[setting]) {
            return { personId: setting };
        }

        // Fallback to first person
        return null;
    }

    /**
     * Get the tree index (for export all functionality)
     */
    getIndex(): TreeIndex {
        return { ...this.index };
    }

    // ==================== EXPORT ID TRACKING ====================

    /**
     * Find tree by export ID (sourceExportId or lastExportId)
     * @param exportId The export ID to search for
     * @returns TreeMetadata or null if not found
     */
    findTreeByExportId(exportId: string): TreeMetadata | null {
        return this.index.trees.find(t =>
            t.sourceExportId === exportId || t.lastExportId === exportId
        ) || null;
    }

    /**
     * Set the source export ID for a tree (when importing from export)
     * @param treeId The tree ID
     * @param exportId The export ID from which this tree was imported
     */
    setSourceExportId(treeId: TreeId, exportId: string): void {
        const tree = this.index.trees.find(t => t.id === treeId);
        if (tree) {
            tree.sourceExportId = exportId;
            this.saveIndex();
        }
    }

    /**
     * Set the last export ID for a tree (when exporting)
     * @param treeId The tree ID
     * @param exportId The export ID generated during export
     */
    setLastExportId(treeId: TreeId, exportId: string): void {
        const tree = this.index.trees.find(t => t.id === treeId);
        if (tree) {
            tree.lastExportId = exportId;
            this.saveIndex();
        }
    }

    /**
     * Update tree data from import (used when updating existing tree from view mode)
     * @param treeId The tree ID to update
     * @param data The new data
     */
    updateTreeFromImport(treeId: TreeId, data: StromData): void {
        this.saveTreeData(treeId, data);
    }
}

// Export singleton instance
export const TreeManager = new TreeManagerClass();
