/**
 * The research edge: where the tree ends above a person, what Strom Research
 * knows about it (Person.research.edge, a snapshot from its GEDCOM). Three
 * independent axes, each drawn by its own means and never combined:
 *   - shape by `end` (what the records say): closed ⊥ or open ┆;
 *   - colour by `next` (what comes next): nothing / searching / for you / held;
 *   - muting by `scope`: the research stays away on purpose (a short dotted stub).
 * The live bridge's /status (working, waiting, queue) beats the snapshot's
 * `next`. Unknown words draw a neutral open stub ("the research knows
 * something here"). Pure.
 */

import { Person, ResearchEdge, ResearchEdgeMode, ResearchHypothesis } from './types.js';
import { strings } from './strings.js';
import { formatFlexDate } from './dates.js';

export type EdgeShape = 'closed' | 'open';
export type EdgeTone = 'none' | 'searching' | 'yours' | 'held';
export type EdgeSide = 'center' | 'father' | 'mother';

/** Here the tree ends, and why. */
const CLOSED_ENDS: readonly string[] = ['unnamed', 'lost', 'before-records', 'gap', 'not-found'];
/**
 * The parents are named by a variant of an open hypothesis, nobody linked
 * them (Strom Research: `_END named`, `_NEXT decide` while no task tests it):
 * an open stub — it can go on, the user decides.
 */
export const NAMED_END = 'named';
/** The research stays away on purpose. */
const MUTING_SCOPES: readonly string[] = ['limit', 'paused', 'done', 'living'];
const SEARCHING: readonly string[] = ['queued', 'proposed', 'working'];
const YOURS: readonly string[] = ['waiting', 'decide'];

/** What the live bridge says about the person right now. */
export interface EdgeLive {
    working?: boolean;
    waiting?: boolean;
    queued?: boolean;
}

export interface EdgeView {
    /** A stub above the card, a short dotted (muted) stub, or a dashed line to the parents. */
    kind: 'stub' | 'muted' | 'proof';
    side: EdgeSide;
    shape: EdgeShape;
    tone: EdgeTone;
    /** `next` after the live status. */
    next: string | undefined;
    working: boolean;
    /** The parents are named by a hypothesis, not linked (`_END named`): two hollow circles on the stub. */
    named: boolean;
    /** The short word beside the stub ('' none). */
    label: string;
    /** The bubble's first two sentences. */
    endText: string;
    nextText: string;
    /** "Parents: not searched yet. The agent is working on it right now". */
    aria: string;
}

/** The edge's parents are named, not linked (see NAMED_END); never for a proof edge. */
export function edgeNamed(edge: ResearchEdge): boolean {
    return edge.end === NAMED_END && edge.missing !== 'proof';
}

/**
 * The hypothesis a `named` edge stands on: the first of the edge's hypotheses
 * the person's research holds with its variants (null: none).
 */
export function edgeNamedHypothesis(person: Pick<Person, 'research'>): ResearchHypothesis | null {
    const edge = person.research?.edge;
    if (!edge || !edgeNamed(edge)) return null;
    const own = person.research?.hypotheses ?? [];
    for (const h of edge.hypos) {
        const found = own.find(x => x.id === h.id && (x.variants?.length ?? 0) > 0);
        if (found) return found;
    }
    return null;
}

/** How many answers a `named` edge has: every variant of its hypothesis (else the variants the edge names). */
export function edgeNamedOptions(person: Pick<Person, 'research'>): number {
    const h = edgeNamedHypothesis(person);
    if (h) return h.variants!.length;
    return person.research?.edge?.hypos.find(x => (x.variants?.length ?? 0) > 0)?.variants?.length ?? 0;
}

export function edgeShape(end: string | undefined): EdgeShape {
    return end && CLOSED_ENDS.includes(end) ? 'closed' : 'open';
}

export function edgeTone(next: string | undefined): EdgeTone {
    if (!next) return 'none';
    if (SEARCHING.includes(next)) return 'searching';
    if (YOURS.includes(next)) return 'yours';
    if (next === 'held') return 'held';
    return 'none';
}

