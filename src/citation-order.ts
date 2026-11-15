/**
 * The order of a fact's citations (spec 095 K1.1): one rule for the app and
 * Strom Research (its `core/citeorder.ts`), computed from what a GEDCOM file
 * carries, so that the first citation of a fact is its record — the baptism
 * entry of a birth, never a later burial entry — and every place shows the
 * same document by it (the chips, the bubbles, the person page, the book,
 * the family pages, the GEDCOM export).
 *
 *   1. the main citation the user chose (`citationMain`), at most one a fact;
 *   2. the primary record of that event: a source recording the fact's event
 *      (`Source.events`, see FACT_RECORDS), its citation of QUAY 3, written at
 *      most 12 months from the fact (a date missing or unreadable does not
 *      decide) — the earliest written first, the undated after the dated;
 *   3. the other citations of QUAY 3;
 *   4. the rest by QUAY, highest first (no QUAY after 0);
 *   5. ties: the source's number (`S0012` → 12; none after every numbered
 *      one), then the order the citations stand in the list.
 *
 * The stored list is never reordered: the order is only shown and exported.
 * A tree of a research that orders its citations itself (`citations.order`)
 * keeps the file's order (`fileOrder`), only its main citation first.
 */

import {
    CoupleEvent, LifeEvent, LifeEventType, Partnership, PartnershipId, Person, PersonId, Source, StromData,
} from './types.js';
import { CitationHolder, citationMainOf, citationQuality } from './citation-quality.js';
import { COUPLE_EVENT_TAG, isCoupleEventType, LIFE_EVENT_TAG } from './events.js';
import { parseFlexDate } from './dates.js';

type Sources = Readonly<Record<string, Source | undefined>> | undefined;

// ==================== THE EVENTS A RECORD RECORDS ====================

/** A GEDCOM event tag as `Source.events` keeps it (upper case). */
const EVENT_TAG_RE = /^[A-Z][A-Z0-9_]{0,31}$/;

/** At most this many events a record (a GEDCOM line stays short). */
const SOURCE_EVENTS_MAX = 20;

/**
 * The events of `Source.events` as they are kept: tags in upper case, each
 * once, in their order; anything else (not a tag, not a string) goes.
 * Undefined: none left.
 */
export function cleanSourceEvents(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const out: string[] = [];
    for (const v of value) {
        if (typeof v !== 'string' || !EVENT_TAG_RE.test(v) || out.includes(v)) continue;
        out.push(v);
        if (out.length >= SOURCE_EVENTS_MAX) break;
    }
    return out.length ? out : undefined;
}

/** cleanSourceEvents over a tree's sources (data v21), in place. */
export function cleanTreeSourceEvents(sources: Record<string, Source> | undefined): void {
    for (const src of Object.values(sources ?? {})) {
        if (!src || typeof src !== 'object' || !('events' in src)) continue;
        const events = cleanSourceEvents(src.events);
        if (events) src.events = events;
        else delete src.events;
    }
}

/** The events whose record is the primary record of a fact of a kind (spec 095 oddíl 2): none for any other kind. */
const FACT_RECORDS: Readonly<Record<string, readonly string[]>> = {
    BIRT: ['BIRT', 'CHR', 'BAPM'],
    CHR: ['BIRT', 'CHR', 'BAPM'],
    BAPM: ['BIRT', 'CHR', 'BAPM'],
    DEAT: ['DEAT', 'BURI', 'CREM'],
    BURI: ['DEAT', 'BURI', 'CREM'],
    CREM: ['DEAT', 'BURI', 'CREM'],
    MARR: ['MARR'],
    MARB: ['MARR'],
    MARL: ['MARR'],
    ENGA: ['MARR'],
    CENS: ['CENS'],
};

/**
 * Whether a source is a record of this fact's own event (its events against
 * the fact's kind). Undefined: the fact or the source has no such kind.
 */
