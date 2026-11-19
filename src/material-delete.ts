/**
 * Deleting files of the research for good (spec 102 §9, K1.17): what the
 * research's list of impacts (`POST /material/delete` with `dryRun`) says as
 * the dialog shows it, and the dialog's state — the danger button works only
 * with the bridge's confirmation of the list shown and the box ticked; a list
 * that changed meanwhile (409 `material.delete-changed`) is shown again and
 * asks again. Pure: the dialog is in src/ui/material-delete-ui.ts.
 */

import type { DeleteImpact, DeleteImpactSource, MaterialItem } from './materials.js';

/** The files deleting can take: the research's files (the tree's own attachments are removed from the tree instead). */
export function deletableFiles<T extends Pick<MaterialItem, 'origin' | 'file'>>(items: readonly T[]): T[] {
    return items.filter(i => i.origin !== 'tree' && !!i.file);
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
    /** The bridge's confirmation of exactly the list shown (null: none yet). */
    confirm: string | null;
    understood: boolean;
    note: 'changed' | 'expired' | null;
}

export function deleteStart(): DeleteState {
    return { phase: 'loading', impacts: [], confirm: null, understood: false, note: null };
}

/** The dry run answered: its list and its confirmation (the box stays as it was: unticked before the first list). */
export function deleteListed(s: DeleteState, impacts: DeleteImpact[], confirm: string): DeleteState {
    return { ...s, phase: 'ready', impacts, confirm };
}

/**
 * The research changed since the list was shown (409 with the new list) or
 * the confirmation ran out: the new list shown at once (none said: the one
 * shown stays until the new dry run answers), the box unticked, no
 * confirmation until a new dry run gives one.
 */
export function deleteChanged(s: DeleteState, why: 'changed' | 'expired', impacts?: DeleteImpact[]): DeleteState {
    return { phase: 'ready', impacts: impacts?.length ? impacts : s.impacts, confirm: null, understood: false, note: why };
}

export function deleteTicked(s: DeleteState, on: boolean): DeleteState {
    return { ...s, understood: on };
}

/** The danger button works: the list shown with the bridge's confirmation, and the box ticked. */
export function deleteCanGo(s: DeleteState): boolean {
    return s.phase === 'ready' && !!s.confirm && s.understood && s.impacts.length > 0;
}
