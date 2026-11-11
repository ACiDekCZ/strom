/**
 * What a person card shows at a glance, besides the name and years:
 *   - person status (quiet, on every card): one mark of sources and
 *     reliability (reliability.ts cardStatus) and the story as a folded corner;
 *   - one action badge (rare, asks for the user): the research waits for them
 *     about this person, a conflict between sources, or an open question;
 *   - while following live, an arc circling the avatar of whom the agent works
 *     on (only without a badge), and a short-lived check once it is done.
 * One signal shows as its badge; two or three as a stack of badges with the
 * most pressing in front, whose click offers what to open.
 * Which signals the card shows is a per-device setting (Settings → Show on
 * card); the tooltip keeps its status rows either way. Pure.
 */

import { Partnership, Person, PersonId, ResearchConflict, StromData } from './types.js';
import { PersonEvidence } from './evidence-level.js';
import type { CardSignals } from './settings.js';
import { CardStatus, ReliabilityOptions, cardStatus } from './reliability.js';
import { isOpenHypothesis } from './view-links.js';
import { coupleStories } from './story-text.js';

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
    /** That waiting item is a story's new version (kind "story"), not a task. */
    waitingStory?: boolean;
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

/** The research's conflicts of a person as its version not loaded has them (finding 40); null: the tree's own. */
let researchConflictsProvider: ((id: PersonId) => ResearchConflict[] | null) | null = null;

export function setResearchConflictsProvider(provider: ((id: PersonId) => ResearchConflict[] | null) | null): void {
    researchConflictsProvider = provider;
}

/** The research's conflicts of a person as the cards read them (null: the tree's own). */
export function researchConflictsNow(id: PersonId): ResearchConflict[] | null {
    return researchConflictsProvider?.(id) ?? null;
}

/**
 * Materials of a person in a tree linked to a research that lists them (spec 017):
 * the tooltip says "Materials N" instead of attachments. Null: not offered here.
 */
let materialsCountProvider: ((p: Person) => number | null) | null = null;

export function setMaterialsCountProvider(provider: ((p: Person) => number | null) | null): void {
    materialsCountProvider = provider;
}

/** Materials of a person as the cards read them (null: not offered here). */
export function materialsCountNow(p: Person): number | null {
    return materialsCountProvider?.(p) ?? null;
}

/** Everything evaluated once per render and shared by all cards. */
export interface CardSignalContext {
    data: StromData;
    unions: Map<string, Partnership[]>;
    /** Any source anywhere in the tree (none: no evidence level is shown). */
    treeHasSources: boolean;
    /** Where the tree's facts came from (UI.reliabilityOptionsNow), for the card's one mark. */
    reliability: ReliabilityOptions;
    settings: CardSignals;
    /** The research's word per person REFN. */
    research: Map<string, ResearchCardInfo>;
}

export interface CardSignalInfo {
    /** The card's one mark of sources and reliability, whether shown or not (null: none, e.g. a placeholder). */
    status: CardStatus | null;
    /** The evidence (null: placeholder, or no source anywhere in the tree). */
    evidence: PersonEvidence | null;
    /** The story the corner speaks for (null: none). */
    story: PersonStoryState | null;
    attachments: number;
    /** Materials (attachments and the research's files) when the tree shows them; null: attachments only. */
    materials: number | null;
    waiting: string | null;
    /** The waiting item is a story's new version: the badge opens the comparison. */
    waitingStory: boolean;
    conflicts: number;
    /** Open hypotheses (decided and abandoned ones do not count). */
    hypotheses: number;
    question: string | null;
    agent: string | null;
    queued: string | null;
    /** Show the mark of sources and reliability on the card. */
    showStatus: boolean;
    /** Show the story's folded corner on the card. */
    showStory: boolean;
    /** The one badge (null: none): the first of `actions`. */
    action: ActionSignal | null;
    /** Every action signal present and switched on, in ACTION_ORDER (0–3); two or more show as a stack. */
    actions: ActionSignal[];
    /** Circle the avatar: the agent works on this person and no badge shows. */
    showAgent: boolean;
    /** The check after the agent's work: since when (null: none). */
    doneSince: number | null;
}

/** The corner's look: a full corner for the person's own story, a hollow one for a couple's alone; pale as a draft. */
export interface StoryMark {
    kind: 'own' | 'couple';
    final: boolean;
}

/** The story the card signals (spec 027 §5.6). */
export interface PersonStoryState extends StoryMark {
    /** The title of the story the corner speaks for ('' = none). */
    title: string;
    /** An approved story has a new version waiting beside it (Story.draft). */
    storyNew: boolean;
}

/**
 * The story the card signals: the person's own decides (kind 'own'); without
 * one, the stories of the person's couples (Partnership.story) do (kind
 * 'couple') — approved when any of them is, a draft when all are drafts. A
 * new version waiting beside any approved one of them counts. Null: none.
 */
