/**
 * A hypothesis of the research as "What the research knows" words it: its
 * state, and what its note adds to its versions. Pure (strings only).
 */

import { strings } from './strings.js';
import type { ResearchHypothesis } from './types.js';

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
