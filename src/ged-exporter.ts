/**
 * GEDCOM Exporter - Export family tree to GEDCOM 5.5.1 format
 * Standard genealogy interchange format for Ancestry, FamilySearch, Gramps, etc.
 *
 * Media: photos and attachments export as OBJE structures with the data URL in
 * FILE (CONC-wrapped). This round-trips within Strom; other tools will see an
 * unresolvable FILE value and skip the media. The export dialog's Content
 * options (photos / attachments / notes / sources, see GedcomExportOptions)
 * leave them out to produce a lean file for other programs. Repositories
 * export as standard 0 @Rx@ REPO records with pointers; the source reference
 * is emitted as a citation PAGE.
 * Parent→child relationship types map to FAMC PEDI (adoptive→adopted,
 * foster→foster); 'step' has no PEDI value. Whenever a child's tie to either
 * parent is 'step', or the two ties differ (stepfather, own mother), the FAM
 * carries CHIL > _FREL/_MREL, the Legacy/RootsMagic/FTM convention.
 *
 * Beyond the standard: 1 _STAT names a status MARR/DIV cannot (partners,
 * separated), 1 _QUESTION carries the open question about a person, and
 * 1 DEAT Y marks a person known to be dead without a date. Military service
 * goes out as 1 EVEN / 2 TYPE Military service. Every value that can run long
 * (names, places, witnesses, pages, web addresses, labels) is CONC-wrapped to
 * the 255-byte line limit, and the importer joins it back.
 */

import { researchHeaderLines, ResearchHeaderInfo, TitlesInGedcom } from './research-link.js';
import { isPurePlaceholder } from './single-parent.js';
import { APP_VERSION, StromData, Person, Partnership, Source, PersonId, OriginalIds, PartnershipId, LifeEventType, LifeEvent, ParticipantRole, PlaceGeo, Story, ParentChildRelType, MediaOriginal, Attachment, AlsoChildOf, FactStatus, ResearchFactOrigin, ResearchFactWas, coupleSides } from './types.js';
import { normalizeSha256 } from './sha256.js';
import { sourceReadState } from './source-confirm.js';
import { regionHeader, regionToStored } from './originals.js';
import { strings } from './strings.js';
import { COUPLE_EVENT_TAG, eventValueIsOnTag, sortCoupleEvents } from './events.js';
import { placeKey } from './places.js';
import { noName, PRIMARY_NAME_TAG } from './gedcom-names.js';
import { gedcomAge } from './recorded-age.js';
import { isGedcomDateFormOf } from './gedcom-date-form.js';
import { applyContentOptions, ContentOptions } from './privacy.js';
import { lineageOverridesOf } from './lineage.js';
import { citeLines, ExtraHolder, FactHolder, factImportTags, importedValueOf, IMPORT_TAG, joinedNoteBack, type JoinedRecord, joinedRecords, mediaDateValue, notedBack, NotedStructure, notedStructures, withoutCiteLines, withoutJoinedNotes, withoutNotedLines, XID_TAG } from './import-origin.js';
import { importProgramName } from './import-next.js';

/** What to leave out of a GEDCOM export (the export dialog's Content section). */
export interface GedcomExportOptions {
    /** Omitted = everything; photos/attachments off drop the embedded base64 media. */
    content?: ContentOptions;
    /**
     * The research this tree came from (a faithful export of a linked tree):
     * written back as `1 _STROM_TREE` + `1 _STROM_HEAD`, so Strom Research
     * can tell which of its versions the edits start from.
     */
    research?: ResearchHeaderInfo;
    /**
     * How the titles (Person.titleBefore / titleAfter) are written:
     * - 'line' (default): in the NAME line and as NPFX / NSFX below it;
     * - 'tags': as NPFX / NSFX only, the NAME line without them — a research
     *   whose titles support is not known reads them either way (one that
     *   knows titles from the tags, an older one only the line);
     * - 'none': not at all, the NAME line as the app wrote it before titles
     *   (3.9) — for a research that does not know titles, which would read
     *   them from the line into the name (B-1); they stay in the app.
     */
    titles?: TitlesInGedcom;
    /**
     * A source written from a reading of the research ("Read a document")
     * carries its marks: `1 _STROM_READING D…` + `2 _STROM_ENTRY e…`, and
     * `1 _STROM_SHA` when no excerpt names the page. Default true; false for
     * a research that does not take them (`read.sync`, see researchSendsReadings).
     */
    readings?: boolean;
    /**
     * Write the research's origin of facts (`_STROM_ORIGIN`, `_STROM_SEX_ORIGIN`,
     * `_STROM_WAS` with its `_STROM_IMPORT`, `_PART`, `_REF`), so a file export
     * read back keeps it (spec 066). Only a file the user exports: never in what
     * goes to the research (it keeps its own).
     */
    origins?: boolean;
    /**
     * "Back to {prog}" with "Mark the research's facts with a note" (spec 066
     * §4): under each fact the research added or corrected, a `2 NOTE` with
     * this text of the record(s) it cites — for the other program, which
     * reads no `_STROM_*` tag. The text is in the app's language.
     */
    researchNote?: (src: string) => string;
    /**
     * "Back to {prog}" (spec 066 K3.2): the import (StromData.imports id) the
     * file goes back to. People and families from that program's files get
     * their original xref where it is safe, and their id lines (`_UID`, `RIN`,
     * `EXID`…) as level-1 lines; an xref that cannot be used goes as
     * `REFN` + `TYPE {prog} xref`.
     */
    backTo?: string;
}

/**
 * An xref another program gave that this file can use as it is: GEDCOM
 * 5.5.1's form (letters, digits, `_`; 22 characters with the @ signs).
 */
export function isSafeXref(xref: string): boolean {
    return /^[A-Za-z0-9_]{1,20}$/.test(xref);
}

/** A record's ids in one import: `n _XREF @x@` and its id lines, under `n-1 _STROM_IMPORT Ix` or at level 1. */
function pushOriginalIdLines(lines: string[], level: number, entry: OriginalIds, withXref: boolean): void {
    if (withXref && entry.xref) lines.push(`${level} _XREF @${entry.xref}@`);
    for (const id of entry.ids ?? []) {
        lines.push(`${level} ${id.tag} ${id.value}`);
        if (id.tag === 'EXID' && id.type) lines.push(`${level + 1} TYPE ${id.type}`);
    }
}

/**
 * A fact the research added or corrected: its origin is the research, or it
 * keeps the family tree's earlier value (`_STROM_WAS`).
 */
export function isResearchFact(origin: ResearchFactOrigin | undefined): boolean {
    return !!origin && (origin.kind === 'research' || !!origin.was);
}

/** The citations of one fact of a person or a couple. */
function factCitations(holder: FactHolder, fact: string): readonly string[] {
    if (fact.startsWith('event:')) {
        const id = fact.slice(6);
        return (holder.events ?? []).find(e => e?.id === id)?.sourceIds ?? [];
    }
    if ('person1Id' in holder) return fact === 'marriage' ? holder.sourceIds ?? [] : [];
    return fact === 'birth' ? holder.birthSourceIds ?? [] : fact === 'death' ? holder.deathSourceIds ?? [] : [];
}

/**
 * The record(s) a research fact rests on, for its note: the sources its
 * origin names, else the fact's own citations; each as "title, reference",
 * several joined by "; ". Null: no record in the tree (no note).
 */
export function researchNoteSource(data: Pick<StromData, 'sources'>, holder: FactHolder, fact: string): string | null {
    const origin = holder.researchOrigins?.[fact];
    if (!isResearchFact(origin)) return null;
    const ids = origin!.sourceIds?.length ? origin!.sourceIds : factCitations(holder, fact);
    const labels: string[] = [];
    for (const id of ids) {
        const s = data.sources?.[id];
        if (!s) continue;
        const label = [s.title, s.reference].filter(x => !!x?.trim()).map(x => x!.trim()).join(', ');
        if (label && !labels.includes(label)) labels.push(label);
    }
    return labels.length ? labels.join('; ') : null;
}

/** Facts a research note can stand under: SEX takes no NOTE in GEDCOM. */
const NOTE_FACT = (fact: string): boolean => fact !== 'sex';

/**
 * The first research fact of the tree that would get a note, its record(s)
 * (the example in "Mark the research's facts with a note"); null: none.
 */
export function firstResearchNoteSource(data: StromData): string | null {
    const holders: FactHolder[] = [...Object.values(data.persons), ...Object.values(data.partnerships)];
    for (const h of holders) {
        for (const fact of Object.keys(h.researchOrigins ?? {})) {
            if (!NOTE_FACT(fact)) continue;
            const src = researchNoteSource(data, h, fact);
            if (src) return src;
        }
    }
    return null;
}

/** Partnership statuses MARR/DIV cannot express, written as 1 _STAT. */
const GEDCOM_STAT: Partial<Record<Partnership['status'], string>> = {
    partners: 'Partners',
    separated: 'Separated',
};

/**
 * Header NOTE marker under which surname-variant groups are written. GEDCOM has
 * no standard structure for "these spellings mean one family" (surnameVariants),
 * so — rather than invent a custom tag — the groups ride in a plain header NOTE,
 * which every reader keeps. The marker lets our own importer round-trip them;
 * other tools simply show a human-readable note. Kept in sync with the parser,
 * which imports this constant.
 */
export const SURNAME_GROUPS_MARKER = 'Strom surname-variant groups';
/** Under INDI: the person's lineage correction (FOUNDER or NOCARRY, data v14). */
export const STROM_LINE_TAG = '_STROM_LINE';
/** In the header: the file says which lineage corrections there are (any person without the tag has none). */
export const STROM_LINES_TAG = '_STROM_LINES';
/** Separates spellings within one group inside the header NOTE. */
export const SURNAME_GROUP_SEP = ' | ';
/**
 * Spelling suggestions the user rejected (StromData.surnameRejections), in a
 * header NOTE of the same format: one `2 CONT` per rejected group.
 */
export const SURNAME_REJECTIONS_MARKER = 'Strom surname-variant rejections';

/**
 * LifeEvent type -> GEDCOM tag. Types with no GEDCOM equivalent ('military',
 * 'custom') ride on the generic EVEN tag with a TYPE label.
 */
const EVENT_TYPE_TO_TAG: Partial<Record<LifeEventType, string>> = {
    baptism: 'BAPM', burial: 'BURI', occupation: 'OCCU', residence: 'RESI',
    emigration: 'EMIG', immigration: 'IMMI', education: 'EDUC', religion: 'RELI',
    confirmation: 'CONF', firstCommunion: 'FCOM', barMitzvah: 'BARM',
    batMitzvah: 'BASM', ordination: 'ORDN', adoption: 'ADOP',
    naturalization: 'NATU', will: 'WILL', probate: 'PROB', cremation: 'CREM',
    title: 'TITL', nationality: 'NATI',
};

/** RELA values for participant roles. Godparent/Witness are the conventional ones. */
const GEDCOM_RELA: Record<ParticipantRole, string> = {
    godparent: 'Godparent',
    witness: 'Witness',
    officiant: 'Officiant',
    other: 'Present',
};

/** _FREL/_MREL values for the child's relationship to one parent. */
const GEDCOM_CHILD_REL: Record<ParentChildRelType, string> = {
    biological: 'Natural',
    adoptive: 'Adopted',
    step: 'Step',
    foster: 'Foster',
};

export interface GedcomExportResult {
    content: string;
    stats: {
        individuals: number;
        families: number;
    };
    /** The xrefs this export gave persons and sources (by id): a hand-over's `ids` answer by them. */
    xrefs: { persons: ReadonlyMap<string, string>; sources: ReadonlyMap<string, string> };
}

/** GEDCOM month names (uppercase) */
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * Format a canonical flex date (see src/dates.ts) to GEDCOM format.
 * Preserves precision and qualifiers: "~1900" -> "ABT 1900",
 * "1900-06" -> "JUN 1900", "<1900-06-03" -> "BEF 3 JUN 1900",
 * a period "1871/1882" -> "FROM 1871 TO 1882". `asWritten` (Person /
 * Partnership gedcomDates) gives the form the imported file wrote the value in
 * (used only when it is a valid one-line keyword form of this very date).
 */
