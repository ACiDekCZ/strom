/**
 * What a person card shows at a glance, besides the name and years:
 *   - person status (quiet, on every card): the evidence level as stripes and
 *     the story as a folded corner;
 *   - one action badge (rare, asks for the user): the research waits for them
 *     about this person, a conflict between sources, or an open question;
 *   - while following live, an arc circling the avatar of whom the agent works
 *     on (only without a badge), and a short-lived check once it is done.
 * The badge shows the most pressing signal only; the tooltip lists them all.
 * Which signals the card shows is a per-device setting (Settings → Show on
 * card); the tooltip keeps its status rows either way. Pure.
 */

import { Partnership, Person, StromData } from './types.js';
import { EvidenceLevel, PersonEvidence, personEvidence } from './evidence-level.js';
import type { CardSignals } from './settings.js';

export type ActionSignal = 'waiting' | 'conflict' | 'question';

/** Badge priority: the first present (and switched on) wins. */
export const ACTION_ORDER: ActionSignal[] = ['waiting', 'conflict', 'question'];

/** One turn of the agent's arc, ms (all arcs share its phase). */
export const AGENT_SPIN_MS = 1400;
/** How long the check stays after the agent is done with a person, then fades. */
export const AGENT_DONE_MS = 4000;
export const AGENT_DONE_FADE_MS = 300;

/** What the research says about one person right now (by REFN). */
export interface ResearchCardInfo {
    /** A task waits for the user about this person (its text). */
    waiting?: string;
    /** The agent works on this person right now (the task's text; live only). */
    agent?: string;
    /** The person is in the agent's queue (the task's text; tooltip only). */
    queued?: string;
    /** The agent was just done with this person: since when (ms epoch; live only). */
    done?: number;
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
    queued: string | null;
    /** Show the evidence stripes on the card. */
    showEvidence: boolean;
    /** Show the story's folded corner on the card. */
    showStory: boolean;
    /** The one badge (null: none). */
    action: ActionSignal | null;
    /** Circle the avatar: the agent works on this person and no badge shows. */
    showAgent: boolean;
    /** The check after the agent's work: since when (null: none). */
    doneSince: number | null;
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
        queued: research?.queued ?? null,
        showEvidence: !!evidence && ctx.settings.evidence,
        showStory: !!story && ctx.settings.story,
        action: null,
        showAgent: false,
        doneSince: null,
    };
    if (p.isPlaceholder) return { ...info, showEvidence: false, showStory: false };
    const present: Record<ActionSignal, boolean> = {
        waiting: !!info.waiting,
        conflict: conflicts > 0,
        question: !!info.question,
    };
    info.action = ACTION_ORDER.find(s => present[s] && ctx.settings[s]) ?? null;
    // The amber badge comes first: then the agent is in the tooltip only.
    if (!info.action && ctx.settings.agent) {
        info.showAgent = !!info.agent;
        if (!info.agent && research?.done !== undefined) info.doneSince = research.done;
    }
    return info;
}

/**
 * The person's status: evidence stripes (2 full, 1 partial, none: nothing)
 * and the story as a folded corner (faint as a draft). Empty when there is
 * nothing to show. On the card the stripes sit in the bottom-right corner
 * (left of the fold when there is one) and the fold covers the card's corner;
 * `inline`: both side by side in a tooltip or menu line.
 */
export function stateStripesHtml(evidence: EvidenceLevel | null, story: 'final' | 'draft' | null, inline = false): string {
    const ev = evidence === 'full' ? 2 : evidence === 'partial' ? 1 : 0;
    const stripes = ev > 0 ? `<span class="st-group st-ev">${'<i></i>'.repeat(ev)}</span>` : '';
    const fold = story
        ? `<span class="card-story${story === 'draft' ? ' draft' : ''}${inline ? ' card-story--inline' : ''}" aria-hidden="true"></span>`
        : '';
    if (inline) return stripes || fold ? `<span class="card-state card-state--inline" aria-hidden="true">${stripes}${fold}</span>` : '';
    return (stripes ? `<span class="card-state${story ? ' beside-story' : ''}" aria-hidden="true">${stripes}</span>` : '') + fold;
}

/** The glyph inside the badge. */
export const ACTION_GLYPH: Record<ActionSignal, string> = {
    waiting: '!',
    conflict: '≠',
    question: '?',
};

/**
 * A negative animation delay that puts an animation of `period` ms into the
 * phase it would have had running since the page loaded: every arc drawn at
 * any render turns in step, and a redraw does not restart it.
 */
export function sharedPhaseDelay(period: number, now: number): string {
    return `-${Math.round(now % period)}ms`;
}
