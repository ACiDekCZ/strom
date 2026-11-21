/**
 * Following the research agent in the fan (and, later, on the map): which
 * people are worked on, by which session, and what the fan centres on.
 * Pure logic, no DOM: the views draw from it.
 *
 * Sessions: every run of `working[]` that is not paused counts, in the order
 * of the "Now" list; its number is that position (1, 2, …). Numbers are shown
 * only when two or more runs work at once. Session 1 takes the app's primary
 * colour, the others the accent.
 *
 * Runs (spec 126 U10 §7, a research with `/status.runs`): a row belongs to
 * its run; the run's number is its block's place in Now (the general run
 * "1", a direction's run its glyph and number, "↑ 2"). The run followed
 * takes the primary colour, every other one the accent. Without runs:
 * sessions as above.
 */

import { PersonId } from './types.js';
import type { FanCenterSetting } from './live-follow-prefs.js';

/** What a working row needs here (a subset of LiveWorker). */
export interface WorkingRow {
    who: string;
    task: string;
    person?: string;
    paused?: unknown;
    /** A place of the record ("L0001"), when the research gives one (part of the map work). */
    place?: string;
    /** The run the row belongs to (`working[].run`, spec 126 U10). */
    run?: string;
    /** The row's direction ("G0001"). */
    research?: string;
    /** The agent's session ("N0141"): a row without `run` belongs to the run of that session. */
    session?: string;
}

/** The colour group of a mark: the run followed (or session 1) primary, the others accent. */
export type FollowTone = 'primary' | 'accent';

/** A run as following marks it (a subset of LiveRun, in Now's order). */
export interface FollowRun {
    id: string;
    kind: 'queue' | 'line';
    research?: string;
    state: string;
    session?: string;
    /** Its rows of `working[]` (the same objects). */
    workers: readonly WorkingRow[];
    /** The glyph of its direction (↑ ↓ ⌕ ?), for its label. */
    glyph?: string;
}

/** The runs and the run followed, when the research sends runs (absent or empty: sessions, as before). */
export interface FollowRunsOpts {
    runs?: readonly FollowRun[];
    /** The run followed (null: none). */
    followedRunId?: string | null;
    /** Only this run's people (the phone marks the run followed alone). */
    onlyRun?: string | null;
}

/** The mark of a row: its number, its label ("1", "↑ 2") and colour group; its run, when it has one. */
export interface FollowMark {
    session: number;
    label: string;
    tone: FollowTone;
    runId?: string;
}

/** One person worked on by one session. */
export interface FollowTarget {
    /** Index of the row in `working[]`. */
    row: number;
    /** 1-based session number (its place among the runs that are not paused; with runs: its run's block in Now). */
    session: number;
    personId: PersonId;
    task: string;
    who: string;
    /** What the mark shows (two or more runs): the session's number, or the run's label ("↑ 2"). */
    label: string;
    tone: FollowTone;
    /** The run (with runs only). */
    runId?: string;
}

/** The session number of each row (null: paused); `numbered`: two or more run at once. */
export function sessionNumbers(working: readonly WorkingRow[]): { numbers: Array<number | null>; numbered: boolean } {
    let n = 0;
    const numbers = working.map(w => (w.paused ? null : ++n));
    return { numbers, numbered: n >= 2 };
}

const runLive = (r: Pick<FollowRun, 'state'>): boolean => r.state !== 'ended';

/** Each run's number (its block's place in Now among the runs not ended); `numbered`: two or more. */
export function runNumbers(runs: readonly Pick<FollowRun, 'id' | 'state'>[]): { numbers: Map<string, number>; numbered: boolean } {
    const numbers = new Map<string, number>();
    for (const r of runs) if (runLive(r) && !numbers.has(r.id)) numbers.set(r.id, numbers.size + 1);
    return { numbers, numbered: numbers.size >= 2 };
}

/** A run's label: the general run its number ("1"), a direction's run its glyph and number ("↑ 2"). */
export function runLabel(run: Pick<FollowRun, 'kind' | 'glyph'>, n: number): string {
    return run.kind === 'line' && run.glyph ? `${run.glyph} ${n}` : String(n);
}

