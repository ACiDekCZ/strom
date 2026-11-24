/**
 * Change structure… (spec 139 §2): which options the dialog offers for a tree
 * and why one is greyed out. Pure logic, no DOM — the dialog
 * (src/ui/structure-ui.ts) draws what this returns.
 *
 * Every option is always listed, in the dialog's order; one that cannot run
 * now is `enabled: false` with the reason the dialog says under it. A
 * read-only tree (locked, followed live, a newer app's data) gets no dialog at
 * all: its "Change structure…" row is not shown (§1.1).
 */

import { findComponents } from './components.js';
import { allMedia, mediaSourceIds, placePartnershipId, placePersonId, treeMedia } from './media.js';
import { partnershipSourceIds, personSourceIds } from './model-values.js';
import type { PartnershipId, PersonId, StromData } from './types.js';
import type { StructureDirKind } from './icons.js';

export type StructureGroupKey = 'newTree' | 'split' | 'join';

/** The options in the dialog's order (§2.2). */
export type StructureOptionKey = 'select' | 'copy' | 'families' | 'parts' | 'into' | 'from' | 'file';

/** Why an option is greyed out (structure.why*). */
export type StructureReason = 'notOpen' | 'connected' | 'noOther' | 'followed';

/** A way out offered with the reason, under the option (a link, never inside its button). */
export type StructureReasonAction = 'stopFollowing';

export interface StructureContext {
    /** The tree is the open one. */
    isActive: boolean;
    /** Locked, followed live, locked data or saved by a newer app: no dialog. */
    readOnly: boolean;
    /** The open tree is followed live (writing into it is blocked). */
    liveFollowing: boolean;
    /** Some other tree exists (a target to join into). */
    otherTrees: boolean;
    /**
     * Some other tree can take a merge now. Blocked targets never grey the
     * option out: the merge guide's check (mergeTargetReady) says why and
     * offers its way out.
     */
    otherTargetsReady?: boolean;
    /**
     * The whole tree is one connected family; null while not known yet (a
     * large tree counted in the background) — the option stays active and the
     * split dialog says it itself.
     */
    connected: boolean | null;
}

export interface StructureOption {
    key: StructureOptionKey;
    group: StructureGroupKey;
    /** The direction drawn before its text (§2.3). */
    dir: StructureDirKind;
    enabled: boolean;
    reason?: StructureReason;
    reasonAction?: StructureReasonAction;
}

const OPTIONS: ReadonlyArray<Pick<StructureOption, 'key' | 'group' | 'dir'>> = [
    { key: 'select', group: 'newTree', dir: 'new' },
    { key: 'copy', group: 'newTree', dir: 'new' },
    { key: 'families', group: 'split', dir: 'split' },
    { key: 'parts', group: 'split', dir: 'split' },
    { key: 'into', group: 'join', dir: 'into' },
    { key: 'from', group: 'join', dir: 'from' },
    { key: 'file', group: 'join', dir: 'file' },
];

/** The groups in the dialog's order. */
export const STRUCTURE_GROUPS: readonly StructureGroupKey[] = ['newTree', 'split', 'join'];

function blocked(key: StructureOptionKey, ctx: StructureContext): Pick<StructureOption, 'reason' | 'reasonAction'> | null {
    switch (key) {
        // A selection is made of the open tree's view, lists and people.
        case 'select':
            return ctx.isActive ? null : { reason: 'notOpen' };
        case 'parts':
            return ctx.connected === true ? { reason: 'connected' } : null;
        case 'into':
            return ctx.otherTrees ? null : { reason: 'noOther' };
        // From another tree (K3.2): another tree to take, and the open tree written to as for a file.
        case 'from':
            if (!ctx.otherTrees) return { reason: 'noOther' };
            if (!ctx.isActive) return { reason: 'notOpen' };
            return ctx.liveFollowing ? { reason: 'followed', reasonAction: 'stopFollowing' } : null;
        // The guide writes into the open tree: it has to be open and writable.
        case 'file':
            if (!ctx.isActive) return { reason: 'notOpen' };
            return ctx.liveFollowing ? { reason: 'followed', reasonAction: 'stopFollowing' } : null;
        default:
            return null;
    }
}

