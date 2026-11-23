/**
 * Strom - versions: the data format version and the app version.
 */

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
 * Source.imageDerived (3.31) came without a bump too: an older app keeps
 * sources whole, so the mark stays on a re-save; it only composes the PAGE as
 * it did before (cutting another image number the location names).
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
 * v22 (2026-11, spec 084): StromData.personLists (named lists of people,
 *   fixed or automatic by a rule) and StromData.personListsDropped (the
 *   ready-made "Added in the last 30 days" deleted), Person.addedAt (when a
 *   person came into the tree), TableView.scope and TableView.group.
 *   Additive: nothing is computed for older trees (people without addedAt
 *   are "earlier"; the ready-made list exists without being stored, see
 *   src/person-lists.ts). An older app (v21) would drop the lists on a
 *   re-save, so the bump makes it warn first.
 * v21 (2026-11, spec 095): the main citation of a fact
 *   (Person/Partnership/LifeEvent/CoupleEvent.citationMain), chosen by hand,
 *   and the events a source records (Source.events, GEDCOM EVENTS_RECORDED
 *   `1 DATA / 2 EVEN`), by which the citations of a fact are ordered when
 *   shown and exported (src/citation-order.ts; the stored lists are never
 *   reordered). Additive: nothing is changed when a tree is read. An older
 *   app (v20) would show the automatic first citation and drop the choice on
 *   a re-save, so the bump makes it warn first.
 * v23 (2026-11, spec 107): Person.photoSource (the original a portrait was
 *   cut from — an image attachment of the person or a union's photo — with the
 *   crop, JSON only) and Partnership.photo / photoOriginalName / photoDate
 *   (the couple's photo, GEDCOM `FAM > OBJE`). Additive: a tree of v22 reads
 *   unchanged, nothing is made. An older app (v22) would drop the couple's
 *   photo and the portraits' originals on a re-save, so the bump makes it
 *   warn first.
 * v24 (2026-11, spec 102): the tree's files are records of their own
 *   (StromData.media, one record per file) with the places where each is in
 *   the tree (a person, a fact or event, a couple, a source), a title, a
 *   kind and who gave them; Person.attachments and Attachment.sourceId go:
 *   a tree of v23 is moved over when read (each attachment a record at its
 *   person and its source; the same file at several people one record).
 *   An older app (v23) would find no attachments and drop them on a
 *   re-save, so the bump makes it warn first. A portrait stayed on its
 *   person alone (Person.photo) and was in no record until v25.
 * v25 (2026-11): every portrait is in a record of the tree's files: a tree
 *   of v24 and older gives each person's portrait the person's place in the
 *   record of that picture (one there already, else a new record of kind
 *   photo with the portrait's name and date; the same portrait at several
 *   people one record), once when read (src/media.ts givePortraitsRecords).
 *   A portrait of a research tree's person with its REFN is the archive's
 *   file and is left alone; a couple's photo has no record. A GEDCOM export
 *   writes such a record at its person once, as the portrait. The version
 *   marks a tree moved over, so a record taken out later is not made again;
 *   an older app (v24) warns first, as for every bump.
 * v26 (2026-11, spec 134): a person's contact (Person.emails). A GEDCOM RESI
 *   that carries only a contact (`2 EMAIL`, MyHeritage) is the person's
 *   e-mail, not a residence, and `1 EMAIL` under the person is too; a tree
 *   of v25 and older has its e-mails moved over at every load (the lines an
 *   import wrote of them into a residence's or the person's note; a residence
 *   left with nothing goes, src/person-contact.ts moveContactsIntoPeople).
 *   An older app (v25) would drop the contact on a re-save, so the bump makes
 *   it warn first. Also the history of merges into the tree
 *   (StromData.merges, spec 134 §0.3): what each merge brought and what was
 *   undone of it, for the Merge history and the undo. Additive: a tree of
 *   v25 has none (absent = none), nothing is made when it is read.
 */
export const STROM_DATA_VERSION = 26;

/**
 * Current app version, shown in the About dialog and stamped into exports.
 * Injected from package.json at build time (see scripts/bundle.js); the literal
 * fallback is used only for dev builds and tests where no define is set and
 * should be kept in sync with package.json.
 */
declare const __APP_VERSION__: string | undefined;
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '3.32.0-beta.1';
