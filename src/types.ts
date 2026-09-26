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

/** Generate unique EventParticipant id */
export function generateParticipantId(): string {
    return `pt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Generate unique Source id */
export function generateSourceId(): string {
    return `src_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Generate unique SourceExcerpt id */
export function generateExcerptId(): string {
    return `exc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
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
    | 'education' | 'religion' | 'custom'
    // Sacraments and rites of passage a register keeps its own book for.
    | 'confirmation' | 'firstCommunion' | 'barMitzvah' | 'batMitzvah' | 'ordination'
    // Legal acts.
    | 'adoption' | 'naturalization' | 'will' | 'probate'
    // What was written about the person rather than done by them.
    | 'title' | 'nationality'
    | 'cremation';

/**
 * A single life event. birth/death are represented by the first-class
 * birthDate/deathDate fields and are not stored here (only synthesized read-only
 * in the UI); every other kind lives in Person.events.
 */
/**
 * How someone took part in an event that is not their own.
 *
 * 'godparent' at a baptism and 'witness' at a wedding are the ones that matter
 * for parish registers: a godparent who keeps turning up at one family's
 * baptisms is almost always a relative, which is a lead that vanishes if the
 * name is buried in a free-text note.
 */
export type ParticipantRole = 'godparent' | 'witness' | 'officiant' | 'other';

/**
 * Someone present at an event besides its subject.
 *
 * Either `personId` (they are in the tree) or `name` (they are not) — and the
 * second case is the common one: a godparent is usually a neighbour nobody
 * wants as a person in their family tree. Forcing a link would make people
 * either invent persons or skip the record entirely.
 */
export interface EventParticipant {
    id: string;
    role: ParticipantRole;
    /** Linked person in the tree. */
    personId?: PersonId;
    /** Name as the register writes it, when they are not in the tree. */
    name?: string;
    /** What the record says about them ("soused, kovář"). */
    note?: string;
}

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
    /** Godparents, witnesses, the officiating priest… (see EventParticipant). */
    participants?: EventParticipant[];
}

/**
 * A cut-out of a scan showing the entry itself — one register row, a paragraph
 * of a certificate. The crop is stored as its own small image so it displays
 * without the full page and survives leaving attachments out of an export.
 */
export interface SourceExcerpt {
    id: string;
    /** The cropped image as a data URL (JPEG from the app, long side ≤ 1200 px). */
    dataUrl: string;
    width: number;
    height: number;
    sizeBytes: number;
    /** Person attachment (full page) the crop was cut from — enables re-cropping. */
    fromAttachmentId?: string;
    /** Where the crop lies in that attachment, fractions 0–1 from the top left. */
    region?: { x: number; y: number; w: number; h: number };
    /** Permalink to the page in the online archive's image viewer. */
    pageUrl?: string;
    caption?: string;
}

/** The UI offers at most this many excerpts per source (an entry across a page break). */
export const MAX_EXCERPTS_UI = 2;

/**
 * A source/citation entry. Sources are a per-tree catalog (StromData.sources);
 * persons, events and partnerships reference them by id via sourceIds, so one
 * source can be cited many times.
 *
 * The UI treats a source as ONE ENTRY (a baptism, a marriage record): the page,
 * the transcript and the excerpt belong to the entry, and every fact that entry
 * proves cites it. A whole register book as a source still works (older data).
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
    /**
     * GEDCOM QUAY 0–3 (unreliable … primary evidence). Preserved on import
     * (first citation wins, like `reference`) and re-exported on citations.
     */
    quality?: number;
    /** Verbatim transcript of the entry (GEDCOM SOUR.TEXT). */
    transcript?: string;
    /**
     * When the entry was written — a flex date (see src/dates.ts). Differs from
     * the event's date: a baptism is recorded days after the birth.
     * GEDCOM: citation DATA.DATE (entry recording date).
     */
    recordDate?: string;
    /** Crops of the entry from its scan (see SourceExcerpt). */
    excerpts?: SourceExcerpt[];
    /**
     * The record's id in the program it came from (GEDCOM SOUR.REFN), e.g. a
     * Strom Research "S0042". Keeps the entry's identity across re-imports.
     */
    refn?: string;
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
    /**
     * User reference number (GEDCOM REFN): the person's id in a paper archive
     * or another genealogy program. Free-form, never interpreted by the app.
     */
    refn?: string;
    /**
     * What kind of number `refn` is (GEDCOM REFN > TYPE) — typically which
     * program or archive issued it. Never shown; kept so a program that wrote
     * the number can recognise its own person when the tree comes back to it.
     */
    refnType?: string;
    /**
     * An open question about this person ("does anyone know when she was
     * born?"). Travels with shared/exported files so a relative can answer it.
     */
    question?: string;
    /**
     * Other written forms of this person's name: how the registers actually
     * spell it (Wischek / Víšek / Vissek), an alias, or the Czech "jméno po
     * chalupě" — the farm a family was known by, which on a village identified
     * people better than a surname did.
     *
     * Not typos to be corrected: before ~1900 spelling was not fixed, and what
     * the register wrote is a fact about the source. Kept so that search and
     * merge matching find the person under any of them — otherwise you search
     * the name you know, miss the one you faithfully copied from the register,
     * and add the same ancestor twice.
     */
    nameVariants?: string[];
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
    /** This person's chapter in the family book (GEDCOM _STORY on INDI). */
    story?: Story;
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

/**
 * A narrative about a person or a couple: the family-book text that comes
 * after the facts. It is prose built ON TOP of evidence, never evidence
 * itself — which is why it has its own home instead of being mixed into
 * notes, and why it carries the facts it leans on and the author's caveat.
 *
 * GEDCOM tools exchange it as the _STORY structure (see src/ged-parser.ts).
 */
export interface Story {
    /** _STORY TYPE — kind of text ('vypraveni'); reserved for future kinds. */
    kind?: string;
    /** Optional subheading of the chapter. */
    title?: string;
    /** Draft (STAT navrh) or approved (STAT hotovo). */
    status?: 'draft' | 'final';
    /**
     * The text. '\n' is a real line break and '\n\n' a paragraph — exactly
     * what CONT lines carry, so the text survives a round-trip unreformatted.
     * May contain markdown **bold**, which the book renders.
     */
    text: string;
    /** The facts the text leans on (DATA lines) — a checklist, not citations. */
    facts?: string[];
    /** The author's caveat, kept verbatim ("not a source, proves nothing"). */
    note?: string;
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
    /** Ids of Source entries citing this partnership (marriage record etc.). */
    sourceIds?: string[];
    /**
     * Witnesses at the wedding (see EventParticipant). A marriage entry names
     * them the way a baptism names godparents, and they are the same kind of
     * lead — the model has no union event to hang them on, so they live here.
     */
    participants?: EventParticipant[];
    /** The couple's chapter in the family book (GEDCOM _STORY on FAM). */
    story?: Story;
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
 * v6 (2026-08): added Partnership.participants (wedding witnesses) and
 *   Person.story / Partnership.story (narratives, GEDCOM _STORY).
 * v7 (2026-09): register entries on sources — Source.transcript / recordDate /
 *   excerpts / refn; Attachment.note / sourceId. An older app keeps them when
 *   it only reads, but its source editor would rebuild a source without them.
 * All additive/backward-compatible for reading; the bump makes an older app
 * warn ("newer version") before it silently drops the new fields on re-save.
 */
export const STROM_DATA_VERSION = 7;

/**
 * Coordinates of one place, kept in the tree's own file so a place is looked up
 * once and the map then works offline. Keyed by placeKey() (see src/places.ts),
 * so every spelling variant of a place shares one entry.
 */
export interface PlaceGeo {
    lat: number;
    lon: number;
    /** Full name as the geocoder understood it — lets the user check the hit. */
    label?: string;
}

export interface StromData {
    /** Data format version for migration support */
    version?: number;

    persons: Record<PersonId, Person>;
    partnerships: Record<PartnershipId, Partnership>;

    /** Per-tree catalog of sources/citations, keyed by Source id. */
    sources?: Record<string, Source>;

    // Default person settings (exports with tree)
    defaultPersonId?: PersonId | LastFocusedMarker;  // undefined = first person, LAST_FOCUSED = where user left off, PersonId = specific

    /** Coordinates for places, keyed by placeKey(). Filled in by geocoding (opt-in). */
    places?: Record<string, PlaceGeo>;

    /**
     * Surnames that mean the same family, written down once for the whole tree:
     * [['Víšek', 'Vyšek', 'Wischek']].
     *
     * A spelling is a fact about the NAME, not about one person — the same way a
     * place's coordinates belong to the place and not to whoever was born there.
     * Kept here so it is entered once and holds for everybody, including people
     * added later; on a person it would have to be repeated for every one of
     * thirty Víšeks, in both directions, and the thirty-first would miss out.
     *
     * A group is an equivalence, not "canonical + variants": nobody's spelling
     * is the wrong one, and the registers disagree in every direction.
     */
    surnameVariants?: string[][];

    // Last focused state (used when defaultPersonId === LAST_FOCUSED)
    lastFocusPersonId?: PersonId;
    lastFocusDepthUp?: number;
    lastFocusDepthDown?: number;
}

/**
 * How the tree is drawn. 'family' is the default focus-centric view; the others
 * are alternative readings of the SAME selection of people ('descendants'
 * chart, 'timeline' life-bars, 'fan' ancestor chart, 'map' of their places).
 */
export type ViewMode = 'family' | 'descendants' | 'timeline' | 'fan' | 'map';

/** Views drawn by something other than the layout pipeline (own containers). */
export const STANDALONE_VIEWS: readonly ViewMode[] = ['timeline', 'fan', 'map'];

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

/** Pre-release test site: the beta PWA on its own origin (own storage) */
export const BETA_HOSTNAME = 'beta.stromapp.info';

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

/**
 * How much a person card shows. The card SIZE differs per density, so the
 * layout engine must be told (CARD_SIZE) — spacing is computed from it.
 */
export type CardDensity = 'compact' | 'normal' | 'detailed';

/**
 * Card box per density. Keys match LayoutConfig on purpose so the values can be
 * spread straight into it — with `width`/`height` names the spread silently did
 * nothing and the engine kept spacing for the default card.
 * MUST match the CSS for .person-card at each density.
 */
export const CARD_SIZE: Record<CardDensity, Pick<LayoutConfig, 'cardWidth' | 'cardHeight'>> = {
    // "Letopis" card: a 38px avatar + a two-row text column (name + meta).
    // compact drops the avatar and meta (names only), so it is shorter and
    // narrower; detailed keeps the extra occupation/age lines, so it is taller.
    // MUST match the CSS for .person-card at each density.
    compact: { cardWidth: 150, cardHeight: 44 },
    normal: { cardWidth: 188, cardHeight: 64 },
    detailed: { cardWidth: 200, cardHeight: 100 },
};

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
    cardWidth: 188,
    cardHeight: 64,
    horizontalGap: 31,
    verticalGap: 80,
    // Kept comfortably above horizontalGap/2 (the overlap-check minGap): the
    // +16 horizontalGap bump for the 188px card pushed minGap to 15.5. Couples
    // sit partnerGap apart and V-fan ancestor trees lean to ~partnerGap-1.5 at
    // their inner leaves, so 18 keeps every partner/inner-leaf pair a real,
    // valid distance apart.
    partnerGap: 18,
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
    | 'tree.split'
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
    | 'place.clean'
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
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '3.2.0';

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
export type LanguageSetting = 'en' | 'cs' | 'de' | 'system';

export interface AppSettings {
    theme: ThemeMode;  // default: 'system'
    language: LanguageSetting;  // default: 'system'
    encryption: boolean;  // default: false - whether data encryption is enabled
    auditLog: boolean;  // default: false - whether audit log is enabled
    suggestDuplicates?: boolean;  // default: true - hint similar persons on entry
    minimap?: boolean;  // default: true - overview minimap for large trees
    genLabels?: boolean;  // default: true - sticky generation labels over the canvas
    zoomControls?: boolean;  // default: true - floating zoom buttons over the tree
    onThisDay?: boolean;  // default: true - daily "on this day" reminder
    branchColors?: boolean;  // default: true - colour cards by branch vs focus
    branchLegend?: boolean;  // default: false - show the branch-colour legend box
    deathAnniversaries?: boolean;  // default: false - include yearly death anniversaries
    onThisDayAllTrees?: boolean;   // default: false - "on this day" also from the other visible trees
    crossTreeBadges?: boolean;  // default: true - show cross-tree connection badges
    fanKekule?: boolean;  // default: false - show Kekule (ahnentafel) numbers in the fan chart
    cardDensity?: CardDensity;  // default: 'normal' - how much detail a card shows
    familyButton?: boolean;  // default: false - toolbar shortcut to the family wizard
    descendantsFullFamilies?: boolean;  // default: false - descendants view shows partners' other families
    advancedFields?: boolean;  // default: false (basic mode) - sources/attachments/refn/name variants/question on a person
    geocoding?: boolean;   // default: undefined (never asked) - user allowed sending place names to the geocoder
    mapTiles?: boolean;    // default: undefined (not seen) - user saw that map tiles come from openstreetmap.org
    senderName?: string;   // collaboration: name shown to relatives in shared files
    // Strom Research promotion (3.0) — per browser, never in tree data:
    researchNewFirstSeen?: string;   // ISO date the "New" marker was first shown
    researchNewDismissed?: boolean;  // the "New" marker went out for good
    whatsNew30Shown?: boolean;       // the one-time "What's new in 3.0" card was shown
    fileCopyReminders?: boolean;     // default: true - notice when edits are only in a storage the browser may clear
    importImages?: boolean;          // default: true - imports bring photos, attachments and source excerpts
    recentSourceIds?: Record<string, string[]>;  // per tree id: last cited sources, newest first (source picker)
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
    /**
     * The tree holds a research opened from Strom Research (GEDCOM header
     * `1 _STROM_TREE <uuid>`). Lets the next open of the same research update
     * this tree instead of creating a duplicate.
     */
    research?: ResearchLink;
    /**
     * Automatic backups (daily, before import / merge) for this tree. Missing =
     * on. Off for a tree the user keeps elsewhere, or whose scans make every
     * backup heavy; manual backups still work.
     */
    autoBackups?: boolean;
    /** The "backups too big for this device" advice was shown (it is shown once). */
    backupsTooBigNoticed?: boolean;
    /** Last edit of the user's (ISO). With fileCopyAt: edits no file holds (src/file-copy.ts). */
    changedAt?: string;
    /** Last full copy in a file: a full export, the working file, or the file it was imported from (ISO). */
    fileCopyAt?: string;
    /** The "changes only in the browser" notice was closed for this tree (ISO); it returns after the next file copy. */
    fileCopyNoticeClosedAt?: string;
}

/** Link between a local tree and the Strom Research tree it was opened from. */
export interface ResearchLink {
    /** The research tree's UUID (lower case). */
    id: string;
    /** Content fingerprint of the tree right after the last import/update. */
    fingerprint: string;
    /** ISO time of the last import/update. */
    syncedAt: string;
    /** Commit of the research at the last update (live bridge only). */
    head?: string;
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

