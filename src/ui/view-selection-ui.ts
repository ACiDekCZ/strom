/**
 * The window's selection of people (spec 098 §0.2): one state per window,
 * set from the toolbar's choice, the person's menu, the pill, the tree
 * overview's "Show in tree", the person's "Family line" row and the fan's
 * legend. Its people are highlighted with the pill (src/ui/evidence-ui.ts,
 * kind 'selection'); a family line's spouses who married in faintly, the rest
 * dimmed. src/ui/rod-view.ts is the thin layer of the family line on top.
 *
 * - The main window remembers it per tree with its "Hide others"
 *   (SettingsManager.selectionByTree, a view setting, not the tree's data)
 *   and puts it back when the tree opens, without moving the focus. Another
 *   window keeps its own in this state only (§7).
 * - Another highlighted group covers it; when that group ends the selection
 *   comes back. Choosing a selection ends any other group.
 * - A selection gone after a change (its list deleted, its line or person
 *   gone) is cleared with a toast when it was in sight (§7); a locked or
 *   loading tree keeps it waiting.
 * - Chosen anywhere but from memory: when none of its people is drawn the
 *   focus moves to the nearest one (src/rod-focus.ts), with "↩ Back".
 */

import { DataManager } from '../data.js';
import { SettingsManager, type StoredSelection } from '../settings.js';
import { strings } from '../strings.js';
import { LineageIndex, RodId, buildLineages, rodLabels, realRodSpouses } from '../lineage.js';
import type { PersonId } from '../types.js';
import {
    GoneReason, SelectionRef, WindowSelection, sameSelectionRef, selectionGone, selectionLabel, selectionLabelText, selectionPersonIds,
} from '../view-selection.js';
import type { HighlightGroup } from './evidence-ui.js';

/** Where a selection was chosen: from memory ('restore') the focus stays. */
export type SelectionOrigin = 'picker' | 'menu' | 'map' | 'list' | 'restore' | 'legend' | 'pill' | 'overview' | 'person';

/** What happened to the selection (the map follows a cleared or gone one, §3, §7). */
export interface SelectionChange {
    reason: 'set' | 'clear' | 'gone' | 'tree' | 'restore' | 'hideOthers';
    /** With 'gone': why. */
    gone?: GoneReason;
}

/** What the state needs of the app (the UI; a fake in tests). */
export interface SelectionHost {
    highlightGroup(group: HighlightGroup): void;
    evidenceHighlightKind(): string | null;
    isEvidenceHighlightOn(): boolean;
    endEvidenceHighlight(): void;
    /** After a choice (not from memory): the focus to one of its people when none is drawn. */
    moveFocusToSelection(ref: SelectionRef): void;
    /** The toolbar's choice, the fan's legend: the selection changed or the data did. */
    selectionChanged(): void;
    /** The selection is in sight: highlighted in Family, Descendants or the fan and not covered, or the map's scope (§7). */
    selectionShown?(): boolean;
    showToast?(text: string): void;
}

let host: SelectionHost | null = null;
/** The tree the state belongs to (undefined: not looked at yet). */
let treeKey: string | null | undefined;
/** The data when the tree was last switched: a remembered selection is forgotten only from data loaded since. */
let treeKeyData: unknown = null;
let selected: SelectionRef | null = null;
let hideOthers = false;
/** The selection's name (without its prefix) while it existed: the toast of a gone one names it. */
let lastName = '';
/** A remembered selection not found yet (the tree still locked or loading): tried again after each change. */
let pending: StoredSelection | null = null;
/** "Back to overview" of a selection shown from the tree overview (this page only, never remembered). */
let back: (() => void) | null = null;
const listeners = new Set<(sel: WindowSelection, change: SelectionChange) => void>();
/** Bumped by every change of the data: the lines and the people are computed again when next needed. */
let generation = 0;
let cache: { data: unknown; generation: number; index: LineageIndex; labels: Map<RodId, string> } | null = null;

export function setSelectionHost(h: SelectionHost | null): void {
    host = h;
}

/** Tests: a clean state. */
export function resetViewSelection(): void {
    host = null;
    treeKey = undefined;
    treeKeyData = null;
    selected = null;
    hideOthers = false;
    lastName = '';
    pending = null;
    back = null;
    listeners.clear();
    generation++;
    cache = null;
}

/** The open tree's lines (computed once per change of the data). */
export function selectionIndex(): { index: LineageIndex; labels: Map<RodId, string> } {
    const data = DataManager.getData();
    if (!cache || cache.data !== data || cache.generation !== generation) {
        const index = buildLineages(data);
        cache = { data, generation, index, labels: rodLabels(index) };
    }
    return cache;
}