export function recordOfFact(src: Pick<Source, 'events'> | undefined, tag: string | undefined): boolean | undefined {
    const wanted = tag ? FACT_RECORDS[tag.toUpperCase()] : undefined;
    const has = src?.events ?? [];
    if (!wanted || !has.length) return undefined;
    return has.some(e => wanted.includes(e));
}

// ==================== DATES ====================

/**
 * The months a date may mean (year × 12 + month − 1), read as loosely as it
 * is written, as Strom Research reads a GEDCOM date (`gdate.ts dateMonths`):
 * a year January to December, "about" two years either side, "before" twenty
 * years before, "after" twenty after, a range or period both ends. Undefined
 * for a date that cannot be read (a phrase).
 */
export function dateMonths(value: string | undefined): { min: number; max: number } | undefined {
    const d = parseFlexDate(value);
    if (!d) return undefined;
    const span = (p: { year: number; month?: number }) =>
        ({ min: p.year * 12 + (p.month ? p.month - 1 : 0), max: p.year * 12 + (p.month ? p.month - 1 : 11) });
    const start = span(d);
    if (d.end) {
        const end = span(d.end);
        return { min: Math.min(start.min, end.min), max: Math.max(start.max, end.max) };
    }
    if (d.qualifier === '<') return { min: start.min - 240, max: start.max };
    if (d.qualifier === '>') return { min: start.min, max: start.max + 240 };
    if (d.qualifier === '~') return { min: start.min - 24, max: start.max + 24 };
    return start;
}

/** The gap between two dates in months, as loosely as each is written (0 where they overlap); undefined: either unreadable. */
export function monthsApart(a: string | undefined, b: string | undefined): number | undefined {
    const x = dateMonths(a);
    const y = dateMonths(b);
    if (!x || !y) return undefined;
    return Math.max(0, x.min - y.max, y.min - x.max);
}

/** A primary record is written at most this many months from its fact. */
export const PRIMARY_RECORD_MONTHS = 12;

// ==================== SOURCE NUMBERS ====================

/** The number of a research's source id (`S0012` → 12, a page of it `S12~3` → 12), or undefined. */
function numberOfId(id: string | undefined): number | undefined {
    const m = id ? /^S(\d+)(?:~\d+)?$/i.exec(id.trim()) : null;
    return m ? Number(m[1]) : undefined;
}

/** What a source record says of itself; a page of it (a source of its own per place cited) says the same. */
const recordKey = (s: Source): string =>
    [s.title, s.repository, s.callNumber, s.url, s.note].map(v => (v ?? '').trim()).join('\u0001');

/**
 * The number of each source (step 5): the research's number (`refn` `S0012`
 * → 12), else that of the record it is a page of (a source the import made
 * for another place cited in the same record: the same record without a
 * number of its own), else none. Bulk callers (an export) compute it once
 * and pass it to orderedCitations.
 */
export function sourceNumbers(sources: Sources): Map<string, number> {
    const out = new Map<string, number>();
    const byRecord = new Map<string, number>();
    const unnumbered: Source[] = [];
    for (const src of Object.values(sources ?? {})) {
        if (!src) continue;
        const n = numberOfId(src.refn) ?? numberOfId(src.id);
        if (n === undefined) { unnumbered.push(src); continue; }
        out.set(src.id, n);
        const key = recordKey(src);
        if (!byRecord.has(key)) byRecord.set(key, n);
    }
    for (const src of unnumbered) {
        const n = byRecord.get(recordKey(src));
        if (n !== undefined) out.set(src.id, n);
    }
    return out;
}

/**
 * The sources that are pages of another record (spec 095, ZADANI_VYZKUM 1.5):
 * a source the import made for another place cited in a record with a
 * number (`refn`) — the same record without a number of its own, and no
 * transcript or excerpt of its own (else it is an entry of its own) — by
 * the source of that record. A record whose words two numbered sources share
 * says nothing (which one it is a page of is not known).
 */
