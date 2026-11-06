/**
 * A hypothesis of the research as "What the research knows" words it: its
 * state, and what its note adds to its versions. Pure (strings only).
 */

import { strings } from './strings.js';
import { formatFlexDate } from './dates.js';
import type { ResearchHypothesis } from './types.js';
import { isOpenHypothesis } from './view-links.js';

/** A decision's reason longer than this shows its first lines, the rest unfolded on a click. */
export const HYPOTHESIS_REASON_FOLD = 200;

/**
 * What a decided or abandoned hypothesis says of its decision (spec 060):
 * "decided by the agent" (only the agent's), its day in the app's date
 * style and its reason; '' each where the research did not say it.
 */
export function researchHypothesisDecision(h: ResearchHypothesis): { by: string; day: string; reason: string } {
    if (isOpenHypothesis(h)) return { by: '', day: '', reason: '' };
    return {
        by: h.decidedBy === 'agent' ? strings.research.hypoByAgent : '',
        day: h.decidedAt ? formatFlexDate(h.decidedAt) : '',
        reason: h.decision?.trim() ?? '',
    };
}

/** The label of a hypothesis's way into the research: decide an open one, change a decided or abandoned one. */
export function researchHypothesisLinkLabel(h: ResearchHypothesis): string {
    return isOpenHypothesis(h) ? strings.research.decide : strings.research.hypoChange;
}

/** A hypothesis's state in words: open, decided (for which version), abandoned, or a newer word as written. */
export function researchHypothesisState(h: ResearchHypothesis): string {
    const r = strings.research;
    if (h.status === 'decided') return r.hypoDecided(h.chosen ?? '');
    if (h.status === 'abandoned') return r.hypoAbandoned;
    return !h.status || h.status === 'open' ? r.hypoOpen : h.status;
}

/**
 * The hypothesis's note without what its versions already say: the research
 * lists them there too ("A: …", "B: …"), each line a version's letter.
 */
export function researchHypothesisNote(h: ResearchHypothesis): string {
    const note = h.note?.trim() ?? '';
    if (!note || !h.variants?.length) return note;
    const ids = new Set(h.variants.map(v => v.id));
    return note.split('\n').map(l => l.trim()).filter(l => {
        const m = /^([A-Z]{1,3})\s*[:)]\s/.exec(l);
        return l && !(m && ids.has(m[1]));
    }).join(' ');
}