/** Changes with every change of the data or the tree (the toolbar's choice is built again). */
export function selectionIndexGeneration(): number {
    return generation;
}

function goneNow(ref: SelectionRef): GoneReason | null {
    const { index } = selectionIndex();
    return selectionGone(index.data, index, ref);
}

/** The selection's name as one text ("Line Brandvold", "Ancestors: Anna Nováková"). */
export function selectionText(ref: SelectionRef): string {
    const { index, labels } = selectionIndex();
    return selectionLabelText(selectionLabel(ref, index.data, labels));
}

/** The name alone ("Brandvold", "Anna Nováková", the list's name): what the toast of a gone selection names. */
function selectionName(ref: SelectionRef): string {
    const { index, labels } = selectionIndex();
    return selectionLabel(ref, index.data, labels).name;
}

/** The tree's real data is in (not an empty stand-in of a locked tree). */
function dataIsReal(): boolean {
    return !DataManager.isLocked() && Object.keys(DataManager.getData().persons).length > 0;
}

function state(): WindowSelection {
    return { ref: selected ? { ...selected } : null, hideOthers: selected ? hideOthers : false };
}

function notify(change: SelectionChange): void {
    const now = state();
    for (const cb of [...listeners]) cb(now, change);
    host?.selectionChanged();
}

function remember(): void {
    if (!treeKey) return;
    SettingsManager.setSelectionForTree(treeKey, selected ? { ref: selected, hideOthers } : null);
}

/** Another group (not the selection) holds the pill: the selection waits under it. */
function covered(): boolean {
    return !!host && host.isEvidenceHighlightOn() && host.evidenceHighlightKind() !== 'selection';
}

function endSelectionHighlight(): void {
    if (host?.evidenceHighlightKind() === 'selection') host.endEvidenceHighlight();
}

/**
 * The highlight of a selection (§8): its people framed, recounted from the
 * shared index; a family line's spouses who married in faintly.
 */
export function selectionGroup(ref: SelectionRef, returnTo?: () => void): HighlightGroup | null {
    const { index } = selectionIndex();
    const ids = selectionPersonIds(index.data, index, ref);
    if (!ids) return null;
    const recount = (): PersonId[] => {
        const i = selectionIndex().index;
        return [...(selectionPersonIds(i.data, i, ref) ?? [])];
    };
    return {
        kind: 'selection', cite: false, keepEmpty: true,
        personIds: [...ids],
        title: (n) => strings.selection.pill(selectionText(ref), n),
        recount,
        ...(ref.kind === 'rod' ? { faint: () => realRodSpouses(selectionIndex().index, ref.rodId) } : {}),
        ...(returnTo ? { returnTo } : {}),
    };
}

function show(ref: SelectionRef): void {
    const group = selectionGroup(ref, back ?? undefined);
    if (group) host?.highlightGroup(group);
}

/** A remembered selection of the open tree, shown (unless another group covers it). */
function resolvePending(): boolean {
    if (!pending) return false;
    if (goneNow(pending.ref)) {
        // Gone from a tree that is really there: forgotten. A locked or loading tree keeps it.
        // (The data seen at the switch may still be the previous tree's.)
        if (dataIsReal() && DataManager.getData() !== treeKeyData) {
            if (treeKey) SettingsManager.setSelectionForTree(treeKey, null);
            pending = null;
        }
        return false;
    }
    selected = pending.ref;
    hideOthers = pending.hideOthers;
    lastName = selectionName(selected);
    pending = null;
    if (!covered()) show(selected);
    return true;
}

/** Follow the open tree: another tree brings its own remembered selection (shown, no focus move). */
function syncTree(): boolean {
    const key = DataManager.getCurrentTreeId();
    if (key === treeKey) return false;
    const had = selected;
    treeKey = key;
    treeKeyData = DataManager.getData();
    selected = null;
    hideOthers = false;
    back = null;
    pending = key ? SettingsManager.getSelectionForTree(key) : null;
    if (had) endSelectionHighlight();
    resolvePending();
    if (!sameSelectionRef(had, selected)) notify({ reason: 'tree' });
    return true;
}

/** The window's selection of the open tree (ref null: none). */
export function getSelection(): WindowSelection {
    syncTree();
    // A remembered selection waiting for the tree's data (the first render after loading).
    if (pending && resolvePending()) notify({ reason: 'restore' });
    return state();
}

/** The selection's people (cached per change of the data); null without a selection. */
export function selectionIds(): ReadonlySet<PersonId> | null {
    const ref = getSelection().ref;
    if (!ref) return null;
    const { index } = selectionIndex();
    return selectionPersonIds(index.data, index, ref);
}