/** The dialog's options for a tree; none for a read-only tree (it has no dialog). */
export function structureOptions(ctx: StructureContext): StructureOption[] {
    if (ctx.readOnly) return [];
    return OPTIONS.map(option => {
        const why = blocked(option.key, ctx);
        return why ? { ...option, enabled: false, ...why } : { ...option, enabled: true };
    });
}

/** Whether the tree is one connected family (nothing to separate); an empty tree is. */
export function isWhollyConnected(data: StromData): boolean {
    return findComponents(data).length <= 1;
}

// ==================== THE SUMMARY BEFORE CREATING (§4) ====================

/** One person of a separate part: whom they were linked by in the tree. */
export interface SubsetIslandPerson {
    id: PersonId;
    /** The person not selected through whom they were linked to the rest (first on the shortest way). */
    via?: PersonId;
}

/** What a new tree made of a selection gets (the same rules as extractSubtree). */
export interface SubsetSummary {
    /** Real people (placeholders excluded), the selection with its glue partners. */
    persons: number;
    couples: number;
    /** The sources the result cites (also as documents of its files). */
    sources: number;
    /** Portraits, couples' photos and image files of the result, counted by reference (never loaded). */
    images: number;
    /** The people standing alone in the new tree (all parts but the largest). */
    islands: SubsetIslandPerson[];
}

/** Progress of a summary counted in batches. */
export interface SubsetProgress {
    done: number;
    total: number;
}

/** The kept people: the selection plus the other partner of a couple with a selected child (extractSubtree's glue). */
function keptWithGlue(data: StromData, ids: ReadonlySet<PersonId>): Set<PersonId> {
    const kept = new Set<PersonId>();
    for (const id of ids) if (data.persons[id]) kept.add(id);
    for (const union of Object.values(data.partnerships ?? {})) {
        if (!union) continue;
        const in1 = kept.has(union.person1Id);
        const in2 = kept.has(union.person2Id);
        if (in1 === in2) continue;
        if (union.childIds.some(c => ids.has(c))) {
            const other = in1 ? union.person2Id : union.person1Id;
            if (data.persons[other]) kept.add(other);
        }
    }
    return kept;
}

/** A person's neighbours over parent/child/partner links, optionally only inside `within` (a union only when both partners are in). */
function neighboursOf(data: StromData, id: PersonId, within?: ReadonlySet<PersonId>): PersonId[] {
    const person = data.persons[id];
    if (!person) return [];
    const out: PersonId[] = [...person.parentIds, ...person.childIds];
    for (const uid of person.partnerships) {
        const union = data.partnerships[uid];
        if (!union) continue;
        if (within && !(within.has(union.person1Id) && within.has(union.person2Id))) continue;
        out.push(union.person1Id, union.person2Id, ...union.childIds);
    }
    return out.filter(n => n !== id && !!data.persons[n] && (!within || within.has(n)));
}

/**
 * The separate parts of a new tree made of `kept`: every connected part but
 * the largest, as the people in them, each with the person not selected who
 * linked them to the largest part in the tree (first on the shortest way).
 * A part that was separate in the tree already is not listed (nothing of it
 * is cut off). Placeholders are left out of the list.
 */
function islandsOfKept(data: StromData, kept: ReadonlySet<PersonId>): SubsetIslandPerson[] {
    const part = new Map<PersonId, number>();
    const parts: PersonId[][] = [];
    for (const start of kept) {
        if (part.has(start)) continue;
        const index = parts.length;
        const members: PersonId[] = [start];
        part.set(start, index);
        for (let i = 0; i < members.length; i++) {
            for (const n of neighboursOf(data, members[i], kept)) {
                if (part.has(n)) continue;
                part.set(n, index);
                members.push(n);
            }
        }
        parts.push(members);
    }
    if (parts.length <= 1) return [];
    const realCount = (members: PersonId[]) => members.filter(id => !data.persons[id]?.isPlaceholder).length;
    let largest = 0;
    let largestSize = -1;
    parts.forEach((members, i) => {
        const size = realCount(members);
        if (size > largestSize) { largest = i; largestSize = size; }
    });
    // Walk the whole tree out from the largest part: `towards` points one step back to it.
    const towards = new Map<PersonId, PersonId | null>();
    const queue: PersonId[] = [];
    for (const id of parts[largest]) { towards.set(id, null); queue.push(id); }
    for (let i = 0; i < queue.length; i++) {
        for (const n of neighboursOf(data, queue[i])) {
            if (towards.has(n)) continue;
            towards.set(n, queue[i]);
            queue.push(n);
        }
    }
    const result: SubsetIslandPerson[] = [];
    parts.forEach((members, i) => {
        if (i === largest || !members.some(id => towards.has(id))) return;
        for (const id of members) {
            if (data.persons[id]?.isPlaceholder) continue;
            let step = towards.get(id);
            while (step && kept.has(step)) step = towards.get(step);
            result.push(step ? { id, via: step } : { id });
        }
    });
    return result;
}

