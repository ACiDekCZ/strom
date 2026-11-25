/**
 * TreeManager - Manages multiple family trees in the application
 * Handles tree CRUD operations and storage via IndexedDB
 */

import {
    TreeId,
    TreeMetadata,
    ResearchLink,
    ResearchBase,
    ResearchEdgeMode,
    TreeIndex,
    StromData,
    PersonId,
    PartnershipId,
    Person,
    Partnership,
    
    LastFocusedMarker,
} from './types.js';
import { generateTreeId, uniqueIdSuffix } from './ids.js';
import { LAST_FOCUSED } from './model-values.js';
import { STROM_DATA_VERSION } from './version.js';
import { strings } from './strings.js';
import { isEncrypted, EncryptedData, CryptoSession, decrypt, classifyCryptoError, CryptoFailure } from './crypto.js';
import { SettingsManager } from './settings.js';
import { peekReloadPoint, forgetLastView } from './resume-view.js';
import { AuditLogManager } from './audit-log.js';
import { StorageManager } from './storage.js';
import { createSnapshot, listSnapshots, SnapshotResearchBase } from './snapshots.js';
import { researchAutoState, patchResearchAutoState, type ResearchAutoState } from './research-device.js';
import { researchBaseKey, isHistoryKey } from './storage-keys.js';
import { deleteHistoryStore } from './history-store.js';
import { deleteQualityBridgeRecord } from './quality-bridge.js';
import { deleteSurnamesBridgeRecord } from './surname-suggest-bridge.js';
import { VIEW_LINK_KEY_PREFIXES, forgetViewLinks } from './view-links.js';
import { unknownSexFromTie, fingerprintLike, normalizeResearchId } from './research-link.js';
import { unknownSexInResearchCopies, loadResearchCopy, rebaseResearchCopies } from './research-copy.js';
import { joinQualityOnlySources, qualityOnlySources } from './citation-quality.js';
import { cleanEventShares } from './shared-events.js';
import { convertLegacyCensusEvents } from './events.js';
import { fillResearchConfirmedValues, hasUnvaluedResearchConfirmations } from './verify.js';
import { requestPersistentStorage } from './persistence.js';
import { newTieSendMode } from './research-sync.js';
import { isResearchOwner, researchCopyOrigin, planSharedTieRepair, researchOriginalOf, transferResearchTie } from './research-owner.js';
import { importOriginOf } from './tree-row.js';
import { asciiSlug } from './filenames.js';
import { browserMediaFingerprint } from './browser-media.js';
import { looksLikeSampleTree } from './demo-sample.js';
import { announceTreeSaved, clearTreeStale, isTreeStale } from './tab-sync.js';
import { cloneTreeDataAsJson, estimateJsonBytes } from './clone.js';
import { imageLoads, type PendingImageNotes } from './image-loads.js';
import {
    withPoolLock, poolImages, stringifyPooled, replacePooled,
    unpoolJson, registerPoolReferences, forgetPoolScope, notePoolSizes,
    packImageMeta, unpackImageMeta,
} from './media-pool.js';
import { treeImages, settleStoredImages, imagesInterned, pooledImageChars } from './image-intern.js';
import { POOL_REF } from './image-ref.js';
import type { ImageMetaRecord } from './image-meta.js';

/** People in a tree, without the "?" stand-ins (as the focus bar counts them). */
function realPersonCount(data: StromData): number {
    return Object.values(data.persons ?? {}).filter(p => p && !p.isPlaceholder).length;
}

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

/**
 * localStorage key prefix of a tree state rescued when the page was left
 * before its save landed: `<prefix><tree id>@<window>` — one per window, so
 * another window's save never drops it (N60-1); beta.58–60 wrote `<prefix><tree id>`.
 */
export const RESCUE_PREFIX = 'strom-save-rescue:';
/** This window's part of its rescue keys. */
const RESCUE_WINDOW = uniqueIdSuffix();
/** Larger states are not rescued: localStorage holds about 5 million characters per origin. */
const RESCUE_MAX_CHARS = 4_000_000;

interface RescuedSave {
    /** When the page was left (ms). */
    at: number;
    base: ResearchBase | null;
    data: StromData;
}

/** This window's rescue key of a tree. */
function rescueKey(id: TreeId): string {
    return `${RESCUE_PREFIX}${id}@${RESCUE_WINDOW}`;
}

/** The tree a rescue key is of. */
function rescueTree(key: string): TreeId {
    const rest = key.slice(RESCUE_PREFIX.length);
    const at = rest.lastIndexOf('@');
    return (at > 0 ? rest.slice(0, at) : rest) as TreeId;
}

function forgetRescueKey(key: string): void {
    try { localStorage.removeItem(key); } catch { /* no storage */ }
}

/** Every rescue key in localStorage (of every window). */
function rescueKeys(): string[] {
    const keys: string[] = [];
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith(RESCUE_PREFIX)) keys.push(key);
        }
    } catch { /* no storage */ }
    return keys;
}

/** A deleted tree: the rescue copies of every window go with it. */
function forgetRescues(id: TreeId): void {
    for (const key of rescueKeys()) if (rescueTree(key) === id) forgetRescueKey(key);
}

/** Separator between the readable slug and the id suffix in `?tree=`. A
 * slug never contains two hyphens in a row (asciiSlug collapses them). */
const SLUG_ID_SEPARATOR = '--';

/** Current tree index version */
const TREE_INDEX_VERSION = 1;

/** IDB key for the tree index inside 'trees' store */
const INDEX_KEY = '_index';

/** Per-tree research keys in localStorage (the tree's id follows the prefix); the view links too. */
const RESEARCH_TREE_KEYS = ['strom-research-auto:', 'strom-research-base-fp:', 'strom-research-written:', ...VIEW_LINK_KEY_PREFIXES];

/** Drop the research keys of trees no longer in the index (deleted before a delete removed them too). */
function forgetResearchKeysOfGoneTrees(ids: ReadonlySet<string>): void {
    try {
        const gone: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            const prefix = key ? RESEARCH_TREE_KEYS.find(p => key.startsWith(p)) : undefined;
            if (key && prefix && !ids.has(key.slice(prefix.length))) gone.push(key);
        }
        for (const key of gone) localStorage.removeItem(key);
    } catch { /* no storage */ }
}

/** A tree's data were stored with another research base than this window's link (see ResearchBase). */
export const RESEARCH_BASE_EVENT = 'strom:research-base-changed';

/**
 * Window event: the backup before a stored tree's data update could not be
 * written, so the tree was left as stored (updateStoredData); detail: { treeId }.
 */
export const UPDATE_BACKUP_FAILED_EVENT = 'strom:update-backup-failed';

/** The research base stored with a tree's data (store `researchBases`, key = tree id). */
interface StoredResearchBase extends ResearchBase {
    researchId: string;
    /** When it was stored (ms). */
    at: number;
}

function sameBase(a: ResearchBase | null, b: ResearchBase | null): boolean {
    return (a?.head ?? null) === (b?.head ?? null) && (a?.fingerprint ?? null) === (b?.fingerprint ?? null);
}

/**
 * A stored tree that has images: the tree with its images as references into
 * the image pool (plain), or the encrypted JSON of that; `media` lists the
 * pooled images it names (kept outside the encryption for the pool cleanup —
 * ids only, nothing of the content). A tree without images is stored as
 * before: StromData, or EncryptedData.
 */
interface PooledTreeRecord {
    pooled: 1;
    data?: StromData;
    encrypted?: EncryptedData;
    media: Record<string, number>;
    /** The images' catalog entries (image-meta.ts; encrypted with the data); filled in by image-meta-backfill.ts. */
    imageMeta?: ImageMetaRecord | EncryptedData;
}

function isPooledTree(raw: unknown): raw is PooledTreeRecord {
    return !!raw && typeof raw === 'object' && (raw as { pooled?: unknown }).pooled === 1;
}

/** The encrypted payload of a stored tree record, if it is encrypted. */
function encryptedPart(raw: unknown): EncryptedData | null {
    if (isPooledTree(raw)) return raw.encrypted && isEncrypted(raw.encrypted) ? raw.encrypted : null;
    return isEncrypted(raw) ? raw as EncryptedData : null;
}

/**
 * Convert string to URL-friendly slug
 * "Rodina Novák" → "rodina-novak"
 */
function slugify(text: string): string {
    return asciiSlug(text);
}

/**
 * Whether a tree an older app stored is updated to this data version when it
 * is read (TreeManagerClass.updateStoredData: a backup, then saved once): a
 * tree of 3.26 with sources made only for another QUAY (v19), and from v20
 * on every tree with persons (shared events, spec 085: the backup is taken
 * even though nothing is joined, as the data version changes). An empty tree
 * needs nothing. Such a tree is never stored updated without that backup:
 * when it cannot be written, the read leaves the tree as stored, and so does
 * its first write here (takePreMigrationBackup).
 */
function needsDataUpdate(data: StromData, version: number): boolean {
    if (version < 19 && qualityOnlySources(data.sources).size > 0) return true;
    return version < 20 && Object.keys(data.persons ?? {}).length > 0;
}

class TreeManagerClass {
    private index: TreeIndex = {
        version: TREE_INDEX_VERSION,
        activeTreeId: null,
        trees: []
    };

