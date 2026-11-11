/**
 * Table view (spec 073 §14.2): the Sources rows.
 *
 * One row per source of the tree's catalog (`StromData.sources`), with how
 * much of the tree it documents: the people whose facts cite it and the
 * number of those facts. Counted in one pass over the tree for all sources
 * (never per cell). A fact is one citation list: a person's own citations,
 * the birth, the death, each of a person's events, a union's wedding, its
 * divorce and each of a couple's events; a union's fact documents both
 * partners. Placeholders are not people of the table, so their facts do not
 * count; a story's sources are not a fact's.
 */

import { PARTNERSHIP_CITATION_FIELDS, PERSON_CITATION_FIELDS, type Partnership, type Person, type Source, type StromData } from '../../types.js';
import type { SourceRow } from './table-model.js';
import { safeWebUrl } from '../../validation.js';

/** How much of the tree one source documents. */
export interface SourceUse {
    persons: number;
    facts: number;
}

/** Each cited source's people and facts (§14.2 Use), in one pass over the tree. */
export function sourceUsage(data: StromData): Map<string, SourceUse> {
    const people = new Map<string, Set<string>>();
    const facts = new Map<string, number>();
    const cite = (ids: readonly string[] | undefined, holders: readonly Person[]) => {
        if (!ids?.length || !holders.length) return;
        for (const id of new Set(ids)) {
            facts.set(id, (facts.get(id) ?? 0) + 1);
            let set = people.get(id);
            if (!set) people.set(id, set = new Set());
            for (const p of holders) set.add(p.id);
        }
    };
    for (const p of Object.values(data.persons ?? {})) {
        if (!p || p.isPlaceholder) continue;
        const holder = [p];
        for (const f of PERSON_CITATION_FIELDS) cite(p[f], holder);
        for (const e of p.events ?? []) cite(e.sourceIds, holder);
    }
    for (const u of Object.values(data.partnerships ?? {})) {
        if (!u) continue;
        const holders = [u.person1Id, u.person2Id]
            .map(id => data.persons[id])
            .filter((p): p is Person => !!p && !p.isPlaceholder);
        for (const f of PARTNERSHIP_CITATION_FIELDS) cite(u[f], holders);
        for (const e of u.events ?? []) cite(e.sourceIds, holders);
    }
    const out = new Map<string, SourceUse>();
    for (const [id, n] of facts) out.set(id, { persons: people.get(id)?.size ?? 0, facts: n });
    return out;
}

/** All source rows of a tree, in the catalog's order, and each by its id. */
export function buildSourceRows(data: StromData): { rows: SourceRow[]; byId: Map<string, SourceRow> } {
    const use = sourceUsage(data);
    const rows: SourceRow[] = [];
    const byId = new Map<string, SourceRow>();
    for (const [key, source] of Object.entries(data.sources ?? {}) as [string, Source | undefined][]) {
        if (!source) continue;
        const id = source.id || key;
        if (byId.has(id)) continue;
        const u = use.get(key) ?? use.get(id);
        const row: SourceRow = { kind: 'source', id, source, persons: u?.persons ?? 0, facts: u?.facts ?? 0, cache: new Map() };
        rows.push(row);
        byId.set(id, row);
    }
    return { rows, byId };
}

/** The readers of a source's transcript (§14.2): the app and the research, as `readBy` says. */
export function sourceReaders(source: Pick<Source, 'readBy'>): number {
    return source.readBy === 'both' ? 2 : source.readBy === 'user' || source.readBy === 'research' ? 1 : 0;
}

/**
 * Where a source is online (§14.2 Online): its own web address, else the
 * first excerpt's page in the archive's viewer; written with or without
 * "https://". The address as written and the link it opens; null when
 * neither is a web address. One rule for the Online column and the Online chip.
 */
export function sourceOnline(source: Pick<Source, 'url' | 'excerpts'>): { text: string; href: string } | null {
    for (const text of [source.url, ...(source.excerpts ?? []).map(e => e.pageUrl)]) {
        const href = safeWebUrl(text);
        if (href) return { text: text!.trim(), href };
    }
    return null;
}

/** A cited source: the id the citation names (the catalog's key) and the source. */
export interface CitedSource {
    id: string;
    source: Source;
}

/** The person's events whose citations are those of the birth (§14.3), of the death. */
const BIRTH_EVENTS: ReadonlySet<string> = new Set(['birth', 'baptism']);
const DEATH_EVENTS: ReadonlySet<string> = new Set(['death', 'burial', 'cremation']);

/**
 * The sources a fact cites (§14.3, the People table's citation columns), each
 * once, in the order the data lists them; ids the catalog does not know are
 * left out. The birth: its own citations, then those of a birth or baptism
 * event; the death likewise with a death, burial or cremation event (as the
 * reliability mark reads a fact's citations); a marriage: the union's own.
 */
export function factCitations(data: Pick<StromData, 'sources'>, fact: 'birth' | 'death', person: Person): CitedSource[];
export function factCitations(data: Pick<StromData, 'sources'>, fact: 'marriage', union: Pick<Partnership, 'sourceIds'>): CitedSource[];
export function factCitations(data: Pick<StromData, 'sources'>, fact: 'birth' | 'death' | 'marriage',
    holder: Person | Pick<Partnership, 'sourceIds'>): CitedSource[] {
    const ids: string[] = [];
    if (fact === 'marriage') ids.push(...(holder.sourceIds ?? []));
    else {
        const p = holder as Person;
        const types = fact === 'birth' ? BIRTH_EVENTS : DEATH_EVENTS;
        ids.push(...((fact === 'birth' ? p.birthSourceIds : p.deathSourceIds) ?? []));
        for (const e of p.events ?? []) if (types.has(e.type)) ids.push(...(e.sourceIds ?? []));
    }
    const out: CitedSource[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
        const source = data.sources?.[id];
        if (!source || seen.has(id)) continue;
        seen.add(id);
        out.push({ id, source });
    }
    return out;
}