export function recordPagesOf(sources: Sources): Map<string, string> {
    const records = new Map<string, string | null>();
    for (const src of Object.values(sources ?? {})) {
        if (!src?.refn?.trim()) continue;
        const key = recordKey(src);
        records.set(key, records.has(key) ? null : src.id);
    }
    const out = new Map<string, string>();
    if (!records.size) return out;
    for (const src of Object.values(sources ?? {})) {
        if (!src || src.refn?.trim() || src.transcript?.trim() || src.excerpts?.length) continue;
        const record = records.get(recordKey(src));
        if (record && record !== src.id) out.set(src.id, record);
    }
    return out;
}

/** The numbers of the cited sources only (one fact); the record's number for a page only when one of them has none. */
function numbersOf(ids: readonly string[], sources: Sources): ReadonlyMap<string, number> {
    const out = new Map<string, number>();
    let missing = false;
    for (const id of ids) {
        const n = numberOfId(sources?.[id]?.refn) ?? numberOfId(id);
        if (n === undefined) missing = true;
        else out.set(id, n);
    }
    if (!missing) return out;
    const all = sourceNumbers(sources);
    for (const id of ids) if (!out.has(id) && all.has(id)) out.set(id, all.get(id)!);
    return out;
}

// ==================== THE ORDER ====================

/** The fact a list of citations is of: its GEDCOM tag (none: a person's own citations, no primary record) and date. */
export interface CitationFact {
    tag?: string;
    date?: string;
}

/**
 * The step of K1.1 that puts a citation before the next one: 1 the main
 * citation, 2 the primary record (or the earlier written of two), 3 an
 * original (QUAY 3), 4 the higher QUAY, 5 the number or the list's order.
 * The last (or only) citation: 5, unless it is the main one.
 */
export type CitationStep = 1 | 2 | 3 | 4 | 5;

export interface OrderedCitation {
    /** The source id. */
    id: string;
    step: CitationStep;
}

export interface CitationOrderOptions {
    /** The file's order (a research with `citations.order`): nothing sorted, only the main citation first. */
    fileOrder?: boolean;
    /** The sources' numbers, computed once (sourceNumbers) by a caller ordering many facts. */
    numbers?: ReadonlyMap<string, number>;
}

/**
 * The citations of one list of a holder in the K1.1 order (a new array; the
 * stored list is left as it is), each with the step that placed it. A
 * citation of a source not in the catalog stays among the lowest, in place.
 */
export function orderedCitationSteps(
    data: Pick<StromData, 'sources'>, holder: CitationHolder & Record<string, unknown>, field: string,
    fact: CitationFact = {}, opts: CitationOrderOptions = {},
): OrderedCitation[] {
    const list = holder[field];
    const ids = Array.isArray(list) ? [...new Set(list.filter((x): x is string => typeof x === 'string'))] : [];
    const main = citationMainOf(holder as CitationHolder & Partial<Record<string, string[]>>, field);
    if (opts.fileOrder) {
        const rest = ids.filter(id => id !== main);
        return [...(main ? [{ id: main, step: 1 as const }] : []), ...rest.map(id => ({ id, step: 5 as const }))];
    }
    const sources = data.sources;
    const numbers = opts.numbers ?? numbersOf(ids, sources);
    const keyed = ids.map((id, i) => {
        const src = sources?.[id];
        const q = src ? citationQuality(holder, field, id, sources) ?? -1 : -1;
        const gap = src?.recordDate && fact.date ? monthsApart(src.recordDate, fact.date) : undefined;
        const primary = q === 3 && recordOfFact(src, fact.tag) === true && (gap === undefined || gap <= PRIMARY_RECORD_MONTHS);
        const written = src?.recordDate ? dateMonths(src.recordDate)?.min : undefined;
        const rank = id === main ? 1 : primary ? 2 : q === 3 ? 3 : 4;
        return { id, i, rank, q, written: written ?? Number.POSITIVE_INFINITY, n: numbers.get(id) ?? Number.POSITIVE_INFINITY };
    });
    type Key = typeof keyed[number];
    /** The step that sets `a` before `b` (0: nothing does, they are equal). */
    const decides = (a: Key, b: Key): number => {
        if (a.rank !== b.rank) return a.rank < b.rank ? -a.rank : b.rank;
        if (a.rank === 2 && a.written !== b.written) return a.written < b.written ? -2 : 2;
        if (a.rank === 4 && a.q !== b.q) return a.q > b.q ? -4 : 4;
        if (a.n !== b.n) return a.n < b.n ? -5 : 5;
        return a.i < b.i ? -5 : a.i > b.i ? 5 : 0;
    };
    keyed.sort((a, b) => Math.sign(decides(a, b)) || 0);
    return keyed.map((k, i) => {
        if (k.rank === 1) return { id: k.id, step: 1 };
        const next = keyed[i + 1];
        const step = next ? Math.abs(decides(k, next)) : 5;
        return { id: k.id, step: (step >= 1 && step <= 5 ? step : 5) as CitationStep };
    });
}

