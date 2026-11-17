/**
 * Sorting materials with the research's agent (spec 102 §13): which files
 * can be sent, what the agent's proposal means for each file, and what
 * accepting it writes. Pure: the dialog, the proposal window and the bridge
 * calls live in src/ui/material-sort-ui.ts.
 *
 * Nothing here sends anything: the app sends a sorting only after an
 * explicit click in its dialog (the agent uses the subscription or credit).
 */

import type { MaterialItem } from './materials.js';
import { SORT_MAX_FILES, type SortJob, type SortLink, type SortProposal } from './materials.js';
import type { MaterialKind, MediaPlace, PartnershipId, PersonId, StromData } from './types.js';
import { researchPersonRef } from './research-link.js';

/** The files a sorting can take: the research's files (I…), not hidden, at most SORT_MAX_FILES. */
export function sortCandidates(items: readonly MaterialItem[]): { send: MaterialItem[]; over: number } {
    const all = items.filter(i => !!i.file && !i.hidden);
    return { send: all.slice(0, SORT_MAX_FILES), over: Math.max(0, all.length - SORT_MAX_FILES) };
}

/** What the files lack: a title of their own, a person. */
export function sortNeeds(items: readonly MaterialItem[]): { n: number; t: number; p: number } {
    let t = 0, p = 0;
    for (const i of items) {
        if (!i.titled) t++;
        if (!i.persons.length && !i.viaBatch.length) p++;
    }
    return { n: items.length, t, p };
}

/** One field of a proposal against what the file has. */
export interface SortField<T> {
    /** What the agent proposes. */
    proposed: T;
    /** A person set it otherwise: it stays unless the proposal is used on purpose. */
    human?: T;
}

/** A link of the proposal as the tree knows it. */
export interface SortChip {
    link: SortLink;
    /** Where it goes in the tree (null: the tree does not know it — not written). */
    place: MediaPlace | null;
    /** A person's REFN for material outside the tree (`/material/assign`). */
    person: string | null;
    kind: 'person' | 'event' | 'source';
    /** The person's or the source's name, the event's name with its person. */
    label: string;
}

export interface SortRow {
    id: string;
    item: MaterialItem | null;
    proposal: SortProposal | null;
    title?: SortField<string>;
    date?: SortField<string>;
    kind?: SortField<MaterialKind>;
    chips: SortChip[];
}

/** Names the planner needs from the tree (pure: the caller passes the data). */
export interface SortTreeIndex {
    person(ref: string): { id: PersonId; name: string } | null;
    family(ref: string): { id: PartnershipId; name: string } | null;
    source(ref: string): { id: string; title: string } | null;
}

export function sortTreeIndex(data: StromData, nameOf: (id: PersonId) => string): SortTreeIndex {
    const persons = new Map<string, PersonId>();
    for (const p of Object.values(data.persons)) {
        const ref = researchPersonRef(p.refn);
        if (ref && !persons.has(ref)) persons.set(ref, p.id);
    }
    const families = new Map<string, PartnershipId>();
    for (const ps of Object.values(data.partnerships)) {
        const ref = typeof ps.researchId === 'string' ? ps.researchId.trim() : '';
        if (/^F\d{1,9}$/.test(ref) && !families.has(ref)) families.set(ref, ps.id);
    }
    const sources = new Map<string, string>();
    for (const s of Object.values(data.sources ?? {})) {
        const ref = typeof s.refn === 'string' ? s.refn.trim() : '';
        if (/^S\d{1,9}$/.test(ref) && !sources.has(ref)) sources.set(ref, s.id);
    }
    return {
        person: ref => { const id = persons.get(ref); return id ? { id, name: nameOf(id) } : null; },
        family: ref => {
            const id = families.get(ref);
            if (!id) return null;
            const ps = data.partnerships[id];
            return { id, name: [ps.person1Id, ps.person2Id].filter(Boolean).map(p => nameOf(p as PersonId)).join(' & ') };
        },
        source: ref => { const id = sources.get(ref); return id ? { id, title: data.sources?.[id]?.title || ref } : null; },
    };
}

/** A proposed link as a chip: where it goes in the tree and what it is called. */
export function sortChip(link: SortLink, tree: SortTreeIndex, names: { event: (tag: string) => string; unknown: (ref: string) => string; eventLabel: (what: string) => string; sourceLabel: (t: string) => string }): SortChip {
    if (link.type === 'source') {
        const s = tree.source(link.ref);
        return { link, kind: 'source', person: null, place: s ? { sourceId: s.id } : null, label: names.sourceLabel(s ? s.title : names.unknown(link.ref)) };
    }
    if (link.type === 'family' || (link.type === 'event' && link.ref.startsWith('F'))) {
        const f = tree.family(link.ref);
        const label = f ? f.name : names.unknown(link.ref);
        return link.type === 'event'
            ? { link, kind: 'event', person: null, place: f ? { partnershipId: f.id } : null, label: names.eventLabel(`${names.event(link.event ?? '')} · ${label}`) }
            : { link, kind: 'person', person: null, place: f ? { partnershipId: f.id } : null, label };
    }
    const p = tree.person(link.ref);
    const label = p ? p.name : names.unknown(link.ref);
    if (link.type === 'event') {
        const fact = link.event === 'BIRT' ? 'birth' : link.event === 'DEAT' ? 'death' : undefined;
        return { link, kind: 'event', person: link.ref, place: p ? { personId: p.id, ...(fact ? { fact } : {}) } : null, label: names.eventLabel(`${names.event(link.event ?? '')} · ${label}`) };
    }
    return { link, kind: 'person', person: link.ref, place: p ? { personId: p.id } : null, label };
}

