/**
 * Deleting files of the research for good (spec 102 §9, K1.17): what the
 * research's list of impacts (`POST /material/delete` with `dryRun`) says as
 * the dialog shows it, and the dialog's state — the danger button works only
 * with the bridge's confirmation of the list shown and the box ticked; a list
 * that changed meanwhile (409 `material.delete-changed`) is shown again and
 * asks again. Pure: the dialog is in src/ui/material-delete-ui.ts.
 */

import type { DeleteImpact, DeleteImpactSource, MaterialItem, MaterialSourceOf } from './materials.js';
import type { SourceImpact } from './source-retract.js';

/** The files deleting can take: the research's files (the tree's own attachments are removed from the tree instead). */
export function deletableFiles<T extends Pick<MaterialItem, 'origin' | 'file'>>(items: readonly T[]): T[] {
    return items.filter(i => i.origin !== 'tree' && !!i.file);
}

/**
 * The live source a family tree file was made of (spec 117 §7): `uses.of` with `via: "input"`
 * (the research says it only of a source standing). Null for any other file.
 */
export function treeFileSource(item: Pick<MaterialItem, 'tree' | 'file'>): MaterialSourceOf | null {
    if (!item.tree) return null;
    return item.file?.uses?.of?.find(o => o.via === 'input') ?? null;
}

/**
 * What Delete permanently… takes of a selection (spec 117 §5): only family tree files → those without
 * a live source (one alone with its source goes to the two-part dialog); else the material only — the
 * family tree files are left out of the selection's actions.
 */
export function selectionDeletable<T extends Pick<MaterialItem, 'origin' | 'file' | 'tree'>>(items: readonly T[]): T[] {
    const files = deletableFiles(items);
    if (files.length && files.every(i => i.tree)) return files.length === 1 ? files : files.filter(i => !treeFileSource(i));
    return files.filter(i => !i.tree);
}

/** The selection's actions other than Delete permanently… act on these (never on a family tree file, spec 117 §5). */
export function withoutTreeFiles<T extends Pick<MaterialItem, 'tree'>>(items: readonly T[]): T[] {
    return items.filter(i => !i.tree);
}

/** What happens to a source: it loses its link to the file, the image of the same content, or nothing (the bytes stay). */
export type DeleteSourceEffect = 'unlinked' | 'image' | 'unchanged';

export interface DeleteSourceRow {
    id: string;
    title: string;
    effect: DeleteSourceEffect;
    citedCount: number;
    /** The names of the files it is of (several files deleted at once). */
    files: string[];
}

export interface DeleteSummary {
    files: number;
    /** Files something refers to (a source, an excerpt going, a place in the tree, a task, a person). */
    withRefs: number;
    sources: DeleteSourceRow[];
    /** Excerpts that go with the bytes. */
    excerpts: number;
    /** Places in the app's tree taken off. */
    links: number;
    people: string[];
    /** Files that belong to at least one of `people` (the people row's "N files leave their materials"). */
    peopleFiles: number;
    tasks: string[];
    /** Files whose bytes stay (the same content kept by another file or another research); `other`: some by another research. */
    kept: number;
    keptOther: boolean;
}

const EFFECT_RANK: Record<DeleteSourceEffect, number> = { unchanged: 0, image: 1, unlinked: 2 };

function effectOf(source: DeleteImpactSource, bytes: DeleteImpact['bytes']): DeleteSourceEffect {
    if (source.via === 'input') return 'unlinked';
    return bytes === 'deleted' ? 'image' : 'unchanged';
}

/** Does anything refer to the file (the dialog's list and its warning)? */
export function deleteHasRefs(i: DeleteImpact): boolean {
    return i.sources.length > 0 || (i.bytes === 'deleted' && i.excerpts > 0) || i.links > 0 || i.tasks.length > 0 || i.people.length > 0;
}

