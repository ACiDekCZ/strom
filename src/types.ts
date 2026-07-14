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

/** Generate unique LifeEvent id */
export function generateLifeEventId(): string {
    return `ev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Generate unique Source id */
export function generateSourceId(): string {
    return `src_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Generate unique Attachment id */
export function generateAttachmentId(): string {
    return `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ==================== CORE ENTITIES ====================

export type Gender = 'male' | 'female';

export type PartnershipStatus = 'married' | 'partners' | 'divorced' | 'separated';

/** Kind of a parent→child relationship. Missing = 'biological' (no migration). */
export type ParentChildRelType = 'biological' | 'adoptive' | 'step' | 'foster';

/** Kinds of life event that can be recorded on a person. */
export type LifeEventType =
    | 'birth' | 'death' | 'baptism' | 'burial' | 'occupation'
    | 'residence' | 'military' | 'emigration' | 'immigration'
    | 'education' | 'custom';

/**
 * A single life event. birth/death are represented by the first-class
 * birthDate/deathDate fields and are not stored here (only synthesized read-only
 * in the UI); every other kind lives in Person.events.
 */
export interface LifeEvent {
    id: string;
    type: LifeEventType;
    /** Label for type === 'custom'. */
    customLabel?: string;
    /** Flex date (see src/dates.ts): [~|<|>]YYYY[-MM[-DD]]. */
    date?: string;
    place?: string;
    note?: string;
    /** Ids of Source entries (StromData.sources) citing this event. */
    sourceIds?: string[];
}

/**
 * A source/citation entry (parish register, archive, URL...). Sources are a
 * per-tree catalog (StromData.sources); persons and events reference them by id
 * via sourceIds, so one source can be cited many times.
 */
export interface Source {
    id: string;
    title: string;
    /** Archive / institution holding the source. */
    repository?: string;
    /** Signature / inventory number / page. */
    reference?: string;
    url?: string;
    note?: string;
}

/**
 * A document attached to a person (register scan, marriage certificate,
 * letter…). Images are compressed to a bounded JPEG; PDFs are kept as-is up to
 * a size cap. The payload lives inline so it travels with the single-file export.
 */
export interface Attachment {
    id: string;
    /** Original file name (UX). */
    name: string;
    mimeType: string;           // image/jpeg | image/png | application/pdf
    /** base64 data URL. */
    dataUrl: string;
    sizeBytes: number;
    note?: string;
    /** Optional link to a Source (StromData.sources). */
    sourceId?: string;
}

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
    notes?: string;
    isLocked?: boolean;
    /**
     * Explicit override of the "is this person alive?" heuristic used by the
     * living-privacy export filter. true = deceased, false = definitely alive,
     * undefined = fall back to the age heuristic.
     */
    isDeceased?: boolean;
    /** Compressed square JPEG portrait as a data URL (see src/photo.ts). */
    photo?: string;
    /** Original file name of the uploaded photo (UX only). */
    photoOriginalName?: string;
    /** Life events other than birth/death (see LifeEvent). */
    events?: LifeEvent[];
    /** Ids of Source entries (StromData.sources) citing this person. */
    sourceIds?: string[];
    /** Attached documents (scans, certificates, letters…). */
    attachments?: Attachment[];
    /**
     * Per-parent relationship type, keyed by parent PersonId. A missing entry
     * (or 'biological') is the default, so existing data needs no migration.
     */
    parentRelTypes?: Record<PersonId, ParentChildRelType>;
}

/**
 * One person in the family wizard: either a reference to an existing person
 * (link, no duplicate) or the fields to create a new one. Empty rows (no name,
 * no existingId) are ignored by the wizard.
 */
export interface FamilyWizardMember {
    existingId?: PersonId;
    firstName: string;
    lastName: string;
    gender: Gender;
    birthDate?: string;
}

/** A whole family added around an anchor person in one undo batch. */
export interface FamilyWizardSpec {
    anchorId: PersonId;
    father?: FamilyWizardMember;
    mother?: FamilyWizardMember;
    partner?: FamilyWizardMember & { weddingDate?: string };
    siblings: FamilyWizardMember[];
    children: FamilyWizardMember[];
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

/**
 * Current StromData format version.
 * v2 (2026-07): added optional Person.events (life events).
 * v3 (2026-07): added the per-tree source catalog (StromData.sources) and
 * citation ids (Person.sourceIds, LifeEvent.sourceIds).
 * v4 (2026-07): added Person.attachments (inline documents).
 * v5 (2026-07): added Person.parentRelTypes (adoptive/step/foster links).
 * All additive/backward-compatible for reading; the bump makes an older app
 * warn ("newer version") before it silently drops the new fields on re-save.
 */
export const STROM_DATA_VERSION = 5;

export interface StromData {
    /** Data format version for migration support */
    version?: number;

    persons: Record<PersonId, Person>;
    partnerships: Record<PartnershipId, Partnership>;

    /** Per-tree catalog of sources/citations, keyed by Source id. */
    sources?: Record<string, Source>;

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
    | 'data.repair'
    | 'event.add'
    | 'event.update'
    | 'event.remove'
    | 'source.add'
    | 'source.update'
    | 'source.remove'
    | 'source.cite'
    | 'source.uncite'
    | 'attachment.add'
    | 'attachment.remove'
    | 'attachment.update'
    | 'parentRel.update'
    | 'undo'
    | 'redo';

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

// ==================== EMBEDDED DATA ENVELOPE ====================

/**
 * Current app version, shown in the About dialog and stamped into exports.
 * Injected from package.json at build time (see scripts/bundle.js); the literal
 * fallback is used only for dev builds and tests where no define is set and
 * should be kept in sync with package.json.
 */
declare const __APP_VERSION__: string | undefined;
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.6.1';

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
    // ---- collaboration ("send to a relative") ----
    /** Personal message from the sender (plain text — MUST be escaped on display). */
    senderMessage?: string;
    /** Sender's display name (from settings). */
    senderName?: string;
    /** exportId of the ORIGINAL export this file replies to (lineage). */
    replyToExportId?: string;
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
    suggestDuplicates?: boolean;  // default: true - hint similar persons on entry
    minimap?: boolean;  // default: true - overview minimap for large trees
    zoomControls?: boolean;  // default: true - floating zoom buttons over the tree
    onThisDay?: boolean;  // default: true - daily "on this day" reminder
    senderName?: string;   // collaboration: name shown to relatives in shared files
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
    /** Whether tree is locked (all persons read-only) */
    isLocked?: boolean;
    /** Collaboration: exportId of the file this tree was saved from. */
    receivedExportId?: string;
    /** Collaboration: sender name of the file this tree was saved from. */
    receivedFrom?: string;
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

