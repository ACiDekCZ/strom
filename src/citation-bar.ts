/**
 * The source viewer's citation bar and the toasts of a fact's citations
 * (spec 095 §2, §3): opened from a fact's citation (a chip, a row of the
 * status tip, a row of the person's sources), the viewer says where the
 * citation stands in the fact's order and why the first one is first, and
 * offers "Mark as main" / "Unmark main" and "Remove citation" there. All
 * of it stays in the app (no research mark).
 *
 * Pure: the bar's state and words from the tree and the gates; the toasts'
 * sentences. The viewer (ui/sources.ts) draws and wires them.
 */

import type { MutationToast } from './data.js';
import { PersonId, StromData } from './types.js';
import { strings } from './strings.js';
import { shownName } from './person-name.js';
import { CitationFactInfo, CitationOrderOptions, CitationRef, citationFact, orderedCitationSteps } from './citation-order.js';
import { CitationHolder, citationMainOf } from './citation-quality.js';

/** What the tree and the viewer allow at the bar. */
export interface CiteBarGates {
    /** A main citation may be marked (citationMainOffered: no research, or one keeping `citations.main`). */
    mainOffered: boolean;
    /** The tree's research does not take a removal (it has a research without `citations.remove`). */
    removeNotTaken: boolean;
    /** Citations may be changed here (not read-only, not locked, not a read-only viewer). */
    editable: boolean;
    /** The order shown (shownCitationOrder). */
    order?: CitationOrderOptions;
}

/**
 * 'first' the first in the order (2a), 'next' another (2b), 'main' the main
 * citation (2c), 'only' the fact's only citation (2d), 'gone' just removed
 * from the bar (R9).
 */
export type CiteBarState = 'first' | 'next' | 'main' | 'only' | 'gone';

export interface CiteBar {
    state: CiteBarState;
    /** "Birth · Jan Novák". */
    what: string;
    /** Where the citation stands ("2 of 4 citations"), or what happened to it. */
    pos: string;
    setMain: boolean;
    clearMain: boolean;
    remove: boolean;
    /** "The research does not take removals yet." under the buttons. */
    note: boolean;
}

/** A fact's words: its name ("Birth"), its word in a sentence (strings.events.typesOf), and whose it is. */
export function citationFactWords(data: Pick<StromData, 'persons'>, info: CitationFactInfo): { name: string; of: string; who: string } {
    const word = info.word;
    const of = info.label ?? (word ? strings.events.typesOf[word] : '');
    let name = info.label ?? '';
    if (!name && word) {
        if (info.partnership && info.event) name = strings.partnerEvents.types[word as keyof typeof strings.partnerEvents.types] ?? '';
        else if (word === 'marriage') name = strings.fields.marriageRow;
        else if (word === 'divorce') name = strings.fields.divorceRow;
        else name = strings.events.types[word as keyof typeof strings.events.types] ?? '';
    }
    const nameOf = (id: PersonId): string => {
        const p = data.persons?.[id];
        return p ? shownName(p) : '?';
    };
    const who = info.person
        ? shownName(info.person)
        : info.partnership ? strings.partnerEvents.couple(nameOf(info.partnership.person1Id), nameOf(info.partnership.person2Id)) : '';
    return { name, of, who };
}

/** Why the first citation stands first (its K1.1 step), or '' when only the number or the list's order decides. */
function whyFirst(step: number, of: string): string {
    const s = strings.sources;
    return step === 2 ? s.whyPrimary(of) : step === 3 ? s.whyOriginal : step === 4 ? s.whyQuality : '';
}

/**
 * The bar of the viewer opened from a fact's citation of `sourceId`, or null
 * when the reference is not a fact (a person's own citations) or the source
 * is not cited there (and was not just removed from the bar: `gone`).
 */
