/**
 * Opening a research tree follows its research live when an agent works
 * there (spec 011, U4b): what a switch of trees comes to, what the panel says
 * about it, and how the panel names the research beside the tree.
 *
 * Pure: the caller asks the bridge (askResearchBridge, only when the state
 * known is older than FOLLOW_FRESH_MS) and does the following itself.
 */

import type { BridgeAnswer, ResearchTreeState } from './research-others.js';

/** A state known this recently is taken as it is; an older one is asked again first (ms). */
export const FOLLOW_FRESH_MS = 15_000;

/** How long the panel's line about the switch stays (ms; it waits while the panel is hovered or focused). */
export const FOLLOW_NOTICE_MS = 6000;

/** How long the tree's name in the panel's head is lit after a switch (ms). */
export const FOLLOW_HIGHLIGHT_MS = 2000;

/**
 * What opening a research tree comes to: `follow` — an agent works there
 * (its bridge answers, ≥ 1 direction at work): followed at once, nothing
 * asked; `idle` — it answers, nobody works: the tree stays editable;
 * `off` — it does not answer (or the browser keeps the page from it):
 * passive; `ask` — nothing known recent enough: ask its bridge first.
 */
export type FollowOnOpen = 'follow' | 'idle' | 'off' | 'ask';

/** Whether a bridge's answer is recent enough to act on. */
export function answerFresh(answer: BridgeAnswer | null, now: number, maxAge = FOLLOW_FRESH_MS): boolean {
    return !!answer && now - answer.at <= maxAge;
}

/**
 * The tree's state (as researchTreeState says it, from its bridge's last
 * answer) to what opening it does. `fresh`: that answer is recent enough.
 */
export function followOnOpen(state: ResearchTreeState | null, fresh: boolean): FollowOnOpen {
    if (!state) return fresh ? 'off' : 'ask';
    if (state.kind === 'live') return 'idle';
    if (!fresh && state.kind !== 'blocked') return 'ask';
    if (state.kind === 'running') return 'follow';
    if (state.kind === 'idle') return 'idle';
    return 'off';
}

export interface FollowTreeRef {
    id: string;
    name: string;
}

/** The panel's line once following began: started (nothing was followed before) or moved (another tree was). */
export interface FollowNotice {
    kind: 'started' | 'moved';
    tree: string;
    /** The tree that stays (started: the research tree open before) or is editable again (moved). */
    prev?: string;
}

/**
 * What the panel says once following began. `prevFollowed`: the tree
 * followed until now; `prevOpen`: the research tree open before (named only
 * when nothing was followed). Following the same tree again says nothing.
 */
export function followNotice(o: { tree: FollowTreeRef; prevFollowed?: FollowTreeRef | null; prevOpen?: FollowTreeRef | null }): FollowNotice | null {
    const { tree, prevFollowed, prevOpen } = o;
    if (prevFollowed && prevFollowed.id === tree.id) return null;
    if (prevFollowed) return { kind: 'moved', tree: tree.name, prev: prevFollowed.name };
    return { kind: 'started', tree: tree.name, ...(prevOpen && prevOpen.id !== tree.id ? { prev: prevOpen.name } : {}) };
}

/** The research's name beside the tree's only when it says something else (compared trimmed, any case). */
export function researchNameBeside(tree: string, research: string | null | undefined): string | undefined {
    const r = (research ?? '').trim();
    if (!r) return undefined;
    return r.toLocaleLowerCase() === tree.trim().toLocaleLowerCase() ? undefined : r;
}
