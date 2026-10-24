/**
 * The view's back/forward history (↩ / ↪, Alt+← / Alt+→): every step that
 * changes what the tree shows — a new focus, children shown in place or
 * hidden again (the card's tab, the person menu, the dashed "▸ parents",
 * "Hide shown children"), a jump to a card drawn elsewhere — stores the view
 * before it. Going back restores that view and keeps the one it leaves on the
 * other stack, so going forward retraces the step. Pure bookkeeping: the
 * renderer takes the snapshots and applies them.
 */

import type { PersonId } from './types.js';

/** At most this many steps back (the oldest drop out). */
export const VIEW_HISTORY_LIMIT = 50;

/** The pan and zoom of the tree (ZoomPan.getTransform). */
export interface ViewTransform {
    readonly scale: number;
    readonly tx: number;
    readonly ty: number;
}

/**
 * One person whose children the view shows in place, with what closing it
 * again by a click needs: the children the view drew before the click, the
 * cards the click brought in, the zoom of §5 and where the card stood on the
 * screen before the click. Kept rather than worked out again: they depend on
 * the view the click was made in.
 */
export interface ShownChildrenSnapshot {
    readonly id: PersonId;
    readonly visibleBefore: ReadonlySet<PersonId>;
    readonly broughtIn: ReadonlySet<PersonId>;
    readonly zoom?: { readonly before: number; readonly after: number };
    readonly anchorScreen?: { readonly x: number; readonly y: number };
}

/**
 * A view in the history and the step that leads between it and its
 * neighbour: the focus and the children shown (in their order); for a step
 * of the children shown, the card it concerned (it keeps its place on the
 * screen) and whether it was "Hide shown children" (the first card goes back
 * where it stood) with where that card stood on the screen before it (back
 * puts it there again); for a jump, the pan and zoom.
 */
export interface ViewHistoryEntry {
    readonly focus: PersonId;
    readonly shown: readonly ShownChildrenSnapshot[];
    readonly anchorId?: PersonId;
    readonly restoreView?: boolean;
    readonly anchorAt?: { readonly x: number; readonly y: number };
    readonly view?: ViewTransform;
}

export interface ViewHistory {
    back: ViewHistoryEntry[];
    forward: ViewHistoryEntry[];
}

export function emptyViewHistory(): ViewHistory {
    return { back: [], forward: [] };
}

/** A new step: the view before it goes on the back stack, forward is cleared. */
export function pushViewStep(history: ViewHistory, before: ViewHistoryEntry, limit = VIEW_HISTORY_LIMIT): void {
    history.back.push(before);
    if (history.back.length > limit) history.back.splice(0, history.back.length - limit);
    history.forward = [];
}

/** The entry without the shown children of persons no longer in the tree (null: its focus is gone). */
export function liveEntry(entry: ViewHistoryEntry, exists: (id: PersonId) => boolean): ViewHistoryEntry | null {
    if (!exists(entry.focus)) return null;
    const shown = entry.shown.filter(s => exists(s.id));
    return shown.length === entry.shown.length ? entry : { ...entry, shown };
}

/** Whether two entries show the same children, in the same order. */
export function sameShown(a: readonly ShownChildrenSnapshot[], b: readonly ShownChildrenSnapshot[]): boolean {
    return a.length === b.length && a.every((s, i) => s.id === b[i].id);
}

export function sameTransform(a: ViewTransform, b: ViewTransform): boolean {
    return Math.abs(a.scale - b.scale) < 1e-9 && Math.abs(a.tx - b.tx) < 0.5 && Math.abs(a.ty - b.ty) < 0.5;
}

/**
 * One step back (`dir` 'back') or forward: pops the nearest entry still
 * valid (a deleted focus is skipped; `usable` may skip more, e.g. a step of
 * the children shown outside the family view), and puts the current view on
 * the other stack with the popped step's details — the card it concerned,
 * "hide all" (with where `screenOf` says that card stands now), and for a
 * jump the current pan and zoom — so the way back retraces it. Returns the
 * entry to apply, or null when there is none.
 */
export function stepViewHistory(
    history: ViewHistory,
    dir: 'back' | 'forward',
    current: ViewHistoryEntry,
    currentView: ViewTransform,
    exists: (id: PersonId) => boolean,
    usable: (entry: ViewHistoryEntry) => boolean = () => true,
    screenOf: (id: PersonId) => { x: number; y: number } | null = () => null,
): ViewHistoryEntry | null {
    const from = dir === 'back' ? history.back : history.forward;
    const to = dir === 'back' ? history.forward : history.back;
    while (from.length > 0) {
        const target = liveEntry(from.pop()!, exists);
        if (!target || !usable(target)) continue;
        const anchorAt = target.restoreView && target.anchorId !== undefined ? screenOf(target.anchorId) : null;
        to.push({
            focus: current.focus,
            shown: current.shown,
            ...(target.anchorId !== undefined ? { anchorId: target.anchorId } : {}),
            ...(target.restoreView ? { restoreView: true } : {}),
            ...(anchorAt ? { anchorAt } : {}),
            ...(target.view ? { view: currentView } : {}),
        });
        if (to.length > VIEW_HISTORY_LIMIT) to.splice(0, to.length - VIEW_HISTORY_LIMIT);
        return target;
    }
    return null;
}
