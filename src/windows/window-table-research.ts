/**
 * The research bubbles of a satellite's Table (spec 097 §5, K3.1): the
 * window has no bridge of its own, so the bubble's research actions run in
 * the main window, as the person menu's research rows do
 * (window-research-menu.ts). The satellite sends what the action is (its id
 * and the item it is about, never a link or anything to run); the main window
 * builds the person's research bubble itself, runs the action only when its
 * own bubble offers it now, and comes forward unless the action opens the
 * research's terminal. A source in the Sources table and an archive's
 * website stay in the satellite. A waiting item's own answer is not offered
 * there (its section's "Awaiting action ›" opens the panel in the main
 * window); while the main window is closed the forwarded actions are left out.
 */

import type { ResearchBubbleAction } from '../ui/table-view/table-research-bubble.js';

/** The research action a satellite's bubble asks for. */
export const TABLE_BUBBLE_ACTION = 'table-bubble';

/** What names the action: its id, the person and the item it is about (nothing else crosses windows). */
export interface TableBubbleArgs {
    personId: string;
    id: string;
    waitId?: string;
    conflictId?: string;
    hypothesisId?: string;
    taskId?: string;
    lineId?: string;
    branchId?: string;
    fact?: string;
    sourceId?: string;
}

const KEYS = ['waitId', 'conflictId', 'hypothesisId', 'taskId', 'lineId', 'branchId', 'fact', 'sourceId'] as const;

/** Actions a satellite runs itself: a source in its own Sources table, an archive's website (a link). */
export function bubbleRunsHere(a: Pick<ResearchBubbleAction, 'id' | 'via'>): boolean {
    return a.id === 'source' || a.via === 'web';
}

/** An action a satellite offers: its own, or one the main window runs while it is open (a waiting item's answer: not here). */
export function bubbleOfferedHere(a: Pick<ResearchBubbleAction, 'id' | 'via'>, mainOpen: boolean): boolean {
    if (bubbleRunsHere(a)) return true;
    return mainOpen && a.via !== 'item';
}

/** The action as a satellite sends it. */
export function tableBubbleArgs(a: ResearchBubbleAction): TableBubbleArgs {
    const out: TableBubbleArgs = { personId: a.personId, id: a.id };
    for (const k of KEYS) if (typeof a[k] === 'string') out[k] = a[k];
    return out;
}

/** The action as it came in a message (anything malformed: none). */
export function readTableBubbleArgs(raw: unknown): TableBubbleArgs | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.personId !== 'string' || typeof r.id !== 'string') return null;
    const out: TableBubbleArgs = { personId: r.personId, id: r.id };
    for (const k of KEYS) if (typeof r[k] === 'string') out[k] = r[k] as string;
    return out;
}

/** The main window's own action the satellite asked for (the same id, person and item), if its bubble has it. */
export function findBubbleAction(actions: readonly ResearchBubbleAction[], args: TableBubbleArgs): ResearchBubbleAction | null {
    return actions.find(a => a.id === args.id && a.personId === args.personId && KEYS.every(k => (a[k] ?? undefined) === args[k])) ?? null;
}

/** The main window comes forward for the action: not when it opens the research's terminal. */
export function bubbleFocusesMain(a: Pick<ResearchBubbleAction, 'via' | 'mark'>): boolean {
    return !(a.via === 'link' && a.mark && a.mark !== 'none');
}

/** What a satellite's bubble needs from its client. */
export interface TableResearchForward {
    mainOpen(): boolean;
    /** Ask the main window to run the action (and to come forward). */
    run(args: TableBubbleArgs, focusMain: boolean): void;
}

let forward: TableResearchForward | null = null;

/** A satellite's bubbles send their research actions to the main window (null: this window runs them). */
export function setTableResearchForward(f: TableResearchForward | null): void {
    forward = f;
}

export function tableResearchForward(): TableResearchForward | null {
    return forward;
}
