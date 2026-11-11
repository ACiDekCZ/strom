/**
 * The reliability of a single citation (GEDCOM QUAY 0–3, spec 077, data v19).
 *
 * The same entry is often an original for one fact and secondary evidence for
 * another (a census gives the occupation first hand, the age second hand):
 * the QUAY belongs to the citation, not to the source. A source keeps its
 * default (Source.quality); a citation whose QUAY differs from it keeps its own
 * next to its list (CitationQuay on a person, a couple and their events). A
 * tree without such citations has none of it and reads as before.
 */

import {
    CitationQuay, PARTNERSHIP_CITATION_FIELDS, PERSON_CITATION_FIELDS, Source, StromData,
} from './types.js';
import { sourcePlaceDiffers, sourcePlaceKey } from './source-location.js';
import { SUPPORTED_LANGUAGES } from './strings.js';
import { citeLines, withoutCiteLines } from './import-origin.js';
import { rewriteStorySources } from './story-sources.js';

/** Something that cites sources in lists (a person, a couple, an event) and may keep its citations' own QUAY. */
export type CitationHolder<F extends string = string> = { citationQuay?: CitationQuay<F> };

type Sources = Readonly<Record<string, Source | undefined>> | undefined;

/** A valid QUAY value. */
export function isQuay(v: unknown): v is number {
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 3;
}

/**
 * The QUAY of the citation of `sourceId` in the holder's list `field`: the
 * citation's own when it has one, else the source's default; undefined when
 * neither says one (or the citation gave none, `null`).
 */
export function citationQuality<F extends string>(
    holder: CitationHolder<F> | null | undefined, field: F, sourceId: string, sources: Sources,
): number | undefined {
    const own = holder?.citationQuay?.[field]?.[sourceId];
    if (own === null) return undefined;
    if (isQuay(own)) return own;
    return sources?.[sourceId]?.quality;
}

/** Remove empty lists of own QUAY and the whole map when nothing is left. */
function tidy(holder: CitationHolder): void {
    const map = holder.citationQuay;
    if (!map) return;
    for (const [field, entries] of Object.entries(map)) {
        if (!entries || Object.keys(entries).length === 0) delete map[field];
    }
    if (Object.keys(map).length === 0) delete holder.citationQuay;
}

/**
 * Set the QUAY of one citation: kept on the citation only when it differs
 * from its source's default (undefined: the citation gives none).
 */
export function setCitationQuality<F extends string>(
    holder: CitationHolder<F>, field: F, sourceId: string, quay: number | undefined, sources: Sources,
): void {
    const def = sources?.[sourceId]?.quality;
    if (quay === def) {
        const entries = holder.citationQuay?.[field];
        if (entries && sourceId in entries) {
            delete entries[sourceId];
            tidy(holder as CitationHolder);
        }
        return;
    }
    const map = (holder.citationQuay ??= {}) as CitationQuay;
    (map[field] ??= {})[sourceId] = quay ?? null;
}

/**
 * Join `from`'s citations in list `field` into `into`'s (each source once,
 * `into`'s first): a citation only `from` has brings its own QUAY along.
 */
export function unionCitations<F extends string>(
    into: CitationHolder<F> & Partial<Record<F, string[]>>, from: CitationHolder<F> & Partial<Record<F, string[]>>, field: F,
): void {
    const ids = from[field];
    if (!ids?.length) return;
    const had = new Set(into[field] ?? []);
    into[field] = [...new Set([...(into[field] ?? []), ...ids])] as (CitationHolder<F> & Partial<Record<F, string[]>>)[F];
    const own = from.citationQuay?.[field];
    if (!own) return;
    for (const id of ids) {
        if (had.has(id) || !(id in own)) continue;
        const v = own[id];
        if (v !== null && !isQuay(v)) continue;
        const map = (into.citationQuay ??= {}) as CitationQuay;
        (map[field] ??= {})[id] = v;
        had.add(id);
    }
}

/**
 * Keep only valid own QUAY of citations still in their list: an entry of a
 * source no longer cited there, of an unknown list or with no QUAY value goes.
 */
export function cleanCitationQuay(holder: object, fields: readonly string[]): void {
    const h = holder as CitationHolder & Record<string, unknown>;
    if (!('citationQuay' in h)) return;
    const map = h.citationQuay as unknown;
    if (!map || typeof map !== 'object' || Array.isArray(map)) { delete h.citationQuay; return; }
    const clean: CitationQuay = {};
    for (const field of fields) {
        const entries = (map as Record<string, unknown>)[field];
        const list = h[field];
        if (!entries || typeof entries !== 'object' || Array.isArray(entries) || !Array.isArray(list)) continue;
        const cited = new Set(list.filter((x): x is string => typeof x === 'string'));
        const kept: Record<string, number | null> = {};
        for (const [id, v] of Object.entries(entries as Record<string, unknown>)) {
            if (cited.has(id) && (v === null || isQuay(v))) kept[id] = v;
        }
        if (Object.keys(kept).length) clean[field] = kept;
    }
    if (Object.keys(clean).length) h.citationQuay = clean;
    else delete h.citationQuay;
}

