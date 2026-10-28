/**
 * The research's verdict on a possible duplicate of the tree check (spec 021
 * K3.1, ZADANI_DEV §3): the pairs asked (`POST <token>/duplicates`, both
 * people with the research's REFN), the reply typed, the order inside the
 * group, the label and the reason in words. Pure functions; the asking and
 * the dialog are in src/ui/duplicate-verdicts-ui.ts.
 */

import type { Person } from './types.js';
import type { ValidationIssue } from './validation.js';
import { researchRefOf } from './quality-dismiss.js';
import { yearOf } from './dates.js';
import { strings } from './strings.js';

/** The bridge judges possible duplicates (`POST <token>/duplicates`). */
export const DUPLICATES_JUDGE_FEATURE = 'duplicates.judge';
/** The most pairs in one request (the research turns more down). */
export const MAX_JUDGE_PAIRS = 1000;

/** `same` with the reason `merged` is its own kind: the research holds one person already. */
export type VerdictKind = 'same' | 'merged' | 'unsure' | 'different';

export interface DuplicateVerdict {
    kind: VerdictKind;
    /** The research's code (`same-parents`, `years-apart`, …), '' when none. */
    reason: string;
    /** The pair as the research returned it (the order the years follow). */
    pair: [string, string];
    /** The birth (or baptism) years of the two, in the order of `pair`. */
    years?: [number, number];
    /** `decided`: when, and where (`by: "research"` — marked in the research itself). */
    at?: string;
    by?: 'app' | 'research';
    /** `merged`: the person the two are now. */
    into?: string;
    /** The research's own words (its language), for a code the app does not know. */
    text?: string;
}

/** One pair of the reply: its verdict, or null (no verdict: `unknown-person`, or a reply the app does not read). */
export interface PairVerdict {
    key: string;
    verdict: DuplicateVerdict | null;
}

const REF = /^P\d{1,9}$/;

/** One key for a pair, whichever order. */
export function duplicatePairKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** The research's P… of both people of a possible duplicate, in the finding's order, or null. */
export function issueResearchPair(
    issue: Pick<ValidationIssue, 'type' | 'personIds'>,
    persons: Readonly<Record<string, Pick<Person, 'refn'> | undefined>>,
): [string, string] | null {
    if (issue.type !== 'possibleDuplicate') return null;
    const ids = issue.personIds ?? [];
    if (ids.length !== 2) return null;
    const a = researchRefOf(persons[ids[0]]);
    const b = researchRefOf(persons[ids[1]]);
    if (!a || !b || a === b) return null;
    return [a, b];
}

