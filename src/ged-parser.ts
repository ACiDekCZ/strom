/**
 * GEDCOM Parser Module
 * Parses GEDCOM files and converts them to Strom data format.
 *
 * Round-trip (import -> export -> import) is lossless for everything the data
 * model represents: names, sex, birth/death date+place, individual notes,
 * parent-child structure, placeholders (nameless individuals), single-parent
 * families (a placeholder partner fills the missing spouse), and partnership
 * married/divorced status with marriage date+place, divorce date, and note.
 *
 * Life events map both ways: BAPM/BURI/OCCU/RESI/EMIG/IMMI/EDUC <-> LifeEvent
 * (OCCU value <-> event note). Sources map both ways: 0 @Sx@ SOUR records
 * (TITL/REPO/PAGE->reference/WWW->url/NOTE) with 1 SOUR refs on individuals and
 * 2 SOUR refs on events <-> the per-tree source catalog + sourceIds. Partnership
 * statuses 'partners'/'separated' and the isPrimary flag, and the
 * 'military'/'custom' event types, have no GEDCOM equivalent (known-unsupported)
 * and are dropped on export.
 */

import {
    PersonId,
    PartnershipId,
    Person,
    Partnership,
    StromData,
    LifeEvent,
    LifeEventType,
    ParentChildRelType,
    ParticipantRole,
    Source,
    Attachment,
    toPersonId,
    toPartnershipId,
    generateLifeEventId,
    generateParticipantId,
    generateSourceId
} from './types';
import { dateSortKey } from './dates';

/**
 * RELA text -> role. Other programs write these freely ("Godparent", "godmother",
 * "Kmotr"), so match loosely and fall back to 'other' rather than dropping the
 * person: knowing someone was there beats knowing nothing.
 */
function relaToRole(rela: string | undefined): ParticipantRole {
    const r = (rela ?? '').toLowerCase();
    if (r.includes('godparent') || r.includes('godfather') || r.includes('godmother')
        || r.includes('kmotr') || r.includes('sponsor')) return 'godparent';
    if (r.includes('witness') || r.includes('svěd') || r.includes('sved')) return 'witness';
    if (r.includes('officiant') || r.includes('clergy') || r.includes('priest')
        || r.includes('minister') || r.includes('kněz') || r.includes('knez')) return 'officiant';
    return 'other';
}

/** GEDCOM event tag <-> LifeEvent type. */
const EVENT_TAG_TO_TYPE: Record<string, LifeEventType> = {
    BAPM: 'baptism', BURI: 'burial', OCCU: 'occupation', RESI: 'residence',
    EMIG: 'emigration', IMMI: 'immigration', EDUC: 'education',
};

/** Raw OBJE media object under an individual. */
interface RawMedia {
    /** _PRIM / _PERSONALPHOTO Y — preferred as the person's portrait. */
    primary?: boolean;
    title: string;
    form: string;
    file: string;
    /** Custom marker: 'photo' = the person's portrait (Strom extension). */
    stromKind: string;
}

interface RawEvent {
    type: LifeEventType;
    /** Label for 'custom' events (e.g. an alternative birth fact). */
    customLabel?: string;
    date?: string;
    place?: string;
    note?: string;
    /** GEDCOM ids (@Sx@) of sources cited on this event. */
    sourceRefs?: string[];
    /** Godparents / witnesses: ASSO (a person ref) or _WITN (a bare name). */
    participants?: RawParticipant[];
}

/** A participant as it comes out of the file, before ids are resolved. */
interface RawParticipant {
    /** GEDCOM id (@Ix@) for ASSO; undefined for a _WITN name. */
    ref?: string;
    name?: string;
    /** RELA value as written, mapped to a role later. */
    rela?: string;
    note?: string;
}

/** Raw GEDCOM source record (0 @Sx@ SOUR). */
interface RawSource {
    id: string;
    title: string;
    repository: string;
    reference: string;
    url: string;
    note: string;
    /** QUAY seen on the record or a citation (first wins). */
    quality?: number;
}

// ==================== TYPES ====================

/** Raw GEDCOM individual record */
interface GedcomIndividual {
    id: string;
    name: string;
    firstName: string;
    lastName: string;
    /** Extra 1 NAME lines: the file's other spellings of this person. */
    nameVariants: string[];
    sex: string;
    birthDate: string;
    birthPlace: string;
    deathDate: string;
    deathPlace: string;
    notes: string;
    /** User reference number (1 REFN) — id in a paper archive / other program. */
    refn: string;
    /** Life events (BAPM/BURI/OCCU/RESI/EMIG/IMMI/EDUC). */
    events: RawEvent[];
    /** GEDCOM ids (@Sx@) of sources cited on this individual. */
    sourceRefs: string[];
    /** OBJE media objects (photo / attachments). */
    media: RawMedia[];
    /** A DEAT tag was present (even a bare 'DEAT Y' without a date). */
    deceased: boolean;
    /** First BIRT/DEAT block already consumed (duplicates become events). */
    birthSeen: boolean;
    deathSeen: boolean;
    fams: string[];  // Families as spouse
    /** Level-1 ASSO on the person: associations outside any event. */
    assos: RawParticipant[];
    /**
     * Every FAMC with its own PEDI. A person may be a child of more than one
     * family — born to one and adopted into another — and the PEDI belongs to
     * the LINK, not to the person. Keeping one PEDI per person marked the birth
     * parents adoptive as soon as any later FAMC said so (gedcom.org 555SAMPLE).
     */
    famcLinks: { famId: string; pedi: string }[];
}

/** Raw GEDCOM family record */
interface GedcomFamily {
    id: string;
    /** ENGA date (engagement) — lands in the partnership note. */
    engagementDate: string;
    husb: string | null;
    wife: string | null;
    children: string[];
    marriageDate: string;
    marriagePlace: string;
    divorceDate: string;
    /** A DIV tag was present, even without a date (divorce date unknown). */
    divorced: boolean;
    /**
     * MARR and DIV tags in the order the file lists them. A couple may divorce
     * and marry again, which GEDCOM 7 records as MARR/DIV/MARR in ONE family;
     * reading only "was there a DIV" reported them divorced for ever after
     * (gedcom.io remarriage1). Dates decide when they have them, file order
     * otherwise.
     */
    unionEvents: { type: 'marriage' | 'divorce'; date: string }[];
    note: string;
    /** 1 SOUR citations on the family (marriage record etc.). */
    sourceRefs: string[];
}

/** Parsed GEDCOM data */
export interface ParsedGedcom {
    individuals: Map<string, GedcomIndividual>;
    families: Map<string, GedcomFamily>;
    sources: Map<string, RawSource>;
    /** 0 @Rx@ REPO records: id -> repository name. */
    repositories: Map<string, string>;
    /** Tags our data model cannot represent, with occurrence counts. */
    droppedTags: Map<string, number>;
}

/** Result of GEDCOM to Strom conversion */
/** External media file referenced by the GEDCOM (file itself not embedded). */
export interface ExternalMediaRef {
    personId: PersonId;
    /** Basename of the referenced file (matching key for bulk attach). */
    fileName: string;
    /** Full FILE value as written in the GEDCOM. */
    filePath: string;
    title?: string;
    /** The reference is an http(s) URL — downloadable directly. */
    isUrl?: boolean;
    /** Platform marked this as the person's primary portrait. */
    primary?: boolean;
}