const EVENT_FIELDS = ['sourceIds'] as const;

/** Every holder of citation lists in a tree with its lists: persons, their events, couples, their events. */
export function forEachCitationHolder(data: Pick<StromData, 'persons' | 'partnerships'>,
    fn: (holder: CitationHolder & Record<string, unknown>, fields: readonly string[]) => void): void {
    for (const person of Object.values(data.persons ?? {})) {
        if (!person || typeof person !== 'object') continue;
        fn(person as unknown as CitationHolder & Record<string, unknown>, PERSON_CITATION_FIELDS);
        for (const ev of Array.isArray(person.events) ? person.events : []) {
            if (ev && typeof ev === 'object') fn(ev as unknown as CitationHolder & Record<string, unknown>, EVENT_FIELDS);
        }
    }
    for (const partnership of Object.values(data.partnerships ?? {})) {
        if (!partnership || typeof partnership !== 'object') continue;
        fn(partnership as unknown as CitationHolder & Record<string, unknown>, PARTNERSHIP_CITATION_FIELDS);
        for (const ev of Array.isArray(partnership.events) ? partnership.events : []) {
            if (ev && typeof ev === 'object') fn(ev as unknown as CitationHolder & Record<string, unknown>, EVENT_FIELDS);
        }
    }
}

/** cleanCitationQuay over a whole tree. */
export function cleanTreeCitationQuay(data: Pick<StromData, 'persons' | 'partnerships'>): void {
    forEachCitationHolder(data, (holder, fields) => cleanCitationQuay(holder, fields));
}

/**
 * Point the citations of sources at others (`remap` old id → new id), each
 * keeping its QUAY: its own, else that of the source it cited (`before`, the
 * sources as they were). A list names each source once (its first citation);
 * citations of sources not remapped keep what they had.
 */
export function remapCitations(data: StromData, remap: ReadonlyMap<string, string>, before: Sources): void {
    if (remap.size === 0) return;
    const after = data.sources;
    forEachCitationHolder(data, (holder, fields) => {
        for (const field of fields) {
            const list = holder[field];
            if (!Array.isArray(list) || !list.some(id => remap.has(id))) continue;
            const own = holder.citationQuay?.[field] ?? {};
            const out: string[] = [];
            const quay: Record<string, number | null> = {};
            for (const id of list as string[]) {
                const to = remap.get(id) ?? id;
                if (out.includes(to)) continue;
                out.push(to);
                if (remap.has(id)) {
                    const was = own[id];
                    const eff = was === null ? undefined : isQuay(was) ? was : before?.[id]?.quality;
                    if (eff !== after?.[to]?.quality) quay[to] = eff ?? null;
                } else if (id in own) {
                    quay[id] = own[id];
                }
            }
            holder[field] = out;
            if (Object.keys(quay).length) (holder.citationQuay ??= {})[field] = quay;
            else if (holder.citationQuay) delete holder.citationQuay[field];
        }
        tidy(holder);
    });
}

// ── Data version 19: sources made only for another QUAY join their entry ──

/**
 * What an import of 3.26 copied from a record into the source of its own it
 * made for a citation of the same page with another QUAY. A source with
 * anything else (a transcript, a crop, the research's number…) was not made so
 * — or was changed by hand since — and is never joined.
 */
const DERIVED_FIELDS = new Set([
    'id', 'title', 'repository', 'callNumber', 'folio', 'image', 'reference', 'url', 'note', 'quality',
    'recordDate', 'importId', 'originalIds', 'gedcomExtra', 'gedcomAuthor',
]);

function derivedShape(src: Source): boolean {
    return Object.entries(src).every(([k, v]) => v === undefined || DERIVED_FIELDS.has(k));
}

const t = (v: string | undefined): string => (v ?? '').trim();

/** Another program's kept lines of a source: those of the record and those of its citation, apart. */
function extrasKey(src: Source): string {
    const entries = [...(src.gedcomExtra ?? [])].sort((a, b) => a.from.localeCompare(b.from));
    const rest = entries.map(e => ({ from: e.from, lines: withoutCiteLines(e.lines) })).filter(e => e.lines.length);
    const cite = entries.map(e => ({ from: e.from, lines: citeLines(e.lines) })).filter(e => e.lines.length);
    return JSON.stringify([rest, cite]);
}

