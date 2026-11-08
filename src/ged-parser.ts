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

import { normalizeSingleParents } from './single-parent.js';
import {
    FactStatus,
    parseFactStatus,
    PersonId,
    PartnershipId,
    Person,
    Partnership,
    PartnershipStatus,
    Gender,
    oppositeGender,
    StromData,
    LifeEvent,
    SourceExcerpt,
    CoupleEvent,
    CoupleEventType,
    EventParticipant,
    Story,
    LifeEventType,
    ParentChildRelType,
    ParticipantRole,
    Source,
    SourceReadBy,
    Attachment,
    toPersonId,
    toPartnershipId,
    generateLifeEventId,
    generateParticipantId,
    generateSourceId,
    PlaceGeo,
    PlaceRecord,
    PersonResearch,
    ResearchConflictValue,
    ResearchEdge,
    ResearchEdgeBook,
    ResearchEdgeHypo,
    ResearchEdgeJoin,
    ResearchEdgeTask,
    ResearchHypothesis,
    ResearchHypothesisVariant,
    ResearchVariantLink,
    ResearchIsland,
    YearSpan,
    SourceImageHeld,
    FactPart,
    OriginalIdLine,
    ResearchFactOrigin,
    uniqueIdSuffix,
    PrimaryName,
} from './types';
import { dateSortKey, formatFlexDate, instantLocalDay } from './dates';
import { gedcomDatePhrase, parseGedcomDate } from './gedcom-date-read';
import { localAge } from './recorded-age';
import { isGedcomDateFormOf } from './gedcom-date-form';
import { placeKey } from './places';
import { isPlaceRecordId, sanitizePlaceRecord, PLACE_TEXT_LIMITS } from './place-records';
import { coupleEventTypeOfTag, eventValueIsOnTag } from './events';
import { strings, getStringsForLang } from './strings';
import { SURNAME_GROUPS_MARKER, SURNAME_REJECTIONS_MARKER, SURNAME_GROUP_SEP, formatGedcomDate } from './ged-exporter';

/** The groups of a surname marker's lines: spellings split on '|' and trimmed, two or more each. */
function surnameNoteGroups(noteLines: readonly string[] | null): string[][] {
    const groups: string[][] = [];
    for (const line of noteLines ?? []) {
        const group = line.split(SURNAME_GROUP_SEP.trim()).map(s => s.trim()).filter(Boolean);
        if (group.length >= 2) groups.push(group);
    }
    return groups;
}
import { excerptFromDataUrl } from './excerpts';
import { normalizeSha256 } from './sha256';
import { isConfirmDay, isTranscriptMark } from './source-confirm';
import { ORIGINAL_ONLY_DATA_URL } from './validation';
import { parseRegion, regionFromStored } from './originals';
import { parseName, readGedcomName, PRIMARY_NAME_TAG, type GedcomNameParts } from './gedcom-names';
import { appUnknownIsNoSurname } from './app-version';
import { researchClaimValue } from './research-claim';
import {
    addGedcomExtra, addOriginalIds, CITE_TAG, joinedBlock, NOTED_TAG, notedBlock, notedStructures, type ExtraHolder, withoutCiteLines, mediaDateValue, cleanImportOrigin, cleanOriginalIdLine, cleanOriginalIds, factPartOf, ID_ENTRIES_MAX, ID_LINES_MAX,
    IMPORT_TAG, markFactImported, markTreeImported, XID_TAG,
    JOINED_TAG, type JoinedMarks, ORIGINAL_ID_TAGS, parseImportMark as readImportMark, sanitizeImports, validExtraBlock,
} from './import-origin';

/** The name parser lives with the rules it shares with the research (gedcom-names.ts). */
export { parseName };
/** The DATE reader lives apart, so a kept date form can be checked without the parser (gedcom-date-read.ts). */
export { parseGedcomDate, gedcomDatePhrase };

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
function toStory(raw: RawStory | undefined, mapRefs: (refs?: string[]) => string[]): Story | undefined {
    if (!raw || !raw.text.trim()) return undefined;
    const stat = raw.stat.trim().toLowerCase();
    const status = (stat === 'navrh' || stat === 'draft') ? 'draft'
        : (stat === 'hotovo' || stat === 'final') ? 'final' : undefined;
    // A new version waits only beside an approved story: a draft is simply
    // rewritten, so a _DRAFT under one means nothing.
    const d = status === 'final' && raw.draft?.text.trim() ? raw.draft : undefined;
    const facts = d?.facts.filter(f => f.trim());
    const sources = mapRefs(raw.sources);
    const draftSources = d ? mapRefs(d.sources) : [];
    return {
        ...(raw.kind ? { kind: raw.kind } : {}),
        ...(raw.title ? { title: raw.title } : {}),
        ...(status ? { status } : {}),
        text: raw.text,
        ...(raw.facts.length > 0 ? { facts: raw.facts } : {}),
        ...(raw.note ? { note: raw.note } : {}),
        ...(sources.length > 0 ? { sources } : {}),
        ...(d ? {
            draft: {
                ...(d.title ? { title: d.title } : {}),
                text: d.text,
                ...(facts && facts.length > 0 ? { facts } : {}),
                ...(d.note ? { note: d.note } : {}),
                ...(draftSources.length > 0 ? { sources: draftSources } : {}),
                ...(d.at.trim() ? { at: d.at.trim() } : {}),
            },
        } : {}),
    };
}

/**
 * What Strom Research writes about a person beyond the facts (research files
 * only): conflicting sources, hypotheses, what was searched.
 */
interface RawResearch {
    conflicts: { id: string; fact: string; title: string; stat: string; take: string; kind?: string; values: RawResearchValue[]; decision?: RawResearchValue }[];
    hypotheses: { id: string; title: string; note: string; stat: string; chosen: string; by: string; deci: string; at: string; variants: RawResearchVariant[] }[];
    searched: { title: string; date: string; resn: string; at: string }[];
    /** The _STROM_EDGE / _STROM_ISLAND block: its value and the lines under it (level, tag, value). */
    edge?: RawResearchBlock;
    island?: RawResearchBlock;
}

interface RawResearchBlock {
    value: string;
    lines: { level: number; tag: string; value: string }[];
}

interface RawResearchValue {
    value: string;
    sourceRefs: string[];
    /** 3 _STROM_SIDE / 3 _STROM_RAW under a conflict's value, as written. */
    side?: string;
    raw?: string;
}

/** 3 _LINK / 3 _INTREE under a variant: its kind and pointers, as written. */
interface RawResearchVariantLink { kind: string; persons: string[]; family: string[]; parents: string[] }

/** 2 _VAR under a hypothesis: its letter, claim, links and what the tree records already (pointers as written), sources. */
interface RawResearchVariant {
    label: string;
    title: string;
    links: RawResearchVariantLink[];
    inTree: RawResearchVariantLink[];
    sourceRefs: string[];
}

/** What the research's pointers name: a person's REFN, a family's partners (pointers). */
interface ResearchRefs {
    person: (xref: string) => string | undefined;
    familyPartners: (xref: string) => string[] | undefined;
}

/** The research block being read, the level-2 line inside it and the level-3 line under that. */
interface OpenResearch {
    kind: 'conflict' | 'hypo' | 'searched' | 'edge' | 'island';
    sub: string | null;
    sub3?: string | null;
}

const newResearch = (): RawResearch => ({ conflicts: [], hypotheses: [], searched: [] });

/** "FROM 1890 TO 1900" / "BET 1890 AND 1900" / "1890" → the years it spans. */
function researchYears(date: string): { from?: number; to?: number } {
    const years = [...date.matchAll(/\b(\d{3,4})\b/g)].map(m => Number(m[1]));
    if (years.length === 0) return {};
    if (/^\s*TO\b/i.test(date) || /^\s*BEF\b/i.test(date)) return { to: years[0] };
    if (years.length === 1) return /^\s*(FROM|AFT)\b/i.test(date) && !/\bTO\b/i.test(date) ? { from: years[0] } : { from: years[0], to: years[0] };
    return { from: years[0], to: years[years.length - 1] };
}

/**
 * An ISO date from what the research wrote (ISO or a GEDCOM date); '' when
 * neither. An instant with a time and a zone gives its local day; a bare day
 * stays as written.
 */
function researchIsoDate(value: string): string {
    const v = value.trim();
    const local = instantLocalDay(v);
    if (local) return local;
    const iso = v.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
    const parsed = v ? parseGedcomDate(v) : '';
    return /^\d{4}-\d{2}-\d{2}$/.test(parsed) ? parsed : '';
}

/** Raw research lines → the person's `research`, citations resolved (undefined: nothing kept). */
/**
 * The research's origin of one fact from its lines (see RawFactOrigin), or
 * null when it says nothing the app knows. Several `_STROM_WAS` (one per
 * changed part) become one earlier value with each part's own value.
 */
function toResearchOrigin(raw: RawFactOrigin, mapRefs: (refs?: string[]) => string[]): ResearchFactOrigin | null {
    const out: ResearchFactOrigin = {};
    const words = (raw.origin ?? '').trim().split(/\s+/).filter(Boolean);
    const kind = words[0]?.toLowerCase();
    if (kind === 'import') {
        out.kind = 'import';
        const mark = words.length > 1 ? readImportMark(words.slice(1).join(' ')) : null;
        if (mark) {
            out.importId = mark.id;
            if (mark.parts) out.parts = mark.parts;
        }
    } else if (kind === 'user' || kind === 'research') {
        out.kind = kind;
    }
    if (raw.was.length > 0) {
        const parts: FactPart[] = [];
        const partValues: Partial<Record<FactPart, string>> = {};
        for (const w of raw.was) {
            for (const p of w.parts.map(factPartOf)) {
                if (!p || parts.includes(p)) continue;
                parts.push(p);
                partValues[p] = w.value.trim();
            }
        }
        const first = raw.was[0];
        const importId = raw.was.map(w => w.importId?.trim()).find(Boolean);
        const ref = raw.was.map(w => w.ref?.trim()).find(Boolean);
        out.was = {
            value: first.value.trim(),
            ...(importId ? { importId } : {}),
            ...(parts.length > 0 ? { parts } : {}),
            ...(ref ? { ref } : {}),
            ...(raw.was.length > 1 && parts.length > 1 ? { partValues } : {}),
        };
    }
    const sourceIds = [...new Set(mapRefs(raw.sourceRefs))];
    if (sourceIds.length > 0) out.sourceIds = sourceIds;
    return out.kind || out.was ? out : null;
}

/** Whose value a conflict proposes to change (GEDCOM 2 _STROM_KIND import | user); anything else says nothing. */
function conflictKindOf(value: string | undefined): 'import' | 'user' | undefined {
    const v = value?.trim().toLowerCase();
    return v === 'import' || v === 'user' ? v : undefined;
}

function toPersonResearch(raw: RawResearch | undefined, mapRefs: (refs: string[]) => string[], refs?: ResearchRefs): PersonResearch | undefined {
    if (!raw) return undefined;
    const value = (v: RawResearchValue): ResearchConflictValue => {
        const ids = mapRefs(v.sourceRefs);
        // A batch's source label left in front of the claim goes (researchClaimValue).
        return { value: researchClaimValue(v.value), ...(ids.length > 0 ? { sourceIds: ids } : {}) };
    };
    const sideOf = (v: RawResearchValue): 'user' | 'research' | undefined => {
        const side = v.side?.trim().toLowerCase();
        return side === 'user' || side === 'research' ? side : undefined;
    };
    // A conflict's value with whose it is and, for the sex, its machine value (anything else said there goes).
    const claim = (v: RawResearchValue, fact: string): ResearchConflictValue => {
        const side = sideOf(v);
        const raw = fact === 'SEX' ? v.raw?.trim().toUpperCase() : undefined;
        return {
            ...value(v),
            ...(side ? { side } : {}),
            ...(raw === 'M' || raw === 'F' || raw === 'U' ? { raw } : {}),
        };
    };
    const out: PersonResearch = {};
    const conflicts = raw.conflicts
        .filter(c => /^X\d{1,7}$/.test(c.id) && (c.fact || c.title.trim()) && c.values.length > 0)
        .map(c => {
            const decided = c.stat.trim().toLowerCase() === 'decided';
            const fact = (c.fact || 'EVEN').toUpperCase();
            return {
                id: c.id,
                fact,
                ...(c.title.trim() ? { title: c.title.trim() } : {}),
                status: decided ? 'decided' as const : 'open' as const,
                // An empty value goes, unless a side says whose it is: a value deleted on that side
                // (2 VAL with no text, 3 _STROM_SIDE user) — still one of the two sides to decide between.
                values: c.values.filter(v => v.value || sideOf(v)).map(v => claim(v, fact)),
                ...(decided && c.decision?.value ? { decision: value(c.decision) } : {}),
                ...(c.take.trim().toUpperCase() === 'Y' ? { take: true as const } : {}),
                ...(conflictKindOf(c.kind) ? { kind: conflictKindOf(c.kind)! } : {}),
            };
        })
        .filter(c => c.values.some(v => v.value));
    if (conflicts.length > 0) out.conflicts = conflicts;
    const hypotheses = raw.hypotheses.filter(h => h.title.trim())
        .map((h): ResearchHypothesis => {
            const status = researchWord(h.stat);
            const chosen = researchVariantLabel(h.chosen);
            const variants = researchVariants(h.variants, mapRefs, refs);
            // Who decided, why and when: only of a decided or abandoned one.
            const settled = status === 'decided' || status === 'abandoned';
            const decision = settled ? h.deci.trim() : '';
            const at = settled ? /^\d{4}-\d{2}-\d{2}$/.exec(h.at.trim())?.[0] : undefined;
            return {
                ...(RESEARCH_ID.H.test(h.id.trim()) ? { id: h.id.trim() } : {}),
                title: h.title.trim(),
                ...(h.note.trim() ? { note: h.note.trim() } : {}),
                ...(status ? { status } : {}),
                ...(chosen && status === 'decided' ? { chosen } : {}),
                ...(settled && h.by.trim().toLowerCase() === 'agent' ? { decidedBy: 'agent' as const } : {}),
                ...(decision ? { decision } : {}),
                ...(at ? { decidedAt: at } : {}),
                ...(variants.length > 0 ? { variants } : {}),
            };
        });
    if (hypotheses.length > 0) out.hypotheses = hypotheses;
    const searched = raw.searched.filter(x => x.title.trim()).map(x => {
        const resn = x.resn.trim().toLowerCase();
        const at = researchIsoDate(x.at);
        return {
            title: x.title.trim(),
            ...researchYears(x.date),
            ...(resn === 'found' || resn === 'none' ? { result: resn as 'found' | 'none' } : {}),
            ...(at ? { at } : {}),
        };
    });
    if (searched.length > 0) out.searched = searched;
    const edge = raw.edge ? researchEdgeFromLines(raw.edge) : null;
    if (edge) out.edge = edge;
    const island = raw.island ? researchIslandFromLines(raw.island) : null;
    if (island) out.island = island;
    return Object.keys(out).length > 0 ? out : undefined;
}

/** The research's ids by kind (person REFN, task, direction, hypothesis, conflict, book). */
const RESEARCH_ID = {
    P: /^P\d{1,7}$/, T: /^T\d{1,7}$/, G: /^G\d{1,7}$/, H: /^H\d{1,7}$/, X: /^X\d{1,7}$/, B: /^B\d{1,7}$/,
};

/** A variant's letter ("B", "AA"): upper-case letters, as written; undefined otherwise. */
function researchVariantLabel(value: string): string | undefined {
    const v = value.trim();
    return /^[A-Z]{1,3}$/.test(v) ? v : undefined;
}

/**
 * The variants of a hypothesis, read: a variant without a letter goes, so do
 * a repeated letter (the first stays), a link of an unknown kind, a link to a
 * record not in the file or without the research's person number, and a link
 * that names too few people (a child without parents, a couple of one).
 * What the tree records already (3 _INTREE) the same way, and stricter: a
 * child only with its family (4 _FAM), a couple's family (when named) of
 * just these two, siblings' family (when named) in the file.
 */
function researchVariants(raw: RawResearchVariant[], mapRefs: (refs: string[]) => string[], refs?: ResearchRefs): ResearchHypothesisVariant[] {
    const out: ResearchHypothesisVariant[] = [];
    const seen = new Set<string>();
    const person = (xref: string): string | undefined => {
        const refn = refs?.person(xref)?.trim();
        return refn && RESEARCH_ID.P.test(refn) ? refn : undefined;
    };
    const people = (xrefs: string[]): string[] | null => {
        const ids = xrefs.map(person);
        return ids.every((id): id is string => !!id) ? [...new Set(ids)] : null;
    };
    for (const v of raw) {
        const id = researchVariantLabel(v.label);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const links: ResearchVariantLink[] = [];
        for (const l of v.links) {
            if (l.kind === 'child') {
                if (l.persons.length !== 1) continue;
                const child = person(l.persons[0]);
                if (!child) continue;
                let parents: string[] | null;
                let family = false;
                if (l.family.length > 0) {
                    const partners = l.family.length === 1 ? refs?.familyPartners(l.family[0]) : undefined;
                    if (!partners) continue;
                    parents = people(partners);
                    family = true;
                } else {
                    parents = people(l.parents);
                }
                if (!parents || parents.length < 1 || parents.length > 2 || parents.includes(child)) continue;
                links.push({ kind: 'child', child, parents, ...(family ? { family: true as const } : {}) });
            } else if (l.kind === 'same' || l.kind === 'partners' || l.kind === 'siblings') {
                const persons = people(l.persons);
                if (!persons || persons.length < 2 || (l.kind !== 'siblings' && persons.length > 2)) continue;
                links.push({ kind: l.kind, persons });
            }
        }
        const inTree: ResearchVariantLink[] = [];
        for (const l of v.inTree) {
            if (l.family.length > 1) continue;
            const partners = l.family.length === 1 ? refs?.familyPartners(l.family[0]) : undefined;
            if (l.family.length === 1 && !partners) continue;
            if (l.kind === 'child') {
                if (l.persons.length !== 1 || !partners) continue;
                const child = person(l.persons[0]);
                const parents = people(partners);
                if (!child || !parents || parents.length < 1 || parents.length > 2 || parents.includes(child)) continue;
                inTree.push({ kind: 'child', child, parents, family: true });
            } else if (l.kind === 'partners' || l.kind === 'siblings') {
                const persons = people(l.persons);
                if (!persons || persons.length < 2 || (l.kind === 'partners' && persons.length > 2)) continue;
                if (l.kind === 'partners' && partners) {
                    const couple = people(partners);
                    if (!couple || couple.length !== 2 || !couple.every(x => persons.includes(x))) continue;
                }
                inTree.push({ kind: l.kind, persons });
            }
        }
        const title = v.title.trim();
        const sourceIds = mapRefs(v.sourceRefs);
        out.push({
            id, ...(title ? { title } : {}), links,
            ...(inTree.length > 0 ? { inTree } : {}),
            ...(sourceIds.length > 0 ? { sourceIds } : {}),
        });
    }
    return out;
}

/** A whole number within a range, or undefined. */
function researchInt(value: string, min: number, max: number): number | undefined {
    if (!/^\s*-?\d+\s*$/.test(value)) return undefined;
    const n = parseInt(value, 10);
    return n >= min && n <= max ? n : undefined;
}

/** "FROM 1773 TO 1793" → the span; undefined unless both years are there. */
function researchSpan(value: string): YearSpan | undefined {
    const { from, to } = researchYears(value);
    if (from === undefined || to === undefined || from > to) return undefined;
    return { from, to };
}

/** A research vocabulary word (end, next, scope …): lower case, letters and dashes only. */
function researchWord(value: string): string | undefined {
    const v = value.trim().toLowerCase();
    return /^[a-z][a-z-]{0,31}$/.test(v) ? v : undefined;
}

/**
 * The lines under one `1 _STROM_EDGE` → the edge (null when its value is not
 * a word). Sub-tags come in a fixed order, but any may be missing and new
 * ones may appear: unknown tags are skipped, invalid ids and numbers dropped.
 */
export function researchEdgeFromLines(block: RawResearchBlock): ResearchEdge | null {
    const missing = researchWord(block.value);
    if (!missing) return null;
    const edge: ResearchEdge = { missing, books: [], covered: [], noRecords: [], tasks: [], tried: [], conflicts: [], hypos: [] };
    const YEAR = [1000, 2999] as const;
    // The level-2 item the level-3 lines belong to, and the level-3 line for CONT/CONC.
    let item: { tag: string; target?: ResearchEdgeBook | ResearchEdgeTask | ResearchEdgeHypo | ResearchEdge['est'] | ResearchEdge['sessions'] } | null = null;
    let sub = '';
    // The hypothesis' `_JOIN` the level-4 lines under it belong to.
    let join: ResearchEdgeJoin | null = null;
    for (const { level, tag, value } of block.lines) {
        const v = value.trim();
        if (level === 2) {
            item = { tag };
            sub = '';
            join = null;
            switch (tag) {
                case '_SCOPE': { const w = researchWord(v); if (w) edge.scope = w; break; }
                case '_RESEARCH': if (RESEARCH_ID.G.test(v)) edge.research = v; break;
                case '_GEN': { const n = researchInt(v, 1, 99); if (n !== undefined) edge.gen = n; break; }
                case '_END': { const w = researchWord(v); if (w) edge.end = w; break; }
                case '_RECORDS': { const n = researchInt(v, ...YEAR); if (n !== undefined) edge.records = n; break; }
                case '_NEXT': { const w = researchWord(v); if (w) edge.next = w; break; }
                case '_EST': {
                    const year = researchInt(v, ...YEAR);
                    if (year !== undefined) { edge.est = { year }; item.target = edge.est; }
                    break;
                }
                case 'DATE': { const span = researchSpan(v); if (span) edge.window = span; break; }
                case '_BOOK':
                    if (RESEARCH_ID.B.test(v)) { const book: ResearchEdgeBook = { id: v, title: '' }; edge.books.push(book); item.target = book; }
                    break;
                case '_COVERED': { const span = researchSpan(v); if (span) edge.covered.push(span); break; }
                case '_NORECORDS': { const span = researchSpan(v); if (span) edge.noRecords.push(span); break; }
                case '_TASK':
                    if (RESEARCH_ID.T.test(v)) { const task: ResearchEdgeTask = { id: v, title: '' }; edge.tasks.push(task); item.target = task; }
                    break;
                case '_TRIED': if (RESEARCH_ID.T.test(v)) edge.tried.push(v); break;
                case '_SEARCHES': { const n = researchInt(v, 0, 1e6); if (n !== undefined) edge.searches = n; break; }
                case '_SESSIONS': {
                    const n = researchInt(v, 0, 1e6);
                    if (n !== undefined) { edge.sessions = { n }; item.target = edge.sessions; }
                    break;
                }
                case '_LAST': { const iso = researchIsoDate(v); if (iso) edge.last = iso; break; }
                case '_CONFLICT': if (RESEARCH_ID.X.test(v)) edge.conflicts.push(v); break;
                case '_HYPO':
                    if (RESEARCH_ID.H.test(v)) { const hypo: ResearchEdgeHypo = { id: v, tests: [] }; edge.hypos.push(hypo); item.target = hypo; }
                    break;
                default: break;
            }
            continue;
        }
        const target = item?.target;
        if (!item || !target) continue;
        if (level === 3) { sub = tag; join = null; }
        if (item.tag === '_EST' && level === 3) {
            const est = target as NonNullable<ResearchEdge['est']>;
            if (tag === 'PLAC' && v) est.place = v;
            else if (tag === '_BASIS' && v) est.basis = v;
        } else if (item.tag === '_BOOK') {
            const book = target as ResearchEdgeBook;
            if (level === 3 && tag === 'TITL') book.title = v;
            else if (level === 3 && tag === 'DATE') Object.assign(book, researchYears(v));
            else if (level === 3 && tag === '_ACCESS') { const w = researchWord(v); if (w) book.access = w; }
            else if (level === 4 && sub === 'TITL' && (tag === 'CONC' || tag === 'CONT')) book.title += tag === 'CONT' ? ' ' + v : value;
        } else if (item.tag === '_TASK') {
            const task = target as ResearchEdgeTask;
            if (level === 3) {
                if (tag === '_LEVEL') { const w = researchWord(v); if (w) task.level = w; }
                else if (tag === 'STAT') { const w = researchWord(v); if (w) task.stat = w; }
                else if (tag === 'TITL') task.title = v;
                else if (tag === '_POS') { const n = researchInt(v, 1, 1e6); if (n !== undefined) task.pos = n; }
                else if (tag === '_HELD') { const w = researchWord(v); if (w) task.held = w; }
                else if (tag === '_UNTIL' && v) task.until = researchIsoDate(v) || v;
                else if (tag === 'NOTE') task.note = v;
            } else if (level === 4 && (tag === 'CONC' || tag === 'CONT')) {
                if (sub === 'TITL') task.title += tag === 'CONT' ? ' ' + v : value;
                else if (sub === 'NOTE') task.note = (task.note ?? '') + (tag === 'CONT' ? '\n' + v : value);
            }
        } else if (item.tag === '_SESSIONS' && level === 3) {
            const sessions = target as NonNullable<ResearchEdge['sessions']>;
            if (tag === '_COST') { const cost = Number(v); if (/^\d+(\.\d+)?$/.test(v) && cost < 1e7) sessions.cost = cost; }
            else if (tag === '_PARTIAL' && v.toUpperCase() === 'Y') sessions.partial = true;
        } else if (item.tag === '_HYPO' && level === 3) {
            const hypo = target as ResearchEdgeHypo;
            // Several joins: the first is the one `_ISLAND` / `_HELD` count; each its own below (level 4).
            if (tag === '_JOIN' && RESEARCH_ID.P.test(v)) {
                hypo.join ??= v;
                join = { person: v };
                (hypo.joins ??= []).push(join);
            } else if (tag === '_VAR') { const label = researchVariantLabel(v); if (label && !hypo.variants?.includes(label)) (hypo.variants ??= []).push(label); }
            else if (tag === '_ISLAND') { const n = researchInt(v, 1, 1e6); if (n !== undefined) hypo.island = n; }
            else if (tag === '_HELD') { const n = researchInt(v, 0, 1e6); if (n !== undefined) hypo.held = n; }
            else if (tag === '_TEST' && RESEARCH_ID.T.test(v)) hypo.tests.push(v);
        } else if (item.tag === '_HYPO' && level === 4 && join) {
            if (tag === '_VAR') { const label = researchVariantLabel(v); if (label && !join.variants?.includes(label)) (join.variants ??= []).push(label); }
            else if (tag === '_ISLAND') { const n = researchInt(v, 1, 1e6); if (n !== undefined) join.island = n; }
            else if (tag === '_HELD') { const n = researchInt(v, 0, 1e6); if (n !== undefined) join.held = n; }
        }
    }
    // A research without level 4 under its joins (before Strom Research 1.16): the first join only, as before.
    for (const hypo of edge.hypos) {
        if (hypo.joins && !hypo.joins.some(j => j.variants || j.island !== undefined || j.held !== undefined)) delete hypo.joins;
    }
    edge.books = edge.books.filter(b => b.title);
    edge.tasks = edge.tasks.filter(t => t.title.trim()).map(t => ({ ...t, title: t.title.trim() }));
    return edge;
}

