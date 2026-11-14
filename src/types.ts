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

let idSeq = 0;

/**
 * The end of a generated id: a counter of this page, then randomness. The
 * counter makes ids made within one millisecond unique (a GEDCOM import makes
 * thousands at once, and 5 random characters alone collided: a person lost);
 * the randomness keeps two windows apart.
 */
export function uniqueIdSuffix(): string {
    idSeq = (idSeq + 1) % 1679616;
    return `${idSeq.toString(36).padStart(4, '0')}${Math.random().toString(36).slice(2, 7)}`;
}

/** Generate unique PersonId */
export function generatePersonId(): PersonId {
    return `p_${Date.now()}_${uniqueIdSuffix()}` as PersonId;
}

/** Generate unique PartnershipId */
export function generatePartnershipId(): PartnershipId {
    return `u_${Date.now()}_${uniqueIdSuffix()}` as PartnershipId;
}

/** Generate unique LifeEvent id */
export function generateLifeEventId(): string {
    return `ev_${Date.now()}_${uniqueIdSuffix()}`;
}

/** Generate unique EventParticipant id */
export function generateParticipantId(): string {
    return `pt_${Date.now()}_${uniqueIdSuffix()}`;
}

/** Generate unique Source id */
export function generateSourceId(): string {
    return `src_${Date.now()}_${uniqueIdSuffix()}`;
}

/** Generate unique SourceExcerpt id */
export function generateExcerptId(): string {
    return `exc_${Date.now()}_${uniqueIdSuffix()}`;
}

/** Generate unique Attachment id */
export function generateAttachmentId(): string {
    return `att_${Date.now()}_${uniqueIdSuffix()}`;
}

// ==================== CORE ENTITIES ====================

/**
 * A person's sex. 'unknown' (GEDCOM SEX U, or no SEX at all) is a sex the
 * records do not give: nothing guesses one for it (data version 12).
 */
export type Gender = 'male' | 'female' | 'unknown';

/** Every value of Gender, in the order the person dialog offers them. */
export const GENDERS: readonly Gender[] = ['male', 'female', 'unknown'];

/** True for a value of Gender (data from a file, a form, an older app). */
export function isGender(value: unknown): value is Gender {
    return value === 'male' || value === 'female' || value === 'unknown';
}

/** The other sex of a couple: male ↔ female; unknown stays unknown. */
export function oppositeGender(gender: Gender | undefined): Gender {
    return gender === 'male' ? 'female' : gender === 'female' ? 'male' : 'unknown';
}

/**
 * Two persons who may be the same one as far as their sex goes: the same
 * sex, or either of them unknown (merge, duplicate matching).
 */
export function gendersCompatible(a: Gender | undefined, b: Gender | undefined): boolean {
    return a === b || a === 'unknown' || b === 'unknown' || a === undefined || b === undefined;
}

/**
 * The two sides of a couple, left (the father's / husband's side) and right:
 * a man on the left, a woman on the right, a person of unknown sex on the
 * side the other one leaves free; two of one sex, or two unknown, keep the
 * order they are given in.
 */
export function coupleSides<T extends { gender?: Gender }>(a: T, b: T): [T, T] {
    if (a.gender === 'male' && b.gender !== 'male') return [a, b];
    if (b.gender === 'male' && a.gender !== 'male') return [b, a];
    if (b.gender === 'female' && a.gender !== 'female') return [a, b];
    if (a.gender === 'female' && b.gender !== 'female') return [b, a];
    return [a, b];
}

/**
 * A person's (first two) parents in the father's and the mother's slot, by
 * the rule of coupleSides; one parent alone stands in the father's slot
 * unless she is a woman.
 */
export function parentSlots<T extends { gender?: Gender }>(parents: readonly T[]): [T | null, T | null] {
    if (parents.length === 0) return [null, null];
    if (parents.length === 1) return parents[0].gender === 'female' ? [null, parents[0]] : [parents[0], null];
    return coupleSides(parents[0], parents[1]);
}

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
    | 'cremation'
    // A census: the person as a household listed them (spec 053).
    | 'census'
    // The person's own part at another's event (spec 085 §6): godparent at a
    // baptism, witness at a wedding. GEDCOM EVEN + TYPE; LifeEvent.roleAt says
    // whose event it was.
    | 'godparent' | 'weddingWitness';

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

/** Every participant role, in the order the editor offers them. */
export const PARTICIPANT_ROLES: readonly ParticipantRole[] = ['godparent', 'witness', 'officiant', 'other'];

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
    /**
     * Persons of the tree the user said this participant recorded by name is
     * not ("Not this person", spec 085 §6, data v20): the offer to link them
     * is not made again.
     */
    linkRejected?: PersonId[];
}

/**
 * How well Strom Research holds a fact (GEDCOM `2 _STROM_STATUS` under the
 * fact): a lead nothing documents yet, possible, probable, or proven by a
 * record. The research decides it — the app shows it and never changes it,
 * and a new version of the research replaces it.
 */
export type FactStatus = 'lead' | 'possible' | 'probable' | 'proven';

export const FACT_STATUSES: readonly FactStatus[] = ['lead', 'possible', 'probable', 'proven'];

/** The status a `_STROM_STATUS` value names, or undefined for one the app does not know. */
export function parseFactStatus(value: string | undefined): FactStatus | undefined {
    const v = value?.trim().toLowerCase();
    return (FACT_STATUSES as readonly string[]).includes(v ?? '') ? v as FactStatus : undefined;
}

/** One more family a GEDCOM file recorded a person in as a child (Person.alsoChildOf). */
export interface AlsoChildOf {
    partnershipId: PartnershipId;
    /** FAMC > PEDI as the file gave it (lower case), when it gave one. */
    pedi?: string;
    /** The line of the person's note the import wrote for it. */
    note: string;
}

export interface LifeEvent {
    id: string;
    type: LifeEventType;
    /** Label for type === 'custom'. */
    customLabel?: string;
    /** Flex date (see src/dates.ts): [~|<|>]YYYY[-MM[-DD]]. */
    date?: string;
    place?: string;
    /** Cause as the record gives it (GEDCOM CAUS), mostly of a death. */
    cause?: string;
    /** Age the record gives, as written ("54 let", "kojenec"; GEDCOM AGE, see src/recorded-age.ts). */
    age?: string;
    /** House or address, e.g. a house number (GEDCOM ADDR). */
    address?: string;
    note?: string;
    /** Ids of Source entries (StromData.sources) citing this event. */
    sourceIds?: string[];
    /** A citation's own QUAY where it differs from its source's (see CitationQuay). */
    citationQuay?: CitationQuay<'sourceIds'>;
    /** Godparents, witnesses, the officiating priest… (see EventParticipant). */
    participants?: EventParticipant[];
    /** The research's status of the event (see FactStatus). */
    status?: FactStatus;
    /**
     * The e-mail addresses the GEDCOM file gave under the event (`2 EMAIL`,
     * MyHeritage's contact under RESI), as written. Each is also a line of
     * the note ("E-mail: …"), which is what the app shows; "Back to {prog}"
     * writes it back as `2 EMAIL` while that line is still in the note.
     */
    gedcomEmails?: string[];
    /**
     * What another program's file wrote on the event's own line where
     * GEDCOM gives it no value (`1 EDUC Gymnázium`, `1 BURI By the church`,
     * `1 EVEN …` beside its TYPE), as written. It is the first line of the
     * note, which is what the app shows; "Back to {prog}" writes it on the
     * line again while the note still begins with it.
     */
    gedcomValue?: string;
    /**
     * What kind of census another program's file wrote (`1 CENS` /
     * `2 TYPE Census of Bohemia`), as written. It is the first line of the
     * note, which is what the app shows; the GEDCOM export writes it as
     * `2 TYPE` again while the note still begins with it.
     */
    gedcomType?: string;
    /**
     * The event's ADDR as the file wrote it, from `2 ADDR` with the lines
     * under it (`3 ADR1 Ulice 5`), and the address the import read from it.
     * "Back to {prog}" writes those lines while the address is still that one.
     */
    gedcomAddress?: { value: string; lines: string[] };
    /**
     * One event that happened to several persons at once (a census household,
     * a residence, a move; spec 085, data v20): each person keeps a copy of the
     * event and the copies share this id (`[A-Za-z0-9]{4,16}` from the app,
     * unique in the tree, opaque; GEDCOM `2 _STROM_SHARE`). The common fields
     * (SHARED_EVENT_COMMON_FIELDS) are written to every copy at once by the
     * DataManager's shared-event methods; age, the research's status, the
     * confirmation, the origin marks and `shareRole` are the copy's own. Only
     * shareable types (eventIsShareable) carry it; a group of one copy is an
     * ordinary event and loses the id when the tree is read.
     */
    shareId?: string;
    /**
     * The person's role in a shared event as the user wrote it ("maid",
     * "lodger"; GEDCOM `3 _ROLE` under `_STROM_SHARE`); absent = a member of
     * the household. The copy's own field.
     */
    shareRole?: string;
    /**
     * The person's own record of a part at another's event (types 'godparent'
     * and 'weddingWitness', spec 085 §6, data v20): the role, whose event it
     * was (a person's or a couple's, either may be missing when the record
     * left the tree) and its type; `eventId` points at the event itself in
     * the app (a person's event id, or 'marriage' / a couple event id).
     * GEDCOM `2 _STROM_ROLE` + `3 _STROM_AT` + `4 TYPE`.
     */
    roleAt?: EventRoleAt;
}

