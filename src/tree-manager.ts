/**
 * TreeManager - Manages multiple family trees in the application
 * Handles tree CRUD operations and storage via IndexedDB
 */

import {
    TreeId,
    TreeMetadata,
    ResearchLink,
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
import { isEncrypted, EncryptedData, CryptoSession, decrypt } from './crypto.js';
import { SettingsManager } from './settings.js';
import { AuditLogManager } from './audit-log.js';
import { StorageManager } from './storage.js';
import { requestPersistentStorage } from './persistence.js';
import { asciiSlug } from './filenames.js';
import { announceTreeSaved } from './tab-sync.js';

/**
 * Outcome of reading a tree record. `locked` / `undecryptable` are NOT the
 * same as an empty tree: loading them as empty and saving afterwards used to
 * overwrite the real (encrypted) family with nothing (review K8).
 */
export type TreeReadResult =
    | { status: 'ok'; data: StromData }
    | { status: 'missing' }
    | { status: 'locked' }
    | { status: 'undecryptable' };

/** Separator between the readable slug and the id suffix in `?tree=`. A
 * slug never contains two hyphens in a row (asciiSlug collapses them). */
const SLUG_ID_SEPARATOR = '--';

/** Current tree index version */
const TREE_INDEX_VERSION = 1;

/** IDB key for the tree index inside 'trees' store */
const INDEX_KEY = '_index';

/**
 * Convert string to URL-friendly slug
 * "Rodina Novák" → "rodina-novak"
 */
function slugify(text: string): string {
    return asciiSlug(text);
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
            // Self-heal: an earlier bug could persist a hidden ACTIVE tree.
            this.ensureActiveVisible();
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
        StorageManager.set('trees', INDEX_KEY, this.index).catch((err) => {
            console.error('Saving the tree index failed', err);
            dispatchSaveFailed(null, err);
        });
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
     * First tree that may become active. Prefers visible trees; when EVERY
     * tree is hidden, unhides the first one — the invariant is that the
     * active tree is never hidden (reported live: a hidden tree opened as
     * active via the trees[0] fallbacks).
     */
    private firstUsableTreeId(): TreeId | null {
        const visible = this.getVisibleTrees();
        if (visible.length > 0) return visible[0].id;
        if (this.index.trees.length === 0) return null;
        this.index.trees[0].isHidden = false;
        this.saveIndex();
        return this.index.trees[0].id;
    }

    /** True when the tree exists and is not hidden. */
    private isUsable(id: TreeId | null | undefined): boolean {
        if (!id) return false;
        const t = this.index.trees.find(x => x.id === id);
        return !!t && !t.isHidden;
    }

    /** Self-heal the never-active-and-hidden invariant (startup guard). */
    ensureActiveVisible(): void {
        if (this.index.activeTreeId && !this.isUsable(this.index.activeTreeId)) {
            const next = this.firstUsableTreeId();
            if (next) {
                this.index.activeTreeId = next;
                this.saveIndex();
            }
        }
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
     * Toggle tree lock
     */
    toggleTreeLock(id: TreeId): boolean {
        const tree = this.index.trees.find(t => t.id === id);
        if (!tree) return false;

        tree.isLocked = !tree.isLocked;
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

        // Add to index first (queued saves skip trees missing from the index)
        this.index.trees.push(metadata);
        this.saveIndex();

        // Save through the encrypting path (fire-and-forget)
        this.saveTreeData(treeId, emptyData);

        return treeId;
    }

    /**
     * Delete a tree
     */
    async deleteTree(id: TreeId): Promise<boolean> {
        const idx = this.index.trees.findIndex(t => t.id === id);
        if (idx === -1) return false;

        // Remove from the index FIRST: a save still queued for this tree
        // checks the index and skips, so it cannot resurrect the record after
        // the delete below (review S20). Then drain the tree's queue.
        this.index.trees.splice(idx, 1);
        this.unreadableTrees.delete(id);
        await this.flush(id);

        // Remove tree data from IDB
        await StorageManager.delete('trees', id);

        // Remove audit log for this tree
        await AuditLogManager.deleteForTree(id);

        // Cascade the rest of the tree's storage footprint: versioned
        // backups, the linked file handle and share baselines used to leak
        // in IndexedDB forever after a delete.
        const { deleteSnapshotsForTree } = await import('./snapshots.js');
        await deleteSnapshotsForTree(id).catch(() => {});
        const { dropHandle } = await import('./file-access.js');
        await dropHandle(id).catch(() => {});
        const { deleteBaselinesForTree } = await import('./share-baselines.js');
        await deleteBaselinesForTree(id).catch(() => {});
        SettingsManager.forgetRecentSources(id);

        // If this was the active tree, switch to another VISIBLE one (never
        // land on a hidden tree) or null
        if (this.index.activeTreeId === id) {
            this.index.activeTreeId = this.firstUsableTreeId();
        }

        this.saveIndex();
        // Wait for index write to complete before returning
        await StorageManager.flush();
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

        // Add to index, then save through the encrypting path — a direct
        // StorageManager.set wrote PLAINTEXT while encryption was on (V4).
        this.index.trees.push(metadata);
        this.saveIndex();
        this.saveTreeData(newId, sourceData);

        return newId;
    }

    // ==================== DATA OPERATIONS ====================

    /**
     * Get tree data by ID (async, handles encryption)
     */
    async getTreeData(id: TreeId): Promise<StromData | null> {
        const result = await this.readTreeData(id);
        return result.status === 'ok' ? result.data : null;
    }

    /**
     * Read a tree and say WHY it could not be read. A tree that is encrypted
     * but locked / undecryptable with the current key is remembered as
     * unreadable and saving it is refused until a read succeeds — otherwise
     * an "empty" in-memory copy would overwrite the real data.
     */
    async readTreeData(id: TreeId): Promise<TreeReadResult> {
        // Ensure this tree's queued saves (and any other pending writes) have
        // landed before reading (review S20).
        await this.flush(id);
        const raw = await StorageManager.get<StromData | EncryptedData>('trees', id);
        if (!raw) {
            this.unreadableTrees.delete(id);
            return { status: 'missing' };
        }

        if (isEncrypted(raw)) {
            if (!CryptoSession.isUnlocked()) {
                this.unreadableTrees.add(id);
                return { status: 'locked' };
            }
            try {
                const decrypted = await CryptoSession.decrypt(raw as EncryptedData);
                const data = JSON.parse(decrypted) as StromData;
                this.unreadableTrees.delete(id);
                return { status: 'ok', data };
            } catch (err) {
                console.error('Failed to decrypt tree data:', id, err);
                this.unreadableTrees.add(id);
                return { status: 'undecryptable' };
            }
        }

        this.unreadableTrees.delete(id);
        return { status: 'ok', data: raw as StromData };
    }

    /**
     * Rescue a tree encrypted with a DIFFERENT key than the session (created
     * under another password before a password change, or imported): decrypt
     * it with that tree's own password and re-encrypt it with the session key,
     * so every tree shares one key afterwards and the tree reads and saves
     * normally again.
     * - 'ok': readable now (re-encrypted, or it already was readable);
     * - 'wrong-password': the password does not open this tree, nothing changed;
     * - 'locked': the session itself is locked — unlock it first;
     * - 'missing': no such record.
     */
    async recoverTreeWithPassword(id: TreeId, password: string): Promise<'ok' | 'wrong-password' | 'locked' | 'missing'> {
        const current = await this.readTreeData(id);
        if (current.status === 'ok') return 'ok';
        if (current.status === 'missing') return 'missing';
        if (current.status === 'locked' || !CryptoSession.isUnlocked()) return 'locked';

        const raw = await StorageManager.get<unknown>('trees', id);
        if (!isEncrypted(raw)) return 'missing';
        let plainText: string;
        let data: StromData;
        try {
            plainText = await decrypt(raw, password);
            data = JSON.parse(plainText) as StromData;
        } catch {
            return 'wrong-password';
        }
        const reencrypted = await CryptoSession.encrypt(plainText);
        await StorageManager.set('trees', id, reencrypted);
        await StorageManager.flush();
        this.unreadableTrees.delete(id);
        this.updateMetadata(id, data, new Blob([JSON.stringify(reencrypted)]).size);
        return 'ok';
    }

    /** True when the last read of this tree failed (locked / wrong key). */
    isTreeUnreadable(id: TreeId): boolean {
        return this.unreadableTrees.has(id);
    }

    /**
     * Wait until the tree's save queue (or every tree's, without an id) and
     * all pending IndexedDB writes have settled. Never throws.
     */
    async flush(id?: TreeId): Promise<void> {
        const queues = id ? [this.saveQueues.get(id)] : [...this.saveQueues.values()];
        await Promise.allSettled(queues.filter((q): q is Promise<void> => !!q));
        await StorageManager.flush();
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

    /** Per-tree write queue: keeps saves ordered (see saveTreeData). */
    private saveQueues = new Map<TreeId, Promise<void>>();

    /** Trees whose stored data could not be read (see readTreeData). */
    private unreadableTrees = new Set<TreeId>();

    /**
     * Save tree data. Still fire-and-forget for callers, but internally each
     * tree's writes are SERIALIZED on a queue — the encrypted path used to
     * launch independent async encrypt+write jobs, so two rapid saves could
     * land out of order and an older state could overwrite a newer one
     * (audit K5). Failures now surface as a strom:save-failed event instead
     * of a swallowed rejection.
     */
    saveTreeData(id: TreeId, data: StromData): void {
        // Never overwrite a tree we could not read: the in-memory copy is a
        // stand-in, not the family (review K8).
        if (this.unreadableTrees.has(id)) {
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('strom:save-blocked', { detail: { treeId: id } }));
            }
            return;
        }
        // Ensure version is set
        data.version = STROM_DATA_VERSION;
        // A tree with people is worth protecting from browser eviction.
        if (Object.keys(data.persons ?? {}).length > 0) void requestPersistentStorage();
        // Snapshot NOW: the caller keeps mutating the live object.
        const plainText = JSON.stringify(data);

        const prev = this.saveQueues.get(id) ?? Promise.resolve();
        const next = prev.then(async () => {
            // Deleted meanwhile: never resurrect the record (review S20).
            if (!this.index.trees.some(t => t.id === id)) return;
            if (SettingsManager.isEncryptionEnabled()) {
                if (!CryptoSession.isUnlocked()) throw new Error('locked');
                const encrypted = await CryptoSession.encrypt(plainText);
                const sizeBytes = new Blob([JSON.stringify(encrypted)]).size;
                await StorageManager.set('trees', id, encrypted);
                this.updateMetadata(id, data, sizeBytes);
            } else {
                const sizeBytes = new Blob([plainText]).size;
                await StorageManager.set('trees', id, JSON.parse(plainText) as StromData);
                this.updateMetadata(id, data, sizeBytes);
            }
            // Other tabs with this tree open must learn their copy is stale.
            announceTreeSaved(id);
        }).catch((err) => {
            // Surface instead of swallowing: quota/lock failures used to be
            // completely silent, leaving memory and disk divergent.
            console.error('saveTreeData failed', id, err);
            dispatchSaveFailed(id, err);
        });
        this.saveQueues.set(id, next);
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

        // Add to index
        this.index.trees.push(metadata);

        // Auto-switch to the new tree
        this.index.activeTreeId = treeId;

        this.saveIndex();

        // Save through the encrypting path (V4: this wrote plaintext before)
        this.saveTreeData(treeId, data);
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

    /**
     * Resolve the `?tree=` URL parameter. Current form is `slug--idsuffix`
     * (or just the id suffix for names without Latin letters); old bookmarks
     * with a plain slug still resolve by name.
     */
    getTreeBySlug(slug: string): TreeMetadata | null {
        const param = slug.trim().toLowerCase();
        if (!param) return null;
        const sepIdx = param.lastIndexOf(SLUG_ID_SEPARATOR);
        const suffix = sepIdx >= 0 ? param.slice(sepIdx + SLUG_ID_SEPARATOR.length) : param;
        if (suffix) {
            const byId = this.index.trees.find(t => this.treeIdSuffix(t.id).toLowerCase() === suffix);
            if (byId) return byId;
        }
        const normalizedSlug = (sepIdx >= 0 ? param.slice(0, sepIdx) : param).replace(/^-+|-+$/g, '');
        if (!normalizedSlug) return null;
        return this.index.trees.find(t => slugify(t.name) === normalizedSlug) || null;
    }

    /**
     * URL parameter identifying a tree: readable slug plus a short id suffix,
     * so "Novák" and "Novak" (same slug) or a non-Latin name (empty slug)
     * still point to exactly one tree (review S19).
     */
    getTreeSlug(treeId: TreeId): string | null {
        const tree = this.getTreeMetadata(treeId);
        if (!tree) return null;
        const slug = slugify(tree.name);
        const suffix = this.treeIdSuffix(tree.id);
        return slug ? `${slug}${SLUG_ID_SEPARATOR}${suffix}` : suffix;
    }

    /** Short, unique-within-this-index id fragment (the random tail of the id). */
    private treeIdSuffix(id: TreeId): string {
        const tail = String(id).split('_').pop() || String(id);
        const clash = this.index.trees.some(t => t.id !== id && (String(t.id).split('_').pop() || String(t.id)) === tail);
        return (clash ? String(id) : tail).toLowerCase().replace(/[^a-z0-9_]+/g, '');
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
        // Every branch must respect visibility — a hidden tree never opens.
        const setting = this.index.defaultTreeId;

        if (setting === LAST_FOCUSED) {
            const lastId = this.index.lastTreeId;
            if (lastId && this.isUsable(lastId)) return lastId;
            return this.firstUsableTreeId();
        }

        if (setting !== undefined && this.isUsable(setting as TreeId)) {
            return setting as TreeId;
        }

        return this.firstUsableTreeId();
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

    /** Collaboration: remember which shared file this tree was saved from. */
    setReceivedInfo(treeId: TreeId, exportId: string, from?: string): void {
        const tree = this.index.trees.find(t => t.id === treeId);
        if (tree) {
            tree.receivedExportId = exportId;
            if (from) tree.receivedFrom = from;
            this.saveIndex();
        }
    }

    updateTreeFromImport(treeId: TreeId, data: StromData): void {
        this.saveTreeData(treeId, data);
    }

    // ==================== STROM RESEARCH LINK ====================

    /** The tree that holds the research with this UUID, if any. */
    findTreeByResearchId(researchId: string): TreeMetadata | null {
        const id = researchId.toLowerCase();
        return this.index.trees.find(t => t.research?.id === id) || null;
    }

    /** Link a tree to a research (or drop the link with `undefined`). */
    setResearchLink(treeId: TreeId, link: ResearchLink | undefined): void {
        const tree = this.index.trees.find(t => t.id === treeId);
        if (!tree) return;
        if (link) tree.research = { ...link, id: link.id.toLowerCase() };
        else delete tree.research;
        this.saveIndex();
    }
}

/** Raise the app-wide "saving failed" signal (toast in main.ts). */
function dispatchSaveFailed(treeId: TreeId | null, err: unknown): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('strom:save-failed', {
        detail: { treeId, reason: err instanceof Error ? err.message : String(err) },
    }));
}

// Export singleton instance
export const TreeManager = new TreeManagerClass();