/** The lines under one `1 _STROM_ISLAND n` → the island (null without a size). */
export function researchIslandFromLines(block: RawResearchBlock): ResearchIsland | null {
    const size = researchInt(block.value, 1, 1e6);
    if (size === undefined) return null;
    const island: ResearchIsland = { size, hypos: [] };
    let hypo: ResearchIsland['hypos'][number] | null = null;
    for (const { level, tag, value } of block.lines) {
        const v = value.trim();
        if (level === 2) {
            hypo = null;
            if (tag === '_HYPO' && RESEARCH_ID.H.test(v)) { hypo = { id: v }; island.hypos.push(hypo); }
            else if (tag === '_HELD') { const n = researchInt(v, 0, 1e6); if (n !== undefined) island.held = n; }
        } else if (level === 3 && hypo && tag === '_JOIN' && RESEARCH_ID.P.test(v)) {
            hypo.join ??= v;
        } else if (level === 3 && hypo && tag === '_VAR') {
            const label = researchVariantLabel(v);
            if (label && !hypo.variants?.includes(label)) (hypo.variants ??= []).push(label);
        }
    }
    return island;
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

/** The life event a GEDCOM tag stands for (BAPM / CHR → baptism), or null. */
export function gedcomTagEventType(tag: string): LifeEventType | null {
    return EVENT_TAG_TO_TYPE[tag.toUpperCase()] ?? null;
}

/** An EVEN TYPE that names military service, in any language the app speaks. */
function isMilitaryLabel(label: string): boolean {
    const key = label.trim().toLowerCase();
    if (!key) return false;
    return (['en', 'cs', 'de', 'pl'] as const).some(lang =>
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
// The couple's events (banns, a contract, a census…) are events of their own
// since data version 10 (see coupleEventTypeOfTag); only the count is left.
const NOTED_FAM_TAGS = new Set(['NCHI']);
/**
 * Lines under a birth, a death, a wedding or a divorce that may go to the
 * record's note (a remark, the denomination at the act, an age, a cause or an
 * address with no field left for it, a date the date field cannot hold
 * whole — "1815/1816", "10 JAN", another calendar): kept as written for
 * "Back to {prog}" when they do (see NOTED_TAG).
 */
const NOTED_DETAIL_TAGS = new Set(['NOTE', 'RELI', 'CAUS', 'AGE', 'ADDR', 'HUSB', 'WIFE', 'DATE', 'TYPE']);
/**
 * Of those, the lines Strom reads nowhere, not even into the note (a
 * wedding's `2 TYPE civil`): kept as written all the same, with no line of
 * the note to stand for them.
 */
const NOTED_SILENT_TAGS = new Set(['TYPE']);

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
/** The type of an original by its file name (only-original attachments); '' when not one the app knows. */
function originalMimeOf(name: string): string {
    const ext = (/\.([^./\\]+)$/.exec(name)?.[1] ?? '').toLowerCase();
    return ({ tif: 'image/tiff', tiff: 'image/tiff', heic: 'image/heic', heif: 'image/heif', pdf: 'application/pdf',
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as Record<string, string>)[ext] ?? 'application/octet-stream';
}

interface RawMedia {
    /** `1 OBJE @O1@`: the media record the link points at (its FILE, TITL… come from there). */
    ref?: string;
    /** _PRIM / _PRIMARY / _PERSONALPHOTO Y — preferred as the person's portrait. */
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
    /** _STROM_SHA: the original file behind the preview (Strom extension). */
    sha?: string;
    /** _STROM_ORIENT: that original's EXIF orientation. */
    orient?: number;
    /** _DATE: the picture's date as written (MyHeritage), kept with the picture (spec 066 G8). */
    date?: string;
    /** Written in place (`1 OBJE` with its lines): where in the file, and those lines as written. */
    rawLine?: number;
    rawLines?: string[];
}

interface RawEvent {
    type: LifeEventType;
    /** Label for 'custom' events (e.g. an alternative birth fact). */
    customLabel?: string;
    date?: string;
    place?: string;
    /** 2 CAUS / 2 AGE / 2 ADDR under the event (see LifeEvent). */
    cause?: string;
    age?: string;
    address?: string;
    note?: string;
    /** GEDCOM ids (@Sx@) of sources cited on this event. */
    sourceRefs?: string[];
    /** Godparents / witnesses: ASSO (a person ref) or _WITN (a bare name). */
    participants?: RawParticipant[];
    /** `1 EVEN value`: the value on the tag line, kept when a TYPE takes the label. */
    tagValue?: string;
    /** 2 _STROM_STATUS: the research's status of the event. */
    status?: FactStatus;
    /** 2 EMAIL under the event as written (LifeEvent.gedcomEmails). */
    emails?: string[];
    /** 2 _STROM_IMPORT: which import the event's parts still come from (app files only). */
    imports?: RawImportMark[];
    /** The research's origin of the event (Strom's own files only). */
    origin?: RawFactOrigin;
}

/**
 * `_STROM_IMPORT I1 [DATE PLAC…]` as an app-written file gives it: the import
 * a record or a fact comes from, and — when only some parts still do — which.
 */
interface RawImportMark {
    id: string;
    parts?: FactPart[];
}

/**
 * The research's origin of one fact as its file gives it (research files
 * only, spec 066): `2 _STROM_ORIGIN import I1 [DATE PLAC…] | user | research`,
 * each `2 _STROM_WAS <value>` (one per changed part) with its `3 _STROM_IMPORT`,
 * `3 _PART` and `3 _REF`, and the `2 SOUR @S…@` cited under the fact.
 */
interface RawFactOrigin {
    origin?: string;
    was: { value: string; importId?: string; parts: string[]; ref?: string }[];
    sourceRefs: string[];
}

type RawPersonFact = 'name' | 'sex' | 'birth' | 'death';
type RawCoupleFact = 'marriage' | 'divorce';

/** An event of the couple under FAM (MARB, CENS, EVEN…), as the file gave it. */
interface RawCoupleEvent {
    type: CoupleEventType;
    customLabel?: string;
    date?: string;
    place?: string;
    cause?: string;
    /** HUSB / WIFE > AGE. */
    husbAge?: string;
    wifeAge?: string;
    address?: string;
    note?: string;
    sourceRefs?: string[];
    participants?: RawParticipant[];
    /** `1 EVEN value`: the value on the tag line, kept when a TYPE takes the label. */
    tagValue?: string;
    /** 2 _STROM_STATUS: the research's status of the event. */
    status?: FactStatus;
    /** 2 _STROM_IMPORT (app files only). */
    imports?: RawImportMark[];
    /** The research's origin of the event (Strom's own files only). */
    origin?: RawFactOrigin;
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
    /** `2 SOUR @S…@`: the sources the story rests on, pointers as written. */
    sources: string[];
    /** `2 _DRAFT`: the new version waiting beside an approved story (research files only). */
    draft?: RawStoryDraft;
}

/** A `2 _DRAFT` block: the same fields one level deeper, plus `3 _AT`. */
interface RawStoryDraft {
    title: string;
    text: string;
    facts: string[];
    note: string;
    /** `3 SOUR @S…@`: the sources of the new version. */
    sources: string[];
    at: string;
}

const newStory = (): RawStory =>
    ({ kind: '', title: '', stat: '', text: '', facts: [], note: '', sources: [] });

/** A participant as it comes out of the file, before ids are resolved. */
interface RawParticipant {
    /** GEDCOM id (@Ix@) for ASSO; undefined for a _WITN name. */
    ref?: string;
    name?: string;
    /** RELA value as written, mapped to a role later. */
    rela?: string;
    note?: string;
}

/** A level-1 `_XXX` of another program with the lines under it, as the file wrote them (spec 066 G8). */
interface RawExtra {
    tag: string;
    lines: string[];
    /** Bookkeeping kept only to go back (`_UPD`): not named in the import's summary. */
    quiet?: boolean;
}

/** `1 _STROM_IMPORT Ix` of a person or a family with its `2 _XREF` and id lines (spec 066 K3.2). */
interface RawOriginalIds {
    from: string;
    xref?: string;
    ids: OriginalIdLine[];
}

/** One citation of a source record (`n SOUR @Sx@`) and what it says itself. */
interface CitationSlot {
    /** Where its pointer was written. */
    list: string[];
    index: number;
    /** The source record's xref. */
    id: string;
    /** Its level and line in the file (its DATA > DATE is told apart by them). */
    level: number;
    line: number;
    page?: string;
    /** DATA > DATE: when the entry was written. */
    date?: string;
    quay?: number;
    /** Its DATA > TEXT (with CONC / CONT) as written, levels from the citation's (TEXT = 2). */
    dataText?: string[];
    /** Its EVEN (with ROLE) as written, levels from the citation's (EVEN = 1). */
    even?: string[];
}

/** Raw GEDCOM source record (0 @Sx@ SOUR). */
interface RawSource {
    id: string;
    /** 1 _STROM_IMPORT: the import the record came from (app files only). */
    importMark?: string;
    title: string;
    repository: string;
    reference: string;
    url: string;
    note: string;
    /** QUAY seen on the record or a citation (first wins). */
    quality?: number;
    /** ABBR: the short title, used when the record has no TITL. */
    abbr?: string;
    /** TEXT: the entry's wording, verbatim. */
    transcript?: string;
    /** REFN: the record's id in the program that wrote the file. */
    refn?: string;
    /** _STROM_VERIFIED Y: the user read the transcript from the record. */
    verified?: boolean;
    /** _STROM_READ: who read the entry (a Strom Research file). */
    readBy?: SourceReadBy;
    /** 2 _CONF under _STROM_READ: the day the user confirmed the transcript. */
    readConfirmed?: string;
    /** 2 _TXT under _STROM_READ: the research's mark of the transcript's wording. */
    readMark?: string;
    /** _STROM_ORIG Y: the research has the source's original and can read it again. */
    original?: boolean;
    /** _STROM_READING (+ 2 _STROM_ENTRY): the research's reading the entry was written from. */
    reading?: string;
    readingEntry?: string;
    /** 1 _STROM_SHA on the record: the page the entry is on. */
    readingSha?: string;
    /** Record date from a citation's DATA > DATE (first wins). */
    recordDate?: string;
    /** OBJE on the record: crops of the entry (Strom: _STROM_KIND excerpt). */
    media: RawSourceMedia[];
    /** 1 _STROM_IMG_OMITTED: why the research left the image out of the file. */
    imageHeld?: SourceImageHeld;
    /** Its 2 _STROM_CLIP lines: the left-out excerpts. */
    heldClips?: string[];
    /** Another program's own level-1 tags kept as written (spec 066 G8). */
    extras?: RawExtra[];
    /** The first AUTH as written (its CONT lines joined by line breaks); also a line of the note. */
    author?: string;
    /** `2 _XREF` under the record's `1 _STROM_IMPORT`: its xref in the file it came from (app files only). */
    importXref?: string;
    /** The id lines under the record's `1 _STROM_IMPORT` (`2 RIN`, `2 _UID`…): its ids in that file (app files only). */
    importIdLines?: OriginalIdLine[];
    /** The record's ids in the program that wrote the file (`1 RIN`, `1 _UID`…; see GedcomIndividual.fileIds). */
    fileIds?: OriginalIdLine[];
    /** A page's source of its own: the record (xref) it was cut from. */
    derivedFrom?: string;
}

/** Raw OBJE under a source record. */
interface RawSourceMedia {
    /** `1 OBJE @O1@`: the media record the link points at. */
    ref?: string;
    title: string;
    file: string;
    /** _URL: the page in the archive's image viewer. */
    pageUrl?: string;
    /** _STROM_CLIP: the crop's id in Strom Research. */
    clip?: string;
    /** _STROM_SHA: the original scan the crop was cut from. */
    sha?: string;
    /** _STROM_REGION: where on that original (its stored pixels). */
    region?: string;
    /** _STROM_ORIENT: that original's EXIF orientation (the crop lies as stored). */
    orient?: number;
}

// ==================== TYPES ====================

/** Raw GEDCOM individual record */
interface GedcomIndividual {
    id: string;
    /** 1 _STROM_IMPORT: the import the person came from (app files only). */
    importMark?: string;
    /** Level-1 `_UID`, `UID`, `RIN`, `EXID` (+ TYPE), `_FSFTID`, `AFN`: the record's ids (another program's file). */
    fileIds?: OriginalIdLine[];
    /** The ids under each `1 _STROM_IMPORT Ix` (Strom's own files). */
    importIds?: RawOriginalIds[];
    /** Another program's own level-1 tags kept as written (spec 066 G8). */
    extras?: RawExtra[];
    /** 2 _STROM_IMPORT under the primary NAME, SEX, BIRT and DEAT. */
    factImports?: Partial<Record<RawPersonFact, RawImportMark[]>>;
    /** The research's origin of the primary NAME, the sex (1 _STROM_SEX_ORIGIN), BIRT and DEAT (Strom's own files only). */
    factOrigins?: Partial<Record<RawPersonFact, RawFactOrigin>>;
    /** Every DATE of the birth, death and events as written, by flex value (see noteDateForm). */
    dateForms?: Record<string, string>;
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
    /** NAME > GIVN / SURN / SPFX / NPFX / NSFX of the primary name and of each variant. */
    primaryNameParts: GedcomNameParts;
    variantNameParts: GedcomNameParts[];
    /**
     * _MARNM values in file order (level 1, or level 2 under a NAME), the
     * married surname some programs (Legacy, PAF) write instead of a second
     * NAME with TYPE married.
     */
    marnm: string[];
    /** The surname after marriage (Person.marriedSurname), set after the names are read. */
    marriedSurname?: string;
    /** The given names of that married name when they are not the person's own (Person.marriedFirstName). */
    marriedFirstName?: string;
    /**
     * The NAME with Strom's mark of the name the person goes by
     * (`2 _STROM_PRIMARY Y`, the first one counts): -1 the primary name, k the
     * variant k; follows the swap of a married name put first.
     */
    primaryMark?: number;
    /** Which surname the person goes by (Person.primaryName), set with the married surname. */
    primaryName?: PrimaryName;
    /** A description the file wrote instead of the given name — goes to the note. */
    nameDescription?: string;
    /** The app's own file names a person it knows without a name ("? //"): no stand-in. */
    knownNameless?: boolean;
    /** NAME > NPFX / NSFX of the primary name: the titles before and after it. */
    titleBefore?: string;
    titleAfter?: string;
    sex: string;
    /** `1 _STROM_LINE`: the person's lineage correction. */
    stromLine?: 'FOUNDER' | 'NOCARRY';
    birthDate: string;
    birthPlace: string;
    deathDate: string;
    deathPlace: string;
    /** BIRT > ADDR, DEAT > CAUS / AGE / ADDR (the first BIRT/DEAT block). */
    birthAddress?: string;
    /** BIRT > AGE of a Strom file (kept, not shown). */
    birthAge?: string;
    deathCause?: string;
    deathAge?: string;
    deathAddress?: string;
    /** BIRT / DEAT > _STROM_STATUS: the research's status of the birth and the death. */
    birthStatus?: FactStatus;
    deathStatus?: FactStatus;
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
    /** Sources cited under the (first) BIRT / DEAT block — the birth and death fields. */
    birthSourceRefs: string[];
    deathSourceRefs: string[];
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
    /** What the research knows (research files only). */
    research?: RawResearch;
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
    /** 1 _STROM_IMPORT: the import the couple came from (app files only). */
    importMark?: string;
    /** The family record's ids (see GedcomIndividual.fileIds). */
    fileIds?: OriginalIdLine[];
    /** The ids under each `1 _STROM_IMPORT Ix` (Strom's own files). */
    importIds?: RawOriginalIds[];
    /** Another program's own level-1 tags kept as written (spec 066 G8). */
    extras?: RawExtra[];
    /** The record's `0 @F1@ FAM` line in the file. */
    recordLine?: number;
    /**
     * The record's lines as written, from level 1 (not of the research's
     * files): only of a couple with another record, or of a record that
     * marries the two again after a divorce (see laterUnionStructures).
     */
    recordLines?: string[];
    /** 2 _STROM_IMPORT under MARR and DIV. */
    factImports?: Partial<Record<RawCoupleFact, RawImportMark[]>>;
    /** The research's origin of MARR and DIV (Strom's own files only). */
    factOrigins?: Partial<Record<RawCoupleFact, RawFactOrigin>>;
    /** CHIL > 2 _STROM_IMPORT: the import a child's link to these parents came from, by child. */
    childImports?: Map<string, string>;
    /** Every DATE of the wedding, divorce and events as written, by flex value (see noteDateForm). */
    dateForms?: Record<string, string>;
    /** The couple's events besides the wedding and the divorce (ENGA, MARB, CENS, EVEN…). */
    events: RawCoupleEvent[];
    husb: string | null;
    wife: string | null;
    children: string[];
    marriageDate: string;
    marriagePlace: string;
    /** MARR > ADDR, MARR > HUSB / WIFE > AGE (the first marriage that gives them). */
    marriageAddress?: string;
    husbAge?: string;
    wifeAge?: string;
    divorceDate: string;
    /** DIV > PLAC. */
    divorcePlace?: string;
    /** MARR / DIV > _STROM_STATUS (the first that gives one). */
    marriageStatus?: FactStatus;
    divorceStatus?: FactStatus;
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
    /**
     * 1 _RELATIONSHIP_STATUS (another program's word for the same thing), kept
     * only when statusFromStat knows its value; _STAT wins when both are there.
     */
    relationshipStatus?: string;
    /** The CHIL line being read (its _FREL/_MREL follow it). */
    lastChil?: string;
    /**
     * 1 _STROM_NO_COUPLE: the parents of these children who are not a couple
     * (one parent alone, or two who were never partners). Strom writes it for
     * parent links outside any partnership; read back, no partnership and no
     * stand-in partner is made.
     */
    noCouple?: boolean;
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
    /** Strom Research's place records (`0 @L0012@ _STROM_PLACE`), by id; only valid ones. */
    placeRecords?: Map<string, PlaceRecord>;
    /** Which record a place is (`2 PLAC` > `3 _STROM_PLACE @L0012@`), keyed by placeKey(). */
    placeRefs?: Map<string, string>;
    /** Surname-variant groups read from the header NOTE (see exporter marker). */
    surnameGroups: string[][];
    /** Rejected spelling suggestions read from their header NOTE (SURNAME_REJECTIONS_MARKER). */
    surnameRejections?: string[][];
    /**
     * Which of the two markers the header carried — even with no group under
     * it ("none", as the research writes it). A file without a marker says
     * nothing of that list (an older writer): the tree's own list stays.
     */
    surnameMarkers?: { groups: boolean; rejections: boolean };
    /** Header `1 _STROM_LINES`: the file says which lineage corrections there are. */
    lineageMarker?: boolean;
    /** Header `1 SOUR STROM_RESEARCH`: written by Strom Research. */
    stromResearch?: boolean;
    /** Header `1 _STROM_ASOF`: when the research wrote it (as written). */
    researchAsOf?: string;
    /** Header `1 SOUR STROM`: written by the Strom app. */
    stromApp?: boolean;
    /** What the header says of the program that wrote the file (HEAD > SOUR, DATE, FILE). */
    head?: GedcomHead;
    /** Header `1 _STROM_IMPORT Ix` records as written (app and research files only), for sanitizeImports. */
    stromImports?: Record<string, string>[];
    /** `0 @O1@ OBJE` media records, by xref: what `1 OBJE @O1@` links point at. */
    mediaRecords?: Map<string, RawMedia>;
}

/** The file's own header: the program that wrote it and when. */
export interface GedcomHead {
    /** HEAD > SOUR > NAME, else the SOUR value. */
    program?: string;
    /** HEAD > SOUR > VERS. */
    version?: string;
    /** HEAD > DATE, as written. */
    date?: string;
    /** HEAD > FILE. */
    file?: string;
}

/** What a loaded file is, for the origin of its facts (spec 066). */
export interface GedcomImportOrigin {
    /** The day it was loaded (ISO, local). */
    at: string;
    /** The file's name as picked. */
    file?: string;
    /** The encoding the import read it in. */
    encoding?: string;
    /** sha256 of the file's bytes (hex). */
    sha?: string;
}

/** Options of convertToStrom. */
export interface GedcomConvertOptions {
    /**
     * Record where the facts came from: a file another program wrote becomes
     * one import record (I1) and marks everything in it; a Strom file keeps the
     * records and marks it carries. Without it nothing is recorded.
     */
    importOrigin?: GedcomImportOrigin;
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
    /** The picture's date as the file wrote it (`_DATE`), for the photo or attachment it becomes. */
    date?: string;
}

export interface GedcomConversionResult {
    data: StromData;
    /** The import record made for this file (a file another program wrote, with importOrigin). */
    importId?: string;
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
        /** Individuals with SEX other than M/F (SEX U or none): imported with the sex unknown, never guessed. */
        unknownSexPersons: number;
        /**
         * Children recorded in more than one family (born to one, adopted into
         * another). The tree draws one set of parents; the others became a note
         * on the child.
         */
        otherFamilyLinks: number;
        /**
         * Family records of a couple that already has one (a record per
         * wedding): joined to that couple's partnership, their weddings kept
         * for "Back to {prog}".
         */
        joinedFamilies: number;
        /**
         * Media not carried over: embedded ones of another type (only images and
         * PDFs come in), a link to a media record the file does not have, a
         * record with no file, a record no person or source takes.
         */
        skippedMedia: number;
        /** Another program's own level-1 tags kept for "Back to {prog}" (spec 066 G8). */
        keptTags: number;
        /** Their tags, most frequent first ("_FOO, _BAR"). Empty when none. */
        keptTagSummary: string;
        totalGedFamilies: number;
    };
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Remember how a record wrote a date (Person / Partnership `gedcomDates`).
 * Every DATE counts, so a value written in two ways in one record is known
 * as such ('') and keeps neither.
 */
function noteDateForm(record: { dateForms?: Record<string, string> }, raw: string, date: string): void {
    if (!date) return;
    const v = raw.trim().replace(/\s+/g, ' ');
    const forms = record.dateForms ??= {};
    forms[date] = forms[date] === undefined || forms[date] === v ? v : '';
}

/**
 * The record's dates the app's own form would write differently, in their
 * GEDCOM keyword form (Person / Partnership `gedcomDates`), or undefined.
 */
function keptDateForms(forms: Record<string, string> | undefined): Record<string, string> | undefined {
    const kept = Object.entries(forms ?? {})
        .filter(([date, v]) => isGedcomDateFormOf(date, v) && formatGedcomDate(date) !== v);
    return kept.length > 0 ? Object.fromEntries(kept) : undefined;
}

/**
 * Generate unique ID with prefix
 */
function generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${uniqueIdSuffix()}`;
}

// ==================== ENCODING ====================

/**
 * ANSEL (ANSI Z39.47 / MARC-8 extended Latin) -> Unicode, spacing characters.
 * Includes the GEDCOM additions (0xBE, 0xBF, 0xCD, 0xCE and 0xCF ß).
 */
const ANSEL_SPACING: Record<number, string> = {
    0xA1: 'Ł', 0xA2: 'Ø', 0xA3: 'Đ', 0xA4: 'Þ', 0xA5: 'Æ',
    0xA6: 'Œ', 0xA7: 'ʹ', 0xA8: '·', 0xA9: '♭', 0xAA: '®',
    0xAB: '±', 0xAC: 'Ơ', 0xAD: 'Ư', 0xAE: 'ʼ',
    0xB0: 'ʻ', 0xB1: 'ł', 0xB2: 'ø', 0xB3: 'đ', 0xB4: 'þ',
    0xB5: 'æ', 0xB6: 'œ', 0xB7: 'ʺ', 0xB8: 'ı', 0xB9: '£',
    0xBA: 'ð', 0xBC: 'ơ', 0xBD: 'ư',
    // The LDS extensions of the GEDCOM 5.5 ANSEL table: empty and black box,
    // midline e and o (written as the letters, as Gramps reads them too).
    0xBE: '\u25A1', 0xBF: '\u25A0',
    0xC0: '°', 0xC1: 'ℓ', 0xC2: '℗', 0xC3: '©', 0xC4: '♯',
    0xC5: '¿', 0xC6: '¡',
    // MARC-21's later additions: eszett and the euro sign.
    0xC7: 'ß', 0xC8: '€',
    0xCD: 'e', 0xCE: 'o', 0xCF: 'ß',
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

/** Encodings a GEDCOM file can be read in (the import summary offers the single-byte ones). */
export type GedcomEncoding =
    | 'utf-8' | 'utf-16le' | 'utf-16be' | 'ansel' | 'windows-1250' | 'windows-1252' | 'iso-8859-2';

/** The encodings the import summary lets a person switch between, in menu order. */
export const GEDCOM_ENCODING_CHOICES: readonly GedcomEncoding[] =
    ['utf-8', 'windows-1250', 'windows-1252', 'iso-8859-2', 'ansel'];

/** A decoded GEDCOM file and how its encoding was settled. */
export interface GedcomDecoding {
    text: string;
    encoding: GedcomEncoding;
    /** The HEAD > CHAR value as written in the file, or null when it names none. */
    declared: string | null;
    /** bom = byte order mark; declared = CHAR named it; content = guessed from the bytes; chosen = forced by the caller. */
    how: 'bom' | 'declared' | 'content' | 'chosen';
    /** The file has bytes outside ASCII, i.e. the encoding matters for the text at all. */
    nonAscii: boolean;
}

/** CHAR values (upper-cased, spaces and underscores dropped) that name one encoding outright. */
const DECLARED_ENCODINGS: Record<string, GedcomEncoding> = {
    'ANSEL': 'ansel',
    'UTF-8': 'utf-8', 'UTF8': 'utf-8',
    'CP1250': 'windows-1250', 'CP-1250': 'windows-1250', 'WINDOWS-1250': 'windows-1250',
    'WINDOWS1250': 'windows-1250', 'WIN1250': 'windows-1250', 'WIN-1250': 'windows-1250', 'MS-EE': 'windows-1250',
    'CP1252': 'windows-1252', 'CP-1252': 'windows-1252', 'WINDOWS-1252': 'windows-1252',
    'WINDOWS1252': 'windows-1252', 'WIN1252': 'windows-1252', 'WIN-1252': 'windows-1252',
    // Browsers decode latin1 as windows-1252 anyway (a superset for text).
    'ISO-8859-1': 'windows-1252', 'ISO8859-1': 'windows-1252', 'LATIN1': 'windows-1252', 'LATIN-1': 'windows-1252',
    'ISO-8859-2': 'iso-8859-2', 'ISO8859-2': 'iso-8859-2', 'LATIN2': 'iso-8859-2', 'LATIN-2': 'iso-8859-2',
};

function isValidUtf8(bytes: Uint8Array): boolean {
    try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        return true;
    } catch {
        return false;
    }
}

// Byte classes for telling Windows-1250 (Central Europe) from Windows-1252
// (Western Europe) when a file only says "ANSI". The two code pages agree on
// á é í ó ú ý ä ö ü ß š ž and differ on the rest.
/** Letters in 1250 (ť ź Ť Ź Ł Ą Ż ł ą ľ Ľ ż), symbols or nothing in 1252 (¹ ³ ¿ £ …): a strong 1250 sign. */
const CP1250_ONLY_LETTERS = new Set([0x8D, 0x8F, 0x9D, 0x9F, 0xA3, 0xA5, 0xAF, 0xB3, 0xB9, 0xBC, 0xBE, 0xBF]);
/** Czech and Slovak letters (č ě ř ů ň ď and capitals) that read as è ì ø ù ò ï in 1252. */
const CP1250_CORE = new Set([0xE8, 0xEC, 0xF8, 0xF9, 0xF2, 0xEF, 0xC8, 0xCC, 0xD8, 0xD9, 0xD2, 0xCF]);
/** Same byte in both code pages, frequent in Czech and Slovak words: š ž Š Ž á í ý ú Á Í Ý Ú. */
const CENTRAL_COMPANIONS = new Set([0x8A, 0x8E, 0x9A, 0x9E, 0xE1, 0xED, 0xFD, 0xFA, 0xC1, 0xCD, 0xDD, 0xDA]);
/** Western companions of è and friends: à ç ê é À Ç Ê É œ Œ. */
const WESTERN_COMPANIONS = new Set([0xE0, 0xE7, 0xEA, 0xE9, 0xC0, 0xC7, 0xCA, 0xC9, 0x9C, 0x8C]);
/** Italian/French final grave vowels: à è ì ò ù. */
const WESTERN_FINAL = new Set([0xE0, 0xE8, 0xEC, 0xF2, 0xF9]);

function isWordByte(b: number): boolean {
    return (b >= 0x41 && b <= 0x5A) || (b >= 0x61 && b <= 0x7A)
        || (b >= 0xC0 && b !== 0xD7 && b !== 0xF7)
        || b === 0x8A || b === 0x8C || b === 0x8E || b === 0x9A || b === 0x9C || b === 0x9E
        || CP1250_ONLY_LETTERS.has(b);
}

/**
 * Guess between Windows-1250 and Windows-1252 from the words of the file.
 * A word votes 1250 when it holds a letter only 1250 has (ł ą ż ť …) or a
 * Czech/Slovak letter next to š ž á í ý ú ("Kučerová", "Dvořák"); it votes
 * 1252 when è-like letters sit next to Western companions ("Thérèse",
 * "François") or end an Italian/French word ("Niccolò"). Words with neither
 * ("Matěj") do not vote. No votes keeps the GEDCOM meaning of ANSI (1252).
 */
export function guessSingleByteEncoding(bytes: Uint8Array): 'windows-1250' | 'windows-1252' {
    let votes1250 = 0;
    let votes1252 = 0;
    let i = 0;
    while (i < bytes.length) {
        if (!isWordByte(bytes[i])) { i++; continue; }
        const start = i;
        while (i < bytes.length && isWordByte(bytes[i])) i++;
        let strong = false, core = false, central = false, western = false;
        for (let j = start; j < i; j++) {
            const b = bytes[j];
            if (CP1250_ONLY_LETTERS.has(b)) {
                // Spanish "¿Quién": ¿ opens a word and a capital follows; Polish
                // "żona" has a small letter after ż.
                const next = bytes[j + 1] ?? 0;
                if (!(b === 0xBF && j === start && !(next >= 0x61 && next <= 0x7A))) strong = true;
            }
            if (CP1250_CORE.has(b)) core = true;
            if (CENTRAL_COMPANIONS.has(b)) central = true;
            if (WESTERN_COMPANIONS.has(b)) western = true;
        }
        const last = bytes[i - 1];
        const finalGrave = i - start >= 3 && WESTERN_FINAL.has(last) && bytes[i - 2] < 0x80;
        if (strong || (core && central)) votes1250++;
        else if (core && (western || finalGrave)) votes1252++;
    }
    return votes1250 > votes1252 ? 'windows-1250' : 'windows-1252';
}

function decodeAs(bytes: Uint8Array, encoding: GedcomEncoding): string {
    if (encoding === 'ansel') return decodeAnsel(bytes);
    return new TextDecoder(encoding).decode(bytes);
}

/**
 * Decode a raw GEDCOM file, honouring what the file says about itself: a BOM
 * wins outright, otherwise the HEAD > CHAR declaration decides (its line is
 * ASCII-compatible in every charset GEDCOM allows, so peeking at the header
 * bytes is safe). ANSEL gets the real decoder above. "ANSI" means the Windows
 * code page of the computer that wrote it: valid UTF-8 stays UTF-8, otherwise
 * the bytes decide between Central (1250: č ř ě) and Western (1252) Europe.
 * A file without CHAR, or with CHAR UTF-8 that is not valid UTF-8, is guessed
 * the same way. `forced` overrides everything (the summary's encoding menu).
 */
export function decodeGedcomBytes(buffer: ArrayBuffer, forced?: GedcomEncoding): GedcomDecoding {
    const bytes = new Uint8Array(buffer);
    const nonAscii = bytes.some(b => b >= 0x80);

    // Peek HEAD for "1 CHAR <value>". NULs are stripped so a BOM-less UTF-16
    // header still matches; latin1 maps every byte so decoding cannot throw.
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096)).replace(/\0/g, '');
    const charMatch = /^\s*1\s+CHAR\s+(.+?)\s*$/m.exec(head);
    const declared = charMatch?.[1] ?? null;
    const result = (encoding: GedcomEncoding, how: GedcomDecoding['how'], body: Uint8Array = bytes): GedcomDecoding =>
        ({ text: decodeAs(body, encoding), encoding, declared, how, nonAscii });

    if (forced) {
        // A forced single-byte or UTF-8 reading must not keep a BOM as text.
        const skip = forced === 'utf-8' && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF ? 3 : 0;
        return result(forced, 'chosen', bytes.subarray(skip));
    }
    if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return result('utf-8', 'bom');
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) return result('utf-16le', 'bom');
    if (bytes[0] === 0xFE && bytes[1] === 0xFF) return result('utf-16be', 'bom');

    const charset = (declared ?? '').toUpperCase().replace(/[\s_]+/g, '');
    if (charset === 'UNICODE' || charset === 'UTF-16' || charset === 'UTF16') {
        // No BOM to tell the byte order: the first character of a GEDCOM is
        // ASCII ('0'), so a leading zero byte means big-endian.
        return result(bytes[0] === 0 ? 'utf-16be' : 'utf-16le', 'declared');
    }
    const named = DECLARED_ENCODINGS[charset];
    if (named && named !== 'utf-8') return result(named, 'declared');
    // UTF-8, ANSI, ASCII, unknown or no CHAR: valid UTF-8 is UTF-8 (a
    // single-byte Central European text is practically never valid UTF-8).
    if (!nonAscii) return result(named ?? 'utf-8', named ? 'declared' : 'content');
    if (isValidUtf8(bytes)) return result('utf-8', named === 'utf-8' ? 'declared' : 'content');
    return result(guessSingleByteEncoding(bytes), 'content');
}

/**
 * A few full names of a converted file for the import summary's encoding row:
 * names with non-ASCII letters first (they show whether the encoding fits),
 * no repeats, at most `max`.
 */
export function gedcomSampleNames(data: StromData, max = 5): string[] {
    const seen = new Set<string>();
    const all: string[] = [];
    for (const p of Object.values(data.persons)) {
        if (p.isPlaceholder) continue;
        const name = [p.firstName, p.lastName].filter(Boolean).join(' ').trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        all.push(name);
    }
    const accented = all.filter(n => /[^\x00-\x7F]/.test(n));
    return [...accented, ...all.filter(n => !/[^\x00-\x7F]/.test(n))].slice(0, max);
}

/** Decode a raw GEDCOM file to text (see decodeGedcomBytes). */
export function decodeGedcomFile(buffer: ArrayBuffer): string {
    return decodeGedcomBytes(buffer).text;
}

// ==================== MAIN PARSER ====================

/** A cross-reference pointer value (@I1@, @N12@ …). */
const GED_POINTER = /^@[^@\s]+@$/;

/** One physical GEDCOM line, split into its parts. */
interface GedLine {
    level: number;
    tag: string;
    value: string;
    /** Index of its (first) physical line in the file: kept tags are taken from the file as written. */
    src: number;
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
    for (let src = 0; src < lines.length; src++) {
        const line = lines[src];
        const match = line.match(/^(\d+)\s+(@[^@\s]+@|\w+)\s*(.*)?$/);
        if (!match) continue;
        let tag = match[2];
        // A CONC line continues its value mid-text: what follows the one
        // delimiter is the text, a leading space included (a writer with no
        // other place to cut puts it there; trimming glued two words together).
        const conc = tag === 'CONC' ? /^\d+\s+CONC (.*)$/.exec(line) : null;
        // GEDCOM escapes a literal '@' as '@@' (pointers never contain it).
        const value = (conc ? conc[1].trimEnd() : (match[3] || '').trim()).replace(/@@/g, '@');
        // GEDCOM 7 shared-note pointer: the same thing as a NOTE pointer.
        if (tag === 'SNOTE' && GED_POINTER.test(value)) tag = 'NOTE';
        parsed.push({ level: parseInt(match[1]), tag, value, src });
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
                records.push({ level: 0, tag: rec.tag, value: m[1], src: rec.src });
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
            records.push({ level: rec.level, tag: rec.tag, value, src: rec.src });
            continue;
        }
        records.push(rec);
    }
    return { records, noteRecords, inlineSources };
}

/** NAME sub-tags that carry the name's own parts, and where each is kept. */
const NAME_PART_TAGS = new Map<string, keyof GedcomNameParts>([
    ['GIVN', 'givn'], ['SURN', 'surn'], ['SPFX', 'spfx'], ['NPFX', 'npfx'], ['NSFX', 'nsfx'],
]);

/**
 * Parse GEDCOM file content into structured data
 */

/**
 * The surname after marriage of a person whose names are read (after the swap
 * of a married name put first): the LAST NAME with TYPE married in file order
 * takes it, and that name leaves the other spellings (earlier married names
 * stay there); without one, the last _MARNM (level 1 or under a NAME). A
 * person whose primary name is the married one with no birth name beside it
 * keeps it as the surname, the field stays empty (the birth surname is not
 * known). Another spelling that is just the given name with the married
 * surname (an older Strom's or research's file wrote it so) is dropped too:
 * it would only repeat the field.
 */
function readMarriedSurname(
    indi: GedcomIndividual,
    opts: { fromStrom: boolean; unknownIsNoSurname: boolean },
): void {
    if (indi.primaryNameType === 'married') return;
    let married = '';
    let marriedGiven = '';
    // The mark of the name the person goes by: on the birth name (the
    // primary one), on the married name taken here, or elsewhere (nothing).
    let markedMarried = false;
    const dropVariant = (k: number): void => {
        indi.nameVariants.splice(k, 1);
        indi.variantNameTypes.splice(k, 1);
        indi.variantNameParts.splice(k, 1);
        if (indi.primaryMark === undefined || indi.primaryMark < k) return;
        if (indi.primaryMark === k) { markedMarried = true; indi.primaryMark = undefined; }
        else indi.primaryMark--;
    };
    for (let k = indi.variantNameTypes.length - 1; k >= 0; k--) {
        if (indi.variantNameTypes[k] !== 'married') continue;
        const read = readGedcomName(indi.nameVariants[k], indi.variantNameParts[k], { ...opts, descriptions: false });
        if (!read.lastName) continue;
        married = read.lastName;
        // Given names of its own ("Jana Kateřina /Nováková/" beside "Jana /…/") stay with it.
        if (read.firstName && read.firstName !== '?' && read.firstName.trim() !== (indi.firstName ?? '').trim()) marriedGiven = read.firstName.trim();
        dropVariant(k);
        break;
    }
    if (!married) {
        for (let k = indi.marnm.length - 1; k >= 0 && !married; k--) {
            const v = indi.marnm[k];
            married = (v.includes('/') ? readGedcomName(v, {}, { ...opts, descriptions: false }).lastName : v.replace(/\s+/g, ' ')).trim();
        }
    }
    if (!married) return;
    indi.marriedSurname = married;
    if (marriedGiven) indi.marriedFirstName = marriedGiven;
    // "Marie Nováková" beside the field says nothing more.
    const key = (v: string): string => v.replace(/\//g, ' ').replace(/\s+/g, ' ').trim().normalize('NFC').toLocaleLowerCase();
    const repeat = key(`${marriedGiven || indi.firstName} ${married}`);
    for (let k = indi.nameVariants.length - 1; k >= 0; k--) {
        if (key(indi.nameVariants[k]) !== repeat) continue;
        // A mark there is on the married name too (it is that name).
        dropVariant(k);
    }
    if (indi.primaryMark === -1) indi.primaryName = 'birth';
    else if (markedMarried) indi.primaryName = 'married';
}

/** Level-1 INDI tags the parser understands (everything else is counted as dropped). */
const KNOWN_INDI_TAGS = new Set(['NAME', 'SEX', 'FAMS', 'FAMC', 'NOTE', 'SOUR', 'BIRT', 'DEAT', 'OBJE', 'REFN', 'ASSO', '_STORY', '_QUESTION', '_MARNM',
    ...Object.keys(EVENT_TAG_TO_TYPE)]);
/** Level-1 FAM tags the parser understands. */
const KNOWN_FAM_TAGS = new Set(['HUSB', 'WIFE', 'CHIL', 'NOTE', 'MARR', 'DIV', 'SOUR', '_STORY', '_STAT', '_RELATIONSHIP_STATUS']);
/** Level-0 record types (handled or structural). */
/**
 * Labels for ALTERNATIVE birth/death facts. Platforms (MyHeritage) allow several
 * BIRT/DEAT records per person; the first fills the dedicated date fields and
 * the rest are kept as labelled CUSTOM events — 'birth'/'death' event types are
 * reserved for the date fields (validation flags them as a data-entry mistake).
 */
// Labels are read from strings at USE time (not module load) so the note lands
// in the app's current language — see each call site.

/** HEAD > 1 _STROM_IMPORT Ix: the lines under it, by the record's field. */
const HEAD_IMPORT_FIELDS: Record<string, string> = {
    SOUR: 'program', VERS: 'version', DATE: 'fileDate', _AT: 'at', FILE: 'file', _SHA: 'sha',
};

const KNOWN_RECORD_TYPES = new Set(['INDI', 'FAM', 'SOUR', 'REPO', 'HEAD', 'TRLR', 'SUBM', 'SUBN', 'NOTE', 'SNOTE', 'OBJE']);

/** A `_STROM_IMG_OMITTED` value: the research's reason, or `other` for one this app does not know. */
export function imageHeldReason(value: string): SourceImageHeld {
    const why = value.trim().toLowerCase();
    return why === 'scope' || why === 'limit' || why === 'later' || why === 'missing' ? why : 'other';
}

/**
 * Pure bookkeeping tags (platform sync ids, change stamps). Ignored WITHOUT
 * counting them as unsupported — a MyHeritage export carries three of these
 * per person and the "1079 unsupported records" number needlessly scared
 * migrating users even though no user data was involved. GEDCOM 7 adds its
 * own: UID (a record's lasting id), CREA (when the record was created, with
 * DATE/TIME under it) and EXID (the record's id in another system, TYPE under
 * it) — ids and stamps of the program that wrote the file, not of the family.
 * On a person and a family the ids (`_UID`, `UID`, `RIN`, `EXID`, with
 * `_FSFTID` and `AFN`) are kept as its original ids (ORIGINAL_ID_TAGS, read
 * before this set is asked); elsewhere they are ignored.
 */
const IGNORED_BOOKKEEPING_TAGS = new Set(['_UPD', 'RIN', '_UID', 'CHAN', '_PROJECT_GUID', '_EXPORTED_FROM_SITE_ID',
    'UID', 'CREA', 'EXID']);

/**
 * Bookkeeping another program wants back on its records: MyHeritage's change
 * stamp (`1 _UPD`) of a person, a family, a source. Kept as written for "Back
 * to {prog}" like the program's other own tags, but, being bookkeeping, never
 * named in the import's summary (spec 066 K3.1).
 */
const KEPT_BOOKKEEPING_TAGS: ReadonlySet<string> = new Set(['_UPD']);

/**
 * MyHeritage's bookkeeping under a photo: its size, its record numbers (of
 * the photo, of the photo a face was cut from) and where a face sits on it
 * (the cut-out's position, the photo it was cut from). A MyHeritage export
 * carries several per photo; counted, they made hundreds of "unsupported"
 * lines out of photos that came in. Not counted either.
 */
const IGNORED_MEDIA_BOOKKEEPING_TAGS = new Set(['_FILESIZE', '_PHOTO_RIN', '_PARENTRIN',
    '_POSITION', '_CUTOUT', '_PRIM_CUTOUT', '_PARENTPHOTO', '_PERSONALPHOTO']);

/**
 * Where a face sits on a photo, under any photo (of a person, an event, a
 * family): MyHeritage names these after the photo they belong to
 * (`_MH_EVENT_PHOTO_CUTOUT_POSITION` under an event's photo), so a rule
 * takes them, not a list — every `_` tag with a CUTOUT part, and every one
 * with a PHOTO part that ends in POSITION. A POSITION without a photo in its
 * name (a job's, a rank's) stays counted.
 */
const MEDIA_CUTOUT_TAG = /^_(?:[A-Z0-9]+_)*CUTOUT(?:_[A-Z0-9]+)*$|^_(?:[A-Z0-9]+_)*PHOTO(?:_[A-Z0-9]+)*_POSITION$/;

/**
 * The `_` tags this reader takes somewhere (spec 066 G8), Strom's own
 * `_STROM_…` aside. A deeper `_XXX` (level 2 or more) of another program's
 * file that is none of them, and not under a line already kept or counted,
 * is counted as not carried over (it used to vanish without a word). A test
 * keeps the list complete: every `'_XXX'` the reader names is in it.
 */
export const GEDCOM_READ_UNDERSCORE_TAGS: ReadonlySet<string> = new Set([
    '_ACCESS', '_AT', '_BASIS', '_BOOK', '_BY', '_CHOSEN', '_CONF', '_CONFLICT', '_COST', '_COVERED', '_DATE', '_DRAFT', '_DUP',
    '_END', '_EST', '_EXPORTED_FROM_SITE_ID', '_FAM', '_FREL', '_FSFTID', '_GEN', '_HELD', '_HYPO', '_INTREE', '_ISLAND',
    '_JOIN', '_LAST', '_LEVEL', '_LINK', '_MARNM', '_MILI', '_MILT', '_MREL', '_NEXT', '_NORECORDS', '_PAR', '_PART',
    '_PARTIAL', '_PERS', '_PERSONALPHOTO', '_POS', '_PRIM', '_PRIMARY', '_PROJECT_GUID', '_QUESTION', '_RECORDS', '_REF',
    '_RELATIONSHIP_STATUS', '_RESEARCH', '_SCOPE', '_SEARCHES', '_SESSIONS', '_SOUR', '_STAT', '_STORY', '_TASK', '_TEST',
    '_TRIED', '_TXT', '_UID', '_UNTIL', '_UPD', '_URL', '_VAR', '_WITN', '_XREF',
]);

/** Another program's `_XXX` the reader takes nowhere (and no bookkeeping, no id). */
export function isUnreadUnderscoreTag(tag: string): boolean {
    return tag.startsWith('_') && !tag.startsWith('_STROM_') && !GEDCOM_READ_UNDERSCORE_TAGS.has(tag)
        && !IGNORED_BOOKKEEPING_TAGS.has(tag) && !IGNORED_MEDIA_BOOKKEEPING_TAGS.has(tag) && !MEDIA_CUTOUT_TAG.test(tag)
        && !ORIGINAL_ID_TAGS.has(tag);
}

/** A data URL inside a line: never kept outside the photos and attachments it makes. */
const DATA_URL_IN_LINE = /data:[^,;\s]*;base64,/i;

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
 * Words for a relationship status in the files of other programs (English,
 * and the Polish, German and Czech ones a program in those languages writes).
 * A registered or civil partnership is no marriage: partners.
 */
const STATUS_WORDS: Record<PartnershipStatus, readonly string[]> = {
    married: ['married', 'marriage', 'małżeństwo', 'małżonkowie', 'żonaci', 'verheiratet', 'ehe', 'ehepaar',
        'manželé', 'manželství', 'sezdaní'],
    divorced: ['divorced', 'divorce', 'rozwiedzeni', 'rozwód', 'geschieden', 'scheidung', 'rozvedeni', 'rozvedení', 'rozvod'],
    separated: ['separated', 'separation', 'w separacji', 'separacja', 'getrennt', 'getrennt lebend',
        'odloučeni', 'odloučení', 'odluka', 'v odluce'],
    partners: ['partners', 'partner', 'unmarried', 'unmarried couple', 'never married', 'cohabiting', 'living together',
        'domestic partnership', 'common law', 'common-law', 'civil union', 'civil partnership', 'registered partnership',
        'partnerzy', 'związek nieformalny', 'związek partnerski', 'konkubinat',
        'partnerschaft', 'lebensgemeinschaft', 'lebenspartnerschaft', 'eingetragene lebenspartnerschaft',
        'nichteheliche lebensgemeinschaft', 'unverheiratet',
        'partneři', 'partnerství', 'registrované partnerství', 'druh a družka', 'nesezdaní'],
};

/**
 * 1 _STAT (Strom's own tag, also written by Legacy and FTM in similar words)
 * or 1 _RELATIONSHIP_STATUS -> the relationship status, or undefined for a
 * value it does not name. MARR/DIV can only say married or divorced;
 * partners and separated need it.
 */
function statusFromStat(value: string | undefined): PartnershipStatus | undefined {
    const v = (value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
    if (!v) return undefined;
    for (const status of ['married', 'divorced', 'separated', 'partners'] as const) {
        if (STATUS_WORDS[status].includes(v)) return status;
    }
    return undefined;
}

/** The line of the couple's note that says they divorced and married again. */
function remarriageLine({ divorced, married }: { divorced: string; married: string }): string {
    return divorced ? strings.gedcomNotes.remarriage(divorced, married) : strings.gedcomNotes.remarriageNoDate(married);
}

/** A line that names a record by its xref (the export renumbers them; a calendar's escape, `@#DJULIAN@`, is none). */
const NAMES_A_RECORD = /^\d+ @|\s@[^@#\s][^@\s]*@/;

/** A record's lines from level 1, as one list per level-1 structure. */
function structuresOf(lines: readonly string[]): string[][] {
    const out: string[][] = [];
    for (const line of lines) {
        if (line.startsWith('1 ')) out.push([line]);
        else out[out.length - 1]?.push(line);
    }
    return out;
}

/** A structure without its lines that name a record, and the lines under those. */
function withoutRecordPointers(structure: readonly string[]): string[] {
    const out: string[] = [];
    let below = -1;
    for (const line of structure) {
        const level = Number(/^(\d+)/.exec(line)?.[1] ?? 0);
        if (below >= 0 && level > below) continue;
        below = -1;
        if (NAMES_A_RECORD.test(line)) { below = level; continue; }
        out.push(line);
    }
    return out;
}

/**
 * A family record's weddings and divorces after its first wedding, as
 * written, while the first of them is a divorce (MARR / DIV / MARR: the
 * couple married again). null when there is none, or a line names a record.
 */
function laterUnionStructures(fam: GedcomFamily): string[] | null {
    const union = structuresOf(fam.recordLines ?? []).filter(st => /^1 (MARR|DIV)( |$)/.test(st[0]));
    const first = union.findIndex(st => /^1 MARR( |$)/.test(st[0]));
    const later = first < 0 ? [] : union.slice(first + 1);
    if (later.length === 0 || !/^1 DIV( |$)/.test(later[0][0]) || later.flat().some(l => NAMES_A_RECORD.test(l))) return null;
    return later.flat();
}

/**
 * The line a remarriage became in the couple's note, kept with the record's
 * later weddings and divorces as written (NOTED_TAG): "Back to {prog}"
 * writes them in place of the line. What a divorce's own details became in
 * the note (its NOTE, a date the field could not hold) goes with them.
 * Returns whether it was kept.
 */
function noteRemarriage(fam: GedcomFamily, line: string): boolean {
    const later = laterUnionStructures(fam);
    if (!later) return false;
    const divorceOf = (e: RawExtra): boolean =>
        e.tag === NOTED_TAG && /^1 DIV( |$)/.test(notedStructures(e.lines)[0]?.lines[0] ?? '');
    const divorces = (fam.extras ?? []).filter(divorceOf);
    const block = notedBlock([line, ...divorces.flatMap(e => notedStructures(e.lines)[0].texts)], later);
    if (!block) return false;
    fam.extras = [...(fam.extras ?? []).filter(e => !divorceOf(e)), { tag: NOTED_TAG, lines: block, quiet: true }];
    return true;
}

/**
 * Another record of a couple the import joins to the first one (see
 * JOINED_TAG): its weddings, divorces and ids as written, the lines naming
 * a record left out, and its change stamp. Its xref is the one the file gave it (a Strom file's:
 * the one its program gave it). The other kept lines of the record go to the
 * partnership, except those of a wedding or a divorce noted (the block has them).
 */
function keepJoinedRecord(gedFamId: string, fam: GedcomFamily, marks: JoinedMarks): boolean {
    if (!fam.recordLines) return false;
    const own = fam.importIds?.find(b => b.xref)?.xref ?? gedFamId;
    const xref = /^@([^@]+)@$/.exec(own)?.[1] ?? '';
    const structures = structuresOf(fam.recordLines)
        .filter(st => /^1 (MARR|DIV|REFN|NOTE|NCHI)( |$)/.test(st[0]) || ORIGINAL_ID_TAGS.has(st[0].split(' ')[1])
            || KEPT_BOOKKEEPING_TAGS.has(st[0].split(' ')[1]));
    const kept = structures.map(withoutRecordPointers);
    // A note it names by xref (a NOTE record) the block cannot write: its lines stay in the couple's note.
    const notes = (st: readonly string[]): string[] => st.filter(l => /^(1 (NOTE|NCHI)|2 NOTE)( |$)/.test(l));
    const noteLost = structures.some((st, i) => notes(st).length !== notes(kept[i]).length);
    const block = joinedBlock(xref.startsWith('__') ? '' : xref, kept.flat(), noteLost ? {} : marks);
    if (!block) return false;
    // What of it became lines of the couple's note the block writes itself (its
    // notes, its weddings and divorces as written); its change stamp (`_UPD`)
    // is the record's own: in the block, not the partnership's.
    fam.extras = [...(fam.extras ?? []).filter(e => e.tag !== NOTED_TAG && !KEPT_BOOKKEEPING_TAGS.has(e.tag)),
        { tag: JOINED_TAG, lines: block, quiet: true }];
    return true;
}

/** Put the resolved marriage/divorce outcome onto a partnership. */
function applyUnionOutcome(partnership: Partnership, fam: GedcomFamily): void {
    const outcome = resolveUnionStatus(fam);
    if (outcome.startDate) partnership.startDate = outcome.startDate;
    if (outcome.endDate) partnership.endDate = outcome.endDate;
    // An explicit status wins over what MARR/DIV imply: a couple of partners
    // whose start date rides on MARR (the only place for it) is not married.
    partnership.status = statusFromStat(fam.stat) ?? statusFromStat(fam.relationshipStatus) ?? outcome.status;
    if (outcome.remarriage) {
        const line = remarriageLine(outcome.remarriage);
        partnership.note = partnership.note ? `${partnership.note}\n${line}` : line;
        // "Back to {prog}" writes the divorce (with its place) and the
        // wedding again as written, not the line.
        if (noteRemarriage(fam, line)) { delete partnership.endPlace; delete partnership.endStatus; }
    }
}

/**
 * A GEDCOM 5.5.1 coordinate ("N50.088", "W14.421") or a bare signed number back
 * to a plain degree value. Returns null for anything unparseable so a malformed
 * MAP block is skipped rather than poisoning the place with NaN.
 */
/** A Strom Research place record being read (`0 @L0012@ _STROM_PLACE`), as raw values for sanitizePlaceRecord. */
interface OpenPlaceRecord {
    id: string;
    names: { name: string; lang?: string; from?: number; to?: number; kind?: string }[];
    lat?: number;
    lon?: number;
    jurisdictions: { kind: string; name: string; from?: number; to?: number }[];
    parent?: string;
    by?: string;
    at?: string;
    why?: string;
    source?: { title: string; url?: string };
    verified?: string;
    unlocated?: string;
    needs?: string;
    /** The level-1 tag the following level-2 lines belong to. */
    sub: string | null;
}

/** "FROM 1784", "TO 1945", "FROM 1784 TO 1850" → the years; anything else → none. */
function placeRecordSpan(value: string): { from?: number; to?: number } {
    const m = /^(?:FROM\s+(\d{1,4}))?\s*(?:TO\s+(\d{1,4}))?$/i.exec(value.trim());
    if (!m || (!m[1] && !m[2])) return {};
    return { ...(m[1] ? { from: Number(m[1]) } : {}), ...(m[2] ? { to: Number(m[2]) } : {}) };
}

/** Appends a CONT/CONC line to a text, up to the limit (beyond it the text is cut off, not grown). */
function continueText(text: string | undefined, tag: string, value: string, max: number): string | undefined {
    if (text === undefined) return text;
    const next = text + (tag === 'CONT' ? '\n' : '') + value;
    return next.length > max ? next.slice(0, max) : next;
}

/**
 * Reads one line under a `_STROM_PLACE` record (spec 034, the research's
 * tags). Lines it does not know are skipped silently — the record is the
 * research's, and nothing of it is a fact the import would lose.
 */
function readPlaceRecordLine(rec: OpenPlaceRecord, level: number, tag: string, value: string): void {
    if (level === 1) {
        rec.sub = tag;
        switch (tag) {
            case 'NAME':
                if (value && rec.names.length < 30) rec.names.push({ name: value });
                break;
            case '_STROM_JUR': {
                const m = /^(\S+)\s+(.+)$/.exec(value);
                if (m && rec.jurisdictions.length < 30) rec.jurisdictions.push({ kind: m[1].toLowerCase(), name: m[2] });
                break;
            }
            case '_STROM_IN': {
                const id = value.replace(/^@|@$/g, '');
                if (isPlaceRecordId(id)) rec.parent = id;
                break;
            }
            case '_STROM_BY': rec.by = value.toLowerCase(); break;
            case '_STROM_AT': rec.at = value; break;
            case '_STROM_WHY': rec.why = value; break;
            case '_STROM_SRC': rec.source = { title: value }; break;
            case '_STROM_VERIFIED': rec.verified = value; break;
            case '_STROM_UNLOCATED': rec.unlocated = value; break;
        }
        return;
    }
    if (level !== 2) return;
    const lastName = rec.names[rec.names.length - 1];
    const lastJur = rec.jurisdictions[rec.jurisdictions.length - 1];
    if (rec.sub === 'NAME' && lastName) {
        if (tag === 'LANG') lastName.lang = value.toLowerCase();
        else if (tag === 'DATE') Object.assign(lastName, placeRecordSpan(value));
        else if (tag === 'TYPE') lastName.kind = value.trim().toLowerCase();
    } else if (rec.sub === '_STROM_JUR' && lastJur && tag === 'DATE') {
        Object.assign(lastJur, placeRecordSpan(value));
    } else if (rec.sub === 'MAP' && (tag === 'LATI' || tag === 'LONG')) {
        const coord = parseGedcomCoord(value);
        if (coord !== null) { if (tag === 'LATI') rec.lat = coord; else rec.lon = coord; }
    } else if (rec.sub === '_STROM_WHY' && (tag === 'CONT' || tag === 'CONC')) {
        rec.why = continueText(rec.why, tag, value, PLACE_TEXT_LIMITS.why + 1);
    } else if (rec.sub === '_STROM_SRC' && rec.source) {
        if (tag === 'WWW' || tag === 'URL') rec.source.url = value;
        else if (tag === 'CONT' || tag === 'CONC') rec.source.title = continueText(rec.source.title, tag, value, PLACE_TEXT_LIMITS.title + 1) ?? '';
    } else if (rec.sub === '_STROM_UNLOCATED' && tag === '_STROM_NEEDS') {
        rec.needs = value;
    }
}

/** The record read, sanitized (undefined when it has no name or a bad id). */
function finishPlaceRecord(rec: OpenPlaceRecord): PlaceRecord | undefined {
    const { sub: _sub, lat, lon, ...rest } = rec;
    return sanitizePlaceRecord({
        ...rest,
        ...(lat !== undefined && lon !== undefined ? { coords: { lat, lon } } : {}),
    });
}

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
        // This citation's own QUAY, for the page's source of its own (see the derived sources).
        const c = currentCitation;
        if (c && ref && c.id === ref && q >= 0 && q <= 3 && c.quay === undefined) c.quay = q;
    };
    const droppedTags = new Map<string, number>();
    const count = (tag: string): void => { droppedTags.set(tag, (droppedTags.get(tag) ?? 0) + 1); };
    /** The level of the line being read, and where it is in the file. */
    let lineLevel = 0;
    let lineIndex = -1;
    /**
     * The level of a line already counted (or kept): nothing under it is
     * counted again (spec 066 G8). Cleared by the next line at its level or above.
     */
    let quietBelow: number | null = null;
    /** A tag of the line being read was not carried over: counted, and its lines with it. */
    const drop = (tag: string): void => {
        count(tag);
        if (quietBelow === null || lineLevel < quietBelow) quietBelow = lineLevel;
    };
    /** `0 @O1@ OBJE` media records, by xref. */
    const mediaRecords = new Map<string, RawMedia>();
    /** The media record being read, its level-1 tag, and whether that FILE is the record's first (later ones are left). */
    let currentObje: RawMedia | null = null;
    let objeSubTag: string | null = null;
    let objeFirstFile = false;
    /**
     * Another program's level-1 `_XXX` of a person or a family being kept
     * (spec 066 G8): from its line in the file down; a pointer under it (an
     * xref the reader renumbers) means the block cannot be kept as written.
     */
    let extraBlock: { target: { extras?: RawExtra[] }; tag: string; start: number; pointer: boolean; quiet?: boolean } | null = null;
    /** Citation DATA > DATE -> the source's record date (first wins, like PAGE). */
    const citationDates = new Map<string, string>();
    let citeLevel: number | null = null;
    let citeRef: string | null = null;
    let citeLine = -1;
    let inCiteData = false;
    /** The citation's unread lines being kept: its DATA > TEXT, its EVEN (see CitationSlot). */
    let citeKeep: 'text' | 'even' | null = null;

    let currentRecord: GedcomIndividual | GedcomFamily | null = null;
    let currentType: 'INDI' | 'FAM' | 'SOUR' | null = null;
    /** Serial for records the file gives no xref — they still need a key. */
    let anonRecordSeq = 0;
    let currentSubTag: string | null = null;
    let currentEvent: RawEvent | null = null;
    /** Level-2 tag inside the current event (for level-3 NOTE continuations). */
    let currentEventSubTag: string | null = null;
    /** The couple's event currently open under a FAM, and the level-2 tag inside it. */
    let currentFamEvent: RawCoupleEvent | null = null;
    let currentFamEventSubTag: string | null = null;
    /** The 1 _STORY block currently open, and the level-2 tag inside it. */
    let currentStory: RawStory | null = null;
    let currentStorySubTag: string | null = null;
    /** The level-3 tag inside a story's `2 _DRAFT`. */
    let currentDraftSubTag: string | null = null;
    /**
     * Level-2 tag inside a BIRT/DEAT (INDI) or MARR (FAM) block — the facts the
     * model stores as fields rather than events, so they have no RawEvent to
     * hang level-3 lines (PAGE, RELA, CONT) on.
     */
    let currentFactSubTag: string | null = null;
    let currentSource: RawSource | null = null;
    /** The source record's first AUTH is being read (its CONT/CONC lines join Source.author). */
    let readingAuthor = false;
    /** Which name the current 1 NAME line was: -1 the primary, else its variant index. */
    let currentNameSlot: number | null = null;
    let currentMedia: RawMedia | null = null;
    /** Level-2 tag inside the current OBJE (for level-3 FILE continuations). */
    let currentMediaSubTag: string | null = null;
    /** Level-2 tag inside an OBJE on a source record (FILE continuations). */
    let sourceMediaSubTag: string | null = null;
    /** @Sx@ of the most recent citation (PAGE lines attach to it). */
    let currentCitationId: string | null = null;
    /** Where that citation's pointer was written (its PAGE may point it to a source of its own). */
    let currentCitationSlot: { list: string[]; index: number } | null = null;
    /**
     * Every citation of a source record: its pointer's place, the source, and
     * what the citation itself says (its page, the entry's date, its QUAY).
     */
    const citations: CitationSlot[] = [];
    /** The citation being read (its PAGE, DATA > DATE and QUAY land on it). */
    let currentCitation: CitationSlot | null = null;
    /** A citation pointer pushed onto `list`: remembered so its PAGE can find it. */
    const cite = (list: string[], value: string): void => {
        list.push(value);
        currentCitationId = value;
        currentCitationSlot = { list, index: list.length - 1 };
        currentCitation = { list, index: list.length - 1, id: value, level: lineLevel, line: lineIndex };
        citations.push(currentCitation);
    };
    /** A citation's PAGE: the source's reference (first wins) and this citation's own page. */
    const citePage = (value: string): void => {
        if (!currentCitationId) return;
        if (!citationPages.has(currentCitationId)) citationPages.set(currentCitationId, value);
        const slot = currentCitationSlot;
        const c = currentCitation;
        if (slot && slot.list[slot.index] === currentCitationId && value.trim() && c && c.id === currentCitationId && c.page === undefined) {
            c.page = value.trim();
        }
    };
    /** 0 @Rx@ REPO record currently open. */
    let currentRepoId: string | null = null;
    /** Inside a `0 @N1@ NOTE` record (its text is read ahead, see preprocessGedcomLines). */
    let inNoteRecord = false;
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
        } else if (currentType === 'FAM' && currentFamEvent) {
            const ev = currentFamEvent;
            return line => { ev.note = join(ev.note ?? '', line); };
        } else if (currentType === 'FAM' && currentRecord
            && (currentSubTag === 'MARR' || currentSubTag === 'DIV')) {
            const fam = currentRecord as GedcomFamily;
            // A divorce's line says it is the divorce's (a wedding's is the couple's own).
            if (currentSubTag === 'DIV') return line => { fam.note = join(fam.note, strings.gedcomNotes.divorceNote(line)); };
            return line => { fam.note = join(fam.note, line); };
        }
        return null;
    };
    /**
     * The field a detail line fills (CAUS, AGE, ADDR under a fact), where the
     * model has one: on any life event, ADDR of the birth, all three of the
     * death, ADDR and each partner's AGE of a wedding. Null where it has none
     * (the cause of a birth, the age at a divorce): such a line keeps going to
     * the note. A field already filled — a second marriage of the same couple
     * — leaves the line to the note too, so neither value is lost.
     */
    type DetailField = { get: () => string | undefined; set: (v: string) => void };
    const factDetailField = (tag: string, partner?: 'HUSB' | 'WIFE'): DetailField | null => {
        const key = tag === 'CAUS' ? 'cause' : tag === 'AGE' ? 'age' : 'address';
        if (currentType === 'INDI' && currentRecord) {
            const indi = currentRecord as GedcomIndividual;
            const ev = currentEvent;
            if (ev) return { get: () => ev[key], set: v => { ev[key] = v; } };
            if (currentSubTag === 'BIRT' && key === 'address') {
                return { get: () => indi.birthAddress, set: v => { indi.birthAddress = v; } };
            }
            // An age at the birth from Strom's own file goes back as it came:
            // a note made of it would come back to the research as new.
            if (currentSubTag === 'BIRT' && key === 'age' && (stromResearch || stromApp)) {
                return { get: () => indi.birthAge, set: v => { indi.birthAge = v; } };
            }
            if (currentSubTag === 'DEAT') {
                const field = key === 'cause' ? 'deathCause' : key === 'age' ? 'deathAge' : 'deathAddress';
                return { get: () => indi[field], set: v => { indi[field] = v; } };
            }
        } else if (currentType === 'FAM' && currentFamEvent) {
            const ev = currentFamEvent;
            if (partner) {
                const field = partner === 'HUSB' ? 'husbAge' : 'wifeAge';
                return { get: () => ev[field], set: v => { ev[field] = v; } };
            }
            if (key !== 'age') return { get: () => ev[key], set: v => { ev[key] = v; } };
        } else if (currentType === 'FAM' && currentRecord && currentSubTag === 'MARR') {
            const fam = currentRecord as GedcomFamily;
            if (partner) {
                const field = partner === 'HUSB' ? 'husbAge' : 'wifeAge';
                return { get: () => fam[field], set: v => { fam[field] = v; } };
            }
            if (key === 'address') return { get: () => fam.marriageAddress, set: v => { fam.marriageAddress = v; } };
        }
        return null;
    };
    /**
     * A detail line being read (AGE, CAUS, ADDR under a fact), open until the
     * next line at its own level or above, so its CONT/CONC lines join it.
     */
    let openDetail: { level: number; text: string; done: (text: string) => void; sep: string } | null = null;
    const flushDetail = (): void => {
        const text = openDetail?.text.trim();
        if (openDetail && text) openDetail.done(text);
        openDetail = null;
    };
    /** Where a finished detail goes: its field (an age in the UI language), else the fact's note, labelled. */
    const detailTarget = (tag: string, partner?: 'HUSB' | 'WIFE'): ((text: string) => void) | null => {
        const sink = factDetailSink();
        const field = factDetailField(tag, partner);
        if (!sink && !field) return null;
        const g = strings.gedcomNotes;
        return text => {
            const value = tag === 'AGE' ? localAge(text) : text;
            if (field && !field.get()) { field.set(value); return; }
            if (!sink) return;
            if (partner) sink((partner === 'HUSB' ? g.husbandAge : g.wifeAge)(value));
            else sink(tag === 'AGE' ? g.age(value) : tag === 'CAUS' ? g.cause(value) : g.address(value));
        };
    };
    /** Coordinates gathered from PLAC > MAP > LATI/LONG, keyed by placeKey(). */
    const placeCoords = new Map<string, PlaceGeo>();
    /** The PLAC value a MAP substructure is currently describing. */
    let currentPlaceValue: string | null = null;
    /** The `2 PLAC` value a `3 _STROM_PLACE` ref may follow (cleared by any other level ≤ 2 line). */
    let refPlaceValue: string | null = null;
    /** Strom Research's place records and refs (spec 034). */
    const placeRecords = new Map<string, PlaceRecord>();
    const placeRefs = new Map<string, string>();
    let openPlaceRecord: OpenPlaceRecord | null = null;
    const closePlaceRecord = (): void => {
        if (!openPlaceRecord) return;
        const done = finishPlaceRecord(openPlaceRecord);
        if (done && placeRecords.size < 50000) placeRecords.set(done.id, done);
        openPlaceRecord = null;
    };
    /** Inside the 0 HEAD record (its NOTE may carry surname-variant groups). */
    let inHeader = false;
    /** The current header NOTE is one of the surname markers' notes (which one). */
    let inSurnameNote: 'groups' | 'rejections' | false = false;
    /** The lines under each marker: `2 CONT` starts one, `2 CONC` / `3 CONC` continue it. */
    const surnameNoteLines: { groups: string[] | null; rejections: string[] | null } = { groups: null, rejections: null };
    /** Header `1 SOUR STROM_RESEARCH` / `1 _STROM_ASOF`. */
    let stromResearch = false;
    /** Written by the Strom app itself (HEAD > SOUR STROM). */
    let stromApp = false;
    /**
     * Whether a level-1 `_XXX` tag is another program's, kept as written for
     * "Back to {prog}" (spec 066 G8): in its file, and in Strom's own "Back to"
     * file that carried it there (taken back by the record's import mark) —
     * never Strom's own tags nor the research's.
     */
    const keepsExtra = (tag: string): boolean => !stromResearch && !(stromApp && /^_STROM_/.test(tag));
    /** The app's version under it (HEAD > SOUR STROM > VERS; the older apps wrote a fixed "1.0"). */
    let stromAppVersion: string | undefined;
    /** The header line being read is under HEAD > SOUR STROM. */
    let inStromSour = false;
    /** HEAD > SOUR, DATE and FILE of the file, whoever wrote it (the origin of a loaded file). */
    const head: GedcomHead = {};
    let headSourName = '';
    let headSourValue = '';
    /** The header line being read is under HEAD > SOUR (any program). */
    let inHeadSour = false;
    /** HEAD > `1 _STROM_IMPORT Ix`: the import records an app or research file carries, as written. */
    const headImports: Record<string, string>[] = [];
    let openHeadImport: Record<string, string> | null = null;
    let openHeadImportField: string | null = null;
    let researchAsOf = '';
    let lineageMarker = false;
    /** The _STROM_CONFLICT / _HYPO / _SEARCHED block being read. */
    let currentResearch: OpenResearch | null = null;
    /** The research's `_STROM_WAS` being read (its `3 _STROM_IMPORT`, `_PART`, `_REF` follow). */
    let openWas: { level: number; was: RawFactOrigin['was'][number] } | null = null;
    /**
     * The id lines being read (spec 066 K3.2): under `1 _STROM_IMPORT Ix` of a
     * Strom file (`entry`), or the `2 TYPE` of a level-1 `EXID`. Its deeper
     * lines are read here and nowhere else.
     */
    let idBlock = null as { level: number; entry?: RawOriginalIds; last?: OriginalIdLine } | null;
    /** A level-1 id line of a person or a family (another program's file keeps them). */
    const readFileId = (target: { fileIds?: OriginalIdLine[] }, tag: string, value: string): void => {
        const line: OriginalIdLine = { tag, value: value.trim() };
        // More id lines than a record keeps (ID_LINES_MAX): left out, counted.
        if (line.value && (target.fileIds?.length ?? 0) >= ID_LINES_MAX) count(tag);
        else if (line.value) (target.fileIds ??= []).push(line);
        idBlock = { level: 1, last: line };
    };
    /** `1 _STROM_IMPORT Ix` of a person or a family: its import, and the ids that follow under it. */
    const readRecordImport = (target: { importMark?: string; importIds?: RawOriginalIds[] }, value: string, idsOnly = false): void => {
        const mark = readImportMark(value);
        if (!mark) return;
        // The first `_STROM_IMPORT` says where the record came from; a further
        // one and every `_STROM_XID` only bring ids, never an origin.
        if (!idsOnly) target.importMark ??= mark.id;
        // More blocks than a record keeps (ID_ENTRIES_MAX): their lines are passed over.
        if ((target.importIds?.length ?? 0) >= ID_ENTRIES_MAX) { idBlock = { level: 1 }; return; }
        const entry: RawOriginalIds = { from: mark.id, ids: [] };
        (target.importIds ??= []).push(entry);
        idBlock = { level: 1, entry };
    };
    /** The research's origin of the fact being read: an event's, the primary name's, the sex, birth, death, wedding, divorce. */
    const factOriginTarget = (): RawFactOrigin | null => {
        const fresh = (): RawFactOrigin => ({ was: [], sourceRefs: [] });
        if (currentType === 'INDI') {
            if (currentEvent) return currentEvent.origin ??= fresh();
            const indi = currentRecord as GedcomIndividual;
            const fact: RawPersonFact | null = currentSubTag === 'NAME' ? (currentNameSlot === -1 ? 'name' : null)
                : currentSubTag === 'SEX' || currentSubTag === '_STROM_SEX_ORIGIN' ? 'sex'
                : currentSubTag === 'BIRT' ? 'birth'
                : currentSubTag === 'DEAT' ? 'death' : null;
            return fact ? ((indi.factOrigins ??= {})[fact] ??= fresh()) : null;
        }
        if (currentType === 'FAM') {
            if (currentFamEvent) return currentFamEvent.origin ??= fresh();
            const fam = currentRecord as GedcomFamily;
            const fact: RawCoupleFact | null = currentSubTag === 'MARR' ? 'marriage' : currentSubTag === 'DIV' ? 'divorce' : null;
            return fact ? ((fam.factOrigins ??= {})[fact] ??= fresh()) : null;
        }
        return null;
    };

    /** A line of a media record: FILE (5.5.1 and 7 with FORM and TITL under it, 5.5 beside it), TITL, the portrait marks, Strom's own. */
    const readMediaRecordLine = (m: RawMedia, level: number, tag: string, value: string): void => {
        if (level === 1) {
            objeSubTag = tag;
            if (tag === 'FILE') {
                objeFirstFile = !m.file;
                if (objeFirstFile) m.file = value;
            } else if (tag === 'FORM') { if (!m.form) m.form = value; }
            else if (tag === 'TITL') { if (!m.title) m.title = value; }
            else if (tag === 'NOTE') m.note = m.note ? `${m.note}\n${value}` : value;
            else if (tag === '_STROM_KIND') m.stromKind = value;
            else if (tag === '_SOUR' || tag === 'SOUR') m.sourceXref = value;
            else if (tag === '_STROM_SHA') m.sha = normalizeSha256(value) ?? undefined;
            else if (tag === '_STROM_ORIENT' && /^[2-8]$/.test(value.trim())) m.orient = Number(value.trim());
            else if ((tag === '_PRIM' || tag === '_PRIMARY' || tag === '_PERSONALPHOTO') && value.trim() === 'Y') m.primary = true;
            else if (tag === '_DATE') { if (!m.date) m.date = mediaDateValue(value); }
            else if (isUnreadUnderscoreTag(tag) && !stromApp && !stromResearch) drop(tag);
        } else if (level === 2 && objeSubTag === 'FILE' && objeFirstFile) {
            // Data-URL payloads are CONC-wrapped (255-char physical lines).
            if (tag === 'CONC') m.file += value;
            else if (tag === 'FORM') { if (!m.form) m.form = value; }
            else if (tag === 'TITL') { if (!m.title) m.title = value; }
        } else if (level === 2 && objeSubTag === 'NOTE' && (tag === 'CONT' || tag === 'CONC')) {
            m.note = (m.note ?? '') + (tag === 'CONT' ? '\n' : '') + value;
        }
    };
    /**
     * The kept block ends before line `end` of the file: its lines as written
     * go to the record, or, when they cannot be kept as they are (a pointer,
     * a data URL, a line that is not one), the tag is counted.
     */
    const closeExtra = (end: number): void => {
        const block = extraBlock;
        extraBlock = null;
        if (!block) return;
        const raw = lines.slice(block.start, end).filter(l => l.trim() !== '');
        if (!block.pointer && validExtraBlock(raw) && !raw.some(l => DATA_URL_IN_LINE.test(l))) {
            (block.target.extras ??= []).push({ tag: block.tag, lines: raw, ...(block.quiet ? { quiet: true } : {}) });
        } else if (!block.quiet) {
            count(block.tag);
        }
    };

    /**
     * A structure of another program's file that becomes lines of the
     * record's note (NOTED_TAG), being read: the whole structure (`1 NCHI`,
     * `1 PUBL`), or those lines under a fact Strom has that go to the note
     * (`2 NOTE` under `1 BIRT`, a wedding's `2 NOTE`). Kept on the record, so
     * "Back to {prog}" writes them as they were and not as a note; not from
     * the research's files.
     */
    let noted: {
        target: { extras?: RawExtra[] };
        note: () => string;
        /** The structure's level-1 line in the file. */
        head: number;
        /** The whole structure became one line of the note: that line, once read. */
        whole?: () => string;
        /** The note's lines of the structure's lines read so far, and those lines as written. */
        texts: string[];
        body: string[];
        /** A level-2 line under the fact being read (its tag), and the note's length before it. */
        sub: { start: number; before: number; tag: string } | null;
    } | null = null;
    /** The file's level-1 line being read (the head of a fact's lines). */
    let notedHead = -1;
    const lineLevelAt = (i: number): number => {
        const m = /^\s*(\d+)\s/.exec(lines[i] ?? '');
        return m ? Number(m[1]) : -1;
    };
    /** Line `start` and the lines under it, as written (blank and broken lines left out). */
    const structureAt = (start: number): string[] => {
        const level = lineLevelAt(start);
        const out = [lines[start].trimStart()];
        for (let i = start + 1; i < lines.length; i++) {
            const l = lineLevelAt(i);
            if (l < 0) continue;
            if (l <= level) break;
            out.push(lines[i].trimStart());
        }
        return out;
    };
    const readNoted = (src: number, level: number, tag: string): void => {
        const open = noted;
        if (open?.sub && level <= 2) {
            const text = open.note().slice(open.sub.before).replace(/^\n/, '');
            if (text) { open.texts.push(text); open.body.push(...structureAt(open.sub.start)); }
            else if (NOTED_SILENT_TAGS.has(open.sub.tag)) open.body.push(...structureAt(open.sub.start));
            open.sub = null;
        }
        if (open && level <= 1) {
            noted = null;
            const texts = open.whole ? [open.whole()].filter(Boolean) : open.texts;
            const structure = open.whole ? structureAt(open.head) : [lines[open.head].trimStart(), ...open.body];
            // A pointer in it would name a record by an xref the export renumbers
            // (a calendar's escape, `@#DJULIAN@`, is none).
            const block = structure.some(l => /^\d+ @|\s@[^@#\s][^@\s]*@/.test(l)) || (open.whole && texts.length === 0)
                ? null : notedBlock(texts, structure);
            if (block) (open.target.extras ??= []).push({ tag: NOTED_TAG, lines: block, quiet: true });
        }
        if (level === 1) notedHead = src;
        if (stromResearch || level === 0) return;
        if (level === 1 && currentType === 'INDI' && currentRecord && NOTED_INDI_TAGS.has(tag)) {
            const indi = currentRecord as GedcomIndividual;
            const at = indi.noteFacts.length;
            noted = { target: indi, note: () => indi.notes, head: src, texts: [], body: [], sub: null,
                whole: () => { const fact = indi.noteFacts[at]; return fact ? factToNoteLine(fact) : ''; } };
        } else if (level === 1 && currentType === 'FAM' && currentRecord && NOTED_FAM_TAGS.has(tag)) {
            const fam = currentRecord as GedcomFamily;
            const at = fam.noteFacts.length;
            noted = { target: fam, note: () => fam.note, head: src, texts: [], body: [], sub: null,
                whole: () => { const fact = fam.noteFacts[at]; return fact ? factToNoteLine(fact) : ''; } };
        } else if (level === 1 && currentType === 'SOUR' && currentSource && tag === 'PUBL') {
            const s = currentSource;
            const before = s.note.length;
            noted = { target: s, note: () => s.note, head: src, texts: [], body: [], sub: null,
                whole: () => s.note.slice(before).replace(/^\n/, '') };
        } else if (level === 2 && NOTED_DETAIL_TAGS.has(tag) && currentRecord) {
            // A line under birth, death (the person's note), a wedding or a
            // divorce (the couple's): whether it went to the note shows once it is read.
            let target: { extras?: RawExtra[] } | null = null;
            let note: (() => string) | null = null;
            if (currentType === 'INDI' && !currentEvent && (currentSubTag === 'BIRT' || currentSubTag === 'DEAT')) {
                const indi = currentRecord as GedcomIndividual;
                target = indi; note = () => indi.notes;
            } else if (currentType === 'FAM' && !currentFamEvent && (currentSubTag === 'MARR' || currentSubTag === 'DIV')) {
                const fam = currentRecord as GedcomFamily;
                target = fam; note = () => fam.note;
            }
            if (!target || !note) return;
            noted ??= { target, note, head: notedHead, texts: [], body: [], sub: null };
            noted.sub = { start: src, before: noted.note().length, tag };
        }
    };

    const { records: gedLines, noteRecords, inlineSources } = preprocessGedcomLines(lines);

    for (const rec of gedLines) {
        const level = rec.level;
        const tag = rec.tag;
        let value = rec.value;
        lineLevel = level;
        lineIndex = rec.src;

        // Another program's own level-1 tag being kept (spec 066 G8): the
        // lines under it are taken from the file as written, nothing reads them.
        if (extraBlock) {
            if (level > 1) {
                if (GED_POINTER.test(tag) || (GED_POINTER.test(value.trim()) && !value.startsWith('@__inline'))) extraBlock.pointer = true;
                continue;
            }
            closeExtra(rec.src);
        }
        if (quietBelow !== null && level <= quietBelow) quietBelow = null;
        // A deeper `_XXX` of another program that the reader takes nowhere
        // (under an event, a citation, a name…): counted, with its lines.
        if (level >= 2 && quietBelow === null && !inHeader && !stromApp && !stromResearch && isUnreadUnderscoreTag(tag)) drop(tag);
        // The lines of a media record (0 @O1@ OBJE).
        if (currentObje && level > 0) {
            readMediaRecordLine(currentObje, level, tag, value);
            continue;
        }

        // The lines under a record's id (spec 066 K3.2): `2 _XREF`, `2 _UID`…
        // under `1 _STROM_IMPORT Ix`, `2 TYPE` under `1 EXID`, `3 TYPE` under
        // `2 EXID`. Nothing else reads them.
        if (idBlock && level <= idBlock.level) idBlock = null;
        if (idBlock) {
            const block = idBlock;
            const v = value.trim();
            if (level === block.level + 1 && block.entry) {
                block.last = undefined;
                if (tag === '_XREF') { if (!block.entry.xref && v) block.entry.xref = v; }
                else if (ORIGINAL_ID_TAGS.has(tag) && v && block.entry.ids.length < ID_LINES_MAX) {
                    block.last = { tag, value: v };
                    block.entry.ids.push(block.last);
                }
            } else if (tag === 'TYPE' && v && block.last?.tag === 'EXID' && !block.last.type
                && level === block.level + (block.entry ? 2 : 1)) {
                block.last.type = v;
            }
            continue;
        }
        // A pointer to a shared note record (1 NOTE @N1@, GEDCOM 7 SNOTE) reads
        // as the note's text wherever a NOTE may stand. A pointer to a note the
        // file never defines says nothing and is read as an empty note.
        if (tag === 'NOTE' && level > 0 && GED_POINTER.test(value)) {
            value = noteRecords.get(value) ?? '';
        }

        // A place record of Strom Research: its lines are read here and go
        // nowhere else (none of them is a fact of a person).
        if (level === 0) closePlaceRecord();
        if (openPlaceRecord && level > 0) {
            readPlaceRecordLine(openPlaceRecord, level, tag, value);
            continue;
        }
        if (level === 0 && /^@L\d{1,7}@$/.test(tag) && value.trim() === '_STROM_PLACE') {
            openPlaceRecord = { id: tag.slice(1, -1), names: [], jurisdictions: [], sub: null };
        }

        // Citation DATA > DATE (the entry recording date) may sit under a
        // citation at any depth — on the person, a name, an event, a family —
        // so it is tracked here by level, apart from the per-record dispatch.
        if (citeLevel !== null && level <= citeLevel) { citeLevel = null; citeRef = null; inCiteData = false; citeKeep = null; }
        if (tag === 'SOUR' && level > 0 && currentType !== 'SOUR' && GED_POINTER.test(value)) {
            citeLevel = level; citeRef = value; inCiteData = false; citeLine = rec.src; citeKeep = null;
        } else if (citeLevel !== null && citeRef) {
            if (level === citeLevel + 1) inCiteData = tag === 'DATA';
            else if (level === citeLevel + 2 && inCiteData && tag === 'DATE' && value) {
                const date = parseGedcomDate(value);
                if (!citationDates.has(citeRef)) citationDates.set(citeRef, date);
                // The date of this very citation (one read through cite()).
                const c = currentCitation as CitationSlot | null;
                if (c && c.id === citeRef && c.line === citeLine && c.date === undefined) c.date = date;
            }
            // What the citation says that Strom does not read (DATA > TEXT, EVEN > ROLE)
            // is kept as written for "Back to {prog}" (not from the research's files).
            if (level === citeLevel + 1) citeKeep = tag === 'EVEN' ? 'even' : null;
            else if (level === citeLevel + 2 && inCiteData) citeKeep = tag === 'TEXT' ? 'text' : null;
            const c = currentCitation as CitationSlot | null;
            if (citeKeep && !stromResearch && c && c.id === citeRef && c.line === citeLine) {
                const kept = lines[rec.src].trimStart().replace(/^\d+/, String(level - citeLevel));
                if (citeKeep === 'text') (c.dataText ??= []).push(kept);
                else (c.even ??= []).push(kept);
            }
        }

        // Place coordinates ride under a PLAC as MAP > LATI/LONG. They can hang
        // off a person's birth/death, an event or a marriage, so they are read
        // here — before the per-record dispatch — against the most recent PLAC.
        if (level <= 1) currentPlaceValue = null;
        if (level === 2 && tag === 'PLAC' && value) currentPlaceValue = value;
        if (level <= 2) refPlaceValue = level === 2 && tag === 'PLAC' && value ? value : null;
        // The research's place record this place is: 2 PLAC > 3 _STROM_PLACE @L0012@.
        if (tag === '_STROM_PLACE' && level > 0) {
            const id = value.trim().replace(/^@|@$/g, '');
            if (level === 3 && refPlaceValue && isPlaceRecordId(id)) {
                const key = placeKey(refPlaceValue);
                if (key && key.length <= PLACE_TEXT_LIMITS.key && !placeRefs.has(key)) placeRefs.set(key, id);
            }
            continue;
        }
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
        readNoted(rec.src, level, tag);
        if (level === 2 && (tag === 'AGE' || tag === 'CAUS' || tag === 'ADDR' || tag === 'DATE')) {
            const sink = factDetailSink();
            if (sink && tag === 'DATE') {
                const line = calendarNoteLine(value);
                if (line) sink(line);
                // The words the date field cannot hold ("INT 1900 (per
                // census)", "3 XYZ 1900") stay with the fact, as written.
                const phrase = gedcomDatePhrase(value);
                if (phrase) sink(strings.gedcomNotes.datePhrase(phrase));
            } else if (tag !== 'DATE') {
                // ADDR: only its own value and CONT lines. ADR1/CITY/POST
                // repeat the place or carry junk ("ADR1 Email", MyHeritage).
                const done = detailTarget(tag);
                if (done) openDetail = { level, text: value, done, sep: tag === 'ADDR' ? ', ' : '\n' };
            }
        } else if (level === 3 && tag === 'AGE' && currentType === 'FAM' && currentSubTag === 'MARR'
            && (currentFactSubTag === 'HUSB' || currentFactSubTag === 'WIFE')) {
            // 1 MARR / 2 HUSB / 3 AGE 25y — each partner's age at the wedding.
            const done = detailTarget(tag, currentFactSubTag);
            if (done) openDetail = { level, text: value, done, sep: ' ' };
        } else if (level === 3 && tag === 'AGE' && currentType === 'FAM' && currentFamEvent
            && (currentFamEventSubTag === 'HUSB' || currentFamEventSubTag === 'WIFE')) {
            // 1 MARB / 2 HUSB / 3 AGE 25y — each partner's age at the banns.
            const done = detailTarget(tag, currentFamEventSubTag);
            if (done) openDetail = { level, text: value, done, sep: ' ' };
        }

        // The research's origin of a fact (spec 066): read from a file Strom
        // wrote (the research's, or the app's own export carrying it back; the
        // header comes first), apart from the fact's own lines. Another
        // program's file reads these lines as before (an unknown tag).
        if (openWas && level <= openWas.level) openWas = null;
        if (openWas) {
            if (level === openWas.level + 1) {
                const w = openWas.was;
                if (tag === IMPORT_TAG) w.importId = value.trim();
                else if (tag === '_PART') w.parts.push(value.trim());
                else if (tag === '_REF') w.ref = value.trim();
                else if (tag === 'CONC') w.value += value;
                else if (tag === 'CONT') w.value += '\n' + value;
            }
            continue;
        }
        if ((stromResearch || stromApp) && level === 2 && currentRecord && !currentResearch && (currentType === 'INDI' || currentType === 'FAM')
            && (tag === '_STROM_ORIGIN' || tag === '_STROM_WAS' || (tag === 'SOUR' && GED_POINTER.test(value)))) {
            const o = factOriginTarget();
            if (tag === '_STROM_ORIGIN') {
                if (o) o.origin = value;
                continue;
            }
            if (tag === '_STROM_WAS') {
                const was = { value, parts: [] as string[] };
                if (o) o.was.push(was);
                openWas = { level, was };
                continue;
            }
            // The citation stays the fact's own as well (read below).
            if (o) o.sourceRefs.push(value.trim());
        }

        // 2 _STROM_IMPORT under a fact of a person or a couple: which import the
        // fact (or the listed parts of it) still comes from. Read here so no
        // fact's own reading takes it for one of its lines; whether the file
        // is trusted with it is the converter's call. Level 3 (under the
        // research's _STROM_WAS) is never a mark of the fact.
        if (level === 2 && tag === IMPORT_TAG && currentRecord && !currentResearch
            && (currentType === 'INDI' || currentType === 'FAM')) {
            const mark = readImportMark(value);
            if (mark && currentType === 'INDI') {
                const indi = currentRecord as GedcomIndividual;
                const fact = currentEvent ? null
                    : currentSubTag === 'NAME' ? (currentNameSlot === -1 ? 'name' : null)
                    : currentSubTag === 'SEX' ? 'sex'
                    : currentSubTag === 'BIRT' ? 'birth'
                    : currentSubTag === 'DEAT' ? 'death' : null;
                if (currentEvent) (currentEvent.imports ??= []).push(mark);
                else if (fact) ((indi.factImports ??= {})[fact] ??= []).push(mark);
            } else if (mark) {
                const fam = currentRecord as GedcomFamily;
                if (currentFamEvent) (currentFamEvent.imports ??= []).push(mark);
                else if (currentSubTag === 'MARR' || currentSubTag === 'DIV') {
                    ((fam.factImports ??= {})[currentSubTag === 'MARR' ? 'marriage' : 'divorce'] ??= []).push(mark);
                } else if (currentSubTag === 'CHIL' && fam.lastChil && !fam.childImports?.has(fam.lastChil)) {
                    (fam.childImports ??= new Map()).set(fam.lastChil, mark.id);
                }
            }
            continue;
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
            currentObje = null;
            objeSubTag = null;

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
                    primaryNameParts: {},
                    variantNameParts: [],
                    marnm: [],
                    sourceRefs: [],
                    birthSourceRefs: [],
                    deathSourceRefs: [],
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
                    id: recordId, title: '', repository: '', reference: '', url: '', note: '', media: []
                };
                currentRecord = null;
                currentType = 'SOUR';
                sources.set(recordId, currentSource);
            } else if (recordType === 'OBJE' && hasXref) {
                // A media record (spec 066 G8): `1 OBJE @O1@` links of people
                // and sources take its file like an OBJE written in place.
                currentObje = { title: '', form: '', file: '', stromKind: '' };
                mediaRecords.set(recordId, currentObje);
                currentRecord = null;
                currentType = null;
                currentSource = null;
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
                    events: [],
                    sourceRefs: [],
                    marriageParticipants: [],
                    childRels: new Map(),
                    noteFacts: [],
                    recordLine: rec.src,
                };
                currentType = 'FAM';
                currentSource = null;
                families.set(recordId, currentRecord as GedcomFamily);
            } else {
                currentRecord = null;
                currentType = null;
                currentSource = null;
                if (!KNOWN_RECORD_TYPES.has(recordType) && recordType && !openPlaceRecord) drop(recordType);
            }
            currentSubTag = null;
            currentEvent = null;
            currentEventSubTag = null;
            currentFamEvent = null;
            currentFamEventSubTag = null;
            currentFactSubTag = null;
            currentStory = null;
            currentStorySubTag = null;
            currentResearch = null;
            currentMedia = null;
            currentMediaSubTag = null;
            currentCitationId = null; currentCitationSlot = null; currentCitation = null;
            currentPlaceValue = null;
            inHeader = recordType === 'HEAD';
            inNoteRecord = recordType === 'NOTE' || recordType === 'SNOTE';
            inSurnameNote = false;
            if (recordType !== 'REPO') currentRepoId = null;
        } else if (inHeader) {
            // Header sub-lines: the surname-groups NOTE (see the exporter's
            // SURNAME_GROUPS_MARKER), the writer's own marks, and who wrote the
            // file and when (the origin of a loaded file, spec 066).
            if (level === 1) {
                inHeadSour = tag === 'SOUR';
                if (tag === 'SOUR') headSourValue = value.trim();
                else if (tag === 'DATE') head.date = value.trim();
                else if (tag === 'FILE') head.file = value.trim();
                openHeadImport = null;
                openHeadImportField = null;
                if (tag === IMPORT_TAG && headImports.length < 1000) {
                    openHeadImport = { id: value.trim() };
                    headImports.push(openHeadImport);
                }
            } else if (level === 2 && inHeadSour) {
                if (tag === 'NAME') headSourName = value.trim();
                else if (tag === 'VERS') head.version = value.trim();
            }
            if (level === 2 && openHeadImport) {
                openHeadImportField = HEAD_IMPORT_FIELDS[tag] ?? null;
                if (openHeadImportField) openHeadImport[openHeadImportField] = value.trim();
            } else if (level === 3 && openHeadImport && openHeadImportField && (tag === 'CONC' || tag === 'CONT')) {
                openHeadImport[openHeadImportField] += (tag === 'CONT' ? ' ' : '') + value;
            }
            if (level === 1) {
                inSurnameNote = tag !== 'NOTE' ? false
                    : value.trim() === SURNAME_GROUPS_MARKER ? 'groups'
                    : value.trim() === SURNAME_REJECTIONS_MARKER ? 'rejections'
                    : false;
                if (inSurnameNote) surnameNoteLines[inSurnameNote] ??= [];
                // Strom Research's own lines: who wrote the file, and when
                // its knowledge about people was current.
                inStromSour = tag === 'SOUR' && value.trim() === 'STROM';
                if (tag === 'SOUR' && value.trim() === 'STROM_RESEARCH') stromResearch = true;
                else if (inStromSour) stromApp = true;
                else if (tag === '_STROM_ASOF') researchAsOf = value.trim();
                else if (tag === '_STROM_LINES') lineageMarker = true;
            } else if (level === 2 && inStromSour && tag === 'VERS') {
                stromAppVersion = value.trim();
            } else if (inSurnameNote && level === 2 && tag === 'CONT') {
                // One group per line; a long one is wrapped on CONC lines
                // (the exporter's pushWrapped writes them one level deeper).
                surnameNoteLines[inSurnameNote]!.push(value);
            } else if (inSurnameNote && (tag === 'CONC' || (level === 3 && tag === 'CONT')) && (level === 2 || level === 3)) {
                // CONC glues on as it is (a cut may fall inside a name); a line
                // break inside one group line means no more than a space.
                const noteLines = surnameNoteLines[inSurnameNote]!;
                if (noteLines.length === 0) noteLines.push(value);
                else noteLines[noteLines.length - 1] += tag === 'CONT' ? ` ${value}` : value;
            }
        } else if (currentRepoId !== null && level === 1 && tag === 'NAME') {
            repositories.set(currentRepoId, value);
        } else if ((currentRepoId !== null || inNoteRecord) && level === 1) {
            // A repository is kept as its name, a note record as its text in
            // the places that cite it: another program's own tag on either
            // record has nowhere to stay — counted, never lost without a word.
            if (isUnreadUnderscoreTag(tag) && !stromApp && !stromResearch) drop(tag);
        } else if (currentType === 'SOUR' && currentSource) {
            // Source record sub-lines. reference <- PAGE (spec mapping), the
            // transcript <- TEXT, refn <- REFN, excerpts <- OBJE.
            //
            // The source has one note, and everything else the record says that
            // has no field of its own lands there: every NOTE (a second one used
            // to overwrite the first), the publication (PUBL), the author (AUTH)
            // and the call number the repository files it under (REPO > CALN)
            // — each labelled, each with its continuation lines.
            const src = currentSource;
            const addLine = (line: string, sep: string): void => {
                src.note = src.note ? `${src.note}${sep}${line}` : line;
            };
            const plain = (text: string): string =>
                currentSubTag === 'TEXT' || currentSubTag === 'PUBL' ? text.replace(/<[^>]*>/g, '') : text;
            if (level === 1) {
                currentSubTag = tag;
                readingAuthor = false;
                if (tag === 'TITL') src.title = value;
                else if (tag === 'REPO') src.repository = value;
                else if (tag === 'PAGE') src.reference = value;
                else if (tag === 'TEXT') {
                    // The entry's wording has a field of its own: the transcript.
                    src.transcript = src.transcript ? `${src.transcript}\n\n${plain(value)}` : plain(value);
                }
                else if (tag === 'PUBL' || tag === 'AUTH') {
                    const label = tag === 'PUBL' ? strings.gedcomNotes.sourcePublication
                        : strings.gedcomNotes.sourceAuthor;
                    addLine(label(plain(value).trim()).trimEnd(), '\n');
                    // The author as written too: "Back to {prog}" gives it back as AUTH (spec 066 K3.1).
                    if (tag === 'AUTH' && src.author === undefined) { src.author = value.trim(); readingAuthor = true; }
                }
                else if (tag === 'REFN') { if (value) src.refn = value; }
                else if (tag === '_STROM_VERIFIED') { if (value.trim().toUpperCase() === 'Y') src.verified = true; }
                else if (tag === '_STROM_READ') {
                    const who = value.trim().toLowerCase();
                    if (who === 'user' || who === 'research' || who === 'both') src.readBy = who;
                }
                else if (tag === '_STROM_ORIG') { if (value.trim().toUpperCase() === 'Y') src.original = true; }
                else if (tag === '_STROM_READING') { if (/^D\d{14}-[0-9a-f]{4}$/.test(value.trim())) src.reading = value.trim(); }
                else if (tag === '_STROM_SHA') src.readingSha = normalizeSha256(value) ?? undefined;
                else if (tag === IMPORT_TAG) { const mark = readImportMark(value); if (mark) src.importMark = mark.id; }
                // The record's ids in the program that wrote the file (`1 RIN MH:S1`), for "Back to {prog}".
                else if (ORIGINAL_ID_TAGS.has(tag)) readFileId(src, tag, value);
                else if (tag === 'OBJE') src.media.push({ title: '', file: '', ...(GED_POINTER.test(value.trim()) ? { ref: value.trim() } : {}) });
                else if (tag === '_STROM_IMG_OMITTED') src.imageHeld = imageHeldReason(value);
                else if (tag === 'QUAY') { const q = parseInt(value, 10); if (q >= 0 && q <= 3) src.quality = q; }
                else if (tag === 'WWW' || tag === 'URL') src.url = value;
                // Separate notes stay separate: a blank line between them. A
                // NOTE whose text starts on its CONT line opens with one break
                // fewer, since that CONT brings its own.
                else if (tag === 'NOTE') addLine(value, value ? '\n\n' : '\n');
                // The short title some programs write beside (or instead of)
                // TITL: the title when there is no other.
                else if (tag === 'ABBR') src.abbr = value;
                // Another program's own tag (MyHeritage's _TYPE, _MEDI): kept as
                // written for "Back to {prog}" (spec 066 G8), like a person's.
                else if (tag.startsWith('_') && keepsExtra(tag) && (!IGNORED_BOOKKEEPING_TAGS.has(tag) || KEPT_BOOKKEEPING_TAGS.has(tag))) {
                    extraBlock = { target: src, tag, start: rec.src, pointer: GED_POINTER.test(value.trim()), quiet: KEPT_BOOKKEEPING_TAGS.has(tag) };
                }
                // Anything else on the record (DATA, OBJE, REFN …) reached us
                // and was not read — the contract says so, and so does the summary.
                else if (!IGNORED_BOOKKEEPING_TAGS.has(tag)) drop(tag);
            } else if (level === 2) {
                // Multi-line continuations for title / note / the labelled lines.
                if (currentSubTag === 'TITL') {
                    if (tag === 'CONT') src.title += '\n' + value;
                    else if (tag === 'CONC') src.title += value;
                } else if (currentSubTag === 'TEXT') {
                    if (tag === 'CONT') src.transcript = (src.transcript ?? '') + '\n' + plain(value);
                    else if (tag === 'CONC') src.transcript = (src.transcript ?? '') + plain(value);
                } else if (currentSubTag === 'NOTE'
                    || currentSubTag === 'PUBL' || currentSubTag === 'AUTH') {
                    if (tag === 'CONT') src.note += (src.note ? '\n' : '') + plain(value);
                    else if (tag === 'CONC') src.note += plain(value);
                    if (readingAuthor && tag === 'CONT') src.author += '\n' + value;
                    else if (readingAuthor && tag === 'CONC') src.author += value;
                } else if (currentSubTag === IMPORT_TAG && tag === '_XREF') {
                    const xref = value.trim();
                    if (GED_POINTER.test(xref) && src.importXref === undefined) src.importXref = xref.slice(1, -1);
                } else if (currentSubTag === IMPORT_TAG && ORIGINAL_ID_TAGS.has(tag) && value.trim()
                    && (src.importIdLines?.length ?? 0) < ID_LINES_MAX) {
                    (src.importIdLines ??= []).push({ tag, value: value.trim() });
                } else if (currentSubTag === '_STROM_IMG_OMITTED' && tag === '_STROM_CLIP') {
                    const mark = value.trim();
                    if (/^[A-Za-z0-9-]{1,32}$/.test(mark) && !src.heldClips?.includes(mark)) {
                        (src.heldClips ??= []).push(mark);
                    }
                } else if (currentSubTag === '_STROM_READ' && tag === '_CONF') {
                    const day = value.trim();
                    if (src.readBy && isConfirmDay(day)) src.readConfirmed = day;
                } else if (currentSubTag === '_STROM_READ' && tag === '_TXT') {
                    const mark = value.trim();
                    if (src.readBy && isTranscriptMark(mark)) src.readMark = mark;
                } else if (currentSubTag === '_STROM_READING' && tag === '_STROM_ENTRY') {
                    if (src.reading && /^[A-Za-z][A-Za-z0-9_-]{0,20}$/.test(value.trim())) src.readingEntry = value.trim();
                } else if (currentSubTag === 'REPO' && tag === 'CALN' && value) {
                    addLine(strings.gedcomNotes.sourceCallNumber(value), '\n');
                } else if (currentSubTag === 'OBJE' && src.media.length > 0) {
                    const media = src.media[src.media.length - 1];
                    sourceMediaSubTag = tag;
                    if (tag === 'FILE') media.file = value;
                    else if (tag === 'TITL') media.title = value;
                    else if (tag === '_URL') media.pageUrl = value;
                    else if (tag === '_STROM_CLIP' && /^[A-Za-z0-9-]{1,32}$/.test(value.trim())) media.clip = value.trim();
                    else if (tag === '_STROM_SHA') media.sha = normalizeSha256(value) ?? undefined;
                    else if (tag === '_STROM_REGION') media.region = value;
                    else if (tag === '_STROM_ORIENT' && /^[2-8]$/.test(value.trim())) media.orient = Number(value.trim());
                    // FORM, _STROM_KIND, _REGION: nothing to keep — the data URL
                    // says the format, and every image on a source is its excerpt.
                }
            } else if (level === 3 && currentSubTag === 'OBJE' && sourceMediaSubTag === 'FILE'
                && tag === 'CONC' && src.media.length > 0) {
                src.media[src.media.length - 1].file += value;
            }
        } else if (currentRecord) {
            if (level === 1) {
                currentSubTag = tag;
                currentEvent = null;
                currentEventSubTag = null;
                currentFamEvent = null;
                currentFamEventSubTag = null;
                currentFactSubTag = null;
                currentStory = null;
                currentStorySubTag = null;
                currentResearch = null;
                if (tag !== 'OBJE') currentMedia = null;
                currentMediaSubTag = null;
                if (tag !== 'SOUR') { currentCitationId = null; currentCitationSlot = null; currentCitation = null; }

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
                                    indi.variantNameParts.push({});
                                    currentNameSlot = indi.nameVariants.length - 1;
                                }
                                break;
                            }
                            // Read into first/last name once the record is
                            // complete: its GIVN / SURN lines come after it.
                            currentNameSlot = -1;
                            indi.name = value;
                            break;
                        }
                        case 'SEX':
                            indi.sex = value;
                            break;
                        case IMPORT_TAG:
                            // The import the person came from, with the person's
                            // ids in it (read from app files only).
                            readRecordImport(indi, value);
                            break;
                        case XID_TAG:
                            // The person's ids in an import it did not come from.
                            readRecordImport(indi, value, true);
                            break;
                        case '_UID': case 'UID': case 'RIN': case 'EXID': case '_FSFTID': case 'AFN':
                            // The person's ids in the program that wrote the file.
                            readFileId(indi, tag, value);
                            break;
                        case '_STROM_SEX_ORIGIN':
                            // The research's origin of the sex (spec 066), Strom's own files only.
                            if (stromResearch || stromApp) ((indi.factOrigins ??= {}).sex ??= { was: [], sourceRefs: [] }).origin = value;
                            else drop(tag);
                            break;
                        case '_STROM_LINE': {
                            // The person's lineage correction (data v14); an
                            // unknown value is ignored.
                            const v = value.trim().toUpperCase();
                            if (v === 'FOUNDER' || v === 'NOCARRY') indi.stromLine = v;
                            break;
                        }
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
                        case '_MARNM':
                            // The married surname (Legacy, PAF, some exports).
                            if (value.trim()) indi.marnm.push(value.trim());
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
                        case '_STROM_CONFLICT':
                        case '_STROM_HYPO':
                        case '_STROM_SEARCHED':
                        case '_STROM_EDGE':
                        case '_STROM_ISLAND': {
                            // What Strom Research knows about the person. Only
                            // its own files are trusted with it; elsewhere the
                            // tag is as unknown as it always was.
                            if (!stromResearch) { drop(tag); break; }
                            const research = indi.research ??= newResearch();
                            if (tag === '_STROM_CONFLICT') {
                                research.conflicts.push({ id: value.trim(), fact: '', title: '', stat: '', take: '', values: [] });
                                currentResearch = { kind: 'conflict', sub: null };
                            } else if (tag === '_STROM_HYPO') {
                                research.hypotheses.push({ id: value.trim(), title: '', note: '', stat: '', chosen: '', by: '', deci: '', at: '', variants: [] });
                                currentResearch = { kind: 'hypo', sub: null };
                            } else if (tag === '_STROM_EDGE' || tag === '_STROM_ISLAND') {
                                // A snapshot: one per person (a second replaces the first).
                                const block = { value, lines: [] };
                                if (tag === '_STROM_EDGE') research.edge = block;
                                else research.island = block;
                                currentResearch = { kind: tag === '_STROM_EDGE' ? 'edge' : 'island', sub: null };
                            } else {
                                research.searched.push({ title: '', date: '', resn: '', at: '' });
                                currentResearch = { kind: 'searched', sub: null };
                            }
                            break;
                        }
                        case 'SOUR':
                            // Level-1 SOUR on INDI is a citation reference (@Sx@).
                            if (value) cite(indi.sourceRefs, value);
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
                            // Written in place, or a link to a media record (`1 OBJE @O1@`).
                            const media: RawMedia = { title: '', form: '', file: '', stromKind: '' };
                            if (GED_POINTER.test(value.trim())) media.ref = value.trim();
                            else if (level === 1) media.rawLine = rec.src;
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
                            } else if (KEPT_BOOKKEEPING_TAGS.has(tag) && keepsExtra(tag)) {
                                // Its change stamp: back with the record, never in the summary.
                                extraBlock = { target: indi, tag, start: rec.src, pointer: false, quiet: true };
                            } else if (!KNOWN_INDI_TAGS.has(tag) && tag !== 'BIRT' && tag !== 'DEAT'
                                && !IGNORED_BOOKKEEPING_TAGS.has(tag)) {
                                // Another program's own tag: kept as written for
                                // "Back to {prog}" (spec 066 G8); anything else counted.
                                if (tag.startsWith('_') && keepsExtra(tag)) {
                                    extraBlock = { target: indi, tag, start: rec.src, pointer: GED_POINTER.test(value.trim()) };
                                } else {
                                    drop(tag);
                                }
                            }
                            break;
                        }
                    }
                } else if (currentType === 'FAM') {
                    const fam = currentRecord as GedcomFamily;
                    switch (tag) {
                        // A couple of one sex as some programs write it: two WIFE or two HUSB.
                        // The second partner takes the slot left free, the first one written
                        // stays first (person1); the sexes come from SEX, never from the role.
                        case 'HUSB':
                            if (!value || value === fam.husb || value === fam.wife) break;
                            if (!fam.husb) fam.husb = value;
                            else if (!fam.wife) fam.wife = value;
                            else drop('HUSB');
                            break;
                        case 'WIFE':
                            if (!value || value === fam.wife || value === fam.husb) break;
                            if (!fam.wife) fam.wife = value;
                            else if (!fam.husb) { fam.husb = fam.wife; fam.wife = value; }
                            else drop('WIFE');
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
                        case '_RELATIONSHIP_STATUS':
                            // The same status in another program's tag. A value
                            // it does not know stays unsupported (MARR/DIV decide).
                            if (statusFromStat(value)) fam.relationshipStatus = value;
                            else drop(tag);
                            break;
                        case '_STROM_NO_COUPLE':
                            fam.noCouple = value !== 'N';
                            break;
                        case IMPORT_TAG:
                            readRecordImport(fam, value);
                            break;
                        case XID_TAG:
                            readRecordImport(fam, value, true);
                            break;
                        case '_UID': case 'UID': case 'RIN': case 'EXID': case '_FSFTID': case 'AFN':
                            readFileId(fam, tag, value);
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
                            if (value) cite(fam.sourceRefs, value);
                            break;
                        case 'MARR':
                            fam.unionEvents.push({ type: 'marriage', date: '' });
                            break;
                        case '_STORY':
                            fam.story = newStory();
                            currentStory = fam.story;
                            break;
                        default: {
                            const coupleType = coupleEventTypeOfTag(tag);
                            if (coupleType) {
                                // Banns, a contract, a census, a custom event:
                                // an event of the couple, with its date, place,
                                // witnesses and citations like a person's.
                                const ev: RawCoupleEvent = { type: coupleType };
                                const lineValue = value && value !== 'Y' ? value : '';
                                if (coupleType === 'custom') {
                                    ev.customLabel = lineValue || strings.gedcomNotes.genericEvent;
                                    if (lineValue) ev.tagValue = lineValue;
                                } else if (lineValue) {
                                    ev.note = lineValue;
                                }
                                fam.events.push(ev);
                                currentFamEvent = ev;
                                break;
                            }
                            if (NOTED_FAM_TAGS.has(tag)) {
                                fam.noteFacts.push({ tag, value, date: '', place: '' });
                            } else if (tag === 'OBJE' && GED_POINTER.test(value.trim())) {
                                // A family's link to a media record: the record is
                                // counted once if nothing else takes it (convertToStrom).
                            } else if (tag.startsWith('_') && !KNOWN_FAM_TAGS.has(tag)
                                && (!IGNORED_BOOKKEEPING_TAGS.has(tag) || KEPT_BOOKKEEPING_TAGS.has(tag)) && keepsExtra(tag)) {
                                extraBlock = { target: fam, tag, start: rec.src, pointer: GED_POINTER.test(value.trim()), quiet: KEPT_BOOKKEEPING_TAGS.has(tag) };
                            } else if (!KNOWN_FAM_TAGS.has(tag) && !IGNORED_BOOKKEEPING_TAGS.has(tag)) {
                                drop(tag);
                            }
                            break;
                        }
                    }
                }
            } else if (currentResearch && level >= 2 && currentType === 'INDI') {
                const research = (currentRecord as GedcomIndividual).research!;
                const open = currentResearch;
                if (open.kind === 'edge' || open.kind === 'island') {
                    (open.kind === 'edge' ? research.edge : research.island)?.lines.push({ level, tag, value });
                } else if (open.kind === 'conflict') {
                    const c = research.conflicts[research.conflicts.length - 1];
                    const lastValue = (): RawResearchValue | undefined =>
                        open.sub === 'DECI' ? c.decision : open.sub === 'VAL' ? c.values[c.values.length - 1] : undefined;
                    if (level === 2) {
                        open.sub = tag;
                        if (tag === 'TYPE') c.fact = value.trim();
                        else if (tag === 'TITL') c.title = value;
                        else if (tag === 'STAT') c.stat = value;
                        else if (tag === '_STROM_TAKE') c.take = value;
                        else if (tag === '_STROM_KIND') c.kind = value;
                        else if (tag === 'VAL') c.values.push({ value: value.trim(), sourceRefs: [] });
                        else if (tag === 'DECI') c.decision = { value: value.trim(), sourceRefs: [] };
                    } else if (level === 3) {
                        const v = lastValue();
                        if (open.sub === 'TITL' && (tag === 'CONC' || tag === 'CONT')) c.title += tag === 'CONT' ? ' ' + value : value;
                        else if (v && tag === 'SOUR' && GED_POINTER.test(value)) v.sourceRefs.push(value);
                        else if (v && open.sub === 'VAL' && tag === '_STROM_SIDE') v.side = value;
                        else if (v && open.sub === 'VAL' && tag === '_STROM_RAW') v.raw = value;
                        else if (v && tag === 'CONC') v.value += value;
                        else if (v && tag === 'CONT') v.value += ' ' + value;
                    }
                } else if (open.kind === 'hypo') {
                    const h = research.hypotheses[research.hypotheses.length - 1];
                    // 2 _VAR > 3 TITL (4 CONC/CONT) / 3 _LINK, _INTREE > 4 _PERS, _FAM, _PAR / 3 SOUR
                    const variant = open.sub === '_VAR' ? h.variants[h.variants.length - 1] : undefined;
                    if (level === 2) {
                        open.sub = tag;
                        open.sub3 = null;
                        if (tag === 'TITL') h.title = value;
                        else if (tag === 'NOTE') h.note = h.note ? `${h.note}\n${value}` : value;
                        else if (tag === 'STAT') h.stat = value;
                        else if (tag === '_CHOSEN') h.chosen = value;
                        // Who decided it, why and when (Strom Research 1.29, spec 060).
                        else if (tag === '_BY') h.by = value;
                        else if (tag === 'DECI') h.deci = value;
                        else if (tag === '_AT') h.at = value;
                        else if (tag === '_VAR') h.variants.push({ label: value, title: '', links: [], inTree: [], sourceRefs: [] });
                    } else if (level === 3 && variant) {
                        open.sub3 = tag;
                        if (tag === 'TITL') variant.title = value;
                        else if (tag === '_LINK') variant.links.push({ kind: value.trim().toLowerCase(), persons: [], family: [], parents: [] });
                        else if (tag === '_INTREE') variant.inTree.push({ kind: value.trim().toLowerCase(), persons: [], family: [], parents: [] });
                        else if (tag === 'SOUR' && GED_POINTER.test(value)) variant.sourceRefs.push(value);
                    } else if (level === 3 && (tag === 'CONC' || tag === 'CONT')) {
                        const glue = tag === 'CONT' ? '\n' + value : value;
                        if (open.sub === 'TITL') h.title += tag === 'CONT' ? ' ' + value : value;
                        else if (open.sub === 'NOTE') h.note += glue;
                        else if (open.sub === 'DECI') h.deci += glue;
                    } else if (level === 4 && variant) {
                        const link = open.sub3 === '_LINK' ? variant.links[variant.links.length - 1]
                            : open.sub3 === '_INTREE' ? variant.inTree[variant.inTree.length - 1] : undefined;
                        if (open.sub3 === 'TITL' && (tag === 'CONC' || tag === 'CONT')) variant.title += tag === 'CONT' ? ' ' + value : value;
                        else if (link && GED_POINTER.test(value)) {
                            if (tag === '_PERS') link.persons.push(value);
                            else if (tag === '_FAM') link.family.push(value);
                            else if (tag === '_PAR') link.parents.push(value);
                        }
                    }
                } else {
                    const x = research.searched[research.searched.length - 1];
                    if (level === 2) {
                        open.sub = tag;
                        if (tag === 'TITL') x.title = value;
                        else if (tag === 'DATE') x.date = value;
                        else if (tag === 'RESN') x.resn = value;
                        else if (tag === '_AT') x.at = value;
                    } else if (level === 3 && open.sub === 'TITL' && (tag === 'CONC' || tag === 'CONT')) {
                        x.title += tag === 'CONT' ? ' ' + value : value;
                    }
                }
            } else if (currentStory && level >= 2) {
                // 2 TYPE / TITL / STAT / TEXT / DATA / NOTE, each continued by
                // 3 CONC (same line) or 3 CONT (a real line break).
                const draft = currentStory.draft;
                if (level === 2) {
                    currentStorySubTag = tag;
                    currentDraftSubTag = null;
                    switch (tag) {
                        case '_DRAFT':
                            // The research's new version beside an approved
                            // story: trusted from its own files only.
                            if (stromResearch) currentStory.draft = { title: '', text: '', facts: [], note: '', sources: [], at: '' };
                            else drop(tag);
                            break;
                        case 'TYPE': currentStory.kind = value; break;
                        case 'TITL': currentStory.title = value; break;
                        case 'STAT': currentStory.stat = value; break;
                        case 'TEXT': currentStory.text = value; break;
                        case 'DATA': currentStory.facts.push(value); break;
                        case 'NOTE': currentStory.note = value; break;
                        // A source the story rests on (Strom Research 1.26): a pointer only.
                        case 'SOUR': if (GED_POINTER.test(value.trim())) currentStory.sources.push(value.trim()); break;
                    }
                } else if (currentStorySubTag === '_DRAFT') {
                    // 3 TITL / TEXT / DATA / NOTE / _AT, continued at level 4 —
                    // the story's own shape, one level deeper. No draft: the
                    // block was dropped above (not a research file).
                    if (draft && level === 3) {
                        currentDraftSubTag = tag;
                        switch (tag) {
                            case 'TITL': draft.title = value; break;
                            case 'TEXT': draft.text = value; break;
                            case 'DATA': draft.facts.push(value); break;
                            case 'NOTE': draft.note = value; break;
                            case 'SOUR': if (GED_POINTER.test(value.trim())) draft.sources.push(value.trim()); break;
                            case '_AT': draft.at = value; break;
                        }
                    } else if (draft && level === 4 && tag === 'TEXT' && currentDraftSubTag === 'DATA') {
                        const facts = draft.facts;
                        if (facts.length > 0 && facts[facts.length - 1] === '') facts[facts.length - 1] = value;
                        else facts.push(value);
                    } else if (draft && level === 4 && (tag === 'CONC' || tag === 'CONT')) {
                        const glue = tag === 'CONT' ? '\n' + value : value;
                        switch (currentDraftSubTag) {
                            case 'TITL': draft.title += glue; break;
                            case 'TEXT': draft.text += glue; break;
                            case 'NOTE': draft.note += glue; break;
                            case 'DATA':
                                if (draft.facts.length > 0) draft.facts[draft.facts.length - 1] += glue;
                                break;
                        }
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
                            noteDateForm(indi, value, isBirth ? indi.birthDate : indi.deathDate);
                        } else if (tag === 'PLAC') {
                            if (isBirth) indi.birthPlace = value; else indi.deathPlace = value;
                        } else if (tag === '_STROM_STATUS') {
                            if (isBirth) indi.birthStatus = parseFactStatus(value);
                            else indi.deathStatus = parseFactStatus(value);
                        } else if (tag === 'SOUR' && value) {
                            // The birth/death entry itself: cited on that field.
                            cite(isBirth ? indi.birthSourceRefs : indi.deathSourceRefs, value);
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
                            cite(indi.sourceRefs, value);
                        } else if (tag === '_MARNM' && value.trim()) {
                            // 2 _MARNM under a NAME: the married surname.
                            indi.marnm.push(value.trim());
                        } else if (tag === PRIMARY_NAME_TAG) {
                            // 2 _STROM_PRIMARY Y: the name the person goes by
                            // (Person.primaryName, resolved with the married
                            // surname). The first mark counts.
                            if (currentNameSlot !== null && indi.primaryMark === undefined && /^(y|yes)$/i.test(value.trim())) {
                                indi.primaryMark = currentNameSlot;
                            }
                        } else if (NAME_PART_TAGS.has(tag) && currentNameSlot !== null && value.trim()) {
                            // 2 GIVN / SURN / SPFX / NPFX / NSFX: the name's own parts.
                            const parts = currentNameSlot === -1 ? indi.primaryNameParts : indi.variantNameParts[currentNameSlot];
                            parts[NAME_PART_TAGS.get(tag)!] = value.trim();
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
                        else if (tag === '_STROM_SHA') currentMedia.sha = normalizeSha256(value) ?? undefined;
                        else if (tag === '_STROM_ORIENT' && /^[2-8]$/.test(value.trim())) currentMedia.orient = Number(value.trim());
                        else if ((tag === '_PRIM' || tag === '_PRIMARY' || tag === '_PERSONALPHOTO') && value === 'Y') currentMedia.primary = true;
                        else if (tag === '_DATE') { if (!currentMedia.date) currentMedia.date = mediaDateValue(value); }
                    } else if (NOTED_INDI_TAGS.has(currentSubTag ?? '') && indi.noteFacts.length > 0) {
                        attachToFact(indi.noteFacts[indi.noteFacts.length - 1], tag, value);
                    } else if (currentSubTag === 'SOUR' && tag === 'PAGE' && currentCitationId) {
                        // Citation page: standard place for a source reference.
                        citePage(value);
                    } else if (currentSubTag === 'SOUR' && tag === 'QUAY' && currentCitationId) {
                        noteQuay(currentCitationId, value);
                    } else if (currentEvent) {
                        currentEventSubTag = tag;
                        if (tag === 'DATE') {
                            currentEvent.date = parseGedcomDate(value);
                            noteDateForm(indi, value, currentEvent.date);
                        } else if (tag === 'PLAC') currentEvent.place = value;
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
                        else if (tag === '_STROM_STATUS') currentEvent.status = parseFactStatus(value);
                        else if (tag === 'SOUR' && value) {
                            cite(currentEvent.sourceRefs ??= [], value);
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
                            // MyHeritage keeps contact e-mail under RESI: a line of
                            // the note to read, the address itself to go back.
                            const line = strings.gedcomNotes.email(value);
                            currentEvent.note = currentEvent.note
                                ? `${currentEvent.note}\n${line}` : line;
                            (currentEvent.emails ??= []).push(value.trim());
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
                        citePage(value);
                    } else if (currentSubTag === 'SOUR' && tag === 'QUAY' && currentCitationId) {
                        noteQuay(currentCitationId, value);
                    } else if (currentSubTag === 'MARR') {
                        currentFactSubTag = tag;
                        if (tag === 'DATE') {
                            fam.marriageDate = parseGedcomDate(value);
                            noteDateForm(fam, value, fam.marriageDate);
                            lastUnionEvent(fam, 'marriage', fam.marriageDate);
                        }
                        // First wins: the union's startDate comes from the FIRST
                        // marriage, so its place must not drift to a later one.
                        if (tag === 'PLAC' && !fam.marriagePlace) fam.marriagePlace = value;
                        if (tag === '_STROM_STATUS' && !fam.marriageStatus) fam.marriageStatus = parseFactStatus(value);
                        // The marriage record's own citation, note and witnesses
                        // sit here, not on the FAM — reading only DATE/PLAC lost
                        // every one of them.
                        if (tag === 'SOUR' && value) {
                            cite(fam.sourceRefs, value);
                        } else if (tag === 'NOTE' && value) {
                            fam.note = fam.note ? `${fam.note}\n${value}` : value;
                        } else if (tag === 'ASSO' && value) {
                            fam.marriageParticipants.push({ ref: value });
                        } else if ((tag === '_WITN' || tag === 'WITN') && value) {
                            fam.marriageParticipants.push({ name: value, rela: WITNESS_RELA });
                        }
                    } else if (currentSubTag === 'DIV') {
                        // A remark on the divorce: a line of the couple's note,
                        // with its CONT / CONC (it was not read at all).
                        if (tag === 'NOTE' && !GED_POINTER.test(value)) {
                            const sink = factDetailSink();
                            if (sink) openDetail = { level, text: value, done: sink, sep: '\n' };
                        }
                        if (tag === 'PLAC' && value && !fam.divorcePlace) fam.divorcePlace = value;
                        if (tag === '_STROM_STATUS' && !fam.divorceStatus) fam.divorceStatus = parseFactStatus(value);
                        if (tag === 'DATE') {
                            fam.divorceDate = parseGedcomDate(value);
                            noteDateForm(fam, value, fam.divorceDate);
                            lastUnionEvent(fam, 'divorce', fam.divorceDate);
                        }
                    } else if (currentFamEvent) {
                        const ev = currentFamEvent;
                        currentFamEventSubTag = tag;
                        if (tag === 'DATE') {
                            ev.date = parseGedcomDate(value);
                            noteDateForm(fam, value, ev.date);
                        } else if (tag === 'PLAC') { if (value && !ev.place) ev.place = value; }
                        else if (tag === '_STROM_STATUS') ev.status = parseFactStatus(value);
                        else if (tag === 'TYPE' && ev.type === 'custom' && value) {
                            // 1 EVEN / 2 TYPE Křest dítěte manželů — the TYPE is
                            // the label; a value on the EVEN line is the content.
                            ev.customLabel = value;
                            if (ev.tagValue) {
                                ev.note = ev.note ? `${ev.tagValue}\n${ev.note}` : ev.tagValue;
                                delete ev.tagValue;
                            }
                        } else if (tag === 'SOUR' && value) {
                            cite(ev.sourceRefs ??= [], value);
                        } else if (tag === 'NOTE') {
                            ev.note = ev.note ? `${ev.note}\n${value}` : value;
                        } else if (tag === 'CONC' || tag === 'CONT') {
                            ev.note = (ev.note ?? '') + (tag === 'CONT' ? '\n' : '') + value;
                        } else if (tag === 'ASSO' && value) {
                            (ev.participants ??= []).push({ ref: value });
                        } else if ((tag === '_WITN' || tag === 'WITN') && value) {
                            (ev.participants ??= []).push({ name: value, rela: WITNESS_RELA });
                        }
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
                        citePage(value);
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
            } else if (level === 3 && currentType === 'FAM' && currentFamEvent) {
                // Under a couple's event: a note's continuation, a witness's
                // role, a citation's page and quality.
                const ev = currentFamEvent;
                const sub = currentFamEventSubTag;
                if (sub === 'NOTE' && (tag === 'CONT' || tag === 'CONC')) {
                    ev.note = (ev.note ?? '') + (tag === 'CONT' ? '\n' : '') + value;
                } else if (sub === 'ASSO' || sub === '_WITN' || sub === 'WITN') {
                    const last = ev.participants?.[ev.participants.length - 1];
                    if (last) {
                        if (tag === 'RELA') last.rela = value;
                        else if (tag === 'NOTE') last.note = value;
                    }
                } else if (sub === 'SOUR' && currentCitationId) {
                    if (tag === 'PAGE') {
                        citePage(value);
                    } else if (tag === 'QUAY') {
                        noteQuay(currentCitationId, value);
                    }
                }
            } else if (level === 3 && currentMedia && currentMediaSubTag === 'FILE' && tag === 'CONC') {
                // Data-URL payloads are CONC-wrapped (255-char physical lines).
                currentMedia.file += value;
            } else if (level === 3 && currentMedia && currentMediaSubTag === 'NOTE'
                && (tag === 'CONT' || tag === 'CONC')) {
                currentMedia.note = (currentMedia.note ?? '') + (tag === 'CONT' ? '\n' : '') + value;
            } else if (level === 3 && currentType === 'INDI' && currentEvent
                && currentEventSubTag === 'SOUR' && tag === 'PAGE' && currentCitationId) {
                citePage(value);
            } else if (level === 3 && currentType === 'INDI' && currentEvent
                && currentEventSubTag === 'SOUR' && tag === 'QUAY' && currentCitationId) {
                noteQuay(currentCitationId, value);
            }
        }
    }

    // A kept block on the last lines of the file.
    closeExtra(lines.length);
    readNoted(lines.length, 0, '');
    // A detail line on the very last line of the file has no successor to close it.
    flushDetail();

    // The lines of a couple's records when the couple has more than one, or
    // when one record marries the two again after a divorce: kept as written
    // for "Back to {prog}" (see JOINED_TAG, laterUnionStructures).
    if (!stromResearch) {
        const recordsOf = new Map<string, number>();
        const coupleOf = (fam: GedcomFamily): string => (fam.husb && fam.wife ? [fam.husb, fam.wife].sort().join('|') : '');
        for (const fam of families.values()) {
            const key = coupleOf(fam);
            if (key) recordsOf.set(key, (recordsOf.get(key) ?? 0) + 1);
        }
        for (const fam of families.values()) {
            const key = coupleOf(fam);
            const again = fam.unionEvents.some((e, i) => e.type === 'marriage' && fam.unionEvents.slice(0, i).some(d => d.type === 'divorce'));
            if (fam.recordLine !== undefined && ((key && recordsOf.get(key)! > 1) || again)) {
                fam.recordLines = structureAt(fam.recordLine).slice(1);
            }
        }
    }

    // A person's surname here is the birth one (a woman's maiden name). A file
    // that lists her married name first and marks another NAME as the birth
    // one would otherwise file her under her husband's surname: swap them.
    for (const indi of individuals.values()) {
        if (indi.primaryNameType !== 'married') continue;
        const k = indi.variantNameTypes.findIndex(t => t === 'birth' || t === 'maiden');
        if (k < 0) continue;
        const birthName = indi.nameVariants[k];
        const birthParts = indi.variantNameParts[k];
        indi.nameVariants[k] = indi.name;
        indi.variantNameTypes[k] = indi.primaryNameType;
        indi.variantNameParts[k] = indi.primaryNameParts;
        indi.name = birthName;
        indi.primaryNameType = 'birth';
        indi.primaryNameParts = birthParts;
        // The mark goes with its name.
        if (indi.primaryMark === -1) indi.primaryMark = k;
        else if (indi.primaryMark === k) indi.primaryMark = -1;
    }

    // The primary name into the two name fields, by the rules shared with the
    // research (GIVN / SURN first, the last pair of slashes, "N/A" is "?").
    // A file of Strom's own (the app's or the research's) holds names someone
    // typed in Strom: a given name "Syn" there is what was typed and comes
    // back as it went out, as the research reads the app's file in a sync;
    // a title keeps its commas as typed.
    const fromStrom = stromApp || stromResearch;
    // "? /Unknown/" is no surname in a file of the app from before 3.10.0-beta.7 or of no
    // version it names (HEAD > SOUR STROM > VERS "1.0" or missing), and in the research's
    // file; from that app version on (it writes "? //") it is the surname Unknown (N13).
    const unknownIsNoSurname = stromResearch || (stromApp && appUnknownIsNoSurname(stromAppVersion));
    for (const indi of individuals.values()) {
        const read = readGedcomName(indi.name, indi.primaryNameParts, { fromStrom, unknownIsNoSurname });
        indi.firstName = read.firstName;
        indi.lastName = read.lastName;
        if (read.description) indi.nameDescription = read.description;
        // The app writes a stand-in as "1 NAME //" and a person it knows
        // without a name as "? //" ("? /Unknown/" before 3.10): in its own
        // file only the first is a stand-in.
        const line = indi.name.trim();
        if (stromApp && read.firstName === '?' && !read.lastName && line && !/^\/\s*\/$/.test(line)) indi.knownNameless = true;
        if (read.titleBefore) indi.titleBefore = read.titleBefore;
        if (read.titleAfter) indi.titleAfter = read.titleAfter;
        readMarriedSurname(indi, { fromStrom, unknownIsNoSurname });
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
        sources.set(id, { id, title: text, repository: '', reference: '', url: '', note: '', media: [] });
    }

    // Resolve repository pointers (1 REPO @Rx@) to names, and citation PAGEs
    // into the source's reference when the record itself carried none.
    /** What the record itself says of its page and quality (a citation's are the citation's). */
    const recordPage = new Map<string, string>();
    const recordQuality = new Map<string, number | undefined>();
    for (const src of sources.values()) {
        recordPage.set(src.id, src.reference.trim());
        recordQuality.set(src.id, src.quality);
    }
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

    // A picture written in place: its lines as written, for a link that stays
    // one (a path or an address, no file to take) — "Back to {prog}" gives it back.
    for (const indi of individuals.values()) {
        for (const media of indi.media) {
            if (media.rawLine === undefined) continue;
            const block = [lines[media.rawLine].trim()];
            for (let i = media.rawLine + 1; i < lines.length; i++) {
                const l = lines[i].trim();
                if (!l) continue;
                const lv = parseInt(l, 10);
                if (!(lv >= 2)) break;
                block.push(l);
            }
            media.rawLines = block;
        }
    }

    // One source cited at several pages (a register book, an entry per page):
    // here a source is the entry and its reference the page, so a citation of
    // another page than the source's gets a source of its own — same book,
    // its page. With one source for all, every citation showed the first page
    // and the export wrote it to each of them. An entry's date (DATA > DATE)
    // is the entry's too: the same page cited with another date is another
    // entry, and a citation without one is not given one (spec 066 K3.1).
    const pageSources = new Map<string, string>();
    /** The date, QUAY and unread lines the record's own citations carry: the first of them says them. */
    const ownCite = new Map<string, { date: string; quay: number | undefined; kept: string }>();
    /** A citation's unread lines as a kept block (CITE_TAG): none, or `1 _STROM_CITE` and its lines a level deeper. */
    const citeBlock = (c: CitationSlot): string[] => {
        const body = [...(c.dataText?.length ? ['1 DATA', ...c.dataText] : []), ...(c.even ?? [])];
        const block = body.length ? [`1 ${CITE_TAG}`, ...body.map(l => l.replace(/^\d+/, n => String(Number(n) + 1)))] : [];
        return validExtraBlock(block) ? block : [];
    };
    for (const c of citations) {
        const src = sources.get(c.id);
        if (!src || c.list[c.index] !== c.id) continue;
        // A citation without a page cites the record's own page, if it has one (not another citation's).
        const page = c.page || recordPage.get(c.id) || '';
        const date = c.date ?? '';
        const quay = c.quay ?? recordQuality.get(c.id);
        const block = citeBlock(c);
        const kept = block.join('\n');
        if (page === src.reference.trim()) {
            if (!ownCite.has(c.id)) {
                ownCite.set(c.id, { date, quay, kept });
                if (block.length) (src.extras ??= []).push({ tag: CITE_TAG, lines: block, quiet: true });
            }
            const own = ownCite.get(c.id)!;
            if (own.date === date && own.quay === quay && own.kept === kept) continue;
        }
        const key = `${c.id}\u0000${page}\u0000${date}\u0000${quay ?? ''}\u0000${kept}`;
        let derived = pageSources.get(key);
        if (!derived) {
            derived = `${c.id}~${pageSources.size + 1}`;
            pageSources.set(key, derived);
            const quality = quay;
            sources.set(derived, {
                id: derived, title: src.title, repository: src.repository, reference: page, url: src.url,
                note: src.note, media: [], derivedFrom: c.id,
                ...(src.abbr ? { abbr: src.abbr } : {}),
                ...(quality !== undefined ? { quality } : {}),
                ...(date ? { recordDate: date } : {}),
                ...(src.importMark ? { importMark: src.importMark } : {}),
                ...(src.importXref ? { importXref: src.importXref } : {}),
                ...(src.importIdLines ? { importIdLines: src.importIdLines } : {}),
                ...(src.fileIds ? { fileIds: src.fileIds } : {}),
                ...(src.author !== undefined ? { author: src.author } : {}),
                ...(block.length ? { extras: [{ tag: CITE_TAG, lines: block, quiet: true }] } : {}),
            });
        }
        c.list[c.index] = derived;
    }
    // The record's own date: that of its own citations, else (a citation read
    // elsewhere, e.g. under a name) the first one seen, as before.
    for (const src of sources.values()) {
        if (src.derivedFrom) continue;
        const own = ownCite.get(src.id);
        // Its quality: that of its own citations (another page's QUAY is that page's).
        if (own) {
            if (own.quay !== undefined) src.quality = own.quay;
            else delete src.quality;
        }
        if (src.recordDate) continue;
        if (own) { if (own.date) src.recordDate = own.date; }
        else if (citationDates.has(src.id)) src.recordDate = citationDates.get(src.id);
    }

    closePlaceRecord();
    // A ref to a record the file does not have says nothing.
    for (const [key, id] of placeRefs) if (!placeRecords.has(id)) placeRefs.delete(key);

    // Keep only places whose MAP carried BOTH a latitude and a longitude.
    const places = new Map<string, PlaceGeo>();
    for (const [key, geo] of placeCoords) {
        if (Number.isFinite(geo.lat) && Number.isFinite(geo.lon)) places.set(key, geo);
    }

    const surnameGroups = surnameNoteGroups(surnameNoteLines.groups);
    const surnameRejections = surnameNoteGroups(surnameNoteLines.rejections);
    const surnameMarkers = { groups: surnameNoteLines.groups !== null, rejections: surnameNoteLines.rejections !== null };

    return {
        individuals, families, sources, repositories, droppedTags, places, surnameGroups,
        ...(placeRecords.size > 0 ? { placeRecords } : {}),
        ...(placeRefs.size > 0 ? { placeRefs } : {}),
        ...(surnameRejections.length > 0 ? { surnameRejections } : {}),
        ...(surnameMarkers.groups || surnameMarkers.rejections ? { surnameMarkers } : {}),
        ...(lineageMarker ? { lineageMarker } : {}),
        ...(stromResearch ? { stromResearch, ...(researchAsOf ? { researchAsOf } : {}) } : {}),
        ...(stromApp ? { stromApp } : {}),
        head: {
            ...((headSourName || headSourValue) ? { program: headSourName || headSourValue } : {}),
            ...(head.version ? { version: head.version } : {}),
            ...(head.date ? { date: head.date } : {}),
            ...(head.file ? { file: head.file } : {}),
        },
        ...((stromApp || stromResearch) && headImports.length > 0 ? { stromImports: headImports } : {}),
        ...(mediaRecords.size > 0 ? { mediaRecords } : {}),
    };
}