/** "Back to overview" of the selection (only right after "Show in tree" in the tree overview). */
export function selectionBack(): (() => void) | null {
    return selected ? back : null;
}

/**
 * Choose a selection (null: none). One that does not exist clears the
 * choice. Ends any other highlighted group; moves the focus to one of its
 * people when none is drawn (not from memory). "Hide others" stays as it was
 * unless `opts.hideOthers` says otherwise.
 */
export function setSelection(ref: SelectionRef | null, origin: SelectionOrigin, opts: { back?: () => void; hideOthers?: boolean } = {}): void {
    syncTree();
    if (!ref || goneNow(ref)) { clearSelection(); return; }
    selected = { ...ref };
    if (opts.hideOthers !== undefined) hideOthers = opts.hideOthers;
    lastName = selectionName(selected);
    pending = null;
    back = origin === 'overview' ? opts.back ?? null : null;
    remember();
    if (origin !== 'restore' || !covered()) show(selected);
    notify({ reason: origin === 'restore' ? 'restore' : 'set' });
    if (origin !== 'restore') host?.moveFocusToSelection(selected);
}

/**
 * A new window takes the selection of the window it was opened from (§7,
 * its start or its own reload): shown without a focus move, its tree's
 * memory not read after it. Remembering stays the main window's (the
 * settings of another window are read only). A locked or loading tree keeps
 * it waiting, as a remembered one.
 */
export function adoptWindowSelection(sel: WindowSelection): void {
    syncTree();
    if (!sel.ref) { clearSelection(); return; }
    if (!dataIsReal()) {
        if (selected) endSelectionHighlight();
        selected = null;
        hideOthers = false;
        back = null;
        pending = { ref: { ...sel.ref }, hideOthers: sel.hideOthers };
        notify({ reason: 'restore' });
        return;
    }
    setSelection(sel.ref, 'restore', { hideOthers: sel.hideOthers });
}

/** No selection: cleared and forgotten, "Hide others" off, the highlight ended. */
export function clearSelection(): void {
    syncTree();
    const had = selected !== null || pending !== null;
    selected = null;
    hideOthers = false;
    pending = null;
    back = null;
    remember();
    endSelectionHighlight();
    if (had) notify({ reason: 'clear' });
}

/** "Hide others" (§8) of the selection: kept with it, off without one. The layout follows the change (onSelectionChange). */
export function setHideOthers(on: boolean): void {
    syncTree();
    const next = !!selected && on;
    if (next === hideOthers) return;
    hideOthers = next;
    remember();
    notify({ reason: 'hideOthers' });
}

/** Called with the selection after every change of it (with what happened). Returns the unsubscribe. */
export function onSelectionChange(cb: (sel: WindowSelection, change: SelectionChange) => void): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
}

/** The toast of a gone selection (§7), named as it was. */
function goneText(reason: GoneReason, name: string): string {
    const s = strings.selection;
    switch (reason) {
        case 'list': return s.goneList(name);
        case 'rod': return s.goneRod(name);
        case 'line': return s.goneLine;
        case 'person': return s.gonePerson(name);
    }
}

/**
 * After a change of the data or a switch of the tree (before the highlight
 * recounts): the lines and people computed again (K3.2), the tree's
 * remembered selection put back, a selection gone cleared (§7: "Hide others"
 * off, the toast when it was in sight, forgotten only when the tree's data
 * is really there).
 */
export function selectionDataChanged(): void {
    generation++;
    if (syncTree()) { host?.selectionChanged(); return; }
    if (pending) {
        if (resolvePending()) { notify({ reason: 'restore' }); return; }
    } else if (selected) {
        const gone = goneNow(selected);
        if (gone) {
            const shown = !covered() && (host?.selectionShown?.() ?? false);
            const name = lastName;
            if (dataIsReal()) {
                if (treeKey) SettingsManager.setSelectionForTree(treeKey, null);
            } else {
                pending = { ref: selected, hideOthers };
            }
            selected = null;
            hideOthers = false;
            back = null;
            endSelectionHighlight();
            if (shown && dataIsReal()) host?.showToast?.(goneText(gone, name));
            notify({ reason: 'gone', gone });
            return;
        }
        lastName = selectionName(selected) || lastName;
    }
    host?.selectionChanged();
}

/**
 * Another group ended (its ×, Escape, nobody left): the selection comes back
 * from under it, without moving the focus.
 */
export function selectionUncovered(): void {
    if (!selected || covered() || host?.evidenceHighlightKind() === 'selection') return;
    show(selected);
}