/** The list of impacts summed up for the dialog: one row per source, the counts over all files. */
export function deleteSummary(impacts: readonly DeleteImpact[]): DeleteSummary {
    const sources = new Map<string, DeleteSourceRow>();
    const people: string[] = [];
    const tasks: string[] = [];
    let excerpts = 0, links = 0, kept = 0, keptOther = false, withRefs = 0, peopleFiles = 0;
    for (const i of impacts) {
        if (deleteHasRefs(i)) withRefs++;
        for (const s of i.sources) {
            const effect = effectOf(s, i.bytes);
            const row = sources.get(s.id);
            if (!row) {
                sources.set(s.id, { id: s.id, title: s.title, effect, citedCount: s.citedCount, files: [i.name] });
                continue;
            }
            if (EFFECT_RANK[effect] > EFFECT_RANK[row.effect]) row.effect = effect;
            row.citedCount = Math.max(row.citedCount, s.citedCount);
            if (!row.files.includes(i.name)) row.files.push(i.name);
        }
        if (i.bytes === 'deleted') excerpts += i.excerpts;
        else {
            kept++;
            if (i.keptWhy === 'otherResearch') keptOther = true;
        }
        links += i.links;
        if (i.people.length) peopleFiles++;
        for (const p of i.people) if (!people.includes(p)) people.push(p);
        for (const t of i.tasks) if (!tasks.includes(t)) tasks.push(t);
    }
    // The sources losing most first (their link to the file, then an image), each kind in the research's order.
    const rows = [...sources.values()].sort((a, b) => EFFECT_RANK[b.effect] - EFFECT_RANK[a.effect]);
    return { files: impacts.length, withRefs, sources: rows, excerpts, links, people, peopleFiles, tasks, kept, keptOther };
}

/** Does the warning above the list speak (something beyond the file itself changes)? */
export function deleteWarns(s: DeleteSummary): boolean {
    return s.sources.some(x => x.effect !== 'unchanged') || s.excerpts > 0 || s.links > 0;
}

/**
 * The dialog's state: `loading` while the dry run is asked, `ready` with its
 * list, `sending` while the deletion goes, `failed` when the list could not
 * be had. `note`: the list was asked again (it changed meanwhile, or the
 * confirmation ran out) — said above it until the dialog closes.
 */
export interface DeleteState {
    phase: 'loading' | 'ready' | 'sending' | 'failed';
    impacts: DeleteImpact[];
    /** A family tree file deleted with its source (spec 117 §7): what rests on the source, as `/source/retract` says it. */
    sourceImpacts?: SourceImpact[];
    /** The bridge's confirmation of exactly the list shown (null: none yet). */
    confirm: string | null;
    understood: boolean;
    note: 'changed' | 'expired' | null;
}

export function deleteStart(): DeleteState {
    return { phase: 'loading', impacts: [], confirm: null, understood: false, note: null };
}

/** The dry run answered: its list and its confirmation (the box stays as it was: unticked before the first list). */
export function deleteListed(s: DeleteState, impacts: DeleteImpact[], confirm: string, sourceImpacts?: SourceImpact[]): DeleteState {
    return { ...s, phase: 'ready', impacts, confirm, ...(sourceImpacts ? { sourceImpacts } : {}) };
}

/**
 * The research changed since the list was shown (409 with the new list) or
 * the confirmation ran out: the new list shown at once (none said: the one
 * shown stays until the new dry run answers), the box unticked, no
 * confirmation until a new dry run gives one.
 */
export function deleteChanged(s: DeleteState, why: 'changed' | 'expired', impacts?: DeleteImpact[], sourceImpacts?: SourceImpact[]): DeleteState {
    const sources = sourceImpacts?.length ? sourceImpacts : s.sourceImpacts;
    return { phase: 'ready', impacts: impacts?.length ? impacts : s.impacts, confirm: null, understood: false, note: why, ...(sources ? { sourceImpacts: sources } : {}) };
}

export function deleteTicked(s: DeleteState, on: boolean): DeleteState {
    return { ...s, understood: on };
}

/** The danger button works: the list shown with the bridge's confirmation, and the box ticked. */
export function deleteCanGo(s: DeleteState): boolean {
    return s.phase === 'ready' && !!s.confirm && s.understood && s.impacts.length > 0;
}

/** The two-part dialog (spec 117 §7) also needs the source's list: the file is never deleted without its source. */
export function deleteBothCanGo(s: DeleteState): boolean {
    return deleteCanGo(s) && !!s.sourceImpacts?.length;
}

/** The sources a family tree file waits for (`blockedBy` of its dry run): deleted with it in the two-part dialog. */
export function deleteBlockedBy(impacts: readonly DeleteImpact[]): string[] {
    return [...new Set(impacts.flatMap(i => i.blockedBy ?? []))];
}