export function edgeMuted(scope: string | undefined): boolean {
    return !!scope && MUTING_SCOPES.includes(scope);
}

/** `next` with the live bridge on top: working and waiting beat the snapshot, the queue fills a gap. */
export function effectiveNext(edge: ResearchEdge, live: EdgeLive): string | undefined {
    if (live.working) return 'working';
    if (live.waiting) return 'waiting';
    if ((!edge.next || edge.next === 'none') && live.queued) return 'queued';
    return edge.next;
}

type EndKey = keyof typeof strings.researchEdge.end;

/** `end` word → strings key (null: unknown). */
function endKey(end: string | undefined): Exclude<EndKey, 'unknown' | 'proof'> | null {
    switch (end) {
        case 'unnamed': return 'unnamed';
        case 'lost': return 'lost';
        case 'before-records': return 'beforeRecords';
        case 'gap': return 'gap';
        case 'not-found': return 'notFound';
        case 'offline': return 'offline';
        case 'partly': return 'partly';
        case 'unsearched': return 'unsearched';
        case 'no-books': return 'noBooks';
        case 'no-place': return 'noPlace';
        case 'no-clue': return 'noClue';
        default: return null;
    }
}

/** The first sentence: what the records say. */
export function edgeEndText(edge: ResearchEdge): string {
    const e = strings.researchEdge.end;
    if (edge.missing === 'proof') return e.proof;
    if (edgeNamed(edge)) return strings.researchEdge.named;
    const key = endKey(edge.end);
    if (!key) return e.unknown;
    if (key === 'beforeRecords') return e.beforeRecords(edge.records ?? null);
    return e[key];
}

/** The short word beside the stub ('' for an unknown end); `named`: with the number of its options. */
export function edgeShortLabel(edge: ResearchEdge, namedOptions = 0): string {
    const s = strings.researchEdge.short;
    if (edge.missing === 'proof') return s.proof;
    if (edgeNamed(edge)) return namedOptions > 0 ? strings.researchEdge.namedShort(namedOptions) : '';
    const key = endKey(edge.end);
    if (!key) return '';
    if (key === 'beforeRecords') return s.beforeRecords(edge.records ?? null);
    return s[key];
}

/** Why a held task waits outside the queue, in words ('' unknown). */
function heldReason(edge: ResearchEdge): string {
    const n = strings.researchEdge.next;
    const task = edge.tasks.find(t => t.held);
    const why = task?.held ?? (edge.scope === 'off-tree' ? 'off-tree' : undefined);
    if (why === 'paused') return n.heldPaused;
    if (why === 'done') return n.heldDone;
    if (why === 'off-tree') return n.heldOffTree;
    if (why === 'parked') {
        const until = task?.until ?? '';
        return n.heldParked(/^\d{4}-\d{2}-\d{2}$/.test(until) ? formatFlexDate(until) : until);
    }
    return '';
}

/** The second sentence: what comes next (or why the research stays away). */
export function edgeNextText(edge: ResearchEdge, next: string | undefined): string {
    const r = strings.researchEdge;
    if (edgeMuted(edge.scope)) {
        const scope = edge.scope as keyof typeof r.scope;
        return r.scope[scope];
    }
    switch (next) {
        case 'working': return r.next.working;
        case 'waiting': return r.next.waiting;
        case 'queued': return r.next.queued(edge.pos ?? edge.tasks.find(t => t.pos)?.pos ?? null);
        case 'proposed': return r.next.proposed;
        case 'held': return r.next.held(heldReason(edge));
        case 'decide': return r.next.decide;
        case 'none': return r.next.none;
        default: return '';
    }
}

function whoMissing(edge: ResearchEdge): string {
    const r = strings.researchEdge;
    return edge.missing === 'father' ? r.whoFather : edge.missing === 'mother' ? r.whoMother : r.whoParents;
}