export interface GedcomConversionResult {
    data: StromData;
    /**
     * OBJE FILE references pointing OUTSIDE the file (platform exports ship
     * media as a separate folder/zip). The import summary offers to bulk-match
     * these against user-picked files.
     */
    externalMedia: ExternalMediaRef[];
    stats: {
        totalPersons: number;
        totalPartnerships: number;
        /** Nameless individuals imported as placeholders (kept, not dropped). */
        placeholderPersons: number;
        /** Count of encountered tags our data model cannot represent (see header). */
        unsupportedTags: number;
        /** Human-readable breakdown, e.g. "TITL ×3, CHR ×2". Empty when none. */
        droppedTagSummary: string;
        /** Individuals with SEX other than M/F (gender inferred from family role). */
        unknownSexPersons: number;
        /**
         * Children recorded in more than one family (born to one, adopted into
         * another). The tree draws one set of parents; the others became a note
         * on the child.
         */
        otherFamilyLinks: number;
        totalGedFamilies: number;
    };
}

// ==================== CONSTANTS ====================

const MONTHS: Record<string, string> = {
    'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04',
    'MAY': '05', 'JUN': '06', 'JUL': '07', 'AUG': '08',
    'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12'
};

// ==================== HELPER FUNCTIONS ====================

/**
 * Parse GEDCOM date format to a canonical flex date string (see src/dates.ts).
 * Precision and qualifiers are PRESERVED: "ABT 1900" -> "~1900",
 * "JUN 1900" -> "1900-06", "3 JUN 1900" -> "1900-06-03", "BEF 1900" -> "<1900".
 */
