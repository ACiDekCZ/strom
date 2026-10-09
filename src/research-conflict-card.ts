/**
 * The card of a conflict the app can decide by a side ("What the research
 * knows"): its states and what each shows, and whether the field's value here
 * moved since it was last sent (then sending comes before the decision).
 * Pure: no DOM, no storage. The card's own state lives in the page only
 * (src/ui/conflict-decide-ui.ts) — a decision is no change of the tree.
 */

import { Partnership, Person, PersonId, StromData } from './types.js';
import { ResearchConflictTake } from './research-link.js';
import { ConflictDecideMode } from './research-decide.js';
import { gedcomTagEventType } from './ged-parser.js';
import { stable } from './research-changes.js';

/** What the card shows of a decided conflict, as it read when it was decided (the data may move on). */
export interface ConflictDecidedValues {
    /** The app's side, as shown. */
    user: string;
    /** The research's side, as shown. */
    research: string;
    /** The research's source title ('' = none). */
    source: string;
}

/** Why a decision did not go through, as the card says it. */
export type ConflictCardError = 'busy' | 'locked' | 'network';

/**
 * The card's state in this page (none: as the data say — open):
 * - `busy`: asked, the answer not here yet;
 * - `kept`: the research wrote the app's value (200, take user);
 * - `taken`: decided for the research's value (200, take research); `loaded`: its version was loaded since
 *   (the value it had here before), until then the decision alone;
 * - `takenPending`: decided for the research's value, its version not loaded ("Later");
 * - `elsewhere`: decided meanwhile in the research (409 conflict.decided) — its decision and side when said;
 * - `error`: not decided (busy, locked, no answer) — the side asked, to try again;
 * - `gone`: the research has no such conflict (404): the card goes.
 */
export type ConflictCardState =
    | { kind: 'busy'; take: ResearchConflictTake }
    | { kind: 'kept'; at: number; values: ConflictDecidedValues }
    | { kind: 'taken'; at: number; values: ConflictDecidedValues; loaded?: { from: string } }
    | { kind: 'takenPending'; values: ConflictDecidedValues }
    | { kind: 'elsewhere'; resolution: string; take?: ResearchConflictTake; values: ConflictDecidedValues; loaded?: { from: string } }
    | { kind: 'error'; take: ResearchConflictTake; error: ConflictCardError }
    | { kind: 'gone' };

/** The row of the card's states (DEV §3) a card shows. */
export type ConflictCardRow =
    | 'open' | 'busy' | 'kept' | 'taken' | 'takenPending' | 'sendFirst' | 'elsewhere' | 'link' | 'none' | 'error' | 'gone';

export type ConflictNoticeText = 'sendFirst' | 'remote' | 'alreadyDecided' | 'takenPending' | 'errBusy' | 'errLocked' | 'errNet';

export interface ConflictCardView {
    row: ConflictCardRow;
    /** The tag in the head: open / deciding / decided. */
    tag: 'open' | 'busy' | 'done';
    /** The sides (with or without choices), the decided block, the notice alone, or nothing (gone). */
    body: 'sides' | 'decided' | 'notice' | 'none';
    notice: { tone: 'warn' | 'info' | 'error'; text: ConflictNoticeText; action: 'send' | 'retry' | 'load' | null } | null;
    /** The choices: buttons deciding through the bridge, links into the research (↗), or none. */
    choices: 'buttons' | 'links' | 'none';
    /** Both choices off (sending comes first); a busy card has the asked one busy, the other off. */
    disabled: boolean;
    /** The side being decided. */
    busyTake: ResearchConflictTake | null;
    /** The sentence under each choice saying what follows. */
    notes: boolean;
    /** "Opens the research; it only asks to confirm." under the sides. */
    linkNote: boolean;
    /** The links into the research under the line ("Decide in the research ↗"). */
    researchLinks: boolean;
    /** "Leave it to the agent" among them. */
    agent: boolean;
    /** The app's side shows its value now, "edited …, not sent" and what the research has. */
    unsent: boolean;
}

export interface ConflictCardInput {
    mode: ConflictDecideMode;
    state?: ConflictCardState | null;
    /** The field's value here differs from what was last sent (conflictSentChanged). */
    sendFirst: boolean;
    /** The research's links can be opened from here (`conflict` announced, a person of the research). */
    links: boolean;
    /** Nothing that leads to an agent (an archive, or its mode not known here). */
    noAgent: boolean;
}

