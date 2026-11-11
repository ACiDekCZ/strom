/**
 * The HTML of a card's action marks (src/card-signals.ts says which): one
 * signal is its badge on the avatar's corner with the badge's bubble; two or
 * three are a stack of badges (the most pressing in front, the ones behind
 * without a glyph) with one bubble of a row per signal. Where the card has
 * no avatar, or zoomed far out, a dot on the card's corner stands for them
 * (two dots for a stack). Pure: the renderer places what this returns.
 */

import { strings } from './strings.js';
import { ACTION_GLYPH, ActionSignal, CardSignalInfo, stackChoices } from './card-signals.js';

/** Escaped for text and attribute values (quotes too). */
function esc(text: string): string {
    return (text || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** A text cut to `n` characters with "…". */
export function clipText(t: string, n = 120): string {
    return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
}

/**
 * A mark's own bubble (spec 066 P4 §5 round 2): a header, a line or two,
 * what a click does. A mouse over the mark shows it, the card's bubble steps aside.
 */
export function markTipHtml(id: string, kind: string, head: string, lines: string[], click: string, below = false): string {
    return `<span class="badge-tooltip mark-tip mt-${kind}${below ? ' below' : ''}" id="mt-${kind}-${esc(id)}" role="tooltip">`
        + `<span class="badge-tooltip-header">${esc(head)}</span>`
        + lines.filter(Boolean).map(l => `<span class="badge-tooltip-body">${esc(l)}</span>`).join('')
        + (click ? `<span class="badge-tooltip-action">${esc(click)}</span>` : '')
        + '</span>';
}

/** One action signal in words (the badge's label, a tooltip row). */
export function actionSignalText(s: CardSignalInfo, which: ActionSignal | 'agent' | 'queued'): string {
    const c = strings.card;
    const clip = (t: string): string => (t.length > 60 ? `${t.slice(0, 59).trimEnd()}…` : t);
    if (which === 'waiting') return c.ttWaiting(clip(s.waiting ?? ''));
    if (which === 'conflict') return c.ttConflicts(s.conflicts);
    if (which === 'question') return c.ttQuestion(clip(s.question ?? ''));
    if (which === 'queued') return c.ttQueued(clip(s.queued ?? ''));
    return c.ttAgent(clip(s.agent ?? ''));
}

/** The stack's name for a screen reader: "3 waiting, 2 conflicts, 1 hypothesis, 1 question". */
export function stackAriaLabel(s: CardSignalInfo, waitingCount: number): string {
    const c = strings.card;
    const parts = s.actions.flatMap(a => a === 'waiting' ? [c.stackWaiting(waitingCount)]
        : a === 'conflict' ? [c.ttConflicts(s.conflicts), s.hypotheses > 0 ? c.ttHypotheses(s.hypotheses) : '']
            : [c.menuQuestions(1)]).filter(Boolean);
    return c.stackLabel(parts);
}

/** The stack's bubble: a row per signal in the stack's order, its glyph, its head and (what waits, the question) its text on one line. */
function stackTipHtml(id: string, s: CardSignalInfo, waitingCount: number): string {
    const c = strings.card;
    const row = (a: ActionSignal, head: string, sub: string): string =>
        `<span class="mt-row"><span class="menu-signal-glyph mt-glyph signal-${a}" aria-hidden="true">${ACTION_GLYPH[a]}</span>`
        + `<span class="mt-row-text"><span class="mt-row-head">${esc(head)}</span>`
        + (sub ? `<span class="mt-row-sub">${esc(clipText(sub))}</span>` : '')
        + '</span></span>';
    const rows = s.actions.map(a => a === 'waiting'
        ? row(a, `${strings.cardDensity.cardWaiting} · ${waitingCount}`, s.waiting ?? '')
        : a === 'conflict'
            ? row(a, [c.ttConflicts(s.conflicts), s.hypotheses > 0 ? c.ttHypotheses(s.hypotheses) : ''].filter(Boolean).join(' · '), '')
            : row(a, c.tipQuestionHead, s.question ?? ''));
    const click = stackChoices(s).length >= 2 ? c.tipClickChoose : c.tipClickKnows;
    return `<span class="badge-tooltip mark-tip mt-stack" id="mt-stack-${esc(id)}" role="tooltip">`
        + rows.join('')
        + `<span class="badge-tooltip-action">${esc(click)}</span>`
        + '</span>';
}

/**
 * The card's action marks: the badge (or the stack) with its bubble for the
 * avatar's corner, and the dot (or two) for the card's corner. Null without
 * an action signal. `waitingCount`: the items of Waiting for you on the
 * person (the stack's name and bubble count them).
 */
export function cardActionMarksHtml(id: string, s: CardSignalInfo, waitingCount = 1): { badgeHtml: string; dotHtml: string } | null {
    const action = s.action;
    if (!action) return null;
    const c = strings.card;
    if (s.actions.length >= 2) {
        const n = Math.min(s.actions.length, 3);
        const coins = (n === 3 ? '<span class="cs-coin cs-back2" aria-hidden="true"></span>' : '')
            + '<span class="cs-coin cs-back1" aria-hidden="true"></span>'
            + `<span class="cs-coin cs-front" aria-hidden="true">${ACTION_GLYPH[action]}</span>`;
        return {
            badgeHtml: `<button type="button" class="card-signal-stack n${n}" data-mark="badge-stack" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(stackAriaLabel(s, waitingCount))}">${coins}</button>`
                + stackTipHtml(id, s, waitingCount),
            dotHtml: '<span class="card-signal-dot card-signal-dot--back" aria-hidden="true"></span>'
                + `<span class="card-signal-dot signal-${action}" aria-hidden="true"></span>`,
        };
    }
    // The badge's bubble: what waits, and what else does ("Also 2 conflicts, 1 question").
    const also = (parts: string[]): string => (parts.length > 0 ? c.tipAlso(parts.join(', ')) : '');
    const knowsParts = [
        s.conflicts > 0 ? c.ttConflicts(s.conflicts) : '',
        s.question ? c.menuQuestions(1) : '',
    ].filter(Boolean);
    const tip = action === 'waiting'
        ? markTipHtml(id, 'badge', strings.cardDensity.cardWaiting, [clipText(s.waiting ?? ''), also(knowsParts)], c.tipClickAnswer)
        : action === 'conflict'
            ? markTipHtml(id, 'badge', c.tipConflictHead, [
                [c.ttConflicts(s.conflicts), s.hypotheses > 0 ? c.ttHypotheses(s.hypotheses) : ''].filter(Boolean).join(' · '),
                also(s.question ? [c.menuQuestions(1)] : []),
            ], c.tipClickKnows)
            : markTipHtml(id, 'badge', c.tipQuestionHead, [clipText(s.question ?? '')], c.tipClickKnows);
    return {
        badgeHtml: `<button type="button" class="card-signal signal-${action}" data-signal="${action}" data-mark="badge" aria-label="${esc(actionSignalText(s, action))}" aria-describedby="mt-badge-${esc(id)}">${ACTION_GLYPH[action]}</button>${tip}`,
        dotHtml: `<span class="card-signal-dot signal-${action}" aria-hidden="true"></span>`,
    };
}