    /**
     * A satellite window (spec 079, 097 K1.3) has no index of its own: the
     * main window's metadata of the tree it shows, as the agent's mirror
     * carries it (src/windows/agent-mirror.ts). Read only, never stored.
     */
    private windowMeta: TreeMetadata | null = null;

    private initialized = false;

    // ==================== INITIALIZATION ====================

    /**
     * Initialize the tree manager
     * - Loads existing tree index from IDB or creates new one
     */
    async init(): Promise<void> {
        if (this.initialized) return;
        this.watchLeaving();

        // Try to load existing tree index from IDB
        const storedIndex = await StorageManager.get<TreeIndex>('trees', INDEX_KEY);
        if (storedIndex) {
            this.index = storedIndex;
            this.initialized = true;
            // Self-heal: an earlier bug could persist a hidden ACTIVE tree.
            this.ensureActiveVisible();
            // Before anything can send: no two trees of this browser write to one research.
            await this.repairSharedResearchTies();
            forgetResearchKeysOfGoneTrees(new Set(storedIndex.trees.map(t => t.id)));
            this.restoreRescuedSaves();
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
        // A new index never held trees sharing one research (repairSharedResearchTies).
        this.index.researchTiesRepaired = new Date().toISOString();

        // Save the index
        this.saveIndex();
        this.initialized = true;
    }

    /** Rescue saves still under way when the page goes away (see rescueUnsettledSaves). */
    private watchLeaving(): void {
        if (typeof window === 'undefined' || typeof document === 'undefined') return;
        window.addEventListener('pagehide', () => this.rescueUnsettledSaves());
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') this.rescueUnsettledSaves();
        });
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
     * Note the images of the research's version the stored tree still lacks
     * (spec 116, I1); none or empty: the note goes. The index is stored only
     * when the note changed.
     */
    setPendingImages(id: TreeId, notes: PendingImageNotes | null): void {
        const tree = this.index.trees.find(t => t.id === id);
        if (!tree) return;
        const next = notes && Object.keys(notes).length ? notes : undefined;
        if (JSON.stringify(tree.pendingImages ?? null) === JSON.stringify(next ?? null)) return;
        if (next) tree.pendingImages = next;
        else delete tree.pendingImages;
        this.saveIndex();
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
    /** Are automatic backups on for this tree (default yes)? */
    isAutoBackupEnabled(id: TreeId): boolean {
        return this.index.trees.find(t => t.id === id)?.autoBackups !== false;
    }

    setAutoBackups(id: TreeId, enabled: boolean): void {
        const tree = this.index.trees.find(t => t.id === id);
        if (!tree) return;
        if (enabled) delete tree.autoBackups;
        else tree.autoBackups = false;
        this.saveIndex();
    }

    /** How much of the research edge the tree shows (default: all). */
    getResearchEdgeMode(id: TreeId): ResearchEdgeMode {
        const mode = this.index.trees.find(t => t.id === id)?.researchEdges;
        return mode === 'off' || mode === 'mine' ? mode : 'all';
    }

    setResearchEdgeMode(id: TreeId, mode: ResearchEdgeMode): void {
        const tree = this.index.trees.find(t => t.id === id);
        if (!tree) return;
        if (mode === 'all') delete tree.researchEdges;
        else tree.researchEdges = mode;
        this.saveIndex();
    }

    isResearchEdgeMotion(id: TreeId): boolean {
        return this.index.trees.find(t => t.id === id)?.researchEdgeMotion !== false;
    }

    setResearchEdgeMotion(id: TreeId, on: boolean): void {
        const tree = this.index.trees.find(t => t.id === id);
        if (!tree) return;
        if (on) delete tree.researchEdgeMotion;
        else tree.researchEdgeMotion = false;
        this.saveIndex();
    }

    /** The last choice of "Save as HTML" on a person page (spec 025), if any. */
    getPersonPageExport(id: TreeId): TreeMetadata['personPageExport'] {
        const tree = this.index.trees.find(t => t.id === id);
        return tree?.personPageExport ? structuredClone(tree.personPageExport) : undefined;
    }

    /** Remember the person page's "Save as HTML" choice for the tree. */
    setPersonPageExport(id: TreeId, value: NonNullable<TreeMetadata['personPageExport']>): void {
        const tree = this.index.trees.find(t => t.id === id);
        if (!tree) return;
        tree.personPageExport = { groups: { ...value.groups }, privacy: value.privacy, ...(value.toc === false ? { toc: false } : {}) };
        this.saveIndex();
    }

    /** Whether the "backups too big" advice still needs showing; marks it shown. */
    takeBackupsTooBigNotice(id: TreeId): boolean {
        const tree = this.index.trees.find(t => t.id === id);
        if (!tree || tree.backupsTooBigNoticed || tree.autoBackups === false) return false;
        tree.backupsTooBigNoticed = true;
        this.saveIndex();
        return true;
    }

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
        const researchId = this.index.trees[idx].research?.id;

        // Remove from the index FIRST: a save still queued for this tree
        // checks the index and skips, so it cannot resurrect the record after
        // the delete below (review S20). Then drain the tree's queue.
        this.index.trees.splice(idx, 1);
        this.unreadableTrees.delete(id);
        this.preMigrationStates.delete(id);
        await this.flush(id);
        forgetRescues(id);

        // Remove tree data from IDB
        await StorageManager.delete('trees', id);
        // The research base stored beside it goes with it.
        await StorageManager.delete('trees', researchBaseKey(id)).catch(() => undefined);
        // The research's events of the time (spec 020), unless another tree of the same research still shows them.
        if (researchId && !this.index.trees.some(t => t.research?.id === researchId)) {
            await deleteHistoryStore(researchId);
            await deleteQualityBridgeRecord(researchId);
            await deleteSurnamesBridgeRecord(researchId);
        }
        forgetPoolScope(id);

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
        await deleteBaselinesForTree(`research-base:${id}`).catch(() => {});
        try {
            localStorage.removeItem(`strom-research-base-fp:${id}`);
            localStorage.removeItem(`strom-research-written:${id}`);
            localStorage.removeItem(`strom-research-auto:${id}`);
        } catch { /* nothing kept */ }
        // What the tree showed linked in the view only (a device setting of the tree).
        forgetViewLinks(id);
        SettingsManager.forgetRecentSources(id);
        SettingsManager.forgetLifelineDefaults(id);
        // The view last used with the tree on this device (1101).
        forgetLastView(id);

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
            // The main window's title names the tree (spec 079).
            if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('strom:tree-renamed', { detail: { treeId: id } }));
        }
    }

    /**
     * Duplicate a tree
     */
    async duplicateTree(id: TreeId, newName: string): Promise<TreeId | null> {
        const sourceData = await this.getTreeData(id);
        if (!sourceData) return null;
        const source = this.index.trees.find(t => t.id === id);

        const newId = generateTreeId();
        const now = new Date().toISOString();
        const dataStr = JSON.stringify(sourceData);
        const sizeBytes = new Blob([dataStr]).size;

        const metadata: TreeMetadata = {
            id: newId,
            name: newName,
            createdAt: now,
            lastModifiedAt: now,
            personCount: realPersonCount(sourceData),
            partnershipCount: Object.keys(sourceData.partnerships).length,
            sizeBytes,
            // A newer app's tree stays one in its copy (read-only here too).
            dataVersion: sourceData.version ?? 1,
            // Every copy is a tree without research: one research, one tree (spec 139 K2.4, K5.1, K5.2). It
            // only names the tree it was copied from (a copy of a copy: that copy).
            ...(source ? { copyOf: { treeId: source.id, name: source.name } } : {}),
        };

        // Add to index, then save through the encrypting path — a direct
        // StorageManager.set wrote PLAINTEXT while encryption was on (V4).
        this.index.trees.push(metadata);
        this.saveIndex();
        this.saveTreeData(newId, sourceData, { asStored: true });

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
        const result = await this.readTreeRecord(id);
        // A count kept by an older version (the "?" stand-ins counted too) is put right when the tree is read.
        if (result.status === 'ok') {
            const tree = this.index.trees.find(t => t.id === id);
            // The version the record was saved with: a newer app's tree is
            // never written here, not even by a migration on reading.
            const version = result.data.version ?? 1;
            let changed = false;
            if (tree && tree.dataVersion !== version) {
                tree.dataVersion = version;
                changed = true;
            }
            if (tree?.research && 'sexU' in tree.research && !this.isTreeNewer(id)) result.data = await this.dropLegacySexU(id, tree, result.data);
            if (!this.isTreeNewer(id) && hasUnvaluedResearchConfirmations(result.data)) await this.valueResearchConfirmations(id, result.data);
            if (!this.isTreeNewer(id) && version < STROM_DATA_VERSION && needsDataUpdate(result.data, version)) {
                result.data = await this.updateStoredData(id, tree, result.data, version);
            } else {
                this.notePreMigrationState(id, result.data, version);
            }
            const count = realPersonCount(result.data);
            if (tree && tree.personCount !== count) {
                tree.personCount = count;
                changed = true;
            }
            // Its pictures and files only the browser keeps (a tree saved before this was counted is learnt here).
            const mediaFp = browserMediaFingerprint(result.data);
            if (tree && tree.mediaFp !== mediaFp) {
                tree.mediaFp = mediaFp;
                changed = true;
            }
            if (changed) this.saveIndex();
        }
        return result;
    }

    /**
     * A tree linked to a research that an index saved before spec 108 knows
     * no fingerprint of its pictures and files for (mediaFp) learns it from
     * its stored record, so the "only in browser" indicator judges a tree not
     * open yet by what it has. Only reads: no migration, no save of the tree.
     * The open tree is left out (its fingerprint comes from memory), and so is
     * one that cannot be read now (locked): it stays unknown until it opens.
     * Returns how many trees learnt one while it read them (by this read or
     * another one of the same tree).
     */
    async learnMediaFingerprints(): Promise<number> {
        const unknown = this.index.trees.filter(t => t.research && t.mediaFp === undefined && t.id !== this.index.activeTreeId);
        let learnt = 0;
        for (const tree of unknown) {
            // A read that fails here marks nothing: the tree is judged unreadable only when it is opened.
            const wasUnreadable = this.unreadableTrees.has(tree.id);
            const result = await this.readTreeRecord(tree.id).catch(() => null);
            if (result?.status !== 'ok') {
                if (!wasUnreadable) this.unreadableTrees.delete(tree.id);
                continue;
            }
            // Another read of the tree meanwhile (the cards' badges, the tree list) may have learnt it first:
            // it is known now either way, and the caller paints again.
            if (tree.mediaFp === undefined) tree.mediaFp = browserMediaFingerprint(result.data);
            learnt++;
        }
        if (learnt > 0) this.saveIndex();
        return learnt;
    }

    /**
     * The tree was saved by a newer app (its data version is above this
     * one's): it opens read-only and saveTreeData refuses to write it, so
     * nothing this version does not know is lost.
     */
    isTreeNewer(id: TreeId): boolean {
        const version = this.index.trees.find(t => t.id === id)?.dataVersion;
        return version !== undefined && version > STROM_DATA_VERSION;
    }

    /**
     * Data version 12: the research's unknown sex a tie of an older app named
     * (ResearchLink.sexU, sent as SEX U while the app's stand-in sex stayed)
     * becomes the person's sex 'unknown', and the map goes. A tree in step
     * with the research before stays in step (its fingerprint follows). The
     * kept copies of the research's version change the same way (N30).
     */
    private async dropLegacySexU(id: TreeId, tree: TreeMetadata, data: StromData): Promise<StromData> {
        const { sexU, ...link } = tree.research as ResearchLink & { sexU?: unknown };
        const next = unknownSexFromTie(data, sexU);
        if (next && link.fingerprint && link.fingerprint === fingerprintLike(data, link.fingerprint)) {
            link.fingerprint = fingerprintLike(next, link.fingerprint);
        }
        tree.research = link;
        // Kept: a backup from before turns Unknown the same way when it is restored (N31).
        if (sexU && typeof sexU === 'object') tree.legacySexU = { map: { ...tree.legacySexU?.map, ...sexU as Record<string, string> }, at: Date.now() };
        this.saveIndex();
        if (next) this.saveTreeData(id, next);
        // Before the tree is shown: its changes per person are read against the copy.
        await unknownSexInResearchCopies(id, sexU);
        return next ?? data;
    }

    /**
     * A tree an older app stored that is read here as it was (no update on
     * reading, see needsDataUpdate, or one left for want of its backup, see
     * updateStoredData) still changes when this window first
     * writes it: the data are moved over in memory (data v24: attachments
     * become records of the tree's files) and the first save stamps this
     * version. The state as stored is kept until then, and that first write
     * takes the backup "Before the data update of a new version" from it
     * (takePreMigrationBackup) — once per tree and data version, as the
     * stored version is this one afterwards; a tree only opened is not
     * backed up. An empty tree needs nothing. Any later version step works
     * the same, the encrypted profile too (the backup is encrypted).
     */
    private notePreMigrationState(id: TreeId, data: StromData, version: number): void {
        if (this.isTreeNewer(id) || version >= STROM_DATA_VERSION || Object.keys(data.persons ?? {}).length === 0) {
            this.preMigrationStates.delete(id);
            return;
        }
        // The copy shares its strings (photos, scans) with the read data: cheap even for a large tree.
        this.preMigrationStates.set(id, {
            data: cloneTreeDataAsJson(data), version,
            base: this.backupResearchBase(id, this.researchBaseOf(id)),
        });
    }

    /**
     * The first write of a newer data version over a tree kept by
     * notePreMigrationState: its backup first. A tree its read would have
     * updated (needsDataUpdate: kept so because that backup failed then) is
     * not written without the backup either: the write fails (the "saving
     * failed" notice), the state stays kept and the next write tries the
     * backup again. Any other tree is written as before, its backup best-effort.
     */
    private async takePreMigrationBackup(id: TreeId, writing: StromData): Promise<void> {
        const kept = this.preMigrationStates.get(id);
        if (!kept || (writing.version ?? 1) <= kept.version) return;
        this.preMigrationStates.delete(id);
        try {
            await createSnapshot(id, kept.data, 'pre-migration', Date.now(), kept.base);
        } catch (err) {
            console.warn('The backup before the data update could not be written', err);
            if (!needsDataUpdate(kept.data, kept.version)) return;
            if (!this.preMigrationStates.has(id)) this.preMigrationStates.set(id, kept);
            throw err;
        }
    }

    /**
     * A tree stored by an older app is brought to this data version once,
     * with a backup of the tree as it was taken first ("Before the data
     * update of a new version"); the tree is saved so, which stamps the
     * version (no second backup on the next read).
     * - v19 (spec 077 K1.5): the sources an import of 3.26 made only for a
     *   citation of the same page with another QUAY join their entry again,
     *   the QUAY going to the citation (joinQualityOnlySources);
     * - v20 (spec 085): shared events. Nothing is joined (the same residence
     *   at two persons stays two events, a godparent recorded by name stays
     *   so); only invalid shares and roles are cleaned (cleanEventShares).
     *   A person's custom event named only "Census" (how 3.27 and older read
     *   a `1 CENS`) becomes a census, everything written at it kept
     *   (convertLegacyCensusEvents), so the same file loaded again pairs.
     * A tree in step with the research before stays in step (its fingerprint
     * follows), and the kept copies of the research's version change the
     * same way.
     * Without the backup nothing is updated (Milan, 19 Nov 2026): when it
     * cannot be written (storage full, encryption on but locked) the data are
     * returned as read, nothing is saved (neither the tree nor the research's
     * fingerprints and copies), a notice says so (UPDATE_BACKUP_FAILED_EVENT)
     * and the next read tries again, backup first. Until then the tree is kept
     * as stored (notePreMigrationState), so its first write here takes that
     * backup too or is not written (takePreMigrationBackup). Automatic backups
     * turned off do not matter: this backup is taken all the same.
     */
    private async updateStoredData(id: TreeId, tree: TreeMetadata | undefined, data: StromData, version: number): Promise<StromData> {
        try {
            await createSnapshot(id, data, 'pre-migration', Date.now(), this.backupResearchBase(id, this.researchBaseOf(id)));
        } catch (err) {
            console.warn('The backup before the data update could not be written: the tree stays as stored', err);
            this.notePreMigrationState(id, data, version);
            dispatchUpdateBackupFailed(id);
            return data;
        }
        // Backed up: the save below is not backed up a second time.
        this.preMigrationStates.delete(id);
        const next = structuredClone(data);
        const joined = version < 19 ? joinQualityOnlySources(next) : 0;
        const censuses = version < 20 ? convertLegacyCensusEvents(next) : 0;
        const cleaned = cleanEventShares(next);
        const link = tree?.research;
        if (tree && link && joined + censuses + cleaned > 0) await rebaseResearchCopies(id, this.followJoinedFingerprints(id, tree, link, data, next));
        this.saveTreeData(id, next);
        return next;
    }

    /**
     * The fingerprints a tree in step with its research stands on follow its
     * data from `before` to `after` (data version 19): the base's (in step with
     * the version loaded) and a written send's (in step with what it wrote),
     * with what the research's state of that send keeps of it. Returned:
     * each fingerprint that followed, before → after, for the kept copies.
     * A fingerprint the data no longer had (edited since) stays.
     */
    private followJoinedFingerprints(id: TreeId, tree: TreeMetadata, link: ResearchLink, before: StromData, after: StromData): Map<string, string> {
        const moved = new Map<string, string>();
        const follow = (fp: string | undefined): void => {
            if (fp && !moved.has(fp) && fingerprintLike(before, fp) === fp) moved.set(fp, fingerprintLike(after, fp));
        };
        follow(link.fingerprint);
        const sent = link.sent;
        if (sent?.state === 'written') follow(sent.fingerprint);
        if (moved.size === 0) return moved;
        const next: ResearchLink = { ...link };
        if (link.fingerprint && moved.has(link.fingerprint)) next.fingerprint = moved.get(link.fingerprint)!;
        if (sent?.state === 'written' && moved.has(sent.fingerprint)) next.sent = { ...sent, fingerprint: moved.get(sent.fingerprint)! };
        tree.research = next;
        this.saveIndex();
        const st = researchAutoState(id);
        const patch: Partial<ResearchAutoState> = {};
        if (st.lastWritten?.fingerprint && moved.has(st.lastWritten.fingerprint)) patch.lastWritten = { ...st.lastWritten, fingerprint: moved.get(st.lastWritten.fingerprint)! };
        if (st.notWritten && moved.has(st.notWritten.fingerprint)) patch.notWritten = { ...st.notWritten, fingerprint: moved.get(st.notWritten.fingerprint)! };
        if (Object.keys(patch).length > 0) patchResearchAutoState(id, patch);
        return moved;
    }

    /**
     * The research's confirmations of a tree stored before each kept the
     * value it holds for (ResearchFactVerify.value): the value the fact has
     * in the kept copy of the research's version of the tree, else (no copy)
     * its current value — so a fact changed here since is no longer
     * confirmed, as with a tree loaded now. Once: the tree is saved so —
     * unless a newer state of it was handed to the queue while the copy was
     * read (that one is written; this read's values are filled again next
     * time).
     */
    private async valueResearchConfirmations(id: TreeId, data: StromData): Promise<void> {
        const writes = this.queuedWrites.get(id) ?? 0;
        const base = await loadResearchCopy(id);
        if (fillResearchConfirmedValues(data, base) && (this.queuedWrites.get(id) ?? 0) === writes) this.saveTreeData(id, data);
    }

    /**
     * A backup taken at `createdAt` (ms) restored into tree `id`: its data
     * with the guessed sexes of the tie it was taken under (before data
     * version 12) turned Unknown as the tree's were (N31), or null when no
     * person changes.
     */
    unknownSexOfOlderBackup(id: TreeId, data: StromData, createdAt: number | undefined): StromData | null {
        const kept = this.index.trees.find(t => t.id === id)?.legacySexU;
        if (!kept || createdAt === undefined || !(createdAt < kept.at)) return null;
        return unknownSexFromTie(data, kept.map);
    }

    private async readTreeRecord(id: TreeId): Promise<TreeReadResult> {
        // Ensure this tree's queued saves (and any other pending writes) have
        // landed before reading (review S20).
        await this.flush(id);
        return this.readStoredRecord(id);
    }

    /** readTreeRecord without waiting for the tree's queue (a step on that queue reads with it). */
    private async readStoredRecord(id: TreeId): Promise<TreeReadResult> {
        const raw = await StorageManager.get<StromData | EncryptedData | PooledTreeRecord>('trees', id);
        if (!raw) {
            this.unreadableTrees.delete(id);
            return { status: 'missing' };
        }

        if (isPooledTree(raw)) return this.readPooledTree(id, raw);

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

    /** readTreeData for a tree stored with its images in the pool. */
    private async readPooledTree(id: TreeId, raw: PooledTreeRecord): Promise<TreeReadResult> {
        let data: StromData;
        if (raw.encrypted) {
            if (!CryptoSession.isUnlocked()) {
                this.unreadableTrees.add(id);
                return { status: 'locked' };
            }
            try {
                data = JSON.parse(await CryptoSession.decrypt(raw.encrypted)) as StromData;
            } catch (err) {
                console.error('Failed to decrypt tree data:', id, err);
                this.unreadableTrees.add(id);
                return { status: 'undecryptable' };
            }
        } else {
            data = raw.data as StromData;
        }
        // The images stay references (spec 135, D6): the record's sizes and
        // catalog first — they make the references this browser's own for
        // the load sanitizer and answer sizes and fingerprints.
        notePoolSizes(raw.media);
        await unpackImageMeta(raw.imageMeta);
        const { missing } = await settleStoredImages(data);
        // Never expected (the cleanup keeps what a tree names); the rest of
        // the tree still loads, the load sanitiser drops the empty images.
        if (missing > 0) console.error('Tree images missing from the pool:', id, missing);
        this.unreadableTrees.delete(id);
        return { status: 'ok', data };
    }

    /**
     * Rescue a tree encrypted with a DIFFERENT key than the session (created
     * under another password before a password change, or imported): decrypt
     * it with that tree's own password and re-encrypt it with the session key,
     * so every tree shares one key afterwards and the tree reads and saves
     * normally again.
     * - 'ok': readable now (re-encrypted, or it already was readable);
     * - 'wrong-password': the password does not open this tree, nothing changed;
     * - 'unavailable' / 'error': no Web Crypto here (insecure address) or
     *   another failure (corrupt record) — not a password issue;
     * - 'locked': the session itself is locked — unlock it first;
     * - 'missing': no such record.
     */
    async recoverTreeWithPassword(id: TreeId, password: string): Promise<'ok' | CryptoFailure | 'locked' | 'missing'> {
        const current = await this.readTreeData(id);
        if (current.status === 'ok') return 'ok';
        if (current.status === 'missing') return 'missing';
        if (current.status === 'locked' || !CryptoSession.isUnlocked()) return 'locked';

        const raw = await StorageManager.get<unknown>('trees', id);
        if (isPooledTree(raw)) {
            if (!raw.encrypted) return 'missing';
            let pooled: StromData;
            try {
                const text = await decrypt(raw.encrypted, password);
                const out = await unpoolJson(text, enc => decrypt(enc, password));
                pooled = JSON.parse(out.json) as StromData;
            } catch (err) {
                // Only an AES-GCM refusal is a wrong password (GitHub #13).
                return classifyCryptoError(err);
            }
            // Re-saved under the session key: images get ids and encryption
            // of that key, the old ones go with the next pool cleanup.
            this.unreadableTrees.delete(id);
            this.saveTreeData(id, pooled, { asStored: true });
            await this.flush(id);
            return 'ok';
        }
        if (!isEncrypted(raw)) return 'missing';
        let plainText: string;
        let data: StromData;
        try {
            plainText = await decrypt(raw, password);
            data = JSON.parse(plainText) as StromData;
        } catch (err) {
            return classifyCryptoError(err);
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
        return encryptedPart(raw) !== null;
    }

    /**
     * Get raw encrypted data for password validation
     */
    async getEncryptedData(id: TreeId): Promise<EncryptedData | null> {
        const raw = await StorageManager.get<unknown>('trees', id);
        if (!raw) return null;
        return encryptedPart(raw);
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
    /** The newest state waiting to be written per tree (coalesced saves), with the research base it builds on. */
    private pendingSaves = new Map<TreeId, { data: StromData; base: ResearchBase | null }>();

    /** The newest state handed to the queue per tree until its write lands (see rescueUnsettledSaves). */
    private unsettledSaves = new Map<TreeId, { data: StromData; base: ResearchBase | null }>();
    /** The research base this window last read or wrote with each tree (researchBaseKnownMatches). */
    private storedBases = new Map<TreeId, ResearchBase & { researchId: string }>();

    /** A tree's state as an older app stored it, until its first write here (notePreMigrationState). */
    private preMigrationStates = new Map<TreeId, { data: StromData; version: number; base: SnapshotResearchBase | null }>();

    /** How many states were handed to the queue per tree (a read can tell a write made meanwhile). */
    private queuedWrites = new Map<TreeId, number>();
    /** Trees whose latest write failed, until one of theirs lands (saveTreeDataConfirmed). */
    private failedWrites = new Set<TreeId>();
    /** Trees whose failed write the caller reports itself (saveTreeDataConfirmed `quiet`). */
    private quietWrites = new Set<TreeId>();

    /** Rescue keys of closed windows this one stored at start, per tree, until that write lands. */
    private restoredRescues = new Map<TreeId, string>();

    /** A state of the tree handed to the queue has not landed yet. */
    hasUnsettledSave(id: TreeId): boolean {
        return this.unsettledSaves.has(id);
    }

    /** A write landed: when it carried the newest state, nothing of the tree waits any more. */
    private settle(id: TreeId, written: { data: StromData; base: ResearchBase | null }): void {
        if (this.unsettledSaves.get(id) !== written) return;
        this.unsettledSaves.delete(id);
        // Only this window's copy (and the one it stored at start): another window's (closed before its
        // save landed) waits for the next start.
        forgetRescueKey(rescueKey(id));
        const restored = this.restoredRescues.get(id);
        if (restored) {
            forgetRescueKey(restored);
            this.restoredRescues.delete(id);
        }
    }

    /**
     * The page is going away (pagehide, or hidden: a phone may end it without
     * another event) while a save has not landed: IndexedDB writes still under
     * way are dropped with the page, so an edit saved just before leaving
     * was lost. Each such tree's newest state goes to localStorage (written
     * at once) and the next start stores it (restoreRescuedSaves). Not for
     * encrypted trees (it would lie there in plain text) nor for a tree too
     * big for localStorage.
     */
    rescueUnsettledSaves(): void {
        if (this.unsettledSaves.size === 0 || SettingsManager.isEncryptionEnabled()) return;
        for (const [id, entry] of this.unsettledSaves) {
            try {
                const json = JSON.stringify({ at: Date.now(), base: entry.base, data: entry.data } satisfies RescuedSave);
                if (json.length > RESCUE_MAX_CHARS) continue;
                localStorage.setItem(rescueKey(id), json);
            } catch { /* no room or no storage: best effort */ }
        }
    }

    /**
     * Store the states rescued when a page was left before its save landed
     * (rescueUnsettledSaves): per tree the newest one, unless the tree is gone
     * or was stored again after it (another window, or the write landed after
     * all). Every other one goes to the backups, never lost unseen.
     */
    private restoreRescuedSaves(): void {
        const byTree = new Map<TreeId, { key: string; rescued: RescuedSave }[]>();
        for (const key of rescueKeys()) {
            const id = rescueTree(key);
            let rescued: RescuedSave | null = null;
            try { rescued = JSON.parse(localStorage.getItem(key) ?? 'null') as RescuedSave | null; } catch { /* unreadable */ }
            const tree = this.index.trees.find(t => t.id === id);
            if (!rescued?.data || !tree || SettingsManager.isEncryptionEnabled()) {
                forgetRescueKey(key);
                continue;
            }
            // Left by a newer app: waits for it (this version would drop what it does not know).
            if ((rescued.data.version ?? 1) > STROM_DATA_VERSION) continue;
            const list = byTree.get(id) ?? [];
            list.push({ key, rescued });
            byTree.set(id, list);
        }
        for (const [id, list] of byTree) {
            const tree = this.index.trees.find(t => t.id === id)!;
            const storedAt = Date.parse(tree.lastModifiedAt);
            list.sort((a, b) => a.rescued.at - b.rescued.at);
            const newest = list[list.length - 1];
            // A tree a newer app stored is never written over: its rescues go to the backups.
            const store = !this.isTreeNewer(id) && (newest.rescued.at >= storedAt || !Number.isFinite(storedAt)) ? newest : null;
            for (const item of list) if (item !== store) void this.backUpRescue(id, item.key, item.rescued);
            if (!store) continue;
            store.rescued.data.version = STROM_DATA_VERSION;
            // Its first write here may be the one that moves an older app's tree to this version (N1-b).
            this.noteStoredPreMigrationState(id);
            this.queueWrite(id, { data: store.rescued.data, base: store.rescued.base ?? null });
            // Its key goes once the write lands (settle).
            this.restoredRescues.set(id, store.key);
        }
    }

    /**
     * A rescued state goes over the tree as stored, which may still be an
     * older app's (the page was left while the first write here waited for
     * the backup before the data update): that stored state is kept as
     * notePreMigrationState keeps it, so the rescued write takes the backup
     * first (takePreMigrationBackup). Read on the tree's queue, ahead of the
     * rescued write. Not when a backup of it was taken already (the page
     * went away after the backup, before the write landed): never a second.
     */
    private noteStoredPreMigrationState(id: TreeId): void {
        const storedAt = Date.parse(this.index.trees.find(t => t.id === id)?.lastModifiedAt ?? '');
        const prev = this.saveQueues.get(id) ?? Promise.resolve();
        const step = prev.then(async () => {
            if (this.preMigrationStates.has(id)) return;
            const stored = await this.readStoredRecord(id);
            if (stored.status !== 'ok' || (stored.data.version ?? 1) >= STROM_DATA_VERSION) return;
            const backups = await listSnapshots(id);
            if (Number.isFinite(storedAt) && backups.some(m => m.reason === 'pre-migration' && m.createdAt >= storedAt)) return;
            this.notePreMigrationState(id, stored.data, stored.data.version ?? 1);
        }).catch((err) => {
            console.warn('The tree as stored could not be read for the backup before the data update', err);
        });
        this.saveQueues.set(id, step);
    }

    /**
     * A rescued state the tree was stored past (or another window's newer
     * one): kept as a backup at the time it was rescued (none when it is the
     * stored state anyway), then dropped.
     */
    private async backUpRescue(id: TreeId, key: string, rescued: RescuedSave): Promise<void> {
        try {
            const stored = await this.readTreeRecord(id);
            const same = stored.status === 'ok' && JSON.stringify({ ...stored.data, version: 0 }) === JSON.stringify({ ...rescued.data, version: 0 });
            if (!same) {
                rescued.data.version = STROM_DATA_VERSION;
                await createSnapshot(id, rescued.data, 'closed-tab', rescued.at, this.backupResearchBase(id, rescued.base ?? null));
            }
            forgetRescueKey(key);
        } catch (err) {
            // Kept for the next start.
            console.warn('The state rescued on leaving could not be kept as a backup', err);
        }
    }

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
    saveTreeData(id: TreeId, data: StromData, opts: { asStored?: boolean } = {}): void {
        // Never overwrite a tree we could not read: the in-memory copy is a
        // stand-in, not the family (review K8).
        if (this.unreadableTrees.has(id)) {
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('strom:save-blocked', { detail: { treeId: id } }));
            }
            return;
        }
        // A newer app saved this tree: this version would drop what it does
        // not know. Only the stored data themselves may be written again
        // (`asStored`: re-encrypted, duplicated), keeping their version.
        if (this.isTreeNewer(id) && !opts.asStored) {
            console.warn('Not saved: the tree was saved by a newer version of the app', id);
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('strom:save-newer', { detail: { treeId: id } }));
            }
            return;
        }
        // Another window saved this tree since this window read it: this
        // copy is older, and writing it would take back what that window
        // stored. Nothing is written until the tree is read again.
        if (isTreeStale(id)) {
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('strom:save-stale', { detail: { treeId: id } }));
            }
            return;
        }
        // Ensure version is set (data a newer app stored keep theirs)
        data.version = opts.asStored ? Math.max(data.version ?? 1, STROM_DATA_VERSION) : STROM_DATA_VERSION;
        // A tree with people is worth protecting from browser eviction.
        if (Object.keys(data.persons ?? {}).length > 0) void requestPersistentStorage();
        // Snapshot NOW: the caller keeps mutating the live object. The copy
        // shares strings (photos, scans) with the live data, so it is cheap
        // even for a tree carrying tens of MB of images.
        const snapshot = cloneTreeDataAsJson(data);
        // Images of a load still to come are not in the data stored (a field
        // keeps its older image, or has none): noted with the tree, the next
        // connect to the research asks for them (spec 116, I1).
        const load = imageLoads.current();
        if (load && load.treeId === id && !load.isAborted()) this.setPendingImages(id, load.notes(!SettingsManager.isEncryptionEnabled()));
        // The counts follow the data at once: the write lands later, and a
        // dialog opened meanwhile (deleting the tree) said "0 people".
        // Stored with the index when the write lands (updateMetadata).
        const tree = this.index.trees.find(t => t.id === id);
        if (tree) {
            tree.personCount = realPersonCount(snapshot);
            tree.partnershipCount = Object.keys(snapshot.partnerships ?? {}).length;
        }
        // The research base as this window has it NOW, with this very data.
        this.queueWrite(id, { data: snapshot, base: this.researchBaseOf(id) });
    }

    /**
     * Save a tree's data and wait until the write has landed (spec 134 K0.5):
     * true once stored, false when the save was refused (unreadable, newer,
     * stale tree) or its write failed. A failure raises strom:save-failed
     * as any save does, unless `quiet`: the caller says it itself (a merge's
     * new tree, P0 N2 - the general toast would speak of lost edits).
     */
    async saveTreeDataConfirmed(id: TreeId, data: StromData, opts: { quiet?: boolean } = {}): Promise<boolean> {
        const queued = this.queuedWrites.get(id) ?? 0;
        if (opts.quiet) this.quietWrites.add(id);
        try {
            this.saveTreeData(id, data);
            if ((this.queuedWrites.get(id) ?? 0) === queued) return false;
            await this.flush(id);
            return !this.failedWrites.has(id) && this.index.trees.some(t => t.id === id);
        } finally {
            if (opts.quiet) this.quietWrites.delete(id);
        }
    }

    /** Put a state on the tree's write queue (see saveTreeData). */
    private queueWrite(id: TreeId, entry: { data: StromData; base: ResearchBase | null }): void {
        this.queuedWrites.set(id, (this.queuedWrites.get(id) ?? 0) + 1);
        // Not stored until its write lands: a page left before that keeps it in a rescue copy (rescueUnsettledSaves).
        this.unsettledSaves.set(id, entry);
        // A write for this tree still waiting in the queue takes this newer
        // state instead of queueing another full copy: rapid edits used to
        // stack one whole serialized tree per edit (out of memory with big
        // image sets). Only the latest state matters, order is unchanged.
        const waiting = this.pendingSaves.has(id);
        this.pendingSaves.set(id, entry);
        if (waiting) return;

        const prev = this.saveQueues.get(id) ?? Promise.resolve();
        const next = prev.then(async () => {
            const pending = this.pendingSaves.get(id);
            this.pendingSaves.delete(id);
            if (!pending) return;
            this.failedWrites.delete(id);
            const latest = pending.data;
            // Deleted meanwhile: never resurrect the record (review S20).
            if (!this.index.trees.some(t => t.id === id)) {
                this.settle(id, pending);
                return;
            }
            await this.takePreMigrationBackup(id, latest);
            const images = treeImages(latest);
            if (images.urls.size > 0 || images.refIds.size > 0) {
                await this.writePooledTree(id, latest, images, pending.base);
            } else if (SettingsManager.isEncryptionEnabled()) {
                if (!CryptoSession.isUnlocked()) throw new Error('locked');
                const encrypted = await CryptoSession.encrypt(JSON.stringify(latest));
                const sizeBytes = new Blob([JSON.stringify(encrypted)]).size;
                await this.writeTreeRecord(id, encrypted, pending.base);
                this.updateMetadata(id, latest, sizeBytes);
            } else {
                const sizeBytes = estimateJsonBytes(latest);
                await this.writeTreeRecord(id, latest, pending.base);
                this.updateMetadata(id, latest, sizeBytes);
            }
            this.settle(id, pending);
            // Other tabs with this tree open must learn their copy is stale.
            announceTreeSaved(id);
        }).catch((err) => {
            // Surface instead of swallowing: quota/lock failures used to be
            // completely silent, leaving memory and disk divergent.
            console.error('saveTreeData failed', id, err);
            this.failedWrites.add(id);
            if (!this.quietWrites.has(id)) dispatchSaveFailed(id, err);
        });
        this.saveQueues.set(id, next);
    }

    /**
     * Write a tree with images: new images into the pool, the tree with
     * references to them. Under the pool lock, so a cleanup cannot remove an
     * image between finding it stored and this record naming it.
     */
    private writePooledTree(id: TreeId, data: StromData, images: ReturnType<typeof treeImages>, base: ResearchBase | null = null): Promise<void> {
        return withPoolLock(async () => {
            if (!this.index.trees.some(t => t.id === id)) return;
            const encrypted = SettingsManager.isEncryptionEnabled();
            if (encrypted && !CryptoSession.isUnlocked()) throw new Error('locked');
            const { ids, media, meta } = await poolImages(images.urls, images.refIds, encrypted, id);
            const imageMeta = await packImageMeta(meta, encrypted);
            let record: PooledTreeRecord;
            let sizeBytes: number;
            if (encrypted) {
                const enc = await CryptoSession.encrypt(stringifyPooled(data, ids));
                record = { pooled: 1, encrypted: enc, media };
                sizeBytes = JSON.stringify(enc).length + Object.values(media).reduce((a, b) => a + b, 0);
            } else {
                record = { pooled: 1, data: replacePooled(data, ids), media };
                sizeBytes = estimateJsonBytes(data) + pooledImageChars(data);
            }
            if (imageMeta) record.imageMeta = imageMeta;
            await this.writeTreeRecord(id, record, base);
            this.updateMetadata(id, data, sizeBytes);
            // Named by the record now: the tree's states in memory take the references (image-intern.ts).
            const interned = new Map<string, string>();
            for (const [value, poolId] of ids) interned.set(value, POOL_REF + poolId);
            imagesInterned(id, interned);
        });
    }

    /**
     * Store a tree record, and with a research link the base its data build
     * on — in one transaction, so the two are never stored apart (another
     * window saving its data while this one saves the index can otherwise
     * leave old data with a newer head).
     */
    private async writeTreeRecord(id: TreeId, record: unknown, base: ResearchBase | null): Promise<void> {
        const link = this.index.trees.find(t => t.id === id)?.research;
        if (!base || !link) {
            await StorageManager.set('trees', id, record);
            return;
        }
        const stored: StoredResearchBase = { researchId: link.id, head: base.head, fingerprint: base.fingerprint, at: Date.now() };
        if (typeof StorageManager.setTogether === 'function') {
            await StorageManager.setTogether([
                { store: 'trees', key: id, value: record },
                { store: 'trees', key: researchBaseKey(id), value: stored },
            ]);
        } else {
            await StorageManager.set('trees', id, record);
            await StorageManager.set('trees', researchBaseKey(id), stored);
        }
        this.storedBases.set(id, { researchId: link.id, head: base.head, fingerprint: base.fingerprint });
    }

    // ==================== RESEARCH BASE ====================

    /** The research base of a tree as this window's link has it, or null (no link). */
    researchBaseOf(id: TreeId): ResearchBase | null {
        const link = this.index.trees.find(t => t.id === id)?.research;
        return link ? { head: link.head ?? '', fingerprint: link.fingerprint ?? '' } : null;
    }

    /**
     * The research base a backup of a tree's data keeps (N61-3): `base` (what
     * the data build on) with the research's id, and the copy the research
     * took in on that head (`_STROM_SINCE`). Null for a tree not linked.
     */
    backupResearchBase(id: TreeId, base: ResearchBase | null): SnapshotResearchBase | null {
        const link = this.index.trees.find(t => t.id === id)?.research;
        if (!link || !base) return null;
        const lastCopy = researchAutoState(id).lastCopy;
        const since = lastCopy && lastCopy.base === base.head ? lastCopy.intake : undefined;
        return { id: link.id, head: base.head, fingerprint: base.fingerprint, ...(since ? { since } : {}) };
    }

    /**
     * The base a restored backup builds on: the one it kept, while the tree is
     * still linked to the same research; else null. Puts back the copy that
     * base was that one plus edits of, so the next send says the same.
     */
    restoredBackupBase(id: TreeId, kept: SnapshotResearchBase | undefined): ResearchBase | null {
        const link = this.index.trees.find(t => t.id === id)?.research;
        if (!link || !kept || kept.id !== link.id || !kept.head) return null;
        const lastCopy = researchAutoState(id).lastCopy;
        if (kept.since) patchResearchAutoState(id, { lastCopy: { intake: kept.since, base: kept.head } });
        else if (lastCopy?.base === kept.head) patchResearchAutoState(id, { lastCopy: undefined });
        return { head: kept.head, fingerprint: kept.fingerprint };
    }

    /**
     * Put a tree's link back on the base its data build on: data restored by
     * undo / redo take their base with them. `null` = unknown (a backup that
     * kept none): no head (the research then takes each value that differs
     * from its own for a conflict) and no fingerprint (an update asks first).
     */
    restoreResearchBase(id: TreeId, base: ResearchBase | null): void {
        const link = this.index.trees.find(t => t.id === id)?.research;
        if (!link) return;
        const next = base ?? { head: '', fingerprint: '' };
        if (sameBase(this.researchBaseOf(id), next)) return;
        this.patchResearchLink(id, { head: next.head || undefined, fingerprint: next.fingerprint });
    }

    /**
     * The tree's data were just read into this window (opened, switched to,
     * reloaded): it is current again, and the base stored with those data
     * wins over this window's link when they differ — it is what they build
     * on. Only for data that are loaded, never for a read for an export.
     */
    async adoptStoredData(id: TreeId): Promise<void> {
        clearTreeStale(id);
        await this.reconcileResearchBase(id);
    }

    private async reconcileResearchBase(id: TreeId): Promise<void> {
        // This window's own writes land first: a migration on reading (data
        // version 19) stores the tree with the base its fingerprint followed
        // to, and the base stored before it must not take that back.
        await this.flush(id);
        const link = this.index.trees.find(t => t.id === id)?.research;
        if (!link) return;
        let stored: StoredResearchBase | null = null;
        try {
            stored = await StorageManager.get<StoredResearchBase>('trees', researchBaseKey(id));
        } catch { return; }
        if (!stored || stored.researchId !== link.id) return;
        const base = { head: stored.head ?? '', fingerprint: stored.fingerprint ?? '' };
        this.storedBases.set(id, { researchId: stored.researchId, ...base });
        if (sameBase(this.researchBaseOf(id), base)) return;
        console.warn('The research base stored with the tree differs from its link: taking the stored one', id);
        this.patchResearchLink(id, { head: base.head || undefined, fingerprint: base.fingerprint });
    }

    /**
     * At once, without reading (leaving the page, audit 017 a-D1): the base
     * this window last knew stored with the tree — the one its queued write
     * stores, else the one read or written last — is the link's. False: the
     * two drifted apart (a stored base taken over the window's while its own
     * write was still on its way), and what this window holds must not go
     * to the research. True when nothing is known.
     */
    researchBaseKnownMatches(id: TreeId): boolean {
        const link = this.index.trees.find(t => t.id === id)?.research;
        if (!link) return true;
        const queued = this.unsettledSaves.get(id)?.base;
        const known = queued ? { researchId: link.id, ...queued } : this.storedBases.get(id);
        if (!known || known.researchId !== link.id) return true;
        return sameBase(this.researchBaseOf(id), known);
    }

    /**
     * Before sending: the data stored for this tree still build on this
     * window's base (true also when nothing says otherwise). False: another
     * window stored the tree since with another base — this window's data
     * are stale and must not go to the research.
     */
    async researchBaseMatches(id: TreeId): Promise<boolean> {
        await this.flush(id);
        const link = this.index.trees.find(t => t.id === id)?.research;
        if (!link) return true;
        let stored: StoredResearchBase | null = null;
        try {
            stored = await StorageManager.get<StoredResearchBase>('trees', researchBaseKey(id));
        } catch { return true; }
        if (!stored || stored.researchId !== link.id) return true;
        return sameBase(this.researchBaseOf(id), { head: stored.head ?? '', fingerprint: stored.fingerprint ?? '' });
    }

    /** Update in-memory metadata after save */
    private updateMetadata(id: TreeId, data: StromData, sizeBytes: number): void {
        const tree = this.index.trees.find(t => t.id === id);
        if (tree) {
            tree.lastModifiedAt = new Date().toISOString();
            tree.dataVersion = data.version ?? STROM_DATA_VERSION;
            tree.personCount = realPersonCount(data);
            tree.partnershipCount = Object.keys(data.partnerships).length;
            tree.sizeBytes = sizeBytes;
            tree.mediaFp = browserMediaFingerprint(data);
            this.noteContents(tree, data);
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
     * Create a new tree from imported data (or from a selection of another
     * tree, `fromTree`); it never carries a research tie.
     */
    createTreeFromImport(data: StromData, name: string, fromFile = true, fromTree?: TreeMetadata['fromTree']): TreeId {
        // Set current version on import
        data.version = STROM_DATA_VERSION;

        const treeId = generateTreeId();
        const now = new Date().toISOString();
        // Measured without building the JSON: a tree with its photos is 100 MB
        // and more, and the text and its Blob are two more copies of them in
        // memory at once (a phone's tab, opening a research). The save that
        // follows sets the size as it is stored.
        const sizeBytes = estimateJsonBytes(data);
        const mediaFp = browserMediaFingerprint(data);

        const metadata: TreeMetadata = {
            id: treeId,
            name,
            createdAt: now,
            lastModifiedAt: now,
            personCount: realPersonCount(data),
            partnershipCount: Object.keys(data.partnerships).length,
            sizeBytes,
            mediaFp,
            // The file it came from is a copy (a split-off part is not).
            ...(fromFile ? { fileCopyAt: now, fileCopyMediaFp: mediaFp } : {}),
            // Made of a selection of another tree: names it, never takes its research (spec 139 K2.4).
            ...(fromTree ? { fromTree: { ...fromTree } } : {}),
        };
        // The file it came from and its merges, for the Manage trees row (spec 139 §7.2).
        if (fromFile) this.noteContents(metadata, data);
        else if (data.merges?.length) metadata.mergeCount = data.merges.length;

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
     * A tree split off another (Split into families, Separate unconnected
     * parts; spec 139 §11.1): it names the tree it came from and the part
     * (fromTree) and never carries a research tie.
     */
    createTreeFromPart(sourceId: TreeId | null, data: StromData, name: string, what: string = name): TreeId {
        const source = sourceId ? this.getTreeMetadata(sourceId) : undefined;
        return this.createTreeFromImport(data, name, false, sourceId && source ? { treeId: sourceId, name: source.name, what } : undefined);
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
        return this.index.trees.find(t => t.id === id) || (this.windowMeta?.id === id ? this.windowMeta : null);
    }

    /** The main window's metadata of the tree a satellite shows (null: none); never stored, never in the list of trees. */
    setWindowTreeMetadata(meta: TreeMetadata | null): void {
        this.windowMeta = meta;
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
     * The tree a start URL names. `?research=<uuid>` (the macOS widget) wins:
     * the tree updated from that research, else its newest copy; with none
     * (or not a UUID) `?tree=` decides as before.
     */
    getTreeFromUrl(params: URLSearchParams): TreeMetadata | null {
        const researchId = normalizeResearchId(params.get('research'));
        if (researchId) {
            const tree = this.findTreeByResearchId(researchId)
                ?? this.findTreesByResearchId(researchId)
                    .sort((a, b) => (b.research?.syncedAt ?? '').localeCompare(a.research?.syncedAt ?? ''))[0];
            if (tree) return tree;
        }
        const treeSlug = params.get('tree');
        return treeSlug ? this.getTreeBySlug(treeSlug) : null;
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
        // A reload of the page keeps the tree it showed (1101); an address
        // with ?tree= picks it anyway (main.ts switches to it afterwards).
        const reloaded = peekReloadPoint()?.tree as TreeId | undefined;
        if (reloaded && this.isUsable(reloaded)) return reloaded;
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

    /** The view the tree opens in (1101): undefined = the family view, 'last' = the view last used here. */
    async setDefaultView(treeId: TreeId, value: 'last' | undefined): Promise<void> {
        const data = await this.getTreeData(treeId);
        if (!data) return;
        if (value === undefined) delete data.defaultView;
        else data.defaultView = value;
        this.saveTreeData(treeId, data);
    }

    async getDefaultView(treeId: TreeId): Promise<'last' | undefined> {
        const data = await this.getTreeData(treeId);
        return data?.defaultView;
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

    // ==================== FILE COPIES (src/file-copy.ts) ====================

    /**
     * The user edited the tree. Kept in memory until the save that follows
     * writes the index (updateMetadata); fires FILE_COPY_EVENT.
     */
    noteUserChange(treeId: TreeId): void {
        const tree = this.index.trees.find(t => t.id === treeId);
        if (!tree) return;
        tree.changedAt = new Date().toISOString();
        dispatchFileCopyEvent(treeId);
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('strom:user-change', { detail: { treeId } }));
    }

    /**
     * These trees were just written, whole, to a file (export, working file).
     * `written`: the data each file carried, so its pictures and files count
     * as copied only when it had them (an export without photos does not
     * copy them); without it they count as not known to be in the file.
     */
    noteFileCopy(treeIds: readonly TreeId[], written?: Readonly<Record<string, StromData | null | undefined>>): void {
        const now = new Date().toISOString();
        let any = false;
        for (const id of treeIds) {
            const tree = this.index.trees.find(t => t.id === id);
            if (!tree) continue;
            tree.fileCopyAt = now;
            const data = written?.[id];
            if (data) tree.fileCopyMediaFp = browserMediaFingerprint(data);
            else delete tree.fileCopyMediaFp;
            any = true;
        }
        if (!any) return;
        this.saveIndex();
        for (const id of treeIds) dispatchFileCopyEvent(id);
    }

    /** The user closed the "changes only in the browser" notice for this tree. */
    noteFileCopyNoticeClosed(treeId: TreeId): void {
        const tree = this.index.trees.find(t => t.id === treeId);
        if (!tree) return;
        tree.fileCopyNoticeClosedAt = new Date().toISOString();
        this.saveIndex();
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

    /** The tree that receives updates of the research with this UUID (not a copy), if any. */
    findTreeByResearchId(researchId: string): TreeMetadata | null {
        const id = researchId.toLowerCase();
        return this.index.trees.find(t => t.research?.id === id && !t.research.copy) || null;
    }

    /** Every tree tied to the research, copies included (only its owner writes to it: canSendToResearch). */
    findTreesByResearchId(researchId: string): TreeMetadata[] {
        const id = researchId.toLowerCase();
        return this.index.trees.filter(t => t.research?.id === id);
    }

    /**
     * The tree may write to its research (spec 139 K5.1): it owns the tie — a
     * copy, a second tree of the same research and the sample tree never do.
     */
    canSendToResearch(treeId: TreeId | null | undefined): boolean {
        // A satellite window has no index: the main window mirrors its tree's tie only when that tree owns it.
        if (treeId && this.windowMeta?.id === treeId && !this.index.trees.some(t => t.id === treeId)) {
            return isResearchOwner([this.windowMeta], treeId);
        }
        return isResearchOwner(this.index.trees, treeId);
    }

    /** A copy of a tree with a research: the name of the tree it was copied from (src/research-owner.ts). */
    researchCopyOrigin(treeId: TreeId): { name: string | null } | null {
        return researchCopyOrigin(this.index.trees, treeId);
    }

    /**
     * Link a tree to a research (or drop the link with `undefined`). The
     * user's settings for that research (how it takes their transcripts) stay
     * across updates from the same research; the state of a send does not.
     */
    setResearchLink(treeId: TreeId, link: ResearchLink | undefined, opts: { agentless?: boolean } = {}): void {
        const tree = this.index.trees.find(t => t.id === treeId);
        if (!tree) return;
        // The sample tree is never tied to a research (it would go there as a family tree).
        if (link && tree.demo) {
            console.warn('Not tying the sample tree to a research', treeId);
            return;
        }
        const before = this.researchBaseOf(treeId);
        if (link) {
            const id = link.id.toLowerCase();
            const prev = tree.research?.id === id ? tree.research : undefined;
            const kept: Partial<ResearchLink> = {};
            if (prev?.transcripts && link.transcripts === undefined) kept.transcripts = prev.transcripts;
            if (prev?.transcriptsAt && link.transcriptsAt === undefined) kept.transcriptsAt = prev.transcriptsAt;
            if (prev?.olderSources && link.olderSources === undefined) kept.olderSources = prev.olderSources;
            if (prev?.sentSources && link.sentSources === undefined) kept.sentSources = prev.sentSources;
            if (prev?.sendMode && link.sendMode === undefined) kept.sendMode = prev.sendMode;
            if (prev?.previewDue && link.previewDue === undefined) kept.previewDue = true;
            if (prev?.mergeHold && link.mergeHold === undefined) kept.mergeHold = prev.mergeHold;
            // A new tie sends by hand until the user chooses otherwise (a tie from before 3.9 keeps "by itself");
            // a new tie to an archive (or a research waiting for its agent: `agentless`) by itself.
            if (!prev && link.sendMode === undefined) kept.sendMode = newTieSendMode(link.mode === 'archive' || !!opts.agentless);
            if (prev?.sendMedia === false && link.sendMedia === undefined) kept.sendMedia = false;
            if (prev?.autoLoadImages === false && link.autoLoadImages === undefined) kept.autoLoadImages = false;
            if (prev?.titlesIn && link.titlesIn === undefined) kept.titlesIn = prev.titlesIn;
            if (prev?.deletedSources?.length && link.deletedSources === undefined) kept.deletedSources = prev.deletedSources;
            tree.research = { ...kept, ...link, id };
        } else delete tree.research;
        this.saveIndex();
        this.noteBaseChange(treeId, before);
    }

    /** The base changed: the tree's data must be stored again with it (the open tree's owner listens). */
    private noteBaseChange(treeId: TreeId, before: ResearchBase | null): void {
        if (sameBase(before, this.researchBaseOf(treeId)) || typeof window === 'undefined') return;
        window.dispatchEvent(new CustomEvent(RESEARCH_BASE_EVENT, { detail: { treeId } }));
    }

    /**
     * Make a tree a copy of `of` without research (spec 139 K5.1, K5.2): its
     * tie goes, `copyOf` names the tree it is a copy of. The tree's data stay.
     */
    detachAsCopy(treeId: TreeId, of: { treeId: TreeId; name: string }): void {
        const tree = this.index.trees.find(t => t.id === treeId);
        if (!tree) return;
        const before = this.researchBaseOf(treeId);
        delete tree.research;
        tree.copyOf = { treeId: of.treeId, name: of.name };
        this.saveIndex();
        this.noteBaseChange(treeId, before);
    }

    /** The tree whose research the copy `copyId` came from and that owns it now (research-owner.ts), or null. */
    researchOriginalOf(copyId: TreeId): TreeMetadata | null {
        return researchOriginalOf(this.index.trees, copyId);
    }

    /**
     * The copy `toId` takes over the research of `fromId` (spec 139 K5.5):
     * the original stays a tree without research, the copy is its owner and
     * no copy any more (research-owner.ts transferResearchTie). Nothing is
     * sent. False when nothing changed.
     */
    transferResearch(fromId: TreeId, toId: TreeId): boolean {
        const before = [this.researchBaseOf(fromId), this.researchBaseOf(toId)];
        if (!transferResearchTie(this.index.trees, fromId, toId)) return false;
        this.saveIndex();
        this.noteBaseChange(fromId, before[0]);
        this.noteBaseChange(toId, before[1]);
        return true;
    }

    /**
     * The one-time repair of trees that share one research (package 134
     * point 13; spec 139 K5.1): of every research tied to more than one tree
     * here only one tree keeps it (planSharedTieRepair); every other is taken
     * off it as a copy of that tree (detachAsCopy, its data untouched). Each
     * such tree is backed up first ("Before the data update of a new
     * version"); a tree whose data cannot be read now (encrypted and locked)
     * is not read: only its index entry changes. The tie it had is kept in
     * `researchDetached` (with what the one-time notice says). Runs once per
     * index (`researchTiesRepaired`); an index without the mark (an older
     * one brought back) is looked at again.
     */
    async repairSharedResearchTies(): Promise<void> {
        if (this.index.researchTiesRepaired) return;
        const plan = planSharedTieRepair(this.index.trees);
        const at = new Date().toISOString();
        for (const step of plan) {
            const tree = this.index.trees.find(t => t.id === step.treeId);
            const link = tree?.research;
            if (!tree || !link) continue;
            await this.backupBeforeTieRepair(tree.id);
            const keeper = { treeId: step.keeper.treeId as TreeId, name: step.keeper.name };
            this.detachAsCopy(tree.id, keeper);
            tree.researchDetached = {
                link, keeper, at,
                ...(step.sentAfterCopy ? { sentAfterCopy: step.sentAfterCopy } : {}),
            };
        }
        this.index.researchTiesRepaired = at;
        this.saveIndex();
    }

    /** The backup before the tie repair: best-effort, never reading a tree that cannot be read now. */
    private async backupBeforeTieRepair(id: TreeId): Promise<void> {
        try {
            const raw = await StorageManager.get<unknown>('trees', id);
            if (!raw || (encryptedPart(raw) && !CryptoSession.isUnlocked()) || this.isTreeNewer(id)) return;
            const read = await this.readStoredRecord(id);
            if (read.status !== 'ok' || Object.keys(read.data.persons ?? {}).length === 0) return;
            await createSnapshot(id, read.data, 'pre-migration', Date.now(), this.backupResearchBase(id, this.researchBaseOf(id)));
        } catch (err) {
            console.warn('The backup before taking a copy off its research could not be written', id, err);
        }
    }

    /** The one-time notice of a tree taken off a shared research was shown. */
    markResearchDetachedNoticed(treeId: TreeId): void {
        const tree = this.index.trees.find(t => t.id === treeId);
        if (!tree?.researchDetached || tree.researchDetached.noticed) return;
        tree.researchDetached.noticed = true;
        this.saveIndex();
    }

    /** Change part of a tree's research link (a send, its fate, the transcript setting); no-op without a link. */
    patchResearchLink(treeId: TreeId, patch: Partial<Omit<ResearchLink, 'id'>>): void {
        const tree = this.index.trees.find(t => t.id === treeId);
        if (!tree?.research) return;
        const before = this.researchBaseOf(treeId);
        const next: ResearchLink = { ...tree.research, ...patch };
        for (const [key, value] of Object.entries(patch)) {
            if (value === undefined) delete (next as unknown as Record<string, unknown>)[key];
        }
        tree.research = next;
        this.saveIndex();
        this.noteBaseChange(treeId, before);
    }

    /** Remember (or forget, null) the token of "Start research with this tree". */
    setResearchAdoptToken(treeId: TreeId, value: { token: string; at: string; install?: true } | null): void {
        const tree = this.index.trees.find(t => t.id === treeId);
        if (!tree) return;
        // The sample tree is never handed over to a research.
        if (value && tree.demo) return;
        if (value) tree.researchAdoptToken = value;
        else delete tree.researchAdoptToken;
        this.saveIndex();
    }

    /** The tree is the bundled sample tree (TreeMetadata.demo). */
    isDemoTree(treeId: TreeId | null | undefined): boolean {
        return !!treeId && this.index.trees.find(t => t.id === treeId)?.demo === true;
    }

    /**
     * Mark a tree as the sample tree: `data` given, only when it looks like
     * one (an older sample without the mark, demo-sample.ts) and has no
     * research tie (an older sample tied already keeps its tie).
     */
    markDemoTree(treeId: TreeId, data?: StromData): void {
        const tree = this.index.trees.find(t => t.id === treeId);
        if (!tree || tree.demo || (data && (tree.research || !looksLikeSampleTree(data)))) return;
        tree.demo = true;
        delete tree.researchAdoptToken;
        this.saveIndex();
    }

    /**
     * What the Manage trees row tells of a tree's data without reading it
     * (spec 139 §7.2, §9.2): the number of its merges, and the file it was
     * imported from when that is not known yet (an older tree, at its
     * opening). Saves the index only when something changed.
     */
    noteTreeContents(treeId: TreeId, data: StromData): void {
        const tree = this.index.trees.find(t => t.id === treeId);
        if (tree && this.noteContents(tree, data)) this.saveIndex();
    }

    /** The JSON file a tree was imported from (its data carries no record of it). */
    setImportedFrom(treeId: TreeId, file: string): void {
        const tree = this.index.trees.find(t => t.id === treeId);
        const name = file.trim();
        if (!tree || !name) return;
        tree.importedFrom = { file: name, kind: /\.(ged|gedcom)$/i.test(name) ? 'gedcom' : 'json' };
        this.saveIndex();
    }

    /** noteTreeContents on a metadata record; true when it changed. */
    private noteContents(tree: TreeMetadata, data: StromData): boolean {
        let changed = false;
        const merges = data.merges?.length ?? 0;
        if ((tree.mergeCount ?? 0) !== merges) {
            if (merges) tree.mergeCount = merges;
            else delete tree.mergeCount;
            changed = true;
        }
        // A tree made of another one (a selection, a split-off part) came from no file.
        if (!tree.importedFrom && !tree.fromTree) {
            const from = importOriginOf(data);
            if (from) { tree.importedFrom = from; changed = true; }
        }
        return changed;
    }

    /** Mark (or unmark) a tree as moving to another browser for the research. */
    setResearchTransfer(treeId: TreeId, value: { at: string; mobile?: true } | null): void {
        const tree = this.index.trees.find(t => t.id === treeId);
        if (!tree) return;
        if (value) tree.researchTransfer = value;
        else delete tree.researchTransfer;
        this.saveIndex();
    }

    /**
     * The tree waiting to be taken over with `token` (issued less than `maxAgeMs` ago, or
     * `installMaxAgeMs` for an installation's token), or null.
     */
    findTreeByAdoptToken(token: string, maxAgeMs: number, now = Date.now(), installMaxAgeMs = maxAgeMs): TreeMetadata | null {
        const tree = this.index.trees.find(t => t.researchAdoptToken?.token === token);
        const at = tree ? Date.parse(tree.researchAdoptToken!.at) : NaN;
        const max = tree?.researchAdoptToken?.install ? Math.max(maxAgeMs, installMaxAgeMs) : maxAgeMs;
        return tree && Number.isFinite(at) && now - at <= max ? tree : null;
    }
}

/** Raise the app-wide "saving failed" signal (toast in main.ts). */
function dispatchSaveFailed(treeId: TreeId | null, err: unknown): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('strom:save-failed', {
        detail: { treeId, reason: err instanceof Error ? err.message : String(err) },
    }));
}

/** Raise UPDATE_BACKUP_FAILED_EVENT (its notice in main.ts). */
function dispatchUpdateBackupFailed(treeId: TreeId): void {
    if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
    window.dispatchEvent(new CustomEvent(UPDATE_BACKUP_FAILED_EVENT, { detail: { treeId } }));
}

/** Window event: a tree's file-copy state changed; detail: { treeId }. */
export const FILE_COPY_EVENT = 'strom:file-copy';

function dispatchFileCopyEvent(treeId: TreeId): void {
    if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
    window.dispatchEvent(new CustomEvent(FILE_COPY_EVENT, { detail: { treeId } }));
}

// Export singleton instance
export const TreeManager = new TreeManagerClass();

// The pool keeps every image a stored tree names (every record in the store,
// not only the indexed ones: a record is never dropped from under its images).
registerPoolReferences('trees', async () => {
    const ids: string[] = [];
    for (const key of await StorageManager.keys('trees')) {
        if (key === INDEX_KEY || isHistoryKey(key)) continue;
        const raw = await StorageManager.get<unknown>('trees', key);
        if (isPooledTree(raw)) ids.push(...Object.keys(raw.media ?? {}));
    }
    return ids;
});