export function formatGedcomDate(isoDate: string | undefined, asWritten?: Record<string, string>): string | null {
    if (!isoDate) return null;
    // Only a one-line keyword form that reads as this date: a value from
    // loaded data may hold anything, also a valid form of another date.
    const kept = asWritten?.[isoDate];
    if (isGedcomDateFormOf(isoDate, kept)) return kept;

    // Period 'a/b' -> FROM a TO b, 'a/' -> FROM a, '/b' -> TO b
    const slash = isoDate.indexOf('/');
    if (slash >= 0) {
        const a = formatGedcomDate(isoDate.slice(0, slash));
        const b = formatGedcomDate(isoDate.slice(slash + 1));
        if (a && b) return `FROM ${a} TO ${b}`;
        return a ? `FROM ${a}` : b ? `TO ${b}` : null;
    }

    // Range 'a..b' -> BET a AND b
    const dots = isoDate.indexOf('..');
    if (dots > 0) {
        const a = formatGedcomDate(isoDate.slice(0, dots));
        const b = formatGedcomDate(isoDate.slice(dots + 2));
        if (a && b) return `BET ${a} AND ${b}`;
        return a || b;
    }

    // Flex-date qualifier prefix -> GEDCOM keyword
    let prefix = '';
    let value = isoDate;
    const q = value[0];
    if (q === '~' || q === '<' || q === '>') {
        prefix = q === '~' ? 'ABT ' : q === '<' ? 'BEF ' : 'AFT ';
        value = value.slice(1);
    }

    const parts = value.split('-');
    if (parts.length === 0) return null;

    const year = parts[0];
    if (!year || year.length < 3 || year.length > 4) return null;

    const month = parts[1] ? parseInt(parts[1], 10) : null;
    const day = parts[2] ? parseInt(parts[2], 10) : null;

    if (month && day) {
        // Full date: D MON YYYY
        return `${prefix}${day} ${MONTHS[month - 1]} ${year}`;
    } else if (month) {
        // Year and month: MON YYYY
        return `${prefix}${MONTHS[month - 1]} ${year}`;
    } else {
        // Year only: YYYY
        return `${prefix}${year}`;
    }
}

/**
 * A coordinate as GEDCOM 5.5.1 wants it: a hemisphere letter then the magnitude.
 * Latitude uses N/S, longitude E/W. Trailing zeros are trimmed so 50.088 stays
 * "50.088" rather than "50.088000", and a whole degree comes out as "14".
 */
function trimCoord(magnitude: number): string {
    return magnitude.toFixed(6).replace(/\.?0+$/, '') || '0';
}
function formatGedcomLat(lat: number): string {
    return (lat >= 0 ? 'N' : 'S') + trimCoord(Math.abs(lat));
}
function formatGedcomLon(lon: number): string {
    return (lon >= 0 ? 'E' : 'W') + trimCoord(Math.abs(lon));
}

/**
 * Emit `level PLAC <place>` and, when the tree has coordinates for that place
 * (data.places, keyed by placeKey), the standard MAP > LATI/LONG substructure
 * one level deeper. This is what lets the map's geocache survive a round-trip
 * and travel to other genealogy tools.
 */
function pushPlace(lines: string[], level: number, place: string, places?: Record<string, PlaceGeo>): void {
    pushWrapped(lines, level, 'PLAC', place);
    const geo = places?.[placeKey(place)];
    if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lon)) {
        lines.push(`${level + 1} MAP`);
        lines.push(`${level + 2} LATI ${formatGedcomLat(geo.lat)}`);
        lines.push(`${level + 2} LONG ${formatGedcomLon(geo.lon)}`);
    }
}

/**
 * The person's main NAME. A name with a title (Person.titleBefore /
 * titleAfter) carries it in the line, so a program that reads no sub-tags
 * still shows it ("Ing. Jan /Novák/ ml."), and spells its parts out below:
 * NPFX, GIVN, SURN, NSFX — the shape the research writes and reads. A name
 * without a title stays one plain line, as ever. A part holding a comma gets
 * no GIVN / SURN (GEDCOM reads commas there as a list); the line has it.
 * One more name gets its GIVN and SURN: a person of no name ("?") with the
 * surname Unknown, so no reader takes it for no surname. `titles` (see
 * GedcomExportOptions.titles): 'tags' keeps the titles out of the line,
 * 'none' writes the name as if it had none. `parts` writes GIVN / SURN
 * under every name ("Back to {prog}", whose file had them, spec 066 K3.1).
 */
function pushName(lines: string[], person: Person, titles: TitlesInGedcom = 'line', parts = false): void {
    const before = titles === 'none' ? '' : person.titleBefore?.trim() ?? '';
    const after = titles === 'none' ? '' : person.titleAfter?.trim() ?? '';
    const name = formatGedcomName(person.firstName, person.lastName);
    const first = (person.firstName ?? '').trim();
    const last = (person.lastName ?? '').trim();
    if (!before && !after) {
        pushWrapped(lines, 1, 'NAME', name);
        // "? /Unknown/" alone reads as no surname in a reader that takes it
        // for the app's old "no name, no surname" (an app before
        // 3.10.0-beta.7, the research); the SURN says Unknown was typed.
        if (noName(first) && last === 'Unknown') {
            if (!first.includes(',')) pushWrapped(lines, 2, 'GIVN', first);
            pushWrapped(lines, 2, 'SURN', last);
        } else if (parts) {
            // The parts of the name as it is now (as the file had them while unchanged).
            if (first && !noName(first) && !first.includes(',')) pushWrapped(lines, 2, 'GIVN', first);
            if (last && !last.includes(',')) pushWrapped(lines, 2, 'SURN', last);
        }
        return;
    }
    pushWrapped(lines, 1, 'NAME', titles === 'tags' ? name : [before, name.trim(), after].filter(Boolean).join(' '));
    if (before) pushWrapped(lines, 2, 'NPFX', before);
    if (first && !first.includes(',')) pushWrapped(lines, 2, 'GIVN', first);
    if (last && !last.includes(',')) pushWrapped(lines, 2, 'SURN', last);
    if (after) pushWrapped(lines, 2, 'NSFX', after);
}

/**
 * Format name to GEDCOM format: FirstName /LastName/. No surname is an empty
 * pair of slashes ("? //"), never a word a reader would take for one (the
 * app wrote "? /Unknown/" before 3.10; the parser reads that back as no
 * surname from a file of Strom's own).
 */
function formatGedcomName(firstName: string, lastName: string): string {
    return `${firstName || ''} /${lastName || ''}/`;
}

/**
 * Escape special characters in GEDCOM text
 */
function escapeGedcomText(text: string): string {
    // GEDCOM doesn't have many escape sequences, but we should handle @ signs.
    //
    // A line break is the dangerous one. The structure of the file IS the line
    // structure: every physical line must start with a level. A newline written
    // into a value emits a line with nothing in front of it, so the file stops
    // being GEDCOM and every reader loses the rest of that record. Callers that
    // may legitimately span lines go through pushLongValue, which turns each
    // break into a CONT; for everything else a break is an accident of typing
    // and becomes a space.
    return text.replace(/[\r\n]+/g, ' ').replace(/@/g, '@@');
}

/**
 * GEDCOM 5.5.1 caps a physical line at 255 BYTES — not characters. Czech,
 * German and Polish text is two bytes per accented letter in UTF-8, so a
 * 200-CHARACTER limit let a Czech note out at up to 400 bytes and quietly
 * broke the spec. Long values continue on CONC lines; the margin below 255
 * leaves room for the level, the tag and the space.
 */
const MAX_VALUE_BYTES = 200;

function byteLen(text: string): number {
    let n = 0;
    for (const ch of text) {
        const cp = ch.codePointAt(0)!;
        n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    }
    return n;
}

/** Marks, joiners and modifiers that belong to the character before them. */
const CLUSTER_EXTEND = /^[\p{M}\u200D\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/u;
const isRegionalIndicator = (cp: number): boolean => cp >= 0x1f1e6 && cp <= 0x1f1ff;

/**
 * May a line end at `i` without tearing a character apart? Not inside a
 * surrogate pair (an emoji outside the BMP: each half alone is written as
 * U+FFFD), not before a combining mark, variation selector, skin tone or tag,
 * not around a zero-width joiner (👨‍👩‍👧) and not inside a flag's pair of
 * regional indicators. Some readers decode each physical line on its own.
 */
function isClusterBoundary(text: string, i: number): boolean {
    const unit = text.charCodeAt(i);
    if (unit >= 0xdc00 && unit <= 0xdfff) return false;
    if (unit < 0x80 && text.charCodeAt(i - 1) < 0x80) return true;
    if (CLUSTER_EXTEND.test(text.slice(i, i + 2))) return false;
    const before = text.codePointAt(i - 1 - (text.charCodeAt(i - 1) >= 0xdc00 && text.charCodeAt(i - 1) <= 0xdfff ? 1 : 0))!;
    if (before === 0x200d) return false;
    if (isRegionalIndicator(text.codePointAt(i)!) && isRegionalIndicator(before)) {
        // Flags pair up from the left: a cut after an odd run splits one.
        let run = 0;
        for (let j = i; j >= 2 && isRegionalIndicator(text.codePointAt(j - 2)!); j -= 2) run++;
        return run % 2 === 0;
    }
    return true;
}

/**
 * Split a value into byte-bounded chunks. A cut sits next to a space only when
 * nothing else fits: a chunk that ends (or starts) with one loses it in any
 * parser that trims line values, and two words run together. When every cut
 * is beside a space ("a a a …", "🔴 🔴 …"), the space starts the next CONC
 * line: readers that take the value after the one delimiter (ours, the
 * research's) keep it, a trailing space would be lost by both.
 * Nor does a cut tear a character apart (isClusterBoundary).
 */
function chunkValue(text: string): string[] {
    if (byteLen(text) <= MAX_VALUE_BYTES) return [text];
    // One pass from left to right (images are hundreds of kB of base64: the
    // old re-measure-the-rest loop was quadratic — 45 s for a 40 MB export).
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
        // The longest run from `start` that fits, in bytes and whole code points.
        let end = start;
        let used = 0;
        while (end < text.length) {
            const cp = text.codePointAt(end)!;
            const b = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
            if (used + b > MAX_VALUE_BYTES) break;
            used += b;
            end += cp > 0xffff ? 2 : 1;
        }
        if (end >= text.length) {
            chunks.push(text.slice(start));
            break;
        }
        // Back off to a cut beside no space and inside no character; failing
        // that, right before a space that follows no space (it leads the next
        // line); failing that (a run of spaces), inside no character; failing
        // that (one character longer than a line), between whole code points.
        // An escaped '@@' stays on one line: readers unescape line by line.
        const besideSpace = (i: number): boolean => text[i] === ' ' || text[i - 1] === ' ';
        const spaceLeads = (i: number): boolean => text[i] === ' ' && text[i - 1] !== ' ';
        const whole = (i: number): boolean => isClusterBoundary(text, i) && !(text[i] === '@' && text[i - 1] === '@');
        const backOff = (ok: (i: number) => boolean): number | undefined => {
            for (let i = end; i > start; i--) if (ok(i)) return i;
            return undefined;
        };
        const cut = backOff(i => !besideSpace(i) && whole(i))
            ?? backOff(i => spaceLeads(i) && whole(i))
            ?? backOff(whole)
            ?? end;
        chunks.push(text.slice(start, cut));
        start = cut;
    }
    return chunks;
}

/** Emit `level TAG value` with CONC continuations for over-long values. */
function pushWrapped(lines: string[], level: number, tag: string, text: string): void {
    const chunks = chunkValue(escapeGedcomText(text));
    lines.push(`${level} ${tag} ${chunks[0]}`);
    for (let i = 1; i < chunks.length; i++) {
        lines.push(`${level + 1} CONC ${chunks[i]}`);
    }
}

