/**
 * Origin of facts from a loaded GEDCOM file (spec 066, data version 15).
 *
 * A GEDCOM import becomes a record of the tree (StromData.imports). Every fact
 * that came from the file keeps the value it came with (importedValues, by
 * fact key) and the import's id; the fact counts as "from the family tree"
 * only while its current value equals that stored value. An edit ends it —
 * nothing is switched by hand, nothing is guessed for older trees.
 *
 * Keys (fields):
 *   person       firstName, lastName, gender, birthDate, birthPlace,
 *                deathDate, deathPlace
 *   partnership  startDate, startPlace, endDate, endPlace
 *   both         event:<id>.date, event:<id>.place, event:<id>.value
 *
 * Facts (what GEDCOM tags carry, with their parts):
 *   person       name (GIVN, SURN), sex (SEX), birth / death (DATE, PLAC)
 *   partnership  marriage / divorce (DATE, PLAC)
 *   both         event:<id> (DATE, PLAC, and VAL for facts whose value is on
 *                their tag line, like an occupation)
 *
 * Links: Person.importedParents (parent id -> import id), Partnership.importId.
 */

import { eventValueIsOnTag } from './events.js';
import {
    CoupleEvent, FactOriginKind, FactPart, GedcomExtra, ImportRecord, ImportedValue, LifeEvent, OriginalIdLine, OriginalIds,
    Partnership, Person, PersonId, ResearchFactOrigin, ResearchFactWas, StromData,
} from './types.js';

/** A person or a couple: what carries facts. */
export type FactHolder = Person | Partnership;

/** A record that keeps another program's own tags (a person, a couple, a source). */
export type ExtraHolder = { gedcomExtra?: GedcomExtra[] };

/** A record that keeps its ids in the loaded files (a person, a couple; a source its xref). */
export type IdsHolder = { originalIds?: OriginalIds[] };

const FACT_PARTS: readonly FactPart[] = ['DATE', 'PLAC', 'VAL', 'GIVN', 'SURN', 'SEX'];
const ORIGIN_KINDS: readonly FactOriginKind[] = ['import', 'user', 'research'];

/** The GEDCOM tag that carries the import of a record, a fact or a link (spec 066). */
export const IMPORT_TAG = '_STROM_IMPORT';

/**
 * The GEDCOM tag of a record's ids in an import it did NOT come from (spec 066
 * K3.2): a person merged with one from another file, or a person entered by
 * hand that a person of a file was merged into. Same lines under it as under
 * `1 _STROM_IMPORT Ix`, but it never says where the record came from.
 */
export const XID_TAG = '_STROM_XID';

/**
 * `I1` or `I1 DATE PLAC` as written after the tag: the import id and, when
 * only some parts are still from it, which. Null for anything else (a list
 * with no part this app knows says nothing it could trust).
 */
export function parseImportMark(value: string): { id: string; parts?: FactPart[] } | null {
    const words = value.trim().split(/\s+/);
    const id = words[0];
    if (!id || !IMPORT_ID.test(id)) return null;
    if (words.length === 1) return { id };
    const parts = [...new Set(words.slice(1).map(factPartOf).filter((p): p is FactPart => !!p))];
    return parts.length > 0 ? { id, parts } : null;
}

/**
 * The values of the `_STROM_IMPORT` lines of one fact: nothing when no part
 * is from an import; the bare id when one import covers every part the fact
 * holds; otherwise one "id PART…" per import, naming the parts still from it.
 */
export function factImportTags(holder: FactHolder, fact: string): string[] {
    const byImport = new Map<string, FactPart[]>();
    let valued = 0;
    for (const [part, key] of Object.entries(factParts(holder, fact))) {
        if (!factValue(holder, key!)) continue;
        valued++;
        const hit = importedValueOf(holder, key!);
        if (!hit) continue;
        const list = byImport.get(hit.from) ?? [];
        list.push(part as FactPart);
        byImport.set(hit.from, list);
    }
    if (byImport.size === 1) {
        const [[id, parts]] = [...byImport];
        if (parts.length === valued) return [id];
    }
    return [...byImport].map(([id, parts]) => `${id} ${parts.join(' ')}`);
}

/** A valid fact part, or null. */
export function factPartOf(value: string): FactPart | null {
    const v = value.trim().toUpperCase();
    return (FACT_PARTS as readonly string[]).includes(v) ? v as FactPart : null;
}

const PERSON_FACTS: Record<string, Partial<Record<FactPart, string>>> = {
    name: { GIVN: 'firstName', SURN: 'lastName' },
    sex: { SEX: 'gender' },
    birth: { DATE: 'birthDate', PLAC: 'birthPlace' },
    death: { DATE: 'deathDate', PLAC: 'deathPlace' },
};
const PARTNERSHIP_FACTS: Record<string, Partial<Record<FactPart, string>>> = {
    marriage: { DATE: 'startDate', PLAC: 'startPlace' },
    divorce: { DATE: 'endDate', PLAC: 'endPlace' },
};

export function isPartnership(holder: FactHolder): holder is Partnership {
    return 'person1Id' in holder;
}

function eventsOf(holder: FactHolder): (LifeEvent | CoupleEvent)[] {
    return (holder.events ?? []) as (LifeEvent | CoupleEvent)[];
}

function eventById(holder: FactHolder, id: string): LifeEvent | CoupleEvent | undefined {
    return eventsOf(holder).find(e => e?.id === id);
}

/** Whether a person's event carries its value on its tag line (`1 OCCU smith`). */
function eventHasValue(holder: FactHolder, ev: LifeEvent | CoupleEvent): boolean {
    return !isPartnership(holder) && eventValueIsOnTag((ev as LifeEvent).type);
}

/** The parts of a fact, each with its key; empty for an unknown fact. */
export function factParts(holder: FactHolder, fact: string): Partial<Record<FactPart, string>> {
    if (fact.startsWith('event:')) {
        const id = fact.slice(6);
        const ev = eventById(holder, id);
        if (!ev) return {};
        return {
            DATE: `event:${id}.date`,
            PLAC: `event:${id}.place`,
            ...(eventHasValue(holder, ev) ? { VAL: `event:${id}.value` } : {}),
        };
    }
    const table = isPartnership(holder) ? PARTNERSHIP_FACTS : PERSON_FACTS;
    return table[fact] ? { ...table[fact] } : {};
}