/** All a source says but its place (compared apart, samePlace) and its QUAY. */
function entryKey(src: Source): string {
    return JSON.stringify([t(src.title), t(src.repository), t(src.callNumber), t(src.url), t(src.note), t(src.recordDate),
        t(src.gedcomAuthor), extrasKey(src)]);
}

/** The same place: field by field, or the page one composes is the other's (in any language of the app). */
function samePlace(a: Source, b: Source): boolean {
    if (!sourcePlaceDiffers(a, b)) return true;
    return SUPPORTED_LANGUAGES.some(({ code }) => sourcePlaceKey(a, code) === sourcePlaceKey(b, code));
}

/** It carries the marks of a loaded file (its import, or its xref there). */
function hasOrigin(s: Source): boolean {
    return !!s.importId || (s.originalIds ?? []).some(x => !!x.xref);
}

/** Both came from the same record of a loaded file (its import, or its xref there). */
function sameOrigin(a: Source, b: Source): boolean {
    if (a.importId && a.importId === b.importId) return true;
    return (a.originalIds ?? []).some(x => !!x.xref
        && (b.originalIds ?? []).some(y => y.from === x.from && y.xref === x.xref));
}

/**
 * The sources an import of 3.26 made for a citation of a record's own page
 * that differed only by its QUAY (spec 077 K1.5), each with the entry it was
 * made from: same title, archive, call number, place, date of the entry, URL,
 * note and kept lines, nothing of its own (derivedShape), another QUAY. The
 * entry is the one source of that content that has more (a transcript, crops,
 * the research's number); without one (another page of it, made once per
 * QUAY), the first in the catalog of those from the same record of the same
 * file, or of those without import marks beside such a record (the research's
 * file). Anything less certain stays as it is.
 */
export function qualityOnlySources(sources: Readonly<Record<string, Source>> | undefined): Map<string, string> {
    const out = new Map<string, string>();
    if (!sources) return out;
    const groups = new Map<string, Source[]>();
    for (const src of Object.values(sources)) {
        if (!src || typeof src !== 'object' || typeof src.id !== 'string') continue;
        const key = entryKey(src);
        const list = groups.get(key);
        if (list) list.push(src); else groups.set(key, [src]);
    }
    for (const members of groups.values()) {
        if (members.length < 2) continue;
        const records = members.filter(s => !derivedShape(s));
        for (const d of members) {
            if (!derivedShape(d)) continue;
            const candidates = records.filter(r => samePlace(r, d));
            let target: Source | undefined;
            if (candidates.length === 1) target = candidates[0];
            else if (candidates.length === 0) {
                // Another page of a record made twice for two QUAYs: from the same file,
                // or (a file without import marks, the research's) beside that record.
                const root = members.find(x => derivedShape(x) && samePlace(x, d)
                    && (x === d || sameOrigin(x, d) || (records.length > 0 && !hasOrigin(x) && !hasOrigin(d))));
                if (root && root !== d) target = root;
            }
            if (target && target.quality !== d.quality) out.set(d.id, target.id);
        }
    }
    // A chain (a source joined into one joined itself) ends at its entry.
    for (const [from, to] of out) {
        let end = to;
        const seen = new Set([from]);
        while (out.has(end) && !seen.has(end)) { seen.add(end); end = out.get(end)!; }
        out.set(from, end);
    }
    return out;
}

/**
 * Join the sources made only for another QUAY into their entries (data
 * version 19): their citations name the entry and keep the QUAY they had as
 * their own, an attachment or a story naming one names the entry, and the
 * source goes. Returns how many were joined (0: the tree is unchanged).
 */
export function joinQualityOnlySources(data: StromData): number {
    const map = qualityOnlySources(data.sources);
    if (map.size === 0 || !data.sources) return 0;
    const before: Record<string, Source> = { ...data.sources };
    for (const id of map.keys()) delete data.sources[id];
    remapCitations(data, map, before);
    const fix = (ids: string[]): string[] => ids.map(id => map.get(id) ?? id);
    for (const person of Object.values(data.persons ?? {})) {
        for (const att of person.attachments ?? []) {
            if (att.sourceId && map.has(att.sourceId)) att.sourceId = map.get(att.sourceId);
        }
        rewriteStorySources(person.story, fix);
    }
    for (const partnership of Object.values(data.partnerships ?? {})) rewriteStorySources(partnership.story, fix);
    return map.size;
}