/**
 * Emit `level TAG value` for text of any length: a real line break in the text
 * becomes a CONT line, an over-long line continues on CONC lines. Reading them
 * back is pure concatenation (CONC appends, CONT appends a newline first), so
 * the text comes out of a round-trip exactly as it went in — never reflowed.
 */
function pushLongValue(lines: string[], level: number, tag: string, text: string): void {
    const parts = text.split('\n');
    const emit = (lvl: number, t: string, value: string): void => {
        lines.push(value ? `${lvl} ${t} ${value}` : `${lvl} ${t}`);
    };
    parts.forEach((part, i) => {
        const chunks = chunkValue(escapeGedcomText(part));
        emit(i === 0 ? level : level + 1, i === 0 ? tag : 'CONT', chunks[0]);
        for (let j = 1; j < chunks.length; j++) emit(level + 1, 'CONC', chunks[j]);
    });
}

/** The value of `_STROM_ORIGIN`: `import I1 [DATE PLAC…]`, `user` or `research`. */
function researchOriginValue(o: ResearchFactOrigin): string {
    return o.kind === 'import' ? ['import', o.importId ?? '', ...(o.importId ? o.parts ?? [] : [])].filter(Boolean).join(' ') : o.kind ?? '';
}

/** The family tree's earlier value of a fact: one `_STROM_WAS` per changed part when each has its own value. */
function pushResearchWas(lines: string[], level: number, was: ResearchFactWas | undefined): void {
    if (!was) return;
    const parts = was.parts ?? [];
    const each: { value: string; parts: string[] }[] = was.partValues && parts.length > 1
        ? parts.map(p => ({ value: was.partValues![p] ?? '', parts: [p] }))
        : [{ value: was.value, parts }];
    for (const w of each) {
        pushLongValue(lines, level, '_STROM_WAS', w.value);
        if (was.importId) lines.push(`${level + 1} _STROM_IMPORT ${was.importId}`);
        for (const p of w.parts) lines.push(`${level + 1} _PART ${p}`);
        if (was.ref) lines.push(`${level + 1} _REF ${was.ref}`);
    }
}

/** Emit a NOTE structure (see pushLongValue). */
function pushNote(lines: string[], level: number, text: string): void {
    pushLongValue(lines, level, 'NOTE', text);
}

/**
 * What a record adds to a fact beyond its date and place, as level-2 lines
 * under it: CAUS, AGE, ADDR. An age the app can read goes out the standard way
 * ("54 let" → 54y, "kojenec" → INFANT), anything else as written.
 */
function pushDetails(lines: string[], d: { cause?: string; age?: string; address?: string }): void {
    if (d.cause?.trim()) pushLongValue(lines, 2, 'CAUS', d.cause.trim());
    if (d.age?.trim()) pushWrapped(lines, 2, 'AGE', gedcomAge(d.age));
    if (d.address?.trim()) pushLongValue(lines, 2, 'ADDR', d.address.trim());
}

/**
 * The research's status of a fact (`2 _STROM_STATUS`), written back as it
 * came so a tree round-trips through the app unchanged.
 */
/**
 * An event without the note lines the import made of its `2 EMAIL` lines
 * ("E-mail: …", in the language of the import), and the addresses whose line
 * is still there; one taken out or edited by hand stays a note.
 */
function emailsBack(event: LifeEvent): { event: LifeEvent; emails: string[] } {
    if (!event.gedcomEmails?.length || !event.note || eventValueIsOnTag(event.type)) return { event, emails: [] };
    const noteLines = event.note.split('\n');
    const emails: string[] = [];
    for (const email of event.gedcomEmails) {
        const i = noteLines.findIndex(l => {
            const at = l.indexOf(': ');
            return at > 0 && !l.slice(0, at).includes('@') && l.slice(at + 2).trim() === email;
        });
        if (i < 0) continue;
        noteLines.splice(i, 1);
        emails.push(email);
    }
    const note = noteLines.join('\n').trim();
    return { event: { ...event, ...(note ? { note } : { note: undefined }) }, emails };
}

/**
 * A source without the note line(s) the import made of its AUTH ("Author: …",
 * in the language of the import), and the author while that line is still
 * there; a line taken out or edited by hand stays a note (as emailsBack).
 */
function authorBack(source: Source): { source: Source; author?: string } {
    if (!source.gedcomAuthor || !source.note) return { source };
    const noteLines = source.note.split('\n');
    const [first, ...rest] = source.gedcomAuthor.split('\n');
    const i = noteLines.findIndex((l, at) => {
        const colon = l.indexOf(': ');
        return colon > 0 && !l.slice(0, colon).includes('@') && l.slice(colon + 2) === first
            && rest.every((r, k) => noteLines[at + 1 + k] === r);
    });
    if (i < 0) return { source };
    noteLines.splice(i, 1 + rest.length);
    const note = noteLines.join('\n').trim();
    return { source: { ...source, ...(note ? { note } : { note: undefined }) }, author: source.gedcomAuthor };
}

function pushStatus(lines: string[], status: FactStatus | undefined): void {
    if (status) lines.push(`2 _STROM_STATUS ${status}`);
}

/**
 * Emit a _STORY structure — the narrative written about a person or a couple.
 *
 * A non-standard tag, deliberately: a story is prose built on top of the
 * evidence and must not be mistaken for a NOTE on the record. Programs that do
 * not know the tag skip the whole block, which is exactly the right outcome.
 */
function pushStory(lines: string[], level: number, story: Story, sourceRef: (id: string) => string | undefined): void {
    lines.push(`${level} _STORY`);
    lines.push(`${level + 1} TYPE ${escapeGedcomText(story.kind || 'vypraveni')}`);
    if (story.title) pushLongValue(lines, level + 1, 'TITL', story.title);
    if (story.status) lines.push(`${level + 1} STAT ${story.status === 'final' ? 'hotovo' : 'navrh'}`);
    pushLongValue(lines, level + 1, 'TEXT', story.text);
    for (const fact of story.facts ?? []) pushLongValue(lines, level + 1, 'DATA', fact);
    // The sources the story rests on, as Strom Research writes them: a pointer each.
    for (const id of new Set(story.sources ?? [])) {
        const ref = sourceRef(id);
        if (ref) lines.push(`${level + 1} SOUR ${ref}`);
    }
    if (story.note) pushLongValue(lines, level + 1, 'NOTE', story.note);
}

/**
 * The other families a person was also recorded in as a child (spec 066 K3.1),
 * written back as FAMC / CHIL instead of the "Also recorded as…" note line —
 * while that line is still in the notes (deleting it drops the link) and the
 * family still exists without the person among its own children.
 */
function alsoChildLinks(data: StromData): Map<PersonId, AlsoChildOf[]> {
    const out = new Map<PersonId, AlsoChildOf[]>();
    for (const [id, person] of Object.entries(data.persons) as [PersonId, Person][]) {
        if (!person.alsoChildOf?.length) continue;
        const noteLines = (person.notes ?? '').split('\n').map(l => l.trimEnd());
        const links = person.alsoChildOf.filter((l, i, all) =>
            noteLines.includes(l.note)
            && data.partnerships[l.partnershipId] && !data.partnerships[l.partnershipId].childIds.includes(id)
            && all.findIndex(o => o.partnershipId === l.partnershipId) === i);
        if (links.length) out.set(id, links);
    }
    return out;
}

/** The notes without the lines its written links stand for (alsoChildLinks). */
function notesWithoutLinks(notes: string, links: AlsoChildOf[]): string {
    const lines = notes.split('\n');
    for (const link of links) {
        const at = lines.findIndex(l => l.trimEnd() === link.note);
        if (at >= 0) lines.splice(at, 1);
    }
    return lines.join('\n').trim();
}

/**
 * Whether a person is a record of a loaded file of the tree: it has its entry
 * there (xref, ids). Not the import mark alone — a whole imported tree carries
 * it, the "?" stand-ins the import made up for a missing parent too.
 */
function isFileRecord(data: StromData, p: Person): boolean {
    const known = new Set((data.imports ?? []).map(r => r.id));
    return (p.originalIds ?? []).some(e => known.has(e.from));
}

/**
 * A "?" stand-in with nothing of its own, whose children are all in its
 * families: left out of GEDCOM (other programs would show a nameless
 * spouse). Its families read back as one-parent families with a stand-in;
 * a childless one is the known spouse's family alone with its status
 * ("married, the spouse unknown"): only the user keeps one (tidyPlaceholders
 * drops one left empty).
 */
function standsInOnly(data: StromData, id: PersonId): boolean {
    if (!isPurePlaceholder(data, id)) return false;
    const p = data.persons[id];
    // A record of a loaded file (a MyHeritage person known only as a spouse,
    // `1 NAME //`, `1 SEX U`): the file had it, with its ids, so it goes out
    // as its own record and its families keep both partners (spec 066 K3.2).
    if (isFileRecord(data, p)) return false;
    const unions = p.partnerships.map(uid => data.partnerships[uid]).filter(Boolean);
    return unions.length > 0 && p.childIds.every(cid => unions.some(u => u.childIds.includes(cid)));
}

/**
 * Families as GEDCOM has them: every partnership, plus one for each set of
 * parents linked to children without a couple between them (a single parent;
 * exported as a family with _STROM_NO_COUPLE). What the counts in the app say.
 */
export function countFamilies(data: StromData): number {
    const covered = new Set<string>();
    for (const u of Object.values(data.partnerships) as Partnership[]) {
        for (const cid of u.childIds) covered.add(`${cid}|${u.person1Id}`).add(`${cid}|${u.person2Id}`);
    }
    const loose = new Set<string>();
    for (const [childId, child] of Object.entries(data.persons) as [PersonId, Person][]) {
        const parents = child.parentIds.filter(pid => data.persons[pid] && !covered.has(`${childId}|${pid}`));
        if (parents.length) loose.add([...parents].sort().join('|'));
    }
    return Object.keys(data.partnerships).length + loose.size;
}

/**
 * Export StromData to GEDCOM 5.5.1 format
 */
/**
 * In the header of EVERY file the app writes (an export, a send to the research,
 * the hand-over of a tree that has no research yet): SEX U stands exactly where
 * the sex is unknown here (Gender 'unknown', never a guess), and an M or F the
 * research has as U is the user's. Strom Research 1.12.1 and 1.13.0-beta.2 read
 * the app's SEX U as unknown only with this mark; without it they take the file
 * for an app that guesses (a husband male, anyone else female).
 * It may go once the production research tells it by the header's `2 VERS`
 * (3.10.0-beta.11 or newer, as its development version does) or by the data
 * version 12, and no research before that is in use.
 */
export const STROM_SEX_U_LINE = '1 _STROM_SEX_U Y';

/** What "Back to {prog}" writes of the records' ids (see backToXrefs). */
interface BackXrefs {
    /** The program the file goes back to ('' without one). */
    program: string;
    /** The original xrefs the file uses (without @), by record. */
    persons: Map<PersonId, string>;
    families: Map<PartnershipId, string>;
    /** The record's ids in that program's file the export writes back. */
    personEntries: Map<PersonId, OriginalIds>;
    familyEntries: Map<PartnershipId, OriginalIds>;
    /** Every original xref of that program (upper case), used or given up: no other record gets one. */
    reserved: Set<string>;
    /** The imports from that program (its own tags kept from them go back, spec 066 G8). */
    imports: Set<string>;
    /**
     * The sources one record of that program's file became (one per page
     * cited): each member's id -> the group's first member. They go back as
     * that one record, the pages on their citations (spec 066 K3.1).
     */
    sourceGroups: Map<string, string>;
    /** The original xref a group uses (without @), by its first member. */
    sources: Map<string, string>;
    /** A source's entry of that program's ids (`1 RIN MH:S1` goes back), by source. */
    sourceEntries: Map<string, OriginalIds>;
}