/** Whose event a person's own godparent / witness event belongs to (LifeEvent.roleAt). */
export interface EventRoleAt {
    role: ParticipantRole;
    personId?: PersonId;
    partnershipId?: PartnershipId;
    /** The app's type of that event ('baptism', 'marriage', a couple event type…). */
    eventType: string;
    eventId?: string;
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
    /**
     * The crop's id in Strom Research (GEDCOM `2 _STROM_CLIP`), opaque. Kept
     * through a re-crop here so "Full quality" still finds the original.
     */
    clip?: string;
    /**
     * SHA-256 of the original scan the crop was cut from (`_STROM_SHA`): with
     * `region` it tells Strom Research where on its full-quality file the crop lies.
     */
    originalSha?: string;
    /**
     * EXIF orientation (2–8) of the original a research crop was cut from
     * (`2 _STROM_ORIENT`). Strom Research cuts the file as it is stored, so
     * such a crop lies as stored and is turned upright only for display
     * (excerptImageUrl); the image itself stays as the research sent it.
     * width / height are the crop as shown.
     */
    orient?: number;
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
    /**
     * The call number of the book the entry is in ("N 7", "inv. no. 1702";
     * spec 075, data v18). GEDCOM `2 CALN` under the record's `1 REPO`.
     */
    callNumber?: string;
    /**
     * The folio or page as the book numbers it, with its word ("fol. 12v",
     * "pag. 112", a bare "12v" too; spec 075, data v18). GEDCOM `1 _STROM_FOLIO`.
     */
    folio?: string;
    /**
     * The image number as the archive's portal counts it ("34", "57–58",
     * "34a"; text, spec 075, data v18). GEDCOM `1 _STROM_IMAGE`.
     */
    image?: string;
    /**
     * "Further location" — the rest of where the entry stands (its number, a
     * column) when the source has any of callNumber / folio / image; without
     * them (an older source) the whole location as written ("fol. 12v, č. 5,
     * snímek 34"), kept as it is (see src/source-location.ts). GEDCOM: the
     * PAGE composed of folio, this and the image; `1 _STROM_LOCATOR` this alone.
     */
    reference?: string;
    url?: string;
    note?: string;
    /**
     * GEDCOM QUAY 0–3 (unreliable … primary evidence): the source's default
     * reliability. Preserved on import (the record's own first citation wins,
     * like `reference`) and re-exported on citations; a citation with another
     * QUAY keeps its own (CitationQuay, data v19).
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
    /**
     * The user read the transcript from the record ("Transcription verified"):
     * Strom Research takes it as the first reading of the entry even when the
     * tree's transcripts count as leads. GEDCOM `_STROM_VERIFIED Y` on the record.
     */
    transcriptVerified?: boolean;
    /**
     * Who read the entry, as the research says (GEDCOM `_STROM_READ` on the
     * record of a research file): the user, the research, or both. Shown in
     * the source viewer only; absent from an older research.
     */
    readBy?: SourceReadBy;
    /**
     * The day the user confirmed the research's transcript in the app (ISO
     * `YYYY-MM-DD`, GEDCOM `2 _CONF` under `_STROM_READ`): the user's part of
     * `readBy: both` comes from that confirmation and can be taken back. Only
     * while it holds for the wording the research has; from the research only.
     */
    readConfirmed?: string;
    /**
     * The research's mark of the transcript's wording (GEDCOM `2 _TXT` under
     * `_STROM_READ`): opaque, never computed here — only given back with a
     * confirmation (POST /sources/confirm), so it applies to that wording.
     */
    readMark?: string;
    /**
     * The research's reading this entry was written from ("Read a document":
     * its id, `D…`). With it the research takes the source as that reading's
     * entry. GEDCOM `1 _STROM_READING` on the record (only to a research that
     * knows readings).
     */
    reading?: string;
    /** That reading's entry (`entries[].id`, e.g. "e1"). GEDCOM `2 _STROM_ENTRY` under `_STROM_READING`. */
    readingEntry?: string;
    /**
     * The research has this source's original on its computer (an excerpt, an
     * image or the input scan) and a transcript to compare a new reading with:
     * it can read the source again from the original (spec 059, `POST
     * sources/read`). GEDCOM `1 _STROM_ORIG Y` on the record; from the
     * research only, written back as it came.
     */
    originalInResearch?: boolean;
    /**
     * The SHA-256 of the page the entry is on, when no excerpt carries it
     * (`excerpts[].originalSha`). GEDCOM `1 _STROM_SHA` on the record.
     */
    readingSha?: string;
    /**
     * The research left this source's image out of its file (GEDCOM
     * `1 _STROM_IMG_OMITTED <why>` on the record): `scope` (outside the
     * research's excerpt scope), `limit` (over its file size limit), `later`
     * (not made in time), `missing` (the scan is not on the research's
     * computer, nothing to load), `other` (a reason this app does not know).
     * scope / limit / later hold the whole source (it has no excerpt in the
     * file); `missing` can be a part (the excerpts with a scan came).
     * Read from the research's file only; never written back.
     */
    imageHeld?: SourceImageHeld;
    /**
     * The left-out excerpts' marks (`2 _STROM_CLIP` under the marker, the same
     * mark as an excerpt's `clip`; `input` = the whole input of a document).
     */
    heldClips?: string[];
    /** The import (StromData.imports id) the source record came from. */
    importId?: string;
    /**
     * Another program's own level-1 tags of the source record (`1 _TYPE`,
     * `1 _MEDI` of MyHeritage…), kept as the file wrote them for "Back to
     * {prog}" (spec 066 G8), as Person.gedcomExtra. A `1 _STROM_CITE` block
     * holds the lines of the citation this entry came from that Strom does
     * not read (DATA > TEXT, EVEN > ROLE), written under the citation.
     */
    gedcomExtra?: GedcomExtra[];
    /**
     * The source record's xref in the loaded GEDCOM files (only `from` and
     * `xref` of OriginalIds). The sources a record became — one per page
     * cited, see the import — share it, and "Back to {prog}" writes them
     * as that one record again, the pages on the citations (spec 066 K3.1).
     */
    originalIds?: OriginalIds[];
    /**
     * The record's AUTH as the file wrote it. It is also a line of the note
     * ("Author: …", in the language of the import), which is what the app
     * shows; "Back to {prog}" writes it as `1 AUTH` while that line is still
     * in the note (like LifeEvent.gedcomEmails).
     */
    gedcomAuthor?: string;
    /**
     * The record's TEXT as the file wrote it when it had HTML in it (a link
     * of MyHeritage); the transcript is its plain text, the link's address
     * kept. "Back to {prog}" writes it as written while the transcript is
     * still that text.
     */
    gedcomText?: string;
}

/** Why the research left a source's image out of its file (see Source.imageHeld). */
export type SourceImageHeld = 'scope' | 'limit' | 'later' | 'missing' | 'other';

/** Who read a source's entry (see Source.readBy). */
export type SourceReadBy = 'user' | 'research' | 'both';

/**
 * A document attached to a person (register scan, marriage certificate,
 * letter…). Images are compressed to a bounded JPEG; PDFs are kept as-is up to
 * a size cap. The payload lives inline so it travels with the single-file export.
 */
/**
 * The file the user added, before the app shrank it into the attachment's
 * preview: its identity in Strom Research (`PUT /media/<sha256>`,
 * `_STROM_SHA`). The bytes themselves are never in the tree — they go to the
 * research (or wait in the browser's originals queue until it runs).
 */
export interface MediaOriginal {
    /** SHA-256 of the original file, lowercase hex. */
    sha256: string;
    /** File name as picked. */
    name: string;
    /** Its type — may be one the app cannot show (TIFF, HEIC). */
    mimeType: string;
    bytes: number;
    /** EXIF orientation of the file (2–8); missing = stored upright. */
    orientation?: number;
}

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
    /** The original file behind the preview (a tree linked to Strom Research). */
    original?: MediaOriginal;
    /**
     * Only the original, kept by the research (a TIFF, a HEIC, a PDF over
     * 2 MB): no preview in the tree — `dataUrl` is '' and `original` names the
     * file by its hash. The research may bring a preview in a later version.
     */
    originalOnly?: true;
    /**
     * The picture's date as the file it came from wrote it (GEDCOM `_DATE`
     * under its OBJE, e.g. MyHeritage's photo date; spec 066 G8). Not shown;
     * written back by "Back to {prog}" only.
     */
    date?: string;
}

export interface Person {
    id: PersonId;
    firstName: string;
    lastName: string;  // For women this is maiden name
    /**
     * Titles of the name: before it ("Ing.", "MUDr.", "hrabě") and after it
     * ("ml.", "st.", "Ph.D."), GEDCOM NAME > NPFX / NSFX. Kept apart from the
     * name so search and duplicate matching never weigh them; shown with the
     * name while Settings → "Show titles" is on (src/person-name.ts).
     */
    titleBefore?: string;
    titleAfter?: string;
    /**
     * Surname after marriage — the latest one when there were several
     * (GEDCOM NAME > TYPE married, _MARNM). `lastName` stays the birth
     * surname. Search and merge matching find the person under both.
     */
    marriedSurname?: string;
    /**
     * The given names of the name after marriage when they are not the
     * person's own (firstName): "Jana Kateřina /Nováková/" beside the birth
     * name "Jana /…/" (GEDCOM NAME > TYPE married, as the file wrote it).
     * Shown with the married surname and written back in that NAME. Only with
     * a married surname — without it the field is dropped (load and save).
     */
    marriedFirstName?: string;
    /**
     * Which surname the person goes by (the user's choice, never derived from
     * a divorce or the order of names): 'birth' = the birth surname
     * (lastName), the married one stays and shows as "formerly B" in the
     * person's detail; 'married' = the married surname, said outright (shown
     * as with no choice, but sent to the research). Missing = no choice: the
     * married surname shows when there is one. Only with a non-empty
     * marriedSurname — without it the field is dropped (load and save).
     * GEDCOM: `2 _STROM_PRIMARY Y` under the chosen NAME. Settings →
     * "Surname display" 'birth' overrides it (src/person-name.ts).
     */
    primaryName?: PrimaryName;
    /**
     * The married surname the person editor suggested (from the husband's
     * surname) and the user hid with ×: that suggestion is not offered again;
     * a different one (another husband, his surname changed) is. App-local:
     * never exported to GEDCOM nor sent to the research.
     */
    dismissedMarriedSuggestion?: string;
    gender: Gender;
    isPlaceholder: boolean;
    partnerships: PartnershipId[];
    parentIds: PersonId[];
    childIds: PersonId[];
    // Extended info
    birthDate?: string;
    birthPlace?: string;
    /** House or address of the birth (GEDCOM BIRT > ADDR). */
    birthAddress?: string;
    /**
     * An age written at the birth (BIRT > AGE) by a Strom file (the
     * research's): not shown, kept so it goes back as it came.
     */
    birthAge?: string;
    deathDate?: string;
    deathPlace?: string;
    /** Cause of death as recorded (DEAT > CAUS). */
    deathCause?: string;
    /** Age at death as recorded, as written (DEAT > AGE). */
    deathAge?: string;
    /** House or address of the death (DEAT > ADDR). */
    deathAddress?: string;
    /** The research's status of the birth and of the death fields (see FactStatus). */
    birthStatus?: FactStatus;
    deathStatus?: FactStatus;
    /**
     * Dates as the GEDCOM file wrote them, by their flex value, where the
     * app's own form would write them differently ('CAL 1885' is '~1885',
     * which goes out as ABT 1885; '1699/00' is '1699'). A date whose value is
     * unchanged goes back out as it came, so a research that sent it sees no
     * edit; a changed date has no entry and goes out in the app's form. Only
     * standard GEDCOM keyword forms are kept; '' when one value came in two
     * forms. Covers the birth, the death and the life events.
     */
    gedcomDates?: Record<string, string>;
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
     * spell it (Fischek / Fíšek / Fissek), an alias, or the Czech "jméno po
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
    /**
     * Families the GEDCOM file also recorded the person in as a child, besides
     * the one the person hangs from here (a person has one pair of parents):
     * each with the line of the note that says so ("Also recorded as child
     * of …", in the language of the import). While that line is in the note,
     * an export writes the link back (`1 FAMC` + PEDI, the family's `1 CHIL`)
     * instead of the line (spec 066 K3.1).
     */
    alsoChildOf?: AlsoChildOf[];
    /** Compressed square JPEG portrait as a data URL (see src/photo.ts). */
    photo?: string;
    /** Original file name of the uploaded photo (UX only). */
    photoOriginalName?: string;
    /** The portrait's date as the file it came from wrote it (see Attachment.date); goes with the photo. */
    photoDate?: string;
    /** Life events other than birth/death (see LifeEvent). */
    events?: LifeEvent[];
    /** This person's chapter in the family book (GEDCOM _STORY on INDI). */
    story?: Story;
    /** Ids of Source entries (StromData.sources) citing this person. */
    sourceIds?: string[];
    /** Sources citing the birth fields (birthDate / birthPlace; GEDCOM BIRT.SOUR). */
    birthSourceIds?: string[];
    /** Sources citing the death fields (deathDate / deathPlace; GEDCOM DEAT.SOUR). */
    deathSourceIds?: string[];
    /** A citation's own QUAY where it differs from its source's, per list (see CitationQuay). */
    citationQuay?: CitationQuay<PersonCitationField>;
    /** Attached documents (scans, certificates, letters…). */
    attachments?: Attachment[];
    /**
     * Per-parent relationship type, keyed by parent PersonId. A missing entry
     * (or 'biological') is the default, so existing data needs no migration.
     */
    parentRelTypes?: Record<PersonId, ParentChildRelType>;
    /**
     * What Strom Research knows about the person beyond the facts: conflicting
     * sources, hypotheses, what was searched (GEDCOM _STROM_CONFLICT /
     * _STROM_HYPO / _STROM_SEARCHED). Research trees only; the research is its
     * source of truth — never edited in the app, never sent back, replaced
     * whole by each new version.
     */
    research?: PersonResearch;
    /**
     * Origin from a loaded GEDCOM file (spec 066, data version 15): the
     * import (StromData.imports id) the person came from. Absent: entered here.
     */
    importId?: string;
    /**
     * Each fact's value as it came from a loaded GEDCOM file, by fact key
     * (`firstName`, `lastName`, `gender`, `birthDate`, `birthPlace`,
     * `deathDate`, `deathPlace`, `event:<id>.date|place|value`, see
     * src/import-origin.ts). A fact is "from the family tree" only while its
     * value equals the stored one; an edit ends it, nothing is switched by hand.
     */
    importedValues?: Record<string, ImportedValue>;
    /** Parent links that came from a loaded GEDCOM file: parent id -> import id. */
    importedParents?: Record<string, string>;
    /**
     * The person's ids in the loaded GEDCOM files (spec 066 K3.2): one entry
     * per import the person came from or was merged with, the record's xref
     * and its id lines as the file wrote them. Written back by "Back to {prog}".
     */
    originalIds?: OriginalIds[];
    /**
     * Another program's own level-1 tags on the person (`1 _XXX` and the lines
     * under it) that the app does not read (spec 066 G8): kept as the file
     * wrote them, one entry per import, and written back only by "Back to
     * {prog}" for that program. Never sent to the research, never in Strom's
     * own file.
     */
    gedcomExtra?: GedcomExtra[];
    /**
     * The research's origin of each fact (GEDCOM `_STROM_ORIGIN`, `_STROM_WAS`,
     * `_STROM_SEX_ORIGIN`), by fact (`name`, `sex`, `birth`, `death`,
     * `event:<id>`). Research trees only; read from the research's file,
     * never from another file, never sent back.
     */
    researchOrigins?: Record<string, ResearchFactOrigin>;
    /**
     * Facts a person confirmed by hand ("Verified from the scan", spec 065),
     * by fact (`name`, `sex`, `birth`, `death`, `event:<id>`). Valid only
     * while the fact keeps the value it was confirmed with. Kept in JSON and
     * in Strom's own GEDCOM (`2 _STROM_CONFIRMED <date>` under the fact).
     */
    confirmed?: Record<string, FactConfirmation>;
    /**
     * What the research says about re-verifying each fact (GEDCOM
     * `_STROM_CONFIRMED`, `_STROM_VERIFY`, `_STROM_CHECKED`, spec 065), by
     * fact. Research trees only; read from the research's file, never sent back.
     */
    researchVerify?: Record<string, ResearchFactVerify>;
}

