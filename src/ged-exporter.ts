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

import { researchHeaderLines, ResearchHeaderInfo } from './research-link.js';
import { StromData, Person, Partnership, PersonId, PartnershipId, LifeEventType, ParticipantRole, PlaceGeo, Story, ParentChildRelType, MediaOriginal, Attachment, FactStatus } from './types.js';
import { normalizeSha256 } from './sha256.js';
import { regionHeader, regionToStored } from './originals.js';
import { strings } from './strings.js';
import { COUPLE_EVENT_TAG, eventValueIsOnTag, sortCoupleEvents } from './events.js';
import { placeKey } from './places.js';
import { gedcomAge } from './recorded-age.js';
import { applyContentOptions, ContentOptions } from './privacy.js';

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
/** Separates spellings within one group inside the header NOTE. */
export const SURNAME_GROUP_SEP = ' | ';

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
 * "1900-06" -> "JUN 1900", "<1900-06-03" -> "BEF 3 JUN 1900".
 */
function formatGedcomDate(isoDate: string | undefined): string | null {
    if (!isoDate) return null;

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
 * Format name to GEDCOM format: FirstName /LastName/
 */
function formatGedcomName(firstName: string, lastName: string): string {
    const first = firstName || '';
    const last = lastName || '';

    // Skip placeholder names
    if (first === '?' && !last) {
        return '? /Unknown/';
    }

    return `${first} /${last}/`;
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

/**
 * Split a value into byte-bounded chunks. A cut NEVER sits next to a space:
 * a chunk that ended (or started) with one would lose it in any parser that
 * trims line values — ours included — and two words would run together.
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
        let cut = end;
        while (cut > start + 1 && (text[cut] === ' ' || text[cut - 1] === ' ')) cut--;
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
function pushStory(lines: string[], level: number, story: Story): void {
    lines.push(`${level} _STORY`);
    lines.push(`${level + 1} TYPE ${escapeGedcomText(story.kind || 'vypraveni')}`);
    if (story.title) pushLongValue(lines, level + 1, 'TITL', story.title);
    if (story.status) lines.push(`${level + 1} STAT ${story.status === 'final' ? 'hotovo' : 'navrh'}`);
    pushLongValue(lines, level + 1, 'TEXT', story.text);
    for (const fact of story.facts ?? []) pushLongValue(lines, level + 1, 'DATA', fact);
    if (story.note) pushLongValue(lines, level + 1, 'NOTE', story.note);
}

/**
 * Export StromData to GEDCOM 5.5.1 format
 */
export function exportToGedcom(data: StromData, treeName?: string, options: GedcomExportOptions = {}): GedcomExportResult {
    if (options.content) data = applyContentOptions(data, options.content);
    const lines: string[] = [];

    // Create ID mappings (PersonId -> @I1@, PartnershipId -> @F1@)
    const personIdMap = new Map<PersonId, string>();
    const partnershipIdMap = new Map<PartnershipId, string>();

    let personCounter = 1;
    let familyCounter = 1;

    // Map all persons to GEDCOM IDs
    for (const personId of Object.keys(data.persons) as PersonId[]) {
        personIdMap.set(personId, `@I${personCounter}@`);
        personCounter++;
    }

    // Map all partnerships to GEDCOM IDs
    for (const partnershipId of Object.keys(data.partnerships) as PartnershipId[]) {
        partnershipIdMap.set(partnershipId, `@F${familyCounter}@`);
        familyCounter++;
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
            const key = [...loose].sort().join('|');
            let family = byParents.get(key);
            if (!family) {
                family = { gedcomId: `@F${familyCounter}@`, parentIds: loose, childIds: [] };
                familyCounter++;
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

    // Map all sources to GEDCOM IDs (@S1@ ...)
    const sourceIdMap = new Map<string, string>();
    let sourceCounter = 1;
    for (const sourceId of Object.keys(data.sources ?? {})) {
        sourceIdMap.set(sourceId, `@S${sourceCounter}@`);
        sourceCounter++;
    }
    // Unique repository names -> @Rx@ records (standard 5.5.1 structure).
    const repoIdMap = new Map<string, string>();
    let repoCounter = 1;
    for (const source of Object.values(data.sources ?? {})) {
        if (source.repository && !repoIdMap.has(source.repository)) {
            repoIdMap.set(source.repository, `@R${repoCounter}@`);
            repoCounter++;
        }
    }
    /** Citation emitter: the source reference belongs on the citation as PAGE. */
    const pushCitation = (level: number, srcId: string): void => {
        const ref = sourceIdMap.get(srcId);
        if (!ref) return;
        lines.push(`${level} SOUR ${ref}`);
        const src = data.sources?.[srcId];
        if (src?.reference) pushLongValue(lines, level + 1, 'PAGE', src.reference);
        // The entry recording date lives on the citation in 5.5.1 (DATA > DATE).
        const recorded = formatGedcomDate(src?.recordDate);
        if (recorded) {
            lines.push(`${level + 1} DATA`);
            lines.push(`${level + 2} DATE ${recorded}`);
        }
        if (src?.quality !== undefined) lines.push(`${level + 1} QUAY ${src.quality}`);
    };

    // Get current date for header
    const now = new Date();
    const headerDate = `${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;

    // ==================== HEADER ====================
    lines.push('0 HEAD');
    lines.push('1 SOUR STROM');
    lines.push('2 VERS 1.0');
    lines.push('2 NAME Strom Family Tree');
    lines.push('1 DEST ANSTFILE');
    lines.push(`1 DATE ${headerDate}`);
    lines.push('1 SUBM @SUBM1@');
    lines.push('1 GEDC');
    lines.push('2 VERS 5.5.1');
    lines.push('2 FORM LINEAGE-LINKED');
    lines.push('1 CHAR UTF-8');
    lines.push(...researchHeaderLines(options.research));

    // Surname-variant groups: no GEDCOM structure fits "these spellings mean one
    // family", so they ride in a header NOTE (standard, kept by every reader).
    // The marker line lets our own importer read them back; the group lines are
    // human-readable on their own.
    const surnameGroups = (data.surnameVariants ?? []).filter(g => g.length >= 2);
    if (surnameGroups.length > 0) {
        lines.push(`1 NOTE ${SURNAME_GROUPS_MARKER}`);
        for (const group of surnameGroups) {
            pushWrapped(lines, 2, 'CONT', group.join(SURNAME_GROUP_SEP));
        }
    }

    // ==================== SUBMITTER ====================
    lines.push('0 @SUBM1@ SUBM');
    pushWrapped(lines, 1, 'NAME', treeName || 'Strom User');

    // ==================== INDIVIDUALS ====================
    for (const [personId, person] of Object.entries(data.persons) as [PersonId, Person][]) {
        const gedcomId = personIdMap.get(personId);
        if (!gedcomId) continue;

        lines.push(`0 ${gedcomId} INDI`);

        // Name. Placeholders are exported with an empty name so they re-import
        // as placeholders (lossless), instead of being dropped.
        if (person.isPlaceholder && (person.firstName === '?' || !person.firstName) && !person.lastName) {
            lines.push('1 NAME //');
        } else {
            const name = formatGedcomName(person.firstName, person.lastName);
            pushWrapped(lines, 1, 'NAME', name);
        }
        // Other spellings as further NAME lines — the first one above stays the
        // primary, which is what every reader expects.
        for (const variant of person.nameVariants ?? []) {
            pushWrapped(lines, 1, 'NAME', variant);
        }

        // Sex
        lines.push(`1 SEX ${person.gender === 'male' ? 'M' : 'F'}`);

        // Birth (with the citations of the birth entry: 2 SOUR)
        if (person.birthDate || person.birthPlace || person.birthAddress || person.birthSourceIds?.length) {
            lines.push('1 BIRT');
            if (person.birthDate) {
                const date = formatGedcomDate(person.birthDate);
                if (date) lines.push(`2 DATE ${date}`);
            }
            if (person.birthPlace) {
                pushPlace(lines, 2, person.birthPlace, data.places);
            }
            pushDetails(lines, { address: person.birthAddress });
            pushStatus(lines, person.birthStatus);
            for (const srcId of person.birthSourceIds ?? []) pushCitation(2, srcId);
        }

        // Death (a cited death without a date or place is a known death: DEAT Y)
        const deathDetail = person.deathCause || person.deathAge || person.deathAddress;
        if (person.deathDate || person.deathPlace || deathDetail || person.deathSourceIds?.length) {
            lines.push(person.deathDate || person.deathPlace || deathDetail ? '1 DEAT' : '1 DEAT Y');
            if (person.deathDate) {
                const date = formatGedcomDate(person.deathDate);
                if (date) lines.push(`2 DATE ${date}`);
            }
            if (person.deathPlace) {
                pushPlace(lines, 2, person.deathPlace, data.places);
            }
            pushDetails(lines, { cause: person.deathCause, age: person.deathAge, address: person.deathAddress });
            pushStatus(lines, person.deathStatus);
            for (const srcId of person.deathSourceIds ?? []) pushCitation(2, srcId);
        } else if (person.isDeceased === true) {
            // Known to be dead, date unknown: the standard way to say so.
            // Without it the person came back as possibly living.
            lines.push('1 DEAT Y');
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
            pushStory(lines, 1, person.story);
        }

        if (person.notes) {
            pushNote(lines, 1, person.notes);
        }

        // Life events. OCCU carries its detail as the tag value; the rest use
        // level-2 DATE/PLAC/NOTE. 'custom'/'military' have no dedicated tag and
        // ride on the generic EVEN with a TYPE label, so nothing is dropped.
        for (const event of person.events ?? []) {
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
                const date = formatGedcomDate(event.date);
                if (date) lines.push(`2 DATE ${date}`);
            }
            if (event.place) {
                pushPlace(lines, 2, event.place, data.places);
            }
            pushDetails(lines, event);
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
        }

        // Source citations on the person (1 SOUR @Sx@ + 2 PAGE).
        for (const srcId of person.sourceIds ?? []) {
            pushCitation(1, srcId);
        }

        // Media: portrait first (marked), then attachments. Data URLs are
        // CONC-wrapped to keep physical lines within the spec limit.
        const pushMedia = (file: string, title: string, kind: 'photo' | '', note?: string, srcId?: string, original?: MediaOriginal, fileMime?: string): void => {
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
        };
        if (person.photo) {
            pushMedia(person.photo, person.photoOriginalName ?? '', 'photo');
        }
        for (const att of person.attachments ?? []) {
            // Only the original (the research holds it): the file's name and hash, no data.
            if (att.originalOnly) pushMedia(att.name || 'file', att.name, '', att.note, att.sourceId, att.original, att.original?.mimeType ?? att.mimeType);
            else pushMedia(att.dataUrl, att.name, '', att.note, att.sourceId, att.original);
        }

        // Family as spouse (FAMS) - partnerships where this person is a partner
        for (const partnershipId of person.partnerships) {
            const famId = partnershipIdMap.get(partnershipId);
            if (famId) {
                lines.push(`1 FAMS ${famId}`);
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
    }

    // ==================== FAMILIES ====================
    for (const [partnershipId, partnership] of Object.entries(data.partnerships) as [PartnershipId, Partnership][]) {
        const gedcomId = partnershipIdMap.get(partnershipId);
        if (!gedcomId) continue;

        const person1 = data.persons[partnership.person1Id];
        const person2 = data.persons[partnership.person2Id];

        lines.push(`0 ${gedcomId} FAM`);

        // Determine HUSB/WIFE by gender (male = HUSB, female = WIFE). For a
        // mixed-gender couple this is independent of person1/person2 order, so
        // HUSB is always emitted before WIFE and the GEDCOM is round-trip
        // stable. Same-gender couples keep person1 = HUSB, person2 = WIFE.
        const p1Id = partnership.person1Id;
        const p2Id = partnership.person2Id;
        let husbId = p1Id;
        let wifeId = p2Id;
        if (person1 && person2 && (person1.gender === 'male') !== (person2.gender === 'male')) {
            husbId = person1.gender === 'male' ? p1Id : p2Id;
            wifeId = person1.gender === 'male' ? p2Id : p1Id;
        }
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
                const toHusb = rels[husbId] ?? 'biological';
                const toWife = rels[wifeId] ?? 'biological';
                // Also when both ties are 'step': PEDI has no such value, so
                // this is the only place a stepchild of both can be said.
                if (toHusb !== toWife || toHusb === 'step') {
                    lines.push(`2 _FREL ${GEDCOM_CHILD_REL[toHusb]}`);
                    lines.push(`2 _MREL ${GEDCOM_CHILD_REL[toWife]}`);
                }
            }
        }

        // Marriage event (for married or divorced status)
        const hasMarriage = partnership.status === 'married' || partnership.status === 'divorced' ||
            !!partnership.startDate || !!partnership.startPlace || !!partnership.address
            || Object.values(partnership.ages ?? {}).some(a => a.trim());
        if (hasMarriage) {
            lines.push('1 MARR');
            if (partnership.startDate) {
                const date = formatGedcomDate(partnership.startDate);
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
        }

        // Divorce event
        if (partnership.status === 'divorced' || partnership.endDate || partnership.endPlace) {
            lines.push('1 DIV');
            if (partnership.endDate) {
                const date = formatGedcomDate(partnership.endDate);
                if (date) lines.push(`2 DATE ${date}`);
            }
            if (partnership.endPlace) pushPlace(lines, 2, partnership.endPlace, data.places);
            pushStatus(lines, partnership.endStatus);
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
                const date = formatGedcomDate(event.date);
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
        }

        // A status MARR/DIV cannot say (partners, separated).
        const stat = GEDCOM_STAT[partnership.status];
        if (stat) lines.push(`1 _STAT ${stat}`);

        if (partnership.story) {
            pushStory(lines, 1, partnership.story);
        }

        // Note
        if (partnership.note) {
            pushNote(lines, 1, partnership.note);
        }

        // Family citations of a couple without a marriage (partners).
        for (const srcId of hasMarriage ? [] : partnership.sourceIds ?? []) {
            pushCitation(1, srcId);
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
        } else if ((data.persons[a]?.gender === 'male') !== (data.persons[b]?.gender === 'male')) {
            husbId = data.persons[a]?.gender === 'male' ? a : b;
            wifeId = husbId === a ? b : a;
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
        }
        lines.push('1 _STROM_NO_COUPLE Y');
    }

    // ==================== SOURCES ====================
    // Page attachments by id: an excerpt cut from one says where on its original it lies.
    const attachmentById = new Map<string, Attachment>();
    for (const p of Object.values(data.persons)) for (const a of p.attachments ?? []) attachmentById.set(a.id, a);
    // Standard 5.5.1: repositories are separate @Rx@ records referenced by
    // pointer; the reference/page lives on citations (see pushCitation). PAGE
    // is still emitted on the record too, purely for our own round-trip of
    // sources that are catalogued but not cited anywhere.
    for (const [sourceId, source] of Object.entries(data.sources ?? {})) {
        const gedcomId = sourceIdMap.get(sourceId);
        if (!gedcomId) continue;
        lines.push(`0 ${gedcomId} SOUR`);
        if (source.title) pushWrapped(lines, 1, 'TITL', source.title);
        if (source.repository) {
            const repoRef = repoIdMap.get(source.repository);
            if (repoRef) lines.push(`1 REPO ${repoRef}`);
        }
        if (source.reference) pushLongValue(lines, 1, 'PAGE', source.reference);
        if (source.refn) pushWrapped(lines, 1, 'REFN', source.refn);
        if (source.transcript) pushLongValue(lines, 1, 'TEXT', source.transcript);
        // The user read the transcript from the record (Strom Research: the first reading).
        if (source.transcriptVerified && source.transcript) lines.push('1 _STROM_VERIFIED Y');
        if (source.url) pushWrapped(lines, 1, 'WWW', source.url);
        if (source.note) pushNote(lines, 1, source.note);
        // Crops of the entry, embedded like person media (other programs
        // cannot read data URLs — the content options can leave them out).
        for (const exc of source.excerpts ?? []) {
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
