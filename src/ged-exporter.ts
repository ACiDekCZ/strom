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

import { StromData, Person, Partnership, PersonId, PartnershipId, LifeEventType, ParticipantRole, PlaceGeo, Story, ParentChildRelType } from './types.js';
import { strings } from './strings.js';
import { eventValueIsOnTag } from './events.js';
import { placeKey } from './places.js';
import { applyContentOptions, ContentOptions } from './privacy.js';

/** What to leave out of a GEDCOM export (the export dialog's Content section). */
export interface GedcomExportOptions {
    /** Omitted = everything; photos/attachments off drop the embedded base64 media. */
    content?: ContentOptions;
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
    const chunks: string[] = [];
    let rest = text;
    while (byteLen(rest) > MAX_VALUE_BYTES) {
        // The longest prefix that fits, counted in bytes and whole code points.
        let cut = 0;
        let used = 0;
        for (const ch of rest) {
            const b = byteLen(ch);
            if (used + b > MAX_VALUE_BYTES) break;
            used += b;
            cut += ch.length;
        }
        while (cut > 1 && (rest[cut] === ' ' || rest[cut - 1] === ' ')) cut--;
        chunks.push(rest.slice(0, cut));
        rest = rest.slice(cut);
    }
    chunks.push(rest);
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

        // Birth
        if (person.birthDate || person.birthPlace) {
            lines.push('1 BIRT');
            if (person.birthDate) {
                const date = formatGedcomDate(person.birthDate);
                if (date) lines.push(`2 DATE ${date}`);
            }
            if (person.birthPlace) {
                pushPlace(lines, 2, person.birthPlace, data.places);
            }
        }

        // Death
        if (person.deathDate || person.deathPlace) {
            lines.push('1 DEAT');
            if (person.deathDate) {
                const date = formatGedcomDate(person.deathDate);
                if (date) lines.push(`2 DATE ${date}`);
            }
            if (person.deathPlace) {
                pushPlace(lines, 2, person.deathPlace, data.places);
            }
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
        const pushMedia = (file: string, title: string, kind: 'photo' | '', note?: string, srcId?: string): void => {
            const mime = file.startsWith('data:') ? file.slice(5, file.indexOf(';')) : '';
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
            pushWrapped(lines, 2, 'FILE', file);
        };
        if (person.photo) {
            pushMedia(person.photo, person.photoOriginalName ?? '', 'photo');
        }
        for (const att of person.attachments ?? []) {
            pushMedia(att.dataUrl, att.name, '', att.note, att.sourceId);
        }

        // Family as spouse (FAMS) - partnerships where this person is a partner
        for (const partnershipId of person.partnerships) {
            const famId = partnershipIdMap.get(partnershipId);
            if (famId) {
                lines.push(`1 FAMS ${famId}`);
            }
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
        if (partnership.status === 'married' || partnership.status === 'divorced' ||
            partnership.startDate || partnership.startPlace) {
            lines.push('1 MARR');
            if (partnership.startDate) {
                const date = formatGedcomDate(partnership.startDate);
                if (date) lines.push(`2 DATE ${date}`);
            }
            if (partnership.startPlace) {
                pushPlace(lines, 2, partnership.startPlace, data.places);
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
        }

        // Divorce event
        if (partnership.status === 'divorced' || partnership.endDate) {
            lines.push('1 DIV');
            if (partnership.endDate) {
                const date = formatGedcomDate(partnership.endDate);
                if (date) lines.push(`2 DATE ${date}`);
            }
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

        // Family citations (marriage record etc.)
        for (const srcId of partnership.sourceIds ?? []) {
            pushCitation(1, srcId);
        }
    }

    // ==================== SOURCES ====================
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
        if (source.url) pushWrapped(lines, 1, 'WWW', source.url);
        if (source.note) pushNote(lines, 1, source.note);
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
            families: partnershipIdMap.size
        }
    };
}