/** One GEDCOM file loaded into the tree (StromData.imports, spec 066). */
export interface ImportRecord {
    /** "I1", "I2"… (the app's), "R1"… (an import the research made). */
    id: string;
    /** The program that wrote the file (HEAD > SOUR > NAME, else the SOUR value). */
    program: string;
    /** HEAD > SOUR > VERS. */
    version?: string;
    /** HEAD > DATE as written. */
    fileDate?: string;
    /** When it was loaded into Strom (ISO date). */
    at: string;
    /** The file's name. */
    file?: string;
    /** The encoding the file was read in (e.g. "windows-1250"). */
    encoding?: string;
    /** SHA-256 of the file's bytes (lowercase hex). */
    sha?: string;
    /** The "what next" card after this import was closed. */
    nextCardClosed?: boolean;
}

/** One id line of a record in a loaded GEDCOM file (`1 _UID`, `1 RIN`, `1 EXID` + `2 TYPE`…). */
export interface OriginalIdLine {
    /** `_UID`, `UID`, `RIN`, `EXID`, `_FSFTID` or `AFN`. */
    tag: string;
    /** The value as written. */
    value: string;
    /** EXID > TYPE: the system the id belongs to. */
    type?: string;
}

/** A record's ids in one loaded GEDCOM file (Person/Partnership.originalIds). */
export interface OriginalIds {
    /** The import (ImportRecord.id). */
    from: string;
    /** The record's xref in that file, without the @ signs ("I37"). */
    xref?: string;
    /** Its id lines, in file order. */
    ids?: OriginalIdLine[];
}

/** Another program's level-1 tags of a record kept as written (Person/Partnership/Source.gedcomExtra). */
export interface GedcomExtra {
    /** The import (ImportRecord.id). */
    from: string;
    /** The lines as the file wrote them, from the level-1 `_XXX` line down (no line is re-wrapped). */
    lines: string[];
}

/** A fact's value as it came from a loaded file (Person/Partnership.importedValues). */
export interface ImportedValue {
    /** The import (ImportRecord.id). */
    from: string;
    value: string;
}

/**
 * Whose a fact is according to the research (GEDCOM `_STROM_ORIGIN`): `tree` a
 * value taken from the user's own Strom tree and not changed by a person since
 * (research 1.30.0+), `user` a person's change (an edit, a revert, an accepted
 * proposal, a value added).
 */
export type FactOriginKind = 'import' | 'user' | 'research' | 'tree';

/** A part of a fact (GEDCOM `_PART`, the parts list of `_STROM_IMPORT` / `_STROM_ORIGIN`). */
export type FactPart = 'DATE' | 'PLAC' | 'VAL' | 'GIVN' | 'SURN' | 'SEX';

/** What the fact was before the research changed it (GEDCOM `_STROM_WAS`). */
export interface ResearchFactWas {
    /** The family tree's value, as the research wrote it. */
    value: string;
    /** `3 _STROM_IMPORT`: the import the value came from. */
    importId?: string;
    /** `3 _PART`: which parts changed (none listed: the whole fact). */
    parts?: FactPart[];
    /** `3 _REF`: the research's key of the fact, sent back in /facts/revert. */
    ref?: string;
    /**
     * Each changed part's own value when more than one part changed (the
     * research writes one `2 _STROM_WAS` per part; a place holds commas, so
     * the values are never joined). `value` is then the first part's.
     */
    partValues?: Partial<Record<FactPart, string>>;
}

/** The research's origin of one fact (Person/Partnership.researchOrigins). */
export interface ResearchFactOrigin {
    /** `_STROM_ORIGIN`; absent when the research sent only `_STROM_WAS`. */
    kind?: FactOriginKind;
    /** The import of an `import` origin. */
    importId?: string;
    /** The parts from the import (none listed: the whole fact). */
    parts?: FactPart[];
    was?: ResearchFactWas;
    /** Sources cited under the fact (the record a change was made by). */
    sourceIds?: string[];
}

/** A fact confirmed by hand from a scan of the record (spec 065). */
export interface FactConfirmation {
    /** The day of the confirmation, `YYYY-MM-DD`. */
    at: string;
    /**
     * The fact's value when it was confirmed (its parts joined, see
     * factValueSignature). A later change of the value ends the confirmation.
     * Absent: valid whatever the value (an older record).
     */
    value?: string;
    /**
     * Not a confirmation: the research's confirmation of the day `at` is
     * taken back here (research trees). The fact then goes to the research
     * without its `_STROM_CONFIRMED`, which the research reads as taking it
     * back; a version of the research loaded afterwards replaces it.
     */
    withdrawn?: true;
}

/** Why a fact waits for re-verification in the research (`2 _STROM_VERIFY`). */
export type FactVerifyPending = 'wait' | 'asked' | 'images' | 'permission';

/** The research's last re-verification of a fact (`2 _STROM_CHECKED`). */
export interface FactVerifyChecked {
    /** `proven`: the record confirmed it; `kept`: it stays as it was (see why). */
    result: 'proven' | 'kept';
    /** `3 DATE`, `YYYY-MM-DD` (or as written when not a full date). */
    date?: string;
    /** `3 _WHY`: why a kept fact stays (kept only). */
    why?: string;
    /** `3 _READERS`: how many independent readings agreed. */
    readers?: number;
}

/** The research's re-verification state of one fact (Person/Partnership.researchVerify). */
export interface ResearchFactVerify {
    /** `2 _STROM_CONFIRMED <date>`: confirmed by a person in the research. */
    confirmed?: string;
    /**
     * The fact's value the research's file gave with its confirmation (see
     * factValueSignature): the confirmation holds while the fact keeps it, a
     * change here ends it (as the app's own, FactConfirmation.value). Only
     * with `confirmed`. Absent in a tree stored before it was kept: filled
     * once when the tree is read (fillResearchConfirmedValues).
     */
    value?: string;
    pending?: FactVerifyPending;
    /**
     * `3 _POS n` under `_STROM_VERIFY wait|asked`: the fact's task is the
     * n-th the research's next session would take (1 = next), as of the file.
     */
    position?: number;
    checked?: FactVerifyChecked;
    /**
     * `2 _STROM_EID E0012`: the fact's id in the research (what /verify and
     * /facts/confirm name). Never sent back; a fact copied or made here has none.
     */
    eid?: string;
    /**
     * `3 _TXT 3f9a0c51d2e4b788` under `_STROM_EID`: the research's mark of what
     * the fact says in its file (research 1.30.0+), sent back with
     * /facts/confirm so the research confirms only the value shown here.
     */
    txt?: string;
    /** The fact's value (factValueSignature) when the file gave `txt`: the mark holds only for it. */
    txtValue?: string;
}

/** What the research knows about one person (see Person.research). */
export interface PersonResearch {
    conflicts?: ResearchConflict[];
    hypotheses?: ResearchHypothesis[];
    searched?: ResearchSearch[];
    /** The tree ends above this person and the research knows why (GEDCOM _STROM_EDGE). */
    edge?: ResearchEdge;
    /** The person belongs to a family nothing links to the tree yet (GEDCOM _STROM_ISLAND). */
    island?: ResearchIsland;
    /**
     * Where the person stands in the research's lines (GEDCOM INDI
     * _STROM_DIRECTION, spec 073 §16.9), the narrowest first.
     */
    places?: ResearchPlace[];
    /** What is being waited for outside the app about the person: a letter, an office (GEDCOM _STROM_WAIT, §16.10). */
    waits?: ResearchWait[];
    /** When the research added the person to the tree (GEDCOM _STROM_ADDED, ISO UTC instant). */
    added?: string;
}

/** How a person belongs to a line (GEDCOM 2 TYPE under INDI _STROM_DIRECTION). */
export type ResearchPlaceRole = 'line' | 'partner' | 'branch' | 'island';

/** One place of a person in the research's lines (§16.9). */
export interface ResearchPlace {
    role: ResearchPlaceRole;
    /** The line (G…); absent for a branch or an island outside any line. */
    line?: string;
    /** The side branch (B-P…) the person is in. */
    branch?: string;
}

/** Who a wait is with (GEDCOM 2 _GROUP under _STROM_WAIT). */
export type ResearchWaitGroupType = 'archive' | 'office' | 'family' | 'web' | 'other';

/** A wait for an answer from outside (GEDCOM INDI _STROM_WAIT T…, §16.10 items 5 and 6). */
export interface ResearchWait {
    /** The research's task (T…). */
    id: string;
    type?: 'letter' | 'family' | 'web' | 'images' | 'check' | 'permission' | 'other';
    title?: string;
    /** What it is about (2 _ON, as written). */
    on?: string;
    group?: { name: string; type?: ResearchWaitGroupType; key?: string; url?: string };
    stat?: 'todo' | 'sent';
    /** When it was sent (ISO). */
    sent?: string;
    /** Its priority (1 = first). */
    prio?: number;
}

/** A line of the research (GEDCOM HEAD _STROM_DIRECTION G…). */
export interface ResearchLine {
    id: string;
    name: string;
    kind?: 'ancestors' | 'descendants' | 'person' | 'question';
    /** The person it starts from (REFN P…). */
    focus?: string;
    state?: 'active' | 'paused' | 'done';
}

/** How a side branch hangs on its nearest person (GEDCOM 3 TYPE under _VIA). */
export type ResearchBranchRel = 'sibling' | 'partner' | 'child' | 'parent' | 'other';

