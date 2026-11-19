/**
 * The queue narrowed to one kind of work (spec 065 K7.4, the research's
 * `queue.kind`): the chips "Verification 12", "Registers 171", … under the
 * lines' chips of the overview's Queue, counted by `/status.queueCounts.kind`.
 * A chip picked sends `kind=…` to `GET /queue` together with the line or the
 * branch and the searched text; picked again, the queue of every kind comes
 * back. Without the feature nothing of it is shown and no `kind` is sent.
 *
 * The choice is kept for the bridge it was made with (another research forgets
 * it) until it is cleared or the overview's following ends.
 */

import { QUEUE_KIND_FEATURE, QUEUE_TASK_KINDS, type LiveQueueCounts, type QueueTaskKind } from '../research-link.js';
import { strings } from '../strings.js';
import { el } from './research-ui.js';

/** What a session needs to be asked about its kinds. */
interface KindSession {
    features?: readonly string[] | null;
    bridge: { base: string };
    queueCounts?: LiveQueueCounts;
}

let picked: { base: string; kind: QueueTaskKind } | null = null;

/** The research names each task's kind of work (`queue.kind`). */
export function queueKindsSaid(s: Pick<KindSession, 'features'> | null | undefined): boolean {
    return !!s?.features?.includes(QUEUE_KIND_FEATURE);
}

/** The kind the queue is narrowed to (null: none, another research's, or one that no longer says kinds). */
export function queueKindFilter(s: KindSession | null | undefined): QueueTaskKind | null {
    if (!picked || !s || !queueKindsSaid(s) || picked.base !== s.bridge.base) return null;
    return picked.kind;
}

export function setQueueKindFilter(s: KindSession | null | undefined, kind: QueueTaskKind | null): void {
    picked = kind && s ? { base: s.bridge.base, kind } : null;
}

/** A kind's name ("Verification"). */
export function queueKindName(kind: QueueTaskKind): string {
    return strings.live.taskKinds[kind] ?? kind;
}

/**
 * The chips: the kinds with a task up next in their fixed order, each with its count; the picked one stays
 * (with 0) when its last task went. Empty when the research says no kinds.
 */
export function queueKindChips(counts: Pick<LiveQueueCounts, 'kind'> | null | undefined,
    pickedKind: QueueTaskKind | null): { kind: QueueTaskKind; n: number }[] {
    const by = counts?.kind ?? {};
    return QUEUE_TASK_KINDS
        .map(kind => ({ kind, n: by[kind] ?? 0 }))
        .filter(c => c.n > 0 || c.kind === pickedKind);
}

/**
 * The row of the kinds' chips (null: none to show). A chip is a toggle of the lines' chips' look: picked it
 * says ×, picked again it clears. `onPick` gets the new choice (null: every kind).
 */
export function queueKindRow(s: KindSession, onPick: (kind: QueueTaskKind | null) => void): HTMLElement | null {
    if (!queueKindsSaid(s)) return null;
    const now = queueKindFilter(s);
    const chips = queueKindChips(s.queueCounts, now);
    if (chips.length === 0) return null;
    const L = strings.live;
    const row = el('div', 'research-overview__filters research-overview__queue-filters research-overview__queue-kinds');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', L.taskKindLabel);
    for (const { kind, n } of chips) {
        const on = kind === now;
        const chip = el('button', 'research-overview__filter sel-opt', `${queueKindName(kind)} ${n}${on ? ' ×' : ''}`);
        chip.type = 'button';
        chip.dataset.taskKind = kind;
        chip.setAttribute('aria-pressed', String(on));
        if (on) chip.title = L.taskKindClear;
        chip.onclick = () => onPick(on ? null : kind);
        row.appendChild(chip);
    }
    return row;
}