/** What a decidable conflict's card shows, from its state, how it is decided here and the field's value. */
export function conflictCardView(input: ConflictCardInput): ConflictCardView {
    const { mode, sendFirst } = input;
    const state = input.state ?? null;
    const links = input.links && mode !== 'none';
    const base: ConflictCardView = {
        row: 'open', tag: 'open', body: 'sides', notice: null,
        choices: mode === 'bridge' ? 'buttons' : mode === 'link' ? 'links' : 'none',
        disabled: false, busyTake: null, notes: mode !== 'none', linkNote: mode === 'link',
        researchLinks: links, agent: links && !input.noAgent, unsent: false,
    };
    const decided = { tag: 'done' as const, body: 'decided' as const, choices: 'none' as const, notes: false, linkNote: false, researchLinks: false, agent: false };
    if (state?.kind === 'gone') return { ...base, ...decided, row: 'gone', body: 'none' };
    if (state?.kind === 'kept' || state?.kind === 'taken') return { ...base, ...decided, row: state.kind };
    if (state?.kind === 'elsewhere') {
        return { ...base, ...decided, row: 'elsewhere', notice: { tone: 'info', text: 'alreadyDecided', action: null } };
    }
    if (state?.kind === 'takenPending') {
        return { ...base, ...decided, row: 'takenPending', body: 'notice', notice: { tone: 'info', text: 'takenPending', action: 'load' } };
    }
    if (state?.kind === 'busy') {
        // The request runs on whatever the mode became meanwhile: its answer decides.
        return { ...base, row: 'busy', tag: 'busy', choices: 'buttons', notes: true, linkNote: false, busyTake: state.take, researchLinks: false, agent: false };
    }
    if (mode === 'none') {
        return { ...base, row: 'none', notice: { tone: 'info', text: 'remote', action: null }, researchLinks: false, agent: false };
    }
    if (sendFirst) {
        return { ...base, row: 'sendFirst', notice: { tone: 'warn', text: 'sendFirst', action: 'send' }, disabled: true, notes: false, linkNote: false, unsent: true };
    }
    if (state?.kind === 'error' && mode === 'bridge') {
        const text: ConflictNoticeText = state.error === 'busy' ? 'errBusy' : state.error === 'locked' ? 'errLocked' : 'errNet';
        return { ...base, row: 'error', notice: { tone: 'error', text, action: 'retry' } };
    }
    return { ...base, row: mode === 'link' ? 'link' : 'open' };
}

// ==================== THE FIELD'S VALUE AGAINST THE LAST SENDING ====================

const str = (v: unknown): string => typeof v === 'string' ? v.trim() : '';

/** A couple's facts whose value is the couple's start (the wedding) or end (the divorce). */
const COUPLE_START = new Set(['MARR']);
const COUPLE_END = new Set(['DIV', 'ANUL', 'DIVF']);
const COUPLE_OTHER = new Set(['MARB', 'MARC', 'MARL', 'MARS', 'ENGA']);

/**
 * The value(s) here that a conflict about `fact` is about, at one person —
 * the parts as stored (dates as flex dates), in a stable order; null: not one
 * the app keeps (or no such person). `date`: the conflict is about the date
 * (else the place, or the value in words).
 */
export function conflictFactParts(fact: string, date: boolean, personId: PersonId, data: Pick<StromData, 'persons' | 'partnerships'>): string[] | null {
    const p = (data.persons as Record<string, Person | undefined>)[personId];
    if (!p) return null;
    const tag = fact.trim().toUpperCase();
    switch (tag) {
        case 'SEX': return [p.gender ?? ''];
        case 'NAME': return [str(p.firstName), str(p.lastName)];
        case 'NPFX': return [str(p.titleBefore)];
        case 'NSFX': return [str(p.titleAfter)];
        case 'BIRT': return [date ? str(p.birthDate) : str(p.birthPlace)];
        case 'DEAT': return [date ? str(p.deathDate) : str(p.deathPlace)];
    }
    if (COUPLE_START.has(tag) || COUPLE_END.has(tag) || COUPLE_OTHER.has(tag)) {
        const unions = Object.values(data.partnerships as Record<string, Partnership>)
            .filter(u => u.person1Id === personId || u.person2Id === personId)
            .sort((a, b) => a.id.localeCompare(b.id));
        return unions.map(u => COUPLE_START.has(tag) ? (date ? str(u.startDate) : str(u.startPlace))
            : COUPLE_END.has(tag) ? (date ? str(u.endDate) : str(u.endPlace))
            : stable(u.events ?? []));
    }
    const type = gedcomTagEventType(tag);
    if (!type) return null;
    return (p.events ?? []).filter(e => e.type === type)
        .map(e => date ? str(e.date) : [str(e.place), str(e.note)].join('\u0000'))
        .sort();
}

/**
 * The field a conflict is about has a value here other than what was last
 * sent (`sent`: the tree as the research last had it — the copy kept since
 * the last send or load, src/research-copy.ts), compared as stored, never
 * with the conflict's words. Not known (no such person there, a fact the app
 * does not keep): no.
 */
export function conflictSentChanged(fact: string, date: boolean, personId: PersonId,
    here: Pick<StromData, 'persons' | 'partnerships'>, sent: Pick<StromData, 'persons' | 'partnerships'>): boolean {
    const now = conflictFactParts(fact, date, personId, here);
    const then = conflictFactParts(fact, date, personId, sent);
    if (!now || !then) return false;
    return stable(now) !== stable(then);
}