export function citeBar(
    data: Pick<StromData, 'persons' | 'partnerships' | 'sources'>, ref: CitationRef, sourceId: string,
    gates: CiteBarGates, gone = false,
): CiteBar | null {
    const info = citationFact(data, ref);
    if (!info?.isFact) return null;
    const s = strings.sources;
    const { name, of, who } = citationFactWords(data, info);
    const what = s.citeAt(name, who);
    const sources = data.sources ?? {};
    const steps = orderedCitationSteps(data, info.holder, info.field, info.fact, gates.order ?? {}).filter(c => sources[c.id]);
    const at = steps.findIndex(c => c.id === sourceId);
    const none = { setMain: false, clearMain: false, remove: false, note: false };
    if (at < 0) return gone ? { state: 'gone', what, pos: s.citeGone(of), ...none } : null;
    const n = steps.length;
    const main = citationMainOf(info.holder as CitationHolder & Partial<Record<string, string[]>>, info.field);
    const isMain = gates.mainOffered && main === sourceId;
    let state: CiteBarState;
    let pos: string;
    if (n === 1) {
        state = 'only';
        pos = s.citeOnly(of);
    } else if (isMain) {
        state = 'main';
        pos = s.citeMainAt(of);
    } else if (at === 0) {
        state = 'first';
        const why = whyFirst(steps[0].step, of);
        pos = why ? `${s.citePos(1, n)} · ${s.citeFirstWhy(why)}` : s.citePos(1, n);
    } else {
        state = 'next';
        pos = s.citePos(at + 1, n);
    }
    const offerMain = gates.editable && gates.mainOffered && n >= 2;
    return {
        state, what, pos,
        setMain: offerMain && !isMain,
        clearMain: offerMain && isMain,
        remove: gates.editable,
        note: gates.editable && gates.removeNotTaken,
    };
}

function esc(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The bar's markup: the first chunk of the viewer's body (spec 095 §2). */
export function citeBarHtml(bar: CiteBar): string {
    const s = strings.sources;
    const isMain = bar.state === 'main';
    const gone = bar.state === 'gone';
    const star = isMain ? '<span aria-hidden="true">★︎ </span>' : '';
    const buttons = [
        bar.setMain ? `<button type="button" class="secondary viewer-cite-main" data-cite-act="set"><span aria-hidden="true">☆︎ </span>${esc(s.setMain)}</button>` : '',
        bar.clearMain ? `<button type="button" class="secondary viewer-cite-main" data-cite-act="clear">${esc(s.clearMain)}</button>` : '',
        bar.remove ? `<button type="button" class="link-button viewer-cite-remove" data-cite-act="remove">${esc(s.remove)}</button>` : '',
    ].join('');
    return `<div class="viewer-cite${isMain ? ' is-main' : ''}${gone ? ' is-gone' : ''}" role="group" aria-labelledby="viewer-cite-what">
        <div class="viewer-cite-text"${gone ? ' tabindex="-1"' : ''}>
            <span class="viewer-cite-what" id="viewer-cite-what">${esc(bar.what)}</span>
            <span class="viewer-cite-pos">${star}${esc(bar.pos)}</span>
        </div>${buttons ? `<div class="viewer-cite-acts">${buttons}</div>` : ''}${bar.note ? `<p class="viewer-cite-note">${esc(s.unciteNote)}</p>` : ''}
    </div>`;
}

// ==================== TOASTS ====================

/** Trees whose research was told once in this window that it does not take a removal (R10). */
const unciteWarned = new Set<string>();

/** A new window's session (tests). */
export function resetUnciteWarned(): void {
    unciteWarned.clear();
}

/**
 * The toast of a citation removed from a fact (spec 095 §3, 3a–3f): the fact,
 * whether it was the main citation, a shared event's persons, the source
 * staying in the catalog; for a research that does not take the removal the
 * long sentence the first time in this window for the tree, then a short tail.
 */
export function unciteToast(o: {
    fact: string; title: string; wasMain?: boolean; persons?: number; notTaken?: boolean; treeId?: string | null;
}): MutationToast {
    const s = strings.sources;
    const persons = o.persons ?? 1;
    const head = persons > 1 ? s.uncitedSharedToast(o.fact, persons, o.title)
        : o.wasMain ? s.uncitedMainToast(o.fact, o.title) : s.uncitedToast(o.fact, o.title);
    let text = `${head} · ${s.sourceStays}`;
    if (!o.notTaken) return { text };
    const key = o.treeId ?? '';
    if (!unciteWarned.has(key)) {
        unciteWarned.add(key);
        return { text, note: s.uncitedNotTaken };
    }
    text += ` · ${s.uncitedNotTakenShort}`;
    return { text };
}

/** The toast of a main citation marked (its source's title) or taken away (null). */
export function citeMainToast(fact: string, title: string | null): MutationToast {
    return { text: title !== null ? strings.sources.mainSetToast(fact, title) : strings.sources.mainClearedToast(fact) };
}
