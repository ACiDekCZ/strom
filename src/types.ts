/**
 * Strom - Type Definitions
 * Branded types for type-safe IDs and comprehensive interfaces
 */

// Only types live here: a change to this file needs the typecheck, not the
// tests that run the code. Runtime values and helpers of the model are in
// src/ids.ts, src/model-values.ts, src/layout-config.ts and src/version.ts
// (STROM_DATA_VERSION with its history, APP_VERSION).
import type { LAST_FOCUSED, PARTNERSHIP_CITATION_FIELDS, PERSON_CITATION_FIELDS } from './model-values.js';

// Kept for readers outside the app that take the data version of a checkout
// from this file (the research's tests of the app's GEDCOM path). App code
// imports it from src/version.ts, so no module of the app loads this file.
export { STROM_DATA_VERSION } from './version.js';

// ==================== BRANDED TYPES ====================

/** Branded type for Person IDs - prevents mixing with other string IDs */
export type PersonId = string & { readonly __brand: 'PersonId' };

/** Branded type for Partnership IDs */
export type PartnershipId = string & { readonly __brand: 'PartnershipId' };

// ==================== CORE ENTITIES ====================

/**
 * A person's sex. 'unknown' (GEDCOM SEX U, or no SEX at all) is a sex the
 * records do not give: nothing guesses one for it (data version 12).
 */
export type Gender = 'male' | 'female' | 'unknown';

/** Shape of the lineage marker on cards (spec 112, R1); 'none' draws none. */
export type BranchMarker = 'arc' | 'tag' | 'stripe' | 'corner' | 'none';

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
    /** The citation the user chose as the fact's main one (see CitationMain, data v21). */
    citationMain?: CitationMain<'sourceIds'>;
    /** Godparents, witnesses, the officiating priest… (see EventParticipant). */
    participants?: EventParticipant[];
    /** The research's status of the event (see FactStatus). */
    status?: FactStatus;
    /**
     * The e-mail addresses the GEDCOM file gave under the event (`2 EMAIL`,
     * MyHeritage's contact under RESI), as written. They are the person's
     * contact (Person.emails, data v26); "Back to {prog}" writes each back as
     * `2 EMAIL` under this event while the contact still has it. A tree of an
     * older app had each as a line of the note ("E-mail: …") too, written
     * back while that line was still there.
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

/**
 * The edits of a portrait over its original (spec 107), applied in this
 * order: mirror, quarter turns, straighten, crop. The math lives in
 * src/photo.ts (portraitRect, clampPortraitCrop…).
 */
export interface PortraitCrop {
    /**
     * The frame (a square in pixels) in fractions of the image after the
     * mirror and the quarter turns, from the top left: w × width = h × height.
     * w, h ≤ 1; the frame may reach past the image's edge (x < 0, x + w > 1…)
     * as long as its centre lies on the image — the part off the image is
     * PORTRAIT_EMPTY_FILL in the portrait.
     */
    region: { x: number; y: number; w: number; h: number };
    /** Clockwise turn in quarter turns (none = upright). */
    quarterTurns?: 1 | 2 | 3;
    /** Straightening in degrees, −45…45 in steps of 0.5; positive = clockwise, about the frame's centre. */
    angle?: number;
    /** Mirrored horizontally (before the turns). */
    mirror?: true;
}

/**
 * Where a portrait was cut from (Person.photoSource): exactly one of an image
 * attachment of the same person or a union's photo (Partnership.photo), with
 * the crop. JSON and backups only, never GEDCOM; patterned on
 * SourceExcerpt.fromAttachmentId + region.
 */
export interface PortraitSource extends PortraitCrop {
    /** An image file of the same person (StromData.media, a place of the person)… */
    attachmentId?: string;
    /** …or the photo of one of the person's unions (Partnership.photo). */
    partnershipId?: PartnershipId;
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
     * The image number is the research's, found from the scans it keeps of the
     * entry, not written by anyone (GEDCOM `2 _STROM_DERIVED Y` under
     * `_STROM_IMAGE`). The location may then name another image (an index's
     * page) on purpose: composing the PAGE cuts nothing of it, it only adds
     * the image when the location does not say it (src/source-location.ts).
     * Dropped when the image is changed by hand.
     */
    imageDerived?: boolean;
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
    /**
     * The events the record records, as GEDCOM tags in upper case (GEDCOM
     * 5.5.1 EVENTS_RECORDED, `1 DATA / 2 EVEN CHR, BURI` on the source
     * record), e.g. `["CHR"]` for a baptism entry (data v21). A citation of
     * such a record at a fact of that event is its primary record in the
     * order of a fact's citations (src/citation-order.ts).
     */
    events?: string[];
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
    /** The file's title (spec 102 K1.1); missing or empty = none, the file's name stands for it. */
    title?: string;
    /** What the file is (spec 102), as the research's materials say it. */
    kind?: MaterialKind;
    /** Who gave the title, the date and the kind (spec 102 §13: an agent never overwrites a person's); missing = 'user'. */
    titleBy?: MediaBy;
    dateBy?: MediaBy;
    kindBy?: MediaBy;
    /**
     * Where the file is in the tree, in the order it was put there (data v24):
     * a person, a person's fact or event, a couple, a couple's event or a
     * source. Empty only on a record taken out of the tree (`removed`).
     */
    places: MediaPlace[];
    /** Taken out of a tree linked to an archive (spec 102 §9): the places it had, for "Restore". */
    removed?: { at: string; reason?: 'unrelated' | 'duplicate'; places: MediaPlace[] };
    /** When the file came into the tree (ISO); missing = earlier. */
    addedAt?: string;
}

