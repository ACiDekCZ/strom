/**
 * "Originally from the family tree" under a fact the research changed, and
 * its Revert (spec 066 §3), as data: which earlier values the row shows, the
 * part a revert names, whether Revert is offered here, what the bridge's
 * answer leaves of the row, and the research's proposal on the fact (a
 * conflict of the kind `import` / `user`). No DOM, no strings: the person
 * card draws it (src/ui/fact-origin-ui.ts).
 */

import type { FactPart, Person, ResearchConflict, ResearchConflictValue, ResearchFactOrigin } from './types.js';
import type { ConflictScope } from './research-conflict-card.js';
import type { RevertResult } from './research-revert.js';
import { wasAccepted } from './reliability.js';

/** The order the parts of one fact are said in: a value, the name, the date, the place. */
const PART_ORDER: readonly FactPart[] = ['VAL', 'GIVN', 'SURN', 'DATE', 'PLAC', 'SEX'];

/** One earlier value of the row: a part's (none: the whole fact's). */
export interface WasValue {
    part?: FactPart;
    value: string;
}

/** What the row "Originally from the family tree:" shows of a fact. */
export interface WasRowModel {
    /** The earlier values of the changed parts, in the fact's order. */
    values: WasValue[];
    /** Several parts changed: which words follow them ('other': the parts named). */
    partsLabel: 'datePlace' | 'name' | 'other' | null;
    /** The research's key of the fact (`3 _REF`); none: no Revert. */
    ref?: string;
    /** The part a revert names: only when exactly one part changed (several: none, the bridge puts back all). */
    part?: FactPart;
    /** The value is a proposal a person accepted. */
    accepted: boolean;
    /** The record the value was changed by (the first one known here). */
    sourceId?: string;
}

/** The row of a fact's origin; null when the research sent no earlier value. */
export function wasRowModel(origin: ResearchFactOrigin | null | undefined, sourceKnown: (id: string) => boolean = () => true): WasRowModel | null {
    const was = origin?.was;
    if (!was || typeof was.value !== 'string') return null;
    const listed = (was.parts ?? []).filter(p => PART_ORDER.includes(p));
    const parts = [...new Set(listed)].sort((a, b) => PART_ORDER.indexOf(a) - PART_ORDER.indexOf(b));
    let values: WasValue[];
    if (parts.length === 0) {
        values = [{ value: was.value }];
    } else {
        // `value` is the first listed part's when the parts' own values are not given.
        values = parts.flatMap(p => {
            const v = was.partValues?.[p] ?? (p === listed[0] ? was.value : undefined);
            return typeof v === 'string' ? [{ part: p, value: v }] : [];
        });
        if (values.length === 0) values = [{ value: was.value }];
    }
    const shown = values.map(v => v.part).filter((p): p is FactPart => !!p);
    const partsLabel = shown.length < 2 ? null
        : shown.length === 2 && shown.includes('DATE') && shown.includes('PLAC') ? 'datePlace'
        : shown.length === 2 && shown.includes('GIVN') && shown.includes('SURN') ? 'name'
        : 'other';
    const ref = typeof was.ref === 'string' && was.ref.trim() ? was.ref.trim() : undefined;
    const sourceId = origin?.sourceIds?.find(id => sourceKnown(id));
    return {
        values,
        partsLabel,
        ...(ref ? { ref } : {}),
        ...(parts.length === 1 ? { part: parts[0] } : {}),
        accepted: wasAccepted(origin),
        ...(sourceId ? { sourceId } : {}),
    };
}

/**
 * Whether Revert is offered here: `revert` (the bridge answers here), `noBridge` (the research of this tree
 * showed origin, but its bridge does not answer now), `phone` (a phone or a tablet: only on the computer with the
 * research); null: no Revert at all (the research gave no key of the fact).
 */
export type RevertAvailability = 'revert' | 'noBridge' | 'phone';

export function revertAvailability(env: { ref?: string; onComputer: boolean; bridge: 'live' | 'down' }): RevertAvailability | null {
    if (!env.ref) return null;
    if (!env.onComputer) return 'phone';
    return env.bridge === 'live' ? 'revert' : 'noBridge';
}

/** Where a revert of one fact stands on the person card. */
export type RevertUiState =
    | { kind: 'idle' }
    | { kind: 'reverting' }
    | { kind: 'held'; computer?: string }
    | { kind: 'busy' }
    | { kind: 'gone' }
    | { kind: 'noBridge' }
    | { kind: 'error' }
    /** Written (or nothing left to put back): the row goes once the research's new version loads. */
    | { kind: 'done' };