/** Every fact of the holder (its events included). */
export function factsOf(holder: FactHolder): string[] {
    const base = Object.keys(isPartnership(holder) ? PARTNERSHIP_FACTS : PERSON_FACTS);
    return [...base, ...eventsOf(holder).filter(e => e && typeof e.id === 'string').map(e => `event:${e.id}`)];
}

/** The fact a key belongs to, and its part ("birthDate" -> birth / DATE). */
export function factOfKey(holder: FactHolder, key: string): { fact: string; part: FactPart } | null {
    const m = /^event:(.+)\.(date|place|value)$/.exec(key);
    if (m) return { fact: `event:${m[1]}`, part: m[2] === 'date' ? 'DATE' : m[2] === 'place' ? 'PLAC' : 'VAL' };
    const table = isPartnership(holder) ? PARTNERSHIP_FACTS : PERSON_FACTS;
    for (const [fact, parts] of Object.entries(table)) {
        for (const [part, k] of Object.entries(parts)) if (k === key) return { fact, part: part as FactPart };
    }
    return null;
}

/**
 * The current value of a fact key ('' when there is none). A placeholder's
 * "?" and an unknown sex are no value.
 */
export function factValue(holder: FactHolder, key: string): string {
    const m = /^event:(.+)\.(date|place|value)$/.exec(key);
    if (m) {
        const ev = eventById(holder, m[1]);
        if (!ev) return '';
        if (m[2] === 'date') return ev.date ?? '';
        if (m[2] === 'place') return ev.place ?? '';
        return eventHasValue(holder, ev) ? (ev.note ?? '') : '';
    }
    const raw = (holder as unknown as Record<string, unknown>)[key];
    if (typeof raw !== 'string') return '';
    if (key === 'gender') return raw === 'male' || raw === 'female' ? raw : '';
    if (key === 'firstName' && raw.trim() === '?') return '';
    return raw;
}

/**
 * The stored import of a fact key while the current value still equals it;
 * null once the value changed (the fact is then a person's).
 */
export function importedValueOf(holder: FactHolder, key: string): ImportedValue | null {
    const stored = holder.importedValues?.[key];
    if (!stored) return null;
    const now = factValue(holder, key);
    return now !== '' && now === stored.value ? stored : null;
}

/** Whether a fact key is still as the file gave it. */
export function isFromImport(holder: FactHolder, key: string): boolean {
    return importedValueOf(holder, key) !== null;
}

/** Store the current value of a key as imported (nothing for an empty value). */
export function markImported(holder: FactHolder, key: string, importId: string): void {
    const value = factValue(holder, key);
    if (!value) return;
    (holder.importedValues ??= {})[key] = { from: importId, value };
}

/** Store every part of a fact (or the listed ones) as imported. */
export function markFactImported(holder: FactHolder, fact: string, importId: string, parts?: readonly FactPart[]): void {
    const all = factParts(holder, fact);
    for (const [part, key] of Object.entries(all)) {
        if (parts && parts.length > 0 && !parts.includes(part as FactPart)) continue;
        markImported(holder, key!, importId);
    }
}

/** Store every fact of the holder as imported. */
export function markAllFactsImported(holder: FactHolder, importId: string): void {
    for (const fact of factsOf(holder)) markFactImported(holder, fact, importId);
}

/**
 * Which parts of a fact are still from an import, and which a person changed
 * since (a stored value that no longer matches). Parts without a value are in
 * neither list.
 */
export function factImportParts(holder: FactHolder, fact: string): {
    importId?: string; fromImport: FactPart[]; changed: FactPart[];
} {
    const fromImport: FactPart[] = [];
    const changed: FactPart[] = [];
    let importId: string | undefined;
    for (const [part, key] of Object.entries(factParts(holder, fact))) {
        const stored = holder.importedValues?.[key!];
        if (!stored) continue;
        const hit = importedValueOf(holder, key!);
        if (hit) { fromImport.push(part as FactPart); importId ??= hit.from; }
        else changed.push(part as FactPart);
    }
    return { ...(importId ? { importId } : {}), fromImport, changed };
}

/**
 * Mark everything a converted file holds as coming from one import: the
 * people and their facts, the couples and theirs, the parent links and the
 * source records. For a file another program wrote (all of it is the file's).
 */
export function markTreeImported(data: StromData, importId: string): void {
    for (const person of Object.values(data.persons)) {
        if (!person) continue;
        person.importId = importId;
        markAllFactsImported(person, importId);
        if (person.parentIds?.length) {
            person.importedParents = Object.fromEntries(person.parentIds.map(pid => [pid, importId]));
        }
    }
    for (const ps of Object.values(data.partnerships)) {
        if (!ps) continue;
        ps.importId = importId;
        markAllFactsImported(ps, importId);
    }
    for (const src of Object.values(data.sources ?? {})) {
        if (src) src.importId = importId;
    }
}

// ==================== ORIGINAL IDS ====================

/**
 * The level-1 lines of a record that name it in the program that wrote the
 * file (spec 066 K3.2): kept as written and written back by "Back to {prog}".
 * `_UID`, `UID`, `_FSFTID`, `AFN` and an `EXID` (with its `TYPE`) name the
 * same person in any file of that system; `RIN` only inside one tree.
 */
export const ORIGINAL_ID_TAGS: ReadonlySet<string> = new Set(['_UID', 'UID', 'RIN', 'EXID', '_FSFTID', 'AFN']);

/** The feature of a research that keeps the records' ids and sends them back (`origin.ids`). */
export const ORIGIN_IDS_FEATURE = 'origin.ids';

/** Longest id value, xref and EXID type kept (a line stays well under GEDCOM's 255 characters). */
const ID_VALUE_MAX = 200;
const XREF_MAX = 80;

/**
 * Most id lines kept of one import on one record, and most imports' ids on
 * one record (the research keeps the same bounds); more are left out.
 */
export const ID_LINES_MAX = 20;
export const ID_ENTRIES_MAX = 50;

