/**
 * Strom - Type Definitions
 * Branded types for type-safe IDs and comprehensive interfaces
 */

// ==================== BRANDED TYPES ====================

/** Branded type for Person IDs - prevents mixing with other string IDs */
export type PersonId = string & { readonly __brand: 'PersonId' };

/** Branded type for Partnership IDs */
export type PartnershipId = string & { readonly __brand: 'PartnershipId' };

/** Helper to create a PersonId from string */
export function toPersonId(id: string): PersonId {
    return id as PersonId;
}

/** Helper to create a PartnershipId from string */
export function toPartnershipId(id: string): PartnershipId {
    return id as PartnershipId;
}

/** Generate unique PersonId */
export function generatePersonId(): PersonId {
    return `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` as PersonId;
}

/** Generate unique PartnershipId */
export function generatePartnershipId(): PartnershipId {
    return `u_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` as PartnershipId;
}

// ==================== CORE ENTITIES ====================

export type Gender = 'male' | 'female';

export type PartnershipStatus = 'married' | 'partners' | 'divorced' | 'separated';

export interface Person {
    id: PersonId;
    firstName: string;
    lastName: string;  // For women this is maiden name
    gender: Gender;
    isPlaceholder: boolean;
    partnerships: PartnershipId[];
    parentIds: PersonId[];
    childIds: PersonId[];
    // Extended info
    birthDate?: string;
    birthPlace?: string;
    deathDate?: string;
    deathPlace?: string;
}

export interface Partnership {
    id: PartnershipId;
    person1Id: PersonId;
    person2Id: PersonId;
    childIds: PersonId[];
    status: PartnershipStatus;
    // Extended info - labels depend on status:
    // married/divorced: "Datum sňatku" / "Datum rozvodu"
    // partners/separated: "Začátek vztahu" / "Konec vztahu"
    startDate?: string;
    startPlace?: string;
    endDate?: string;
    note?: string;
    // Primary partnership flag - when person has multiple partnerships,
    // this one is shown by default (unless viewing from child's perspective)
    isPrimary?: boolean;
}

// ==================== LAST FOCUSED MARKER ====================

/** Special marker value for "last focused" default setting */
export const LAST_FOCUSED = "__last_focused__" as const;
export type LastFocusedMarker = typeof LAST_FOCUSED;

/** Current StromData format version */
export const STROM_DATA_VERSION = 1;

export interface StromData {
    /** Data format version for migration support */
    version?: number;

    persons: Record<PersonId, Person>;
    partnerships: Record<PartnershipId, Partnership>;

    // Default person settings (exports with tree)
    defaultPersonId?: PersonId | LastFocusedMarker;  // undefined = first person, LAST_FOCUSED = where user left off, PersonId = specific

    // Last focused state (used when defaultPersonId === LAST_FOCUSED)
    lastFocusPersonId?: PersonId;
    lastFocusDepthUp?: number;
    lastFocusDepthDown?: number;
}

// ==================== UI TYPES ====================

export type RelationType = 'parent' | 'child' | 'partner' | 'sibling';

export interface RelationContext {
    personId: PersonId;
    relationType: RelationType;
}

export type PersonCreationType = 'new' | 'existing' | 'placeholder';

export interface NewPersonData {
    firstName: string;
    lastName: string;
    gender: Gender;
    birthDate?: string;
    birthPlace?: string;
    deathDate?: string;
    deathPlace?: string;
}

// ==================== RENDERING TYPES ====================

export interface Position {
    x: number;
    y: number;
}

export interface FamilyUnit {
    type: 'family';
    members: Person[];
}

export interface SingleUnit {
    type: 'single';
    person: Person;
}

export type LayoutUnit = FamilyUnit | SingleUnit;

// ==================== APP MODE ====================

/** Application mode - PWA on stromapp.info, embedded HTML file, or dev server */
export type AppMode = 'pwa' | 'embedded' | 'dev';

/** PWA hostname for mode detection */
export const PWA_HOSTNAME = 'stromapp.info';

// ==================== CONFIGURATION ====================

export interface LayoutConfig {
    cardWidth: number;
    cardHeight: number;
    horizontalGap: number;
    verticalGap: number;
    partnerGap: number;
    padding: number;
    minEdgeClearance: number;  // Min gap between non-related edge segments (px)
}

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
    cardWidth: 130,
    cardHeight: 65,
    horizontalGap: 15,
    verticalGap: 80,
    partnerGap: 12,
    padding: 50,
    minEdgeClearance: 14
};