/** What a file of the tree is (spec 102): the same words as the research's materials. */
export type MaterialKind = 'photo' | 'document' | 'record' | 'other';

/** Who gave a file's detail: a person or the research's agent (spec 102 §13). */
export type MediaBy = 'user' | 'agent';

/**
 * One place of a file in the tree (data v24, StromData.media): shaped as a
 * citation's context, plus a source. Each may say who put it there (`by`,
 * spec 102 §13; missing = 'user').
 */
export type MediaPlace = (
    /** The person, their birth or death (`fact`) or one of their events (`eventId`, LifeEvent.id); at most one of the two. */
    | { personId: PersonId; fact?: 'birth' | 'death'; eventId?: string }
    /** The couple or one of its events (CoupleEvent.id). */
    | { partnershipId: PartnershipId; eventId?: string }
    | { sourceId: string }
) & { by?: MediaBy };

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
     * The research's status of the name (fact `name`, `_STROM_STATUS` under the
     * primary NAME of the research's or the app's own file); read, shown and
     * sent back as it came, never worked out here.
     */
    nameStatus?: FactStatus;
    /** …and of the name after marriage (the NAME with TYPE married that gave marriedSurname): shown quietly, no mark of the card. */
    marriedNameStatus?: FactStatus;
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
     * The person's e-mail addresses (data version 26, spec 134 K0.10): the
     * contact a GEDCOM file gives as `1 RESI` / `2 EMAIL` (MyHeritage) or
     * `1 EMAIL`, or one typed in the person editor. A contact, not an event:
     * written out as `1 RESI` / `2 EMAIL` (see src/person-contact.ts).
     */
    emails?: string[];
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
     * When the person came into the tree (ISO; spec 084 §8, data version
     * 22): written when a person is added, a GEDCOM file imported, another
     * tree merged in or the research brings a new person. Never edited by
     * hand, never guessed for older people (absent = "earlier"), never
     * written to GEDCOM.
     */
    addedAt?: string;
    /**
     * When the person was last changed (ISO; spec 136 D4): written by the
     * DataManager on every edit of the person, their events, unions and
     * citations. Absent for people not changed since it is recorded (and for
     * people only added: their time is `addedAt`). Never written to GEDCOM.
     */
    changedAt?: string;
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
    /**
     * Where the portrait was cut from (spec 107, data v23): an image attachment
     * of this person or the couple's photo of one of their unions, with the
     * crop. Only when the portrait was made in the crop editor from that
     * original; goes with the photo (a new or removed photo drops it). JSON
     * and backups only, never GEDCOM.
     */
    photoSource?: PortraitSource;
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
    /**
     * The main citation the user chose for the birth and the death (see
     * CitationMain, data v21). Never of `sourceIds`: the person's own
     * citations are no fact (an entry there is dropped when the tree is read).
     */
    citationMain?: CitationMain<PersonCitationField>;
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
    /**
     * Sources it stood on that the person deleted in the research (GEDCOM
     * 3 _STROM_RETRACTED S0042, in place of its 3 SOUR; spec 117 §8): the
     * value stays shown, its source as retracted.
     */
    retracted?: string[];
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
    /**
     * To be looked at again, as the research wrote it (GEDCOM 2 _STROM_REVIEW):
     * `source.retracted` (CONFLICT_REVIEW_SOURCE_RETRACTED) when a source it
     * stood on was deleted; a word the app does not know reads as a plain
     * "to review". Open or decided alike; its state stays (spec 117 §8).
     */
    review?: string;
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
    /** The main citation the user chose for the wedding and the divorce (see CitationMain, data v21). */
    citationMain?: CitationMain<PartnershipCitationField>;
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
    /**
     * The couple's photo (a wedding or joint picture, spec 107, data v23): a
     * JPEG data URL, longer side ≤ ATTACHMENT_MAX_SIDE, not a square. The
     * original the partners' portraits can be cut from (Person.photoSource).
     * GEDCOM: `1 OBJE` under the FAM.
     */
    photo?: string;
    /** Original file name of the couple's photo (UX only). */
    photoOriginalName?: string;
    /** The photo's date as the file it came from wrote it (GEDCOM `_DATE`, see Person.photoDate); not shown. */
    photoDate?: string;
    /**
     * The original file behind the couple's photo (spec 108 K2.4): chosen in a
     * tree whose research takes a couple's original (`accepts.media.family`),
     * the file goes there (`PUT /media` with `X-Strom-Family`) and the photo
     * names it (`2 _STROM_SHA` under the FAM's OBJE). Goes with the photo.
     */
    photoOriginal?: MediaOriginal;
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
    /** The citation the user chose as the fact's main one (see CitationMain, data v21). */
    citationMain?: CitationMain<'sourceIds'>;
    /** Witnesses and others the record names. */
    participants?: EventParticipant[];
    /** The research's status of the event (see FactStatus). */
    status?: FactStatus;
    /**
     * What kind of census another program's file wrote under the couple's
     * `1 CENS` (`2 TYPE`), as written: the first line of the note, written
     * back as `2 TYPE` while the note still begins with it (as LifeEvent.gedcomType).
     */
    gedcomType?: string;
}