/** An xref as stored: without the @ signs, nothing that would break the line. */
function cleanXref(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const x = value.trim().normalize('NFC').replace(/^@/, '').replace(/@$/, '');
    return x && x.length <= XREF_MAX && !/[@\s\p{Cc}\uFFFD]/u.test(x) ? x : undefined;
}

/**
 * An id value or type as stored: one line, trimmed, in NFC, not too long.
 * A control character or U+FFFD (a character the file's encoding lost)
 * means the value is not the one the other system has: not taken.
 */
function cleanIdText(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const v = value.trim().normalize('NFC');
    return v && v.length <= ID_VALUE_MAX && !/[\p{Cc}\uFFFD]/u.test(v) ? v : undefined;
}

/** One id line, valid fields only; null when it is not one. */
export function cleanOriginalIdLine(value: unknown): OriginalIdLine | null {
    if (!value || typeof value !== 'object') return null;
    const r = value as Record<string, unknown>;
    const tag = typeof r.tag === 'string' ? r.tag.trim().toUpperCase() : '';
    const v = cleanIdText(r.value);
    if (!ORIGINAL_ID_TAGS.has(tag) || !v) return null;
    const type = tag === 'EXID' ? cleanIdText(r.type) : undefined;
    return { tag, value: v, ...(type ? { type } : {}) };
}

const sameIdLine = (a: OriginalIdLine, b: OriginalIdLine): boolean =>
    a.tag === b.tag && a.value === b.value && (a.type ?? '') === (b.type ?? '');

/**
 * One import's ids of a record, cleaned: null when the import is not known or
 * nothing is left (no xref, no id line). Duplicate lines are kept once.
 */
export function cleanOriginalIds(value: unknown, known: ReadonlySet<string>): OriginalIds | null {
    if (!value || typeof value !== 'object') return null;
    const r = value as Record<string, unknown>;
    if (typeof r.from !== 'string' || !known.has(r.from)) return null;
    const xref = cleanXref(r.xref);
    const ids: OriginalIdLine[] = [];
    if (Array.isArray(r.ids)) {
        for (const raw of r.ids) {
            const line = cleanOriginalIdLine(raw);
            if (line && !ids.some(l => sameIdLine(l, line)) && ids.length < ID_LINES_MAX) ids.push(line);
        }
    }
    if (!xref && ids.length === 0) return null;
    return { from: r.from, ...(xref ? { xref } : {}), ...(ids.length > 0 ? { ids } : {}) };
}

/**
 * Add one import's ids to a holder: joined with the entry of the same import
 * (its xref stays, new lines are added, none twice), else a new entry.
 */
export function addOriginalIds(holder: IdsHolder, entry: OriginalIds): void {
    const list = holder.originalIds ??= [];
    const have = list.find(e => e.from === entry.from);
    if (!have) {
        if (list.length >= ID_ENTRIES_MAX) return;
        list.push({ from: entry.from, ...(entry.xref ? { xref: entry.xref } : {}),
            ...(entry.ids?.length ? { ids: entry.ids.slice(0, ID_LINES_MAX).map(l => ({ ...l })) } : {}) });
        return;
    }
    if (!have.xref && entry.xref) have.xref = entry.xref;
    for (const line of entry.ids ?? []) {
        if ((have.ids?.length ?? 0) >= ID_LINES_MAX) break;
        if (!have.ids?.some(l => sameIdLine(l, line))) (have.ids ??= []).push({ ...line });
    }
}

/**
 * The ids of `from` added to `into` (import ids renamed by `map`), e.g. after
 * a merge; its kept tags of other programs (gedcomExtra) go along.
 */
export function mergeOriginalIds(into: FactHolder, from: FactHolder, map: Map<string, string> = new Map()): void {
    for (const entry of from.originalIds ?? []) addOriginalIds(into, { ...entry, from: map.get(entry.from) ?? entry.from });
    for (const entry of from.gedcomExtra ?? []) addGedcomExtra(into, { ...entry, from: map.get(entry.from) ?? entry.from });
}

// ==================== OTHER PROGRAMS' OWN TAGS ====================

/** Most lines kept of one import's tags on one record, and the longest line (a whole block is kept or none of it). */
const EXTRA_MAX_LINES = 2000;
const EXTRA_MAX_LINE = 10000;

/**
 * A kept line: `1 _XXX …` (or `1 OBJE`, a picture's link written in place that
 * stays a link) opens a block, the lines under it are level 2 or deeper; one
 * line, no line break.
 */
const EXTRA_HEAD = /^1 (?:_[A-Za-z0-9_]+(?: |$)|OBJE$)/;
const EXTRA_BODY = /^(?:[2-9]|[1-9]\d+) \S/;

/**
 * One kept block as written: a `1 _XXX` line and the lines under it (level 2
 * or deeper), each one line, not too long; not too many of them.
 */
export function validExtraBlock(block: readonly string[]): boolean {
    return block.length > 0 && block.length <= EXTRA_MAX_LINES && EXTRA_HEAD.test(block[0])
        && block.slice(1).every(l => EXTRA_BODY.test(l))
        && block.every(l => l.length <= EXTRA_MAX_LINE && !/[\r\n\0]/.test(l));
}

/**
 * A citation's own lines Strom does not read (`DATA` > `TEXT` with its
 * `CONC` / `CONT`, `EVEN` > `ROLE`), kept on the source entry the citation
 * became among its kept tags as one `1 _STROM_CITE` block: the citation's
 * lines one level deeper (`2 DATA` / `3 TEXT …`, `2 EVEN BIRT` / `3 ROLE CHIL`).
 * "Back to {prog}" writes them under that citation, not on the record.
 */
export const CITE_TAG = '_STROM_CITE';

/** The kept lines without the citation's own (CITE_TAG). */
export function withoutCiteLines(lines: readonly string[]): string[] {
    return extraBlocks(lines).filter(b => b[0] !== `1 ${CITE_TAG}`).flat();
}

/** The citation's own kept lines of one import's entry, at the citation's level 1 and deeper (none: []). */
export function citeLines(lines: readonly string[]): string[] {
    const block = extraBlocks(lines).find(b => b[0] === `1 ${CITE_TAG}`);
    return block ? block.slice(1).map(l => l.replace(/^(\d+)/, (_, n: string) => String(Number(n) - 1))) : [];
}