export function parseGedcomDate(dateStr: string): string {
    if (!dateStr) return '';

    // Calendar escape (@#DJULIAN@, @#DGREGORIAN@ …): the calendar itself has
    // no representation here, but the date after it is an ordinary date —
    // strip the escape and keep the date instead of parsing the whole line
    // to '' (which silently lost every pre-1752 Julian date).
    dateStr = dateStr.trim().replace(/^@#D[^@]*@\s*/i, '');

    // Ranges/periods: BET X AND Y, FROM X TO Y -> 'x..y' (both bounds kept —
    // previously these were mangled and the information silently lost).
    // One-sided periods degrade to qualifiers: FROM X -> '>x', TO Y -> '<y'.
    const range = /^(BET|BETWEEN|FROM)\s+(.+?)\s+(AND|TO)\s+(.+)$/i.exec(dateStr.trim());
    if (range) {
        const a = parseGedcomDate(range[2]);
        const b = parseGedcomDate(range[4]);
        if (a && b && !/^[~<>]/.test(a) && !/^[~<>]/.test(b)) return `${a}..${b}`;
        return a || b || '';
    }
    const oneSided = /^(FROM|TO)\s+(.+)$/i.exec(dateStr.trim());
    if (oneSided) {
        const d = parseGedcomDate(oneSided[2]);
        if (d && !/^[~<>]/.test(d)) return `${oneSided[1].toUpperCase() === 'FROM' ? '>' : '<'}${d}`;
        return d;
    }

    // Qualifier prefixes map to flex-date qualifiers instead of being dropped
    let qualifier = '';
    let cleaned = dateStr.trim().replace(
        /^(ABT|ABOUT|EST|CAL|INT|BEF|BEFORE|AFT|AFTER)\s+/i,
        (m) => {
            const q = m.trim().toUpperCase();
            if (q === 'BEF' || q === 'BEFORE') qualifier = '<';
            else if (q === 'AFT' || q === 'AFTER') qualifier = '>';
            else qualifier = '~';
            return '';
        }
    );

    // The calendar escape sits AFTER any qualifier ("ABT @#DJULIAN@ 1699"),
    // so strip it here too — the top-of-function strip only sees a leading one.
    cleaned = cleaned.replace(/^@#D[^@]*@\s*/i, '');

    // Dual year "1699/00" (old-style/new-style before the 1752 calendar shift):
    // both notations name the same moment. The flex-date model has no dual-year
    // form, so the year AS WRITTEN in the record (the first one) is kept — the
    // least lossy single value, and the one a reader finds in the source.
    const parts = cleaned.split(/\s+/).map(p => p.replace(/^(\d{3,4})\/\d{1,2}$/, '$1'));

    if (parts.length === 3) {
        // "3 JUN 1900" -> "1900-06-03"
        const day = parts[0].padStart(2, '0');
        const month = MONTHS[parts[1].toUpperCase()] || '01';
        const year = parts[2];
        return `${qualifier}${year}-${month}-${day}`;
    } else if (parts.length === 2 && MONTHS[parts[0].toUpperCase()]) {
        // "JUN 1900" -> "1900-06" (month precision, no fabricated day)
        const month = MONTHS[parts[0].toUpperCase()];
        const year = parts[1];
        return `${qualifier}${year}-${month}`;
    } else if (parts.length === 1 && /^\d{3,4}$/.test(parts[0])) {
        // "1900" -> "1900" (year precision, no fabricated month/day)
        return `${qualifier}${parts[0]}`;
    }
    return '';
}

/**
 * Parse GEDCOM name format to first/last name
 * Handles: "John /Surname/", "/Surname/", "John /Surname/ Jr.", "FirstName"
 *
 * The slashes mark the surname wherever they fall — the name may carry a suffix
 * after them ("John /Smith/ Jr."), which is ordinary in GEDCOM. Insisting the
 * name END at the closing slash made those fall through to the guesswork below,
 * which splits at the first space: "Lt. Cmndr. Joseph "John" /de Allen/ jr."
 * came out as a man called Lt. with the surname 'Cmndr. Joseph "John" de Allen
 * jr.' (gedcom.io maximal70-tree1).
 *
 * The suffix joins the surname because a person here has only two name fields
 * and that is the order they are shown in: "John Smith Jr.".
 */
export function parseName(nameStr: string): { firstName: string; lastName: string } {
    // Try to match "Given /Surname/ [suffix]" pattern
    const match = nameStr.match(/^(.*?)\/([^/]*)\/(.*)$/);
    if (match) {
        const surname = match[2].trim();
        const suffix = match[3].trim();
        return {
            firstName: match[1].trim(),
            lastName: suffix ? `${surname} ${suffix}`.trim() : surname
        };
    }
    // Fallback: no surname delimiter - split by whitespace
    const cleaned = nameStr.replace(/\//g, '').trim();
    const parts = cleaned.split(/\s+/).filter(p => p);
    return {
        firstName: parts[0] || '',
        lastName: parts.slice(1).join(' ') || ''
    };
}

/**
 * Generate unique ID with prefix
 */
function generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ==================== ENCODING ====================

/**
 * ANSEL (ANSI Z39.47 / MARC-8 extended Latin) -> Unicode, spacing characters.
 * Includes the GEDCOM addition 0xCF (ß).
 */
const ANSEL_SPACING: Record<number, string> = {
    0xA1: 'Ł', 0xA2: 'Ø', 0xA3: 'Đ', 0xA4: 'Þ', 0xA5: 'Æ',
    0xA6: 'Œ', 0xA7: 'ʹ', 0xA8: '·', 0xA9: '♭', 0xAA: '®',
    0xAB: '±', 0xAC: 'Ơ', 0xAD: 'Ư', 0xAE: 'ʼ',
    0xB0: 'ʻ', 0xB1: 'ł', 0xB2: 'ø', 0xB3: 'đ', 0xB4: 'þ',
    0xB5: 'æ', 0xB6: 'œ', 0xB7: 'ʺ', 0xB8: 'ı', 0xB9: '£',
    0xBA: 'ð', 0xBC: 'ơ', 0xBD: 'ư',
    0xC0: '°', 0xC1: 'ℓ', 0xC2: '℗', 0xC3: '©', 0xC4: '♯',
    0xC5: '¿', 0xC6: '¡', 0xCF: 'ß',
};

/**
 * ANSEL combining diacritics -> Unicode combining characters. In ANSEL the
 * diacritic PRECEDES its base letter; Unicode puts it after, so the decoder
 * holds pending marks until the base letter arrives.
 */
const ANSEL_COMBINING: Record<number, string> = {
    0xE0: '\u0309', // hook above
    0xE1: '\u0300', // grave
    0xE2: '\u0301', // acute
    0xE3: '\u0302', // circumflex
    0xE4: '\u0303', // tilde
    0xE5: '\u0304', // macron
    0xE6: '\u0306', // breve
    0xE7: '\u0307', // dot above
    0xE8: '\u0308', // diaeresis
    0xE9: '\u030C', // caron (háček)
    0xEA: '\u030A', // ring above
    0xEB: '\uFE20', // ligature, left half
    0xEC: '\uFE21', // ligature, right half
    0xED: '\u0315', // comma above right
    0xEE: '\u030B', // double acute
    0xEF: '\u0310', // candrabindu
    0xF0: '\u0327', // cedilla
    0xF1: '\u0328', // ogonek
    0xF2: '\u0323', // dot below
    0xF3: '\u0324', // diaeresis below
    0xF4: '\u0325', // ring below
    0xF5: '\u0333', // double low line
    0xF6: '\u0332', // low line
    0xF7: '\u0326', // comma below
    0xF8: '\u031C', // left half ring below
    0xF9: '\u032E', // breve below
    0xFA: '\uFE22', // double tilde, left half
    0xFB: '\uFE23', // double tilde, right half
    0xFE: '\u0313', // comma above
};

/** Decode ANSEL bytes to an NFC-normalized string ("ANSEL č" -> U+010D). */
export function decodeAnsel(bytes: Uint8Array): string {
    let out = '';
    let pending = ''; // combining marks waiting for their base letter
    for (const b of bytes) {
        if (b < 0x80) {
            out += String.fromCharCode(b) + pending;
            pending = '';
        } else if (ANSEL_COMBINING[b]) {
            pending += ANSEL_COMBINING[b];
        } else {
            out += (ANSEL_SPACING[b] ?? '�') + pending;
            pending = '';
        }
    }
    // A mark with no base letter (truncated file) is kept; NFC ignores it.
    out += pending;
    return out.normalize('NFC');
}

/**
 * Decode a raw GEDCOM file to text, honouring what the file says about itself:
 * a BOM wins outright, otherwise the HEAD > CHAR declaration decides (its line
 * is ASCII-compatible in every charset GEDCOM allows, so peeking at the header
 * bytes is safe). ANSEL gets the real decoder above — reading it as UTF-8
 * silently mangled every diacritic. Unknown or absent CHAR falls back to UTF-8.
 */
export function decodeGedcomFile(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
        return new TextDecoder('utf-8').decode(bytes);
    }
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder('utf-16le').decode(bytes);
    if (bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be').decode(bytes);

    // Peek HEAD for "1 CHAR <value>". NULs are stripped so a BOM-less UTF-16
    // header still matches; latin1 maps every byte so decoding cannot throw.
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096)).replace(/\0/g, '');
    const charMatch = /^\s*1\s+CHAR\s+(.+?)\s*$/m.exec(head);
    const charset = (charMatch?.[1] ?? '').toUpperCase();

    if (charset === 'ANSEL') return decodeAnsel(bytes);
    if (charset === 'UNICODE' || charset === 'UTF-16') {
        // No BOM to tell the byte order: the first character of a GEDCOM is
        // ASCII ('0'), so a leading zero byte means big-endian.
        return new TextDecoder(bytes[0] === 0 ? 'utf-16be' : 'utf-16le').decode(bytes);
    }
    if (charset === 'ANSI') return new TextDecoder('windows-1252').decode(bytes);
    // ASCII, UTF-8, unknown, or no header at all.
    return new TextDecoder('utf-8').decode(bytes);
}

// ==================== MAIN PARSER ====================

/**
 * Parse GEDCOM file content into structured data
 */
/** Level-1 INDI tags the parser understands (everything else is counted as dropped). */
const KNOWN_INDI_TAGS = new Set(['NAME', 'SEX', 'FAMS', 'FAMC', 'NOTE', 'SOUR', 'BIRT', 'DEAT', 'OBJE', 'REFN', 'ASSO',
    ...Object.keys(EVENT_TAG_TO_TYPE)]);
/** Level-1 FAM tags the parser understands. */
const KNOWN_FAM_TAGS = new Set(['HUSB', 'WIFE', 'CHIL', 'NOTE', 'MARR', 'DIV', 'SOUR']);
/** Level-0 record types (handled or structural). */
/**
 * Labels for ALTERNATIVE birth/death facts. Platforms (MyHeritage) allow several
 * BIRT/DEAT records per person; the first fills the dedicated date fields and
 * the rest are kept as labelled CUSTOM events — 'birth'/'death' event types are
 * reserved for the date fields (validation flags them as a data-entry mistake).
 */
const ALT_BIRTH_LABEL = 'Birth (alternative record)';
const ALT_DEATH_LABEL = 'Death (alternative record)';

const KNOWN_RECORD_TYPES = new Set(['INDI', 'FAM', 'SOUR', 'REPO', 'HEAD', 'TRLR', 'SUBM', 'SUBN']);

/**
 * Pure bookkeeping tags (platform sync ids, change stamps). Ignored WITHOUT
 * counting them as unsupported — a MyHeritage export carries three of these
 * per person and the "1079 unsupported records" number needlessly scared
 * migrating users even though no user data was involved.
 */
const IGNORED_BOOKKEEPING_TAGS = new Set(['_UPD', 'RIN', '_UID', 'CHAN', '_PROJECT_GUID', '_EXPORTED_FROM_SITE_ID']);

/** Attach a DATE to the MARR/DIV it sits under — the most recent one seen. */
function lastUnionEvent(fam: GedcomFamily, type: 'marriage' | 'divorce', date: string): void {
    for (let i = fam.unionEvents.length - 1; i >= 0; i--) {
        if (fam.unionEvents[i].type === type) { fam.unionEvents[i].date = date; return; }
    }
}

/**
 * Where a couple ended up, reading their MARR/DIV events in order.
 *
 * A couple can divorce and marry each other again; GEDCOM 7 records that as
 * MARR/DIV/MARR inside one family. Asking only "is there a DIV?" called them
 * divorced for ever — and left the marriage starting after the divorce that
 * ended it. Whichever came last decides. Dates say so when the file gives them,
 * otherwise the order the file lists the events in.
 */
function resolveUnionStatus(fam: GedcomFamily): {
    status: 'married' | 'divorced';
    startDate: string;
    endDate: string;
    remarriage: { divorced: string; married: string } | null;
} {
    const marriages = fam.unionEvents.filter(e => e.type === 'marriage');
    const divorces = fam.unionEvents.filter(e => e.type === 'divorce');
    const divorcedAtAll = divorces.length > 0 || fam.divorced || !!fam.divorceDate;
    // The union began at the FIRST marriage; a remarriage is a later chapter of
    // the same couple, not a new start date.
    const startDate = marriages.find(e => e.date)?.date ?? fam.marriageDate;

    if (!divorcedAtAll) return { status: 'married', startDate, endDate: '', remarriage: null };

    const lastIsMarriage = ((): boolean => {
        const lastEvent = fam.unionEvents[fam.unionEvents.length - 1];
        // The file's final word is an undated event: dates cannot place it, so
        // file order decides. Comparing only the last DATED events called
        // MARR(1911)/DIV(1912)/MARR(undated) divorced — but the last thing the
        // file says about the couple is that they married.
        if (lastEvent && !lastEvent.date) return lastEvent.type === 'marriage';
        const lastM = [...marriages].reverse().find(e => e.date);
        const lastD = [...divorces].reverse().find(e => e.date);
        // Both dated: compare them. Otherwise trust the order in the file.
        if (lastM && lastD) return dateSortKey(lastM.date) > dateSortKey(lastD.date);
        return !!lastEvent && lastEvent.type === 'marriage';
    })();

    if (lastIsMarriage) {
        const again = [...marriages].reverse().find(e => e.date)?.date ?? '';
        return {
            status: 'married',
            startDate,
            endDate: '',
            // The divorce in between is real history — say so rather than drop it.
            remarriage: again && again !== startDate
                ? { divorced: fam.divorceDate, married: again }
                : null,
        };
    }
    return { status: 'divorced', startDate, endDate: fam.divorceDate, remarriage: null };
}

/** Put the resolved marriage/divorce outcome onto a partnership. */
function applyUnionOutcome(partnership: Partnership, fam: GedcomFamily): void {
    const outcome = resolveUnionStatus(fam);
    if (outcome.startDate) partnership.startDate = outcome.startDate;
    if (outcome.endDate) partnership.endDate = outcome.endDate;
    partnership.status = outcome.status;
    if (outcome.remarriage) {
        const { divorced, married } = outcome.remarriage;
        const line = divorced
            ? `Divorced ${divorced}, married again ${married}`
            : `Divorced, married again ${married}`;
        partnership.note = partnership.note ? `${partnership.note}\n${line}` : line;
    }
}

export function parseGedcom(content: string): ParsedGedcom {
    // Strip BOM (Byte Order Mark) if present
    if (content.charCodeAt(0) === 0xFEFF) {
        content = content.slice(1);
    }

    // \r\n, \n AND bare \r: classic-Mac exports separate lines with CR only,
    // and /\r?\n/ read such a file as one long line — a silent empty import.
    const lines = content.split(/\r\n|\r|\n/);
    const individuals = new Map<string, GedcomIndividual>();
    const families = new Map<string, GedcomFamily>();
    const sources = new Map<string, RawSource>();
    const repositories = new Map<string, string>();
    /** PAGE seen on a citation (2/3 PAGE under SOUR @Sx@) -> source reference. */
    const citationPages = new Map<string, string>();
    /** QUAY seen on a citation -> source quality (first wins, like PAGE). */
    const citationQuality = new Map<string, number>();
    const noteQuay = (ref: string | null, value: string): void => {
        const q = parseInt(value, 10);
        if (ref && q >= 0 && q <= 3 && !citationQuality.has(ref)) citationQuality.set(ref, q);
    };
    const droppedTags = new Map<string, number>();
    const drop = (tag: string) => droppedTags.set(tag, (droppedTags.get(tag) ?? 0) + 1);

    let currentRecord: GedcomIndividual | GedcomFamily | null = null;
    let currentType: 'INDI' | 'FAM' | 'SOUR' | null = null;
    /** Serial for records the file gives no xref — they still need a key. */
    let anonRecordSeq = 0;
    let currentSubTag: string | null = null;
    let currentEvent: RawEvent | null = null;
    /** Level-2 tag inside the current event (for level-3 NOTE continuations). */
    let currentEventSubTag: string | null = null;
    let currentSource: RawSource | null = null;
    let currentMedia: RawMedia | null = null;
    /** Level-2 tag inside the current OBJE (for level-3 FILE continuations). */
    let currentMediaSubTag: string | null = null;
    /** @Sx@ of the most recent citation (PAGE lines attach to it). */
    let currentCitationId: string | null = null;
    /** 0 @Rx@ REPO record currently open. */
    let currentRepoId: string | null = null;

    for (const line of lines) {
        const match = line.match(/^(\d+)\s+(@\w+@|\w+)\s*(.*)?$/);
        if (!match) continue;

        const level = parseInt(match[1]);
        const tag = match[2];
        // GEDCOM escapes a literal '@' as '@@' (pointers never contain it).
        const value = (match[3] || '').trim().replace(/@@/g, '@');

        if (level === 0) {
            // What KIND of record this is comes from the type word, never from
            // the shape of the id. An xref is an opaque label: nothing obliges a
            // program to number its people @I1@, and some use @P1@ or @1@.
            // Requiring the '@I' prefix silently imported those files as an
            // empty tree — a whole GEDCOM lost without a word of warning.
            // A record with no xref at all (legal in GEDCOM 7) still holds a
            // person, so it gets an internal id nothing can point at.
            const hasXref = /^@[^@]+@$/.test(tag);
            const recordType = hasXref ? value : tag;
            const recordId = hasXref ? tag : `@__anon${anonRecordSeq++}__@`;

            if (recordType === 'INDI') {
                currentRecord = {
                    id: recordId,
                    name: '',
                    firstName: '',
                    lastName: '',
                    sex: '',
                    birthDate: '',
                    birthPlace: '',
                    deathDate: '',
                    deathPlace: '',
                    notes: '',
                    refn: '',
                    events: [],
                    nameVariants: [],
                    sourceRefs: [],
                    media: [],
                    deceased: false,
                    birthSeen: false,
                    deathSeen: false,
                    fams: [],
                    assos: [],
                    famcLinks: []
                };
                currentType = 'INDI';
                currentSource = null;
                individuals.set(recordId, currentRecord as GedcomIndividual);
            } else if (recordType === 'SOUR') {
                currentSource = {
                    id: recordId, title: '', repository: '', reference: '', url: '', note: ''
                };
                currentRecord = null;
                currentType = 'SOUR';
                sources.set(recordId, currentSource);
            } else if (recordType === 'REPO') {
                currentRepoId = recordId;
                repositories.set(recordId, '');
                currentRecord = null;
                currentType = null;
                currentSource = null;
            } else if (recordType === 'FAM') {
                currentRecord = {
                    id: recordId,
                    husb: null,
                    wife: null,
                    children: [],
                    marriageDate: '',
                    marriagePlace: '',
                    divorceDate: '',
                    divorced: false,
                    unionEvents: [],
                    note: '',
                    engagementDate: '',
                    sourceRefs: []
                };
                currentType = 'FAM';
                currentSource = null;
                families.set(recordId, currentRecord as GedcomFamily);
            } else {
                currentRecord = null;
                currentType = null;
                currentSource = null;
                if (!KNOWN_RECORD_TYPES.has(recordType) && recordType) drop(recordType);
            }
            currentSubTag = null;
            currentEvent = null;
            currentEventSubTag = null;
            currentMedia = null;
            currentMediaSubTag = null;
            currentCitationId = null;
            if (recordType !== 'REPO') currentRepoId = null;
        } else if (currentRepoId !== null && level === 1 && tag === 'NAME') {
            repositories.set(currentRepoId, value);
        } else if (currentType === 'SOUR' && currentSource) {
            // Source record sub-lines. reference <- PAGE (spec mapping).
            if (level === 1) {
                currentSubTag = tag;
                if (tag === 'TITL') currentSource.title = value;
                else if (tag === 'REPO') currentSource.repository = value;
                else if (tag === 'PAGE') currentSource.reference = value;
                else if (tag === 'PUBL' || tag === 'TEXT') {
                    const text = value.replace(/<[^>]*>/g, '').trim();
                    if (text) currentSource.note = currentSource.note ? `${currentSource.note}\n${text}` : text;
                }
                else if (tag === 'QUAY') { const q = parseInt(value, 10); if (q >= 0 && q <= 3) currentSource.quality = q; }
                else if (tag === 'WWW' || tag === 'URL') currentSource.url = value;
                else if (tag === 'NOTE') currentSource.note = value;
            } else if (level === 2) {
                // Multi-line continuations for title / note.
                if (currentSubTag === 'TITL') {
                    if (tag === 'CONT') currentSource.title += '\n' + value;
                    else if (tag === 'CONC') currentSource.title += value;
                } else if (currentSubTag === 'NOTE') {
                    if (tag === 'CONT') currentSource.note += '\n' + value;
                    else if (tag === 'CONC') currentSource.note += value;
                }
            }
        } else if (currentRecord) {
            if (level === 1) {
                currentSubTag = tag;
                currentEvent = null;
                currentEventSubTag = null;
                if (tag !== 'OBJE') currentMedia = null;
                currentMediaSubTag = null;
                if (tag !== 'SOUR') currentCitationId = null;

                if (currentType === 'INDI') {
                    const indi = currentRecord as GedcomIndividual;
                    switch (tag) {
                        case 'NAME': {
                            // GEDCOM allows several NAME lines; the first is the
                            // primary one and the rest are other spellings. This
                            // used to overwrite, so the primary name was silently
                            // replaced by the last variant in the file.
                            if (indi.name) {
                                if (value.trim()) indi.nameVariants.push(value.trim());
                                break;
                            }
                            const parsed = parseName(value);
                            indi.name = value;
                            indi.firstName = parsed.firstName;
                            indi.lastName = parsed.lastName;
                            break;
                        }
                        case 'SEX':
                            indi.sex = value;
                            break;
                        case 'FAMS':
                            indi.fams.push(value);
                            break;
                        case 'FAMC':
                            indi.famcLinks.push({ famId: value, pedi: '' });
                            break;
                        case 'ASSO':
                            // Level-1 ASSO: an association of the person as a
                            // whole (GEDCOM 5.5.1), not tied to any event.
                            if (value) indi.assos.push({ ref: value });
                            break;
                        case 'NOTE':
                            indi.notes = value;
                            break;
                        case 'REFN':
                            indi.refn = value;
                            break;
                        case 'SOUR':
                            // Level-1 SOUR on INDI is a citation reference (@Sx@).
                            if (value) { indi.sourceRefs.push(value); currentCitationId = value; }
                            break;
                        case 'BIRT':
                            // MyHeritage allows several BIRT facts: the first
                            // fills the primary fields, duplicates become
                            // events so the alternative place/date survives.
                            if (indi.birthSeen) {
                                const ev: RawEvent = { type: 'custom', customLabel: ALT_BIRTH_LABEL };
                                indi.events.push(ev);
                                currentEvent = ev;
                                currentSubTag = '_DUP';
                            } else {
                                indi.birthSeen = true;
                            }
                            break;
                        case 'DEAT':
                            // A bare 'DEAT Y' (no date) still means deceased.
                            indi.deceased = true;
                            if (indi.deathSeen) {
                                const ev: RawEvent = { type: 'custom', customLabel: ALT_DEATH_LABEL };
                                indi.events.push(ev);
                                currentEvent = ev;
                                currentSubTag = '_DUP';
                            } else {
                                indi.deathSeen = true;
                            }
                            break;
                        case 'OBJE': {
                            const media: RawMedia = { title: '', form: '', file: '', stromKind: '' };
                            indi.media.push(media);
                            currentMedia = media;
                            break;
                        }
                        default: {
                            const evType = EVENT_TAG_TO_TYPE[tag];
                            if (evType) {
                                // OCCU carries the occupation as its value; other
                                // events carry date/place on level-2 sub-lines.
                                const ev: RawEvent = { type: evType };
                                if (tag === 'OCCU' && value) ev.note = value;
                                indi.events.push(ev);
                                currentEvent = ev;
                            } else if (!KNOWN_INDI_TAGS.has(tag) && tag !== 'BIRT' && tag !== 'DEAT'
                                && !IGNORED_BOOKKEEPING_TAGS.has(tag)) {
                                drop(tag);
                            }
                            break;
                        }
                    }
                } else if (currentType === 'FAM') {
                    const fam = currentRecord as GedcomFamily;
                    switch (tag) {
                        case 'HUSB':
                            fam.husb = value;
                            break;
                        case 'WIFE':
                            fam.wife = value;
                            break;
                        case 'CHIL':
                            fam.children.push(value);
                            break;
                        case 'NOTE':
                            fam.note = value;
                            break;
                        case 'DIV':
                            // A bare DIV (no date sub-record) still means divorced.
                            fam.divorced = true;
                            fam.unionEvents.push({ type: 'divorce', date: '' });
                            break;
                        case 'SOUR':
                            // Family citation (typically the marriage record).
                            if (value) { fam.sourceRefs.push(value); currentCitationId = value; }
                            break;
                        case 'MARR':
                            fam.unionEvents.push({ type: 'marriage', date: '' });
                            break;
                        case 'ENGA':
                            fam.engagementDate = value === 'Y' ? '?' : '';
                            break;
                        default:
                            if (!KNOWN_FAM_TAGS.has(tag) && !IGNORED_BOOKKEEPING_TAGS.has(tag)) drop(tag);
                            break;
                    }
                }
            } else if (level === 2) {
                if (currentType === 'INDI') {
                    const indi = currentRecord as GedcomIndividual;
                    if (currentSubTag === 'BIRT') {
                        if (tag === 'DATE') indi.birthDate = parseGedcomDate(value);
                        if (tag === 'PLAC') indi.birthPlace = value;
                    } else if (currentSubTag === 'DEAT') {
                        if (tag === 'DATE') indi.deathDate = parseGedcomDate(value);
                        if (tag === 'PLAC') indi.deathPlace = value;
                    } else if (currentSubTag === 'FAMC') {
                        // Pedigree type of the child→family link (adopted/foster).
                        // It belongs to the FAMC it sits under — the last one seen.
                        if (tag === 'PEDI' && indi.famcLinks.length > 0) {
                            indi.famcLinks[indi.famcLinks.length - 1].pedi = value.toLowerCase();
                        }
                    } else if (currentSubTag === 'NOTE') {
                        // Multi-line notes: CONT = new line, CONC = continuation.
                        if (tag === 'CONT') indi.notes += '\n' + value;
                        else if (tag === 'CONC') indi.notes += value;
                    } else if (currentSubTag === 'ASSO') {
                        // Role/detail of the person-level association just read.
                        const last = indi.assos[indi.assos.length - 1];
                        if (last) {
                            if (tag === 'RELA') last.rela = value;
                            else if (tag === 'NOTE') last.note = value;
                        }
                    } else if (currentSubTag === 'OBJE' && currentMedia) {
                        currentMediaSubTag = tag;
                        if (tag === 'TITL') currentMedia.title = value;
                        else if (tag === 'FORM') currentMedia.form = value;
                        else if (tag === 'FILE') currentMedia.file = value;
                        else if (tag === '_STROM_KIND') currentMedia.stromKind = value;
                        else if ((tag === '_PRIM' || tag === '_PERSONALPHOTO') && value === 'Y') currentMedia.primary = true;
                    } else if (currentSubTag === 'SOUR' && tag === 'PAGE' && currentCitationId) {
                        // Citation page: standard place for a source reference.
                        if (!citationPages.has(currentCitationId)) citationPages.set(currentCitationId, value);
                    } else if (currentSubTag === 'SOUR' && tag === 'QUAY' && currentCitationId) {
                        noteQuay(currentCitationId, value);
                    } else if (currentEvent) {
                        currentEventSubTag = tag;
                        if (tag === 'DATE') currentEvent.date = parseGedcomDate(value);
                        else if (tag === 'PLAC') currentEvent.place = value;
                        else if (tag === 'SOUR' && value) {
                            (currentEvent.sourceRefs ??= []).push(value);
                            currentCitationId = value;
                        } else if (tag === 'NOTE') {
                            currentEvent.note = currentEvent.note
                                ? `${currentEvent.note}\n${value}` : value;
                        } else if (tag === 'EMAIL' && value) {
                            // MyHeritage keeps contact e-mail under RESI.
                            const line = `E-mail: ${value}`;
                            currentEvent.note = currentEvent.note
                                ? `${currentEvent.note}\n${line}` : line;
                        } else if (tag === 'ASSO' && value) {
                            // Godparent/witness who has a record of their own.
                            (currentEvent.participants ??= []).push({ ref: value });
                        } else if ((tag === '_WITN' || tag === 'WITN') && value) {
                            // …and one who does not: just a name in the register.
                            (currentEvent.participants ??= []).push({ name: value });
                        }
                    }
                } else if (currentType === 'FAM') {
                    const fam = currentRecord as GedcomFamily;
                    if (currentSubTag === 'SOUR' && tag === 'PAGE' && currentCitationId) {
                        if (!citationPages.has(currentCitationId)) citationPages.set(currentCitationId, value);
                    } else if (currentSubTag === 'SOUR' && tag === 'QUAY' && currentCitationId) {
                        noteQuay(currentCitationId, value);
                    } else if (currentSubTag === 'MARR') {
                        if (tag === 'DATE') {
                            fam.marriageDate = parseGedcomDate(value);
                            lastUnionEvent(fam, 'marriage', fam.marriageDate);
                        }
                        // First wins: the union's startDate comes from the FIRST
                        // marriage, so its place must not drift to a later one.
                        if (tag === 'PLAC' && !fam.marriagePlace) fam.marriagePlace = value;
                    } else if (currentSubTag === 'DIV') {
                        if (tag === 'DATE') {
                            fam.divorceDate = parseGedcomDate(value);
                            lastUnionEvent(fam, 'divorce', fam.divorceDate);
                        }
                    } else if (currentSubTag === 'ENGA') {
                        if (tag === 'DATE') fam.engagementDate = parseGedcomDate(value);
                    } else if (currentSubTag === 'NOTE') {
                        if (tag === 'CONT') fam.note += '\n' + value;
                        else if (tag === 'CONC') fam.note += value;
                    }
                }
            } else if (level === 3 && currentType === 'INDI' && currentEvent
                && currentEventSubTag === 'NOTE') {
                // Multi-line event notes: 3 CONT/CONC under 2 NOTE (previously
                // dropped, which broke the round-trip of multi-line notes).
                if (tag === 'CONT') currentEvent.note = (currentEvent.note ?? '') + '\n' + value;
                else if (tag === 'CONC') currentEvent.note = (currentEvent.note ?? '') + value;
            } else if (level === 3 && currentType === 'INDI' && currentEvent
                && (currentEventSubTag === 'ASSO' || currentEventSubTag === '_WITN'
                    || currentEventSubTag === 'WITN')) {
                // The role (and any detail) of the godparent/witness just read.
                const last = currentEvent.participants?.[currentEvent.participants.length - 1];
                if (last) {
                    if (tag === 'RELA') last.rela = value;
                    else if (tag === 'NOTE') last.note = value;
                }
            } else if (level === 3 && currentMedia && currentMediaSubTag === 'FILE' && tag === 'CONC') {
                // Data-URL payloads are CONC-wrapped (255-char physical lines).
                currentMedia.file += value;
            } else if (level === 3 && currentType === 'INDI' && currentEvent
                && currentEventSubTag === 'SOUR' && tag === 'PAGE' && currentCitationId) {
                if (!citationPages.has(currentCitationId)) citationPages.set(currentCitationId, value);
            } else if (level === 3 && currentType === 'INDI' && currentEvent
                && currentEventSubTag === 'SOUR' && tag === 'QUAY' && currentCitationId) {
                noteQuay(currentCitationId, value);
            }
        }
    }

    // Resolve repository pointers (1 REPO @Rx@) to names, and citation PAGEs
    // into the source's reference when the record itself carried none.
    for (const src of sources.values()) {
        const m = src.repository.match(/^@\w+@$/);
        if (m) src.repository = repositories.get(src.repository) ?? '';
        if (!src.reference && citationPages.has(src.id)) {
            src.reference = citationPages.get(src.id)!;
        }
        if (src.quality === undefined && citationQuality.has(src.id)) {
            src.quality = citationQuality.get(src.id);
        }
    }

    return { individuals, families, sources, repositories, droppedTags };
}

// ==================== CONVERTER ====================

/**
 * Convert parsed GEDCOM data to Strom data format
 */
export function convertToStrom(gedcom: ParsedGedcom): GedcomConversionResult {
    const { individuals, families, sources: gedSources, droppedTags } = gedcom;

    // Family roles disambiguate individuals with SEX U/missing: a HUSB is
    // male, a WIFE female. Without any role we fall back to female (legacy
    // behaviour) but COUNT it so the import summary can say so.
    const husbIds = new Set<string>();
    const wifeIds = new Set<string>();
    for (const fam of families.values()) {
        if (fam.husb) husbIds.add(fam.husb);
        if (fam.wife) wifeIds.add(fam.wife);
    }
    let unknownSexPersons = 0;
    let otherFamilyLinks = 0;

    // Build the source catalog and a GEDCOM-id -> new-id map for citations.
    const sourceIdMap = new Map<string, string>();
    const sources: Record<string, Source> = {};
    for (const [gedId, raw] of gedSources) {
        const newId = generateSourceId();
        sourceIdMap.set(gedId, newId);
        const src: Source = { id: newId, title: raw.title || '?' };
        if (raw.repository) src.repository = raw.repository;
        if (raw.reference) src.reference = raw.reference;
        if (raw.url) src.url = raw.url;
        if (raw.note) src.note = raw.note;
        if (raw.quality !== undefined) src.quality = raw.quality;
        sources[newId] = src;
    }
    /** Map raw @Sx@ refs to catalog ids, dropping any that don't resolve. */
    const mapRefs = (refs?: string[]): string[] =>
        (refs ?? []).map(r => sourceIdMap.get(r)).filter((id): id is string => !!id);

    // Keep ALL individuals. Nameless ones (unknown ancestors) become
    // placeholders instead of being dropped, so relationships stay intact.
    const validIndividuals = individuals;
    let placeholderPersons = 0;
    for (const indi of individuals.values()) {
        if (!indi.firstName && !indi.lastName) placeholderPersons++;
    }

    // Create ID mappings (only for valid individuals)
    const personIdMap = new Map<string, PersonId>();
    const partnershipIdMap = new Map<string, PartnershipId>();

    // Generate new IDs
    for (const [gedId] of validIndividuals) {
        personIdMap.set(gedId, toPersonId(generateId('p')));
    }
    for (const [gedId] of families) {
        partnershipIdMap.set(gedId, toPartnershipId(generateId('u')));
    }

    // Create persons
    const persons: Record<PersonId, Person> = {};
    const externalMedia: ExternalMediaRef[] = [];
    for (const [gedId, indi] of validIndividuals) {
        const personId = personIdMap.get(gedId)!;
        let gender: 'male' | 'female';
        if (indi.sex === 'M') gender = 'male';
        else if (indi.sex === 'F') gender = 'female';
        else {
            unknownSexPersons++;
            gender = husbIds.has(gedId) ? 'male' : 'female';
        }
        const person: Person = {
            id: personId,
            firstName: indi.firstName || '?',
            lastName: indi.lastName || '',
            gender,
            isPlaceholder: !indi.firstName || indi.firstName === '?' || indi.firstName === '//',
            partnerships: [],
            parentIds: [],
            childIds: []
        };

        // Add extended info if present
        if (indi.birthDate) person.birthDate = indi.birthDate;
        if (indi.birthPlace) person.birthPlace = indi.birthPlace;
        if (indi.deathDate) person.deathDate = indi.deathDate;
        // 'DEAT Y' without a date: mark deceased explicitly, otherwise the
        // liveness heuristic would treat the person as possibly living.
        if (indi.deceased && !indi.deathDate) person.isDeceased = true;
        if (indi.deathPlace) person.deathPlace = indi.deathPlace;
        if (indi.notes) person.notes = indi.notes;
        if (indi.refn) person.refn = indi.refn;
        // Other spellings from the file, kept as written.
        const variants = indi.nameVariants.map(v => v.replace(/\//g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
        if (variants.length > 0) person.nameVariants = variants;
        if (indi.events.length > 0) {
            person.events = indi.events.map((ev): LifeEvent => {
                const out: LifeEvent = { id: generateLifeEventId(), type: ev.type };
                if (ev.customLabel) out.customLabel = ev.customLabel;
                if (ev.date) out.date = ev.date;
                if (ev.place) out.place = ev.place;
                if (ev.note) out.note = ev.note;
                const evRefs = mapRefs(ev.sourceRefs);
                if (evRefs.length > 0) out.sourceIds = evRefs;

                // Godparents / witnesses. An ASSO pointing at someone the file
                // never defines (@VOID@ or a missing record) is dropped: with
                // no link and no name, a bare role says nothing worth keeping.
                const parts = (ev.participants ?? []).map(raw => {
                    const linked = raw.ref ? personIdMap.get(raw.ref) : undefined;
                    return {
                        id: generateParticipantId(),
                        role: relaToRole(raw.rela),
                        ...(linked ? { personId: linked } : {}),
                        ...(raw.name ? { name: raw.name } : {}),
                        ...(raw.note ? { note: raw.note } : {}),
                    };
                }).filter(p => p.personId || p.name);
                if (parts.length > 0) out.participants = parts;
                return out;
            });
        }
        // Person-level associations (level-1 ASSO). Participants live on events
        // in this model, so a godparent joins the baptism when the person has
        // one; every other association survives as a note on the person rather
        // than being silently dropped. Unresolvable refs are dropped for the
        // same reason as event participants above.
        for (const asso of indi.assos) {
            const linked = asso.ref ? personIdMap.get(asso.ref) : undefined;
            if (!linked) continue;
            const role = relaToRole(asso.rela);
            const baptism = role === 'godparent'
                ? person.events?.find(e => e.type === 'baptism') : undefined;
            if (baptism) {
                (baptism.participants ??= []).push({
                    id: generateParticipantId(),
                    role,
                    personId: linked,
                    ...(asso.note ? { note: asso.note } : {}),
                });
            } else {
                const other = individuals.get(asso.ref!);
                const name = `${other?.firstName ?? ''} ${other?.lastName ?? ''}`.trim() || '?';
                const label = asso.rela?.trim() || role;
                const line = `Association: ${name} (${label})`
                    + (asso.note ? ` — ${asso.note}` : '');
                person.notes = person.notes ? `${person.notes}\n${line}` : line;
            }
        }

        const personRefs = mapRefs(indi.sourceRefs);
        if (personRefs.length > 0) person.sourceIds = personRefs;

        // OBJE media: a data-URL FILE is either the portrait (Strom marker)
        // or an attachment. External file paths cannot be embedded — counted
        // as dropped so the import summary mentions them.
        for (const media of indi.media) {
            if (media.file.startsWith('data:')) {
                if (media.stromKind === 'photo' && media.file.startsWith('data:image')) {
                    person.photo = media.file;
                    if (media.title) person.photoOriginalName = media.title;
                } else {
                    const att: Attachment = {
                        id: generateId('att'),
                        name: media.title || 'attachment',
                        mimeType: media.file.slice(5, media.file.indexOf(';')) || 'application/octet-stream',
                        dataUrl: media.file,
                        sizeBytes: Math.round((media.file.length - media.file.indexOf(',') - 1) * 0.75),
                    };
                    (person.attachments ??= []).push(att);
                }
            } else if (media.file) {
                // Platform exports (MyHeritage, Ancestry) reference media by
                // path — remember the ref so the user can attach the files.
                const isUrl = /^https?:\/\//i.test(media.file);
                const base = (isUrl ? media.file.split('?')[0] : media.file).split(/[\\/]/).pop() || media.file;
                const ref: ExternalMediaRef = {
                    personId, fileName: base, filePath: media.file,
                    ...(media.title ? { title: media.title } : {}),
                    ...(isUrl ? { isUrl: true } : {}),
                    ...(media.primary ? { primary: true } : {}),
                };
                // Primary portraits first so the photo (not a crop) wins.
                if (media.primary) {
                    const firstOfPerson = externalMedia.findIndex(m => m.personId === personId);
                    if (firstOfPerson >= 0) { externalMedia.splice(firstOfPerson, 0, ref); }
                    else externalMedia.push(ref);
                } else {
                    externalMedia.push(ref);
                }
            }
        }

        persons[personId] = person;
    }

    /** Is this link the one the child was born into? No PEDI means birth. */
    const isBirthLink = (pedi: string): boolean => !pedi || pedi === 'birth';

    /** The PEDI the child's own FAMC gives for this family, if it names one. */
    const pediFor = (childGedId: string, famGedId: string): string =>
        individuals.get(childGedId)?.famcLinks.find(l => l.famId === famGedId)?.pedi ?? '';

    /**
     * The ONE family each child hangs from.
     *
     * GEDCOM lets a child belong to several families — born to one, adopted into
     * another — but a person here has at most two parents (DataManager enforces
     * it; only this importer ever broke the rule). Left unchecked the child
     * collected a parent from every family and was drawn hanging off all of them
     * at once, which is the long connector in the 555SAMPLE render.
     *
     * The birth family wins, because that is the one the tree is built from. Any
     * other family the child was recorded in is kept as a note on the child
     * rather than silently thrown away.
     */
    const childFamily = new Map<string, string>();
    for (const [gedFamId, fam] of families) {
        for (const childGedId of fam.children) {
            const chosen = childFamily.get(childGedId);
            if (!chosen) { childFamily.set(childGedId, gedFamId); continue; }
            if (isBirthLink(pediFor(childGedId, gedFamId))
                && !isBirthLink(pediFor(childGedId, chosen))) {
                childFamily.set(childGedId, gedFamId);
            }
        }
    }

    /** Children this family actually keeps (the others hang from their own). */
    const childrenOf = (gedFamId: string, fam: GedcomFamily): string[] =>
        fam.children.filter(c => childFamily.get(c) === gedFamId);

    // Create partnerships and link relationships
    const partnerships: Record<PartnershipId, Partnership> = {};
    for (const [gedFamId, fam] of families) {
        const partnershipId = partnershipIdMap.get(gedFamId)!;

        // Resolve the spouse pointers FIRST: a HUSB/WIFE of @VOID@ (or any
        // pointer to a record the file never defines) is the same as no
        // HUSB/WIFE line at all. Testing the raw strings sent such families
        // here, where this continue dropped the real parent and every child;
        // now they fall through to the single-parent handling below.
        const person1Id = fam.husb ? personIdMap.get(fam.husb) : undefined;
        const person2Id = fam.wife ? personIdMap.get(fam.wife) : undefined;

        // Families without both resolvable spouses are handled below.
        if (!person1Id || !person2Id) continue;

        // Create partnership
        const partnership: Partnership = {
            id: partnershipId,
            person1Id: person1Id,
            person2Id: person2Id,
            childIds: [],
            status: 'married'
        };

        if (fam.marriagePlace) {
            partnership.startPlace = fam.marriagePlace;
        }
        if (fam.note) {
            partnership.note = fam.note;
        }

        applyUnionOutcome(partnership, fam);

        if (fam.engagementDate && fam.engagementDate !== '?') {
            const line = `Engagement: ${fam.engagementDate}`;
            partnership.note = partnership.note ? `${partnership.note}\n${line}` : line;
        }

        const famRefs = mapRefs(fam.sourceRefs);
        if (famRefs.length > 0) partnership.sourceIds = famRefs;

        partnerships[partnershipId] = partnership;

        // Add partnership to both persons
        if (persons[person1Id]) {
            persons[person1Id].partnerships.push(partnershipId);
        }
        if (persons[person2Id]) {
            persons[person2Id].partnerships.push(partnershipId);
        }

        // Process children
        for (const childGedId of childrenOf(gedFamId, fam)) {
            const childId = personIdMap.get(childGedId);
            if (!childId || !persons[childId]) continue;

            // Add to partnership's childIds
            partnerships[partnershipId].childIds.push(childId);

            // Add parents to child's parentIds
            if (!persons[childId].parentIds.includes(person1Id)) {
                persons[childId].parentIds.push(person1Id);
            }
            if (!persons[childId].parentIds.includes(person2Id)) {
                persons[childId].parentIds.push(person2Id);
            }

            // Pedigree type (PEDI) applies to the child's link to THIS family →
            // set both parents' relationship type accordingly. Read from the
            // FAMC naming this family: a PEDI under another FAMC says nothing
            // about these parents, and taking any PEDI the person carried marked
            // Joe's birth parents adoptive in 555SAMPLE.
            const pedi = pediFor(childGedId, gedFamId);
            const relType: ParentChildRelType | null =
                pedi === 'adopted' ? 'adoptive' : pedi === 'foster' ? 'foster' : null;
            if (relType) {
                const child = persons[childId];
                if (!child.parentRelTypes) child.parentRelTypes = {};
                child.parentRelTypes[person1Id] = relType;
                child.parentRelTypes[person2Id] = relType;
            }

            // Add child to parents' childIds
            if (!persons[person1Id].childIds.includes(childId)) {
                persons[person1Id].childIds.push(childId);
            }
            if (!persons[person2Id].childIds.includes(childId)) {
                persons[person2Id].childIds.push(childId);
            }
        }
    }

    // Handle single-parent families (only HUSB or only WIFE)
    // Create placeholder for the missing parent + partnership so layout engine can render children
    for (const [gedFamId, fam] of families) {
        // Same pointer resolution as above: a @VOID@/unresolvable spouse is a
        // missing spouse. Skip only families where BOTH resolved (processed
        // above); one resolved parent belongs here.
        const husbId = fam.husb ? personIdMap.get(fam.husb) : undefined;
        const wifeId = fam.wife ? personIdMap.get(fam.wife) : undefined;
        if (husbId && wifeId) continue;
        // Only children who actually hang from this family count. A family whose
        // every child was born in another one has nobody to render, so inventing
        // a spouse for it would put a "?" card in the tree standing for a person
        // the file never claimed existed — the placeholder in the 555SAMPLE render.
        const ownChildren = childrenOf(gedFamId, fam);
        if (ownChildren.length === 0) continue;

        const parentId = husbId ?? wifeId;
        if (!parentId || !persons[parentId]) continue;

        // The dropped pointer's stand-in IS the placeholder created below —
        // count it so the import summary owns up to the swap.
        if ((fam.husb && !husbId) || (fam.wife && !wifeId)) placeholderPersons++;

        // Create placeholder for the missing parent (opposite gender)
        const placeholderId = toPersonId(generateId('p'));
        const parentGender = persons[parentId].gender;
        const placeholderGender = parentGender === 'male' ? 'female' : 'male';
        const placeholder: Person = {
            id: placeholderId,
            firstName: '?',
            lastName: '',
            gender: placeholderGender,
            parentIds: [],
            childIds: [],
            partnerships: [],
            isPlaceholder: true
        };
        persons[placeholderId] = placeholder;

        // Create partnership. Keep the male partner as person1 (HUSB), matching
        // the two-parent path and the exporter, so import->export->import is
        // order-stable even when the known parent is the mother.
        const parentIsMale = parentGender === 'male';
        const person1Id = parentIsMale ? parentId : placeholderId;
        const person2Id = parentIsMale ? placeholderId : parentId;

        const partnershipId = toPartnershipId(generateId('u'));
        const partnership: Partnership = {
            id: partnershipId,
            person1Id,
            person2Id,
            childIds: [],
            status: 'married'
        };
        if (fam.marriagePlace) partnership.startPlace = fam.marriagePlace;
        if (fam.note) partnership.note = fam.note;
        applyUnionOutcome(partnership, fam);

        if (fam.engagementDate && fam.engagementDate !== '?') {
            const line = `Engagement: ${fam.engagementDate}`;
            partnership.note = partnership.note ? `${partnership.note}\n${line}` : line;
        }

        const famRefs = mapRefs(fam.sourceRefs);
        if (famRefs.length > 0) partnership.sourceIds = famRefs;
        partnerships[partnershipId] = partnership;

        // Add partnership to both persons
        persons[person1Id].partnerships.push(partnershipId);
        persons[person2Id].partnerships.push(partnershipId);

        // Process children
        for (const childGedId of ownChildren) {
            const childId = personIdMap.get(childGedId);
            if (!childId || !persons[childId]) continue;

            // Add to partnership's childIds
            partnership.childIds.push(childId);

            // Add parents to child's parentIds (person1, then person2)
            if (!persons[childId].parentIds.includes(person1Id)) {
                persons[childId].parentIds.push(person1Id);
            }
            if (!persons[childId].parentIds.includes(person2Id)) {
                persons[childId].parentIds.push(person2Id);
            }

            // PEDI applies here too: a child adopted by a lone parent is still
            // adopted, and the two-parent path above has always said so.
            const pedi = pediFor(childGedId, gedFamId);
            const relType: ParentChildRelType | null =
                pedi === 'adopted' ? 'adoptive' : pedi === 'foster' ? 'foster' : null;
            if (relType) {
                const child = persons[childId];
                if (!child.parentRelTypes) child.parentRelTypes = {};
                child.parentRelTypes[parentId] = relType;
            }

            // Add child to parents' childIds
            if (!persons[person1Id].childIds.includes(childId)) {
                persons[person1Id].childIds.push(childId);
            }
            if (!persons[person2Id].childIds.includes(childId)) {
                persons[person2Id].childIds.push(childId);
            }
        }
    }

    /**
     * The families a child was recorded in but does not hang from. The tree can
     * only draw one set of parents, so the rest is written onto the child rather
     * than vanishing — an adoption is exactly the kind of thing a genealogist
     * would not forgive us for losing.
     */
    // One pass over the families builds child -> families; walking ALL families
    // for EVERY child was O(children × families) and dominated large imports.
    const familiesOfChild = new Map<string, string[]>();
    for (const [gedFamId, fam] of families) {
        for (const childGedId of fam.children) {
            const list = familiesOfChild.get(childGedId);
            // A duplicated CHIL line inside one family counts once, as before.
            if (list) { if (list[list.length - 1] !== gedFamId) list.push(gedFamId); }
            else familiesOfChild.set(childGedId, [gedFamId]);
        }
    }

    for (const [childGedId, keptFamId] of childFamily) {
        const childId = personIdMap.get(childGedId);
        if (!childId || !persons[childId]) continue;

        for (const gedFamId of familiesOfChild.get(childGedId) ?? []) {
            if (gedFamId === keptFamId) continue;
            const fam = families.get(gedFamId)!;

            const parentNames = [fam.husb, fam.wife]
                .map(p => (p ? personIdMap.get(p) : undefined))
                .map(id => (id ? persons[id] : undefined))
                .filter((p): p is Person => !!p && !p.isPlaceholder)
                .map(p => `${p.firstName} ${p.lastName}`.trim())
                .filter(Boolean);

            const pedi = pediFor(childGedId, gedFamId);
            const kind = pedi === 'adopted' ? 'adopted child'
                : pedi === 'foster' ? 'foster child' : 'child';
            const line = parentNames.length > 0
                ? `Also recorded as ${kind} of ${parentNames.join(' and ')}.`
                : `Also recorded as ${kind} in another family.`;

            const child = persons[childId];
            child.notes = child.notes ? `${child.notes}\n${line}` : line;
            otherFamilyLinks++;
        }
    }

    return {
        externalMedia,
        data: {
            persons,
            partnerships,
            ...(Object.keys(sources).length > 0 ? { sources } : {})
        },
        stats: {
            otherFamilyLinks,
            totalPersons: Object.keys(persons).length,
            totalPartnerships: Object.keys(partnerships).length,
            placeholderPersons,
            unsupportedTags: [...droppedTags.values()].reduce((a, b) => a + b, 0),
            droppedTagSummary: [...droppedTags.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([tag, n]) => `${tag} ×${n}`)
                .join(', '),
            unknownSexPersons,
            totalGedFamilies: families.size
        }
    };
}