/**
 * The partnership fields the relationships panel edits (DataManager.updatePartnership).
 * The couple's photo (spec 107): an empty `photo` removes it.
 */
export type PartnershipUpdates = Partial<Pick<Partnership,
    'status' | 'startDate' | 'startPlace' | 'endDate' | 'endPlace' | 'address' | 'ages' | 'note' | 'isPrimary'
    | 'photo' | 'photoOriginalName' | 'photoDate' | 'photoOriginal'>>;

// ==================== LAST FOCUSED MARKER ====================

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

/**
 * The main citation of a fact (spec 095 K2, data v21), by citation list: the
 * id of the source in that list the user chose to stand first (a source cited
 * at another place of an entry has a source of its own, so the id names the
 * citation). Set only by hand: without it the order is automatic
 * (src/citation-order.ts). An entry of a source no longer in its list says
 * nothing (dropped when the tree is read and when the citation goes). Only
 * the facts' lists have one, never a person's own citations (not a fact).
 */
export type CitationMain<F extends string = string> = Partial<Record<F, string>>;

export type PersonCitationField = typeof PERSON_CITATION_FIELDS[number];

export type PartnershipCitationField = typeof PARTNERSHIP_CITATION_FIELDS[number];

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
    /** The rows of one list of people only (spec 084 §9; not for sources). */
    scope?: { listId: string };
    /** Group headers by one value (spec 084 §10); `collapsed` holds the closed groups' keys. */
    group?: { by: TableGroupKey; collapsed: string[] };
    /** ISO time of the last save. */
    updated: string;
}

/** What the Table groups its rows by (spec 084 §10, §11). */
export type TableGroupKey =
    | 'lines' | 'rod' | 'surname' | 'bPlace' | 'bCentury' | 'bDecade' | 'gen' | 'sex' | 'occ'
    | 'addedDay' | 'addedMonth' | 'addedYear' | 'done'
    | 'wDecade' | 'wPlace' | 'uRods' | 'kids'
    | 'evType' | 'evDecade' | 'evPlace';

/**
 * The rule of a list of people (spec 084): what an automatic list is worked
 * out from each time, what a fixed list was made from ("Created from", "Add
 * from the rule"). `personName` keeps the name of the rule's person for when
 * that person is gone.
 */
export type PersonListRule =
    | { kind: 'rods'; rodIds: string[] }
    | { kind: 'ancestors'; personId: PersonId; generations?: number; personName?: string }
    | { kind: 'descendants'; personId: PersonId; generations?: number; personName?: string }
    | { kind: 'line'; directionId: string; lineName?: string }
    | { kind: 'tableFilter'; rowType: 'persons' | 'unions'; filter: TableView['filter']; sort: TableView['sort'] }
    | { kind: 'added'; days: number };

/** How the people of a list are ordered (spec 084 §5). */
export type PersonListSort = 'old' | 'gen' | 'name' | 'added' | 'manual';