/** orderedCitationSteps, only the source ids. */
export function orderedCitations(
    data: Pick<StromData, 'sources'>, holder: CitationHolder & Record<string, unknown>, field: string,
    fact: CitationFact = {}, opts: CitationOrderOptions = {},
): string[] {
    return orderedCitationSteps(data, holder, field, fact, opts).map(c => c.id);
}

// ==================== ONE FACT'S CITATIONS ====================

/**
 * A list of citations as the app addresses it (the source viewer's
 * CitationContext): a person's birth or death, a person's event, a couple's
 * wedding (no event, no fact) or divorce, a couple's event; a person with
 * neither is the person's own citations (no fact).
 */
export type CitationRef =
    | { personId: PersonId; eventId?: string; fact?: 'birth' | 'death' }
    | { partnershipId: PartnershipId; eventId?: string; fact?: 'divorce' };

/** The words of a fact (`strings.events.typesOf`): a person's event type, a couple's, the wedding, the divorce. */
export type CitationFactWord = LifeEventType | CoupleEvent['type'] | 'marriage' | 'divorce';

/** One list of citations of a tree with what the order and the main citation need of it. */
export interface CitationFactInfo {
    holder: CitationHolder & Record<string, unknown>;
    /** The list's key on the holder. */
    field: string;
    /** The fact's tag and date (no tag: a person's own citations). */
    fact: CitationFact;
    /** Whether the list is a fact's (may have a main citation): not a person's own citations. */
    isFact: boolean;
    /** The fact's word (strings.events.typesOf), none for a person's own citations. */
    word?: CitationFactWord;
    /** A custom event's own label (said instead of the word). */
    label?: string;
    /** The person's event or the couple's event the list is on. */
    event?: LifeEvent | CoupleEvent;
    person?: Person;
    partnership?: Partnership;
    /** The list as stored. */
    sourceIds: readonly string[];
}

const PERSON_EVENT_TAG = (type: LifeEventType): string =>
    type === 'birth' ? 'BIRT' : type === 'death' ? 'DEAT' : LIFE_EVENT_TAG[type] ?? 'EVEN';