/** A side branch outside the lines (GEDCOM HEAD _STROM_BRANCH B-P…). */
export interface ResearchBranch {
    /** B-P…: the branch of person P…. */
    id: string;
    /** The person of the branch (REFN P…, from the id). */
    person: string;
    /** The person it hangs on and how. */
    via?: { person: string; rel?: ResearchBranchRel };
    /** The nearest line (G…). */
    nearest?: string;
    /** The line it was added to (G…). */
    line?: string;
    /** How work outside the lines is ordered for it. */
    mode?: 'never' | 'occasional' | 'last' | 'normal';
}

/**
 * The research's lines and side branches (GEDCOM HEAD _STROM_DIRECTIONS,
 * _STROM_DIRECTION, _STROM_BRANCH). Research trees only, never sent back.
 */
export interface ResearchDirections {
    /** HEAD _STROM_DIRECTIONS Y: every person's places are written, so a person without one is off the lines. */
    complete: boolean;
    lines: ResearchLine[];
    branches: ResearchBranch[];
}

/** A span of years (inclusive). */
export interface YearSpan {
    from: number;
    to: number;
}

/**
 * The edge of the tree above one person: what is missing, how far the
 * research reaches (scope), what the records say (end) and what comes next.
 * Values are open vocabularies: an unknown one is kept as written and shown
 * as "the research knows something here".
 */
export interface ResearchEdge {
    /** parents | father | mother | proof (or a newer word). */
    missing: string;
    /** in | limit | paused | done | living | outside | off-tree … */
    scope?: string;
    /** The research direction reaching here ("G0001") and its generation. */
    research?: string;
    gen?: number;
    /** What the records say (unnamed, lost, before-records, … no-clue). */
    end?: string;
    /** The first year of the known registers (before-records). */
    records?: number;
    /** What comes next (working, waiting, queued, held, proposed, decide, none). */
    next?: string;
    /** Queue position of the first task (1 = next). */
    pos?: number;
    /** The birth the search starts from; `basis` when estimated ("MARR 1810", "child 1811"). */
    est?: { year: number; place?: string; basis?: string };
    /** The years searched for the baptism. */
    window?: YearSpan;
    /** Known birth registers for the window. */
    books: ResearchEdgeBook[];
    /** Years of the window searched in every known book without a result. */
    covered: YearSpan[];
    /** Years of the window no book covers. */
    noRecords: YearSpan[];
    /** Tasks that can move the tree up, in queue order. */
    tasks: ResearchEdgeTask[];
    /** Tasks done or dropped on the same (ids). */
    tried: string[];
    searches?: number;
    sessions?: { n: number; cost?: number; partial?: boolean };
    /** Last work here (ISO date). */
    last?: string;
    /** Open conflicts about the birth or the parents (ids; full text in `conflicts`). */
    conflicts: string[];
    /** Open hypotheses naming this person. */
    hypos: ResearchEdgeHypo[];
}

export interface ResearchEdgeBook {
    id: string;
    title: string;
    from?: number;
    to?: number;
    /** online-free | online-login | onsite | request | lost | unknown */
    access?: string;
}

export interface ResearchEdgeTask {
    id: string;
    level?: string;
    stat?: string;
    title: string;
    pos?: number;
    /** Why it waits outside the queue: paused | done | off-tree | parked. */
    held?: string;
    /** Parked until (as written). */
    until?: string;
    note?: string;
}

export interface ResearchEdgeHypo {
    id: string;
    /** REFN of the person (in the island, or in the tree) it would link to. */
    join?: string;
    /** People in the family outside the tree. */
    island?: number;
    /** Tasks about it waiting outside the queue. */
    held?: number;
    /** Tasks testing it. */
    tests: string[];
    /** The variants of the hypothesis that would make the join (3 _VAR): their letters. */
    variants?: string[];
    /**
     * Every person it names to join, in the research's order, each with its
     * own family (level 4 under `_JOIN`); none from a research that writes
     * no level 4 (the first `join` and the numbers above then).
     */
    joins?: ResearchEdgeJoin[];
}

/** One person an edge's hypothesis would join, and the family outside the tree it belongs to. */
export interface ResearchEdgeJoin {
    /** REFN of the person. */
    person: string;
    /** The variants naming this person (4 _VAR): their letters. */
    variants?: string[];
    /** People in its family outside the tree. */
    island?: number;
    /** Tasks about that family waiting outside the queue. */
    held?: number;
}

/** A person of a family nothing links to the tree yet. */
export interface ResearchIsland {
    size: number;
    /** The hypotheses that would join it: the person of the tree they name, the variants that would (3 _VAR). */
    hypos: { id: string; join?: string; variants?: string[] }[];
    held?: number;
}

/** One value a source gives for a fact, with the sources that say so. */
export interface ResearchConflictValue {
    /** As the research wrote it (a GEDCOM date, a place, a name). */
    value: string;
    sourceIds?: string[];
    /** Whose value it is in a conflict made by an edit in the app (GEDCOM 3 _STROM_SIDE): the user's, or the research's. */
    side?: 'user' | 'research';
    /** The sex as a machine value (GEDCOM 3 _STROM_RAW), SEX conflicts only: the value itself is in the research's words. */
    raw?: 'M' | 'F' | 'U';
}

/** Sources that disagree about one fact. */
export interface ResearchConflict {
    /** The research's id ("X0007"). */
    id: string;
    /** The fact: a GEDCOM event tag (BIRT, DEAT, CHR …), NAME, a title of the name (NPFX before it, NSFX after it) or SEX; EVEN when the research does not know which. */
    fact: string;
    /** The question in words ("Year of Jan's birth"). */
    title?: string;
    status: 'open' | 'decided';
    /** What each source claims, as the research wrote it (a GEDCOM date, or words). */
    values: ResearchConflictValue[];
    /** The decision in words ("1865 (S0001)"), decided only. */
    decision?: ResearchConflictValue;
    /**
     * Made by an edit in the app and decidable by a side — keep the app's
     * value or take the research's (GEDCOM 2 _STROM_TAKE Y; `take: true` in
     * the bridge's JSON). Missing: decided in the research only.
     */
    take?: true;
    /** Whose value the research proposes to change (GEDCOM 2 _STROM_KIND): from the family tree, or entered by a person. */
    kind?: 'import' | 'user';
}

/** A question the research works with ("Father: Václav, or Jan?"). */
export interface ResearchHypothesis {
    /** The research's id ("H0001"), when it wrote one. */
    id?: string;
    title: string;
    note?: string;
    /**
     * open | decided | abandoned, or a newer word kept as written (GEDCOM
     * 2 STAT). Missing: the research did not say (an older file: open).
     */
    status?: string;
    /** The variant it was decided for (2 _CHOSEN, decided only): its letter. */
    chosen?: string;
    /**
     * Who decided it (2 _BY, decided or abandoned only): `agent` when the
     * research's agent did, `app` when a person did by a link from the app
     * (spec 074); absent: the person in the research (also every older record).
     */
    decidedBy?: 'agent' | 'app';
    /** Why it was decided so (2 DECI, CONC/CONT joined; decided or abandoned only). */
    decision?: string;
    /** The day it was decided (2 _AT, ISO "YYYY-MM-DD"; decided or abandoned only). */
    decidedAt?: string;
    /** Its variants and what each would connect (2 _VAR), in the file's order. */
    variants?: ResearchHypothesisVariant[];
    /**
     * It can be decided by a version from the app (2 _PICK Y, spec 074): every
     * link of every version is `child` or `partners` and one at least has one.
     * The research's word; links of people not in the file are missing there.
     */
    pickable?: true;
    /** The decision before the last one (2 _PREV, spec 074): its version (null: no version held), who, why, when. */
    previous?: ResearchHypothesisPrevious;
    /** It cannot be reopened (2 _REOPEN no, decided or abandoned only, spec 074): why, how many links, the versions that would not change the tree. */
    reopen?: ResearchHypothesisReopen;
    /** The agent's open proposal (2 _PROP, open only, spec 074): its version (null: no version holds), its sentence, its day. */
    proposal?: ResearchHypothesisProposal;
    /** Left open on this day (2 _LEFT, open only, spec 074): a proposal not taken, or none waited. ISO "YYYY-MM-DD". */
    leftOpen?: string;
}

/** Who decided a hypothesis besides the person in the research: its agent, or a person by a link from the app. */
export type ResearchHypothesisDecider = 'agent' | 'app';

/** The decision a hypothesis had before (2 _PREV, only the last one). */
export interface ResearchHypothesisPrevious {
    /** Its version's letter; null when it was "no version holds" (abandoned). */
    variant: string | null;
    /** 3 _BY; absent: the person in the research. */
    by?: ResearchHypothesisDecider;
    /** 3 DECI (CONC/CONT joined). */
    reason?: string;
    /** 3 _AT, ISO "YYYY-MM-DD". */
    day?: string;
}

/**
 * Why a decided hypothesis cannot be reopened by a link (2 _REOPEN no):
 * `tree` — the chosen version's links are in the tree, written otherwise than
 * by this decision (the agent, an older research); `work` — further work
 * stands on links this decision wrote; another word as written (a sentence
 * of its own is not known: the general one).
 */
export interface ResearchHypothesisReopen {
    ok: false;
    /** 3 TYPE, lower case ('' when not said). */
    type: 'tree' | 'work' | string;
    /** 3 _COUNT: how many such links. */
    count?: number;
    /** 3 _STAYS (repeated): versions whose choice leaves the tree as it is (the old link stays, the new one is not written). */
    stays?: string[];
}

/** The agent's open proposal for a hypothesis (2 _PROP). */
export interface ResearchHypothesisProposal {
    /** Its version's letter; null for "no version holds". */
    variant: string | null;
    /** 3 DECI: its sentence (CONC/CONT joined). */
    text?: string;
    /** 3 _AT, ISO "YYYY-MM-DD". */
    day?: string;
}

/** A text against a version (3 _AGAINST) and the sources it names (4 SOUR), catalog ids. */
export interface ResearchHypothesisAgainst {
    text: string;
    sourceIds?: string[];
}

/** One answer to a hypothesis ("B: son of Jakub and Marie"). */
export interface ResearchHypothesisVariant {
    /** Its letter ("B"): the same claim in every version of the research. */
    id: string;
    /** The claim (3 TITL). */
    title?: string;
    /** What it would connect (3 _LINK): none when it names nobody in the file. */
    links: ResearchVariantLink[];
    /**
     * What it claims that the tree records already (3 _INTREE, open
     * hypotheses only): `child` of the family it is a child of, `partners`,
     * `siblings`. Nothing to draw; a link is never both here and in `links`.
     */
    inTree?: ResearchVariantLink[];
    /** The sources it names (3 SOUR), catalog ids. */
    sourceIds?: string[];
    /** What speaks against it (3 _AGAINST, spec 074), each a text with the sources it names. */
    against?: ResearchHypothesisAgainst[];
    /** How many people outside the tree it would join to it (3 _PEOPLE, spec 074; only more than 0). */
    people?: number;
}

/** What a variant would connect (3 _LINK); people as the research's person numbers (REFN). */
export type ResearchVariantLink =
    /** `child` is the child of `parents` (one or two), a couple of the tree (4 _FAM, `family`) or not (4 _PAR). */
    | { kind: 'child'; child: string; parents: string[]; family?: true }
    /** `same`: one person in two records; `partners`: a couple; `siblings`: brothers and sisters (parents unknown). */
    | { kind: 'same' | 'partners' | 'siblings'; persons: string[] };