/** A run's colour: the run followed primary, every other one accent. */
export function runTone(runId: string | undefined, followedRunId: string | null | undefined): FollowTone {
    return !!runId && runId === followedRunId ? 'primary' : 'accent';
}

/** The run a row belongs to: the one it names, else the one holding it, else the one of its session. */
export function runOfRow(row: WorkingRow, runs: readonly FollowRun[]): FollowRun | null {
    return (row.run ? runs.find(r => r.id === row.run) : undefined)
        ?? runs.find(r => r.workers.includes(row))
        ?? (row.session ? runs.find(r => r.session === row.session) : undefined)
        ?? null;
}

/**
 * The run followed when none was chosen (Milan's question 4): the first one in Now's order that is not
 * waiting (nor ended) and works on a person of the tree (`hasPerson`), else the first one not waiting, else null.
 */
export function defaultFollowedRun(runs: readonly FollowRun[], hasPerson: (run: FollowRun) => boolean = () => true): string | null {
    const going = runs.filter(r => runLive(r) && r.state !== 'waiting');
    return (going.find(hasPerson) ?? going[0])?.id ?? null;
}

/** The run followed: the one chosen while it runs (not ended), else the default. */
export function followedRunOf(runs: readonly FollowRun[], chosen: string | null | undefined, hasPerson?: (run: FollowRun) => boolean): string | null {
    if (chosen && runs.some(r => r.id === chosen && runLive(r))) return chosen;
    return defaultFollowedRun(runs, hasPerson);
}

/**
 * The mark of each row of `working[]` (null: paused); `numbered`: two or more marks. Without runs: the
 * session numbers. With runs: a row's run's number, label and colour; a row of no run (a conversation)
 * numbers after the runs, in the accent.
 */
export function rowMarks(working: readonly WorkingRow[], opts: FollowRunsOpts = {}): { marks: Array<FollowMark | null>; numbered: boolean } {
    const runs = opts.runs ?? [];
    if (runs.length === 0) {
        const { numbers, numbered } = sessionNumbers(working);
        return {
            marks: numbers.map(n => (n === null ? null : { session: n, label: String(n), tone: sessionTone(n) })),
            numbered,
        };
    }
    const { numbers } = runNumbers(runs);
    let next = numbers.size;
    const marks = working.map((w): FollowMark | null => {
        if (w.paused) return null;
        const run = runOfRow(w, runs);
        const n = run ? numbers.get(run.id) : undefined;
        if (run && n !== undefined) return { session: n, label: runLabel(run, n), tone: runTone(run.id, opts.followedRunId), runId: run.id };
        const own = ++next;
        return { session: own, label: String(own), tone: 'accent' };
    });
    return { marks, numbered: next >= 2 };
}

/**
 * The people worked on: one target per running row whose person is in the tree. With runs, `onlyRun`
 * keeps the rows of that run alone (the phone).
 */
export function followTargets(working: readonly WorkingRow[], personOf: (refn: string) => PersonId | null, opts: FollowRunsOpts = {}): FollowTarget[] {
    const { marks } = rowMarks(working, opts);
    const only = opts.runs?.length && opts.onlyRun !== undefined ? opts.onlyRun : undefined;
    const out: FollowTarget[] = [];
    working.forEach((w, row) => {
        const m = marks[row];
        if (!m || !w.person) return;
        if (only !== undefined && m.runId !== only) return;
        const personId = personOf(w.person);
        if (personId) {
            out.push({ row, session: m.session, personId, task: w.task, who: w.who, label: m.label, tone: m.tone, ...(m.runId ? { runId: m.runId } : {}) });
        }
    });
    return out;
}

/** The order of marks on one person or place: the primary one first, then by number. */
export function leadFirst(a: Pick<FollowTarget, 'tone' | 'session'>, b: Pick<FollowTarget, 'tone' | 'session'>): number {
    return (a.tone === 'primary' ? 0 : 1) - (b.tone === 'primary' ? 0 : 1) || a.session - b.session;
}

/**
 * The rows whose person changed since the last look (a new row counts), and
 * the map to keep for the next look. Only these signal (the pulse).
 */