/**
 * A structure of another program's file that Strom has no field for and the
 * import wrote into the record's note instead ("Number of children: 3" of
 * `1 NCHI 3`, "Publication: …" of `1 PUBL …`, "Birth: …" of `1 BIRT` >
 * `2 NOTE …`, a wedding's `2 NOTE` in the couple's note), kept on the record
 * among its kept tags as one `1 _STROM_NOTED` block: the note's lines it
 * became (`2 _TEXT`, a line break as `3 CONT`), then the structure as written
 * one level deeper (`2 NCHI 3`; of a fact Strom has, its head and only the
 * lines that went to the note: `2 BIRT` / `3 NOTE …`). "Back to {prog}" writes
 * the structure again in place of those note lines while the note still has
 * them; every other export writes the note.
 */
export const NOTED_TAG = '_STROM_NOTED';

/** A structure that became lines of a note: those lines, and the structure as written from level 1. */
export interface NotedStructure {
    texts: string[];
    lines: string[];
}

/** The kept block of a structure that became `texts` in the note (null: not one to keep). */
export function notedBlock(texts: readonly string[], structure: readonly string[]): string[] | null {
    if (texts.length === 0 || structure.length === 0 || !/^1 \S/.test(structure[0])) return null;
    const block = [`1 ${NOTED_TAG}`];
    for (const text of texts) {
        const [first, ...rest] = text.split('\n');
        block.push(first ? `2 _TEXT ${first}` : '2 _TEXT');
        for (const line of rest) block.push(line ? `3 CONT ${line}` : '3 CONT');
    }
    for (const line of structure) block.push(line.replace(/^\d+/, n => String(Number(n) + 1)));
    return validExtraBlock(block) ? block : null;
}

/** The structures that became lines of a note, of one import's kept lines. */
export function notedStructures(lines: readonly string[]): NotedStructure[] {
    const out: NotedStructure[] = [];
    for (const block of extraBlocks(lines)) {
        if (block[0] !== `1 ${NOTED_TAG}`) continue;
        const texts: string[] = [];
        const structure: string[] = [];
        for (const line of block.slice(1)) {
            if (structure.length === 0 && line.startsWith('2 _TEXT')) texts.push(line.slice(8));
            else if (structure.length === 0 && /^3 CONT( |$)/.test(line) && texts.length) texts[texts.length - 1] += '\n' + line.slice(7);
            else structure.push(line.replace(/^\d+/, n => String(Number(n) - 1)));
        }
        if (texts.length && structure.length && structure[0].startsWith('1 ')) out.push({ texts, lines: structure });
    }
    return out;
}

/** The kept lines without the structures that became lines of a note (NOTED_TAG), nor the couple's other records (JOINED_TAG). */
export function withoutNotedLines(lines: readonly string[]): string[] {
    return extraBlocks(lines).filter(b => b[0] !== `1 ${NOTED_TAG}` && !isJoinedHead(b[0])).flat();
}

/**
 * Another family record of the same couple in another program's file (some
 * programs write one per wedding: a second marriage of the two, a church
 * wedding beside the civil one). The tree has one partnership for a couple,
 * so the import joins that record to the first one (its children, notes and
 * sources go there) and keeps the record's weddings and divorces and its ids
 * as written, on the partnership among its kept tags as one `1 _STROM_FAM`
 * block: the record's xref, then those lines one level deeper (`2 MARR` /
 * `3 DATE 4 JUL 1914`). "Back to {prog}" writes the record again beside the
 * couple's own, with both partners' FAMS.
 */
export const JOINED_TAG = '_STROM_FAM';

const isJoinedHead = (line: string): boolean => line === `1 ${JOINED_TAG}` || line.startsWith(`1 ${JOINED_TAG} `);

/** The kept block of another record of the couple (null: not one to keep); `xref` without the @ signs. */
export function joinedBlock(xref: string, structure: readonly string[]): string[] | null {
    const block = [xref ? `1 ${JOINED_TAG} ${xref}` : `1 ${JOINED_TAG}`];
    for (const line of structure) block.push(line.replace(/^\d+/, n => String(Number(n) + 1)));
    return validExtraBlock(block) ? block : null;
}

/** The couple's other records of one import's kept lines: each one's xref ('' unknown) and its lines from level 1. */
export function joinedRecords(lines: readonly string[]): { xref: string; lines: string[] }[] {
    return extraBlocks(lines).filter(b => isJoinedHead(b[0])).map(b => ({
        xref: b[0].slice(JOINED_TAG.length + 3).trim(),
        lines: b.slice(1).map(l => l.replace(/^\d+/, n => String(Number(n) - 1))),
    }));
}

/**
 * A note without the lines the structures of `structures` became, and those
 * structures, each only while the note still has all its lines as the import
 * wrote them (a line edited or taken out by hand leaves its structure in the
 * note, as emailsBack and authorBack do).
 */
export function notedBack(note: string | undefined, structures: readonly NotedStructure[]): { note: string | undefined; structures: NotedStructure[] } {
    if (!note || structures.length === 0) return { note, structures: [] };
    let noteLines = note.split('\n');
    const back: NotedStructure[] = [];
    for (const s of structures) {
        let left = noteLines;
        const found = s.texts.every(text => {
            const want = text.split('\n');
            const at = left.findIndex((_, i) => want.every((w, k) => left[i + k] === w));
            if (at < 0) return false;
            left = [...left.slice(0, at), ...left.slice(at + want.length)];
            return true;
        });
        if (!found) continue;
        noteLines = left;
        back.push(s);
    }
    if (back.length === 0) return { note, structures: [] };
    const rest = noteLines.join('\n').trim();
    return { note: rest || undefined, structures: back };
}

/** The blocks of kept lines, each from its `1 _XXX` line. */
function extraBlocks(lines: readonly string[]): string[][] {
    const blocks: string[][] = [];
    for (const line of lines) {
        if (line.startsWith('1 ')) blocks.push([line]);
        else blocks[blocks.length - 1]?.push(line);
    }
    return blocks;
}

/**
 * One import's kept tags of a record, cleaned: null when the import is not
 * known or no valid block is left. A block with a line that is not one
 * (a line break inside, no level, too long) goes as a whole.
 */