/** A place the research searched for this person. */
export interface ResearchSearch {
    /** What was searched (a register book). */
    title: string;
    /** The years it covered (GEDCOM FROM … TO …), from / to. */
    from?: number;
    to?: number;
    result?: 'found' | 'none';
    /** When it was searched (ISO date). */
    at?: string;
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
    /**
     * The sources the story rests on (ids into StromData.sources): the
     * sources of its facts and of its background, as Strom Research names
     * them (`2 SOUR @S…@` under _STORY). Shown as "Based on sources".
     */
    sources?: string[];
    /**
     * A newer version of an APPROVED story waiting for the user (Strom Research
     * _STORY > _DRAFT). The approved text above stays the story — the book and
     * the person's panel show it — until the user takes the new version or
     * keeps the old one in the research. A snapshot of the research's state:
     * the next load replaces it, and no copy leaving the app carries it.
     */
    draft?: StoryDraft;
}

/** The waiting new version of an approved story (_STORY > _DRAFT). */
export interface StoryDraft {
    title?: string;
    /** Same form as Story.text. */
    text: string;
    facts?: string[];
    note?: string;
    /** The sources the new version rests on (`3 SOUR @S…@` under _DRAFT). */
    sources?: string[];
    /** When it was written (YYYY-MM-DD as the research sends it). */
    at?: string;
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
    /** Place of the divorce (DIV > PLAC). */
    endPlace?: string;
    /** The research's status of the wedding and of the divorce fields (see FactStatus). */
    startStatus?: FactStatus;
    endStatus?: FactStatus;
    /**
     * Dates as the GEDCOM file wrote them, by their flex value, where the
     * app's own form would write them differently ('CAL 1885' is '~1885',
     * which goes out as ABT 1885; '1699/00' is '1699'). A date whose value is
     * unchanged goes back out as it came, so a research that sent it sees no
     * edit; a changed date has no entry and goes out in the app's form. Only
     * standard GEDCOM keyword forms are kept; '' when one value came in two
     * forms. Covers the wedding, the divorce and the couple's events.
     */
    gedcomDates?: Record<string, string>;
    /** House or address of the wedding, usually the bride's (MARR > ADDR). */
    address?: string;
    /** Each partner's age at the wedding as recorded, by person id (MARR > HUSB/WIFE > AGE). */
    ages?: Record<string, string>;
    note?: string;
    /** Ids of Source entries citing this partnership (marriage record etc.). */
    sourceIds?: string[];
    /**
     * Ids of Source entries citing the divorce (GEDCOM DIV > SOUR), each
     * citation's page, quality and entry text kept like the wedding's (a
     * source of its own per page). Optional, no data version bump: an older
     * app keeps partnerships whole and only does not show them.
     */
    divorceSourceIds?: string[];
    /** A citation's own QUAY where it differs from its source's, per list (see CitationQuay). */
    citationQuay?: CitationQuay<PartnershipCitationField>;
    /**
     * Witnesses at the wedding (see EventParticipant). A marriage entry names
     * them the way a baptism names godparents, and they are the same kind of
     * lead — the model has no union event to hang them on, so they live here.
     */
    participants?: EventParticipant[];
    /** The couple's chapter in the family book (GEDCOM _STORY on FAM). */
    story?: Story;
    /**
     * What a record says about the couple besides the wedding and the divorce
     * (which stay fields above): banns, a contract, a census of the household…
     */
    events?: CoupleEvent[];
    /** The import (StromData.imports id) the partner link came from. */
    importId?: string;
    /**
     * The GEDCOM file the couple was read from wrote no marriage for it (no
     * MARR; "married", or "divorced" by a DIV alone, is only how a couple is
     * read). An export then adds no empty MARR the file never had (spec 066
     * K3.1); a wedding detail (date, place, witnesses…) writes one as before.
     */
    marriageUnrecorded?: boolean;
    /**
     * The file wrote the family of one parent alone as not a couple
     * (`1 _STROM_NO_COUPLE Y`, as Strom Research does): while the other
     * parent is still the "?" and the family says nothing a couple would,
     * an export writes the mark back, so the family goes out as it came.
     */
    noCouple?: boolean;
    /** Each fact's value as it came from a loaded file (`startDate`, `startPlace`, `endDate`, `endPlace`, `event:<id>.date|place|value`). */
    importedValues?: Record<string, ImportedValue>;
    /** The family record's ids in the loaded GEDCOM files (xref, `_UID`…), see Person.originalIds. */
    originalIds?: OriginalIds[];
    /** The family record's own tags of another program, see Person.gedcomExtra. */
    gedcomExtra?: GedcomExtra[];
    /** The research's origin of each fact (`marriage`, `divorce`, `event:<id>`), research trees only. */
    researchOrigins?: Record<string, ResearchFactOrigin>;
    /** Facts confirmed by hand (`marriage`, `divorce`, `event:<id>`), see Person.confirmed. */
    confirmed?: Record<string, FactConfirmation>;
    /** The research's re-verification of each fact, see Person.researchVerify. */
    researchVerify?: Record<string, ResearchFactVerify>;
    /**
     * The family's id in the research ("F0003", its record `0 @F0003@ FAM`),
     * read from the research's own file: what /verify {family} names. Never
     * sent back (what goes to the research numbers its families afresh) and
     * no change of the tree; a couple made here has none.
     */
    researchId?: string;
    // Primary partnership flag - when person has multiple partnerships,
    // this one is shown by default (unless viewing from child's perspective)
    isPrimary?: boolean;
}

/**
 * Kinds of event recorded about a couple. The wedding and the divorce are not
 * here: they are the partnership's own fields (startDate, endDate…).
 */
export type CoupleEventType =
    | 'engagement' | 'banns' | 'marriageLicence' | 'marriageContract' | 'marriageSettlement'
    | 'residence' | 'census'
    | 'divorceFiled' | 'annulment'
    | 'custom';

/**
 * One event of a couple — a life event of two people. The same shape as a
 * person's LifeEvent, except the age: a record gives each partner's age, so
 * it is kept by person id, like Partnership.ages.
 */
export interface CoupleEvent {
    id: string;
    type: CoupleEventType;
    /** Label for type === 'custom' (GEDCOM EVEN > TYPE). */
    customLabel?: string;
    /** Flex date (see src/dates.ts). */
    date?: string;
    place?: string;
    /** Cause as the record gives it (CAUS), e.g. of an annulment. */
    cause?: string;
    /** Each partner's age as recorded, by person id (HUSB / WIFE > AGE). */
    ages?: Record<string, string>;
    /** House or address (ADDR). */
    address?: string;
    note?: string;
    /** Ids of Source entries citing this event. */
    sourceIds?: string[];
    /** A citation's own QUAY where it differs from its source's (see CitationQuay). */
    citationQuay?: CitationQuay<'sourceIds'>;
    /** Witnesses and others the record names. */
    participants?: EventParticipant[];
    /** The research's status of the event (see FactStatus). */
    status?: FactStatus;
}

/** The partnership fields the relationships panel edits (DataManager.updatePartnership). */
export type PartnershipUpdates = Partial<Pick<Partnership,
    'status' | 'startDate' | 'startPlace' | 'endDate' | 'endPlace' | 'address' | 'ages' | 'note' | 'isPrimary'>>;

// ==================== LAST FOCUSED MARKER ====================

/** Special marker value for "last focused" default setting */
export const LAST_FOCUSED = "__last_focused__" as const;
export type LastFocusedMarker = typeof LAST_FOCUSED;

/**
 * The reliability (GEDCOM QUAY 0–3) of single citations, by citation list and
 * source id (spec 077, data v19): only a citation whose QUAY differs from its
 * source's default (Source.quality) has an entry; `null` is a citation that
 * gave no QUAY while its source has one. The same entry cited at two facts
 * with another QUAY each stays one source. Read through citationQuality()
 * (src/citation-quality.ts); an entry of a source no longer in its list says
 * nothing (dropped when the tree is read).
 */
export type CitationQuay<F extends string = string> = Partial<Record<F, Record<string, number | null>>>;

/** A person's citation lists: the person as a whole, the birth, the death. */
export const PERSON_CITATION_FIELDS = ['sourceIds', 'birthSourceIds', 'deathSourceIds'] as const;
export type PersonCitationField = typeof PERSON_CITATION_FIELDS[number];

/** Every source a person's own citations name (the person, the birth, the death), once each. */
export function personSourceIds(p: Pick<Person, PersonCitationField>): string[] {
    return [...new Set(PERSON_CITATION_FIELDS.flatMap(f => p[f] ?? []))];
}

/** A couple's citation lists: the union itself (the wedding), the divorce. */
export const PARTNERSHIP_CITATION_FIELDS = ['sourceIds', 'divorceSourceIds'] as const;
export type PartnershipCitationField = typeof PARTNERSHIP_CITATION_FIELDS[number];

/** Every source a couple's citations name (the union itself, the divorce and each of its events), once each. */
export function partnershipSourceIds(u: Partial<Pick<Partnership, PartnershipCitationField | 'events'>>): string[] {
    return [...new Set([...PARTNERSHIP_CITATION_FIELDS.flatMap(f => u[f] ?? []), ...(u.events ?? []).flatMap(e => e.sourceIds ?? [])])];
}

