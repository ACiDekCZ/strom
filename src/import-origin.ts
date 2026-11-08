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
    CoupleEvent, FactOriginKind, FactPart, ImportRecord, ImportedValue, LifeEvent, OriginalIdLine, OriginalIds,
    Partnership, Person, PersonId, ResearchFactOrigin, ResearchFactWas, StromData,
} from './types.js';

/** A person or a couple: what carries facts. */
export type FactHolder = Person | Partnership;

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

/** An xref as stored: without the @ signs, nothing that would break the line. */
function cleanXref(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const x = value.trim().replace(/^@/, '').replace(/@$/, '');
    return x && x.length <= XREF_MAX && !/[@\s\p{Cc}]/u.test(x) ? x : undefined;
}

/** An id value or type as stored: one line, trimmed, not too long. */
function cleanIdText(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const v = value.trim();
    return v && v.length <= ID_VALUE_MAX && !/\p{Cc}/u.test(v) ? v : undefined;
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
            if (line && !ids.some(l => sameIdLine(l, line))) ids.push(line);
        }
    }
    if (!xref && ids.length === 0) return null;
    return { from: r.from, ...(xref ? { xref } : {}), ...(ids.length > 0 ? { ids } : {}) };
}

/**
 * Add one import's ids to a holder: joined with the entry of the same import
 * (its xref stays, new lines are added, none twice), else a new entry.
 */
export function addOriginalIds(holder: FactHolder, entry: OriginalIds): void {
    const list = holder.originalIds ??= [];
    const have = list.find(e => e.from === entry.from);
    if (!have) {
        list.push({ from: entry.from, ...(entry.xref ? { xref: entry.xref } : {}),
            ...(entry.ids?.length ? { ids: entry.ids.map(l => ({ ...l })) } : {}) });
        return;
    }
    if (!have.xref && entry.xref) have.xref = entry.xref;
    for (const line of entry.ids ?? []) {
        if (!have.ids?.some(l => sameIdLine(l, line))) (have.ids ??= []).push({ ...line });
    }
}

/** The ids of `from` added to `into` (import ids renamed by `map`), e.g. after a merge. */
export function mergeOriginalIds(into: FactHolder, from: FactHolder, map: Map<string, string> = new Map()): void {
    for (const entry of from.originalIds ?? []) addOriginalIds(into, { ...entry, from: map.get(entry.from) ?? entry.from });
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
        if (src && typeof src === 'object' && 'importId' in src
            && (typeof src.importId !== 'string' || !known.has(src.importId))) delete src.importId;
    }
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
    if (changed) delete holder.originalIds;
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
            const hasValue = Object.values(factParts(holder, fact)).some(key => !!factValue(holder, key!));
            if (!facts.has(fact) || !hasValue) delete holder.researchOrigins[fact];
        }
        if (Object.keys(holder.researchOrigins).length === 0) delete holder.researchOrigins;
    }
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
    return out;
}
