/**
 * What a person card shows at a glance, besides the name and years:
 *   - person status (quiet, on every card): the evidence level and the story;
 *   - one action badge (rare, asks for the user): the research waits for them
 *     about this person, a conflict between sources, an open question, or —
 *     while following live — the agent working on this person.
 * The badge shows the most pressing signal only; the tooltip lists them all.
 * Which signals the card shows is a per-device setting (Settings → Show on
 * card); the tooltip keeps its status rows either way. Pure.
 */

import { Partnership, Person, StromData } from './types.js';
import { EvidenceLevel, PersonEvidence, personEvidence } from './evidence-level.js';
import type { CardSignals } from './settings.js';

export type ActionSignal = 'waiting' | 'conflict' | 'question' | 'agent';

/** Badge priority: the first present (and switched on) wins. */
export const ACTION_ORDER: ActionSignal[] = ['waiting', 'conflict', 'question', 'agent'];

/** What the research says about one person right now (by REFN). */
export interface ResearchCardInfo {
    /** A task waits for the user about this person (its text). */
    waiting?: string;
    /** The agent works on this person right now (the task's text; live only). */
    agent?: string;
}

/**
 * Who tells the cards what the research says (research-ui registers it at
 * load; a plain setter, so the renderer needs no import of the UI).
 */
let researchInfoProvider: (() => Map<string, ResearchCardInfo>) | null = null;

export function setResearchCardInfoProvider(provider: (() => Map<string, ResearchCardInfo>) | null): void {
    researchInfoProvider = provider;
}

export function researchCardInfoNow(): Map<string, ResearchCardInfo> {
    return researchInfoProvider?.() ?? new Map();
}

/** Everything evaluated once per render and shared by all cards. */
export interface CardSignalContext {
    data: StromData;
    unions: Map<string, Partnership[]>;
    /** Any source anywhere in the tree (none: no evidence level is shown). */
    treeHasSources: boolean;
    settings: CardSignals;
    /** The research's word per person REFN. */
    research: Map<string, ResearchCardInfo>;
}

export interface CardSignalInfo {
    /** The evidence (null: placeholder, or no source anywhere in the tree). */
    evidence: PersonEvidence | null;
    story: 'final' | 'draft' | null;
    attachments: number;
    waiting: string | null;
    conflicts: number;
    hypotheses: number;
    question: string | null;
    agent: string | null;
    /** Show the evidence circle on the card. */
    showEvidence: boolean;
    /** Show the story leaf on the card. */
    showStory: boolean;
    /** The one badge (null: none). */
    action: ActionSignal | null;
}

export function cardSignalInfo(p: Person, ctx: CardSignalContext): CardSignalInfo {
    const evidence = ctx.treeHasSources ? personEvidence(p, ctx.data, ctx.unions) : null;
    const story = p.story?.text?.trim() ? (p.story.status === 'draft' ? 'draft' : 'final') : null;
    const research = p.refn ? ctx.research.get(p.refn) : undefined;
    const conflicts = (p.research?.conflicts ?? []).filter(c => c.status !== 'decided').length;
    const info: CardSignalInfo = {
        evidence,
        story,
        attachments: p.attachments?.length ?? 0,
        waiting: research?.waiting ?? null,
        conflicts,
        hypotheses: p.research?.hypotheses?.length ?? 0,
        question: p.question?.trim() || null,
        agent: research?.agent ?? null,
        showEvidence: !!evidence && ctx.settings.evidence,
        showStory: !!story && ctx.settings.story,
        action: null,
    };
    if (p.isPlaceholder) return { ...info, showEvidence: false, showStory: false };
    const present: Record<ActionSignal, boolean> = {
        waiting: !!info.waiting,
        conflict: conflicts > 0,
        question: !!info.question,
        agent: !!info.agent,
    };
    info.action = ACTION_ORDER.find(s => present[s] && ctx.settings[s]) ?? null;
    return info;
}

/**
 * The person's status as stripes: evidence (2 full, 1 partial, none: nothing)
 * on the left, the story (1, faint as a draft) on the right. Empty when there
 * is nothing to show. `inline`: in a tooltip or menu line, not in the card's corner.
 */
export function stateStripesHtml(evidence: EvidenceLevel | null, story: 'final' | 'draft' | null, inline = false): string {
    const ev = evidence === 'full' ? 2 : evidence === 'partial' ? 1 : 0;
    const groups = [
        ev > 0 ? `<span class="st-group st-ev">${'<i></i>'.repeat(ev)}</span>` : '',
        story ? `<span class="st-group st-story${story === 'draft' ? ' draft' : ''}"><i></i></span>` : '',
    ].join('');
    return groups ? `<span class="card-state${inline ? ' card-state--inline' : ''}" aria-hidden="true">${groups}</span>` : '';
}

/** The glyph inside the badge. */
export const ACTION_GLYPH: Record<ActionSignal, string> = {
    waiting: '!',
    conflict: '≠',
    question: '?',
    agent: '⋯',
};