/** The people who will stand alone in a new tree made of the selection `ids` (see SubsetSummary.islands). */
export function islandsOf(data: StromData, ids: ReadonlySet<PersonId>): SubsetIslandPerson[] {
    return islandsOfKept(data, keptWithGlue(data, ids));
}

const isImage = (mime: string | undefined): boolean => /^image\//i.test(mime ?? '');

/**
 * The summary of a new tree made of the selection `ids`, counted in batches
 * of `batch` people: yields the progress after each batch, returns the
 * summary. Nothing is copied and no image is read — a portrait or a file is
 * counted by its reference (images outside memory stay where they are).
 */
export function* summarizeSubsetSteps(data: StromData, ids: ReadonlySet<PersonId>, batch = 2000): Generator<SubsetProgress, SubsetSummary, void> {
    const kept = keptWithGlue(data, ids);
    const total = kept.size;
    const sources = new Set<string>();
    const keptUnions = new Set<PartnershipId>();
    let persons = 0;
    let images = 0;
    let done = 0;
    for (const id of kept) {
        const p = data.persons[id];
        if (!p.isPlaceholder) persons++;
        if (p.photo) images++;
        personSourceIds(p).forEach(s => sources.add(s));
        p.events?.forEach(ev => ev.sourceIds?.forEach(s => sources.add(s)));
        for (const uid of p.partnerships) {
            const u = data.partnerships[uid];
            if (!u || keptUnions.has(uid) || !kept.has(u.person1Id) || !kept.has(u.person2Id)) continue;
            keptUnions.add(uid);
            if (u.photo) images++;
            partnershipSourceIds(u).forEach(s => sources.add(s));
        }
        if (++done % batch === 0) yield { done, total };
    }
    // The files of the kept people and couples bring the sources they are documents of.
    const media = allMedia(data);
    const keptMedia = new Set(media.filter(a => (a.places ?? []).some(pl => {
        const pid = placePersonId(pl);
        const uid = placePartnershipId(pl);
        return (!!pid && kept.has(pid)) || (!!uid && keptUnions.has(uid));
    })));
    for (const a of keptMedia) mediaSourceIds(a).forEach(s => sources.add(s));
    const keptSources = [...sources].filter(sid => !!data.sources?.[sid]);
    const sourceSet = new Set(keptSources);
    for (const a of media) {
        if (keptMedia.has(a) || mediaSourceIds(a).some(sid => sourceSet.has(sid))) {
            if (isImage(a.mimeType)) images++;
        }
    }
    yield { done: total, total };
    return { persons, couples: keptUnions.size, sources: keptSources.length, images, islands: islandsOfKept(data, kept) };
}

/** The summary of a new tree made of the selection `ids` at once (see summarizeSubsetSteps). */
export function summarizeSubset(data: StromData, ids: ReadonlySet<PersonId>): SubsetSummary {
    const steps = summarizeSubsetSteps(data, ids, Number.MAX_SAFE_INTEGER);
    for (;;) {
        const next = steps.next();
        if (next.done) return next.value;
    }
}

/** What a copy of the whole tree gets: sources and images from its data (people and couples come from its metadata). */
export function summarizeCopy(data: StromData): Pick<SubsetSummary, 'sources' | 'images'> {
    let images = 0;
    for (const p of Object.values(data.persons ?? {})) if (p?.photo) images++;
    for (const u of Object.values(data.partnerships ?? {})) if (u?.photo) images++;
    for (const a of treeMedia(data)) if (isImage(a.mimeType)) images++;
    return { sources: Object.keys(data.sources ?? {}).length, images };
}