/** A named list of people (spec 084, data version 22). */
export interface PersonList {
    id: string;
    /** Unique in the tree (compared without diacritics and case). Empty only for the ready-made list: its name follows its period. */
    name: string;
    /** true = automatic: the people come from the rule each time. */
    dynamic: boolean;
    rule?: PersonListRule;
    /** A fixed list's people in their manual order (kept under any other sort). */
    personIds?: PersonId[];
    /** People taken out of a fixed list by hand: "Add from the rule" does not bring them back. */
    removed?: PersonId[];
    sort: PersonListSort;
    /** A fixed list ticked off person by person (§13). */
    checklist?: boolean;
    /** The ticked-off people of this list. */
    done?: PersonId[];
    /** The ready-made "Added in the last 30 days" (§8). */
    builtin?: 'added30';
    /** ISO time of the last change. */
    updated: string;
    /**
     * A custom rule (spec 136): conditions and groups. When set, `rule` is
     * absent and the list is stored with `dynamic: false` and `personIds` =
     * the last worked-out people, so an older app sees a fixed list.
     * `auto` = kept up to date ("automatic"); false = a fixed list made from it.
     */
    custom?: CustomRule & { auto: boolean };
    /**
     * A custom rule this app cannot read whole (a newer version, a condition
     * it does not know), kept exactly as it came (spec 136 K1.8): the list is
     * fixed with its stored people meanwhile, and an app that reads the rule
     * takes it back as `custom` when it loads the tree. Never set together
     * with a readable `custom` (that one wins).
     */
    customUnknown?: Record<string, unknown>;
    /** Where the list came from (spec 136 K1.10); absent = made by hand. */
    origin?: PersonListOrigin;
}

/**
 * Where a list of people came from (spec 136 K1.10). `template` is the
 * stable id of a built-in template (src/person-list-templates.ts) or
 * `own:<id>` for a template saved on the device; `name` its name then.
 */
export type PersonListOrigin =
    | { by: 'template'; template: string; name: string; at: string }
    | { by: 'agent'; at: string; agent?: string };

/**
 * The stable, language-independent names of the conditions of a custom list
 * rule (spec 136 K1.10). Never translated, never renamed: they are stored in
 * the tree and read by the research and by agents.
 */
export type RuleCondName =
    | 'family' | 'ancestors' | 'descendants' | 'rod' | 'line' | 'list'
    | 'born' | 'died' | 'married' | 'livedIn' | 'deathAge' | 'alive'
    | 'near' | 'gender' | 'occupation' | 'has' | 'count' | 'text'
    | 'added' | 'changed' | 'tableFilter';

/** A year period of a condition; at least one end is set. Both ends are included. */
export interface RuleYears { from?: number; to?: number }

/** A period back from now (`hours` / `days`) or from a day on (`since`, YYYY-MM-DD). */
export type RulePeriod = { hours: 24 } | { days: number } | { since: string };

/** A generation count or 'all'. */
export type RuleDepth = number | 'all';

/** What `has` asks about (spec 136 §3.2). `conflict` and `openTask` are about a research tree. */
export type RuleHasWhat =
    | 'birthDate' | 'birthPlace' | 'deathDate' | 'deathPlace' | 'photo' | 'source'
    | 'parents' | 'partner' | 'children' | 'story' | 'note' | 'material' | 'conflict' | 'openTask';

/** The kinds of event `near` looks at. */
export type RuleNearEvent = 'birth' | 'death' | 'marriage' | 'residence';

/**
 * The parameters of each condition (spec 136 §3.2), by condition name.
 * Names of people, places and lists are kept beside their ids so the
 * condition can still be described when they are gone ("missing").
 * - family: a person's family by axes (§4): `up` generations through both
 *   parents or the father's / mother's side only, `down` generations, sideways
 *   the direct line, siblings or cousins (`cousins` = degree, 1 = first
 *   cousins), and spouses (none, spouses, spouses' families).
 * - ancestors / descendants: as the one-condition rule (`generations` absent = all).
 * - rod: family lines (rody) by id; line: a research line.
 * - list: the people of another list.
 * - born / died / married / livedIn / deathAge: years (deathAge: whole years of age).
 * - near: a place (`placeKey`, src/places.ts) and its surroundings in km (0 = the
 *   place and the parts of its town), `below` also the places under its record.
 * - occupation: `values` folded (foldText), `labels` as shown.
 * - count: at least (`min`) or at most (`max`) `n`.
 * - text: in the story, the notes or both, ignoring case and accents.
 * - added / changed: a period (RulePeriod).
 * - tableFilter: a copy of a saved Table view's filter and sort.
 */