export function cleanGedcomExtra(value: unknown, known: ReadonlySet<string>): GedcomExtra | null {
    if (!value || typeof value !== 'object') return null;
    const r = value as Record<string, unknown>;
    if (typeof r.from !== 'string' || !known.has(r.from) || !Array.isArray(r.lines)) return null;
    if (!r.lines.every((l): l is string => typeof l === 'string')) return null;
    const lines: string[] = [];
    for (const block of extraBlocks(r.lines as string[])) {
        if (validExtraBlock(block) && lines.length + block.length <= EXTRA_MAX_LINES) lines.push(...block);
    }
    return lines.length > 0 ? { from: r.from, lines } : null;
}

/**
 * Add one import's kept tags to a holder: joined with the entry of the same
 * import (a block it already has is not added again), else a new entry.
 */
/**
 * A picture's link kept as written (`1 OBJE` … `2 FILE path`) once the file
 * it names is taken in: the picture goes back as itself, not as a second link.
 */
export function dropMediaLink(holder: ExtraHolder, filePath: string): void {
    for (const entry of holder.gedcomExtra ?? []) {
        entry.lines = extraBlocks(entry.lines)
            .filter(b => !(b[0] === '1 OBJE' && b.some(l => /^2 FILE /.test(l) && l.slice(7) === filePath)))
            .flat();
    }
    if (holder.gedcomExtra) holder.gedcomExtra = holder.gedcomExtra.filter(e => e.lines.length > 0);
    if (holder.gedcomExtra?.length === 0) delete holder.gedcomExtra;
}

export function addGedcomExtra(holder: ExtraHolder, entry: GedcomExtra): void {
    const list = holder.gedcomExtra ??= [];
    const have = list.find(e => e.from === entry.from);
    if (!have) { list.push({ from: entry.from, lines: [...entry.lines] }); return; }
    const known = new Set(extraBlocks(have.lines).map(b => b.join('\n')));
    for (const block of extraBlocks(entry.lines)) {
        const key = block.join('\n');
        if (known.has(key)) continue;
        known.add(key);
        have.lines.push(...block);
    }
}

/** A holder's kept tags with their import ids renamed by `map` (entries that become one join). */
export function remapGedcomExtra(holder: ExtraHolder, map: Map<string, string>): void {
    if (!holder.gedcomExtra || map.size === 0) return;
    const list = holder.gedcomExtra;
    delete holder.gedcomExtra;
    for (const entry of list) addGedcomExtra(holder, { ...entry, from: map.get(entry.from) ?? entry.from });
}

/** The kept tags of a holder, cleaned against the known imports (dropped when nothing valid is left). */
function cleanHolderExtra(holder: ExtraHolder, known: ReadonlySet<string>): void {
    if (!('gedcomExtra' in holder)) return;
    const raw: unknown = holder.gedcomExtra;
    const list = Array.isArray(raw) ? raw : [];
    delete holder.gedcomExtra;
    for (const v of list) {
        const clean = cleanGedcomExtra(v, known);
        if (clean) addGedcomExtra(holder, clean);
    }
}

/**
 * A picture's date as kept from a file (`_DATE` under its OBJE, spec 066 G8):
 * one line, trimmed, at most 100 characters; else nothing is kept.
 */
export function mediaDateValue(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const v = value.trim();
    return v && v.length <= 100 && !/[\u0000-\u001f\u007f]/.test(v) ? v : undefined;
}

/** Today as an ISO day in local time ("2026-11-08"): when a file was loaded. */
export function localIsoDay(now: Date = new Date()): string {
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The next free id of the app's own imports ("I1", "I2"…). */
export function nextImportId(imports: readonly ImportRecord[] | undefined, taken: Iterable<string> = []): string {
    let max = 0;
    const ids = [...(imports ?? []).map(r => r.id), ...taken];
    for (const id of ids) {
        const m = /^I(\d+)$/.exec(id);
        if (m) max = Math.max(max, Number(m[1]));
    }
    return `I${max + 1}`;
}

/** The record of an import id, if the tree has it. */
export function importRecordOf(data: Pick<StromData, 'imports'>, id: string | undefined): ImportRecord | undefined {
    return id ? data.imports?.find(r => r.id === id) : undefined;
}

// ==================== SANITIZING ====================

const IMPORT_ID = /^[A-Z]\d{1,6}$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

function text(value: unknown, max = 500): string | undefined {
    if (typeof value !== 'string') return undefined;
    const v = value.trim();
    return v && v.length <= max ? v : undefined;
}

/** Valid import records only (a crafted file may carry anything). */
export function sanitizeImports(value: unknown): ImportRecord[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const out: ImportRecord[] = [];
    const seen = new Set<string>();
    for (const raw of value) {
        if (!raw || typeof raw !== 'object') continue;
        const r = raw as Record<string, unknown>;
        const id = text(r.id, 16);
        const at = text(r.at, 40);
        if (!id || !IMPORT_ID.test(id) || seen.has(id) || !at || !ISO_DAY.test(at)) continue;
        const rec: ImportRecord = { id, program: text(r.program) ?? '', at };
        const version = text(r.version, 100);
        if (version) rec.version = version;
        const fileDate = text(r.fileDate, 100);
        if (fileDate) rec.fileDate = fileDate;
        const file = text(r.file);
        if (file) rec.file = file;
        const encoding = text(r.encoding, 40);
        if (encoding) rec.encoding = encoding;
        const sha = text(r.sha, 64);
        if (sha && /^[0-9a-f]{64}$/.test(sha)) rec.sha = sha;
        if (r.nextCardClosed === true) rec.nextCardClosed = true;
        out.push(rec);
        seen.add(id);
    }
    return out.length > 0 ? out : undefined;
}

function cleanParts(value: unknown): FactPart[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const parts = [...new Set(value.filter((p): p is string => typeof p === 'string').map(factPartOf)
        .filter((p): p is FactPart => !!p))];
    return parts.length > 0 ? parts : undefined;
}

function cleanSourceIds(value: unknown, sources: StromData['sources']): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const ids = value.filter((s): s is string => typeof s === 'string' && !!sources?.[s]);
    return ids.length > 0 ? [...new Set(ids)] : undefined;
}

