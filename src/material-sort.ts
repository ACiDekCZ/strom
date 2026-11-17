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
import type { MaterialKind, MediaBy, MediaPlace, PartnershipId, PersonId, StromData } from './types.js';
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
    /** A source the tree does not know (its research ref): a new source of the tree when accepted (§5, titled by the file). */
    newSource?: string;
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
export interface SortChipNames {
    event: (tag: string) => string;
    unknown: (ref: string) => string;
    eventLabel: (what: string) => string;
    sourceLabel: (t: string) => string;
    /** A source the tree does not know, made new under the file's title. */
    newSource?: (title: string) => string;
}

/**
 * A proposed link as a chip: where it goes in the tree and what it is called.
 * `title`: the file's proposed title — a source the tree does not know becomes
 * a new source of that name (spec 102 §13, "a new source through §5 without the editor").
 */
export function sortChip(link: SortLink, tree: SortTreeIndex, names: SortChipNames, title?: string): SortChip {
    if (link.type === 'source') {
        const s = tree.source(link.ref);
        if (s) return { link, kind: 'source', person: null, place: { sourceId: s.id }, label: names.sourceLabel(s.title) };
        const name = title?.trim();
        if (name && names.newSource) return { link, kind: 'source', person: null, place: null, label: names.newSource(name), newSource: link.ref };
        return { link, kind: 'source', person: null, place: null, label: names.sourceLabel(names.unknown(link.ref)) };
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
export function sortRows(job: Pick<SortJob, 'files' | 'proposals'>, itemOf: (id: string) => MaterialItem | null, chip: (link: SortLink, title?: string) => SortChip): SortRow[] {
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
            row.chips.push(chip(link, proposal.title ?? (item?.titled ? item.title : undefined)));
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
    /**
     * Places in the tree: of the tree's file; of material outside the tree the
     * links the research's assign does not carry (an event, a couple, a source,
     * a person without the research's REFN) — it becomes a file of the tree (§4).
     */
    places: MediaPlace[];
    /** People of material outside the tree (REFN, `/material/assign`). */
    persons: string[];
    /** Sources the tree does not know: made new (title) and the file placed there. */
    newSources: Array<{ ref: string; title: string }>;
}

/** Accepting a row: the details that change (never a person's, unless used or edited on purpose) and the links. */
export function sortWrite(row: SortRow, choice: SortChoice = {}): SortWrite | null {
    if (!row.item) return null;
    const out: SortWrite = {
        id: row.id,
        mediaId: row.item.attachment && !row.item.removedId ? row.item.attachment.id : null,
        fileId: row.item.attachment && !row.item.removedId ? null : row.item.file?.id ?? null,
        places: [], persons: [], newSources: [],
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
    const newTitle = (out.title?.value || row.title?.proposed || (row.item.titled ? row.item.title : '') || row.item.name || '').trim();
    for (const c of e?.chips ?? row.chips) {
        if (c.newSource) {
            if (newTitle && !out.newSources.some(x => x.ref === c.newSource)) out.newSources.push({ ref: c.newSource, title: newTitle });
            continue;
        }
        if (out.mediaId) {
            if (c.place) out.places.push({ ...c.place, by });
            continue;
        }
        // Material outside the tree: its people through the research (an event's person too) ...
        if (c.person && (c.kind === 'person' || c.kind === 'event') && !out.persons.includes(c.person)) out.persons.push(c.person);
        // ... and what the research's assign does not carry, in the tree (an event, a couple, a source, a person it does not know).
        if (!c.place) continue;
        const plain = 'personId' in c.place && !c.place.fact && !c.place.eventId;
        if (c.kind === 'source' || !c.person || !plain) out.places.push({ ...c.place, by });
    }
    if (!out.title && !out.date && !out.kind && !out.places.length && !out.persons.length && !out.newSources.length) return null;
    return out;
}

/**
 * What undoes an accepted row ("Undo" under Done, spec 102 §13): the tree's
 * file as it was (its details, the places added, a file made by the
 * acceptance taken out, sources made for it removed), material outside the
 * tree written back through the bridge (the research's `was`, the people added).
 */
export interface SortRevert {
    /** The tree's file written. */
    media?: string;
    /** The tree's file was made by the acceptance (a working copy): undoing takes it out. */
    created?: boolean;
    /** The tree's file's details before ('' = none; agent: the agent's). */
    fields?: { title?: SortRevertField; kind?: SortRevertField; date?: SortRevertField };
    /** Places added to the tree's file. */
    places?: MediaPlace[];
    /** Sources made by the acceptance. */
    sources?: string[];
    /** Material outside the tree: the research's details before ('' = none). */
    was?: { title?: string; kind?: string; date?: string };
    /** People added in the research (REFN). */
    persons?: string[];
}

export interface SortRevertField {
    value: string;
    agent?: boolean;
}

function revertPlace(raw: unknown): MediaPlace | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const str = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 100;
    const by: { by?: MediaBy } = o.by === 'agent' || o.by === 'user' ? { by: o.by } : {};
    if (str(o.personId)) {
        const fact: { fact?: 'birth' | 'death' } = o.fact === 'birth' || o.fact === 'death' ? { fact: o.fact } : {};
        const ev = str(o.eventId) ? { eventId: o.eventId as string } : {};
        return { personId: o.personId as PersonId, ...fact, ...ev, ...by };
    }
    if (str(o.partnershipId)) return { partnershipId: o.partnershipId as PartnershipId, ...(str(o.eventId) ? { eventId: o.eventId as string } : {}), ...by };
    if (str(o.sourceId)) return { sourceId: o.sourceId as string, ...by };
    return null;
}

/** A remembered revert as stored (anything off: dropped — no undo rather than a wrong one). */
export function parseSortRevert(raw: unknown): SortRevert | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const out: SortRevert = {};
    const text = (v: unknown) => typeof v === 'string' ? v.slice(0, 2000) : undefined;
    if (typeof o.media === 'string' && o.media) out.media = o.media;
    if (o.created === true && out.media) out.created = true;
    if (o.fields && typeof o.fields === 'object' && out.media) {
        const f = o.fields as Record<string, unknown>;
        const fields: NonNullable<SortRevert['fields']> = {};
        for (const k of ['title', 'kind', 'date'] as const) {
            const v = f[k] as Record<string, unknown> | undefined;
            const value = v && typeof v === 'object' ? text(v.value) : undefined;
            if (value !== undefined) fields[k] = { value, ...(v!.agent === true ? { agent: true } : {}) };
        }
        if (Object.keys(fields).length) out.fields = fields;
    }
    if (Array.isArray(o.places) && out.media) {
        const places = o.places.map(revertPlace).filter((p): p is MediaPlace => !!p).slice(0, 40);
        if (places.length) out.places = places;
    }
    if (Array.isArray(o.sources)) {
        const ids = o.sources.filter((x): x is string => typeof x === 'string' && !!x).slice(0, 20);
        if (ids.length) out.sources = ids;
    }
    if (o.was && typeof o.was === 'object') {
        const w = o.was as Record<string, unknown>;
        const was: NonNullable<SortRevert['was']> = {};
        for (const k of ['title', 'kind', 'date'] as const) { const v = text(w[k]); if (v !== undefined) was[k] = v; }
        if (Object.keys(was).length) out.was = was;
    }
    if (Array.isArray(o.persons)) {
        const refs = o.persons.filter((x): x is string => typeof x === 'string' && /^P\d{1,9}$/.test(x)).slice(0, 40);
        if (refs.length) out.persons = refs;
    }
    return Object.keys(out).length ? out : null;
}
