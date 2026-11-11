/**
 * Deciding a hypothesis of the research from the app (spec 074): whether its
 * card offers the choice of a version (hypothesisPickable), the links that
 * ask the research for it (each confirmed in the research's terminal; the
 * app writes nothing), and what a decided one says about reopening and
 * changing it. Pure: the device, the bridge's word and the read-only state
 * come in from the UI (`researchHypothesisPickable` in research-sync-ui.ts).
 */

import type { ResearchHypothesis } from './types.js';
import {
    HYPOTHESIS_DECIDE_LINK_FEATURE, ResearchHypothesisDo, researchSchemeUrl, DEFAULT_RESEARCH_SCHEME,
} from './research-link.js';

/**
 * How the card of a hypothesis is offered (DEV §2):
 * - `pick`: the versions with "Choose", the actions under the box (each a link into the research);
 * - `old`: today's card (no choice; "Decide in the research" its main action);
 * - `remote`: readable, "Show" works, no choice and no links (a phone, a tablet, a browser away from the research);
 * - `readonly`: only read (a copy, a saved HTML, a book, a print);
 * - `merge`: today's rows with a line that merging people is decided in the research.
 */
export type HypothesisPick = 'pick' | 'old' | 'remote' | 'readonly' | 'merge';

/** What decides the offer besides the hypothesis itself. */
export interface HypothesisPickEnv {
    /** The open tree takes no edits (a copy, a saved HTML, a book, a print) or is no research tree here. */
    readOnly: boolean;
    /** The research's /status features: what its bridge says now, else what it said last in this page; null: not known. */
    features: readonly string[] | null | undefined;
    /** The research on this computer takes `hypothesis` links (researchLinkAvailable('hypothesis'); false off a computer). */
    linkAvailable: boolean;
}

/** A version joining more people than this is a large link (its pill; the research's terminal says the count). */
export const HYPOTHESIS_BIG_JOIN = 50;

/** The states a hypothesis can be decided from (and changed); a newer word of the research is not one. */
const DECIDABLE_STATES: ReadonlySet<string> = new Set(['open', 'decided', 'abandoned']);

/** A version of it would merge people (`same`) or make siblings without parents (`siblings`). */
function mergesPeople(h: ResearchHypothesis): boolean {
    return (h.variants ?? []).some(v => v.links.some(l => l.kind === 'same' || l.kind === 'siblings'));
}

/**
 * How the card of this hypothesis is offered (DEV §2). The research's
 * `_PICK` decides what can be chosen (links of people not in the file are
 * missing there); its own `_LINK` check is only the fallback for "merging
 * is decided in the research". Without `hypothesis.decide.link` in the
 * research's features the card is today's; a `_PICK` it sent shows the
 * research knows it, so a phone or a read-only copy still reads the
 * versions (without anything to choose). The function and the data decide,
 * never the screen's width. An archive is `pick` too (its card only has no
 * agent's proposal and no offer of "The AI decides").
 */
export function hypothesisPickable(h: ResearchHypothesis, env: HypothesisPickEnv): HypothesisPick {
    if (!h.id || !/^H\d{1,7}$/.test(h.id)) return 'old';
    if (h.status !== undefined && !DECIDABLE_STATES.has(h.status)) return 'old';
    const said = env.features ?? null;
    if (said && !said.includes(HYPOTHESIS_DECIDE_LINK_FEATURE)) return 'old';
    if (!h.pickable || (h.variants ?? []).length === 0) {
        // Merging is decided in the research: said only to a research that knows deciding in the app.
        return said && !env.readOnly && env.linkAvailable && mergesPeople(h) ? 'merge' : 'old';
    }
    if (env.readOnly) return 'readonly';
    if (!env.linkAvailable) return 'remote';
    return said ? 'pick' : 'old';
}

/**
 * The link that asks the research to decide a hypothesis (DEV §0): `decide`
 * with a version (Choose), `abandon` (No version holds), `keep-open` (Leave
 * open), `reopen` (Reopen), `decide` without one (its screen in the
 * research). Null when anything is not what the research takes.
 */
export function hypothesisLinkUrl(tree: string, id: string, what: ResearchHypothesisDo, variant?: string, scheme: string = DEFAULT_RESEARCH_SCHEME): string | null {
    return researchSchemeUrl('hypothesis', { tree, hypothesis: id, hypothesisDo: what, ...(variant !== undefined ? { variant } : {}) }, scheme);
}

/** The link that accepts the agent's proposals of these hypotheses (DEV §10, P2: 1–50 ids), or null. */
export function hypothesesAcceptUrl(tree: string, ids: readonly string[], scheme: string = DEFAULT_RESEARCH_SCHEME): string | null {
    return researchSchemeUrl('hypotheses', { tree, hypothesesDo: 'accept', ids }, scheme);
}

/**
 * Choosing this version leaves the tree as it is (`3 _STAYS` under
 * `_REOPEN no`): the old link stays, further work stands on it, the new one
 * is not written. Its card then promises no change of the tree.
 */
export function hypothesisChoiceStays(h: ResearchHypothesis, variant: string): boolean {
    return !!h.reopen?.stays?.includes(variant);
}

/** A decided hypothesis can be changed to another version that changes the tree (one not chosen and not in `_STAYS`). */
export function hypothesisChangeChangesTree(h: ResearchHypothesis): boolean {
    return (h.variants ?? []).some(v => v.id !== h.chosen && !hypothesisChoiceStays(h, v.id));
}

/**
 * Why a decided hypothesis cannot be reopened (DEV §6): `tree` — the
 * chosen version's links are in the tree written otherwise; `work` —
 * further work stands on what the decision wrote; `other` — a reason the
 * app has no sentence for. `count`: the links (0 when not said); `change`:
 * "Change is possible" goes with it (another version would change the
 * tree). Null when it can be reopened.
 */
export function hypothesisCannotReopen(h: ResearchHypothesis): { kind: 'tree' | 'work' | 'other'; count: number; change: boolean } | null {
    if (!h.reopen) return null;
    const kind = h.reopen.type === 'tree' || h.reopen.type === 'work' ? h.reopen.type : 'other';
    return { kind, count: h.reopen.count ?? 0, change: kind !== 'other' && hypothesisChangeChangesTree(h) };
}