/** One research origin, valid fields only; null when nothing is left. */
export function sanitizeResearchOrigin(value: unknown, sources: StromData['sources']): ResearchFactOrigin | null {
    if (!value || typeof value !== 'object') return null;
    const o = value as Record<string, unknown>;
    const out: ResearchFactOrigin = {};
    if (typeof o.kind === 'string' && (ORIGIN_KINDS as readonly string[]).includes(o.kind)) out.kind = o.kind as FactOriginKind;
    if (out.kind === 'import' && typeof o.importId === 'string' && IMPORT_ID.test(o.importId)) {
        out.importId = o.importId;
        const parts = cleanParts(o.parts);
        if (parts) out.parts = parts;
    }
    if (o.was && typeof o.was === 'object') {
        const w = o.was as Record<string, unknown>;
        const v = typeof w.value === 'string' ? w.value : undefined;
        if (v !== undefined) {
            const was: ResearchFactWas = { value: v };
            if (typeof w.importId === 'string' && IMPORT_ID.test(w.importId)) was.importId = w.importId;
            const parts = cleanParts(w.parts);
            if (parts) was.parts = parts;
            const ref = text(w.ref, 100);
            if (ref) was.ref = ref;
            if (w.partValues && typeof w.partValues === 'object' && was.parts) {
                const values: Partial<Record<FactPart, string>> = {};
                for (const part of was.parts) {
                    const pv = (w.partValues as Record<string, unknown>)[part];
                    if (typeof pv === 'string') values[part] = pv;
                }
                if (Object.keys(values).length > 1) was.partValues = values;
            }
            out.was = was;
        }
    }
    const sourceIds = cleanSourceIds(o.sourceIds, sources);
    if (sourceIds) out.sourceIds = sourceIds;
    return out.kind || out.was ? out : null;
}

function cleanHolder(holder: FactHolder, known: Set<string>, sources: StromData['sources']): void {
    const h = holder as FactHolder & Record<string, unknown>;
    if ('importId' in h && (typeof h.importId !== 'string' || !known.has(h.importId))) delete h.importId;
    if ('importedValues' in h) {
        const raw = h.importedValues;
        const out: Record<string, ImportedValue> = {};
        if (raw && typeof raw === 'object') {
            for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
                if (!v || typeof v !== 'object') continue;
                const { from, value } = v as Record<string, unknown>;
                if (typeof from !== 'string' || !known.has(from) || typeof value !== 'string' || !value) continue;
                const where = factOfKey(holder, key);
                if (!where || !(where.part in factParts(holder, where.fact))) continue;
                out[key] = { from, value };
            }
        }
        if (Object.keys(out).length > 0) holder.importedValues = out;
        else delete holder.importedValues;
    }
    if ('researchOrigins' in h) {
        const raw = h.researchOrigins;
        const out: Record<string, ResearchFactOrigin> = {};
        if (raw && typeof raw === 'object') {
            const facts = new Set(factsOf(holder));
            for (const [fact, v] of Object.entries(raw as Record<string, unknown>)) {
                if (!facts.has(fact)) continue;
                const clean = sanitizeResearchOrigin(v, sources);
                if (clean) out[fact] = clean;
            }
        }
        if (Object.keys(out).length > 0) holder.researchOrigins = out;
        else delete holder.researchOrigins;
    }
    if ('originalIds' in h) {
        const raw = h.originalIds;
        const list = Array.isArray(raw) ? raw : [];
        delete holder.originalIds;
        for (const v of list) {
            const clean = cleanOriginalIds(v, known);
            if (clean) addOriginalIds(holder, clean);
        }
    }
    cleanHolderExtra(holder, known);
}

/**
 * The origin data of a loaded tree, cleaned (migrateData): valid import
 * records, and marks naming only those records, existing facts and real
 * parent links. Nothing is added; a tree without imports keeps no marks.
 */
export function cleanImportOrigin(data: StromData, rawImports: unknown): void {
    const imports = sanitizeImports(rawImports);
    if (imports) data.imports = imports;
    else delete data.imports;
    const known = new Set((imports ?? []).map(r => r.id));
    for (const person of Object.values(data.persons ?? {})) {
        if (!person || typeof person !== 'object') continue;
        cleanHolder(person, known, data.sources);
        if ('importedParents' in person) {
            const raw = person.importedParents as unknown;
            const out: Record<string, string> = {};
            if (raw && typeof raw === 'object') {
                const parents = new Set(Array.isArray(person.parentIds) ? person.parentIds : []);
                for (const [pid, from] of Object.entries(raw as Record<string, unknown>)) {
                    if (parents.has(pid as PersonId) && typeof from === 'string' && known.has(from)) out[pid] = from;
                }
            }
            if (Object.keys(out).length > 0) person.importedParents = out;
            else delete person.importedParents;
        }
    }
    for (const ps of Object.values(data.partnerships ?? {})) {
        if (ps && typeof ps === 'object') cleanHolder(ps, known, data.sources);
    }
    for (const src of Object.values(data.sources ?? {})) {
        if (!src || typeof src !== 'object') continue;
        if ('importId' in src && (typeof src.importId !== 'string' || !known.has(src.importId))) delete src.importId;
        cleanHolderExtra(src, known);
        cleanSourceXrefs(src, known);
        if ('gedcomAuthor' in src && (typeof src.gedcomAuthor !== 'string' || !src.gedcomAuthor)) delete src.gedcomAuthor;
    }
}

/** A source's xref in the loaded files (Source.originalIds) with its ids there (`RIN MH:S1`), of known imports. */
function cleanSourceXrefs(src: IdsHolder, known: ReadonlySet<string>): void {
    if (!('originalIds' in src)) return;
    const raw: unknown = src.originalIds;
    delete src.originalIds;
    for (const v of Array.isArray(raw) ? raw : []) {
        const clean = cleanOriginalIds(v, known);
        if (clean?.xref) addOriginalIds(src, clean);
    }
}

/** A source's xref and kept tags with their import ids renamed by `map` (after a merge). */
export function remapSourceImports(src: IdsHolder & ExtraHolder, map: Map<string, string>): void {
    if (map.size === 0) return;
    if (src.originalIds) {
        const list = src.originalIds;
        delete src.originalIds;
        for (const entry of list) addOriginalIds(src, { ...entry, from: map.get(entry.from) ?? entry.from });
    }
    remapGedcomExtra(src, map);
}