export interface RuleParamsMap {
    family: {
        personId: PersonId; personName: string;
        up: RuleDepth; via: 'both' | 'father' | 'mother'; down: RuleDepth;
        width: 'line' | 'siblings' | 'cousins'; cousins?: RuleDepth;
        spouses: 'none' | 'spouses' | 'families';
    };
    ancestors: { personId: PersonId; personName: string; generations?: number };
    descendants: { personId: PersonId; personName: string; generations?: number };
    rod: { rodIds: string[]; rodName: string };
    line: { directionId: string; lineName: string };
    list: { listId: string; listName: string };
    born: RuleYears;
    died: RuleYears;
    married: RuleYears;
    livedIn: RuleYears;
    deathAge: RuleYears;
    alive: { value: 'living' | 'deceased' };
    near: { placeKey: string; placeName: string; events: RuleNearEvent[]; km: number; below?: true };
    gender: { value: 'male' | 'female' | 'unknown' };
    occupation: { values: string[]; labels: string[] };
    has: { have: boolean; what: RuleHasWhat };
    count: { what: 'children' | 'marriages' | 'sources'; cmp: 'min' | 'max'; n: number };
    text: { query: string; where: 'story' | 'note' | 'both' };
    added: RulePeriod;
    changed: RulePeriod;
    tableFilter: { viewName: string; rowType: 'persons' | 'unions'; filter: TableView['filter']; sort: TableView['sort'] };
}

/** The parameters of a condition (a union discriminated by the condition's name). */
export type RuleParams = RuleParamsMap[RuleCondName];

/** One condition of a custom rule; `not` = "except" (taken away from its group). */
export type RuleCond = { [C in RuleCondName]: { t: 'cond'; c: C; p: RuleParamsMap[C]; not?: true } }[RuleCondName];

/** A group of a custom rule: all (intersection) or any (union) of its items, minus the items with `not`. */
export interface RuleGroup { t: 'group'; op: 'all' | 'any'; items: RuleNode[]; not?: true }

export type RuleNode = RuleCond | RuleGroup;

/** A custom rule (spec 136 v1). The root is always a group; depth at most 3 (the root = 1). */
export interface CustomRule { v: 1; root: RuleGroup }

/** A custom list rule template saved on the device (spec 136 D5). */
export interface ListTemplate { id: string; name: string; root: RuleGroup; created: string }

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

// ==================== MERGE HISTORY (spec 134 §0.3) ====================

/** Where a merge's people came from (spec 134 §0.2): the plan's source, kept in the merge's record. */
export interface PlanSource {
    kind: 'ged' | 'json' | 'tree' | 'view' | 'share';
    /** File name or tree name ("rodokmen-Jilmovi.ged", "Jilmovi – zkouška"). */
    label: string;
    program?: string;
    fileDate?: string;
    /** The source's import record id (GEDCOM), when it has one. */
    importId?: string;
    /** A fingerprint of the source (the file's SHA-256, or contentFingerprint of a tree), for a repeated merge (§13, K1.5). */
    fingerprint?: string;
    treeId?: TreeId;
    /** The source is a tree linked to a research: its link and numbers do not carry over (spec 134 11g/11h, merge/research-marks.ts). */
    research?: true;
    /** Persons of the source, its "?" stand-ins aside (buildPlan counts them). */
    persons: number;
}

export interface PlanCounts {
    joined: number;
    added: number;
    skipped: number;
    pending: number;
    /** Persons of the source ("?" aside): joined + added + skipped + pending. */
    total: number;
    /** Details the write changes (field items on, the value differs). */
    fieldChanges: number;
    /** Other empty details of joined persons the write fills (fill items, 134 S-N1); 0 in a record of an older version. */
    fieldFills: number;
    /** Differences where the tree's value stays. */
    differencesKept: number;
    /** Differences where the import's value is kept alongside the tree's ("Keep both", K5.3). */
    alongside: number;
    partnerships: number;
    links: number;
    /** Sources of the import joined with a source the tree already has (not added again, 134 S-N3); 0 in a record of an older version. */
    sourcesJoined: number;
}

/**
 * One change a merge made to a record the tree already had, for its undo
 * (src/merge/undo-plan.ts): key `key` of record `id` of collection `in`
 * ('persons', 'partnerships', 'sources', 'media', 'places', …; '' = a key of
 * the tree's data itself), its value before and after the merge (absent =
 * none). `key` '' = the whole record (one the merge removed, or a value that
 * is not an object). Values as JSON; a picture's data URL is never kept, only
 * a token of it (src/merge/record.ts), so a picture the merge replaced comes
 * back from the backup "Before merge".
 */
export interface MergeEdit {
    in: string;
    id: string;
    key: string;
    before?: unknown;
    after?: unknown;
}