/** Every source a citation names (what pushCitation writes): of a person, a fact, an event, a couple. */
function citedSourceIds(data: StromData): Set<string> {
    const out = new Set<string>();
    const add = (ids: readonly string[] | undefined): void => { for (const id of ids ?? []) out.add(id); };
    for (const p of Object.values(data.persons) as Person[]) {
        if (!p) continue;
        add(p.sourceIds); add(p.birthSourceIds); add(p.deathSourceIds);
        for (const ev of p.events ?? []) add(ev.sourceIds);
    }
    for (const ps of Object.values(data.partnerships) as Partnership[]) {
        if (!ps) continue;
        add(ps.sourceIds);
        for (const ev of ps.events ?? []) add(ev.sourceIds);
    }
    return out;
}

/** What a source record says itself, apart from the page and the entry's date (the citation's). */
const sameSourceRecord = (a: Source, b: Source): boolean =>
    a.title === b.title && (a.repository ?? '') === (b.repository ?? '') && (a.url ?? '') === (b.url ?? '')
    && (a.note ?? '') === (b.note ?? '') && (!a.transcript || !b.transcript || a.transcript === b.transcript);

/**
 * The records' ids of "Back to {prog}" (spec 066 K3.2). A record's entry is
 * that of the import the file goes back to, else of the latest other import
 * from the same program. Its xref is used when it has GEDCOM's form and no
 * other record claims it as strongly: an entry of the import itself before
 * one of an older file; two equal claims both give it up (they go as REFN).
 * Xrefs are compared without regard to case (some programs read them so).
 * No generated xref takes one of them, used or not: the program would take
 * that record for the one it once named so.
 */
function backToXrefs(data: StromData, backTo: string | undefined): BackXrefs {
    const out: BackXrefs = {
        program: '', persons: new Map(), families: new Map(), personEntries: new Map(), familyEntries: new Map(), reserved: new Set(),
        imports: new Set(), sourceGroups: new Map(), sources: new Map(), sourceEntries: new Map(),
    };
    const rec = backTo ? data.imports?.find(r => r.id === backTo) : undefined;
    if (!rec) return out;
    out.program = importProgramName(rec);
    const same = (data.imports ?? []).filter(r => importProgramName(r) === out.program).map(r => r.id);
    out.imports = new Set(same);
    // 0 for the import itself, then the later files before the earlier ones.
    const rank = (from: string): number => (from === rec.id ? 0 : same.length - same.indexOf(from));
    const pick = (holder: { originalIds?: OriginalIds[] }): OriginalIds | undefined => {
        let best: OriginalIds | undefined;
        for (const e of holder.originalIds ?? []) {
            if (!same.includes(e.from)) continue;
            if (!best || rank(e.from) < rank(best.from)) best = e;
        }
        return best;
    };
    const claims = new Map<string, { rank: number; n: number; assign: () => void }>();
    const claim = (xref: string | undefined, r: number, assign: () => void): void => {
        if (!xref || !isSafeXref(xref) || xref.toUpperCase() === 'SUBM1') return;
        const key = xref.toUpperCase();
        const have = claims.get(key);
        if (!have || r < have.rank) claims.set(key, { rank: r, n: 1, assign });
        else if (r === have.rank) have.n++;
    };
    for (const [id, person] of Object.entries(data.persons) as [PersonId, Person][]) {
        if (!person || standsInOnly(data, id)) continue;
        const entry = pick(person);
        if (!entry) continue;
        out.personEntries.set(id, entry);
        claim(entry.xref, rank(entry.from), () => out.persons.set(id, entry.xref!));
    }
    for (const [id, ps] of Object.entries(data.partnerships) as [PartnershipId, Partnership][]) {
        if (!ps) continue;
        const entry = pick(ps);
        if (!entry) continue;
        out.familyEntries.set(id, entry);
        claim(entry.xref, rank(entry.from), () => out.families.set(id, entry.xref!));
    }
    // The sources one record became, cited somewhere: one group per record
    // while they say the same of it (a title edited here makes a record of its own).
    const cited = citedSourceIds(data);
    const groups = new Map<string, Source[][]>();
    for (const src of Object.values(data.sources ?? {}) as Source[]) {
        if (!src) continue;
        const entry = pick(src);
        if (entry) out.sourceEntries.set(src.id, entry);
        if (!entry?.xref) continue;
        out.reserved.add(entry.xref.toUpperCase());
        if (!cited.has(src.id)) continue;
        const key = entry.xref.toUpperCase();
        const list = groups.get(key) ?? [];
        groups.set(key, list);
        const group = list.find(g => sameSourceRecord(g[0], src) && g.every(m => sameSourceRecord(m, src)));
        if (group) group.push(src);
        else list.push([src]);
    }
    for (const list of groups.values()) {
        for (const [i, group] of list.entries()) {
            const head = group[0].id;
            for (const m of group) out.sourceGroups.set(m.id, head);
            // The record's xref: the first group's (the others are records of their own now).
            if (i === 0) {
                const entry = pick(group[0])!;
                claim(entry.xref, rank(entry.from), () => out.sources.set(head, entry.xref!));
            }
        }
    }
    // A record cited nowhere keeps its xref too, while no cited record has it.
    for (const src of Object.values(data.sources ?? {}) as Source[]) {
        if (!src || cited.has(src.id)) continue;
        const entry = out.sourceEntries.get(src.id);
        if (!entry?.xref || groups.has(entry.xref.toUpperCase())) continue;
        claim(entry.xref, rank(entry.from), () => out.sources.set(src.id, entry.xref!));
    }
    for (const [key, c] of claims) {
        out.reserved.add(key);
        if (c.n === 1) c.assign();
    }
    return out;
}