export function changedTargets(last: ReadonlyMap<number, PersonId>, targets: readonly FollowTarget[]): { changed: Set<number>; next: Map<number, PersonId> } {
    const changed = new Set<number>();
    const next = new Map<number, PersonId>();
    for (const t of targets) {
        next.set(t.row, t.personId);
        if (last.get(t.row) !== t.personId) changed.add(t.row);
    }
    return { changed, next };
}

/** The colour group of a session: the first one primary, the others accent. */
export function sessionTone(session: number): 'primary' | 'accent' {
    return session <= 1 ? 'primary' : 'accent';
}

/**
 * The fan's centre while following:
 * pinned ?? chosen person (setting 'person') ?? default person (setting 'root')
 * ?? the focus before following ?? the default person. A person no longer in
 * the tree is skipped (`exists`).
 */
export function fanCenter(o: {
    pinned: PersonId | null;
    setting: FanCenterSetting;
    chosen: PersonId | null;
    defaultPerson: PersonId | null;
    focusBefore: PersonId | null;
    exists: (id: PersonId) => boolean;
}): PersonId | null {
    const ok = (id: PersonId | null): PersonId | null => (id && o.exists(id) ? id : null);
    return ok(o.pinned)
        ?? (o.setting === 'person' ? ok(o.chosen) : null)
        ?? (o.setting === 'root' ? ok(o.defaultPerson) : null)
        ?? ok(o.focusBefore)
        ?? ok(o.defaultPerson);
}

/**
 * The focus before following when a run of following starts (spec 043 §2.1):
 * the person focused now, unless following put them there (a person worked
 * on now or the last jump's target: a tree opened again on the agent's
 * person, Show in tree from Now) — then the one kept from before for this
 * tree, else the tree's default person.
 */
export function startFocusBefore(o: {
    focus: PersonId | null;
    worked: ReadonlySet<PersonId>;
    kept: PersonId | null;
    defaultPerson: PersonId | null;
    exists: (id: PersonId) => boolean;
}): PersonId | null {
    const own = (id: PersonId | null): PersonId | null => (id && o.exists(id) && !o.worked.has(id) ? id : null);
    return own(o.focus) ?? own(o.kept) ?? o.defaultPerson;
}

// ------------------------------------------------------------ the session trail (memory only)

export interface TrailEntry {
    personId: PersonId;
    /** The place worked on (its key on the map), null when none. */
    placeKey: string | null;
    session: number;
    /** The run (with runs): its colour follows the run followed. */
    runId?: string;
    at: number;
    /** The place's position, when it has one (the map's trail draws only those). */
    geo?: { lat: number; lon: number } | null;
}

export const TRAIL_MAX = 8;
export const TRAIL_MAX_AGE_MS = 60 * 60 * 1000;
const TRAIL_OPACITY = [0.85, 0.7, 0.6, 0.5, 0.42, 0.35, 0.3, 0.25];

/** The trail with a new entry in front: at most 8, none older than 60 min (dropped here, not by a timer). */
export function pushTrail(trail: readonly TrailEntry[], entry: TrailEntry, now: number): TrailEntry[] {
    return [entry, ...trail].filter(e => now - e.at <= TRAIL_MAX_AGE_MS).slice(0, TRAIL_MAX);
}

/** The strength of the n-th trail entry (0 = the newest). */
export function trailOpacity(index: number): number {
    return TRAIL_OPACITY[Math.max(0, Math.min(TRAIL_OPACITY.length - 1, index))];
}

/**
 * The trail on the cards of the family view (spec 055 K3.2): people added
 * or changed while following, by session; the same limits as the trail of
 * places and people worked on (8, none older than 60 min, memory only).
 */
export interface CardTrailEntry {
    personId: PersonId;
    kind: 'added' | 'changed';
    session: number;
    /** The run (with runs): its colour follows the run followed. */
    runId?: string;
    at: number;
}

/** The trail with new entries in front (a person once, the newest entry kept). */
export function pushCardTrail(trail: readonly CardTrailEntry[], entries: readonly CardTrailEntry[], now: number): CardTrailEntry[] {
    const fresh = new Set(entries.map(e => e.personId));
    return [...entries, ...trail.filter(e => !fresh.has(e.personId))]
        .filter(e => now - e.at <= TRAIL_MAX_AGE_MS).slice(0, TRAIL_MAX);
}