/** Everyone a couple's records name: the wedding witnesses and the people at each of its events. */
export function partnershipParticipants(u: Pick<Partnership, 'participants' | 'events'>): EventParticipant[] {
    return [...(u.participants ?? []), ...(u.events ?? []).flatMap(e => e.participants ?? [])];
}

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
 * v8 (2026-09): Person.birthSourceIds / deathSourceIds — the birth and death
 *   fields cited on their own (GEDCOM BIRT.SOUR / DEAT.SOUR used to land in
 *   Person.sourceIds, so a name citation looked like a documented birth).
 * v9 (2026-10): register details — Person.birthAddress / deathCause /
 *   deathAge / deathAddress; LifeEvent.cause / age / address;
 *   Partnership.address / ages / endPlace (the divorce place); the waiting
 *   new version of an approved story (Story.draft).
 * v10 (2026-10): the couple's own events — Partnership.events (banns, a
 *   marriage contract, a census of the household…), which used to be folded
 *   into the couple's note as text lines.
 * v11 (2026-10): Source.transcriptVerified (the user read the transcript
 *   from the record — the research's first reading) and Source.readBy (who
 *   read the entry, from the research); the research's certainty of a fact
 *   (FactStatus: Person.birthStatus / deathStatus, LifeEvent.status); the
 *   original behind an image (Attachment.original, Attachment.originalOnly —
 *   kept as an original only, no picture in the tree — SourceExcerpt.originalSha
 *   and .orient).
 * All additive/backward-compatible for reading; the bump makes an older app
 * warn ("newer version") before it silently drops the new fields on re-save.
 * 3.8.x (v10) keeps the v11 fields on a round trip: an attachment kept as an
 * original only carries a page icon as its data (ORIGINAL_ONLY_DATA_URL), which
 * 3.8.x keeps (it drops an attachment without image or PDF data);
 * transcriptVerified stays on a transcript edited in 3.8.x.
 * Person.titleBefore / titleAfter (3.10) came without a bump: an older app
 * carries persons whole (migrateData) and edits them in place (updatePerson),
 * so it keeps the titles on a re-save; it only shows the name without them.
 * Person.marriedSurname (3.13) likewise came without a bump: an older app keeps
 * it on a re-save and reads the married name as another spelling meanwhile.
 * Person.primaryName (3.18) came without a bump too: an older app keeps it on a
 * re-save (persons carried whole) and shows the married surname meanwhile; its
 * GEDCOM import skips `_STROM_PRIMARY` under a NAME silently and its export
 * does not write it (the research takes the missing mark as no change).
 * Person.dismissedMarriedSuggestion (3.13, app-local) the same way.
 * Person.marriedFirstName (3.26) came without a bump too: an older app keeps
 * it on a re-save and shows the married name with the person's own given
 * name meanwhile; its GEDCOM export writes that name so.
 * Source.reading / readingEntry / readingSha (3.14) came without a bump too: an
 * older app loads sources whole (migrateData) and edits them in place
 * (updateSource), so it keeps the reading's marks on a re-save. Its merge keeps
 * them on a source it adds but not when it folds a duplicate into the tree's
 * own entry, and its GEDCOM export does not write them: the research then takes
 * that entry as a source of the app's, not as the reading's entry (harmless).
 * v12 (2026-10): Gender 'unknown' (GEDCOM SEX U, or no SEX): a sex the records
 *   do not give, no longer guessed from the family role (or female). Older
 *   data keeps its male/female; a missing or invalid gender reads as unknown
 *   (migrateData). An older app (v11) warns before it shows 'unknown' as male.
 * v13 (2026-10, spec 021): StromData.qualityDismissed (findings of the tree
 *   check marked "not an error" / "two different people") and
 *   StromData.surnameRejections (spelling groups the research suggested and
 *   the user rejected). Both tree-level lists, additive; an older app (v12)
 *   would drop them on a re-save (migrateData builds field by field), so the
 *   bump makes it warn first.
 *   Also v13 (before it reached production): a period date ('1871/1882',
 *   '1871/', '/1882' — GEDCOM FROM/TO, before read as the range '..' or as
 *   '>'/'<') and Person/Partnership.gedcomDates (the file's own form of a
 *   date, see there). A v12 app reads neither: it shows the period as
 *   written and drops it from its GEDCOM export — hence under the same warning.
 * v14 (2026-10, package 1031): StromData.lineageOverrides (a lineage's
 *   founder moved down, a line split off by hand). A tree-level field; an
 *   older app (v13) would drop it on a re-save (migrateData builds field by
 *   field), so the bump makes it warn first.
 * v15 (2026-11, spec 066): StromData.imports (the GEDCOM files loaded into
 *   the tree) and the origin of facts and links from them
 *   (Person/Partnership.importedValues, importId, Person.importedParents,
 *   Source.importId), plus the research's origin of facts (researchOrigins,
 *   ResearchConflict.kind), and the records' ids in the loaded files
 *   (Person/Partnership.originalIds: xref, _UID, RIN, EXID…) and another
 *   program's own level-1 tags kept for "Back to {prog}"
 *   (Person/Partnership/Source.gedcomExtra; the source's came after
 *   3.26.0-beta.2 without a bump: a v15 app keeps sources whole) and a
 *   picture's date (Attachment.date, Person.photoDate, kept whole the same
 *   way). Additive;
 *   existing trees get no origin and no ids (nothing is guessed). An older
 *   app (v14) would drop imports on a re-save.
 * v16 (2026-11, spec 065): Person/Partnership.confirmed (facts confirmed by
 *   hand from a scan, each with its day and the value it was confirmed with)
 *   and Person/Partnership.researchVerify (the research's re-verification of
 *   facts: confirmed, waiting, last checked). Additive; existing trees get
 *   neither. An older app (v15) keeps persons whole but would show a
 *   confirmed fact as unconfirmed and drop the mark from its GEDCOM export,
 *   so the bump makes it warn first. The value the research's confirmation
 *   holds for (ResearchFactVerify.value) came within v16 without a bump: an
 *   entry without it is filled when the tree is read, from the research's
 *   kept copy of the tree, else from the current value.
 * v17 (2026-11, spec 073): StromData.tableViews (saved views of the Table
 *   view). Additive; existing trees get none. An older app (v16) ignores the
 *   field and would drop it on a re-save, so the bump makes it warn first.
 * v18 (2026-11, spec 075): Source.callNumber, Source.folio, Source.image
 *   (where the entry stands, field by field); Source.reference is then the
 *   rest of the location. Additive: an existing source keeps its whole
 *   location in reference, nothing is split by itself. An older app (v17)
 *   keeps sources whole but would write neither the folio nor the image to
 *   its GEDCOM export (only the reference), so the bump makes it warn first.
 * v19 (2026-11, spec 077): the reliability of a single citation
 *   (Person/Partnership/LifeEvent/CoupleEvent.citationQuay) where it differs
 *   from its source's; Source.quality is the source's default. A page cited
 *   with another QUAY is no longer a source of its own: the sources an import
 *   of 3.26 made only for that are joined back into their entry when the
 *   tree is read (src/citation-quality.ts, a backup first). An older app
 *   (v18) would show and export the source's QUAY at every citation, so the
 *   bump makes it warn first.
 * v20 (2026-11, spec 085): one event of several persons (a census household,
 *   a residence, a move): a copy at each person with a common
 *   LifeEvent.shareId (+ the copy's own shareRole), written to every copy at
 *   once (src/shared-events.ts); a person's own record of a part at
 *   another's event (LifeEvent.roleAt, types 'godparent' / 'weddingWitness');
 *   EventParticipant.linkRejected. Nothing is joined by itself: copies that
 *   are the same stay separate events; invalid shares and roles are cleaned
 *   when the tree is read, a backup is taken first. An older app (v19) would
 *   edit one copy alone and the copies would go apart, so the bump makes it
 *   open the tree read-only.
 */
export const STROM_DATA_VERSION = 20;

/** The rows of a saved Table view (spec 073 §2; events and sources come later). */
export type TableViewRowType = 'persons' | 'unions' | 'events' | 'sources';

/**
 * A saved view of the Table view (spec 073 §9.1). The filter items are the
 * table's own (src/ui/table-view/table-filter.ts); a sort key's `dir` is 1
 * (ascending) or -1. `unions` only for the People rows (§3.2).
 */
export interface TableView {
    id: string;
    name: string;
    rowType: TableViewRowType;
    columns: { id: string; width?: number }[];
    pinned: number;
    collapsedGroups: string[];
    coverageRow: boolean;
    filter: { op: 'and'; items: Record<string, unknown>[] };
    sort: { col: string; dir: 1 | -1 }[];
    unions?: { collapsed: boolean; except: string[] };
    /** ISO time of the last save. */
    updated: string;
}

/**
 * Manual corrections of the lineages (rody, see src/lineage.ts), by person id.
 * A person is in at most one list (founders wins when both name it).
 */
export interface LineageOverrides {
    /** People who start a lineage of their own: their line parent is cut. */
    founders?: string[];
    /**
     * People who do not pass their lineage on: their children's lines start
     * with the children (used to move a lineage's founder down the line).
     */
    notCarriers?: string[];
}

/**
 * A finding of the tree check marked "not an error" ("two different people"
 * for a possible duplicate): it is not reported again while its key — `kind`
 * + `persons` + `subject` (qualityFindingKey in validation.ts) — stays.
 */
export interface QualityDismissal {
    /** The finding's type (ValidationIssue.type), e.g. 'possibleDuplicate'. */
    kind: string;
    /** The ids of its people in this tree, sorted. */
    persons: string[];
    /**
     * What the finding is about beyond its people (qualityFinding): the year
     * of an event or a wedding after death (four digits), a godparent's name.
     */
    subject?: string;
    /** When it was marked (ISO time). */
    at: string;
    /**
     * Where the mark stands with the research (a research tree whose bridge
     * takes `quality.dismiss`): sent and confirmed, waiting for the bridge, or
     * kept in the app only (a person without the research's REFN, or refused).
     * Absent: not a matter of the research (no research, an older one).
     */
    sync?: 'sent' | 'queued' | 'app';
    /** Marked in the research itself (its terminal), read from `GET /quality`. */
    by?: 'research';
}

/**
 * A spelling group the research suggested and the user rejected (spec 021
 * §4.4): not offered again, by the research's `id` of the suggestion or by
 * the same spellings. Goes to the research with the next send of changes
 * (GEDCOM header NOTE "Strom surname-variant rejections").
 */
export interface SurnameRejection {
    /** The spellings of the rejected suggestion. */
    forms: string[];
    /** The research's id of the suggestion (opaque; never made by the app). */
    id?: string;
    /** When it was rejected (ISO time); absent for one read from a file. */
    at?: string;
    /** Decided in the research itself (read with its version of the tree). */
    by?: 'research';
}

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
    /**
     * The town the location was found by, when the full name was not found
     * and the place holds a house ("Bělokamen 16" → "Bělokamen"): the point
     * stands at the town, not at the house. Older builds ignore it.
     */
    byTown?: string;
    /** How many towns of that name the geocoder offered, only when more than one (the nearest was taken). */
    townChoices?: number;
    /**
     * Who put the place there (spec 034): 'hand' = picked or placed by hand,
     * 'map' = taken from the geocoder in bulk. Absent on locations written by
     * older builds — read as 'map', which cannot be told apart anymore.
     */
    origin?: 'hand' | 'map';
    /** When the location was written (ISO date). */
    at?: string;
    /**
     * The location's hash (placeGeoHash) when a check warning was answered
     * "Keep": the check stays silent while the location is the same.
     */
    keptAt?: string;
}

/** A name of a research place record, with the language and years it was used in. */
export interface PlaceRecordName {
    name: string;
    lang?: string;
    from?: number;
    to?: number;
    /**
     * What the name is to the place (research 1.25): `form` a way the facts
     * write it, `alt` another name (another language, an old name). Absent:
     * not said (an older research) — read as an old name, as before.
     */
    kind?: PlaceRecordNameKind;
}

/** Kinds of a place record's other names: a spelling of the facts or another name. */
export type PlaceRecordNameKind = 'form' | 'alt';

/** Kinds of jurisdictions a research place record names (parish, civil district…). */
export type PlaceJurisdictionKind = 'parish' | 'civil' | 'diocese' | 'manor' | 'district' | 'county' | 'state' | 'other';

/** A jurisdiction of a place over a span of years ("parish Lhotov from 1784"). */
export interface PlaceJurisdiction {
    kind: PlaceJurisdictionKind;
    name: string;
    from?: number;
    to?: number;
}

/** Who identified a research place: the research, a person in the research, or taken from elsewhere. */
export type PlaceRecordBy = 'research' | 'person' | 'adopted';

/**
 * A place identified by Strom Research (spec 034), read from its GEDCOM
 * (`0 @L0012@ _STROM_PLACE`). Owned by the research: replaced whole by every
 * new research version, never edited or exported by the app.
 */
export interface PlaceRecord {
    /** The research's id, "L" + digits. */
    id: string;
    /** Names, today's first; older and other-language names after it. */
    names: PlaceRecordName[];
    coords?: { lat: number; lon: number };
    jurisdictions?: PlaceJurisdiction[];
    /** The place this one lies in (a part of a town → the town), its record id. */
    parent?: string;
    by?: PlaceRecordBy;
    /** When it was identified (ISO date). */
    at?: string;
    /** Why here, in the research's words. */
    why?: string;
    source?: { title: string; url?: string };
    /** When the location was confirmed (ISO date); absent = not confirmed. */
    verified?: string;
    /** Why the place could not be located, when it could not ('' = no reason given). */
    unlocated?: string;
    /** What would help to locate it. */
    needs?: string;
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
    /**
     * The view the tree opens in (1101): undefined = the family view, 'last' =
     * the view last used with this tree on this device (kept there, never here).
     */
    defaultView?: 'last';

    /** Coordinates for places, keyed by placeKey(). Filled in by geocoding (opt-in). */
    places?: Record<string, PlaceGeo>;

    /** Places identified by Strom Research, keyed by their id "L…" (spec 034). Research trees only. */
    placeRecords?: Record<string, PlaceRecord>;
    /** Which research place record each place of the facts is, keyed by placeKey(). */
    placeRefs?: Record<string, string>;
    /**
     * Other names of a place written down by "Unify" (spec 034 §4): the old
     * spellings of the facts that now name the place, keyed by the placeKey()
     * of the place they were unified into. The search of the Places dialog
     * finds the place under them and a fact written so again joins the place.
     */
    placeAliases?: Record<string, string[]>;