/** The list of citations a reference names in the tree, or null when the person, the couple or the event is not there. */
export function citationFact(data: Pick<StromData, 'persons' | 'partnerships'>, ref: CitationRef): CitationFactInfo | null {
    const as = (h: object) => h as unknown as CitationHolder & Record<string, unknown>;
    if ('personId' in ref) {
        const person = data.persons?.[ref.personId];
        if (!person) return null;
        if (ref.eventId) {
            const ev = person.events?.find(e => e.id === ref.eventId);
            if (!ev) return null;
            const label = ev.type === 'custom' ? ev.customLabel?.trim() || undefined : undefined;
            return {
                holder: as(ev), field: 'sourceIds', fact: { tag: PERSON_EVENT_TAG(ev.type), date: ev.date }, isFact: true,
                word: ev.type, label, event: ev, person, sourceIds: ev.sourceIds ?? [],
            };
        }
        if (ref.fact === 'birth' || ref.fact === 'death') {
            const field = ref.fact === 'birth' ? 'birthSourceIds' : 'deathSourceIds';
            const date = ref.fact === 'birth' ? person.birthDate : person.deathDate;
            return {
                holder: as(person), field, fact: { tag: ref.fact === 'birth' ? 'BIRT' : 'DEAT', date }, isFact: true,
                word: ref.fact, person, sourceIds: person[field] ?? [],
            };
        }
        return { holder: as(person), field: 'sourceIds', fact: {}, isFact: false, person, sourceIds: person.sourceIds ?? [] };
    }
    const partnership = data.partnerships?.[ref.partnershipId];
    if (!partnership) return null;
    if (ref.eventId) {
        const ev = partnership.events?.find(e => e.id === ref.eventId);
        if (!ev) return null;
        const tag = isCoupleEventType(ev.type) ? COUPLE_EVENT_TAG[ev.type] : 'EVEN';
        const label = ev.type === 'custom' ? ev.customLabel?.trim() || undefined : undefined;
        return {
            holder: as(ev), field: 'sourceIds', fact: { tag, date: ev.date }, isFact: true,
            word: ev.type, label, event: ev, partnership, sourceIds: ev.sourceIds ?? [],
        };
    }
    if (ref.fact === 'divorce') {
        return {
            holder: as(partnership), field: 'divorceSourceIds', fact: { tag: 'DIV', date: partnership.endDate }, isFact: true,
            word: 'divorce', partnership, sourceIds: partnership.divorceSourceIds ?? [],
        };
    }
    return {
        holder: as(partnership), field: 'sourceIds', fact: { tag: 'MARR', date: partnership.startDate }, isFact: true,
        word: 'marriage', partnership, sourceIds: partnership.sourceIds ?? [],
    };
}

/** The citations a reference names, in the K1.1 order with their steps (none: not in the tree). */
export function orderedCitationsAt(
    data: Pick<StromData, 'persons' | 'partnerships' | 'sources'>, ref: CitationRef, opts: CitationOrderOptions = {},
): OrderedCitation[] {
    const info = citationFact(data, ref);
    return info ? orderedCitationSteps(data, info.holder, info.field, info.fact, opts) : [];
}

/**
 * citationFact of a list on one person or couple, without the tree around it
 * (the holder itself is looked in): the pure pages (the person page, the
 * book, the family pages) and a fact's citations read it.
 */
export function citationFactOn(holder: Person | Partnership, ref: CitationRef): CitationFactInfo | null {
    const one = 'person1Id' in holder
        ? { persons: {}, partnerships: { [holder.id]: holder } }
        : { persons: { [holder.id]: holder }, partnerships: {} };
    return citationFact(one as unknown as Pick<StromData, 'persons' | 'partnerships'>, ref);
}

// ==================== THE ORDER SHOWN ====================

/** Whether the tree shown keeps the file's order (its research orders citations itself, `citations.order`). */
let fileOrderNow: () => boolean = () => false;

/** Set once by citation-gates.ts (the active tree and its research's features). */
export function setCitationFileOrderLookup(lookup: () => boolean): void {
    fileOrderNow = lookup;
}

/** The order options of the tree shown: the file's order for a research that orders its citations, else K1.1. */
export function shownCitationOrder(): CitationOrderOptions {
    let fileOrder = false;
    try { fileOrder = fileOrderNow(); } catch { /* no tree yet: K1.1 */ }
    return fileOrder ? { fileOrder: true } : {};
}

/**
 * The citations of a list on a person or couple in the order shown (K1.1,
 * or the research's own), each once; a reference the holder does not have
 * keeps the list as it is.
 */
export function shownCitationsOn(
    data: Pick<StromData, 'sources'>, holder: Person | Partnership, ref: CitationRef, list?: readonly string[],
): string[] {
    const info = citationFactOn(holder, ref);
    if (!info) return [...new Set(list ?? [])];
    return orderedCitations(data, info.holder, info.field, info.fact, shownCitationOrder());
}
