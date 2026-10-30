/**
 * The "opens in the research" mark (spec 020, symbols of history §6): an
 * action that opens the research's terminal carries a terminal window at its
 * end; one where an AI agent works carries the AI badge before it. The "↗"
 * stays only for the web in a new window (archives, sources, help). The mark
 * itself is decorative (aria-hidden): what it says rides on the `title` and,
 * where the element has no own accessible name, on a visually hidden text.
 */

import { strings } from '../strings.js';
import { researchOpenSvg } from '../history-symbols.js';

export type ResearchOpenMarkSize = 12 | 14 | 16;

export interface ResearchOpenMarkOptions {
    /** An AI agent works (costs): the AI badge before the mark. */
    ai?: boolean;
    /** 12: a link in text, 14: a menu item or button (default), 16: a bottom sheet row. */
    size?: ResearchOpenMarkSize;
    /**
     * Add the hidden text for screen readers (default). Off where the element
     * names itself (aria-label already says "opens in the research").
     */
    sr?: boolean;
}

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The hidden words of the mark: ", AI, opens in the research" (state 3) or ", opens in the research" (state 2). */
export function researchOpenSrText(ai = false): string {
    const r = strings.research;
    return `, ${ai ? `${r.aiBadge}, ` : ''}${r.opensInResearchSr}`;
}

/** The hidden words as their own span (for a label element the mark stands beside). */
export function researchOpenSrHtml(ai = false): string {
    return `<span class="research-open-sr">${esc(researchOpenSrText(ai))}</span>`;
}

/**
 * [hidden text][AI badge] mark: the mark is always last on screen. The hidden
 * words come first and stay inline (font-size 0, not taken out of the flow):
 * a hidden or positioned box before them would make the browser put a space
 * into the accessible name ("Open in system , opens in the research").
 */
export function researchOpenMark(opts: ResearchOpenMarkOptions = {}): string {
    const r = strings.research;
    const ai = opts.ai ? `<span class="research-ai-badge" title="${esc(r.aiCostHint)}" aria-hidden="true">${esc(r.aiBadge)}</span>` : '';
    const mark = `<span class="research-open-mark" title="${esc(r.opensInResearchTitle)}" aria-hidden="true">${researchOpenSvg(opts.size ?? 14)}</span>`;
    const sr = opts.sr === false ? '' : researchOpenSrHtml(!!opts.ai);
    return sr + ai + mark;
}

/** A label without a trailing "↗" (texts that once carried it). */
export function researchLabelText(label: string): string {
    return label.replace(/\s*↗\s*$/, '');
}

/**
 * A label followed by the mark, the last word kept with it on one line (a
 * link in running text must not leave the mark alone on the next line). One
 * span around it all: in a flex button the label stays one item (no gap
 * inside it, no space in its accessible name).
 */
export function researchOpenLabel(label: string, opts: ResearchOpenMarkOptions = {}): string {
    const text = researchLabelText(label);
    const cut = text.lastIndexOf(' ');
    const head = cut >= 0 ? text.slice(0, cut + 1) : '';
    const last = cut >= 0 ? text.slice(cut + 1) : text;
    return `<span class="research-open-text">${esc(head)}<span class="research-open-nowrap">${esc(last)}${researchOpenMark(opts)}</span></span>`;
}

/** The same for an element built in the DOM: its text replaced by the label and the mark. */
export function setResearchOpenLabel<T extends HTMLElement>(el: T, label: string, opts: ResearchOpenMarkOptions = {}): T {
    el.innerHTML = researchOpenLabel(label, opts);
    return el;
}