/** What the file has now of one detail, and whether a person set it. */
function humanValue<T>(item: MaterialItem | null, field: 'title' | 'date' | 'kind'): T | undefined {
    if (!item) return undefined;
    const att = item.attachment;
    if (att) {
        const value = att[field] as T | undefined;
        const by = field === 'title' ? att.titleBy : field === 'date' ? att.dateBy : att.kindBy;
        return value && by !== 'agent' ? value : undefined;
    }
    // Material outside the tree: what it has came from a person (the research drops proposals over them too).
    const value = item.file?.[field] as T | undefined;
    return value || undefined;
}

/** The proposal's rows: a row per file sent (no proposal: unassigned). */
export function sortRows(job: Pick<SortJob, 'files' | 'proposals'>, itemOf: (id: string) => MaterialItem | null, chip: (link: SortLink) => SortChip): SortRow[] {
    const byId = new Map(job.proposals.map(p => [p.id, p]));
    const ids = [...job.files, ...job.proposals.map(p => p.id).filter(id => !job.files.includes(id))];
    return ids.map(id => {
        const proposal = byId.get(id) ?? null;
        const item = itemOf(id);
        const row: SortRow = { id, item, proposal, chips: [] };
        if (!proposal) return row;
        const field = <T>(name: 'title' | 'date' | 'kind', proposed: T | undefined): SortField<T> | undefined => {
            if (proposed === undefined || proposed === '') return undefined;
            const human = humanValue<T>(item, name);
            if (human !== undefined && human === proposed) return undefined;
            return human !== undefined ? { proposed, human } : { proposed };
        };
        const title = field('title', proposal.title);
        const date = field('date', proposal.date);
        const kind = field<MaterialKind>('kind', proposal.kind);
        if (title) row.title = title;
        if (date) row.date = date;
        if (kind) row.kind = kind;
        const have = new Set(item?.persons ?? []);
        const seen = new Set<string>();
        for (const link of proposal.links) {
            const key = `${link.type}:${link.ref}:${link.event ?? ''}`;
            if (seen.has(key)) continue;
            seen.add(key);
            // A person the file already has is no proposal.
            if (link.type === 'person' && have.has(link.ref)) continue;
            row.chips.push(chip(link));
        }
        return row;
    });
}

/** The row proposes something (else it is unassigned: nothing to accept). */
export function sortRowProposes(row: SortRow): boolean {
    return !!(row.title || row.date || row.kind || row.chips.length);
}

/** What the row writes when accepted; `use` takes a field over a person's value on purpose; `edit` replaces the proposal. */
export interface SortChoice {
    use?: { title?: boolean; date?: boolean; kind?: boolean };
    edit?: { title?: string; date?: string; kind?: MaterialKind | ''; chips?: SortChip[] };
}

export interface SortWrite {
    id: string;
    /** A file of the tree: its id (written with the tree). */
    mediaId: string | null;
    /** Material outside the tree: its I… (written through the bridge). */
    fileId: string | null;
    title?: { value: string; by: 'user' | 'agent' };
    date?: { value: string; by: 'user' | 'agent' };
    kind?: { value: MaterialKind | ''; by: 'user' | 'agent' };
    places: MediaPlace[];
    /** People of material outside the tree (REFN). */
    persons: string[];
}

/** Accepting a row: the details that change (never a person's, unless used or edited on purpose) and the links. */
export function sortWrite(row: SortRow, choice: SortChoice = {}): SortWrite | null {
    if (!row.item) return null;
    const out: SortWrite = {
        id: row.id,
        mediaId: row.item.attachment && !row.item.removedId ? row.item.attachment.id : null,
        fileId: row.item.attachment && !row.item.removedId ? null : row.item.file?.id ?? null,
        places: [], persons: [],
    };
    const e = choice.edit;
    const pick = <T>(name: 'title' | 'date' | 'kind', f: SortField<T> | undefined, edited: T | undefined): { value: T; by: 'user' | 'agent' } | undefined => {
        if (edited !== undefined) return { value: edited, by: 'user' };
        if (!f) return undefined;
        if (f.human !== undefined && !choice.use?.[name]) return undefined;
        return { value: f.proposed, by: 'agent' };
    };
    const title = pick('title', row.title, e?.title);
    const date = pick('date', row.date, e?.date);
    const kind = pick<MaterialKind | ''>('kind', row.kind, e?.kind);
    if (title) out.title = title;
    if (date) out.date = date;
    if (kind) out.kind = kind;
    const by = e?.chips ? 'user' : 'agent';
    for (const c of e?.chips ?? row.chips) {
        if (out.mediaId) {
            if (c.place) out.places.push({ ...c.place, by });
        } else if (c.person && !out.persons.includes(c.person)) {
            out.persons.push(c.person);
        }
    }
    if (!out.title && !out.date && !out.kind && !out.places.length && !out.persons.length) return null;
    return out;
}
