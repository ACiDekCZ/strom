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
 * statuses 'partners'/'separated' ride on 1 _STAT, 'military' on EVEN + TYPE,
 * 'custom' on EVEN + TYPE <label>. The isPrimary flag has no GEDCOM equivalent
 * and is dropped on export. docs/GEDCOM-IMPORT.md is the full contract.
 */

import {
    PersonId,
    PartnershipId,
    Person,
    Partnership,
    PartnershipStatus,
    StromData,
    LifeEvent,
    EventParticipant,
    Story,
    LifeEventType,
    ParentChildRelType,
    ParticipantRole,
    Source,
    Attachment,
    toPersonId,
    toPartnershipId,
    generateLifeEventId,
    generateParticipantId,
    generateSourceId,
    PlaceGeo
} from './types';
import { dateSortKey, formatFlexDate } from './dates';
import { placeKey } from './places';
import { eventValueIsOnTag } from './events';
import { strings, getStringsForLang } from './strings';
import { SURNAME_GROUPS_MARKER, SURNAME_GROUP_SEP } from './ged-exporter';

/**
 * Words that name a role in RELA, in the languages registers and genealogy
 * programs write them, compared without diacritics or case. A stem of five
 * letters or more also matches the words it begins ("svědkyně", "kmotra");
 * shorter ones only match whole ("Pate", never "Patenkind", the godchild).
 */
const ROLE_WORDS: [Exclude<ParticipantRole, 'other'>, string[]][] = [
    ['godparent', ['godparent', 'godfather', 'godmother', 'sponsor', 'kmotr', 'pate', 'patin',
        'taufpate', 'taufpatin', 'chrzestny', 'chrzestna', 'parrain', 'marraine', 'padrino', 'madrina']],
    ['witness', ['witness', 'svedek', 'svedk', 'trauzeuge', 'trauzeugin', 'zeuge', 'zeugin',
        'swiadek', 'swiadk', 'temoin', 'testigo']],
    ['officiant', ['officiant', 'clergy', 'priest', 'minister', 'knez', 'oddavajici', 'krtici',
        'farar', 'kaplan', 'pfarrer', 'ksiadz', 'cure', 'sacerdote']],
];

/** RELA values that say nothing beyond "was there" — not worth keeping as a note. */
const PLAIN_PRESENCE = new Set(['present', 'other', 'participant']);

function relaWords(rela: string): string[] {
    return rela.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
        .split(/[^a-z]+/).filter(Boolean);
}

/**
 * RELA text -> role. Other programs write these freely ("Godparent", "godmother",
 * "Kmotr", "Taufpate"), so match loosely and fall back to 'other' rather than
 * dropping the person: knowing someone was there beats knowing nothing.
 */
function relaToRole(rela: string | undefined): ParticipantRole {
    const words = relaWords(rela ?? '');
    for (const [role, stems] of ROLE_WORDS) {
        if (words.some(w => stems.some(s => w === s || (s.length >= 5 && w.startsWith(s))))) return role;
    }
    return 'other';
}

/**
 * The note a participant keeps. A role the app has no name for (informant,
 * midwife, "porodní bába") becomes 'other', and the file's own word for it goes
 * in front of the note — dropping it left "Other: Marie" and no way of knowing
 * she was the midwife.
 */
function participantNote(rela: string | undefined, role: ParticipantRole, note: string | undefined): string | undefined {
    const label = rela?.trim();
    if (role !== 'other' || !label || PLAIN_PRESENCE.has(label.toLowerCase())) return note || undefined;
    if (note?.trim().toLowerCase().startsWith(label.toLowerCase())) return note;
    return note ? `${label} — ${note}` : label;
}

/**
 * What a _WITN with no RELA of its own means. The tag says witness, so that is
 * what they are recorded as; an explicit 3 RELA read later overwrites it.
 */
const WITNESS_RELA = 'witness';

/**
 * A raw _STORY block becomes a Story. STAT is the author's workflow state in
 * the file's own words ('navrh'/'hotovo'); 'draft'/'final' are accepted too,
 * since another tool may well write the English ones.
 */
function toStory(raw: RawStory | undefined): Story | undefined {
    if (!raw || !raw.text.trim()) return undefined;
    const stat = raw.stat.trim().toLowerCase();
    const status = (stat === 'navrh' || stat === 'draft') ? 'draft'
        : (stat === 'hotovo' || stat === 'final') ? 'final' : undefined;
    return {
        ...(raw.kind ? { kind: raw.kind } : {}),
        ...(raw.title ? { title: raw.title } : {}),
        ...(status ? { status } : {}),
        text: raw.text,
        ...(raw.facts.length > 0 ? { facts: raw.facts } : {}),
        ...(raw.note ? { note: raw.note } : {}),
    };
}

/** GEDCOM event tag <-> LifeEvent type. */
const EVENT_TAG_TO_TYPE: Record<string, LifeEventType> = {
    BAPM: 'baptism', BURI: 'burial', OCCU: 'occupation', RESI: 'residence',
    EMIG: 'emigration', IMMI: 'immigration', EDUC: 'education', RELI: 'religion',
    CONF: 'confirmation', FCOM: 'firstCommunion', BARM: 'barMitzvah',
    BASM: 'batMitzvah', ORDN: 'ordination', ADOP: 'adoption', NATU: 'naturalization',
    WILL: 'will', PROB: 'probate', CREM: 'cremation',
    TITL: 'title', NATI: 'nationality',
    // Import aliases. CHR (christening) is what many tools — and AI-written
    // register transcriptions — use for BAPM; CHRA is the adult form of the
    // same sacrament; GRAD is schooling reaching its end. Export always writes
    // the canonical tag, so these fold in without a type of their own.
    CHR: 'baptism',
    CHRA: 'baptism',
    GRAD: 'education',
    // Military service has no GEDCOM 5.5.1 tag; programs that record it use
    // their own (FTM/RootsMagic _MILT, PAF _MILI, some MILI). Strom writes the
    // portable 1 EVEN / 2 TYPE Military service and reads both back.
    _MILT: 'military',
    _MILI: 'military',
    MILI: 'military',
};

/** An EVEN TYPE that names military service, in any language the app speaks. */
function isMilitaryLabel(label: string): boolean {
    const key = label.trim().toLowerCase();
    if (!key) return false;
    return (['en', 'cs', 'de'] as const).some(lang =>
        getStringsForLang(lang).events.types.military.toLowerCase() === key)
        || key === 'military';
}

/**
 * Standard GEDCOM facts the model has no field for.
 *
 * They are folded into the person's or the couple's note, labelled, instead of
 * being dropped. Giving each its own field or event would mean carrying a
 * subsystem for facts that appear once in a hundred files; losing them means a
 * GEDCOM from another program arrives quietly poorer than it left. A labelled
 * line in the note is the honest middle: nothing disappears, and it is written
 * where a reader looks for context.
 *
 * Deliberately absent: ANCI, DESI, RFN, AFN, RESN and the platform sync ids.
 * Those are bookkeeping of the program that wrote the file, not something a
 * register ever said about a person.
 */
const NOTED_INDI_TAGS = new Set(['BLES', 'RETI', 'CAST', 'DSCR', 'IDNO', 'NCHI',
    'NMR', 'PROP', 'SSN', 'FACT', 'ALIA']);
const NOTED_FAM_TAGS = new Set(['MARB', 'MARC', 'MARL', 'MARS', 'ANUL', 'DIVF',
    'CENS', 'EVEN', 'NCHI', 'RESI']);

/** A fact being read: its value on the tag line, its date and place below it. */
interface RawNoteFact {
    tag: string;
    value: string;
    date: string;
    place: string;
}

/**
 * "Banns: 3. 5. 1886 · Lučice" — the label in the app's language, then whatever
 * the file gave. A fact with nothing at all still earns its line: the register
 * said it happened, and that is the fact.
 */
function factToNoteLine(fact: RawNoteFact): string {
    const label = strings.gedcomNotes.factLabels[fact.tag] ?? fact.tag;
    const parts = [fact.value, formatFlexDate(fact.date), fact.place]
        .map(x => x?.trim()).filter((x): x is string => !!x);
    return parts.length > 0 ? `${label}: ${parts.join(' · ')}` : label;
}

/**
 * A level-2 line under such a fact. TYPE names what a generic FACT/EVEN is
 * about, so it reads better as the value than the bare word "Fact"; a NOTE
 * written under it joins the same line rather than starting a stray one, and
 * so does an ADDR (the house a family lived in: "Residence: čp. 12 · 1910").
 */
function attachToFact(fact: RawNoteFact, tag: string, value: string): void {
    if (tag === 'DATE') fact.date = parseGedcomDate(value);
    else if (tag === 'PLAC') fact.place = value;
    else if ((tag === 'TYPE' || tag === 'NOTE' || tag === 'ADDR') && value) {
        fact.value = fact.value ? `${fact.value} · ${value}` : value;
    }
}

/**
 * A GEDCOM AGE value in words: "27y 3m" -> "27 let 3 měsíce", "<1y" ->
 * "<1 rok", INFANT -> "kojenec". A bare number is years (several programs drop
 * the unit); anything else is kept as written rather than guessed at.
 */