/** The pairs to ask, each once, by MAX_JUDGE_PAIRS a request. */
export function judgeRequests(pairs: ReadonlyArray<readonly [string, string]>, max = MAX_JUDGE_PAIRS): Array<Array<[string, string]>> {
    const seen = new Set<string>();
    const out: Array<Array<[string, string]>> = [];
    let chunk: Array<[string, string]> = [];
    for (const [a, b] of pairs) {
        const key = duplicatePairKey(a, b);
        if (seen.has(key)) continue;
        seen.add(key);
        chunk.push([a, b]);
        if (chunk.length >= max) {
            out.push(chunk);
            chunk = [];
        }
    }
    if (chunk.length > 0) out.push(chunk);
    return out;
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
    v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;

function cleanCode(v: unknown): string {
    return typeof v === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(v) ? v : '';
}

function cleanYear(v: unknown): number | null {
    return typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 3000 ? v : null;
}

/** One entry of `verdicts`, or null when it says none (or nothing the app reads). */
function verdictOf(r: Record<string, unknown>, pair: [string, string]): DuplicateVerdict | null {
    const reason = cleanCode(r.reason);
    if (reason === 'unknown-person') return null;
    const said = r.verdict;
    let kind: VerdictKind;
    if (said === 'same') kind = reason === 'merged' ? 'merged' : 'same';
    else if (said === 'unsure' || said === 'different') kind = said;
    else return null;
    const v: DuplicateVerdict = { kind, reason, pair };
    if (Array.isArray(r.years) && r.years.length === 2) {
        const y1 = cleanYear(r.years[0]);
        const y2 = cleanYear(r.years[1]);
        if (y1 !== null && y2 !== null) v.years = [y1, y2];
    }
    if (typeof r.at === 'string' && r.at.length <= 40) v.at = r.at;
    if (r.by === 'research' || r.by === 'app') v.by = r.by;
    if (typeof r.into === 'string' && REF.test(r.into)) v.into = r.into;
    if (typeof r.text === 'string') {
        const text = r.text.normalize('NFC').trim().slice(0, 200);
        if (text) v.text = text;
    }
    return v;
}

/** `POST <token>/duplicates`'s reply, or null when it is not one. */
export function parseDuplicatesReply(raw: unknown): { rev: string; verdicts: PairVerdict[] } | null {
    const r = asRecord(raw);
    if (!r || !Array.isArray(r.verdicts)) return null;
    const verdicts: PairVerdict[] = [];
    for (const item of r.verdicts) {
        const v = asRecord(item);
        if (!v || !Array.isArray(v.pair) || v.pair.length !== 2) continue;
        const [a, b] = v.pair;
        if (typeof a !== 'string' || typeof b !== 'string' || !REF.test(a) || !REF.test(b)) continue;
        verdicts.push({ key: duplicatePairKey(a, b), verdict: verdictOf(v, [a, b]) });
    }
    return { rev: typeof r.rev === 'string' ? r.rev.slice(0, 128) : '', verdicts };
}

/**
 * The order inside the group (ZADANI_DEV §3.2): probably the same (or merged
 * in the research) first, then uncertain; pairs without a verdict after them
 * (no rank); two people are set aside, not ranked.
 */
export function verdictRank(kind: VerdictKind): number | undefined {
    if (kind === 'same' || kind === 'merged') return 0;
    if (kind === 'unsure') return 1;
    return undefined;
}

/**
 * What the dialog does about verdicts (§5): `query` — a research tree whose
 * bridge runs and judges; `off` — one that judged at its last connection
 * but does not answer now (one quiet sentence); `none` — no research, or one
 * that does not judge (nothing is said).
 */
export function verdictsMode(env: {
    research: boolean;
    bridgeUp: boolean;
    /** The feature in the status the bridge gave in this page (while it runs). */
    featureNow: boolean;
    /** The feature at the last connection (kept on the device). */
    featureKnown: boolean;
}): 'query' | 'off' | 'none' {
    if (!env.research) return 'none';
    if (env.bridgeUp) return env.featureNow ? 'query' : 'none';
    return env.featureKnown ? 'off' : 'none';
}

/** The label of a verdict. */
export function verdictLabel(kind: VerdictKind): string {
    const s = strings.treeManager;
    switch (kind) {
        case 'same': return s.verdictSame;
        case 'merged': return s.verdictMerged;
        case 'unsure': return s.verdictUnsure;
        default: return s.verdictDifferent;
    }
}

/** A year of a person is the birth's, or (without one) the baptism's: which, by the tree. */
function yearKind(p: Person | undefined, year: number): 'birth' | 'baptism' {
    if (!p) return 'birth';
    if (yearOf(p.birthDate) === year) return 'birth';
    if (yearOf(p.birthDate) === null && (p.events ?? []).some(e => e.type === 'baptism' && yearOf(e.date) === year)) return 'baptism';
    return 'birth';
}

/**
 * The reason in words (§3.3). `a` and `b` are the finding's two people and
 * `refs` their P… in that order (the years follow the research's pair).
 * A code the app does not know: the research's own words, else nothing.
 * `formatDate` turns the ISO day of `decided` into the app's date.
 */
export function verdictReasonText(
    v: DuplicateVerdict,
    a: Person | undefined,
    b: Person | undefined,
    refs: readonly [string, string],
    formatDate: (isoDay: string) => string,
): string {
    const s = strings.treeManager;
    let years = v.years;
    if (years && v.pair[0] !== refs[0]) years = [years[1], years[0]];
    const kindWord = (k: 'birth' | 'baptism'): string => k === 'birth' ? s.verdictYearBirth : s.verdictYearBaptism;
    switch (v.reason) {
        case 'same-parents':
            return years
                ? s.reasonSameParents(kindWord(yearKind(a, years[0])), years[0], kindWord(yearKind(b, years[1])), years[1])
                : (v.text ?? '');
        case 'same-events': return s.reasonSameEvents;
        case 'merged': return s.reasonMerged;
        case 'years-apart': return years ? s.reasonYearsApart(years[0], years[1]) : (v.text ?? '');
        case 'life-no-overlap': return s.reasonLifeNoOverlap;
        case 'parent-child': {
            const male = a?.gender === 'male' && b?.gender === 'male';
            const female = a?.gender === 'female' && b?.gender === 'female';
            return s.reasonParentChild(male ? 'father' : female ? 'mother' : 'parent');
        }
        case 'siblings': return s.reasonSiblings;
        case 'different-parents': return s.reasonDifferentParents;
        case 'different-sex': return s.reasonDifferentSex;
        case 'decided':
            if (v.by === 'research') return s.reasonDecidedResearch;
            return v.at && /^\d{4}-\d{2}-\d{2}/.test(v.at) ? s.reasonDecided(formatDate(v.at.slice(0, 10))) : (v.text ?? '');
        case 'close-years': return years ? s.reasonCloseYears(years[0], years[1]) : (v.text ?? '');
        case 'no-date': return s.reasonNoDate;
        case 'names-differ': return s.reasonNamesDiffer;
        default: return v.text ?? '';
    }
}
