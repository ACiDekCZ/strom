/**
 * What the direction form decides by itself (spec 038 §2, §3.1): the name it
 * fills in, the direction that is there already, the year limit it takes, and
 * when its primary button acts. No DOM here (src/ui/direction-form-ui.ts).
 */

import type { LiveDirection } from './research-link.js';
import type { DirectionWriteRefused } from './research-directions-write.js';
import { strings } from './strings.js';

/** The kinds the form creates. */
export type FormKind = 'ancestors' | 'descendants' | 'question';

export const FORM_KINDS: readonly FormKind[] = ['ancestors', 'descendants', 'question'];

/** The earliest and latest year "Only before the year" takes. */
export const BEFORE_MIN = 1000;
export const BEFORE_MAX = 2100;

/** Most generations offered under "Generations at most". */
export const GENERATIONS_MAX = 12;

/** The first `n` words of a question, "…" after them when there were more. */
export function firstWords(text: string, n = 6): string {
    const words = text.trim().split(/\s+/).filter(Boolean);
    return words.length > n ? `${words.slice(0, n).join(' ')}…` : words.join(' ');
}

/**
 * The name the form fills in until it is changed: "Ancestors: Jan Fíšek",
 * "Descendants: …"; a question: its first six words ("Question: {person}"
 * while it has none). '' without a person.
 */
export function autoDirectionName(kind: FormKind, personName: string, question = ''): string {
    const L = strings.live;
    if (kind === 'question') {
        if (question.trim()) return firstWords(question);
        return personName ? L.dirAutoQuestion(personName) : '';
    }
    if (!personName) return '';
    return kind === 'ancestors' ? L.dirAutoAncestors(personName) : L.dirAutoDescendants(personName);
}

const sameQuestion = (a: string | undefined, b: string): boolean =>
    (a ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase() === b.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

/**
 * The direction there is already for this person and kind (a question: the
 * same question too): a running one first, then a paused one, then the
 * latest ended one. Null: none.
 */
export function findDuplicateDirection(directions: readonly LiveDirection[], person: string, kind: FormKind, question = ''): LiveDirection | null {
    const mine = directions.filter(d => d.focus === person && d.direction === kind
        && (kind !== 'question' || sameQuestion(d.question, question)));
    if (mine.length === 0) return null;
    const by = (state: LiveDirection['state']) => mine.filter(d => d.state === state);
    const latest = (list: LiveDirection[]) => [...list].sort((a, b) => (Date.parse(b.since ?? '') || 0) - (Date.parse(a.since ?? '') || 0))[0];
    return by('active')[0] ?? by('paused')[0] ?? latest(by('done')) ?? null;
}

/** "Only before the year": null when empty, the year when it is one between 1000 and 2100, 'bad' otherwise. */
export function parseBeforeYear(text: string): number | null | 'bad' {
    const t = text.trim();
    if (!t) return null;
    if (!/^\d{1,4}$/.test(t)) return 'bad';
    const y = Number.parseInt(t, 10);
    return y >= BEFORE_MIN && y <= BEFORE_MAX ? y : 'bad';
}

/** What the primary button of a new direction does. */
export type NewPrimary =
    /** Not yet: no person, a person the research does not know, a question kind without its question. */
    | 'off'
    /** Create it. */
    | 'create'
    /** One is running and the research takes no second one: show it. */
    | 'show'
    /** One is running, a second one is allowed: create anyway. */
    | 'anyway'
    /** One is paused or ended: restart it. */
    | 'resume';

export function newPrimary(o: {
    person: boolean; linked: boolean; kind: FormKind; question: string;
    duplicate: LiveDirection | null; duplicatesAllowed: boolean;
}): NewPrimary {
    if (o.duplicate?.state === 'active') return o.duplicatesAllowed ? (o.person && o.linked ? 'anyway' : 'off') : 'show';
    if (o.duplicate) return 'resume';
    if (!o.person || !o.linked) return 'off';
    if (o.kind === 'question' && !o.question.trim()) return 'off';
    return 'create';
}

/** A refusal said in the form: the sentence, its tone, and whether "Try again" helps. */
export interface FormProblem {
    text: string;
    tone: 'warn' | 'danger';
    retry: boolean;
}

/**
 * What a refused create or edit says in the form: a busy research (amber,
 * Try again), the research's own sentence when it gave one ("The research did
 * not create the direction: “…”" for a new one), else the panel's sentence.
 */
export function formProblem(r: DirectionWriteRefused, mode: 'new' | 'edit', panelText: (r: DirectionWriteRefused) => string): FormProblem {
    const retry = r.code === 'busy' || r.code === 'network' || r.code === 'failed';
    if (r.code === 'busy') return { text: strings.live.dirBusy, tone: 'warn', retry };
    if (mode === 'new' && r.reason && r.code !== 'held') return { text: strings.live.dirRefused(r.reason), tone: 'danger', retry };
    return { text: panelText(r), tone: 'danger', retry };
}

/** The limits an edit writes: only what changed, `null` = no limit any more. Null: nothing changed. */
export function changedLimits(before: { generations?: number; before?: number } | undefined,
    after: { generations: number | null; before: number | null }): { generations?: number | null; before?: number | null } | null {
    const out: { generations?: number | null; before?: number | null } = {};
    if ((before?.generations ?? null) !== after.generations) out.generations = after.generations;
    if ((before?.before ?? null) !== after.before) out.before = after.before;
    return Object.keys(out).length > 0 ? out : null;
}