// ==================== CONVERTER ====================

/**
 * Convert parsed GEDCOM data to Strom data format
 */
export function convertToStrom(gedcom: ParsedGedcom, options: GedcomConvertOptions = {}): GedcomConversionResult {
    const { individuals, families, sources: gedSources, droppedTags } = gedcom;
    /** A file the app or the research wrote keeps the import marks it carries (spec 066). */
    const ownFile = !!(gedcom.stromApp || gedcom.stromResearch);
    const readMarks = !!options.importOrigin && ownFile;
    /**
     * Strom's own file (the research's tree, or the app's export coming back)
     * keeps the research's origin of facts as it carries it (spec 066).
     * Another program's file never gives one, whatever it says.
     */
    const readOrigins = ownFile;
    /** The research's origin of each event made from the file, until the end (Strom's own files only). */
    const eventOrigins = new WeakMap<LifeEvent | CoupleEvent, RawFactOrigin>();
    /** The marks of each event made from the file, until the end (app files only). */
    const eventMarks = new WeakMap<LifeEvent | CoupleEvent, RawImportMark[]>();
    /** The partnership each family became (the same couple's second family: the first one's). */
    const famPartnership = new Map<string, Partnership>();
    /** Parent links a family's CHIL marks as imported: child, its parents there, the import. */
    const parentMarks: { childId: PersonId; parents: PersonId[]; importId: string }[] = [];
    /** Excerpts with a `_STROM_REGION` on their original, until the page attachments exist. */
    const excerptRegions = new Map<SourceExcerpt, { x: number; y: number; w: number; h: number }>();

    // Family roles disambiguate individuals with SEX U/missing: a HUSB is
    // male, a WIFE female. Without any role we fall back to female (legacy
    // behaviour) but COUNT it so the import summary can say so.
    let unknownSexPersons = 0;
    let otherFamilyLinks = 0;
    let skippedMedia = 0;
    /** A media link or record not carried over: counted with the OBJEs. */
    const skipMedia = (): void => {
        skippedMedia++;
        droppedTags.set('OBJE', (droppedTags.get('OBJE') ?? 0) + 1);
    };
    /** Media records a person's or a source's link took; the others are counted once at the end. */
    const usedMedia = new Set<string>();
    /**
     * A person's link to a media record (`1 OBJE @O1@`) read as if the OBJE
     * were written in place: the record's file and marks, the link's own
     * title and portrait mark first. Null when the file has no such record.
     */
    const linkedMedia = (m: RawMedia): RawMedia | null => {
        if (!m.ref) return m;
        const rec = gedcom.mediaRecords?.get(m.ref);
        if (!rec) return null;
        usedMedia.add(m.ref);
        return {
            ...rec, title: m.title || rec.title, stromKind: m.stromKind || rec.stromKind,
            note: m.note ?? rec.note, sourceXref: m.sourceXref ?? rec.sourceXref, sha: m.sha ?? rec.sha, orient: m.orient ?? rec.orient,
            date: m.date ?? rec.date,
            ...(m.primary || rec.primary ? { primary: true } : {}),
        };
    };
    /** A source's link to a media record, the same way. */
    const linkedSourceMedia = (m: RawSourceMedia): RawSourceMedia | null => {
        if (!m.ref) return m;
        const rec = gedcom.mediaRecords?.get(m.ref);
        if (!rec) return null;
        usedMedia.add(m.ref);
        return { ...m, file: rec.file, title: m.title || rec.title, sha: m.sha ?? rec.sha, orient: m.orient ?? rec.orient };
    };

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
        if (raw.transcript?.trim()) src.transcript = raw.transcript.trim();
        if (raw.refn) src.refn = raw.refn;
        if (raw.verified && src.transcript) src.transcriptVerified = true;
        if (raw.readBy) {
            src.readBy = raw.readBy;
            if (raw.readConfirmed) src.readConfirmed = raw.readConfirmed;
            if (raw.readMark) src.readMark = raw.readMark;
        }
        if (raw.reading) {
            src.reading = raw.reading;
            if (raw.readingEntry) src.readingEntry = raw.readingEntry;
        }
        if (raw.readingSha) src.readingSha = raw.readingSha;
        if (raw.original) src.originalInResearch = true;
        if (raw.imageHeld) {
            src.imageHeld = raw.imageHeld;
            if (raw.heldClips?.length) src.heldClips = raw.heldClips;
        }
        if (raw.recordDate) src.recordDate = raw.recordDate;
        if (raw.author !== undefined && raw.author !== '' && src.note) src.gedcomAuthor = raw.author;
        // Images on a source record are crops of its entry. Only embedded
        // raster images come in; a path or URL (another program's media
        // folder) or any other payload is skipped and counted.
        for (const link of raw.media) {
            const media = linkedSourceMedia(link);
            if (!media) { skipMedia(); continue; }
            const exc = media.file.startsWith('data:')
                ? excerptFromDataUrl(media.file, { caption: media.title, pageUrl: media.pageUrl, clip: media.clip, originalSha: media.sha, orient: media.orient })
                : null;
            // Its place on the original: re-linked to the page attachment once persons are in.
            const region = exc?.originalSha ? parseRegion(media.region) : null;
            if (exc && region) excerptRegions.set(exc, region);
            if (!exc) {
                skipMedia();
                continue;
            }
            (src.excerpts ??= []).push(exc);
        }
        sources[newId] = src;
    }
    /**
     * Map raw @Sx@ refs to catalog ids, dropping any that don't resolve and
     * repeats (one entry cited by both BIRT and DEAT lands on the person twice).
     */
    const mapRefs = (refs?: string[]): string[] =>
        [...new Set((refs ?? []).map(r => sourceIdMap.get(r)).filter((id): id is string => !!id))];
    /** The research's pointers in what its hypotheses say: a person's number, a family's partners. */
    const researchRefs: ResearchRefs = {
        person: xref => individuals.get(xref)?.refn || undefined,
        familyPartners: xref => {
            const fam = families.get(xref);
            return fam ? [fam.husb, fam.wife].filter((x): x is string => !!x) : undefined;
        },
    };

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
        // SEX U, another value or none: the sex is unknown — the family role
        // (HUSB/WIFE) says who stands on which side, not the person's sex.
        const sex = indi.sex.trim().toUpperCase();
        const gender: Gender = sex === 'M' ? 'male' : sex === 'F' ? 'female' : 'unknown';
        if (gender === 'unknown') unknownSexPersons++;
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
            isPlaceholder: noFirst && noLast && !indi.knownNameless,
            partnerships: [],
            parentIds: [],
            childIds: []
        };

        if (indi.titleBefore) person.titleBefore = indi.titleBefore;
        if (indi.titleAfter) person.titleAfter = indi.titleAfter;
        if (indi.marriedSurname) person.marriedSurname = indi.marriedSurname;
        if (indi.marriedSurname && indi.marriedFirstName) person.marriedFirstName = indi.marriedFirstName;
        if (indi.marriedSurname && indi.primaryName) person.primaryName = indi.primaryName;

        // Add extended info if present
        if (indi.birthDate) person.birthDate = indi.birthDate;
        if (indi.birthPlace) person.birthPlace = indi.birthPlace;
        if (indi.deathDate) person.deathDate = indi.deathDate;
        // 'DEAT Y' without a date: mark deceased explicitly, otherwise the
        // liveness heuristic would treat the person as possibly living.
        if (indi.deceased && !indi.deathDate) person.isDeceased = true;
        if (indi.deathPlace) person.deathPlace = indi.deathPlace;
        if (indi.birthAddress) person.birthAddress = indi.birthAddress;
        if (indi.birthAge) person.birthAge = indi.birthAge;
        if (indi.deathCause) person.deathCause = indi.deathCause;
        if (indi.deathAge) person.deathAge = indi.deathAge;
        if (indi.deathAddress) person.deathAddress = indi.deathAddress;
        if (indi.birthStatus) person.birthStatus = indi.birthStatus;
        if (indi.deathStatus) person.deathStatus = indi.deathStatus;
        const dateForms = keptDateForms(indi.dateForms);
        if (dateForms) person.gedcomDates = dateForms;
        // Facts with no field of their own join the note, labelled, ahead of
        // whatever free text the file wrote (see NOTED_INDI_TAGS).
        const factLines = indi.noteFacts.map(factToNoteLine);
        const allNotes = [...factLines, ...(indi.notes ? [indi.notes] : [])];
        // What the file wrote in place of a name ("Mrtvě narozený"), kept as
        // written — after the rest, and only once.
        const description = indi.nameDescription;
        if (description && !allNotes.some(n => n.split('\n').some(l => l.trim() === description))) allNotes.push(description);
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
                if (ev.cause) out.cause = ev.cause;
                if (ev.age) out.age = ev.age;
                if (ev.address) out.address = ev.address;
                if (ev.note) out.note = ev.note;
                if (ev.status) out.status = ev.status;
                if (ev.emails?.length && ev.note) out.gedcomEmails = ev.emails;
                const evRefs = mapRefs(ev.sourceRefs);
                if (evRefs.length > 0) out.sourceIds = evRefs;

                const parts = (ev.participants ?? [])
                    .map(toParticipant).filter((p): p is EventParticipant => !!p);
                if (parts.length > 0) out.participants = parts;
                if (readMarks && ev.imports) eventMarks.set(out, ev.imports);
                if (readOrigins && ev.origin) eventOrigins.set(out, ev.origin);
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

        const story = toStory(indi.story, mapRefs);
        if (story) person.story = story;

        const research = gedcom.stromResearch ? toPersonResearch(indi.research, mapRefs, researchRefs) : undefined;
        if (research) person.research = research;

        const personRefs = mapRefs(indi.sourceRefs);
        if (personRefs.length > 0) person.sourceIds = personRefs;
        const birthRefs = mapRefs(indi.birthSourceRefs);
        if (birthRefs.length > 0) person.birthSourceIds = birthRefs;
        const deathRefs = mapRefs(indi.deathSourceRefs);
        if (deathRefs.length > 0) person.deathSourceIds = deathRefs;

        // OBJE media: a data-URL FILE is either the portrait (Strom marker)
        // or an attachment. External file paths cannot be embedded — counted
        // as dropped so the import summary mentions them.
        for (const link of indi.media) {
            const media = linkedMedia(link);
            if (!media) { skipMedia(); continue; }
            if (media.file.startsWith('data:')) {
                // Only the formats the app itself stores come in: a portrait
                // is a raster image, a document an image or a PDF. Anything
                // else (SVG, HTML, script …) could run when opened, so it is
                // skipped — and counted, so the summary says so.
                const wantsPhoto = media.stromKind === 'photo';
                if (!(wantsPhoto ? SAFE_PHOTO_DATA_URL : SAFE_ATTACHMENT_DATA_URL).test(media.file)) {
                    skipMedia();
                    continue;
                }
                if (wantsPhoto) {
                    person.photo = media.file;
                    if (media.title) person.photoOriginalName = media.title;
                    if (media.date) person.photoDate = media.date;
                } else {
                    const att: Attachment = {
                        id: generateId('att'),
                        name: media.title || 'attachment',
                        mimeType: media.file.slice(5, media.file.indexOf(';')) || 'application/octet-stream',
                        dataUrl: media.file,
                        sizeBytes: Math.round((media.file.length - media.file.indexOf(',') - 1) * 0.75),
                    };
                    if (media.note) att.note = media.note;
                    if (media.date) att.date = media.date;
                    if (media.sha) {
                        att.original = {
                            sha256: media.sha, name: att.name, mimeType: att.mimeType, bytes: 0,
                            ...(media.orient ? { orientation: media.orient } : {}),
                        };
                    }
                    const attSource = media.sourceXref ? sourceIdMap.get(media.sourceXref) : undefined;
                    if (attSource) att.sourceId = attSource;
                    (person.attachments ??= []).push(att);
                }
            } else if (media.file && media.sha && /^[0-9a-f]{64}$/.test(media.sha) && media.stromKind !== 'photo') {
                // Only the original, held by Strom Research by its hash (no preview yet).
                const name = media.title || media.file.split(/[\\/]/).pop() || 'file';
                const mimeType = originalMimeOf(media.file) || originalMimeOf(name);
                const att: Attachment = {
                    id: generateId('att'), name, mimeType, dataUrl: ORIGINAL_ONLY_DATA_URL, sizeBytes: 0, originalOnly: true,
                    original: { sha256: media.sha, name, mimeType, bytes: 0, ...(media.orient ? { orientation: media.orient } : {}) },
                };
                if (media.note) att.note = media.note;
                if (media.date) att.date = media.date;
                const attSource = media.sourceXref ? sourceIdMap.get(media.sourceXref) : undefined;
                if (attSource) att.sourceId = attSource;
                (person.attachments ??= []).push(att);
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
                    ...(media.date ? { date: media.date } : {}),
                };
                // The link as the file wrote it, for "Back to {prog}" while no file
                // takes its place (spec 066 G8): another program's file, or Strom's
                // "Back to" file read again, where it goes back to the import the
                // record's `1 _STROM_IMPORT Ix` names (never a picture of Strom's own).
                if (link.rawLines && options.importOrigin && !gedcom.stromResearch
                    && !link.rawLines.some(l => /^\d+ @|\s@[^@\s]+@|^\d+ _STROM_/.test(l))) {
                    (indi.extras ??= []).push({ tag: 'OBJE', lines: link.rawLines, quiet: true });
                }
                // Primary portraits first so the photo (not a crop) wins.
                if (media.primary) {
                    const firstOfPerson = externalMedia.findIndex(m => m.personId === personId);
                    if (firstOfPerson >= 0) { externalMedia.splice(firstOfPerson, 0, ref); }
                    else externalMedia.push(ref);
                } else {
                    externalMedia.push(ref);
                }
            } else if (link.ref) {
                // A media record with no file to take (a BLOB of GEDCOM 5.5, nothing at all).
                skipMedia();
            }
        }

        persons[personId] = person;
    }
    // Media records no person or source took (a family's photo, one nobody links): counted once each.
    for (const ref of gedcom.mediaRecords?.keys() ?? []) if (!usedMedia.has(ref)) skipMedia();

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
    /**
     * Where the child's own FAMC lines put a family (-1: none). The app writes
     * the family a child hangs from first, its other ones after (alsoChildOf):
     * in its own file that order decides between two of one kind.
     */
    const famcRank = (childGedId: string, famGedId: string): number =>
        individuals.get(childGedId)?.famcLinks.findIndex(l => l.famId === famGedId) ?? -1;
    for (const [gedFamId, fam] of families) {
        for (const childGedId of fam.children) {
            const chosen = childFamily.get(childGedId);
            if (!chosen) { childFamily.set(childGedId, gedFamId); continue; }
            const birth = isBirthLink(pediFor(childGedId, gedFamId));
            const chosenBirth = isBirthLink(pediFor(childGedId, chosen));
            if (birth && !chosenBirth) {
                childFamily.set(childGedId, gedFamId);
            } else if (gedcom.stromApp && birth === chosenBirth) {
                const rank = famcRank(childGedId, gedFamId);
                const chosenRank = famcRank(childGedId, chosen);
                if (rank >= 0 && (chosenRank < 0 || rank < chosenRank)) childFamily.set(childGedId, gedFamId);
            }
        }
    }

    /** Children this family actually keeps (the others hang from their own). */
    const childrenOf = (gedFamId: string, fam: GedcomFamily): string[] =>
        fam.children.filter(c => childFamily.get(c) === gedFamId);
    /** Does the family name a child (one the tree has) who hangs from another family? */
    const recordedElsewhere = (gedFamId: string, fam: GedcomFamily): boolean =>
        fam.children.some(c => {
            const id = personIdMap.get(c);
            return !!id && !!persons[id] && childFamily.get(c) !== gedFamId;
        });

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
        if (fam.marriageAddress) partnership.address = fam.marriageAddress;
        if (fam.divorcePlace) partnership.endPlace = fam.divorcePlace;
        if (fam.marriageStatus) partnership.startStatus = fam.marriageStatus;
        if (fam.divorceStatus) partnership.endStatus = fam.divorceStatus;
        // Ages by person: HUSB is the first partner, WIFE the second, unless
        // the file's own ids say otherwise (a parent with a placeholder).
        const husbId = (fam.husb && personIdMap.get(fam.husb)) || partnership.person1Id;
        const wifeId = (fam.wife && personIdMap.get(fam.wife)) || partnership.person2Id;
        const ages: Record<string, string> = {};
        if (fam.husbAge) ages[husbId] = fam.husbAge;
        if (fam.wifeAge && wifeId !== husbId) ages[wifeId] = fam.wifeAge;
        if (Object.keys(ages).length > 0) partnership.ages = ages;
        if (fam.note) partnership.note = fam.note;
        applyUnionOutcome(partnership, fam);
        // No MARR in the family record: "married" (or "divorced" by a DIV
        // alone) is only how a couple is read. Noted, so no export adds an
        // empty MARR the file never had (spec 066 K3.1); Strom's own files
        // write one for every couple said to be married, so theirs agree.
        if (!fam.unionEvents.some(e => e.type === 'marriage') && (partnership.status === 'married' || partnership.status === 'divorced')) {
            partnership.marriageUnrecorded = true;
        }
        const dateForms = keptDateForms(fam.dateForms);
        if (dateForms) partnership.gedcomDates = dateForms;

        // Banns, a contract, a census…: the couple's own events.
        if (fam.events.length > 0) {
            partnership.events = fam.events.map((ev): CoupleEvent => {
                const out: CoupleEvent = { id: generateLifeEventId(), type: ev.type };
                if (ev.customLabel) out.customLabel = ev.customLabel;
                if (ev.date) out.date = ev.date;
                if (ev.place) out.place = ev.place;
                if (ev.cause) out.cause = ev.cause;
                const evAges: Record<string, string> = {};
                if (ev.husbAge) evAges[husbId] = ev.husbAge;
                if (ev.wifeAge && wifeId !== husbId) evAges[wifeId] = ev.wifeAge;
                if (Object.keys(evAges).length > 0) out.ages = evAges;
                if (ev.address) out.address = ev.address;
                if (ev.note) out.note = ev.note;
                if (ev.status) out.status = ev.status;
                const refs = mapRefs(ev.sourceRefs);
                if (refs.length > 0) out.sourceIds = refs;
                const parts = (ev.participants ?? []).map(toWitness)
                    .filter((p): p is EventParticipant => !!p);
                if (parts.length > 0) out.participants = parts;
                if (readMarks && ev.imports) eventMarks.set(out, ev.imports);
                if (readOrigins && ev.origin) eventOrigins.set(out, ev.origin);
                return out;
            });
        }

        // The number of children as the file states it: no field of its own.
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

        const famStory = toStory(fam.story, mapRefs);
        if (famStory) partnership.story = famStory;
    };

    /**
     * A second FAM of the same couple (some programs write one per marriage
     * record) is the same union: its facts join the first instead of drawing
     * the couple twice.
     */
    const joinUnion = (into: Partnership, from: Partnership): JoinedMarks => {
        const marks: JoinedMarks = {};
        if (!into.startDate && from.startDate) into.startDate = from.startDate;
        if (from.gedcomDates) into.gedcomDates = { ...from.gedcomDates, ...(into.gedcomDates ?? {}) };
        if (!into.startPlace && from.startPlace) into.startPlace = from.startPlace;
        if (!into.endDate && from.endDate) into.endDate = from.endDate;
        if (!into.endPlace && from.endPlace) into.endPlace = from.endPlace;
        if (!into.address && from.address) into.address = from.address;
        if (from.ages) into.ages = { ...from.ages, ...(into.ages ?? {}) };
        if (from.note && !(into.note ?? '').includes(from.note)) {
            into.note = into.note ? `${into.note}\n${from.note}` : from.note;
            marks.text = from.note;
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
        if (from.events?.length) into.events = [...(into.events ?? []), ...from.events];
        // A marriage in either of the couple's families is one.
        if (!from.marriageUnrecorded) delete into.marriageUnrecorded;
        return marks;
    };
    const unionOfCouple = new Map<string, PartnershipId>();
    /** The records each partnership was read from, the first one first (more than one: joined, see joinUnion). */
    const recordsOfUnion = new Map<PartnershipId, [string, GedcomFamily][]>();
    /** The couple's other records kept as written for "Back to {prog}" (JOINED_TAG): their ids go there, not on the partnership. */
    const joinedKept = new Set<string>();
    let joinedFamilies = 0;

    /**
     * Hang one child under a partnership (both parents, PEDI, _FREL/_MREL) —
     * or, with no partnership, under the real parents alone (_STROM_NO_COUPLE).
     */
    const linkChild = (
        partnership: Partnership | null, childGedId: string, gedFamId: string, fam: GedcomFamily,
        realParents: { husb?: PersonId; wife?: PersonId },
    ): void => {
        const childId = personIdMap.get(childGedId);
        if (!childId || !persons[childId]) return;
        if (partnership && !partnership.childIds.includes(childId)) partnership.childIds.push(childId);
        const child = persons[childId];
        const parents = partnership
            ? [partnership.person1Id, partnership.person2Id]
            : [realParents.husb, realParents.wife].filter((pid): pid is PersonId => !!pid);
        for (const pid of parents) {
            if (!child.parentIds.includes(pid)) child.parentIds.push(pid);
            if (!persons[pid].childIds.includes(childId)) persons[pid].childIds.push(childId);
        }
        const linkMark = readMarks ? fam.childImports?.get(childGedId) : undefined;
        if (linkMark) parentMarks.push({ childId, parents, importId: linkMark });

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

    /**
     * Families Strom wrote for parents who are not a couple: the children hang
     * from those parents directly, as they did in the tree that wrote the file
     * — no partnership, no "?" partner. Only while the family holds nothing a
     * couple would (a wedding, events, notes, citations): then it is a couple
     * after all and goes the usual way.
     */
    const noCoupleFamilies = new Set<string>();
    for (const [gedFamId, fam] of families) {
        if (!fam.noCouple) continue;
        if (fam.unionEvents.length || fam.events.length || fam.note || fam.noteFacts.length
            || fam.sourceRefs.length || fam.marriageParticipants.length || fam.story || fam.stat || fam.relationshipStatus) continue;
        const husb = fam.husb ? personIdMap.get(fam.husb) : undefined;
        const wife = fam.wife ? personIdMap.get(fam.wife) : undefined;
        const real = {
            ...(husb && persons[husb] ? { husb } : {}),
            ...(wife && persons[wife] && wife !== husb ? { wife } : {}),
        };
        if (!real.husb && !real.wife) continue;
        // One parent and a child recorded here who hangs from another family
        // (an adoptive father beside the birth parents): the family itself is
        // kept, the "?" family the app makes of one parent anyway, so the
        // child's second FAMC has a family to point at (spec 066 K3.1).
        if (!(real.husb && real.wife) && recordedElsewhere(gedFamId, fam)) continue;
        noCoupleFamilies.add(gedFamId);
        for (const childGedId of childrenOf(gedFamId, fam)) linkChild(null, childGedId, gedFamId, fam, real);
    }

    for (const [gedFamId, fam] of families) {
        if (noCoupleFamilies.has(gedFamId)) continue;
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
            const marks = joinUnion(target, partnership);
            recordsOfUnion.get(sameCouple)?.push([gedFamId, fam]);
            joinedFamilies++;
            if (keepJoinedRecord(gedFamId, fam, marks)) joinedKept.add(gedFamId);
        } else {
            recordsOfUnion.set(partnershipId, [[gedFamId, fam]]);
            unionOfCouple.set(coupleKey, partnershipId);
            partnerships[partnershipId] = partnership;
            target = partnership;
            persons[person1Id]?.partnerships.push(partnershipId);
            persons[person2Id]?.partnerships.push(partnershipId);
        }

        famPartnership.set(gedFamId, target);
        for (const childGedId of childrenOf(gedFamId, fam)) {
            linkChild(target, childGedId, gedFamId, fam, { husb: person1Id, wife: person2Id });
        }
    }

    // A couple divorced in one record and married again in another (a record
    // per wedding): married, as when one record says both, and the divorce
    // and the new wedding said in the note. The first record's divorce goes
    // to "Back to {prog}" as written in place of that line, the new wedding
    // with its own record (JOINED_TAG).
    for (const [pid, records] of recordsOfUnion) {
        const target = partnerships[pid];
        const fams = records.map(([, fam]) => fam);
        const first = fams[0];
        if (fams.length < 2 || target.status !== 'divorced' || resolveUnionStatus(first).remarriage) continue;
        if (fams.some(f => statusFromStat(f.stat) ?? statusFromStat(f.relationshipStatus))) continue;
        const outcome = resolveUnionStatus({
            ...first,
            unionEvents: fams.flatMap(f => f.unionEvents),
            divorced: fams.some(f => f.divorced),
            divorceDate: fams.map(f => f.divorceDate).find(Boolean) ?? '',
            marriageDate: fams.map(f => f.marriageDate).find(Boolean) ?? '',
        });
        if (outcome.status !== 'married' || !outcome.remarriage) continue;
        const line = remarriageLine(outcome.remarriage);
        if (!noteRemarriage(first, line)) continue;
        target.status = 'married';
        delete target.endDate;
        delete target.endPlace;
        delete target.endStatus;
        target.note = target.note ? `${target.note}\n${line}` : line;
    }

    /** A "?" stand-in for a parent the family does not name. */
    const makePlaceholder = (gender: Gender): PersonId => {
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
        if (noCoupleFamilies.has(gedFamId)) continue;
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
        const knownParentId = husbId ?? wifeId;
        const parentId = knownParentId && persons[knownParentId] ? knownParentId : undefined;
        // Childless, one spouse — kept only when the family says something of its own (a wedding or a
        // divorce, even undated, a status, a note, a source…): Strom writes a "?" partner's family so,
        // without a record for the "?" ("married, the spouse unknown").
        const saysSomething = fam.unionEvents.length > 0 || fam.divorced || !!fam.stat || !!fam.relationshipStatus || !!fam.marriageDate || !!fam.marriagePlace
            || fam.events.length > 0 || !!fam.note || fam.noteFacts.length > 0 || fam.sourceRefs.length > 0
            || fam.marriageParticipants.length > 0 || !!fam.story;
        // A record of a loaded file (an import that keeps where its records came
        // from, or the research's tree marking it so) is kept too, with nothing
        // else of its own or with its children hanging from another family: its
        // ids go back with "Back to {prog}", and a child recorded in it as well
        // keeps the link (FAMC / CHIL), not a note (spec 066 K3.1/K3.2).
        const fileRecord = (!!options.importOrigin && !ownFile) || !!fam.importMark || (fam.importIds?.length ?? 0) > 0;
        // Strom's own file (the research's tree, the app's export) writes such a
        // family only for a child kept in it besides the one it hangs from: the
        // link comes back as it went, not as a note the research would take as new.
        const ownLink = ownFile && recordedElsewhere(gedFamId, fam);
        if (ownChildren.length === 0 && !(parentId && (saysSomething || fileRecord || ownLink))) continue;

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
            // Create placeholder for the missing parent (opposite gender; for a
            // parent of unknown sex, unknown too). Keep the HUSB as person1,
            // matching the two-parent path and the exporter, so
            // import->export->import is order-stable even when the known
            // parent is the mother: by sex, else by the role the file gives.
            const parentGender = persons[parentId].gender;
            const placeholderId = makePlaceholder(oppositeGender(parentGender));
            const parentIsHusb = parentGender === 'male' || (parentGender === 'unknown' && parentId === husbId);
            person1Id = parentIsHusb ? parentId : placeholderId;
            person2Id = parentIsHusb ? placeholderId : parentId;
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
        famPartnership.set(gedFamId, partnership);

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
            // The family itself, when it is one here: an export writes the
            // link back (FAMC / CHIL) instead of this line (spec 066 K3.1).
            const other = famPartnership.get(gedFamId);
            if (other) (child.alsoChildOf ??= []).push({ partnershipId: other.id, ...(pedi ? { pedi } : {}), note: line });
        }
    }

    // A crop cut from a page kept as an attachment: the same original (by its
    // hash) links them again, its region back in the page as shown.
    if (excerptRegions.size > 0) {
        const pages = new Map<string, Attachment>();
        for (const p of Object.values(persons)) {
            for (const a of p.attachments ?? []) if (a.original) pages.set(a.original.sha256, a);
        }
        for (const [exc, region] of excerptRegions) {
            const page = exc.originalSha ? pages.get(exc.originalSha) : undefined;
            if (!page) continue;
            exc.fromAttachmentId = page.id;
            exc.region = regionFromStored(region, page.original?.orientation);
        }
    }

    // A parent alone with children (Strom's own _STROM_NO_COUPLE families): the "?" family the app keeps.
    normalizeSingleParents({ persons, partnerships } as StromData);

    // Lineage corrections (`1 _STROM_LINE`), under the people's new ids.
    const lineFounders: string[] = [];
    const lineNotCarriers: string[] = [];
    for (const [gedId, indi] of validIndividuals) {
        const pid = personIdMap.get(gedId);
        if (!pid || !persons[pid] || !indi.stromLine) continue;
        (indi.stromLine === 'FOUNDER' ? lineFounders : lineNotCarriers).push(pid);
    }
    const lineageOverrides = lineFounders.length || lineNotCarriers.length
        ? { ...(lineFounders.length ? { founders: lineFounders } : {}), ...(lineNotCarriers.length ? { notCarriers: lineNotCarriers } : {}) }
        : null;

    const data: StromData = {
            persons,
            partnerships,
            ...(Object.keys(sources).length > 0 ? { sources } : {}),
            ...(gedcom.places.size > 0 ? { places: Object.fromEntries(gedcom.places) } : {}),
            // Strom Research's place records (spec 034): the research's, read as they come.
            ...(gedcom.placeRecords?.size ? { placeRecords: Object.fromEntries(gedcom.placeRecords) } : {}),
            ...(gedcom.placeRecords?.size && gedcom.placeRefs?.size ? { placeRefs: Object.fromEntries(gedcom.placeRefs) } : {}),
            // A marker with nothing under it (the research's "none") is an
            // empty list, no marker no list: carryOverTreeDecisions tells the
            // two apart when a research version is loaded; migrateData drops
            // an empty one.
            ...(gedcom.surnameGroups.length > 0 || gedcom.surnameMarkers?.groups ? { surnameVariants: gedcom.surnameGroups } : {}),
            ...(gedcom.surnameRejections?.length || gedcom.surnameMarkers?.rejections
                ? { surnameRejections: (gedcom.surnameRejections ?? []).map(forms => ({ forms })) } : {}),
            ...(gedcom.stromResearch && gedcom.researchAsOf && researchIsoDate(gedcom.researchAsOf)
                ? { researchAsOf: researchIsoDate(gedcom.researchAsOf) } : {}),
            // Like the surname markers: with the header mark the file's list
            // (even an empty one) is what it says; without it, nothing said.
            ...(lineageOverrides || gedcom.lineageMarker ? { lineageOverrides: lineageOverrides ?? {} } : {}),
    };

    // Where the facts came from (spec 066), only when the caller asks.
    let importId: string | undefined;
    /** Another program's own tags kept for "Back to {prog}", by tag (spec 066 G8). */
    const keptTags = new Map<string, number>();
    let extrasKept = false;
    const origin = options.importOrigin;
    if (origin && !ownFile) {
        // A file another program wrote: all of it is that file's, whatever
        // marks of ours it may carry (they are never read from it).
        const head = gedcom.head ?? {};
        const record = sanitizeImports([{
            id: 'I1',
            program: head.program ?? '',
            version: head.version,
            fileDate: head.date,
            at: origin.at,
            file: origin.file || head.file,
            encoding: origin.encoding,
            sha: origin.sha,
        }]);
        if (record) {
            data.imports = record;
            importId = record[0].id;
            markTreeImported(data, importId);
            applyForeignIds(importId);
            applyFileExtras(importId);
        }
    } else if (origin) {
        applyFileImportMarks();
        applyFileOriginalIds();
        applyFileExtras();
        if (readOrigins) applyResearchOrigins();
        cleanImportOrigin(data, gedcom.stromImports);
    } else if (readOrigins) {
        // All three are read; any one is reason to clean against the records.
        // The record's own import (`1 _STROM_IMPORT Rx`) too: without it an
        // export wrote it back as an import the record did not come from.
        const origins = applyResearchOrigins();
        const ids = applyFileOriginalIds();
        const marks = applyRecordImportMarks();
        if (origins || ids || marks) cleanImportOrigin(data, gedcom.stromImports);
    }

    // Another program's own tags with no import to keep them for (the file is
    // not loaded as an import): not carried over, so counted.
    if (!extrasKept) {
        for (const raw of [...individuals.values(), ...families.values(), ...gedSources.values()]) {
            for (const e of raw.extras ?? []) if (!e.quiet) droppedTags.set(e.tag, (droppedTags.get(e.tag) ?? 0) + 1);
        }
    }

    /**
     * Another program's level-1 `_XXX` tags of each person, family and source,
     * kept as written for "Back to {prog}" (spec 066 G8): from its file, all of
     * them for that import (`from`); from Strom's own "Back to" file read
     * again, a record's go back to the import its `1 _STROM_IMPORT Ix` mark
     * names (cleaned against the records afterwards). A record with no import
     * to keep them for keeps none, and they are counted.
     */
    function applyFileExtras(from?: string): void {
        extrasKept = true;
        const put = (holder: ExtraHolder | undefined, mark: string | undefined, extras: RawExtra[] | undefined): void => {
            for (const e of extras ?? []) {
                const to = from ?? mark;
                if (!holder || !to) { if (!e.quiet) droppedTags.set(e.tag, (droppedTags.get(e.tag) ?? 0) + 1); continue; }
                addGedcomExtra(holder, { from: to, lines: e.lines });
                if (!e.quiet) keptTags.set(e.tag, (keptTags.get(e.tag) ?? 0) + 1);
            }
        };
        for (const [gedId, indi] of individuals) {
            const pid = personIdMap.get(gedId);
            put(pid ? persons[pid] : undefined, indi.importMark, indi.extras);
        }
        for (const [gedFamId, fam] of families) put(famPartnership.get(gedFamId), fam.importMark, fam.extras);
        for (const [gedId, raw] of gedSources) {
            const sid = sourceIdMap.get(gedId);
            put(sid ? sources[sid] : undefined, raw.importMark, raw.extras);
        }
        // A page's source of its own keeps its record's tags too (not counted again).
        for (const [gedId, raw] of gedSources) {
            const sid = sourceIdMap.get(gedId);
            const base = raw.derivedFrom ? sources[sourceIdMap.get(raw.derivedFrom) ?? ''] : undefined;
            if (!sid || !sources[sid] || !base) continue;
            for (const entry of base.gedcomExtra ?? []) {
                // (Not the record's own citation's lines: this page's citation has its own.)
                const lines = withoutCiteLines(entry.lines);
                if (lines.length) addGedcomExtra(sources[sid], { from: entry.from, lines });
            }
        }
    }

    /**
     * Another program's file: each person and family keeps its xref and its id
     * lines there (spec 066 K3.2), as written. A couple read from two families
     * keeps the first one's xref and the lines of both.
     */
    function applyForeignIds(from: string): void {
        const known = new Set([from]);
        const put = (holder: Person | Partnership, gedId: string, lines: OriginalIdLine[] | undefined): void => {
            const entry = cleanOriginalIds({ from, xref: gedId.startsWith('@__anon') ? undefined : gedId, ids: lines ?? [] }, known);
            if (entry) addOriginalIds(holder, entry);
            // A line that is not taken (a control character, U+FFFD, too long) is counted.
            const kept = holder.originalIds?.find(e => e.from === from)?.ids ?? [];
            for (const raw of lines ?? []) {
                const line = cleanOriginalIdLine(raw);
                const taken = line && kept.some(l => l.tag === line.tag && l.value === line.value && (l.type ?? '') === (line.type ?? ''));
                if (!taken) droppedTags.set(raw.tag, (droppedTags.get(raw.tag) ?? 0) + 1);
            }
        };
        for (const [gedId, indi] of individuals) {
            const pid = personIdMap.get(gedId);
            const person = pid ? persons[pid] : undefined;
            if (person) put(person, gedId, indi.fileIds);
        }
        for (const [gedFamId, fam] of families) {
            const ps = famPartnership.get(gedFamId);
            if (ps && !joinedKept.has(gedFamId)) put(ps, gedFamId, fam.fileIds);
        }
        // A source record's xref, on every source it became (one per page cited).
        for (const [gedId, raw] of gedSources) {
            const sid = sourceIdMap.get(gedId);
            const xref = (raw.derivedFrom ?? gedId).match(/^@([^@]+)@$/)?.[1];
            if (!sid || !sources[sid] || !xref || xref.startsWith('__')) continue;
            // The record's ids (`1 RIN MH:S1`), on a page's source of its own too.
            const ids = (raw.derivedFrom ? gedSources.get(raw.derivedFrom)?.fileIds : raw.fileIds) ?? [];
            const entry = cleanOriginalIds({ from, xref, ids }, known);
            if (entry) addOriginalIds(sources[sid], entry);
        }
    }

    /**
     * A Strom file's ids of its records in the loaded files (the blocks under
     * `1 _STROM_IMPORT Ix`), cleaned against its import records afterwards.
     * Its own xrefs are never original ids. Returns whether there were any.
     */
    function applyFileOriginalIds(): boolean {
        let any = false;
        const put = (holder: Person | Partnership, blocks: RawOriginalIds[] | undefined): void => {
            for (const b of blocks ?? []) {
                if (!b.xref && b.ids.length === 0) continue;
                addOriginalIds(holder, { from: b.from, ...(b.xref ? { xref: b.xref } : {}), ids: b.ids });
                any = true;
            }
        };
        for (const [gedId, indi] of individuals) {
            const pid = personIdMap.get(gedId);
            const person = pid ? persons[pid] : undefined;
            if (person) put(person, indi.importIds);
        }
        for (const [gedFamId, fam] of families) {
            const ps = famPartnership.get(gedFamId);
            if (ps && !joinedKept.has(gedFamId)) put(ps, fam.importIds);
        }
        // A source record's xref in the file it came from (`2 _XREF` under its `1 _STROM_IMPORT`).
        for (const [gedId, raw] of gedSources) {
            const sid = sourceIdMap.get(gedId);
            if (!sid || !sources[sid] || !raw.importMark || !raw.importXref) continue;
            addOriginalIds(sources[sid], { from: raw.importMark, xref: raw.importXref, ids: raw.importIdLines ?? [] });
            any = true;
        }
        return any;
    }

    /**
     * The research's origin of the facts (`_STROM_ORIGIN`, `_STROM_WAS`,
     * `_STROM_SEX_ORIGIN`) and its import records (HEAD `1 _STROM_IMPORT R1`).
     * Returns whether there was anything (a research without the feature
     * writes none of it: nothing is added then).
     */
    function applyResearchOrigins(): boolean {
        let any = (gedcom.stromImports?.length ?? 0) > 0;
        const put = (holder: Person | Partnership, fact: string, raw: RawFactOrigin | undefined): void => {
            const o = raw ? toResearchOrigin(raw, mapRefs) : null;
            if (!o) return;
            (holder.researchOrigins ??= {})[fact] = o;
            any = true;
        };
        for (const [gedId, indi] of individuals) {
            const pid = personIdMap.get(gedId);
            const person = pid ? persons[pid] : undefined;
            if (!person) continue;
            for (const [fact, raw] of Object.entries(indi.factOrigins ?? {})) put(person, fact, raw);
            for (const ev of person.events ?? []) put(person, `event:${ev.id}`, eventOrigins.get(ev));
        }
        for (const [gedFamId, fam] of families) {
            const ps = famPartnership.get(gedFamId);
            if (!ps) continue;
            for (const [fact, raw] of Object.entries(fam.factOrigins ?? {})) if (!ps.researchOrigins?.[fact]) put(ps, fact, raw);
        }
        for (const ps of Object.values(partnerships)) {
            for (const ev of ps.events ?? []) put(ps, `event:${ev.id}`, eventOrigins.get(ev));
        }
        return any;
    }

    /** A Strom file's own marks, as it carries them (cleaned against its records afterwards). */
    function applyFileImportMarks(): void {
        const markFact = (holder: Person | Partnership, fact: string, marks: RawImportMark[] | undefined): void => {
            for (const mark of marks ?? []) markFactImported(holder, fact, mark.id, mark.parts);
        };
        applyRecordImportMarks();
        for (const [gedId, indi] of individuals) {
            const pid = personIdMap.get(gedId);
            const person = pid ? persons[pid] : undefined;
            if (!person) continue;
            for (const [fact, marks] of Object.entries(indi.factImports ?? {})) markFact(person, fact, marks);
            for (const ev of person.events ?? []) markFact(person, `event:${ev.id}`, eventMarks.get(ev));
        }
        for (const [gedFamId, fam] of families) {
            const ps = famPartnership.get(gedFamId);
            if (!ps) continue;
            for (const [fact, marks] of Object.entries(fam.factImports ?? {})) markFact(ps, fact, marks);
        }
        for (const ps of Object.values(partnerships)) {
            for (const ev of ps.events ?? []) markFact(ps, `event:${ev.id}`, eventMarks.get(ev));
        }
        for (const { childId, parents, importId: from } of parentMarks) {
            const child = persons[childId];
            if (!child) continue;
            for (const pid of parents) if (child.parentIds.includes(pid)) (child.importedParents ??= {})[pid] = from;
        }
    }

    /**
     * The import each record came from, as a Strom file (the app's or the
     * research's) carries it: `1 _STROM_IMPORT Ix` on the person, the family,
     * the source. Returns whether there was any.
     */
    function applyRecordImportMarks(): boolean {
        let any = false;
        for (const [gedId, indi] of individuals) {
            const pid = personIdMap.get(gedId);
            const person = pid ? persons[pid] : undefined;
            if (person && indi.importMark) { person.importId = indi.importMark; any = true; }
        }
        for (const [gedFamId, fam] of families) {
            const ps = famPartnership.get(gedFamId);
            if (ps && fam.importMark && !ps.importId) { ps.importId = fam.importMark; any = true; }
        }
        for (const [gedId, raw] of gedSources) {
            const sid = sourceIdMap.get(gedId);
            if (raw.importMark && sid && sources[sid]) { sources[sid].importId = raw.importMark; any = true; }
        }
        return any;
    }

    const result: GedcomConversionResult = {
        externalMedia,
        data,
        ...(importId ? { importId } : {}),
        stats: {
            otherFamilyLinks,
            joinedFamilies,
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
            keptTags: [...keptTags.values()].reduce((a, b) => a + b, 0),
            keptTagSummary: [...keptTags.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag).join(', '),
            totalGedFamilies: families.size
        }
    };
    return result;
}