/**
 * The record of a merge (spec 134 §0.3, data version 26): what one merge
 * brought into the tree, kept in StromData.merges (the Merge history, the
 * undo). Travels with the tree's data: a backup and a JSON export keep it,
 * a GEDCOM export does not write it.
 */
export interface MergeRecord {
    id: string;
    at: string;
    source: PlanSource;
    target: { name: string; newTree: boolean };
    counts: PlanCounts;
    state: 'valid' | 'partial' | 'undone';
    /** Ids in the tree of every person the merge added ("?" included). */
    added: PersonId[];
    /** [the tree's id, the source's id] of every joined person. */
    joined: Array<[PersonId, PersonId]>;
    /**
     * The source's id of each added person whose id in the tree differs
     * (tree id → source id; absent: the same id), so that a later merge of the
     * same source knows the people this one brought (spec 134 K1.5).
     */
    from?: Record<string, string>;
    /** Details of joined persons the write changed (ids in the tree), as text. */
    fields: Array<{ person: PersonId; field: string; before: string; after: string }>;
    partnerships: string[];
    sources: string[];
    places: string[];
    media: string[];
    /** Every change to a record the tree already had, for the undo (absent: none). */
    edits?: MergeEdit[];
    /** A print of each added person as the merge left it (src/merge/record.ts personPrint), to tell a later change. */
    prints?: Record<string, string>;
    backupId?: string;
    /** The research's input (I…) of the send that took the merge there (spec 134 §11). */
    sentToResearch?: string;
    /** When the merge went to the research (ISO), and the mark of that send (`intake`), to read its input from the research's sends. */
    sentAt?: string;
    sentIntake?: string;
    /** The undos so far: when, and the items undone (src/merge/undo-plan.ts item ids). */
    undone?: Array<{ at: string; items: string[] }>;
}

export interface StromData {
    /** Data format version for migration support */
    version?: number;

    persons: Record<PersonId, Person>;
    partnerships: Record<PartnershipId, Partnership>;

    /** Per-tree catalog of sources/citations, keyed by Source id. */
    sources?: Record<string, Source>;

    /**
     * The tree's files (data v24, spec 102): scans, photos, letters and
     * documents, one record per file keyed by its id, each with the places
     * where it is in the tree (Attachment.places). The order is the order
     * they were added; a person's attachments are the records with a place
     * of that person (src/media.ts).
     */
    media?: Record<string, Attachment>;

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
     * Named lists of people (spec 084, data version 22), fixed or automatic.
     * The ready-made "Added in the last 30 days" is stored only once changed
     * (src/person-lists.ts). Absent or empty = none.
     */
    personLists?: PersonList[];
    /** Ready-made lists deleted here: never made again (spec 084 Q3). */
    personListsDropped?: 'added30'[];

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

    /**
     * The merges into this tree (data version 26, spec 134 §0.3), oldest
     * first: what each brought, for the Merge history and the undo. Absent
     * or empty = none.
     */
    merges?: MergeRecord[];

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

/**
 * How much a person card shows (src/card-fields.ts CARD_DENSITIES). Compact
 * and Normal are cards of a fixed size (CARD_SIZE: the layout engine must be
 * told, spacing is computed from it); Detailed and Register draw the lines of
 * their preset fields and Custom the user's own, as wide and as tall as the
 * view's texts (src/card-width.ts).
 */
export type CardDensity = 'compact' | 'normal' | 'detailed' | 'register' | 'custom';

/** Settings → Person card → Photo on the card (spec 096): its size; small = the card as it always was. */
export type CardPhotoSize = 'small' | 'medium' | 'large';
/** The photo's (and the initials') shape on the card. */
export type CardPhotoShape = 'circle' | 'rounded';

/**
 * Spacing of the tree view (Settings → Person card → Spacing): the normal
 * gaps between cards and generations, or tighter ones that fit more cards
 * into the view. A setting of this device, never stored with the tree data.
 */
export type TreeSpacing = 'normal' | 'dense';

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
    | 'personList.save'
    | 'personList.delete'
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
    /**
     * The card type the file opens with (a gift package's app, spec 093 K5.7),
     * taken only when the reader never chose one; `cardFields` with 'custom'.
     */
    view?: { cardDensity: CardDensity; cardFields?: import('./card-fields.js').CardFieldSettings };
}

/** Reference to encrypted data type (actual type in crypto.ts) */
export interface EncryptedDataRef {
    encrypted: true;
    salt: string;
    iv: string;
    data: string;
}