export function personStoryState(p: Person, data: StromData): PersonStoryState | null {
    const own = p.story?.text?.trim() ? p.story : undefined;
    const couples = coupleStories(data, p).map(u => u.story!);
    const stories = [...(own ? [own] : []), ...couples];
    if (!stories.length) return null;
    const final = own ? own.status !== 'draft' : couples.some(st => st.status !== 'draft');
    const storyNew = final && stories.some(st => st.status === 'final' && !!st.draft?.text?.trim());
    // The title of the story the state comes from: the own one, else the first approved couple's (the first one as a draft).
    const lead = own ?? (couples.find(st => st.status !== 'draft') ?? couples[0]);
    return { kind: own ? 'own' : 'couple', final, title: lead.title?.trim() ?? '', storyNew };
}

/** The words of the card's story corner (tooltip, aria-label): "Story: …", "Story of the marriage: …", "(draft)". */
export function storySignalText(
    s: PersonStoryState,
    words: { own: (t: string) => string; couple: (t: string) => string; draft: (s: string) => string; nv: (s: string) => string },
): string {
    const base = s.kind === 'own' ? words.own(s.title) : words.couple(s.title);
    if (!s.final) return words.draft(base);
    return s.storyNew ? words.nv(base) : base;
}

/**
 * The story words inside the person's status line run on in lower case
 * ("documented by sources · story (draft)"), except in German, whose nouns
 * keep their capital ("Geschichte der Ehe: …").
 */
export function storySignalInLine(text: string, lang: string): string {
    return lang === 'de' ? text : text.charAt(0).toLocaleLowerCase() + text.slice(1);
}

export function cardSignalInfo(p: Person, ctx: CardSignalContext): CardSignalInfo {
    const status = cardStatus(ctx.data, p, { ...ctx.reliability, treeHasSources: ctx.treeHasSources, unions: ctx.unions });
    const evidence = status?.evidence ?? null;
    const story = personStoryState(p, ctx.data);
    const research = p.refn ? ctx.research.get(p.refn) : undefined;
    const conflicts = (researchConflictsProvider?.(p.id) ?? p.research?.conflicts ?? []).filter(c => c.status !== 'decided').length;
    const info: CardSignalInfo = {
        status,
        evidence,
        story,
        attachments: p.attachments?.length ?? 0,
        materials: materialsCountProvider?.(p) ?? null,
        waiting: research?.waiting ?? null,
        waitingStory: !!research?.waitingStory,
        conflicts,
        // Open ones only: a decided or abandoned hypothesis no longer waits on anyone.
        hypotheses: (p.research?.hypotheses ?? []).filter(isOpenHypothesis).length,
        question: p.question?.trim() || null,
        agent: research?.agent ?? null,
        queued: research?.queued ?? null,
        showStatus: !!status && ctx.settings.status,
        showStory: !!story && ctx.settings.story,
        action: null,
        actions: [],
        showAgent: false,
        doneSince: null,
    };
    if (p.isPlaceholder) return { ...info, showStatus: false, showStory: false };
    info.actions = presentActions(info, ctx.settings);
    info.action = info.actions[0] ?? null;
    // The amber badge comes first: then the agent is in the tooltip only.
    if (!info.action && ctx.settings.agent) {
        info.showAgent = !!info.agent;
        if (!info.agent && research?.done !== undefined) info.doneSince = research.done;
    }
    return info;
}

/**
 * The action signals a card shows: every one present and switched on
 * (Settings → Show on card), in ACTION_ORDER. The first is the badge; two
 * or more show as a stack of badges.
 */
export function presentActions(
    s: Pick<CardSignalInfo, 'waiting' | 'conflicts' | 'question'>,
    settings: Pick<CardSignals, ActionSignal>,
): ActionSignal[] {
    const present: Record<ActionSignal, boolean> = {
        waiting: !!s.waiting,
        conflict: s.conflicts > 0,
        question: !!s.question,
    };
    return ACTION_ORDER.filter(a => present[a] && settings[a]);
}

/** One choice of the stack's menu: answer what waits, compare a story's new version, what the research knows, follow the research. */
export type StackChoice = 'waiting' | 'story' | 'knows' | 'agent';

/**
 * The choices a click on a stack of badges offers, in the menu's order:
 * what waits, a story's new version, what the research knows (conflicts,
 * hypotheses, the question — one choice), and following the research while
 * the agent works on the person (its arc is not drawn beside the badges).
 * One choice opens at once; two or more open the menu.
 */
export function stackChoices(s: Pick<CardSignalInfo, 'waiting' | 'waitingStory' | 'conflicts' | 'question' | 'agent' | 'showAgent'>): StackChoice[] {
    const out: StackChoice[] = [];
    if (s.waiting) out.push('waiting');
    if (s.waitingStory) out.push('story');
    if (s.conflicts > 0 || s.question) out.push('knows');
    if (s.showAgent || s.agent) out.push('agent');
    return out;
}

/**
 * The story as a folded corner (hollow for a couple's story alone or a
 * draft, spec 066 P4 §6). Empty when there is none. On the card the fold
 * covers the card's corner; `inline`: before the words in a tooltip or menu line.
 */
export function storyFoldHtml(story: StoryMark | null, inline = false, mark = false): string {
    return story
        ? `<span class="card-story${story.final ? '' : ' draft'}${story.kind === 'couple' ? ' couple' : ''}${inline ? ' card-story--inline' : ''}"${mark ? ' data-mark="story"' : ''} aria-hidden="true"></span>`
        : '';
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