/** What the bridge's answer leaves of the row, and the notice it brings ('reverted' / 'already'; null none). */
export function revertOutcome(result: RevertResult): { state: RevertUiState; toast: 'reverted' | 'already' | null } {
    switch (result.kind) {
        case 'ok': return { state: { kind: 'done' }, toast: 'reverted' };
        case 'nothing': return { state: { kind: 'done' }, toast: 'already' };
        case 'writeHeld': return { state: { kind: 'held', ...(result.computer ? { computer: result.computer } : {}) }, toast: null };
        case 'busy': return { state: { kind: 'busy' }, toast: null };
        case 'unknown': return { state: { kind: 'gone' }, toast: null };
        case 'noBridge': return { state: { kind: 'noBridge' }, toast: null };
        default: return { state: { kind: 'error' }, toast: null };
    }
}

/** The row's end: Revert as a button, off, the "Reverting…" dot or nothing; the sentence under the row; Try again. */
export interface RevertControls {
    revert: 'button' | 'disabled' | 'live' | 'none';
    note: { kind: 'held'; computer?: string } | { kind: 'busy' | 'gone' | 'noBridge' | 'phone' | 'error' } | null;
    retry: boolean;
}

export function revertControls(available: RevertAvailability | null, state: RevertUiState = { kind: 'idle' }): RevertControls {
    if (available === null) return { revert: 'none', note: null, retry: false };
    if (available === 'phone') return { revert: 'none', note: { kind: 'phone' }, retry: false };
    if (state.kind === 'reverting') return { revert: 'live', note: null, retry: false };
    if (state.kind === 'done') return { revert: 'none', note: null, retry: false };
    if (available === 'noBridge' || state.kind === 'noBridge') return { revert: 'disabled', note: { kind: 'noBridge' }, retry: false };
    switch (state.kind) {
        case 'held': return { revert: 'button', note: { kind: 'held', ...(state.computer ? { computer: state.computer } : {}) }, retry: false };
        case 'busy': return { revert: 'none', note: { kind: 'busy' }, retry: true };
        case 'gone': return { revert: 'none', note: { kind: 'gone' }, retry: false };
        case 'error': return { revert: 'button', note: { kind: 'error' }, retry: false };
        default: return { revert: 'button', note: null, retry: false };
    }
}

/** The person's fact a conflict is about (birth, death, name, sex, the one event of its type); null: none to show it at. */
export function conflictFact(c: Pick<ResearchConflict, 'fact'>, person: Pick<Person, 'events'>, eventTypeOfTag: (tag: string) => string | null): string | null {
    const tag = (c.fact ?? '').trim().toUpperCase();
    if (tag === 'BIRT') return 'birth';
    if (tag === 'DEAT') return 'death';
    if (tag === 'NAME') return 'name';
    if (tag === 'SEX') return 'sex';
    const type = eventTypeOfTag(tag);
    if (!type) return null;
    const events = (person.events ?? []).filter(e => e?.type === type && typeof e.id === 'string');
    return events.length === 1 ? `event:${events[0].id}` : null;
}

/** The research's proposal at a fact (a conflict of the kind import / user). */
export interface ProposalModel {
    /** Which words lead: a fact from the family tree, a part of it, or a fact a person entered. */
    lead: 'import' | 'importPart' | 'user';
    /** The part `importPart` names. */
    part?: FactPart;
    /** The proposed value (the research's side), as the research wrote it. */
    value: ResearchConflictValue | null;
    /** `open`: "Conflict ›" opens it here; `decide`: "Decide in the research" (its terminal); null: neither. */
    action: 'open' | 'decide' | null;
}

/**
 * The box under a fact for an open conflict of a kind. `partial`: the fact is
 * only partly the family tree's, or a part of it changed already (its row
 * "Originally…" stands): the proposal names the part a date or a place
 * conflict is about. `canDecide`: the app decides it (by a side, here or by
 * a link); `decideLink`: the research on this computer takes a conflict link.
 */
export function proposalModel(c: ResearchConflict, env: { scope: ConflictScope; partial: boolean; event: boolean; canDecide: boolean; decideLink: boolean }): ProposalModel | null {
    if (c.status !== 'open' || (c.kind !== 'import' && c.kind !== 'user')) return null;
    const value = c.values.find(v => v.side === 'research') ?? c.values.find(v => v.side !== 'user') ?? null;
    const part: FactPart | undefined = env.event && env.partial && c.kind === 'import'
        ? env.scope === 'date' ? 'DATE' : env.scope === 'place' ? 'PLAC' : undefined
        : undefined;
    const lead = c.kind === 'user' ? 'user' : part ? 'importPart' : 'import';
    const action = env.canDecide ? 'open' : env.decideLink ? 'decide' : null;
    return { lead, ...(part ? { part } : {}), value, action };
}