// ==================== SETTINGS ====================

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
    /** @deprecated Before lineage markers (spec 112): read only to migrate to `branchMarker` (true → 'arc', false → 'none'). */
    branchColors?: boolean;
    branchMarker?: BranchMarker;  // default: 'arc' - shape of the lineage marker on cards ('none' = no shape; the tint is its own switch)
    branchTint?: boolean;  // default: false - tint cards in the lineage colour (only while a marker is on)
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
    lifelineByTree?: Record<string, {
        childEvents?: boolean; history?: boolean; kinds?: { region?: boolean; place?: boolean; local?: boolean };
        /** The Timeline's history options (spec 121 §0): the kinds and the region shown, local history on the life lines. */
        timeline?: { kinds?: string[]; region?: string; local?: boolean };
    }>;
    /** Before spec 098 (read once, moved to selectionByTree): the family line chosen in the tree view, per tree. */
    rodByTree?: Record<string, string>;
    /**
     * Per tree (spec 098 §7): the main window's selection of people and its "Hide others", kept until cleared.
     * A view setting of this device, never tree data. The ref is checked when read (src/view-selection.ts).
     */
    selectionByTree?: Record<string, { ref: unknown; hideOthers?: boolean }>;
    /** Before spec 098 §11 (read once, moved to scopeByTree[tree].map): the map's scope per tree. */
    mapScopeByTree?: Record<string, string>;
    /**
     * Per tree and view (spec 098 §7, §11): the scope of the Map, the Timeline and the Table,
     * 'view' | 'sel' | 'tree'; a view's default (Map, Timeline 'view', Table 'tree') is not stored.
     */
    scopeByTree?: Record<string, { map?: string; timeline?: string; table?: string }>;
    /**
     * Per tree (spec 140 K1.4): how the overview's "What the research knows" is grouped, 'line' | 'tree';
     * 'none' (the default) is not stored. A view setting of this device, never tree data.
     */
    knowsGroupByTree?: Record<string, string>;
    historyKindRegion?: boolean;  // default: true - the card's timeline shows regional history (spec 1028 §6)
    historyKindPlace?: boolean;   // default: true - the card's timeline shows the history of a place (with history.place)
    historyKindLocal?: boolean;   // default: true - the card's timeline shows findings from the research's sources
    historyStripClosed?: boolean;  // default: false - the card's "history not searched yet" line was closed (spec 020 K1.6)
    historyPlacesSort?: 'persons' | 'alpha';  // default: 'persons' - History of places → Places: all places by people or alphabetically
    placesSort?: 'state' | 'name' | 'people';  // default: 'state' - Places dialog order (a stored 'unplaced' reads as 'state')
    cardDensity?: CardDensity;  // default: 'normal' - how much detail a card shows
    /** Settings → Person card → Photo on the card (spec 096); absent = small + circle (the card as before). This device only. */
    cardPhoto?: { size?: CardPhotoSize; shape?: CardPhotoShape };
    exportScope?: 'tree' | 'view' | 'list' | 'person';  // default: 'tree' - the export dialog's whole tree / current view / list of people / person's family tree switch
    exportListId?: string;  // the list of the export dialog's list scope (spec 084 §12)
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
    mergeRules?: Record<string, SavedMergeRule>;  // per program (mergeRuleKey): the import guide's saved scope and rule (spec 134 K10.4)
    /**
     * Custom list rule templates saved on this device (spec 136 D5), usable in any tree.
     * Without people, places, lists, family lines and research lines (stripTemplateParams).
     */
    listTemplates?: ListTemplate[];
}

/**
 * The import guide's choices remembered for files of one program (spec 134
 * K10.4): the scope of step 1 and who is right (step 4) for the whole merge
 * and by kind of detail. Rules by person or value belong to one tree's
 * people and are never saved. Stored in this device's settings, never in a tree.
 */
export interface SavedMergeRule {
    /** The program as the file names it ("MyHeritage Family Tree Builder"). */
    program: string;
    scope: 'a' | 'b' | 'c' | 'd';
    rules: {
        all: 'mine' | 'import' | 'both' | 'precise' | 'each';
        kind?: Partial<Record<'name' | 'birth' | 'death' | 'places' | 'events' | 'notes' | 'photos' | 'sex' | 'marriage', 'mine' | 'import' | 'both' | 'precise' | 'each'>>;
    };
    /** ISO time it was saved. */
    savedAt: string;
}

// ==================== MULTI-TREE STORAGE ====================

/** Branded type for Tree IDs */
export type TreeId = string & { readonly __brand: 'TreeId' };

/** The language of a showcase's data (its places, captions, research texts); never the UI's. */
export type SampleLang = 'cs' | 'en' | 'de' | 'pl';