    /**
     * Surnames that mean the same family, written down once for the whole tree:
     * [['Fíšek', 'Fyšek', 'Fischek']].
     *
     * A spelling is a fact about the NAME, not about one person — the same way a
     * place's coordinates belong to the place and not to whoever was born there.
     * Kept here so it is entered once and holds for everybody, including people
     * added later; on a person it would have to be repeated for every one of
     * thirty Fíšeks, in both directions, and the thirty-first would miss out.
     *
     * A group is an equivalence, not "canonical + variants": nobody's spelling
     * is the wrong one, and the registers disagree in every direction.
     */
    surnameVariants?: string[][];

    /**
     * Spelling groups suggested by the research and rejected here (spec 021
     * §4.4, data version 13). Never offered again.
     */
    surnameRejections?: SurnameRejection[];

    /**
     * Findings of the tree check marked "not an error" (spec 021 K1.5, data
     * version 13): not reported again. Newest last.
     */
    qualityDismissed?: QualityDismissal[];

    /**
     * Manual corrections of the lineages (data version 14): founders set by
     * hand and lines split off. Absent or empty = the lineages as computed.
     */
    lineageOverrides?: LineageOverrides;

    /**
     * Saved views of the Table view (spec 073 §9.1, data version 17): row
     * type, columns, pinning, collapsed groups, coverage row, filter, sort
     * and the union sub-rows. The built-in views are not stored. Absent or
     * empty = none saved.
     */
    tableViews?: TableView[];

    /**
     * When Strom Research wrote what the people's `research` says (GEDCOM
     * header `_STROM_ASOF`, ISO date): "as of". Research trees only.
     */
    researchAsOf?: string;

    /**
     * The research's lines and side branches (GEDCOM header, spec 073 §16.9).
     * Research trees only; never leaves the app.
     */
    researchDirections?: ResearchDirections;

    /**
     * The GEDCOM files loaded into this tree (data version 15, spec 066),
     * oldest first. People, facts, links and sources name them by id.
     */
    imports?: ImportRecord[];

    // Last focused state (used when defaultPersonId === LAST_FOCUSED)
    lastFocusPersonId?: PersonId;
    lastFocusDepthUp?: number;
    lastFocusDepthDown?: number;
}

/**
 * How the tree is drawn. 'family' is the default focus-centric view; the others
 * are alternative readings of the SAME selection of people ('descendants'
 * chart, 'timeline' life-bars, 'fan' ancestor chart, 'map' of their places).
 * 'table' lists the whole tree (every real person or union) as rows.
 */
export type ViewMode = 'family' | 'descendants' | 'timeline' | 'fan' | 'map' | 'table';

/** Views drawn by something other than the layout pipeline (own containers). */
export const STANDALONE_VIEWS: readonly ViewMode[] = ['timeline', 'fan', 'map', 'table'];

// ==================== UI TYPES ====================

export type RelationType = 'parent' | 'child' | 'partner' | 'sibling';

export interface RelationContext {
    personId: PersonId;
    relationType: RelationType;
    /** The new relative's sex when the slot says it (the fan's father / mother sector). */
    gender?: Gender;
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
    /** Known to have died (the "Deceased" box); kept only without a death date, which says so by itself. */
    isDeceased?: boolean;
    /** The titles of the name ("Ing.", "ml."), set with the person so its first undo step names them. */
    titleBefore?: string;
    titleAfter?: string;
    /** The surname after marriage (Person.marriedSurname). */
    marriedSurname?: string;
    /** Which surname the person goes by (Person.primaryName); only with a married surname. */
    primaryName?: PrimaryName;
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
    /**
     * Where partner lines run, from the card's top (px). Unset: the card's
     * middle. The custom card taller than one row a detail keeps it at its
     * header (src/card-width.ts customCardSpouseLineY).
     */
    spouseLineY?: number;
    /**
     * Card height per person (custom card "by content"). A person missing
     * here has cardHeight. Unset: every card is cardHeight tall. Each
     * generation band is as tall as its tallest card; cards stand top-aligned
     * in it (LayoutResult.bands). Meant together with spouseLineY, so the
     * partner line runs at the same height on every card of a row.
     */
    personHeights?: ReadonlyMap<PersonId, number>;
    /**
     * The dense spacing (Settings → Spacing → Dense, DENSE_LAYOUT_CONFIG):
     * bus lanes stay at most one lane below a gap's middle; a gap that needs
     * more lanes grows instead (step 7, bands.ts). Unset: the normal spacing.
     */
    dense?: boolean;
    /**
     * Room the screen keeps under a row for something drawn there (the
     * button of a family outside the tree under its top couple): for each
     * set of persons, the gap below the top generation that holds one of
     * them laid out is at least `px` tall (bands.ts roomBelowExtra). Unset:
     * every gap is verticalGap (plus the dense lanes' growth).
     */
    roomBelow?: ReadonlyArray<{ personIds: ReadonlySet<PersonId>; px: number }>;
}

/** The partner line's distance from the card's top: the set offset, else the card's middle. */
export function spouseLineOffset(config: Pick<LayoutConfig, 'cardHeight' | 'spouseLineY'>): number {
    return config.spouseLineY ?? config.cardHeight / 2;
}

/** The height of one person's card: its own (personHeights), else cardHeight. */
export function personCardHeight(config: Pick<LayoutConfig, 'cardHeight' | 'personHeights'>, personId: PersonId): number {
    return config.personHeights?.get(personId) ?? config.cardHeight;
}

/**
 * How much a person card shows (src/card-fields.ts CARD_DENSITIES). Compact
 * and Normal are cards of a fixed size (CARD_SIZE: the layout engine must be
 * told, spacing is computed from it); Detailed and Register draw the lines of
 * their preset fields and Custom the user's own, as wide and as tall as the
 * view's texts (src/card-width.ts).
 */
export type CardDensity = 'compact' | 'normal' | 'detailed' | 'register' | 'custom';

/**
 * Card box per fixed density. Keys match LayoutConfig on purpose so the values can be
 * spread straight into it — with `width`/`height` names the spread silently did
 * nothing and the engine kept spacing for the default card.
 * MUST match the CSS for .person-card at each density.
 */
export const CARD_SIZE: Record<'compact' | 'normal', Pick<LayoutConfig, 'cardWidth' | 'cardHeight'>> = {
    // "Letopis" card: a 34px avatar + a two-row text column (name + meta).
    // compact drops the avatar and meta (names only), so it is shorter and
    // narrower. MUST match the CSS for .person-card at each density.
    compact: { cardWidth: 150, cardHeight: 44 },
    normal: { cardWidth: 188, cardHeight: 64 },
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

/**
 * Spacing of the tree view (Settings → Person card → Spacing): the normal
 * gaps between cards and generations, or tighter ones that fit more cards
 * into the view. A setting of this device, never stored with the tree data.
 */
export type TreeSpacing = 'normal' | 'dense';

/**
 * The dense spacing: the same cards, smaller gaps. Everything derived from
 * the gaps (couple and chain widths, generation bands, the bus in the middle
 * of a gap) follows by itself; `dense` caps the bus lanes (step 7).
 */
export const DENSE_LAYOUT_CONFIG: LayoutConfig = {
    ...DEFAULT_LAYOUT_CONFIG,
    horizontalGap: 20,
    verticalGap: 48,
    partnerGap: 14,
    dense: true,
};

/** The layout configuration of a spacing (card size still to be spread over it). */
export function layoutConfigFor(spacing: TreeSpacing): LayoutConfig {
    return spacing === 'dense' ? DENSE_LAYOUT_CONFIG : DEFAULT_LAYOUT_CONFIG;
}

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
    | 'place.split'
    | 'quality.dismiss'
    | 'quality.restore'
    | 'fact.confirm'
    | 'fact.unconfirm'
    | 'surname.reject'
    | 'surname.unreject'
    | 'surname.accept'
    | 'surname.unaccept'
    | 'lineage.founder'
    | 'lineage.split'
    | 'surnames.removeForm'
    | 'tableView.save'
    | 'tableView.rename'
    | 'tableView.delete'
    | 'undo'
    | 'redo'
    /** An edit made in a satellite window, saved by the main window (spec 079). */
    | 'window.edit';

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
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '3.28.0';

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
    return `exp_${Date.now()}_${uniqueIdSuffix()}`;
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

/**
 * Which surname a name shows (Settings → "Surname display"): the birth surname
 * (lastName); the married one (Person.marriedSurname) with the birth surname
 * as a note ("Marie Nováková (roz. Dvořáková)"); the married one alone. A
 * person without a married surname shows the birth surname in all three.
 */
export type SurnameDisplay = 'birth' | 'both' | 'married';
/** Which surname a person goes by (Person.primaryName): the birth one or the married one. */
export type PrimaryName = 'birth' | 'married';
/** Whether a value is a valid Person.primaryName. */
export function isPrimaryName(v: unknown): v is PrimaryName {
    return v === 'birth' || v === 'married';
}

/**
 * Which surname a person kept by a merge goes by (Person.primaryName): the
 * choice travels with the married surname the kept person ends up with.
 * `keptMarriedBefore` is the kept person's married surname before the merge.
 * When it stayed, her own choice stays, and without one the other person's
 * comes along if its married surname is the same; when the other person's
 * married surname replaced it (filled a gap or won a conflict), the other's
 * choice comes along, her own one stays without it. Never one without a
 * married surname.
 */
export function mergedPrimaryName(
    kept: Pick<Person, 'marriedSurname' | 'primaryName'>,
    other: Pick<Person, 'marriedSurname' | 'primaryName'>,
    keptMarriedBefore: string | undefined,
): PrimaryName | undefined {
    const married = kept.marriedSurname?.trim();
    if (!married) return undefined;
    const own = isPrimaryName(kept.primaryName) ? kept.primaryName : undefined;
    const theirs = isPrimaryName(other.primaryName) && other.marriedSurname?.trim() === married ? other.primaryName : undefined;
    if (keptMarriedBefore?.trim() === married) return own ?? theirs;
    return theirs ?? own;
}
export const SURNAME_DISPLAYS: readonly SurnameDisplay[] = ['birth', 'both', 'married'];
export type LanguageSetting = 'en' | 'cs' | 'de' | 'pl' | 'system';

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
    whatsNewAfterUpdate?: boolean;  // default: true - the "What's new" dialog at the first start of a new version
    /** Before 3.26: the ⇄ pill on cards (default true). Read only once, to bring it to `strom-card-signals.crossTree` (spec 066 P4 §8). */
    crossTreeBadges?: boolean;
    fanKekule?: boolean;  // default: false - show Kekule (ahnentafel) numbers in the fan chart
    lifelineChildEvents?: boolean;  // default: false - person card's life timeline also lists the children's events (fallback of every tree, see lifelineByTree)
    historyLayer?: boolean;  // default: true (undefined = never chosen) - the research's events of the time in the life timeline (spec 020)
    lifelineHistory?: boolean;  // default: true - the card's "History" chip (shown only while historyLayer is on; fallback of every tree)
    /**
     * Per tree (spec 020 K4.5): the card timeline's default set in the tree's settings; absent = the two values above.
     * `kinds` (K8.6): only the kinds of history this tree shows otherwise than the three values below.
     */
    lifelineByTree?: Record<string, { childEvents?: boolean; history?: boolean; kinds?: { region?: boolean; place?: boolean; local?: boolean } }>;
    /** Per tree (spec 039): the family line chosen in the tree view (its id), kept until ended by ×. A view setting of this device, not tree data. */
    rodByTree?: Record<string, string>;
    historyKindRegion?: boolean;  // default: true - the card's timeline shows regional history (spec 1028 §6)
    historyKindPlace?: boolean;   // default: true - the card's timeline shows the history of a place (with history.place)
    historyKindLocal?: boolean;   // default: true - the card's timeline shows findings from the research's sources
    historyStripClosed?: boolean;  // default: false - the card's "history not searched yet" line was closed (spec 020 K1.6)
    historyPlacesSort?: 'persons' | 'alpha';  // default: 'persons' - History of places → Places: all places by people or alphabetically
    placesSort?: 'state' | 'name' | 'people';  // default: 'state' - Places dialog order (a stored 'unplaced' reads as 'state')
    cardDensity?: CardDensity;  // default: 'normal' - how much detail a card shows
    exportScope?: 'tree' | 'view';  // default: 'tree' - the export dialog's whole tree / current view switch
    treeSpacing?: TreeSpacing;  // default: 'normal' - gaps between cards and generations in the tree view
    posterSpacing?: TreeSpacing;  // default: 'normal' - the same for an exported image, poster or PDF
    /** The custom density's lines (src/card-fields.ts); set the first time "Custom" is chosen. */
    cardFields?: import('./card-fields.js').CardFieldSettings;
    familyButton?: boolean;  // default: false - toolbar shortcut to the family wizard
    descendantsFullFamilies?: boolean;  // default: false - descendants view shows partners' other families
    showTitles?: boolean;  // default: true - titles before/after the name (Person.titleBefore / titleAfter) shown with it
    /** Settings `display.reliabilityCard` (spec 066 §2f), default: true - the reliability marks on the person card. */
    reliabilityCard?: boolean;
    /** Before 3.26: the reliability mini mark on the tree cards (default false). Read only once, into `strom-card-signals.status` (spec 066 P4 §8). */
    reliabilityTree?: boolean;
    surnameDisplay?: SurnameDisplay;  // default: 'both' - which surname names show (Person.lastName / marriedSurname)
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
    return `tree_${Date.now()}_${uniqueIdSuffix()}` as TreeId;
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
    /**
     * The data version of the stored record (written with every save, put
     * right at every read). Above STROM_DATA_VERSION: a newer app saved the
     * tree, so this one opens it read-only and never writes it — also before
     * it was read in this window.
     */
    dataVersion?: number;
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
     * "Start research with this tree" is under way: the one-time token the
     * research brings back (?adopt=) to name this tree. Valid for an hour.
     */
    researchAdoptToken?: { token: string; at: string; install?: true };
    /**
     * The guessed sexes of a research tie from before data version 12
     * (ResearchLink.sexU: reference number → the app's stand-in sex) and when
     * they turned Unknown (ms epoch): a backup taken before that time turns
     * them Unknown the same way when it is restored (N31).
     */
    legacySexU?: { map: Record<string, string>; at: number };
    /**
     * The tree was downloaded to move to another browser for the research
     * (research-transfer.ts), or from a phone to a computer (`mobile`). The
     * copy left here says so (banner, then a question at every opening) until
     * it is removed or the move did not happen.
     */
    researchTransfer?: { at: string; mobile?: true };
    /**
     * Automatic backups (daily, before import / merge) for this tree. Missing =
     * on. Off for a tree the user keeps elsewhere, or whose scans make every
     * backup heavy; manual backups still work.
     */
    autoBackups?: boolean;
    /** The "backups too big for this device" advice was shown (it is shown once). */
    backupsTooBigNoticed?: boolean;
    /** Research edge above the cards: off / only what waits for the user / all (missing = all). */
    researchEdges?: ResearchEdgeMode;
    /** The edge moves while the agent works on it (missing = on; live only). */
    researchEdgeMotion?: boolean;
    /** Last edit of the user's (ISO). With fileCopyAt: edits no file holds (src/file-copy.ts). */
    changedAt?: string;
    /** Last full copy in a file: a full export, the working file, or the file it was imported from (ISO). */
    fileCopyAt?: string;
    /** The "changes only in the browser" notice was closed for this tree (ISO); it returns after the next file copy. */
    fileCopyNoticeClosedAt?: string;
    /** The last choice of "Save as HTML" on a person page (spec 025): content groups and privacy. */
    personPageExport?: {
        groups: import('./person-page.js').PersonPageGroups;
        privacy: import('./privacy.js').PrivacyMode;
        /** The contents "On this page" in the file (missing = on). */
        toc?: boolean;
    };
}

