/**
 * GEDCOM Exporter - Export family tree to GEDCOM 5.5.1 format
 * Standard genealogy interchange format for Ancestry, FamilySearch, Gramps, etc.
 *
 * Media: photos and attachments export as OBJE structures with the data URL in
 * FILE (CONC-wrapped). This round-trips within Strom; other tools will see an
 * unresolvable FILE value and skip the media (strip photos in the export dialog
 * to produce a lean file for them). Repositories export as standard 0 @Rx@ REPO
 * records with pointers; the source reference is emitted as a citation PAGE.
 * Parent→child relationship types map to FAMC PEDI (adoptive→adopted,
 * foster→foster); 'step' has no GEDCOM equivalent and exports without PEDI.
 */

import { StromData, Person, Partnership, PersonId, PartnershipId, LifeEventType } from './types.js';

/**
 * LifeEvent type -> GEDCOM tag. Types with no GEDCOM equivalent ('military',
 * 'custom') are absent and their events are dropped on export (known-unsupported).
 */
const EVENT_TYPE_TO_TAG: Partial<Record<LifeEventType, string>> = {
    baptism: 'BAPM', burial: 'BURI', occupation: 'OCCU', residence: 'RESI',
    emigration: 'EMIG', immigration: 'IMMI', education: 'EDUC',
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
    // GEDCOM doesn't have many escape sequences, but we should handle @ signs
    return text.replace(/@/g, '@@');
}

/**
 * GEDCOM 5.5.1 caps physical lines at 255 chars — long values must continue
 * on CONC lines. Chunks are split MID-WORD on purpose: leading/trailing
 * spaces on a continuation line are ambiguous (many parsers, including ours,
 * trim them), and the spec itself recommends breaking within a word.
 */
const MAX_VALUE_LEN = 200;

function chunkValue(text: string): string[] {
    if (text.length <= MAX_VALUE_LEN) return [text];
    const chunks: string[] = [];
    let rest = text;
    while (rest.length > MAX_VALUE_LEN) {
        let cut = MAX_VALUE_LEN;
        // Never split AT a space (either side of the cut) — shift left into a word.
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
 * Emit a NOTE structure: embedded newlines become CONT lines, over-long lines
 * continue on CONC lines, so multi-line and long notes survive the round-trip.
 */
function pushNote(lines: string[], level: number, text: string): void {
    const parts = text.split('\n');
    pushWrapped(lines, level, 'NOTE', parts[0]);
    for (let i = 1; i < parts.length; i++) {
        const chunks = chunkValue(escapeGedcomText(parts[i]));
        lines.push(`${level + 1} CONT ${chunks[0]}`);
        for (let j = 1; j < chunks.length; j++) {
            lines.push(`${level + 1} CONC ${chunks[j]}`);
        }
    }
}

/**
 * Export StromData to GEDCOM 5.5.1 format
 */
export function exportToGedcom(data: StromData, treeName?: string): GedcomExportResult {
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
        if (src?.reference) lines.push(`${level + 1} PAGE ${escapeGedcomText(src.reference)}`);
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

    // ==================== SUBMITTER ====================
    lines.push('0 @SUBM1@ SUBM');
    lines.push(`1 NAME ${escapeGedcomText(treeName || 'Strom User')}`);

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
            lines.push(`1 NAME ${escapeGedcomText(name)}`);
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
                lines.push(`2 PLAC ${escapeGedcomText(person.birthPlace)}`);
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
                lines.push(`2 PLAC ${escapeGedcomText(person.deathPlace)}`);
            }
        }

        // Note
        if (person.notes) {
            pushNote(lines, 1, person.notes);
        }

        // Life events. OCCU carries its detail as the tag value; the rest use
        // level-2 DATE/PLAC/NOTE. 'military'/'custom' have no tag and are dropped.
        for (const event of person.events ?? []) {
            const tag = EVENT_TYPE_TO_TAG[event.type];
            if (!tag) continue;
            if (event.type === 'occupation' && event.note) {
                lines.push(`1 OCCU ${escapeGedcomText(event.note)}`);
            } else {
                lines.push(`1 ${tag}`);
            }
            if (event.date) {
                const date = formatGedcomDate(event.date);
                if (date) lines.push(`2 DATE ${date}`);
            }
            if (event.place) {
                lines.push(`2 PLAC ${escapeGedcomText(event.place)}`);
            }
            if (event.note && event.type !== 'occupation') {
                pushNote(lines, 2, event.note);
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
        const pushMedia = (file: string, title: string, kind: 'photo' | ''): void => {
            const mime = file.startsWith('data:') ? file.slice(5, file.indexOf(';')) : '';
            const form = mime.includes('/') ? mime.split('/')[1] : 'jpeg';
            lines.push('1 OBJE');
            lines.push(`2 FORM ${form}`);
            if (title) pushWrapped(lines, 2, 'TITL', title);
            if (kind) lines.push(`2 _STROM_KIND ${kind}`);
            pushWrapped(lines, 2, 'FILE', file);
        };
        if (person.photo) {
            pushMedia(person.photo, person.photoOriginalName ?? '', 'photo');
        }
        for (const att of person.attachments ?? []) {
            pushMedia(att.dataUrl, att.name, '');
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
                lines.push(`2 PLAC ${escapeGedcomText(partnership.startPlace)}`);
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
        if (source.reference) lines.push(`1 PAGE ${escapeGedcomText(source.reference)}`);
        if (source.url) lines.push(`1 WWW ${escapeGedcomText(source.url)}`);
        if (source.note) pushNote(lines, 1, source.note);
    }

    // ==================== REPOSITORIES ====================
    for (const [name, repoId] of repoIdMap) {
        lines.push(`0 ${repoId} REPO`);
        lines.push(`1 NAME ${escapeGedcomText(name)}`);
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