export function exportToGedcom(data: StromData, treeName?: string, options: GedcomExportOptions = {}): GedcomExportResult {
    // Before the content options: a family link stays even without the notes.
    const alsoChild = alsoChildLinks(data);
    if (options.content) data = applyContentOptions(data, options.content);
    const writeReadings = options.readings !== false;
    const lines: string[] = [];

    // Create ID mappings (PersonId -> @I1@, PartnershipId -> @F1@)
    const personIdMap = new Map<PersonId, string>();
    const partnershipIdMap = new Map<PartnershipId, string>();

    // "Back to {prog}" (spec 066 K3.2): the records from that program's files
    // keep their xref where it is safe; every other xref is made around them.
    const back = backToXrefs(data, options.backTo);
    /** A person or a family of that program's files ("Back to {prog}"). */
    const isBackRecord = (holder: FactHolder): boolean =>
        (!!holder.importId && back.imports.has(holder.importId)) || (holder.originalIds ?? []).some(e => back.imports.has(e.from));
    /** Xrefs in use, without the @ signs (people, families, sources, repositories and the submitter share them). */
    const taken = new Set<string>(['SUBM1', ...back.reserved]);
    const counters: Record<string, number> = { I: 1, F: 1, S: 1, R: 1 };
    /** The next free `@{prefix}n@`. */
    const freshXref = (prefix: 'I' | 'F' | 'S' | 'R'): string => {
        let n = counters[prefix];
        while (taken.has(`${prefix}${n}`)) n++;
        counters[prefix] = n + 1;
        taken.add(`${prefix}${n}`);
        return `@${prefix}${n}@`;
    };

    // "Back to {prog}": the couple's other records of that program's file
    // (JOINED_TAG), written beside the couple's own; each keeps its xref
    // while no other record has it (once, when two imports kept the same).
    const joined = new Map<PartnershipId, { xref: string; own: string; from: string; record: JoinedRecord }[]>();
    if (back.imports.size > 0) {
        const seen = new Set<string>();
        for (const [id, ps] of Object.entries(data.partnerships) as [PartnershipId, Partnership][]) {
            for (const entry of ps?.gedcomExtra ?? []) {
                if (!back.imports.has(entry.from)) continue;
                for (const record of joinedRecords(entry.lines)) {
                    const key = `${id}\n${record.xref}\n${record.lines.join('\n')}\n${record.text}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    const free = isSafeXref(record.xref) && !taken.has(record.xref.toUpperCase());
                    if (free) taken.add(record.xref.toUpperCase());
                    const list = joined.get(id) ?? [];
                    joined.set(id, list);
                    list.push({ xref: free ? `@${record.xref}@` : '', own: record.xref, from: entry.from, record });
                }
            }
        }
    }

    // Map all persons to GEDCOM IDs — but a "?" stand-in that only marks the
    // unknown other parent of a family with children: no record of its own
    // (other programs would show a nameless spouse). The family keeps the known
    // parent and the children; a one-parent family reads back as the stand-in.
    for (const personId of Object.keys(data.persons) as PersonId[]) {
        if (standsInOnly(data, personId)) continue;
        const own = back.persons.get(personId);
        personIdMap.set(personId, own ? `@${own}@` : freshXref('I'));
    }

    // Map all partnerships to GEDCOM IDs
    for (const partnershipId of Object.keys(data.partnerships) as PartnershipId[]) {
        const own = back.families.get(partnershipId);
        partnershipIdMap.set(partnershipId, own ? `@${own}@` : freshXref('F'));
    }
    for (const list of joined.values()) for (const record of list) if (!record.xref) record.xref = freshXref('F');

    // The other families a person is also a child of (alsoChildLinks): both
    // ends written, the child's FAMC and the family's CHIL.
    const alsoChildOf = new Map<PersonId, AlsoChildOf[]>();
    const alsoChildren = new Map<PartnershipId, PersonId[]>();
    for (const [personId, links] of alsoChild) {
        if (!personIdMap.has(personId)) continue;
        const written = links.filter(l => partnershipIdMap.has(l.partnershipId)
            && !data.partnerships[l.partnershipId]?.childIds.includes(personId));
        if (!written.length) continue;
        alsoChildOf.set(personId, written);
        for (const l of written) {
            const list = alsoChildren.get(l.partnershipId);
            if (list) list.push(personId); else alsoChildren.set(l.partnershipId, [personId]);
        }
    }

    // Parent links outside any partnership (a parent added alone, the other
    // parent deleted, a couple taken apart): GEDCOM knows parents only through
    // a family, so they get a family of their own — one per set of such
    // parents, marked _STROM_NO_COUPLE so Strom reads them back without
    // making a couple (or a "?" partner) of them. Left out, the link was lost.
    const looseFamilies: { gedcomId: string; parentIds: PersonId[]; childIds: PersonId[] }[] = [];
    const looseFamiliesOf = new Map<PersonId, string[]>();
    {
        const byParents = new Map<string, { gedcomId: string; parentIds: PersonId[]; childIds: PersonId[] }>();
        const covered = new Set<string>();
        for (const u of Object.values(data.partnerships) as Partnership[]) {
            for (const cid of u.childIds) covered.add(`${cid}|${u.person1Id}`).add(`${cid}|${u.person2Id}`);
        }
        for (const [childId, child] of Object.entries(data.persons) as [PersonId, Person][]) {
            const loose = child.parentIds.filter(pid => personIdMap.has(pid) && !covered.has(`${childId}|${pid}`));
            if (loose.length === 0) continue;
            // One parent alone: a family per child (two such children need not share the other parent).
            const key = [...loose].sort().join('|') + (loose.length === 1 ? `|${childId}` : '');
            let family = byParents.get(key);
            if (!family) {
                family = { gedcomId: freshXref('F'), parentIds: loose, childIds: [] };
                byParents.set(key, family);
                looseFamilies.push(family);
                for (const pid of loose) {
                    const list = looseFamiliesOf.get(pid) ?? [];
                    list.push(family.gedcomId);
                    looseFamiliesOf.set(pid, list);
                }
            }
            family.childIds.push(childId);
            const list = looseFamiliesOf.get(childId) ?? [];
            list.push(family.gedcomId);
            looseFamiliesOf.set(childId, list);
        }
    }

    // Map all sources to GEDCOM IDs (@S1@ ...). "Back to {prog}": the sources
    // one record became share its xref (its own where it is safe).
    const sourceIdMap = new Map<string, string>();
    for (const sourceId of Object.keys(data.sources ?? {})) {
        const head = back.sourceGroups.get(sourceId);
        if (head && head !== sourceId) continue;
        const own = back.sources.get(sourceId);
        sourceIdMap.set(sourceId, own ? `@${own}@` : freshXref('S'));
    }
    for (const [sourceId, head] of back.sourceGroups) {
        if (head !== sourceId && sourceIdMap.has(head)) sourceIdMap.set(sourceId, sourceIdMap.get(head)!);
    }
    /** The members of each group, by its first member. */
    const groupMembers = new Map<string, Source[]>();
    for (const [sourceId, head] of back.sourceGroups) {
        const src = data.sources?.[sourceId];
        if (!src) continue;
        const list = groupMembers.get(head) ?? [];
        list.push(src);
        groupMembers.set(head, list);
    }
    // Unique repository names -> @Rx@ records (standard 5.5.1 structure).
    const repoIdMap = new Map<string, string>();
    for (const source of Object.values(data.sources ?? {})) {
        if (source.repository && !repoIdMap.has(source.repository)) {
            repoIdMap.set(source.repository, freshXref('R'));
        }
    }
    /**
     * "Back to {prog}": what the citation said that Strom does not read
     * (DATA > TEXT, EVEN > ROLE, see CITE_TAG), as written, at levels from 1
     * under the citation; split into its DATA's lines and the rest.
     */
    const keptCiteLines = (src: Source | undefined): { data: string[]; rest: string[] } => {
        const out = { data: [] as string[], rest: [] as string[] };
        const entry = back.imports.size ? src?.gedcomExtra?.find(e => back.imports.has(e.from) && citeLines(e.lines).length) : undefined;
        let inData = false;
        for (const line of entry ? citeLines(entry.lines) : []) {
            const level = Number(line.split(' ', 1)[0]);
            if (level === 1) { inData = line === '1 DATA'; if (inData) continue; }
            (inData ? out.data : out.rest).push(line);
        }
        return out;
    };
    /** Citation emitter: the source reference belongs on the citation as PAGE. */
    const pushCitation = (level: number, srcId: string): void => {
        const ref = sourceIdMap.get(srcId);
        if (!ref) return;
        lines.push(`${level} SOUR ${ref}`);
        const src = data.sources?.[srcId];
        const kept = keptCiteLines(src);
        const at = (line: string): string => line.replace(/^\d+/, n => String(Number(n) + level));
        if (src?.reference) pushLongValue(lines, level + 1, 'PAGE', src.reference);
        // The entry recording date lives on the citation in 5.5.1 (DATA > DATE).
        const recorded = formatGedcomDate(src?.recordDate);
        if (recorded || kept.data.length) {
            lines.push(`${level + 1} DATA`);
            if (recorded) lines.push(`${level + 2} DATE ${recorded}`);
            lines.push(...kept.data.map(at));
        }
        if (src?.quality !== undefined) lines.push(`${level + 1} QUAY ${src.quality}`);
        lines.push(...kept.rest.map(at));
    };

    // Get current date for header
    const now = new Date();
    const headerDate = `${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;

    // ==================== HEADER ====================
    lines.push('0 HEAD');
    lines.push('1 SOUR STROM');
    // The app's version (older apps wrote a fixed "1.0"): a reader knows what the
    // file means by it ("? /Unknown/" is no surname only from an app before 3.10.0-beta.7).
    lines.push(`2 VERS ${APP_VERSION}`);
    lines.push('2 NAME Strom Family Tree');
    lines.push('1 DEST ANSTFILE');
    lines.push(`1 DATE ${headerDate}`);
    lines.push('1 SUBM @SUBM1@');
    lines.push('1 GEDC');
    lines.push('2 VERS 5.5.1');
    lines.push('2 FORM LINEAGE-LINKED');
    lines.push('1 CHAR UTF-8');
    lines.push(...researchHeaderLines(options.research));
    lines.push(STROM_SEX_U_LINE);

    // The files the tree's facts came from (spec 066): one record per loaded
    // file, named by its id under every record and fact still as it gave it.
    const knownImports = new Set<string>();
    for (const rec of data.imports ?? []) {
        knownImports.add(rec.id);
        lines.push(`1 ${IMPORT_TAG} ${rec.id}`);
        if (rec.program) pushWrapped(lines, 2, 'SOUR', rec.program);
        if (rec.version) pushWrapped(lines, 2, 'VERS', rec.version);
        if (rec.fileDate) pushWrapped(lines, 2, 'DATE', rec.fileDate);
        lines.push(`2 _AT ${rec.at}`);
        if (rec.file) pushWrapped(lines, 2, 'FILE', rec.file);
        if (rec.sha) lines.push(`2 _SHA ${rec.sha}`);
    }
    /** `n _STROM_IMPORT Ix` of a record from a known import. */
    const pushRecordImport = (importId: string | undefined): void => {
        if (importId && knownImports.has(importId)) lines.push(`1 ${IMPORT_TAG} ${importId}`);
    };
    /**
     * A person's or a family's imports (spec 066 K3.2): `1 _STROM_IMPORT Ix`
     * of the import it came from, with its ids there (`2 _XREF`, `2 _UID`…);
     * the ids of each import it did not come from under `1 _STROM_XID Iy`
     * (no origin: a person entered by hand stays the person's). "Back to
     * {prog}" adds that program's ids as level-1 lines, and the original xref
     * the file could not use as a REFN.
     */
    const pushHolderOrigin = (holder: FactHolder, xref: string, backEntry: OriginalIds | undefined): void => {
        const entries = (holder.originalIds ?? []).filter(e => knownImports.has(e.from));
        const first = holder.importId && knownImports.has(holder.importId) ? holder.importId : undefined;
        if (first) {
            lines.push(`1 ${IMPORT_TAG} ${first}`);
            const entry = entries.find(e => e.from === first);
            if (entry) pushOriginalIdLines(lines, 2, entry, true);
        }
        for (const entry of entries) {
            if (entry.from === first) continue;
            lines.push(`1 ${XID_TAG} ${entry.from}`);
            pushOriginalIdLines(lines, 2, entry, true);
        }
        if (!backEntry) return;
        pushOriginalIdLines(lines, 1, backEntry, false);
        if (backEntry.xref && `@${backEntry.xref}@` !== xref) {
            pushWrapped(lines, 1, 'REFN', backEntry.xref);
            pushWrapped(lines, 2, 'TYPE', `${back.program} xref`);
        }
    };
    /**
     * "Back to {prog}" (spec 066 G8): the program's own level-1 tags the
     * record had in its files, at the end of the record exactly as they were
     * written (the same block from two of its files once). Never in another
     * export: not in Strom's own file, not to the research.
     */
    const pushGedcomExtra = (holder: ExtraHolder): void => {
        if (back.imports.size === 0 || !holder.gedcomExtra) return;
        const written = new Set<string>();
        for (const entry of holder.gedcomExtra) {
            if (!back.imports.has(entry.from)) continue;
            // (A citation's own lines go under the citation, see pushCitation;
            // a structure that became lines of the note goes in their place, see notedOf.)
            const entryLines = withoutNotedLines(withoutCiteLines(entry.lines));
            let block: string[] = [];
            const flush = (): void => {
                const key = block.join('\n');
                if (block.length > 0 && !written.has(key)) { written.add(key); lines.push(...block); }
                block = [];
            };
            for (const line of entryLines) {
                if (line.startsWith('1 ')) flush();
                block.push(line);
            }
            flush();
        }
    };
    /**
     * "Back to {prog}": the structures of its file the import wrote into the
     * record's note (NOTED_TAG), each while the note still has its lines, and
     * the note without them. Every other export writes the note as it is.
     */
    const notedOf = (holder: ExtraHolder, note: string | undefined): { note: string | undefined; structures: NotedStructure[] } => {
        if (back.imports.size === 0 || !holder.gedcomExtra) return { note, structures: [] };
        const seen = new Set<string>();
        // (The page sources of one record each keep the record's structures: once.)
        const structures = holder.gedcomExtra.filter(e => back.imports.has(e.from)).flatMap(e => notedStructures(e.lines))
            .filter(st => !seen.has(st.lines.join('\n')) && !!seen.add(st.lines.join('\n')));
        return notedBack(note, structures);
    };
    /** Those structures of one fact (`1 BIRT` …), and the rest. */
    const notedFact = (structures: NotedStructure[], tag: string): NotedStructure[] =>
        structures.filter(st => st.lines[0] === `1 ${tag}` || st.lines[0].startsWith(`1 ${tag} `));
    /** A structure's lines under the fact Strom writes, or the whole structure where it writes none. */
    const pushNoted = (structures: NotedStructure[], under: boolean): void => {
        for (const st of structures) lines.push(...(under ? st.lines.slice(1) : st.lines));
    };
    /**
     * A fact's DATE the date field could not hold whole ("1815/1816", "10 JAN",
     * another calendar), as the file wrote it with the lines under it, and the
     * fact's other noted lines. It goes in place of the field's DATE while the
     * field is empty or still has the date the import read from it; a date
     * changed in the app wins.
     */
    const notedDate = (structures: NotedStructure[], holder: FactHolder, key: string, value: string | undefined): { date: string[]; rest: NotedStructure[] } => {
        let date: string[] = [];
        const rest: NotedStructure[] = [];
        for (const st of structures) {
            const at = st.lines.findIndex(l => l === '2 DATE' || l.startsWith('2 DATE '));
            if (at < 0 || date.length) { rest.push(st); continue; }
            let end = at + 1;
            while (end < st.lines.length && !/^[0-2] /.test(st.lines[end])) end++;
            date = st.lines.slice(at, end);
            const left = [...st.lines.slice(0, at), ...st.lines.slice(end)];
            if (left.length > 1) rest.push({ texts: st.texts, lines: left });
        }
        const kept = !value || importedValueOf(holder, key)?.value === value;
        return { date: kept ? date : [], rest };
    };
    /**
     * "Back to {prog}": a divorce with no date or place under it is said
     * with Y (`1 DIV Y`), as GEDCOM asks of such an event. A bare
     * wedding stays `1 MARR`: a couple entered as married writes it so.
     */
    const sayOccurred = (at: number): void => {
        if (back.imports.size === 0 || lines[at] !== '1 DIV') return;
        if (lines.slice(at + 1).some(l => /^2 (DATE|PLAC)\b/.test(l))) return;
        lines[at] += ' Y';
    };
    /** The `2 _STROM_IMPORT` lines of a fact: only for parts whose value is still the file's. */
    const pushFactImport = (holder: FactHolder, fact: string): void => {
        for (const tag of factImportTags(holder, fact)) {
            if (knownImports.has(tag.split(' ')[0])) lines.push(`2 ${IMPORT_TAG} ${tag}`);
        }
    };
    /** The research's origin of a fact under it (`2 _STROM_ORIGIN`, `2 _STROM_WAS`), file exports only. */
    const pushFactOrigin = (holder: FactHolder, fact: string): void => {
        if (options.researchNote && NOTE_FACT(fact)) {
            const src = researchNoteSource(data, holder, fact);
            if (src) pushNote(lines, 2, options.researchNote(src));
        }
        const o = options.origins ? holder.researchOrigins?.[fact] : undefined;
        if (!o) return;
        if (o.kind && fact !== 'sex') lines.push(`2 _STROM_ORIGIN ${researchOriginValue(o)}`);
        pushResearchWas(lines, 2, o.was);
    };
    /** The import of a child's link to the given parents (all of them from it), or none. */
    const childLinkImport = (childId: PersonId, parentIds: readonly PersonId[]): string | undefined => {
        const marks = data.persons[childId]?.importedParents;
        if (!marks || parentIds.length === 0) return undefined;
        const ids = parentIds.map(pid => marks[pid]);
        return ids.every(id => !!id && knownImports.has(id)) ? ids[0] : undefined;
    };

    // Surname-variant groups: no GEDCOM structure fits "these spellings mean one
    // family", so they ride in a header NOTE (standard, kept by every reader).
    // The marker line lets our own importer read them back; the group lines are
    // human-readable on their own.
    // The file for the research carries both markers always, an empty one
    // meaning "none" (the research takes a missing marker as "nothing said");
    // a plain export only a list that has something in it.
    const surnameGroups = (data.surnameVariants ?? []).filter(g => g.length >= 2);
    const rejectedGroups = (data.surnameRejections ?? []).map(r => r.forms).filter(g => g.length >= 2);
    for (const [marker, groups] of [[SURNAME_GROUPS_MARKER, surnameGroups], [SURNAME_REJECTIONS_MARKER, rejectedGroups]] as const) {
        if (groups.length === 0 && !options.research) continue;
        lines.push(`1 NOTE ${marker}`);
        for (const group of groups) {
            pushWrapped(lines, 2, 'CONT', group.join(SURNAME_GROUP_SEP));
        }
    }

    // Lineage corrections (data v14): `1 _STROM_LINE FOUNDER|NOCARRY` under the
    // person. The header mark says the file speaks about them: always in the
    // file for the research (no tag = no correction), in a plain export only
    // when someone carries the tag.
    const { founders: lineFounders, notCarriers: lineNotCarriers } = lineageOverridesOf(data);
    const lineTagOf = (id: PersonId): string | null =>
        lineFounders.has(id) ? 'FOUNDER' : lineNotCarriers.has(id) ? 'NOCARRY' : null;
    const anyLineTag = (Object.keys(data.persons) as PersonId[]).some(id => personIdMap.has(id) && lineTagOf(id));
    if (options.research || anyLineTag) lines.push(`1 ${STROM_LINES_TAG} Y`);

    // ==================== SUBMITTER ====================
    lines.push('0 @SUBM1@ SUBM');
    pushWrapped(lines, 1, 'NAME', treeName || 'Strom User');

    // ==================== INDIVIDUALS ====================
    for (const [personId, person] of Object.entries(data.persons) as [PersonId, Person][]) {
        const gedcomId = personIdMap.get(personId);
        if (!gedcomId) continue;

        lines.push(`0 ${gedcomId} INDI`);
        pushHolderOrigin(person, gedcomId, back.personEntries.get(personId));
        const links = alsoChildOf.get(personId);
        const noted = notedOf(person, person.notes && links ? notesWithoutLinks(person.notes, links) : person.notes);
        const notedBirth = notedFact(noted.structures, 'BIRT');
        const notedDeath = notedFact(noted.structures, 'DEAT');

        // Name. Placeholders are exported with an empty name so they re-import
        // as placeholders (lossless), instead of being dropped.
        const nameParts = back.imports.size > 0 && isBackRecord(person);
        if (person.isPlaceholder && (person.firstName === '?' || !person.firstName) && !person.lastName) {
            lines.push('1 NAME //');
        } else {
            pushName(lines, person, options.titles, nameParts);
        }
        // Which surname the person goes by (Person.primaryName), Strom's mark
        // under the chosen NAME: the birth name (the first one) or the married
        // one; none without a choice or a married surname.
        const married = person.marriedSurname?.trim();
        if (married && person.primaryName === 'birth') lines.push(`2 ${PRIMARY_NAME_TAG} Y`);
        pushFactImport(person, 'name');
        pushFactOrigin(person, 'name');
        // The surname after marriage as the name she had after it, right
        // after the primary one (the birth name), as the research writes it;
        // with its own given names when they are not the person's.
        if (married) {
            const marriedFirst = person.marriedFirstName?.trim() || person.firstName;
            pushWrapped(lines, 1, 'NAME', formatGedcomName(marriedFirst, married));
            lines.push('2 TYPE married');
            // Its parts too in "Back to", as of the birth name (pushName).
            if (nameParts) {
                const first = (marriedFirst ?? '').trim();
                if (first && !noName(first) && !first.includes(',')) pushWrapped(lines, 2, 'GIVN', first);
                if (!married.includes(',')) pushWrapped(lines, 2, 'SURN', married);
            }
            if (person.primaryName === 'married') lines.push(`2 ${PRIMARY_NAME_TAG} Y`);
        }
        // Other spellings as further NAME lines — the first one above stays the
        // primary, which is what every reader expects.
        for (const variant of person.nameVariants ?? []) {
            pushWrapped(lines, 1, 'NAME', variant);
        }

        // Sex: M, F, or U for a sex the records do not give.
        lines.push(`1 SEX ${person.gender === 'male' ? 'M' : person.gender === 'female' ? 'F' : 'U'}`);
        pushFactImport(person, 'sex');
        pushFactOrigin(person, 'sex');
        const sexOrigin = options.origins ? person.researchOrigins?.sex : undefined;
        if (sexOrigin?.kind) lines.push(`1 _STROM_SEX_ORIGIN ${researchOriginValue(sexOrigin)}`);
        const lineTag = lineTagOf(personId);
        if (lineTag) lines.push(`1 ${STROM_LINE_TAG} ${lineTag}`);

        // Birth (with the citations of the birth entry: 2 SOUR)
        const birthNoted = notedDate(notedBirth, person, 'birthDate', person.birthDate);
        if (person.birthDate || person.birthPlace || person.birthAddress || person.birthAge || person.birthSourceIds?.length) {
            lines.push('1 BIRT');
            if (birthNoted.date.length) {
                lines.push(...birthNoted.date);
            } else if (person.birthDate) {
                const date = formatGedcomDate(person.birthDate, person.gedcomDates);
                if (date) lines.push(`2 DATE ${date}`);
            }
            if (person.birthPlace) {
                pushPlace(lines, 2, person.birthPlace, data.places);
            }
            pushDetails(lines, { age: person.birthAge, address: person.birthAddress });
            pushStatus(lines, person.birthStatus);
            for (const srcId of person.birthSourceIds ?? []) pushCitation(2, srcId);
            pushNoted(birthNoted.rest, true);
            pushFactImport(person, 'birth');
            pushFactOrigin(person, 'birth');
        } else {
            pushNoted(notedBirth, false);
        }

        // Death (a cited death without a date or place is a known death: DEAT Y)
        const deathDetail = person.deathCause || person.deathAge || person.deathAddress;
        const deathNoted = notedDate(notedDeath, person, 'deathDate', person.deathDate);
        if (person.deathDate || person.deathPlace || deathDetail || person.deathSourceIds?.length) {
            lines.push(person.deathDate || person.deathPlace || deathDetail || deathNoted.date.length ? '1 DEAT' : '1 DEAT Y');
            if (deathNoted.date.length) {
                lines.push(...deathNoted.date);
            } else if (person.deathDate) {
                const date = formatGedcomDate(person.deathDate, person.gedcomDates);
                if (date) lines.push(`2 DATE ${date}`);
            }
            if (person.deathPlace) {
                pushPlace(lines, 2, person.deathPlace, data.places);
            }
            pushDetails(lines, { cause: person.deathCause, age: person.deathAge, address: person.deathAddress });
            pushStatus(lines, person.deathStatus);
            for (const srcId of person.deathSourceIds ?? []) pushCitation(2, srcId);
            pushNoted(deathNoted.rest, true);
            pushFactImport(person, 'death');
            pushFactOrigin(person, 'death');
        } else if (person.isDeceased === true) {
            // Known to be dead, date unknown: the standard way to say so.
            // Without it the person came back as possibly living. (A date
            // the file wrote that the field could not hold goes in its place.)
            lines.push(deathNoted.date.length ? '1 DEAT' : '1 DEAT Y');
            lines.push(...deathNoted.date);
            // Where that came from goes along (the research's DEAT Y has one).
            pushStatus(lines, person.deathStatus);
            pushNoted(deathNoted.rest, true);
            pushFactImport(person, 'death');
            pushFactOrigin(person, 'death');
        } else {
            pushNoted(notedDeath, false);
        }

        // User reference number (id in a paper archive / another program)
        if (person.refn) {
            pushWrapped(lines, 1, 'REFN', person.refn);
            if (person.refnType) pushWrapped(lines, 2, 'TYPE', person.refnType);
        }

        // The open question about this person ("does anyone know when she
        // was born?") — Strom's own tag, so it travels with the file.
        if (person.question) pushLongValue(lines, 1, '_QUESTION', person.question);

        // Note
        if (person.story) {
            pushStory(lines, 1, person.story, id => sourceIdMap.get(id));
        }

        if (noted.note) pushNote(lines, 1, noted.note);
        pushNoted(noted.structures.filter(st => !notedBirth.includes(st) && !notedDeath.includes(st)), false);

        // Life events. OCCU carries its detail as the tag value; the rest use
        // level-2 DATE/PLAC/NOTE. 'custom'/'military' have no dedicated tag and
        // ride on the generic EVEN with a TYPE label, so nothing is dropped.
        for (const fileEvent of person.events ?? []) {
            // "Back to {prog}": the file's e-mail addresses go back as EMAIL,
            // out of the note while it still has their line (spec 066 K3.1).
            const { event, emails } = back.imports.size > 0 && isBackRecord(person)
                ? emailsBack(fileEvent) : { event: fileEvent, emails: [] };
            const tag = EVENT_TYPE_TO_TAG[event.type];
            let typeLabel: string | null = null;
            if (!tag) {
                typeLabel = event.type === 'custom'
                    ? (event.customLabel || strings.gedcomNotes.genericEvent)
                    : strings.events.types[event.type];
            }
            if (tag && eventValueIsOnTag(event.type) && event.note) {
                // The note IS the fact for these — GEDCOM puts it on the tag
                // line, not in a subordinate NOTE.
                //
                // Import glues the tag's value and any subordinate NOTE into
                // this one field, so split it back the way it came: the first
                // line is the fact, the rest is the remark about it. Writing
                // the whole field on the tag line emitted the newline verbatim,
                // which is a physical line with no level in front of it — the
                // file stopped being GEDCOM and the remark was gone after one
                // more pass. pushLongValue also chunks a long value into CONC
                // instead of blowing the 255-byte limit.
                const [fact, ...rest] = event.note.split('\n');
                pushLongValue(lines, 1, tag, fact);
                const remark = rest.join('\n').trim();
                if (remark) pushNote(lines, 2, remark);
            } else {
                lines.push(`1 ${tag ?? 'EVEN'}`);
                if (typeLabel) pushLongValue(lines, 2, 'TYPE', typeLabel);
            }
            if (event.date) {
                const date = formatGedcomDate(event.date, person.gedcomDates);
                if (date) lines.push(`2 DATE ${date}`);
            }
            if (event.place) {
                pushPlace(lines, 2, event.place, data.places);
            }
            pushDetails(lines, event);
            for (const email of emails) pushWrapped(lines, 2, 'EMAIL', email);
            pushStatus(lines, event.status);
            if (event.note && !eventValueIsOnTag(event.type)) {
                pushNote(lines, 2, event.note);
            }
            // Godparents / witnesses. Someone in the tree goes out as ASSO
            // pointing at their record; someone who is not (the usual case for
            // a godparent) has no record to point at, so they go as _WITN with
            // the name as written. Both carry the role in RELA.
            for (const part of event.participants ?? []) {
                const xref = part.personId ? personIdMap.get(part.personId) : undefined;
                if (xref) {
                    lines.push(`2 ASSO ${xref}`);
                } else if (part.name) {
                    pushWrapped(lines, 2, '_WITN', part.name);
                } else {
                    // Linked to someone who is not in this export — cut out by a
                    // subtree export, or removed by the privacy filter. Their
                    // name is deliberately NOT written out instead: if the
                    // filter took them out, naming them here would put them back.
                    continue;
                }
                lines.push(`3 RELA ${GEDCOM_RELA[part.role]}`);
                if (part.note) pushNote(lines, 3, part.note);
            }

            // Source citations on the event (2 SOUR @Sx@ + 3 PAGE).
            for (const srcId of event.sourceIds ?? []) {
                pushCitation(2, srcId);
            }
            pushFactImport(person, `event:${event.id}`);
            pushFactOrigin(person, `event:${event.id}`);
        }

        // Source citations on the person (1 SOUR @Sx@ + 2 PAGE).
        for (const srcId of person.sourceIds ?? []) {
            pushCitation(1, srcId);
        }

        // Media: portrait first (marked), then attachments. Data URLs are
        // CONC-wrapped to keep physical lines within the spec limit.
        const pushMedia = (file: string, title: string, kind: 'photo' | '', note?: string, srcId?: string, original?: MediaOriginal, fileMime?: string, date?: string): void => {
            const mime = file.startsWith('data:') ? file.slice(5, file.indexOf(';')) : fileMime ?? '';
            const form = mime.includes('/') ? mime.split('/')[1] : 'jpeg';
            lines.push('1 OBJE');
            lines.push(`2 FORM ${form}`);
            if (title) pushWrapped(lines, 2, 'TITL', title);
            if (kind) lines.push(`2 _STROM_KIND ${kind}`);
            if (note) pushLongValue(lines, 2, 'NOTE', note);
            // The source this scan belongs to. 5.5.1 has no SOUR under a
            // multimedia link, hence the underscore tag.
            const srcRef = srcId ? sourceIdMap.get(srcId) : undefined;
            if (srcRef) lines.push(`2 _SOUR ${srcRef}`);
            // The original behind the preview, by its hash: Strom Research holds it.
            const sha = normalizeSha256(original?.sha256);
            if (sha) {
                lines.push(`2 _STROM_SHA ${sha}`);
                const o = original?.orientation;
                if (o && o >= 2 && o <= 8) lines.push(`2 _STROM_ORIENT ${o}`);
            }
            pushWrapped(lines, 2, 'FILE', file);
            // The picture's date from the program's file (spec 066 G8): back under its OBJE, "Back to {prog}" only.
            const day = back.imports.size > 0 && date ? mediaDateValue(date) : undefined;
            if (day) lines.push(`2 _DATE ${day}`);
        };
        if (person.photo) {
            pushMedia(person.photo, person.photoOriginalName ?? '', 'photo', undefined, undefined, undefined, undefined, person.photoDate);
        }
        for (const att of person.attachments ?? []) {
            // Only the original (the research holds it): the file's name and hash, no data.
            if (att.originalOnly) pushMedia(att.name || 'file', att.name, '', att.note, att.sourceId, att.original, att.original?.mimeType ?? att.mimeType, att.date);
            else pushMedia(att.dataUrl, att.name, '', att.note, att.sourceId, att.original, undefined, att.date);
        }

        // Family as spouse (FAMS) - partnerships where this person is a partner
        for (const partnershipId of person.partnerships) {
            const famId = partnershipIdMap.get(partnershipId);
            if (famId) {
                lines.push(`1 FAMS ${famId}`);
                for (const record of joined.get(partnershipId) ?? []) lines.push(`1 FAMS ${record.xref}`);
            }
        }

        // Families of parent links outside a partnership (see looseFamilies):
        // as a parent FAMS, as a child FAMC with PEDI as below.
        const looseFamilyOf = (famId: string) => looseFamilies.find(f => f.gedcomId === famId)!;
        for (const famId of looseFamiliesOf.get(personId) ?? []) {
            if (looseFamilyOf(famId).parentIds.includes(personId)) lines.push(`1 FAMS ${famId}`);
        }
        for (const famId of looseFamiliesOf.get(personId) ?? []) {
            const family = looseFamilyOf(famId);
            if (!family.childIds.includes(personId)) continue;
            lines.push(`1 FAMC ${famId}`);
            const rels = person.parentRelTypes ?? {};
            const famRels = family.parentIds.map(pid => rels[pid]);
            const pedi = famRels.includes('adoptive') ? 'adopted'
                : famRels.includes('foster') ? 'foster' : null;
            if (pedi) lines.push(`2 PEDI ${pedi}`);
        }

        // Family as child (FAMC) - find partnerships where this person is a child
        for (const [partnershipId, partnership] of Object.entries(data.partnerships) as [PartnershipId, Partnership][]) {
            if (partnership.childIds.includes(personId)) {
                const famId = partnershipIdMap.get(partnershipId);
                if (famId) {
                    lines.push(`1 FAMC ${famId}`);
                    // PEDI reflects the child's relationship to this family. GEDCOM
                    // has adopted/foster but no 'step' — step links export without
                    // PEDI (known-unsupported, see header).
                    const rels = person.parentRelTypes ?? {};
                    const famRels = [partnership.person1Id, partnership.person2Id].map(pid => rels[pid]);
                    const pedi = famRels.includes('adoptive') ? 'adopted'
                        : famRels.includes('foster') ? 'foster' : null;
                    if (pedi) lines.push(`2 PEDI ${pedi}`);
                }
            }
        }
        // …and the families it was also recorded in, after the one it hangs from.
        for (const link of alsoChildOf.get(personId) ?? []) {
            lines.push(`1 FAMC ${partnershipIdMap.get(link.partnershipId)}`);
            if (link.pedi) lines.push(`2 PEDI ${link.pedi}`);
        }

        pushGedcomExtra(person);
    }

    // ==================== FAMILIES ====================
    for (const [partnershipId, partnership] of Object.entries(data.partnerships) as [PartnershipId, Partnership][]) {
        const gedcomId = partnershipIdMap.get(partnershipId);
        if (!gedcomId) continue;

        const person1 = data.persons[partnership.person1Id];
        const person2 = data.persons[partnership.person2Id];

        lines.push(`0 ${gedcomId} FAM`);
        pushHolderOrigin(partnership, gedcomId, back.familyEntries.get(partnershipId));

        // Determine HUSB/WIFE by gender (male = HUSB, female = WIFE, a person
        // of unknown sex the role the other one leaves free). For a mixed
        // couple this is independent of person1/person2 order, so HUSB is
        // always emitted before WIFE and the GEDCOM is round-trip stable.
        // Two of one sex (or two unknown) keep person1 = HUSB, person2 = WIFE.
        const [husbId, wifeId] = person1 && person2
            ? coupleSides(person1, person2).map(p => p.id)
            : [partnership.person1Id, partnership.person2Id];
        if (personIdMap.has(husbId)) {
            lines.push(`1 HUSB ${personIdMap.get(husbId)}`);
        }
        if (personIdMap.has(wifeId)) {
            lines.push(`1 WIFE ${personIdMap.get(wifeId)}`);
        }

        // Children
        for (const childId of partnership.childIds) {
            const childGedcomId = personIdMap.get(childId);
            if (childGedcomId) {
                lines.push(`1 CHIL ${childGedcomId}`);
                // Different ties to the two parents: say which is which.
                const rels = data.persons[childId]?.parentRelTypes ?? {};
                // A "?" stand-in left out has no tie to say (as a parent alone, see looseFamilies).
                const toHusb = personIdMap.has(husbId) ? rels[husbId] ?? 'biological' : undefined;
                const toWife = personIdMap.has(wifeId) ? rels[wifeId] ?? 'biological' : undefined;
                // Also when both ties are 'step': PEDI has no such value, so
                // this is the only place a stepchild of both can be said.
                if (toHusb && toWife) {
                    if (toHusb !== toWife || toHusb === 'step') {
                        lines.push(`2 _FREL ${GEDCOM_CHILD_REL[toHusb]}`);
                        lines.push(`2 _MREL ${GEDCOM_CHILD_REL[toWife]}`);
                    }
                } else if (toHusb === 'step') lines.push(`2 _FREL ${GEDCOM_CHILD_REL[toHusb]}`);
                else if (toWife === 'step') lines.push(`2 _MREL ${GEDCOM_CHILD_REL[toWife]}`);
                const linkImport = childLinkImport(childId, [husbId, wifeId].filter(pid => personIdMap.has(pid)));
                if (linkImport) lines.push(`2 ${IMPORT_TAG} ${linkImport}`);
            }
        }
        // Children that hang from another family but were also recorded in this one (alsoChildLinks).
        for (const childId of alsoChildren.get(partnershipId) ?? []) lines.push(`1 CHIL ${personIdMap.get(childId)}`);

        // Marriage event (for married or divorced status) — not the bare status of a family whose other
        // parent is only a "?" stand-in (it would read as a wedding to someone unknown).
        // A "?" family of one child keeps "married" to itself (the default, a child's one known parent). A
        // childless one ("married, the spouse unknown") and one of siblings say it: with siblings it is what
        // keeps them one family there and back (R1 of the N1 round: split into a family per child).
        const withStandIn = (!personIdMap.has(partnership.person1Id) || !personIdMap.has(partnership.person2Id)) && partnership.childIds.length === 1;
        // A couple whose file wrote no MARR gets none either (spec 066 K3.1),
        // unless the wedding has something to say now (its witnesses, its status).
        const noMarriageSaid = partnership.marriageUnrecorded === true && !partnership.participants?.length && !partnership.startStatus;
        const hasMarriage = ((partnership.status === 'married' || partnership.status === 'divorced') && !withStandIn && !noMarriageSaid) ||
            !!partnership.startDate || !!partnership.startPlace || !!partnership.address
            || Object.values(partnership.ages ?? {}).some(a => a.trim());
        // What the couple's other records gave its note goes back with them (see joined).
        const joinedHere = joined.get(partnershipId) ?? [];
        const joinedNote = joinedNoteBack(partnership.note, joinedHere.map(j => j.record));
        const famNoted = notedOf(partnership, joinedNote.note);
        const notedMarriage = notedFact(famNoted.structures, 'MARR');
        const notedDivorce = notedFact(famNoted.structures, 'DIV');
        const marriageNoted = notedDate(notedMarriage, partnership, 'startDate', partnership.startDate);
        const divorceNoted = notedDate(notedDivorce, partnership, 'endDate', partnership.endDate);
        if (hasMarriage) {
            const at = lines.length;
            lines.push('1 MARR');
            if (marriageNoted.date.length) {
                lines.push(...marriageNoted.date);
            } else if (partnership.startDate) {
                const date = formatGedcomDate(partnership.startDate, partnership.gedcomDates);
                if (date) lines.push(`2 DATE ${date}`);
            }
            if (partnership.startPlace) {
                pushPlace(lines, 2, partnership.startPlace, data.places);
            }
            pushDetails(lines, { address: partnership.address });
            pushStatus(lines, partnership.startStatus);
            // Each partner's age at the wedding, under HUSB / WIFE.
            for (const [role, pid] of [['HUSB', husbId], ['WIFE', wifeId]] as const) {
                const age = partnership.ages?.[pid]?.trim();
                if (!age) continue;
                lines.push(`2 ${role}`);
                pushWrapped(lines, 3, 'AGE', gedcomAge(age));
            }
            // Witnesses at the wedding, written like the ones on an event: in
            // the tree → ASSO at their record, otherwise _WITN with the name.
            for (const part of partnership.participants ?? []) {
                const xref = part.personId ? personIdMap.get(part.personId) : undefined;
                if (xref) {
                    lines.push(`2 ASSO ${xref}`);
                } else if (part.name) {
                    pushWrapped(lines, 2, '_WITN', part.name);
                } else {
                    continue;
                }
                lines.push(`3 RELA ${GEDCOM_RELA[part.role]}`);
                if (part.note) pushNote(lines, 3, part.note);
            }
            // The couple's citations are the marriage record's: under MARR, where
            // other programs and Strom Research read a marriage's evidence.
            for (const srcId of partnership.sourceIds ?? []) pushCitation(2, srcId);
            pushNoted(marriageNoted.rest, true);
            pushFactImport(partnership, 'marriage');
            pushFactOrigin(partnership, 'marriage');
            sayOccurred(at);
        } else {
            pushNoted(notedMarriage, false);
        }

        // Divorce event
        if (partnership.status === 'divorced' || partnership.endDate || partnership.endPlace) {
            const at = lines.length;
            lines.push('1 DIV');
            if (divorceNoted.date.length) {
                lines.push(...divorceNoted.date);
            } else if (partnership.endDate) {
                const date = formatGedcomDate(partnership.endDate, partnership.gedcomDates);
                if (date) lines.push(`2 DATE ${date}`);
            }
            if (partnership.endPlace) pushPlace(lines, 2, partnership.endPlace, data.places);
            pushStatus(lines, partnership.endStatus);
            pushNoted(divorceNoted.rest, true);
            pushFactImport(partnership, 'divorce');
            pushFactOrigin(partnership, 'divorce');
            sayOccurred(at);
        } else {
            pushNoted(notedDivorce, false);
        }

        // The couple's own events, each under its own tag (1 MARB, 1 CENS,
        // 1 EVEN + 2 TYPE …) — never as lines of the note, so another program
        // and the research read them as facts.
        for (const event of sortCoupleEvents(partnership.events ?? [])) {
            lines.push(`1 ${COUPLE_EVENT_TAG[event.type]}`);
            if (event.type === 'custom') {
                pushLongValue(lines, 2, 'TYPE', event.customLabel || strings.gedcomNotes.genericEvent);
            }
            if (event.date) {
                const date = formatGedcomDate(event.date, partnership.gedcomDates);
                if (date) lines.push(`2 DATE ${date}`);
            }
            if (event.place) pushPlace(lines, 2, event.place, data.places);
            pushDetails(lines, { cause: event.cause, address: event.address });
            pushStatus(lines, event.status);
            for (const [role, pid] of [['HUSB', husbId], ['WIFE', wifeId]] as const) {
                const age = event.ages?.[pid]?.trim();
                if (!age) continue;
                lines.push(`2 ${role}`);
                pushWrapped(lines, 3, 'AGE', gedcomAge(age));
            }
            if (event.note) pushNote(lines, 2, event.note);
            for (const part of event.participants ?? []) {
                const xref = part.personId ? personIdMap.get(part.personId) : undefined;
                if (xref) {
                    lines.push(`2 ASSO ${xref}`);
                } else if (part.name) {
                    pushWrapped(lines, 2, '_WITN', part.name);
                } else {
                    continue;
                }
                lines.push(`3 RELA ${GEDCOM_RELA[part.role]}`);
                if (part.note) pushNote(lines, 3, part.note);
            }
            for (const srcId of event.sourceIds ?? []) pushCitation(2, srcId);
            pushFactImport(partnership, `event:${event.id}`);
            pushFactOrigin(partnership, `event:${event.id}`);
        }

        // A status MARR/DIV cannot say (partners, separated).
        const stat = GEDCOM_STAT[partnership.status];
        if (stat) lines.push(`1 _STAT ${stat}`);

        if (partnership.story) {
            pushStory(lines, 1, partnership.story, id => sourceIdMap.get(id));
        }

        // Note
        if (famNoted.note) pushNote(lines, 1, famNoted.note);
        pushNoted(famNoted.structures.filter(st => !notedMarriage.includes(st) && !notedDivorce.includes(st)), false);

        // Family citations of a couple without a marriage (partners).
        for (const srcId of hasMarriage ? [] : partnership.sourceIds ?? []) {
            pushCitation(1, srcId);
        }

        pushGedcomExtra(partnership);

        // The couple's other records of the program's file, as it wrote them (see joined).
        for (const { xref, own, from, record } of joinedHere) {
            lines.push(`0 ${xref} FAM`);
            if (knownImports.has(from)) {
                lines.push(`1 ${IMPORT_TAG} ${from}`);
                if (own) lines.push(`2 _XREF @${own}@`);
            }
            if (personIdMap.has(husbId)) lines.push(`1 HUSB ${personIdMap.get(husbId)}`);
            if (personIdMap.has(wifeId)) lines.push(`1 WIFE ${personIdMap.get(wifeId)}`);
            // Its notes while the couple's note still has what they gave it (else they stay there).
            lines.push(...(record.text && !joinedNote.found.has(record) ? withoutJoinedNotes(record.lines) : record.lines));
        }
    }

    // Parents who are not a couple, with their children (see looseFamilies).
    for (const family of looseFamilies) {
        lines.push(`0 ${family.gedcomId} FAM`);
        // HUSB/WIFE by gender as for a couple; two of one gender keep their order.
        const [a, b] = family.parentIds;
        let husbId: PersonId | undefined = a;
        let wifeId: PersonId | undefined = b;
        if (!b) {
            husbId = data.persons[a]?.gender === 'male' ? a : undefined;
            wifeId = husbId ? undefined : a;
        } else {
            [husbId, wifeId] = coupleSides({ id: a, gender: data.persons[a]?.gender }, { id: b, gender: data.persons[b]?.gender }).map(p => p.id);
        }
        if (husbId) lines.push(`1 HUSB ${personIdMap.get(husbId)}`);
        if (wifeId) lines.push(`1 WIFE ${personIdMap.get(wifeId)}`);
        for (const childId of family.childIds) {
            lines.push(`1 CHIL ${personIdMap.get(childId)}`);
            const rels = data.persons[childId]?.parentRelTypes ?? {};
            const toHusb = husbId ? rels[husbId] ?? 'biological' : undefined;
            const toWife = wifeId ? rels[wifeId] ?? 'biological' : undefined;
            if (toHusb && (toHusb !== (toWife ?? toHusb) || toHusb === 'step')) lines.push(`2 _FREL ${GEDCOM_CHILD_REL[toHusb]}`);
            if (toWife && (toWife !== (toHusb ?? toWife) || toWife === 'step')) lines.push(`2 _MREL ${GEDCOM_CHILD_REL[toWife]}`);
            const linkImport = childLinkImport(childId, family.parentIds);
            if (linkImport) lines.push(`2 ${IMPORT_TAG} ${linkImport}`);
        }
        // Two parents who are not a couple: said so (else they would read back as one). One parent alone
        // reads back as the "?" family the app keeps — the same as such a family goes out.
        if (b) lines.push('1 _STROM_NO_COUPLE Y');
    }

    // ==================== SOURCES ====================
    // Page attachments by id: an excerpt cut from one says where on its original it lies.
    const attachmentById = new Map<string, Attachment>();
    for (const p of Object.values(data.persons)) for (const a of p.attachments ?? []) attachmentById.set(a.id, a);
    // Standard 5.5.1: repositories are separate @Rx@ records referenced by
    // pointer; the reference/page lives on citations (see pushCitation). PAGE
    // is still emitted on the record too, purely for our own round-trip of
    // sources that are catalogued but not cited anywhere.
    for (const [sourceId, recordSource] of Object.entries(data.sources ?? {})) {
        const gedcomId = sourceIdMap.get(sourceId);
        if (!gedcomId) continue;
        // "Back to {prog}": one record for the sources it became, written once (by its first member).
        const members = groupMembers.get(sourceId);
        if (!members && back.sourceGroups.has(sourceId)) continue;
        let source: Source = recordSource;
        let author: string | undefined;
        if (members) {
            ({ source, author } = authorBack(recordSource));
            const transcript = members.find(m => m.transcript)?.transcript;
            if (transcript && !source.transcript) source = { ...source, transcript };
        }
        lines.push(`0 ${gedcomId} SOUR`);
        pushRecordImport(source.importId);
        // Its xref in the file it came from, so the file read again knows the record
        // (a file export; the research keeps the app's own, see keepImports).
        const fromEntry = !options.research && source.importId && knownImports.has(source.importId)
            ? source.originalIds?.find(e => e.from === source.importId && e.xref) : undefined;
        if (fromEntry) pushOriginalIdLines(lines, 2, fromEntry, true);
        // "Back to {prog}": the record's ids in that program (`1 RIN MH:S1`).
        const backIds = back.sourceEntries.get(sourceId);
        if (backIds) pushOriginalIdLines(lines, 1, backIds, false);
        if (source.title) pushWrapped(lines, 1, 'TITL', source.title);
        if (author) pushLongValue(lines, 1, 'AUTH', author);
        if (source.repository) {
            const repoRef = repoIdMap.get(source.repository);
            if (repoRef) lines.push(`1 REPO ${repoRef}`);
        }
        // A record of another program's file has its pages on the citations (5.5.1 knows no PAGE on a record).
        if (source.reference && !members) pushLongValue(lines, 1, 'PAGE', source.reference);
        if (source.refn) pushWrapped(lines, 1, 'REFN', source.refn);
        if (source.transcript) pushLongValue(lines, 1, 'TEXT', source.transcript);
        // The user read the transcript from the record (Strom Research: the first reading).
        if (source.transcriptVerified && source.transcript) lines.push('1 _STROM_VERIFIED Y');
        // Who read the entry, as the research said it (and the confirmation of its wording): back as it came.
        const read = sourceReadState(source);
        if (read.read) {
            lines.push(`1 _STROM_READ ${read.read}`);
            if (read.conf) lines.push(`2 _CONF ${read.conf}`);
            if (read.txt) lines.push(`2 _TXT ${read.txt}`);
        }
        // The research can read the source again from its original here: back as it came.
        if (source.originalInResearch) lines.push('1 _STROM_ORIG Y');
        // An entry of a research's reading: which reading and entry, and the page when no excerpt says it.
        if (writeReadings && source.reading && /^D\d{14}-[0-9a-f]{4}$/.test(source.reading)) {
            lines.push(`1 _STROM_READING ${source.reading}`);
            if (source.readingEntry && /^[A-Za-z][A-Za-z0-9_-]{0,20}$/.test(source.readingEntry)) lines.push(`2 _STROM_ENTRY ${source.readingEntry}`);
            const pageSha = normalizeSha256(source.readingSha);
            if (pageSha && !(source.excerpts ?? []).some(e => normalizeSha256(e.originalSha) === pageSha)) lines.push(`1 _STROM_SHA ${pageSha}`);
        }
        if (source.url) pushWrapped(lines, 1, 'WWW', source.url);
        const srcNoted = notedOf(members ? { gedcomExtra: members.flatMap(m => m.gedcomExtra ?? []) } : source, source.note);
        if (srcNoted.note) pushNote(lines, 1, srcNoted.note);
        pushNoted(srcNoted.structures, false);
        // Crops of the entry, embedded like person media (other programs
        // cannot read data URLs — the content options can leave them out).
        for (const exc of members ? members.flatMap(m => m.excerpts ?? []) : source.excerpts ?? []) {
            const mime = exc.dataUrl.slice(5, exc.dataUrl.indexOf(';'));
            lines.push('1 OBJE');
            lines.push(`2 FORM ${mime.includes('/') ? mime.split('/')[1] : 'jpeg'}`);
            if (exc.caption) pushWrapped(lines, 2, 'TITL', exc.caption);
            lines.push('2 _STROM_KIND excerpt');
            if (exc.pageUrl) pushWrapped(lines, 2, '_URL', exc.pageUrl);
            if (exc.clip) lines.push(`2 _STROM_CLIP ${exc.clip}`);
            // The original it was cut from and where on it (its stored pixels), for the research's Clip.
            const sha = normalizeSha256(exc.originalSha);
            if (sha) {
                lines.push(`2 _STROM_SHA ${sha}`);
                // A research crop lying as its original is stored: back as it came.
                if (exc.orient && exc.orient >= 2 && exc.orient <= 8) lines.push(`2 _STROM_ORIENT ${exc.orient}`);
                const page = exc.fromAttachmentId ? attachmentById.get(exc.fromAttachmentId) : undefined;
                if (exc.region && page?.original && normalizeSha256(page.original.sha256) === sha) {
                    lines.push(`2 _STROM_REGION ${regionHeader(regionToStored(exc.region, page.original.orientation))}`);
                }
            }
            pushWrapped(lines, 2, 'FILE', exc.dataUrl);
        }
        // The record's own tags of another program, once (every page's source keeps them).
        pushGedcomExtra(members ? { gedcomExtra: members.flatMap(m => m.gedcomExtra ?? []) } : source);
    }

    // ==================== REPOSITORIES ====================
    for (const [name, repoId] of repoIdMap) {
        lines.push(`0 ${repoId} REPO`);
        pushWrapped(lines, 1, 'NAME', name);
    }

    // ==================== TRAILER ====================
    lines.push('0 TRLR');

    return {
        content: lines.join('\n'),
        stats: {
            individuals: personIdMap.size,
            families: partnershipIdMap.size + looseFamilies.length
        },
        xrefs: { persons: personIdMap, sources: sourceIdMap },
    };
}