/** What a showcase tree keeps of its file's header (TreeMetadata.sample, spec 143). */
export interface TreeSampleMark {
    /** The showcase's fixed id ("showcase-cs"), the same across its versions. */
    exportId: string;
    lang: SampleLang;
    /** The showcase's version ("3.33.0"): a newer file offers an update. */
    sampleVersion: string;
    /** ISO time the showcase's data is as of ("as of 1 Nov 2026"). */
    asOf: string;
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
     * The bundled sample tree ("Try a sample tree"): never sent to a research
     * nor tied to one. An older sample without the mark gets it when it is
     * opened (demo-sample.ts looksLikeSampleTree).
     */
    demo?: true;
    /**
     * The showcase tree (spec 143): opened from a `strom-showcase` file
     * (src/showcase-format.ts), from the web or a file. Its research is for
     * viewing only. The mark, not the name, gives it the "Sample" tag, and its
     * `exportId` finds it again: a second opening only switches to it.
     */
    sample?: TreeSampleMark;
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
     * A copy of a tree with a research (Duplicate, "Open as a new copy", a
     * second import of the research's file): the tree it was copied from and
     * its name then. The copy itself has no research (spec 139 K5.1, K5.2):
     * it is described as "copy of the tree <name> · no research".
     */
    copyOf?: { treeId: TreeId; name: string };
    /**
     * A tree made of a selection of another tree (Change structure › From a
     * selection, spec 139 §4.2): that tree, its name then and what was
     * selected ("Jesenský line"). Like a copy it has no research (K2.4).
     */
    fromTree?: { treeId: TreeId; name: string; what: string };
    /**
     * The file the tree was imported from (Manage trees row, spec 139 §7.2):
     * written when the tree is made of a file, for an older tree from the last
     * StromData.imports record with a file when it is opened. The row reads it
     * without reading the tree's data.
     */
    importedFrom?: { file: string; kind: 'gedcom' | 'json' };
    /**
     * How many merges the tree's data records (StromData.merges), kept with
     * every save and opening: the row's "Merge history (n)" without reading
     * the data (spec 139 §9.2). Missing: none (or not known yet).
     */
    mergeCount?: number;
    /**
     * The one-time repair of trees sharing one research (package 134 point
     * 13, TreeManager.repairSharedResearchTies) took this tree off its
     * research: the tie as it was (kept, nothing else of it is), the tree
     * that keeps the research, when, and the copy's last send there when it
     * went after the copy was made. `noticed`: the notice was shown (once).
     */
    researchDetached?: {
        link: ResearchLink;
        keeper: { treeId: TreeId; name: string };
        at: string;
        sentAfterCopy?: { at: string; state: string };
        noticed?: true;
    };
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
     * Images of the research's version that had not come when the tree was
     * stored (spec 116, I1): by their place in the tree, what the next
     * connect to the research asks for. Gone once they came.
     */
    pendingImages?: import('./image-loads.js').PendingImageNotes;
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
    /**
     * Fingerprint of the portraits, couples' photos and attachments only the
     * browser keeps ('' = none; src/browser-media.ts), as last saved or read.
     * Missing: not known yet.
     */
    mediaFp?: string;
    /** The same fingerprint of what the last file copy carried (missing: not known). */
    fileCopyMediaFp?: string;
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
     * duplicate, a second import): only a mark of where the tree came from.
     * A copy is a tree without research — it sends nothing there and is never
     * updated from it; only the tree without `copy` is (spec 139 K5.1,
     * src/research-owner.ts).
     */
    copy?: boolean;
    /** The last send straight to the bridge and what became of it (a research that announces `accepts`). */
    sent?: ResearchSend;
    /**
     * Sources the person deleted in edit mode, by their research id (S0042;
     * spec 117 §4): told to a research that retracts sources
     * (`_STROM_SOURCE_DELETED`) until it says it did (`retracted` of `/sync`
     * or `/status.sends`). Survives updates from the research.
     */
    deletedSources?: string[];
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
     * A merge written into the tree is not in the research yet (spec 134
     * §11, K9.2): nothing goes by itself until it is sent ("Send to the
     * research…") or undone. `mergeId`: the newest such merge's record,
     * `at`: when the first of them was written, `persons`: the people they
     * added. Survives updates from the research.
     */
    mergeHold?: { mergeId: string; at: string; persons: number };
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
    /** The file came with the tree's own files (`media=app`, spec 108); absent: without them. */
    media?: true;
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
    /** When the one-time repair of trees sharing one research ran (ISO; TreeManager.repairSharedResearchTies). */
    researchTiesRepaired?: string;
}