/**
 * Drop marks that point at records no longer in the tree (after a split, a
 * deletion, a merge): import ids without a record, parent links to people not
 * among the parents. The import records nobody names any more stay — they are
 * the tree's history of loaded files.
 */
export function pruneImportOrigin(data: StromData): void {
    cleanImportOrigin(data, data.imports);
}

/**
 * For an export that left data out: a stored import value says what the file
 * gave, so it must not outlive the value it stands for. `changed` also drops
 * the values a person changed since (a living person's original name or date
 * would come back through them), and the research's origins with their
 * earlier values; without it only facts that are gone lose theirs. With
 * `changed` the record's ids in the loaded files go too: an id like a
 * FamilySearch one names the hidden person in the other system.
 */
export function forgetHiddenImports(holder: FactHolder, changed: boolean): void {
    if (changed) {
        delete holder.originalIds;
        // Another program's own lines may say anything about the person.
        delete holder.gedcomExtra;
    }
    if (holder.importedValues) {
        for (const [key, stored] of Object.entries(holder.importedValues)) {
            const now = factValue(holder, key);
            if (!now || (changed && now !== stored.value)) delete holder.importedValues[key];
        }
        if (Object.keys(holder.importedValues).length === 0) delete holder.importedValues;
    }
    if (changed) delete holder.researchOrigins;
    else if (holder.researchOrigins) {
        const facts = new Set(factsOf(holder));
        for (const fact of Object.keys(holder.researchOrigins)) {
            if (!facts.has(fact) || !factStands(holder, fact)) delete holder.researchOrigins[fact];
        }
        if (Object.keys(holder.researchOrigins).length === 0) delete holder.researchOrigins;
    }
}

/**
 * Whether a fact is still there to be written: a value of one of its parts,
 * or what says it without one — a known death (`DEAT Y`), a cited birth, a
 * wedding said by the couple's status, an event of the person or the couple
 * (one with only a remark, an address or a label is still the event).
 */
function factStands(holder: FactHolder, fact: string): boolean {
    if (Object.values(factParts(holder, fact)).some(key => !!factValue(holder, key!))) return true;
    if (fact.startsWith('event:')) return !!eventById(holder, fact.slice(6));
    if (isPartnership(holder)) {
        if (fact === 'marriage') return holder.status === 'married' || holder.status === 'divorced'
            || !!holder.sourceIds?.length || !!holder.participants?.length || !!holder.address;
        if (fact === 'divorce') return holder.status === 'divorced';
        return false;
    }
    const person = holder as Person;
    if (fact === 'death') return person.isDeceased === true || !!person.deathSourceIds?.length
        || !!person.deathCause || !!person.deathAge || !!person.deathAddress;
    if (fact === 'birth') return !!person.birthSourceIds?.length || !!person.birthAddress || !!person.birthAge;
    return false;
}

/** A parent link that is gone loses its import mark too. */
export function dropImportedParent(child: Person, parentId: string): void {
    if (!child.importedParents || !(parentId in child.importedParents)) return;
    delete child.importedParents[parentId];
    if (Object.keys(child.importedParents).length === 0) delete child.importedParents;
}

// ==================== COMBINING TREES ====================

function sameRecord(a: ImportRecord, b: ImportRecord): boolean {
    return a.program === b.program && a.at === b.at && (a.sha ?? '') === (b.sha ?? '')
        && (a.file ?? '') === (b.file ?? '') && (a.fileDate ?? '') === (b.fileDate ?? '');
}

/**
 * Bring another tree's import records into `target`: the same record (an
 * import both trees share, e.g. after a split) keeps the target's id, the
 * others get the next free ids. Returns incoming id -> id in target.
 */
export function addImportRecords(target: StromData, incoming: readonly ImportRecord[] | undefined): Map<string, string> {
    const map = new Map<string, string>();
    for (const rec of incoming ?? []) {
        const twin = target.imports?.find(r => sameRecord(r, rec));
        if (twin) { map.set(rec.id, twin.id); continue; }
        const free = !target.imports?.some(r => r.id === rec.id);
        const id = free ? rec.id : /^I\d+$/.test(rec.id) ? nextImportId(target.imports) : nextFreeOf(rec.id, target.imports);
        (target.imports ??= []).push({ ...rec, id });
        map.set(rec.id, id);
    }
    return map;
}

function nextFreeOf(id: string, imports: readonly ImportRecord[] | undefined): string {
    const letter = id[0];
    let n = 1;
    while (imports?.some(r => r.id === `${letter}${n}`)) n++;
    return `${letter}${n}`;
}

/** Rename import ids in one holder's marks (ids not in the map stay). */
export function remapHolderImports(holder: FactHolder, map: Map<string, string>): void {
    if (map.size === 0) return;
    if (holder.importId) holder.importId = map.get(holder.importId) ?? holder.importId;
    for (const v of Object.values(holder.importedValues ?? {})) v.from = map.get(v.from) ?? v.from;
    for (const o of Object.values(holder.researchOrigins ?? {})) {
        if (o.importId) o.importId = map.get(o.importId) ?? o.importId;
        if (o.was?.importId) o.was.importId = map.get(o.was.importId) ?? o.was.importId;
    }
    if (!isPartnership(holder) && holder.importedParents) {
        for (const [pid, from] of Object.entries(holder.importedParents)) holder.importedParents[pid] = map.get(from) ?? from;
    }
    if (holder.originalIds) {
        // Two ids may become one (an import both trees share): their entries join.
        const list = holder.originalIds;
        delete holder.originalIds;
        for (const entry of list) addOriginalIds(holder, { ...entry, from: map.get(entry.from) ?? entry.from });
    }
    remapGedcomExtra(holder, map);
}

/**
 * After a merge: the facts of a merged holder that now hold the incoming
 * side's imported value — and held something else before — come from that
 * import. A value the tree already had stays as it was (a person's value is
 * never turned into an import's), and so does its own mark.
 *
 * `before` is the holder as it was in the tree before the merge (absent: the
 * holder is new); `incoming` the other tree's holder, its import ids already
 * mapped (`importMap`).
 */