/**
 * How the edge above a person is drawn in `mode`, or null when nothing is
 * (off; "for you" and the edge does not wait for the user, or is muted).
 * `namedOptions`: the number of answers of a `named` edge (edgeNamedOptions).
 */
export function edgeView(edge: ResearchEdge, mode: ResearchEdgeMode, live: EdgeLive = {}, namedOptions = 0): EdgeView | null {
    if (mode === 'off') return null;
    const next = effectiveNext(edge, live);
    const tone = edgeTone(next);
    const muted = edgeMuted(edge.scope);
    if (mode === 'mine' && (muted || tone !== 'yours')) return null;
    const endText = edgeEndText(edge);
    const nextText = edgeNextText(edge, next);
    return {
        kind: edge.missing === 'proof' ? 'proof' : muted ? 'muted' : 'stub',
        side: edge.missing === 'father' ? 'father' : edge.missing === 'mother' ? 'mother' : 'center',
        shape: edgeShape(edge.end),
        tone: muted ? 'none' : tone,
        next,
        working: next === 'working' && !muted,
        named: !muted && edgeNamed(edge),
        label: muted ? '' : edgeShortLabel(edge, namedOptions),
        endText,
        nextText,
        aria: `${whoMissing(edge)}: ${[endText, nextText].filter(Boolean).join('. ')}`,
    };
}

/**
 * The stub moves (its dashes crawl up) while the agent works on it: an open
 * stub only, while following live, with motion switched on for the tree and
 * not reduced by the system.
 */
export function edgeMoves(v: EdgeView, o: { live: boolean; motion: boolean; reducedMotion: boolean }): boolean {
    return v.working && v.kind === 'stub' && v.shape === 'open' && o.live && o.motion && !o.reducedMotion;
}

/** "Baptism 1787–1793 · Lhota, birth 1784–1830 · free online": the one line of what it stands on. */
export function edgeFactsLine(edge: ResearchEdge): string {
    const r = strings.researchEdge;
    const bits: string[] = [];
    if (edge.window) bits.push(r.baptism(edge.window.from, edge.window.to));
    const book = edge.books[0];
    if (book) {
        bits.push(book.title);
        if (book.access && book.access !== 'unknown') bits.push(r.access[book.access] ?? book.access);
    }
    return bits.join(' · ');
}

/** "estimate 1783 from the marriage 1810" / "born 1790" ('' without a year). */
export function edgeEstimateText(edge: ResearchEdge): string {
    const r = strings.researchEdge;
    const est = edge.est;
    if (!est) return '';
    if (!est.basis) return r.born(est.year);
    const year = Number(est.basis.match(/\b(\d{3,4})\b/)?.[1]);
    if (/^MARR\b/i.test(est.basis) && year) return r.estMarriage(est.year, year);
    if (/^child\b/i.test(est.basis) && year) return r.estChild(est.year, year);
    return r.estOther(est.year);
}

/** A segment of the window's timeline, as a share of its width. */
export interface EdgeTimelineSegment {
    kind: 'covered' | 'norecords' | 'rest';
    from: number;
    to: number;
}

/**
 * The window split into searched years, years without registers and the
 * rest, left to right (clipped to the window; searched wins over "no
 * registers" where the research wrote both).
 */
export function edgeTimeline(edge: ResearchEdge): EdgeTimelineSegment[] {
    const w = edge.window;
    if (!w) return [];
    const kindOf = (year: number): EdgeTimelineSegment['kind'] =>
        edge.covered.some(s => year >= s.from && year <= s.to) ? 'covered'
            : edge.noRecords.some(s => year >= s.from && year <= s.to) ? 'norecords' : 'rest';
    const out: EdgeTimelineSegment[] = [];
    for (let y = w.from; y <= w.to; y++) {
        const kind = kindOf(y);
        const last = out[out.length - 1];
        if (last && last.kind === kind) last.to = y;
        else out.push({ kind, from: y, to: y });
    }
    return out;
}
