/**
 * TreeManager - Manages multiple family trees in the application
 * Handles tree CRUD operations and storage via IndexedDB
 */

import {
    TreeId,
    TreeMetadata,
    TreeIndex,
    StromData,
    PersonId,
    PartnershipId,
    Person,
    Partnership,
    generateTreeId,
    LAST_FOCUSED,
    LastFocusedMarker,
    STROM_DATA_VERSION
} from './types.js';
import { strings } from './strings.js';
import { isEncrypted, EncryptedData, CryptoSession } from './crypto.js';
import { SettingsManager } from './settings.js';
import { AuditLogManager } from './audit-log.js';
import { StorageManager } from './storage.js';

/** Current tree index version */
const TREE_INDEX_VERSION = 1;

/** IDB key for the tree index inside 'trees' store */
const INDEX_KEY = '_index';

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
     * - Loads existing tree index from IDB or creates new one
     */
    async init(): Promise<void> {
        if (this.initialized) return;

        // Try to load existing tree index from IDB
        const storedIndex = await StorageManager.get<TreeIndex>('trees', INDEX_KEY);
        if (storedIndex) {
            this.index = storedIndex;
            this.initialized = true;
            return;
        }

        // No index found, create a default empty tree
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

            // Save empty tree data (fire-and-forget)
            void StorageManager.set('trees', treeId, emptyData);

            // Add to index and set as active
            this.index.trees.push(metadata);
            this.index.activeTreeId = treeId;
        }

        // Save the index
        this.saveIndex();
        this.initialized = true;
    }

    // ==================== INDEX MANAGEMENT ====================

    /** Save index to IDB (fire-and-forget) */
    private saveIndex(): void {
        void StorageManager.set('trees', INDEX_KEY, this.index);
    }

    /**
     * Get all tree metadata
     */
    getTrees(): TreeMetadata[] {
        return [...this.index.trees];
    }

    /**
     * Get visible trees (for switcher and cross-tree matching)
     * Excludes trees marked as hidden
     */
    getVisibleTrees(): TreeMetadata[] {
        return this.index.trees.filter(t => !t.isHidden);
    }

    /**
     * Toggle tree visibility
     */
    toggleTreeVisibility(id: TreeId): boolean {
        const tree = this.index.trees.find(t => t.id === id);
        if (!tree) return false;

        tree.isHidden = !tree.isHidden;
        this.saveIndex();
        return true;
    }

    /**
     * Set tree visibility
     */
    setTreeVisibility(id: TreeId, isHidden: boolean): void {
        const tree = this.index.trees.find(t => t.id === id);
        if (tree) {
            tree.isHidden = isHidden;
            this.saveIndex();
        }
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

        // Save tree data (fire-and-forget)
        void StorageManager.set('trees', treeId, emptyData);

        // Add to index
        this.index.trees.push(metadata);
        this.saveIndex();

        return treeId;
    }

    /**
     * Delete a tree
     */
    async deleteTree(id: TreeId): Promise<boolean> {
        const idx = this.index.trees.findIndex(t => t.id === id);
        if (idx === -1) return false;

        // Remove tree data from IDB
        await StorageManager.delete('trees', id);

        // Remove audit log for this tree
        await AuditLogManager.deleteForTree(id);

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
     */
    async duplicateTree(id: TreeId, newName: string): Promise<TreeId | null> {
        const sourceData = await this.getTreeData(id);
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

        // Save tree data (fire-and-forget)
        void StorageManager.set('trees', newId, sourceData);

        // Add to index
        this.index.trees.push(metadata);
        this.saveIndex();

        return newId;
    }

    // ==================== DATA OPERATIONS ====================

    /**
     * Get tree data by ID (async, handles encryption)
     */
    async getTreeData(id: TreeId): Promise<StromData | null> {
        const raw = await StorageManager.get<StromData | EncryptedData>('trees', id);
        if (!raw) return null;

        try {
            // If data is encrypted, decrypt it
            if (isEncrypted(raw)) {
                if (!CryptoSession.isUnlocked()) {
                    return null;
                }
                const decrypted = await CryptoSession.decrypt(raw as EncryptedData);
                return JSON.parse(decrypted) as StromData;
            }

            return raw as StromData;
        } catch (err) {
            console.error('Failed to parse/decrypt tree data:', id, err);
            return null;
        }
    }

    /**
     * Check if tree data is encrypted
     */
    async isTreeDataEncrypted(id: TreeId): Promise<boolean> {
        const raw = await StorageManager.get<unknown>('trees', id);
        if (!raw) return false;
        return isEncrypted(raw);
    }

    /**
     * Get raw encrypted data for password validation
     */
    async getEncryptedData(id: TreeId): Promise<EncryptedData | null> {
        const raw = await StorageManager.get<unknown>('trees', id);
        if (!raw) return null;
        if (isEncrypted(raw)) return raw as EncryptedData;
        return null;
    }

    /**
     * Check if any tree has encrypted data (for startup password prompt)
     */
    async getFirstEncryptedData(): Promise<EncryptedData | null> {
        for (const tree of this.index.trees) {
            const encrypted = await this.getEncryptedData(tree.id);
            if (encrypted) {
                return encrypted;
            }
        }
        return null;
    }

    /**
     * Check if storage has encrypted trees that need unlocking
     */
    async hasEncryptedTrees(): Promise<boolean> {
        return (await this.getFirstEncryptedData()) !== null;
    }

    /**
     * Save tree data (fire-and-forget)
     * Handles encryption if enabled.
     */
    saveTreeData(id: TreeId, data: StromData): void {
        // Ensure version is set
        data.version = STROM_DATA_VERSION;

        // Determine what to persist
        if (SettingsManager.isEncryptionEnabled() && CryptoSession.isUnlocked()) {
            // Encrypt then write (async, fire-and-forget)
            void (async () => {
                const plainText = JSON.stringify(data);
                const encrypted = await CryptoSession.encrypt(plainText);
                const sizeBytes = new Blob([JSON.stringify(encrypted)]).size;
                void StorageManager.set('trees', id, encrypted);
                this.updateMetadata(id, data, sizeBytes);
            })();
        } else {
            const dataStr = JSON.stringify(data);
            const sizeBytes = new Blob([dataStr]).size;
            void StorageManager.set('trees', id, data);
            this.updateMetadata(id, data, sizeBytes);
        }
    }

    /** Update in-memory metadata after save */
    private updateMetadata(id: TreeId, data: StromData, sizeBytes: number): void {
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

        // Save tree data (fire-and-forget)
        void StorageManager.set('trees', treeId, data);

        // Add to index
        this.index.trees.push(metadata);

        // Auto-switch to the new tree
        this.index.activeTreeId = treeId;

        this.saveIndex();
        return treeId;
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

    hasTrees(): boolean {
        return this.index.trees.length > 0;
    }

    getTreeCount(): number {
        return this.index.trees.length;
    }

    getTreeMetadata(id: TreeId): TreeMetadata | null {
        return this.index.trees.find(t => t.id === id) || null;
    }

    getFirstTree(): TreeMetadata | null {
        return this.index.trees.length > 0 ? this.index.trees[0] : null;
    }

    getTreeBySlug(slug: string): TreeMetadata | null {
        const normalizedSlug = slug.toLowerCase().replace(/^-+|-+$/g, '');
        return this.index.trees.find(t => slugify(t.name) === normalizedSlug) || null;
    }

    getTreeSlug(treeId: TreeId): string | null {
        const tree = this.getTreeMetadata(treeId);
        return tree ? slugify(tree.name) : null;
    }

    // ==================== DEFAULT TREE SETTINGS ====================

    setDefaultTree(value: TreeId | LastFocusedMarker | undefined): void {
        if (value === undefined) {
            delete this.index.defaultTreeId;
        } else {
            this.index.defaultTreeId = value;
        }
        this.saveIndex();
    }

    getDefaultTree(): TreeId | LastFocusedMarker | undefined {
        return this.index.defaultTreeId;
    }

    saveLastTree(treeId: TreeId): void {
        if (this.index.defaultTreeId === LAST_FOCUSED) {
            this.index.lastTreeId = treeId;
            this.saveIndex();
        }
    }

    getStartupTreeId(): TreeId | null {
        const setting = this.index.defaultTreeId;

        if (setting === undefined) {
            return this.index.trees.length > 0 ? this.index.trees[0].id : null;
        }

        if (setting === LAST_FOCUSED) {
            const lastId = this.index.lastTreeId;
            if (lastId && this.index.trees.some(t => t.id === lastId)) {
                return lastId;
            }
            return this.index.trees.length > 0 ? this.index.trees[0].id : null;
        }

        if (this.index.trees.some(t => t.id === setting)) {
            return setting;
        }

        return this.index.trees.length > 0 ? this.index.trees[0].id : null;
    }

    // ==================== DEFAULT PERSON MANAGEMENT ====================

    async setDefaultPerson(treeId: TreeId, value: PersonId | LastFocusedMarker | undefined): Promise<void> {
        const data = await this.getTreeData(treeId);
        if (!data) return;

        if (value === undefined) {
            delete data.defaultPersonId;
        } else {
            data.defaultPersonId = value;
        }

        this.saveTreeData(treeId, data);
    }

    async getDefaultPerson(treeId: TreeId): Promise<PersonId | LastFocusedMarker | undefined> {
        const data = await this.getTreeData(treeId);
        return data?.defaultPersonId;
    }

    async saveLastFocus(treeId: TreeId, personId: PersonId, depthUp: number, depthDown: number): Promise<void> {
        const data = await this.getTreeData(treeId);
        if (!data) return;

        if (data.defaultPersonId === LAST_FOCUSED) {
            data.lastFocusPersonId = personId;
            data.lastFocusDepthUp = depthUp;
            data.lastFocusDepthDown = depthDown;
            this.saveTreeData(treeId, data);
        }
    }

    async getStartupFocus(treeId: TreeId): Promise<{ personId: PersonId; depthUp?: number; depthDown?: number } | null> {
        const data = await this.getTreeData(treeId);
        if (!data) return null;

        const setting = data.defaultPersonId;

        if (setting === undefined) {
            return null;
        }

        if (setting === LAST_FOCUSED) {
            if (data.lastFocusPersonId && data.persons[data.lastFocusPersonId]) {
                return {
                    personId: data.lastFocusPersonId,
                    depthUp: data.lastFocusDepthUp,
                    depthDown: data.lastFocusDepthDown
                };
            }
            return null;
        }

        if (data.persons[setting]) {
            return { personId: setting };
        }

        return null;
    }

    /**
     * Get the tree index (for export all functionality)
     */
    getIndex(): TreeIndex {
        return { ...this.index };
    }

    // ==================== EXPORT ID TRACKING ====================

    findTreeByExportId(exportId: string): TreeMetadata | null {
        return this.index.trees.find(t =>
            t.sourceExportId === exportId || t.lastExportId === exportId
        ) || null;
    }

    setSourceExportId(treeId: TreeId, exportId: string): void {
        const tree = this.index.trees.find(t => t.id === treeId);
        if (tree) {
            tree.sourceExportId = exportId;
            this.saveIndex();
        }
    }

    setLastExportId(treeId: TreeId, exportId: string): void {
        const tree = this.index.trees.find(t => t.id === treeId);
        if (tree) {
            tree.lastExportId = exportId;
            this.saveIndex();
        }
    }

    updateTreeFromImport(treeId: TreeId, data: StromData): void {
        this.saveTreeData(treeId, data);
    }
}

// Export singleton instance
export const TreeManager = new TreeManagerClass();