/** How much of the research edge the tree shows (Settings → Tree). */
export type ResearchEdgeMode = 'off' | 'mine' | 'all';

/** Link between a local tree and the Strom Research tree it was opened from. */
export interface ResearchLink {
    /** The research tree's UUID (lower case). */
    id: string;
    /** Content fingerprint of the tree right after the last import/update. */
    fingerprint: string;
    /** ISO time of the last import/update. */
    syncedAt: string;
    /** Commit of the research at the last update (the file header or the live bridge). */
    head?: string;
    /**
     * An older copy of the research (the tree kept by "Open as a new copy", a
     * duplicate, a second import): offered when sending changes back, never
     * updated from the research — only the tree without `copy` is.
     */
    copy?: boolean;
    /** The last send straight to the bridge and what became of it (a research that announces `accepts`). */
    sent?: ResearchSend;
    /**
     * The bridge refused the last send at once, with its reason (cleared by the next good send or an update).
     * `held`: refused for what the research itself has to settle first (sealed elsewhere, files not downloaded,
     * a full disk), with its own sentence; nothing goes again until the user sends.
     */
    refused?: { reason: string; at: string; held?: ResearchWriteHeld };
    /**
     * How the research takes the user's transcripts (Research for this tree):
     * 'lead' (default) — it checks them by its own reading; 'evidence' — a
     * transcript is the first reading. Survives updates from the research.
     */
    transcripts?: ResearchTranscripts;
    /** When `transcripts` was set to 'evidence' (ISO). */
    transcriptsAt?: string;
    /**
     * Sources already sent when the tree switched to 'evidence', by id → the
     * hash of their transcript and page then: the switch does not reach back,
     * so these keep "Transcription verified" until they change.
     */
    olderSources?: Record<string, string>;
    /** Sources in the last accepted send, by id → hash of transcript and page (see olderSources). */
    sentSources?: Record<string, string>;
    /**
     * Sending changes to the research: by themselves after a quiet while
     * ('auto'; missing on a tree tied before 3.9), with the Send button
     * ('manual', a new tie's default) or never ('off': only load from the
     * research, when the user asks). Survives updates from the research.
     */
    sendMode?: ResearchSendMode;
    /**
     * Out of "only load" with changes made meanwhile: the first send goes by
     * hand through "What will be sent" (nothing by itself until then).
     * Survives updates from the research.
     */
    previewDue?: true;
    /**
     * Send original files to the research (the tree keeps a preview); false
     * turns it off for this tree. Missing = on. Survives updates from the research.
     */
    sendMedia?: boolean;
    /**
     * Load a source's image the research left out of its file when the source
     * is opened (while its bridge runs here); false turns it off for this
     * tree. Missing = on. Survives updates from the research.
     */
    autoLoadImages?: boolean;
    /**
     * The research works without an agent (an archive of the user's data), as
     * the file it came from said (`_STROM_MODE archive`); a running bridge's
     * status says it more freshly. Missing: with an agent.
     */
    mode?: 'archive';
    /**
     * The copy went over (or was refused as `tree.no-ids`) without the
     * research's numbers for its people: a send would read there as a second
     * family tree, so none goes until they come (its `tree.ged`). Cleared by
     * any load of the research's version.
     */
    awaitingIds?: true;
    /**
     * The research has had this tree's titles (Person.titleBefore /
     * titleAfter): the `intake` of the send that wrote them there with a
     * research that keeps titles (its time when it had no mark), 'adopt' for a
     * hand-over that carried them, 'load' for a version of such a research
     * that had every title of the tree. Missing: they never went (a research
     * that did not know titles, 1.12, or one not asked yet) — a title its
     * version lacks is then kept here and goes with the next send (B18-1).
     * Survives updates from the research.
     */
    titlesIn?: string;
    /**
     * The bridge's ETag of the file this tree was last loaded from (a bridge
     * with `ged.etag`), with the base that load gave the tree: asked again
     * with `If-None-Match` while the tree is still that load unchanged. Any
     * other load replaces the link and drops it (setResearchLink).
     */
    treeEtag?: ResearchTreeEtag;
}

/** The ETag of the research's file a tree holds (ResearchLink.treeEtag). */
export interface ResearchTreeEtag {
    /** The `ETag` the bridge sent with the file, verbatim. */
    tag: string;
    /** The link's head the load gave (ResearchLink.head; '' without one). */
    head: string;
    /** The link's fingerprint the load gave (ResearchLink.fingerprint). */
    fingerprint: string;
    /** The file's images were taken (the import setting then): reused only while the setting is the same. */
    images: boolean;
    /** The file's variant: `ref` its images by their hash (`ged.imagesByHash`); absent: with them in it. */
    variant?: 'ref';
}

/** A research's file with its images by their hash (`ref`) or in it (`data`). */
export type TreeImagesVariant = 'ref' | 'data';

/** How changes go to the research (see ResearchLink.sendMode). */
export type ResearchSendMode = 'auto' | 'manual' | 'off';

/** How the research takes the user's transcripts (see ResearchLink.transcripts). */
export type ResearchTranscripts = 'lead' | 'evidence';

/** A send straight to the research's bridge and its fate in the research's inbox. */
/**
 * A write the research does not take until something there is settled:
 * the tree sealed on another computer (`seal`), files of a cloud folder not
 * downloaded yet (`cloud`), no room on its disk (`disk`). `said`: the
 * research's own sentence (its language); '' when only its status said it.
 */
export interface ResearchWriteHeld {
    kind: 'seal' | 'cloud' | 'disk';
    said: string;
    /** `cloud`: files not downloaded yet, when said. */
    n?: number;
}

export interface ResearchSend {
    /** Content fingerprint of the tree as sent (also `_STROM_SENT` in the file). */
    fingerprint: string;
    /** When it was sent (ISO). */
    at: string;
    /** Changes the research counted; null when it did not say. */
    changes: number | null;
    /** The research's head when it was sent ('' = unknown). */
    head: string;
    /** In the research's inbox / written / discarded there by the user / written and then taken back there (`strom sync undo`). */
    state: 'pending' | 'written' | 'discarded' | 'undone';
    /** When it was found written or discarded (ISO). */
    closedAt?: string;
    /** "Send, then load": load the research's new version once this is written. */
    thenLoad?: boolean;
    /** The "discarded" notice was shown (it is shown once). */
    noticed?: boolean;
    /** The research's mark of the send (`intake` of the /sync reply), to find it in `/status.sends`. */
    intake?: string;
    /** Why the user discarded it in the research ('' = not said). */
    reason?: string;
    /** The research is still writing it (a 202 reply): its end comes in the status. */
    writing?: boolean;
    /** Conflicts this send left to decide in the research (written with an agent). */
    conflicts?: number;
    /** Sent with the Send button (its result is told by a toast), not by itself. */
    manual?: boolean;
    /** Discarded because the research could not write it (`failed`), not by the user. */
    failed?: boolean;
    /** Taken back: changes of a later copy the research left out because this send brought them (`takenBack`). */
    takenBack?: number;
    /** Written at once: the research's head after the write (its version holds this copy). */
    replyHead?: string;
    /**
     * The research had nothing this tree lacked when it went (its head was the
     * version loaded here or this tree's own last write): its write is this
     * tree's own version, not a newer one to load (`ownHead` of the sync state).
     */
    ownBase?: boolean;
    /**
     * Written as part of a newer send of this tree that replaced it (another
     * window of the same app tree sent since): what was written is not this
     * window's state, so the research's version is not loaded quietly.
     */
    inherited?: boolean;
    /** It carried the titles (a NAME line with NPFX / NSFX to a research that keeps them): written, the research has them (ResearchLink.titlesIn). */
    titles?: true;
}

/**
 * What a tree's data builds on in its research: the research head it was
 * loaded at and the content fingerprint it had then. It belongs to the data —
 * stored with it, restored with it — because data older than its head would
 * read to the research as edits taking back what it changed since.
 */
export interface ResearchBase {
    head: string;
    fingerprint: string;
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