function formatGedcomAge(raw: string): string {
    const v = raw.trim();
    const word = strings.gedcomNotes.ageWords[v.toUpperCase()];
    if (word) return word;
    const bare = v.match(/^([<>])?\s*(\d+)$/);
    if (bare) return `${bare[1] ?? ''}${strings.gedcomNotes.ageUnit(Number(bare[2]), 'y')}`;
    const m = v.match(/^([<>])?\s*(?:(\d+)\s*y)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*d)?$/i);
    if (!m || (!m[2] && !m[3] && !m[4])) return v;
    const parts: string[] = [];
    if (m[2]) parts.push(strings.gedcomNotes.ageUnit(Number(m[2]), 'y'));
    if (m[3]) parts.push(strings.gedcomNotes.ageUnit(Number(m[3]), 'm'));
    if (m[4]) parts.push(strings.gedcomNotes.ageUnit(Number(m[4]), 'd'));
    return `${m[1] ?? ''}${parts.join(' ')}`;
}

/**
 * The note line for a date written in another calendar ("@#DJULIAN@ 12 MAR
 * 1875"), or null for a Gregorian one. The date field itself keeps the numbers
 * as written — there is no calendar in the model — so without this line a
 * Julian date would pass for a Gregorian one without a word.
 */
function calendarNoteLine(raw: string): string | null {
    const m = raw.match(/@#D([^@]+)@/i);
    if (!m) return null;
    const calendar = m[1].trim().toUpperCase();
    if (calendar === 'GREGORIAN' || calendar === 'UNKNOWN') return null;
    const date = raw.replace(/@#D[^@]*@\s*/gi, '').trim();
    return strings.gedcomNotes.calendarDate(strings.gedcomNotes.calendars[calendar] ?? calendar, date);
}

/**
 * CHIL > _FREL / _MREL -> the child's relationship to that parent. 'biological'
 * is said explicitly (it overrides a PEDI covering both parents); undefined
 * means the file does not say, and PEDI decides as before.
 */
function childRelType(value: string | undefined): ParentChildRelType | undefined {
    switch ((value ?? '').trim().toLowerCase()) {
        case 'natural': case 'birth': case 'biological': return 'biological';
        case 'adopted': return 'adoptive';
        case 'step': return 'step';
        case 'foster': return 'foster';
        default: return undefined;
    }
}

/** Set (or, for 'biological', clear) a child's relationship to one parent. */
function setParentRel(child: Person, parentId: PersonId, rel: ParentChildRelType | undefined): void {
    if (!rel) return;
    if (rel === 'biological') {
        if (child.parentRelTypes) {
            delete child.parentRelTypes[parentId];
            if (Object.keys(child.parentRelTypes).length === 0) delete child.parentRelTypes;
        }
        return;
    }
    (child.parentRelTypes ??= {})[parentId] = rel;
}

/** Embedded portraits: raster images only. */
const SAFE_PHOTO_DATA_URL = /^data:image\/(jpeg|png|webp|gif);base64,/i;
/** Embedded documents: the same images, or a PDF. */
const SAFE_ATTACHMENT_DATA_URL = /^data:(image\/(jpeg|png|webp|gif)|application\/pdf);base64,/i;

/** Raw OBJE media object under an individual. */
interface RawMedia {
    /** _PRIM / _PERSONALPHOTO Y — preferred as the person's portrait. */
    primary?: boolean;
    title: string;
    form: string;
    file: string;
    /** Custom marker: 'photo' = the person's portrait (Strom extension). */
    stromKind: string;
    /** NOTE on the media link (attachment note). */
    note?: string;
    /** _SOUR @Sx@ — the source the scan belongs to (Strom extension). */
    sourceXref?: string;
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
    /** `1 EVEN value`: the value on the tag line, kept when a TYPE takes the label. */
    tagValue?: string;
}

/**
 * A _STORY block as it comes out of the file. TITL, TEXT, DATA and NOTE are
 * glued from their continuation lines by pure concatenation: CONC appends
 * directly (a long line that did not fit), CONT appends a newline first (a
 * break that is really in the text). Telling the two apart is the whole point —
 * if everything came back as CONT, every pass through the app would reflow the
 * prose a little more.
 */
interface RawStory {
    kind: string;
    title: string;
    stat: string;
    text: string;
    facts: string[];
    note: string;
}

const newStory = (): RawStory =>
    ({ kind: '', title: '', stat: '', text: '', facts: [], note: '' });

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
    /** ABBR: the short title, used when the record has no TITL. */
    abbr?: string;
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
    /**
     * NAME > TYPE of the primary name and of each variant (same index as
     * nameVariants). Read for one purpose only: a married name the file put
     * first must not take the place of the birth surname the model keeps.
     */
    primaryNameType: string;
    variantNameTypes: string[];
    sex: string;
    birthDate: string;
    birthPlace: string;
    deathDate: string;
    deathPlace: string;
    notes: string;
    /** User reference number (1 REFN) — id in a paper archive / other program. */
    refn: string;
    /** Strom's open question about the person (1 _QUESTION). */
    question: string;
    /** REFN > TYPE: who issued the number. */
    refnType: string;
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
    /** Standard facts with no field of their own — folded into the note. */
    noteFacts: RawNoteFact[];
    /** The person's narrative (1 _STORY), when the file carries one. */
    story?: RawStory;
    /**
     * Godparents / informants named under 1 BIRT and 1 DEAT. Birth and death
     * are fields, not events, so these are re-homed on conversion: onto the
     * baptism / burial event when the file gives one, otherwise onto a
     * "birth record" / "death record" event created for them.
     */
    birthParticipants: RawParticipant[];
    deathParticipants: RawParticipant[];
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
    /** Standard facts with no field of their own — folded into the note. */
    noteFacts: RawNoteFact[];
    /** 1 SOUR citations on the family (marriage record etc.). */
    sourceRefs: string[];
    /** Witnesses named under 1 MARR (2 ASSO / 2 _WITN). */
    marriageParticipants: RawParticipant[];
    /**
     * CHIL > _FREL / _MREL: the child's relationship to the father and to the
     * mother separately (Legacy, RootsMagic, FTM). PEDI sits on the child's
     * FAMC and covers both parents at once, so it cannot say "stepfather,
     * own mother" — the most common case in a remarried household.
     */
    childRels: Map<string, { frel?: string; mrel?: string }>;
    /** The couple's narrative (1 _STORY). */
    story?: RawStory;
    /** 1 _STAT: the relationship status as written (Married, Partners …). */
    stat?: string;
    /** The CHIL line being read (its _FREL/_MREL follow it). */
    lastChil?: string;
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
    /** Coordinates read from PLAC > MAP > LATI/LONG, keyed by placeKey(). */
    places: Map<string, PlaceGeo>;
    /** Surname-variant groups read from the header NOTE (see exporter marker). */
    surnameGroups: string[][];
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
        /** Human-readable breakdown, e.g. "TITL ×3, SSN ×2". Empty when none. */
        droppedTagSummary: string;
        /** Individuals with SEX other than M/F (gender inferred from family role). */
        unknownSexPersons: number;
        /**
         * Children recorded in more than one family (born to one, adopted into
         * another). The tree draws one set of parents; the others became a note
         * on the child.
         */
        otherFamilyLinks: number;
        /** Embedded media skipped because of their type (only images and PDFs come in). */
        skippedMedia: number;
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
    return readGedcomDate(dateStr).date;
}

/**
 * The part of a GEDCOM date the date field cannot hold, to be kept as a note
 * line — or null when the date was read whole. A date phrase ("INT 1900 (per
 * census)", "(about Easter 1900)") gives its phrase; a date that was only
 * partly understood ("3 XYZ 1900" keeps just the year) gives the value as
 * written, so what the record said is never silently narrowed.
 */
export function gedcomDatePhrase(dateStr: string): string | null {
    const read = readGedcomDate(dateStr);
    if (!read.phrase && !read.lossy) return null;
    // A bare phrase is given as its words; a phrase riding on a date, or a
    // date read only in part, as the whole value — the context matters.
    if (read.phrase && !read.date) return read.phrase;
    return dateStr.replace(/@#D[^@]*@\s*/gi, '').trim() || null;
}

const YEAR_RE = /^\d{3,4}$/;

function readGedcomDate(dateStr: string): { date: string; lossy: boolean; phrase: string } {
    if (!dateStr || !dateStr.trim()) return { date: '', lossy: false, phrase: '' };

    // Calendar escape (@#DJULIAN@, @#DGREGORIAN@ …): the calendar itself has
    // no representation here, but the date after it is an ordinary date —
    // strip the escape and keep the date instead of parsing the whole line
    // to '' (which silently lost every pre-1752 Julian date).
    dateStr = dateStr.trim().replace(/^@#D[^@]*@\s*/i, '');

    // A date phrase in parentheses — the whole value ("(about Easter 1900)")
    // or the tail of an interpreted date ("INT 1900 (per census)"). The phrase
    // is the record's own words; the date in front of it, if any, is read.
    let phrase = '';
    const withPhrase = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(dateStr);
    if (withPhrase) {
        phrase = withPhrase[2].trim();
        dateStr = withPhrase[1].trim();
        if (!dateStr) return { date: '', lossy: !phrase, phrase };
    }

    // Ranges/periods: BET X AND Y, FROM X TO Y -> 'x..y' (both bounds kept —
    // previously these were mangled and the information silently lost).
    // One-sided periods degrade to qualifiers: FROM X -> '>x', TO Y -> '<y'.
    const range = /^(BET|BETWEEN|FROM)\s+(.+?)\s+(AND|TO)\s+(.+)$/i.exec(dateStr.trim());
    if (range) {
        const a = readGedcomDate(range[2]);
        const b = readGedcomDate(range[4]);
        const lossy = a.lossy || b.lossy;
        if (a.date && b.date && !/^[~<>]/.test(a.date) && !/^[~<>]/.test(b.date)) {
            return { date: `${a.date}..${b.date}`, lossy, phrase };
        }
        return { date: a.date || b.date || '', lossy: true, phrase };
    }
    const oneSided = /^(FROM|TO)\s+(.+)$/i.exec(dateStr.trim());
    if (oneSided) {
        const d = readGedcomDate(oneSided[2]);
        if (d.date && !/^[~<>]/.test(d.date)) {
            return { date: `${oneSided[1].toUpperCase() === 'FROM' ? '>' : '<'}${d.date}`, lossy: d.lossy, phrase };
        }
        return { date: d.date, lossy: true, phrase };
    }

    // Qualifier prefixes map to flex-date qualifiers instead of being dropped.
    // INT (interpreted) is an approximation of what the phrase says.
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
    const parts = cleaned.split(/\s+/).filter(Boolean).map(p => p.replace(/^(\d{3,4})\/\d{1,2}$/, '$1'));
    const monthOf = (p: string | undefined): string | undefined => p ? MONTHS[p.toUpperCase()] : undefined;
    const lastIsYear = parts.length > 0 && YEAR_RE.test(parts[parts.length - 1]);

    if (parts.length === 3 && monthOf(parts[1]) && /^\d{1,2}$/.test(parts[0])
        && +parts[0] >= 1 && +parts[0] <= 31 && lastIsYear) {
        // "3 JUN 1900" -> "1900-06-03"
        return { date: `${qualifier}${parts[2]}-${monthOf(parts[1])}-${parts[0].padStart(2, '0')}`, lossy: false, phrase };
    } else if (parts.length === 2 && monthOf(parts[0]) && lastIsYear) {
        // "JUN 1900" -> "1900-06" (month precision, no fabricated day)
        return { date: `${qualifier}${parts[1]}-${monthOf(parts[0])}`, lossy: false, phrase };
    } else if (parts.length === 1 && lastIsYear) {
        // "1900" -> "1900" (year precision, no fabricated month/day)
        return { date: `${qualifier}${parts[0]}`, lossy: false, phrase };
    } else if (lastIsYear) {
        // A day or month that is not a GEDCOM one ("3 XYZ 1900"): the year is
        // certain, the rest is not — keep the year, never invent a month.
        return { date: `${qualifier}${parts[parts.length - 1]}`, lossy: true, phrase };
    }
    return { date: '', lossy: parts.length > 0, phrase };
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

/** A cross-reference pointer value (@I1@, @N12@ …). */
const GED_POINTER = /^@[^@\s]+@$/;

/** One physical GEDCOM line, split into its parts. */
interface GedLine {
    level: number;
    tag: string;
    value: string;
}

/**
 * Values that may run over several physical lines (CONC joins, CONT breaks)
 * although the reader below takes them from their own line only: a long place,
 * name, witness, citation page, web address or label. Joined up front, so a
 * value split to respect the 255-byte line limit reads back whole.
 */
const JOINED_VALUE_TAGS = new Set(['PLAC', 'NAME', '_WITN', 'WITN', 'PAGE', 'WWW', 'URL', 'REFN', 'TYPE', 'SOUR', '_QUESTION']);

/**
 * Split the file into lines and do the reading that needs the whole file:
 * - join continuation lines of JOINED_VALUE_TAGS into their value;
 * - collect shared note records (0 @N1@ NOTE text + CONT/CONC; GEDCOM 7
 *   SNOTE), which may be defined after the records pointing at them;
 * - turn an inline source (`1 SOUR free text`, no pointer) into a pointer at
 *   a source record made for it, so the reader treats it like any citation.
 *   The same text twice is one source.
 */
function preprocessGedcomLines(lines: string[]): {
    records: GedLine[];
    noteRecords: Map<string, string>;
    inlineSources: Map<string, string>;
} {
    const parsed: GedLine[] = [];
    for (const line of lines) {
        const match = line.match(/^(\d+)\s+(@[^@\s]+@|\w+)\s*(.*)?$/);
        if (!match) continue;
        let tag = match[2];
        // GEDCOM escapes a literal '@' as '@@' (pointers never contain it).
        const value = (match[3] || '').trim().replace(/@@/g, '@');
        // GEDCOM 7 shared-note pointer: the same thing as a NOTE pointer.
        if (tag === 'SNOTE' && GED_POINTER.test(value)) tag = 'NOTE';
        parsed.push({ level: parseInt(match[1]), tag, value });
    }

    const noteRecords = new Map<string, string>();
    const inlineSources = new Map<string, string>();
    const inlineByText = new Map<string, string>();
    const records: GedLine[] = [];
    let inHead = false;
    for (let i = 0; i < parsed.length; i++) {
        const rec = parsed[i];
        if (rec.level === 0) inHead = rec.tag === 'HEAD';
        // 0 @N1@ NOTE text / 1 CONT … / 1 CONC …
        if (rec.level === 0 && GED_POINTER.test(rec.tag)) {
            const m = /^(NOTE|SNOTE)(?:\s+(.*))?$/.exec(rec.value);
            if (m) {
                let text = m[2] ?? '';
                while (i + 1 < parsed.length && parsed[i + 1].level === 1
                    && (parsed[i + 1].tag === 'CONT' || parsed[i + 1].tag === 'CONC')) {
                    const next = parsed[++i];
                    text += (next.tag === 'CONT' ? '\n' : '') + next.value;
                }
                noteRecords.set(rec.tag, text);
                records.push({ level: 0, tag: rec.tag, value: m[1] });
                continue;
            }
        }
        if (rec.level > 0 && JOINED_VALUE_TAGS.has(rec.tag)) {
            let value = rec.value;
            while (i + 1 < parsed.length && parsed[i + 1].level === rec.level + 1
                && (parsed[i + 1].tag === 'CONC' || parsed[i + 1].tag === 'CONT')) {
                const next = parsed[++i];
                value += (next.tag === 'CONT' ? '\n' : '') + next.value;
            }
            if (rec.tag === 'SOUR' && !inHead && value && !GED_POINTER.test(value)) {
                let id = inlineByText.get(value);
                if (!id) {
                    id = `@__inlineSour${inlineByText.size}__@`;
                    inlineByText.set(value, id);
                    inlineSources.set(id, value);
                }
                value = id;
            }
            records.push({ level: rec.level, tag: rec.tag, value });
            continue;
        }
        records.push(rec);
    }
    return { records, noteRecords, inlineSources };
}

/**
 * Parse GEDCOM file content into structured data
 */
/** Level-1 INDI tags the parser understands (everything else is counted as dropped). */
const KNOWN_INDI_TAGS = new Set(['NAME', 'SEX', 'FAMS', 'FAMC', 'NOTE', 'SOUR', 'BIRT', 'DEAT', 'OBJE', 'REFN', 'ASSO', '_STORY', '_QUESTION',
    ...Object.keys(EVENT_TAG_TO_TYPE)]);
/** Level-1 FAM tags the parser understands. */
const KNOWN_FAM_TAGS = new Set(['HUSB', 'WIFE', 'CHIL', 'NOTE', 'MARR', 'DIV', 'SOUR', '_STORY', '_STAT']);
/** Level-0 record types (handled or structural). */
/**
 * Labels for ALTERNATIVE birth/death facts. Platforms (MyHeritage) allow several
 * BIRT/DEAT records per person; the first fills the dedicated date fields and
 * the rest are kept as labelled CUSTOM events — 'birth'/'death' event types are
 * reserved for the date fields (validation flags them as a data-entry mistake).
 */
// Labels are read from strings at USE time (not module load) so the note lands
// in the app's current language — see each call site.

const KNOWN_RECORD_TYPES = new Set(['INDI', 'FAM', 'SOUR', 'REPO', 'HEAD', 'TRLR', 'SUBM', 'SUBN', 'NOTE', 'SNOTE']);

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

/**
 * 1 _STAT (Strom's own tag, also written by Legacy and FTM in similar words)
 * -> the relationship status, or undefined for a value it does not name.
 * MARR/DIV can only say married or divorced; partners and separated need it.
 */
function statusFromStat(value: string | undefined): PartnershipStatus | undefined {
    const v = (value ?? '').trim().toLowerCase();
    if (!v) return undefined;
    if (v === 'married') return 'married';
    if (v === 'divorced') return 'divorced';
    if (v === 'separated') return 'separated';
    if (['partners', 'partner', 'unmarried', 'unmarried couple', 'never married',
        'cohabiting', 'living together', 'domestic partnership'].includes(v)) return 'partners';
    return undefined;
}

/** Put the resolved marriage/divorce outcome onto a partnership. */
function applyUnionOutcome(partnership: Partnership, fam: GedcomFamily): void {
    const outcome = resolveUnionStatus(fam);
    if (outcome.startDate) partnership.startDate = outcome.startDate;
    if (outcome.endDate) partnership.endDate = outcome.endDate;
    // An explicit status wins over what MARR/DIV imply: a couple of partners
    // whose start date rides on MARR (the only place for it) is not married.
    partnership.status = statusFromStat(fam.stat) ?? outcome.status;
    if (outcome.remarriage) {
        const { divorced, married } = outcome.remarriage;
        const line = divorced
            ? strings.gedcomNotes.remarriage(divorced, married)
            : strings.gedcomNotes.remarriageNoDate(married);
        partnership.note = partnership.note ? `${partnership.note}\n${line}` : line;
    }
}

/**
 * A GEDCOM 5.5.1 coordinate ("N50.088", "W14.421") or a bare signed number back
 * to a plain degree value. Returns null for anything unparseable so a malformed
 * MAP block is skipped rather than poisoning the place with NaN.
 */
function parseGedcomCoord(raw: string): number | null {
    const m = /^([NSEW])?\s*(-?\d+(?:\.\d+)?)$/i.exec(raw.trim());
    if (!m) return null;
    let value = parseFloat(m[2]);
    if (!Number.isFinite(value)) return null;
    const hemi = m[1]?.toUpperCase();
    if (hemi === 'S' || hemi === 'W') value = -value;
    return value;
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
    /** The 1 _STORY block currently open, and the level-2 tag inside it. */
    let currentStory: RawStory | null = null;
    let currentStorySubTag: string | null = null;
    /**
     * Level-2 tag inside a BIRT/DEAT (INDI) or MARR (FAM) block — the facts the
     * model stores as fields rather than events, so they have no RawEvent to
     * hang level-3 lines (PAGE, RELA, CONT) on.
     */
    let currentFactSubTag: string | null = null;
    let currentSource: RawSource | null = null;
    /** Which name the current 1 NAME line was: -1 the primary, else its variant index. */
    let currentNameSlot: number | null = null;
    let currentMedia: RawMedia | null = null;
    /** Level-2 tag inside the current OBJE (for level-3 FILE continuations). */
    let currentMediaSubTag: string | null = null;
    /** @Sx@ of the most recent citation (PAGE lines attach to it). */
    let currentCitationId: string | null = null;
    /** 0 @Rx@ REPO record currently open. */
    let currentRepoId: string | null = null;
    /**
     * Where a detail line under the current fact goes: the event's note, the
     * person's note labelled "Birth:"/"Death:" (birth and death are fields,
     * with no note of their own), or the couple's note for a marriage. Null
     * where no fact is open — a detail line there has no fact to belong to.
     */
    const factDetailSink = (): ((line: string) => void) | null => {
        const join = (text: string, line: string): string => text ? `${text}\n${line}` : line;
        if (currentType === 'INDI' && currentRecord) {
            const indi = currentRecord as GedcomIndividual;
            const ev = currentEvent;
            if (ev) {
                return line => {
                    // For OCCU/RELI/… the note IS the fact; an empty one must
                    // not be taken over by a detail line, so it goes to the person.
                    if (!ev.note && eventValueIsOnTag(ev.type)) indi.notes = join(indi.notes, line);
                    else ev.note = join(ev.note ?? '', line);
                };
            }
            if (currentSubTag === 'BIRT') return line => { indi.notes = join(indi.notes, strings.gedcomNotes.birthNote(line)); };
            if (currentSubTag === 'DEAT') return line => { indi.notes = join(indi.notes, strings.gedcomNotes.deathNote(line)); };
        } else if (currentType === 'FAM' && currentRecord
            && (currentSubTag === 'MARR' || currentSubTag === 'DIV' || currentSubTag === 'ENGA')) {
            const fam = currentRecord as GedcomFamily;
            return line => { fam.note = join(fam.note, line); };
        }
        return null;
    };
    /**
     * A detail line being read (AGE, CAUS, ADDR under a fact), open until the
     * next line at its own level or above, so its CONT/CONC lines join it.
     */
    let openDetail: { level: number; text: string; format: (text: string) => string; sink: (line: string) => void; sep: string } | null = null;
    const flushDetail = (): void => {
        const text = openDetail?.text.trim();
        if (openDetail && text) openDetail.sink(openDetail.format(text));
        openDetail = null;
    };
    /** Coordinates gathered from PLAC > MAP > LATI/LONG, keyed by placeKey(). */
    const placeCoords = new Map<string, PlaceGeo>();
    /** The PLAC value a MAP substructure is currently describing. */
    let currentPlaceValue: string | null = null;
    /** Inside the 0 HEAD record (its NOTE may carry surname-variant groups). */
    let inHeader = false;
    /** The current header NOTE is the surname-groups marker note. */
    let inSurnameNote = false;
    const surnameGroups: string[][] = [];

    const { records: gedLines, noteRecords, inlineSources } = preprocessGedcomLines(lines);

    for (const rec of gedLines) {
        const level = rec.level;
        const tag = rec.tag;
        let value = rec.value;
        // A pointer to a shared note record (1 NOTE @N1@, GEDCOM 7 SNOTE) reads
        // as the note's text wherever a NOTE may stand. A pointer to a note the
        // file never defines says nothing and is read as an empty note.
        if (tag === 'NOTE' && level > 0 && GED_POINTER.test(value)) {
            value = noteRecords.get(value) ?? '';
        }

        // Place coordinates ride under a PLAC as MAP > LATI/LONG. They can hang
        // off a person's birth/death, an event or a marriage, so they are read
        // here — before the per-record dispatch — against the most recent PLAC.
        if (level <= 1) currentPlaceValue = null;
        if (level === 2 && tag === 'PLAC' && value) currentPlaceValue = value;
        if ((level === 3 && tag === 'MAP')
            || (level === 4 && (tag === 'LATI' || tag === 'LONG'))) {
            if (level === 4 && currentPlaceValue) {
                const coord = parseGedcomCoord(value);
                if (coord !== null) {
                    const key = placeKey(currentPlaceValue);
                    const entry = placeCoords.get(key) ?? { lat: NaN, lon: NaN, label: currentPlaceValue };
                    if (tag === 'LATI') entry.lat = coord; else entry.lon = coord;
                    placeCoords.set(key, entry);
                }
            }
            continue;
        }

        // Detail lines under a fact — the age the register gives, the cause of
        // death, the house (ADDR), a date in another calendar. The model has no
        // field for any of them, and dropping them lost exactly what a register
        // entry is read for: an age at death dates a birth nobody recorded, a
        // house number ties a family together. Each becomes one labelled line
        // in the fact's note. Read before the per-record dispatch, which never
        // looks at these tags.
        if (openDetail) {
            if (level > openDetail.level && (tag === 'CONT' || tag === 'CONC')) {
                openDetail.text += (tag === 'CONT' ? openDetail.sep : '') + value;
                continue;
            }
            if (level <= openDetail.level) flushDetail();
        }
        if (level === 2 && (tag === 'AGE' || tag === 'CAUS' || tag === 'ADDR' || tag === 'DATE')) {
            const sink = factDetailSink();
            if (sink && tag === 'DATE') {
                const line = calendarNoteLine(value);
                if (line) sink(line);
                // The words the date field cannot hold ("INT 1900 (per
                // census)", "3 XYZ 1900") stay with the fact, as written.
                const phrase = gedcomDatePhrase(value);
                if (phrase) sink(strings.gedcomNotes.datePhrase(phrase));
            } else if (sink) {
                // ADDR: only its own value and CONT lines. ADR1/CITY/POST
                // repeat the place or carry junk ("ADR1 Email", MyHeritage).
                const g = strings.gedcomNotes;
                const format = tag === 'AGE' ? (t: string) => g.age(formatGedcomAge(t))
                    : tag === 'CAUS' ? g.cause : g.address;
                openDetail = { level, text: value, format, sink, sep: tag === 'ADDR' ? ', ' : '\n' };
            }
        } else if (level === 3 && tag === 'AGE' && currentType === 'FAM' && currentSubTag === 'MARR'
            && (currentFactSubTag === 'HUSB' || currentFactSubTag === 'WIFE')) {
            // 1 MARR / 2 HUSB / 3 AGE 25y — each partner's age at the wedding.
            const sink = factDetailSink();
            const g = strings.gedcomNotes;
            const label = currentFactSubTag === 'HUSB' ? g.husbandAge : g.wifeAge;
            if (sink) openDetail = { level, text: value, format: t => label(formatGedcomAge(t)), sink, sep: ' ' };
        }

        if (level === 0) {
            // What KIND of record this is comes from the type word, never from
            // the shape of the id. An xref is an opaque label: nothing obliges a
            // program to number its people @I1@, and some use @P1@ or @1@.
            // Requiring the '@I' prefix silently imported those files as an
            // empty tree — a whole GEDCOM lost without a word of warning.
            // A record with no xref at all (legal in GEDCOM 7) still holds a
            // person, so it gets an internal id nothing can point at.
            const hasXref = /^@[^@]+@$/.test(tag);
            // The type is the first word: a NOTE record carries its text on the
            // same line (0 @N1@ NOTE text), which is not part of the type — and
            // must never reach the unsupported-tag summary.
            const recordType = hasXref ? value.split(/\s+/)[0] : tag;
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
                    question: '',
                    refnType: '',
                    events: [],
                    nameVariants: [],
                    primaryNameType: '',
                    variantNameTypes: [],
                    sourceRefs: [],
                    media: [],
                    deceased: false,
                    birthSeen: false,
                    deathSeen: false,
                    fams: [],
                    assos: [],
                    noteFacts: [],
                    birthParticipants: [],
                    deathParticipants: [],
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
                    sourceRefs: [],
                    marriageParticipants: [],
                    childRels: new Map(),
                    noteFacts: []
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
            currentFactSubTag = null;
            currentStory = null;
            currentStorySubTag = null;
            currentMedia = null;
            currentMediaSubTag = null;
            currentCitationId = null;
            currentPlaceValue = null;
            inHeader = recordType === 'HEAD';
            inSurnameNote = false;
            if (recordType !== 'REPO') currentRepoId = null;
        } else if (inHeader) {
            // Header sub-lines. The only one we read is the surname-groups NOTE
            // (see the exporter's SURNAME_GROUPS_MARKER); everything else in the
            // header is bookkeeping the data model does not carry.
            if (level === 1) {
                inSurnameNote = tag === 'NOTE' && value.trim() === SURNAME_GROUPS_MARKER;
            } else if (level === 2 && inSurnameNote && (tag === 'CONT' || tag === 'CONC')) {
                const group = value.split(SURNAME_GROUP_SEP.trim())
                    .map(s => s.trim()).filter(Boolean);
                if (group.length >= 2) surnameGroups.push(group);
            }
        } else if (currentRepoId !== null && level === 1 && tag === 'NAME') {
            repositories.set(currentRepoId, value);
        } else if (currentType === 'SOUR' && currentSource) {
            // Source record sub-lines. reference <- PAGE (spec mapping).
            //
            // The source has one note, and everything the record says that has
            // no field of its own lands there: every NOTE (a second one used to
            // overwrite the first), the transcript (TEXT), the publication
            // (PUBL), the author (AUTH) and the call number the repository
            // files it under (REPO > CALN) — each labelled, each with its
            // continuation lines. Writing the tail of a TEXT nowhere kept the
            // first line of a transcript and lost the rest.
            const src = currentSource;
            const addLine = (line: string, sep: string): void => {
                src.note = src.note ? `${src.note}${sep}${line}` : line;
            };
            const plain = (text: string): string =>
                currentSubTag === 'TEXT' || currentSubTag === 'PUBL' ? text.replace(/<[^>]*>/g, '') : text;
            if (level === 1) {
                currentSubTag = tag;
                if (tag === 'TITL') src.title = value;
                else if (tag === 'REPO') src.repository = value;
                else if (tag === 'PAGE') src.reference = value;
                else if (tag === 'PUBL' || tag === 'TEXT' || tag === 'AUTH') {
                    const label = tag === 'TEXT' ? strings.gedcomNotes.sourceText
                        : tag === 'PUBL' ? strings.gedcomNotes.sourcePublication
                        : strings.gedcomNotes.sourceAuthor;
                    // A transcript is a block of its own, set apart like a NOTE.
                    addLine(label(plain(value).trim()).trimEnd(), tag === 'TEXT' ? '\n\n' : '\n');
                }
                else if (tag === 'QUAY') { const q = parseInt(value, 10); if (q >= 0 && q <= 3) src.quality = q; }
                else if (tag === 'WWW' || tag === 'URL') src.url = value;
                // Separate notes stay separate: a blank line between them. A
                // NOTE whose text starts on its CONT line opens with one break
                // fewer, since that CONT brings its own.
                else if (tag === 'NOTE') addLine(value, value ? '\n\n' : '\n');
                // The short title some programs write beside (or instead of)
                // TITL: the title when there is no other.
                else if (tag === 'ABBR') src.abbr = value;
                // Anything else on the record (DATA, OBJE, REFN …) reached us
                // and was not read — the contract says so, and so does the summary.
                else if (!IGNORED_BOOKKEEPING_TAGS.has(tag)) drop(tag);
            } else if (level === 2) {
                // Multi-line continuations for title / note / the labelled lines.
                if (currentSubTag === 'TITL') {
                    if (tag === 'CONT') src.title += '\n' + value;
                    else if (tag === 'CONC') src.title += value;
                } else if (currentSubTag === 'NOTE' || currentSubTag === 'TEXT'
                    || currentSubTag === 'PUBL' || currentSubTag === 'AUTH') {
                    if (tag === 'CONT') src.note += (src.note ? '\n' : '') + plain(value);
                    else if (tag === 'CONC') src.note += plain(value);
                } else if (currentSubTag === 'REPO' && tag === 'CALN' && value) {
                    addLine(strings.gedcomNotes.sourceCallNumber(value), '\n');
                }
            }
        } else if (currentRecord) {
            if (level === 1) {
                currentSubTag = tag;
                currentEvent = null;
                currentEventSubTag = null;
                currentFactSubTag = null;
                currentStory = null;
                currentStorySubTag = null;
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
                                currentNameSlot = null;
                                if (value.trim()) {
                                    indi.nameVariants.push(value.trim());
                                    indi.variantNameTypes.push('');
                                    currentNameSlot = indi.nameVariants.length - 1;
                                }
                                break;
                            }
                            currentNameSlot = -1;
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
                            // A person may carry several 1 NOTE lines; assigning kept
                            // only the last one (44 records in one register file).
                            indi.notes = indi.notes ? `${indi.notes}\n${value}` : value;
                            break;
                        case 'REFN':
                            indi.refn = value;
                            break;
                        case '_QUESTION':
                            // Strom's own tag: the open question about this
                            // person, CONT/CONC joined (see preprocessGedcomLines).
                            indi.question = value;
                            break;
                        case '_STORY':
                            // The narrative written about this person. Not a
                            // source and not a note — its own structure.
                            indi.story = newStory();
                            currentStory = indi.story;
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
                                const ev: RawEvent = { type: 'custom', customLabel: strings.gedcomNotes.altBirth };
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
                                const ev: RawEvent = { type: 'custom', customLabel: strings.gedcomNotes.altDeath };
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
                                // Some facts ride on the tag's own line
                                // (`1 OCCU blacksmith`); the rest hang their
                                // detail on level-2 sub-lines.
                                if (value && eventValueIsOnTag(evType)) ev.note = value;
                                // `1 _MILT Army`: the service itself, kept as the note.
                                else if (value && evType === 'military' && value !== 'Y') ev.note = value;
                                indi.events.push(ev);
                                currentEvent = ev;
                            } else if (tag === 'EVEN' || tag === 'CENS') {
                                // Generic events (1 EVEN + 2 TYPE label) and
                                // censuses become CUSTOM events — a register-
                                // harvested GEDCOM loses nothing here.
                                const ev: RawEvent = {
                                    type: 'custom',
                                    customLabel: tag === 'CENS'
                                        ? strings.gedcomNotes.census
                                        : (value || strings.gedcomNotes.genericEvent),
                                    ...(tag === 'EVEN' && value ? { tagValue: value } : {}),
                                };
                                indi.events.push(ev);
                                currentEvent = ev;
                            } else if (NOTED_INDI_TAGS.has(tag)) {
                                // No field of its own, but the register said it:
                                // keep it as a labelled line in the note.
                                indi.noteFacts.push({ tag, value, date: '', place: '' });
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
                            // The same child listed twice is one child.
                            if (value && !fam.children.includes(value)) fam.children.push(value);
                            fam.lastChil = value;
                            break;
                        case '_STAT':
                            // Strom's relationship status (see resolveStatTag).
                            fam.stat = value;
                            break;
                        case 'NOTE':
                            fam.note = fam.note ? `${fam.note}\n${value}` : value;
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
                        case '_STORY':
                            fam.story = newStory();
                            currentStory = fam.story;
                            break;
                        case 'ENGA':
                            fam.engagementDate = value === 'Y' ? '?' : '';
                            break;
                        default:
                            if (NOTED_FAM_TAGS.has(tag)) {
                                fam.noteFacts.push({ tag, value, date: '', place: '' });
                            } else if (!KNOWN_FAM_TAGS.has(tag) && !IGNORED_BOOKKEEPING_TAGS.has(tag)) {
                                drop(tag);
                            }
                            break;
                    }
                }
            } else if (currentStory && level >= 2) {
                // 2 TYPE / TITL / STAT / TEXT / DATA / NOTE, each continued by
                // 3 CONC (same line) or 3 CONT (a real line break).
                if (level === 2) {
                    currentStorySubTag = tag;
                    switch (tag) {
                        case 'TYPE': currentStory.kind = value; break;
                        case 'TITL': currentStory.title = value; break;
                        case 'STAT': currentStory.stat = value; break;
                        case 'TEXT': currentStory.text = value; break;
                        case 'DATA': currentStory.facts.push(value); break;
                        case 'NOTE': currentStory.note = value; break;
                    }
                } else if (level === 3 && tag === 'TEXT' && currentStorySubTag === 'DATA') {
                    // `2 DATA` / `3 TEXT <fact>` — the shape GEDCOM uses for a
                    // source's DATA, and the one a writer naturally reaches for.
                    // Strom's own export puts the fact on the DATA line, so the
                    // empty DATA pushed above is filled rather than doubled.
                    const facts = currentStory.facts;
                    if (facts.length > 0 && facts[facts.length - 1] === '') {
                        facts[facts.length - 1] = value;
                    } else {
                        facts.push(value);
                    }
                } else if (level === 3 && (tag === 'CONC' || tag === 'CONT')) {
                    const glue = tag === 'CONT' ? '\n' + value : value;
                    switch (currentStorySubTag) {
                        case 'TITL': currentStory.title += glue; break;
                        case 'TEXT': currentStory.text += glue; break;
                        case 'NOTE': currentStory.note += glue; break;
                        case 'DATA':
                            if (currentStory.facts.length > 0) {
                                currentStory.facts[currentStory.facts.length - 1] += glue;
                            }
                            break;
                    }
                }
            } else if (level === 2) {
                if (currentType === 'INDI') {
                    const indi = currentRecord as GedcomIndividual;
                    if (currentSubTag === 'BIRT' || currentSubTag === 'DEAT') {
                        // Birth and death live in fields, but their block in the
                        // register carries the same detail as any event: the
                        // citation of the entry, a note, and who stood there.
                        // Reading only DATE/PLAC threw all of that away without
                        // a word — 117 citations and 52 godparents in one
                        // register-harvested file.
                        const isBirth = currentSubTag === 'BIRT';
                        currentFactSubTag = tag;
                        if (tag === 'DATE') {
                            if (isBirth) indi.birthDate = parseGedcomDate(value);
                            else indi.deathDate = parseGedcomDate(value);
                        } else if (tag === 'PLAC') {
                            if (isBirth) indi.birthPlace = value; else indi.deathPlace = value;
                        } else if (tag === 'SOUR' && value) {
                            // The birth/death entry itself: cited on the person.
                            indi.sourceRefs.push(value);
                            currentCitationId = value;
                        } else if (tag === 'NOTE' && value) {
                            const line = isBirth
                                ? strings.gedcomNotes.birthNote(value)
                                : strings.gedcomNotes.deathNote(value);
                            indi.notes = indi.notes ? `${indi.notes}\n${line}` : line;
                        } else if (tag === 'RELI' && value) {
                            // The denomination the register wrote at this act.
                            // It is not the person's own RELI attribute, so it
                            // is kept as a note labelled by the fact rather
                            // than silently promoted to a religion event.
                            const line = isBirth
                                ? strings.gedcomNotes.birthNote(value)
                                : strings.gedcomNotes.deathNote(value);
                            indi.notes = indi.notes ? `${indi.notes}\n${line}` : line;
                        } else if (tag === 'ASSO' && value) {
                            (isBirth ? indi.birthParticipants : indi.deathParticipants).push({ ref: value });
                        } else if ((tag === '_WITN' || tag === 'WITN') && value) {
                            (isBirth ? indi.birthParticipants : indi.deathParticipants)
                                .push({ name: value, rela: WITNESS_RELA });
                        }
                    } else if (currentSubTag === 'FAMC') {
                        // Pedigree type of the child→family link (adopted/foster).
                        // It belongs to the FAMC it sits under — the last one seen.
                        if (tag === 'PEDI' && indi.famcLinks.length > 0) {
                            indi.famcLinks[indi.famcLinks.length - 1].pedi = value.toLowerCase();
                        }
                    } else if (currentSubTag === 'NAME') {
                        // 2 TYPE birth/married/aka — what kind of name this is.
                        // 2 SOUR — the record the name comes from (a
                        // grandmother's maiden name is often known only from a
                        // grandchild's baptism): a citation of the person.
                        currentFactSubTag = tag;
                        if (tag === 'TYPE' && currentNameSlot !== null) {
                            const type = value.trim().toLowerCase();
                            if (currentNameSlot === -1) indi.primaryNameType = type;
                            else indi.variantNameTypes[currentNameSlot] = type;
                        } else if (tag === 'SOUR' && value) {
                            indi.sourceRefs.push(value);
                            currentCitationId = value;
                        }
                    } else if (currentSubTag === 'REFN') {
                        // Who issued the number — kept so it goes back out with it.
                        if (tag === 'TYPE') indi.refnType = value;
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
                        else if (tag === 'NOTE') currentMedia.note = value;
                        else if (tag === '_SOUR' || tag === 'SOUR') currentMedia.sourceXref = value;
                        else if ((tag === '_PRIM' || tag === '_PERSONALPHOTO') && value === 'Y') currentMedia.primary = true;
                    } else if (NOTED_INDI_TAGS.has(currentSubTag ?? '') && indi.noteFacts.length > 0) {
                        attachToFact(indi.noteFacts[indi.noteFacts.length - 1], tag, value);
                    } else if (currentSubTag === 'SOUR' && tag === 'PAGE' && currentCitationId) {
                        // Citation page: standard place for a source reference.
                        if (!citationPages.has(currentCitationId)) citationPages.set(currentCitationId, value);
                    } else if (currentSubTag === 'SOUR' && tag === 'QUAY' && currentCitationId) {
                        noteQuay(currentCitationId, value);
                    } else if (currentEvent) {
                        currentEventSubTag = tag;
                        if (tag === 'DATE') currentEvent.date = parseGedcomDate(value);
                        else if (tag === 'PLAC') currentEvent.place = value;
                        else if (tag === 'TYPE' && currentEvent.type === 'custom' && value) {
                            // 1 EVEN / 2 TYPE Rychtář — the TYPE is the label.
                            // A value on the EVEN line itself is the fact's
                            // content, not a label: it moves to the note.
                            if (isMilitaryLabel(value)) {
                                currentEvent.type = 'military';
                                delete currentEvent.customLabel;
                            } else {
                                currentEvent.customLabel = value;
                            }
                            const tagValue = currentEvent.tagValue;
                            if (tagValue) {
                                currentEvent.note = currentEvent.note ? `${tagValue}\n${currentEvent.note}` : tagValue;
                                delete currentEvent.tagValue;
                            }
                        }
                        else if (tag === 'SOUR' && value) {
                            (currentEvent.sourceRefs ??= []).push(value);
                            currentCitationId = value;
                        } else if (tag === 'NOTE') {
                            currentEvent.note = currentEvent.note
                                ? `${currentEvent.note}\n${value}` : value;
                        } else if (tag === 'CONC' || tag === 'CONT') {
                            // The value of a fact that rides on its own tag line
                            // (`1 OCCU …`) continues here when it is long or has
                            // more than one line. Without this the tail of a
                            // chunked value was read as nothing and vanished on
                            // the next import.
                            currentEvent.note = (currentEvent.note ?? '')
                                + (tag === 'CONT' ? '\n' : '') + value;
                        } else if (tag === 'EMAIL' && value) {
                            // MyHeritage keeps contact e-mail under RESI.
                            const line = strings.gedcomNotes.email(value);
                            currentEvent.note = currentEvent.note
                                ? `${currentEvent.note}\n${line}` : line;
                        } else if (tag === 'ASSO' && value) {
                            // Godparent/witness who has a record of their own.
                            (currentEvent.participants ??= []).push({ ref: value });
                        } else if ((tag === '_WITN' || tag === 'WITN') && value) {
                            // …and one who does not: just a name in the register.
                            (currentEvent.participants ??= []).push({ name: value, rela: WITNESS_RELA });
                        }
                    }
                } else if (currentType === 'FAM') {
                    const fam = currentRecord as GedcomFamily;
                    if (currentSubTag === 'SOUR' && tag === 'PAGE' && currentCitationId) {
                        if (!citationPages.has(currentCitationId)) citationPages.set(currentCitationId, value);
                    } else if (currentSubTag === 'SOUR' && tag === 'QUAY' && currentCitationId) {
                        noteQuay(currentCitationId, value);
                    } else if (currentSubTag === 'MARR') {
                        currentFactSubTag = tag;
                        if (tag === 'DATE') {
                            fam.marriageDate = parseGedcomDate(value);
                            lastUnionEvent(fam, 'marriage', fam.marriageDate);
                        }
                        // First wins: the union's startDate comes from the FIRST
                        // marriage, so its place must not drift to a later one.
                        if (tag === 'PLAC' && !fam.marriagePlace) fam.marriagePlace = value;
                        // The marriage record's own citation, note and witnesses
                        // sit here, not on the FAM — reading only DATE/PLAC lost
                        // every one of them.
                        if (tag === 'SOUR' && value) {
                            fam.sourceRefs.push(value);
                            currentCitationId = value;
                        } else if (tag === 'NOTE' && value) {
                            fam.note = fam.note ? `${fam.note}\n${value}` : value;
                        } else if (tag === 'ASSO' && value) {
                            fam.marriageParticipants.push({ ref: value });
                        } else if ((tag === '_WITN' || tag === 'WITN') && value) {
                            fam.marriageParticipants.push({ name: value, rela: WITNESS_RELA });
                        }
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
                    } else if (currentSubTag === 'CHIL' && (tag === '_FREL' || tag === '_MREL')) {
                        const child = fam.lastChil;
                        if (child) {
                            const rels = fam.childRels.get(child) ?? {};
                            if (tag === '_FREL') rels.frel = value; else rels.mrel = value;
                            fam.childRels.set(child, rels);
                        }
                    } else if (NOTED_FAM_TAGS.has(currentSubTag ?? '') && fam.noteFacts.length > 0) {
                        attachToFact(fam.noteFacts[fam.noteFacts.length - 1], tag, value);
                    }
                }
            } else if (level === 3 && currentFactSubTag
                && (currentSubTag === 'BIRT' || currentSubTag === 'DEAT' || currentSubTag === 'MARR'
                    || (currentSubTag === 'NAME' && currentFactSubTag === 'SOUR'))) {
                // Level-3 lines under the field-backed facts: the citation's
                // PAGE/QUAY, a witness's RELA/NOTE, a note's continuation.
                const indi = currentType === 'INDI' ? currentRecord as GedcomIndividual : null;
                const fam = currentType === 'FAM' ? currentRecord as GedcomFamily : null;
                const parts = indi
                    ? (currentSubTag === 'BIRT' ? indi.birthParticipants : indi.deathParticipants)
                    : fam?.marriageParticipants;
                if (currentFactSubTag === 'SOUR' && currentCitationId) {
                    if (tag === 'PAGE') {
                        if (!citationPages.has(currentCitationId)) citationPages.set(currentCitationId, value);
                    } else if (tag === 'QUAY') {
                        noteQuay(currentCitationId, value);
                    }
                } else if (currentFactSubTag === 'ASSO' || currentFactSubTag === '_WITN'
                    || currentFactSubTag === 'WITN') {
                    const last = parts?.[parts.length - 1];
                    if (last) {
                        if (tag === 'RELA') last.rela = value;
                        else if (tag === 'NOTE') last.note = value;
                    }
                } else if (currentFactSubTag === 'NOTE' && (tag === 'CONT' || tag === 'CONC')) {
                    const sep = tag === 'CONT' ? '\n' : '';
                    if (indi) indi.notes += sep + value;
                    else if (fam) fam.note += sep + value;
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
            } else if (level === 3 && currentMedia && currentMediaSubTag === 'NOTE'
                && (tag === 'CONT' || tag === 'CONC')) {
                currentMedia.note = (currentMedia.note ?? '') + (tag === 'CONT' ? '\n' : '') + value;
            } else if (level === 3 && currentType === 'INDI' && currentEvent
                && currentEventSubTag === 'SOUR' && tag === 'PAGE' && currentCitationId) {
                if (!citationPages.has(currentCitationId)) citationPages.set(currentCitationId, value);
            } else if (level === 3 && currentType === 'INDI' && currentEvent
                && currentEventSubTag === 'SOUR' && tag === 'QUAY' && currentCitationId) {
                noteQuay(currentCitationId, value);
            }
        }
    }

    // A detail line on the very last line of the file has no successor to close it.
    flushDetail();

    // A person's surname here is the birth one (a woman's maiden name). A file
    // that lists her married name first and marks another NAME as the birth
    // one would otherwise file her under her husband's surname: swap them.
    for (const indi of individuals.values()) {
        if (indi.primaryNameType !== 'married') continue;
        const k = indi.variantNameTypes.findIndex(t => t === 'birth' || t === 'maiden');
        if (k < 0) continue;
        const birthName = indi.nameVariants[k];
        indi.nameVariants[k] = indi.name;
        indi.variantNameTypes[k] = indi.primaryNameType;
        indi.name = birthName;
        indi.primaryNameType = 'birth';
        const parsed = parseName(birthName);
        indi.firstName = parsed.firstName;
        indi.lastName = parsed.lastName;
    }

    // A child the file links only from its own side (INDI > FAMC, no CHIL in
    // the FAM) is still that family's child. Listing it on the family makes
    // every reader below see one consistent structure.
    for (const indi of individuals.values()) {
        for (const link of indi.famcLinks) {
            const fam = families.get(link.famId);
            if (fam && !fam.children.includes(indi.id)) fam.children.push(indi.id);
        }
    }

    // Inline sources (`1 SOUR free text`): a source record of their own, so
    // the words the file gave as evidence are kept, and cited where they stood.
    for (const [id, text] of inlineSources) {
        sources.set(id, { id, title: text, repository: '', reference: '', url: '', note: '' });
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

    // Keep only places whose MAP carried BOTH a latitude and a longitude.
    const places = new Map<string, PlaceGeo>();
    for (const [key, geo] of placeCoords) {
        if (Number.isFinite(geo.lat) && Number.isFinite(geo.lon)) places.set(key, geo);
    }

    return { individuals, families, sources, repositories, droppedTags, places, surnameGroups };
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
    let skippedMedia = 0;

    // Build the source catalog and a GEDCOM-id -> new-id map for citations.
    const sourceIdMap = new Map<string, string>();
    const sources: Record<string, Source> = {};
    for (const [gedId, raw] of gedSources) {
        const newId = generateSourceId();
        sourceIdMap.set(gedId, newId);
        const src: Source = { id: newId, title: raw.title || raw.abbr || '?' };
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
        const noFirst = !indi.firstName || indi.firstName === '?' || indi.firstName === '//';
        const noLast = !indi.lastName || indi.lastName === '?';
        if (noFirst && noLast) placeholderPersons++;
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
        // A placeholder is someone the file gives no name at all. A surname
        // alone ("1 NAME /Nováková/") is a real, known person — treating her
        // as a stand-in exported her past the privacy filter and kept her out
        // of merge matching. '?' counts as no name.
        const noFirst = !indi.firstName || indi.firstName === '?' || indi.firstName === '//';
        const noLast = !indi.lastName || indi.lastName === '?';
        const person: Person = {
            id: personId,
            firstName: indi.firstName || '?',
            lastName: noLast ? '' : indi.lastName,
            gender,
            isPlaceholder: noFirst && noLast,
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
        // Facts with no field of their own join the note, labelled, ahead of
        // whatever free text the file wrote (see NOTED_INDI_TAGS).
        const factLines = indi.noteFacts.map(factToNoteLine);
        const allNotes = [...factLines, ...(indi.notes ? [indi.notes] : [])];
        if (allNotes.length > 0) person.notes = allNotes.join('\n');
        if (indi.refn) person.refn = indi.refn;
        if (indi.question) person.question = indi.question;
        if (indi.refn && indi.refnType) person.refnType = indi.refnType;
        // Other spellings from the file, kept as written.
        const variants = indi.nameVariants.map(v => v.replace(/\//g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
        if (variants.length > 0) person.nameVariants = variants;
        /**
         * A godparent / witness as the file wrote them. An ASSO pointing at
         * someone the file never defines (@VOID@ or a missing record) yields
         * null: with no link and no name, a bare role says nothing worth keeping.
         */
        const toParticipant = (raw: RawParticipant): EventParticipant | null => {
            const linked = raw.ref ? personIdMap.get(raw.ref) : undefined;
            if (!linked && !raw.name) return null;
            const role = relaToRole(raw.rela);
            const note = participantNote(raw.rela, role, raw.note);
            return {
                id: generateParticipantId(),
                role,
                ...(linked ? { personId: linked } : {}),
                ...(raw.name ? { name: raw.name } : {}),
                ...(note ? { note } : {}),
            };
        };

        if (indi.events.length > 0) {
            person.events = indi.events.map((ev): LifeEvent => {
                const out: LifeEvent = { id: generateLifeEventId(), type: ev.type };
                if (ev.customLabel) out.customLabel = ev.customLabel;
                if (ev.date) out.date = ev.date;
                if (ev.place) out.place = ev.place;
                if (ev.note) out.note = ev.note;
                const evRefs = mapRefs(ev.sourceRefs);
                if (evRefs.length > 0) out.sourceIds = evRefs;

                const parts = (ev.participants ?? [])
                    .map(toParticipant).filter((p): p is EventParticipant => !!p);
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
                const line = strings.gedcomNotes.association(name, label)
                    + (asso.note ? ` — ${asso.note}` : '');
                person.notes = person.notes ? `${person.notes}\n${line}` : line;
            }
        }

        /**
         * Godparents at the birth entry, informants at the death entry. The
         * model hangs people on events, and birth/death are fields — so they
         * join the event the register itself implies: the baptism (burial) when
         * the file records one, otherwise an entry event carrying the same date
         * and place. Keeping them beats the alternative of dropping the only
         * names in the record that lead anywhere.
         */
        const rehomeParticipants = (raws: RawParticipant[], kind: 'birth' | 'death'): void => {
            const parts = raws.map(toParticipant).filter((p): p is EventParticipant => !!p);
            if (parts.length === 0) return;
            const hostType: LifeEventType = kind === 'birth' ? 'baptism' : 'burial';
            let host = person.events?.find(e => e.type === hostType);
            if (!host) {
                const date = kind === 'birth' ? indi.birthDate : indi.deathDate;
                const place = kind === 'birth' ? indi.birthPlace : indi.deathPlace;
                host = {
                    id: generateLifeEventId(),
                    type: 'custom',
                    customLabel: kind === 'birth'
                        ? strings.gedcomNotes.birthRecord : strings.gedcomNotes.deathRecord,
                    ...(date ? { date } : {}),
                    ...(place ? { place } : {}),
                };
                (person.events ??= []).push(host);
            }
            const seen = new Set((host.participants ?? []).map(p => p.personId ?? p.name));
            for (const part of parts) {
                const key = part.personId ?? part.name;
                if (seen.has(key)) continue;
                seen.add(key);
                (host.participants ??= []).push(part);
            }
        };
        rehomeParticipants(indi.birthParticipants, 'birth');
        rehomeParticipants(indi.deathParticipants, 'death');

        const story = toStory(indi.story);
        if (story) person.story = story;

        const personRefs = mapRefs(indi.sourceRefs);
        if (personRefs.length > 0) person.sourceIds = personRefs;

        // OBJE media: a data-URL FILE is either the portrait (Strom marker)
        // or an attachment. External file paths cannot be embedded — counted
        // as dropped so the import summary mentions them.
        for (const media of indi.media) {
            if (media.file.startsWith('data:')) {
                // Only the formats the app itself stores come in: a portrait
                // is a raster image, a document an image or a PDF. Anything
                // else (SVG, HTML, script …) could run when opened, so it is
                // skipped — and counted, so the summary says so.
                const wantsPhoto = media.stromKind === 'photo';
                if (!(wantsPhoto ? SAFE_PHOTO_DATA_URL : SAFE_ATTACHMENT_DATA_URL).test(media.file)) {
                    skippedMedia++;
                    droppedTags.set('OBJE', (droppedTags.get('OBJE') ?? 0) + 1);
                    continue;
                }
                if (wantsPhoto) {
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
                    if (media.note) att.note = media.note;
                    const attSource = media.sourceXref ? sourceIdMap.get(media.sourceXref) : undefined;
                    if (attSource) att.sourceId = attSource;
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

    /** A wedding witness as the file wrote them (see toParticipant above). */
    const toWitness = (raw: RawParticipant): EventParticipant | null => {
        const linked = raw.ref ? personIdMap.get(raw.ref) : undefined;
        if (!linked && !raw.name) return null;
        const role = relaToRole(raw.rela);
        const note = participantNote(raw.rela, role, raw.note);
        return {
            id: generateParticipantId(),
            role,
            ...(linked ? { personId: linked } : {}),
            ...(raw.name ? { name: raw.name } : {}),
            ...(note ? { note } : {}),
        };
    };

    /**
     * Everything a FAM says about the couple itself — one builder for the
     * two-parent and the single-parent path, so neither can forget a part
     * (the single-parent path once lost the witnesses and the story).
     */
    const fillUnion = (partnership: Partnership, fam: GedcomFamily): void => {
        if (fam.marriagePlace) partnership.startPlace = fam.marriagePlace;
        if (fam.note) partnership.note = fam.note;
        applyUnionOutcome(partnership, fam);

        if (fam.engagementDate && fam.engagementDate !== '?') {
            const line = strings.gedcomNotes.engagement(fam.engagementDate);
            partnership.note = partnership.note ? `${partnership.note}\n${line}` : line;
        }

        // Banns, a marriage contract, an annulment: recorded about the couple,
        // with no field of their own (see NOTED_FAM_TAGS).
        for (const fact of fam.noteFacts) {
            const line = factToNoteLine(fact);
            partnership.note = partnership.note ? `${partnership.note}\n${line}` : line;
        }

        const famRefs = mapRefs(fam.sourceRefs);
        if (famRefs.length > 0) partnership.sourceIds = [...new Set(famRefs)];

        // Witnesses at the wedding, named under 1 MARR.
        const witnesses = fam.marriageParticipants.map(toWitness)
            .filter((p): p is EventParticipant => !!p);
        if (witnesses.length > 0) partnership.participants = witnesses;

        const famStory = toStory(fam.story);
        if (famStory) partnership.story = famStory;
    };

    /**
     * A second FAM of the same couple (some programs write one per marriage
     * record) is the same union: its facts join the first instead of drawing
     * the couple twice.
     */
    const joinUnion = (into: Partnership, from: Partnership): void => {
        if (!into.startDate && from.startDate) into.startDate = from.startDate;
        if (!into.startPlace && from.startPlace) into.startPlace = from.startPlace;
        if (!into.endDate && from.endDate) into.endDate = from.endDate;
        if (from.note && !(into.note ?? '').includes(from.note)) {
            into.note = into.note ? `${into.note}\n${from.note}` : from.note;
        }
        if (from.sourceIds?.length) into.sourceIds = [...new Set([...(into.sourceIds ?? []), ...from.sourceIds])];
        if (from.participants?.length) {
            const seen = new Set((into.participants ?? []).map(p => p.personId ?? p.name));
            for (const part of from.participants) {
                if (seen.has(part.personId ?? part.name)) continue;
                (into.participants ??= []).push(part);
            }
        }
        if (!into.story && from.story) into.story = from.story;
    };
    const unionOfCouple = new Map<string, PartnershipId>();

    /** Hang one child under a partnership (both parents, PEDI, _FREL/_MREL). */
    const linkChild = (
        partnership: Partnership, childGedId: string, gedFamId: string, fam: GedcomFamily,
        realParents: { husb?: PersonId; wife?: PersonId },
    ): void => {
        const childId = personIdMap.get(childGedId);
        if (!childId || !persons[childId]) return;
        const { person1Id, person2Id } = partnership;
        if (!partnership.childIds.includes(childId)) partnership.childIds.push(childId);
        const child = persons[childId];
        for (const pid of [person1Id, person2Id]) {
            if (!child.parentIds.includes(pid)) child.parentIds.push(pid);
            if (!persons[pid].childIds.includes(childId)) persons[pid].childIds.push(childId);
        }

        // Pedigree type (PEDI) applies to the child's link to THIS family →
        // set the real parents' relationship type accordingly. Read from the
        // FAMC naming this family: a PEDI under another FAMC says nothing
        // about these parents, and taking any PEDI the person carried marked
        // Joe's birth parents adoptive in 555SAMPLE.
        const pedi = pediFor(childGedId, gedFamId);
        const relType: ParentChildRelType | null =
            pedi === 'adopted' ? 'adoptive' : pedi === 'foster' ? 'foster' : null;
        if (relType) {
            for (const pid of [realParents.husb, realParents.wife]) {
                if (pid) (child.parentRelTypes ??= {})[pid] = relType;
            }
        }
        // _FREL/_MREL name each parent separately and win over PEDI, which
        // can only speak for both: "stepfather, own mother" survives.
        const rels = fam.childRels.get(childGedId);
        if (realParents.husb) setParentRel(child, realParents.husb, childRelType(rels?.frel));
        if (realParents.wife) setParentRel(child, realParents.wife, childRelType(rels?.mrel));
    };

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
        fillUnion(partnership, fam);

        const coupleKey = [person1Id, person2Id].sort().join('|');
        const sameCouple = unionOfCouple.get(coupleKey);
        let target: Partnership;
        if (sameCouple) {
            target = partnerships[sameCouple];
            joinUnion(target, partnership);
        } else {
            unionOfCouple.set(coupleKey, partnershipId);
            partnerships[partnershipId] = partnership;
            target = partnership;
            persons[person1Id]?.partnerships.push(partnershipId);
            persons[person2Id]?.partnerships.push(partnershipId);
        }

        for (const childGedId of childrenOf(gedFamId, fam)) {
            linkChild(target, childGedId, gedFamId, fam, { husb: person1Id, wife: person2Id });
        }
    }

    /** A "?" stand-in for a parent the family does not name. */
    const makePlaceholder = (gender: 'male' | 'female'): PersonId => {
        const id = toPersonId(generateId('p'));
        persons[id] = {
            id, firstName: '?', lastName: '', gender,
            parentIds: [], childIds: [], partnerships: [], isPlaceholder: true,
        };
        return id;
    };

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
        const ownChildren = childrenOf(gedFamId, fam).filter(c => {
            const id = personIdMap.get(c);
            return !!id && !!persons[id];
        });
        if (ownChildren.length === 0) continue;

        const knownParentId = husbId ?? wifeId;
        const parentId = knownParentId && persons[knownParentId] ? knownParentId : undefined;

        // A family naming children but neither parent still says they are
        // SIBLINGS. The model knows siblings only through shared parents, so
        // two stand-ins keep them together; a lone child gains nothing from
        // invented parents and stays as it is.
        if (!parentId && ownChildren.length < 2) continue;

        // The dropped pointer's stand-in IS the placeholder created below —
        // count it so the import summary owns up to the swap.
        if (parentId && ((fam.husb && !husbId) || (fam.wife && !wifeId))) placeholderPersons++;

        let person1Id: PersonId;
        let person2Id: PersonId;
        if (parentId) {
            // Create placeholder for the missing parent (opposite gender). Keep
            // the male partner as person1 (HUSB), matching the two-parent path
            // and the exporter, so import->export->import is order-stable even
            // when the known parent is the mother.
            const parentIsMale = persons[parentId].gender === 'male';
            const placeholderId = makePlaceholder(parentIsMale ? 'female' : 'male');
            person1Id = parentIsMale ? parentId : placeholderId;
            person2Id = parentIsMale ? placeholderId : parentId;
        } else {
            person1Id = makePlaceholder('male');
            person2Id = makePlaceholder('female');
            placeholderPersons += 2;
        }

        const partnershipId = toPartnershipId(generateId('u'));
        const partnership: Partnership = {
            id: partnershipId,
            person1Id,
            person2Id,
            childIds: [],
            status: 'married'
        };
        fillUnion(partnership, fam);
        partnerships[partnershipId] = partnership;

        // Add partnership to both persons
        persons[person1Id].partnerships.push(partnershipId);
        persons[person2Id].partnerships.push(partnershipId);

        // PEDI / _FREL / _MREL apply to the real parent only: a child adopted
        // by a lone parent is still adopted.
        const real = parentId
            ? (husbId === parentId ? { husb: parentId } : { wife: parentId })
            : {};
        for (const childGedId of ownChildren) {
            linkChild(partnership, childGedId, gedFamId, fam, real);
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

            const gn = strings.gedcomNotes;
            const pedi = pediFor(childGedId, gedFamId);
            const kind = pedi === 'adopted' ? gn.adoptedChild
                : pedi === 'foster' ? gn.fosterChild : gn.child;
            const line = parentNames.length > 0
                ? gn.alsoRecorded(kind, parentNames.join(gn.parentAnd))
                : gn.alsoRecordedNoParents(kind);

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
            ...(Object.keys(sources).length > 0 ? { sources } : {}),
            ...(gedcom.places.size > 0 ? { places: Object.fromEntries(gedcom.places) } : {}),
            ...(gedcom.surnameGroups.length > 0 ? { surnameVariants: gedcom.surnameGroups } : {})
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
            skippedMedia,
            totalGedFamilies: families.size
        }
    };
}