// ==================== AUDIT LOG ====================

export const AUDIT_LOG_PREFIX = 'strom-audit-';

export type AuditAction =
    | 'person.create'
    | 'person.update'
    | 'person.delete'
    | 'partnership.create'
    | 'partnership.update'
    | 'partnership.delete'
    | 'parentChild.add'
    | 'parentChild.remove'
    | 'persons.merge'
    | 'data.clear'
    | 'data.load'
    | 'data.import'
    | 'data.repair';

export interface AuditEntry {
    /** ISO timestamp */
    t: string;
    /** Action type */
    a: AuditAction;
    /** Human-readable description */
    d: string;
}

export interface AuditLog {
    version: number;
    entries: AuditEntry[];
}

// ==================== STORAGE ====================

export const STORAGE_KEY = 'strom-data-v5';

// ==================== EMBEDDED DATA ENVELOPE ====================

/** Current app version for exports */
export const APP_VERSION = '1.0';

/** Envelope wrapping embedded data in exported HTML files */
export interface EmbeddedDataEnvelope {
    /** Unique export ID for deduplication */
    exportId: string;
    /** ISO timestamp when exported */
    exportedAt: string;
    /** App version that created the export */
    appVersion: string;
    /** Original tree name */
    treeName: string;
    /** Tree data (plain or encrypted) */
    data: StromData | EncryptedDataRef;
    /** Optional audit log */
    auditLog?: AuditLog;
}

/** Reference to encrypted data type (actual type in crypto.ts) */
export interface EncryptedDataRef {
    encrypted: true;
    salt: string;
    iv: string;
    data: string;
}

/** Generate unique export ID */
export function generateExportId(): string {
    return `exp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Check if object is an embedded data envelope */
export function isEmbeddedEnvelope(obj: unknown): obj is EmbeddedDataEnvelope {
    return obj !== null &&
        typeof obj === 'object' &&
        'exportId' in obj &&
        'data' in obj &&
        'appVersion' in obj;
}

// ==================== SETTINGS ====================

export const SETTINGS_KEY = 'strom-settings';

export type ThemeMode = 'light' | 'dark' | 'system';
export type LanguageSetting = 'en' | 'cs' | 'system';

export interface AppSettings {
    theme: ThemeMode;  // default: 'system'
    language: LanguageSetting;  // default: 'system'
    encryption: boolean;  // default: false - whether data encryption is enabled
    auditLog: boolean;  // default: false - whether audit log is enabled
}

// ==================== MULTI-TREE STORAGE ====================

/** Branded type for Tree IDs */
export type TreeId = string & { readonly __brand: 'TreeId' };

/** Helper to create a TreeId from string */
export function toTreeId(id: string): TreeId {
    return id as TreeId;
}

/** Generate unique TreeId */
export function generateTreeId(): TreeId {
    return `tree_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` as TreeId;
}

/** Metadata for a tree (lightweight, always in memory) */
export interface TreeMetadata {
    id: TreeId;
    name: string;
    createdAt: string;
    lastModifiedAt: string;
    personCount: number;
    partnershipCount: number;
    sizeBytes: number;
    /** Export ID from which this tree was imported (for deduplication) */
    sourceExportId?: string;
    /** Last export ID created from this tree */
    lastExportId?: string;
    /** Whether tree is hidden from switcher and cross-tree matching */
    isHidden?: boolean;
}

/** Index of all trees */
export interface TreeIndex {
    version: number;
    activeTreeId: TreeId | null;
    trees: TreeMetadata[];

    // Default tree settings (exports with "Export All")
    defaultTreeId?: TreeId | LastFocusedMarker;  // undefined = first tree, LAST_FOCUSED = where user left off, TreeId = specific
    lastTreeId?: TreeId;  // used when defaultTreeId === LAST_FOCUSED
}

/** Storage usage information */
export interface StorageInfo {
    used: number;
    total: number;
    trees: Array<{
        id: TreeId;
        name: string;
        size: number;
    }>;
}

/** Storage keys for multi-tree architecture */
export const TREE_INDEX_KEY = 'strom-trees-index';
export const TREE_DATA_PREFIX = 'strom-tree-';