export function carryMergedImports(
    merged: FactHolder,
    before: FactHolder | undefined,
    incoming: FactHolder,
    importMap: Map<string, string>,
): void {
    for (const [key, stored] of Object.entries(incoming.importedValues ?? {})) {
        if (factValue(incoming, key) !== stored.value) continue;
        const now = factValue(merged, key);
        if (!now || now !== stored.value) continue;
        const had = before ? factValue(before, key) : '';
        if (had === now) continue;
        (merged.importedValues ??= {})[key] = { from: importMap.get(stored.from) ?? stored.from, value: stored.value };
    }
    // The merged record is the record of both files: it keeps the ids of each.
    mergeOriginalIds(merged, incoming, importMap);
}

/**
 * The previous state's import records and the link marks a research version
 * does not carry (the research keeps the origin of facts, the app keeps that
 * of links). People are matched by their research number (REFN), couples by
 * their two people — this runs before stabilizeIds. Facts the research gives
 * no origin of keep the app's own stored value. Returns `next` itself when
 * there is nothing to keep; neither input is changed.
 *
 * The records' ids in the loaded files (originalIds): a research with
 * `origin.ids` keeps and sends them, so its file is what counts. Before that,
 * a record keeps its own ids of every import the research's file does not
 * name for it (a file's ids, when it carries any, come first).
 */
export function keepImports(next: StromData, previous: StromData, features?: readonly string[] | null): StromData {
    const prevImports = previous.imports ?? [];
    if (prevImports.length === 0) return next;
    const out: StromData = structuredClone(next);
    const researchKeepsIds = !!features?.includes(ORIGIN_IDS_FEATURE);
    // Records: the research's (same id) are completed by the app's.
    const byId = new Map((out.imports ?? []).map(r => [r.id, r] as const));
    for (const rec of prevImports) {
        const have = byId.get(rec.id) as (ImportRecord & Record<string, unknown>) | undefined;
        if (!have) { (out.imports ??= []).push({ ...rec }); continue; }
        for (const [k, v] of Object.entries(rec)) {
            if (v !== undefined && (have[k] === undefined || have[k] === '')) have[k] = v;
        }
    }
    const refnOf = (data: StromData): Map<string, PersonId> => {
        const seen = new Map<string, PersonId | null>();
        for (const [id, p] of Object.entries(data.persons ?? {})) {
            const r = p?.refn?.trim();
            if (r) seen.set(r, seen.has(r) ? null : id as PersonId);
        }
        return new Map([...seen].filter((e): e is [string, PersonId] => !!e[1]));
    };
    const nextByRefn = refnOf(out);
    const prevToNext = new Map<string, PersonId>();
    for (const [refn, prevId] of refnOf(previous)) {
        const nextId = nextByRefn.get(refn);
        if (nextId) prevToNext.set(prevId, nextId);
    }
    const keepFacts = (into: FactHolder, from: FactHolder): void => {
        for (const [key, v] of Object.entries(from.importedValues ?? {})) {
            if (key.startsWith('event:')) continue;
            const where = factOfKey(into, key);
            if (!where || into.researchOrigins?.[where.fact] || into.importedValues?.[key]) continue;
            (into.importedValues ??= {})[key] = { ...v };
        }
        if (!into.importId && from.importId) into.importId = from.importId;
        if (!researchKeepsIds) {
            for (const entry of from.originalIds ?? []) {
                if (!into.originalIds?.some(e => e.from === entry.from)) addOriginalIds(into, entry);
            }
        }
        // Another program's own tags never go to the research: the tree keeps its own.
        for (const entry of from.gedcomExtra ?? []) addGedcomExtra(into, entry);
        // Nor a picture's date from the file (spec 066 G8): it stays with the same picture.
        if (!isPartnership(into) && !isPartnership(from)) keepMediaDates(into, from);
    };
    for (const [prevId, nextId] of prevToNext) {
        const before = previous.persons[prevId as PersonId];
        const now = out.persons[nextId];
        if (!before || !now) continue;
        keepFacts(now, before);
        for (const [parent, from] of Object.entries(before.importedParents ?? {})) {
            const np = prevToNext.get(parent);
            if (np && now.parentIds.includes(np)) (now.importedParents ??= {})[np] = from;
        }
    }
    const pair = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const nextPairs = new Map<string, Partnership>();
    for (const ps of Object.values(out.partnerships ?? {})) if (ps) nextPairs.set(pair(ps.person1Id, ps.person2Id), ps);
    for (const ps of Object.values(previous.partnerships ?? {})) {
        if (!ps) continue;
        const a = prevToNext.get(ps.person1Id);
        const b = prevToNext.get(ps.person2Id);
        const now = a && b ? nextPairs.get(pair(a, b)) : undefined;
        if (now) keepFacts(now, ps);
    }
    // The sources' own tags of another program, by the research's record id (REFN), else the same id.
    const nextSources = Object.values(out.sources ?? {});
    // So does the record it was in that program's file, with its author (spec 066 K3.1).
    for (const src of Object.values(previous.sources ?? {})) {
        if (!src?.gedcomExtra && !src?.originalIds && !src?.gedcomAuthor) continue;
        const now = (src.refn ? nextSources.find(s => s.refn === src.refn) : undefined) ?? out.sources?.[src.id];
        if (!now) continue;
        for (const entry of src.gedcomExtra ?? []) addGedcomExtra(now, entry);
        for (const entry of src.originalIds ?? []) {
            if (!now.originalIds?.some(e => e.from === entry.from)) addOriginalIds(now, entry);
        }
        if (!now.gedcomAuthor && src.gedcomAuthor && now.note === src.note) now.gedcomAuthor = src.gedcomAuthor;
    }
    return out;
}

/** A picture's date from the file (photoDate, Attachment.date) back on the same picture of `into`. */
function keepMediaDates(into: Person, from: Person): void {
    if (from.photoDate && !into.photoDate && into.photo && into.photo === from.photo) into.photoDate = from.photoDate;
    for (const att of from.attachments ?? []) {
        if (!att.date) continue;
        const same = into.attachments?.find(a => !a.date && (a.id === att.id
            || (!!a.dataUrl && !a.originalOnly && a.dataUrl === att.dataUrl)
            || (!!a.original?.sha256 && a.original.sha256 === att.original?.sha256)));
        if (same) same.date = att.date;
    }
}
