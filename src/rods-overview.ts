/**
 * Pure helpers of the tree overview's "Family lines" section (package 1031
 * §1): the order of the list, the period axis, the search, and the small
 * facts each row shows. The lineages themselves come from src/lineage.ts;
 * nothing here decides who belongs to a lineage.
 */

import { Rod, RodId } from './lineage.js';
import { Person, StromData } from './types.js';
import { normalizeSearchText } from './name-search.js';
import { isLivingPerson } from './privacy.js';

/** How the list is ordered: size (default), oldest first, alphabetically. */
export type RodSort = 'size' | 'oldest' | 'alpha';

export const ROD_SORTS: readonly RodSort[] = ['size', 'oldest', 'alpha'];

export function isRodSort(x: unknown): x is RodSort {
    return typeof x === 'string' && (ROD_SORTS as readonly string[]).includes(x);
}

/** People of a lineage the size order counts: real members and the spouses who married in. */
export function rodSize(rod: Rod): number {
    return rod.realMemberCount + rod.realSpouseCount;
}

/**
 * The lineages in the chosen order. Size: members + spouses, largest first;
 * oldest: the first year of the period (lineages without one last); alpha:
 * the label in the UI language. Ties fall back to the label, then the id, so
 * the order never depends on the input order.
 */
export function sortRods(list: readonly Rod[], sort: RodSort, labels: ReadonlyMap<RodId, string>, lang: string): Rod[] {
    const label = (r: Rod): string => labels.get(r.id) ?? r.surname;
    const byLabel = (a: Rod, b: Rod): number => label(a).localeCompare(label(b), lang) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const from = (r: Rod): number => r.period?.from ?? Number.POSITIVE_INFINITY;
    const cmp = sort === 'size'
        ? (a: Rod, b: Rod) => rodSize(b) - rodSize(a) || byLabel(a, b)
        : sort === 'oldest'
            ? (a: Rod, b: Rod) => (from(a) === from(b) ? 0 : from(a) < from(b) ? -1 : 1) || rodSize(b) - rodSize(a) || byLabel(a, b)
            : byLabel;
    return [...list].sort(cmp);
}

/** The step the period axis is rounded to. */
export const AXIS_STEP = 50;

/**
 * The axis above the period bars: the earliest year of the lineages rounded
 * down to 50 years, the latest rounded up (a single year still gets a
 * 50-year span), and the middle mark on a 50-year step (null when the axis
 * is too short for one between its ends). Null when no lineage has a period.
 */
export function rodAxis(list: readonly Rod[]): { from: number; mid: number | null; to: number } | null {
    const periods = list.map(r => r.period).filter((p): p is { from: number; to: number } => !!p);
    if (!periods.length) return null;
    const min = Math.min(...periods.map(p => p.from));
    const max = Math.max(...periods.map(p => p.to));
    const from = Math.floor(min / AXIS_STEP) * AXIS_STEP;
    let to = Math.ceil(max / AXIS_STEP) * AXIS_STEP;
    if (to <= from) to = from + AXIS_STEP;
    const mid = Math.round((from + to) / 2 / AXIS_STEP) * AXIS_STEP;
    return { from, mid: mid > from && mid < to ? mid : null, to };
}

/** Where a lineage's period sits on the axis, in percent (at least a sliver wide). */
export function rodBar(period: { from: number; to: number }, axis: { from: number; to: number }): { left: number; width: number } {
    const span = axis.to - axis.from;
    const left = Math.max(0, Math.min(100, ((period.from - axis.from) / span) * 100));
    const right = Math.max(left, Math.min(100, ((period.to - axis.from) / span) * 100));
    return { left, width: Math.max(1.5, right - left) };
}

/**
 * Does the lineage match a search: its label, its spellings, its places or
 * the names of its members (case and diacritics ignored, every word of the
 * query somewhere in one of them).
 */
export function rodMatches(rod: Rod, query: string, data: StromData, label: string): boolean {
    const words = normalizeSearchText(query).split(' ').filter(Boolean);
    if (!words.length) return true;
    const texts = [label, ...rod.forms, ...rod.otherForms, ...rod.places.map(p => p.name)];
    for (const id of rod.memberIds) {
        const p = data.persons[id];
        if (!p || p.isPlaceholder) continue;
        texts.push([p.firstName, p.lastName, p.marriedSurname].filter(Boolean).join(' '));
    }
    const folded = texts.map(normalizeSearchText);
    return words.every(w => folded.some(t => t.includes(w)));
}

export function searchRods(list: readonly Rod[], query: string, data: StromData, labels: ReadonlyMap<RodId, string>): Rod[] {
    if (!query.trim()) return [...list];
    return list.filter(r => rodMatches(r, query, data, labels.get(r.id) ?? r.surname));
}

/** From this many lineages the list gets a search field and shows the first ones only. */
export const ROD_SEARCH_FROM = 20;

/** "I", "II", … "XIV": a generation of a lineage. */
export function romanNumeral(n: number): string {
    if (!Number.isInteger(n) || n < 1) return String(n);
    const table: [number, string][] = [
        [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
        [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
    ];
    let out = '';
    let rest = n;
    for (const [v, s] of table) while (rest >= v) { out += s; rest -= v; }
    return out;
}

/** The place a founder is placed at: birth, else baptism, else their first event with a place. Null: none. */
export function founderPlace(p: Person): string | null {
    const birth = p.birthPlace?.trim();
    if (birth) return birth;
    const baptism = p.events?.find(e => e.type === 'baptism' && e.place?.trim());
    if (baptism) return baptism.place!.trim();
    const any = p.events?.find(e => e.place?.trim());
    return any ? any.place!.trim() : null;
}

/** The lineage's members who are living (the privacy estimate, as the overview's other counts). */
export function rodLivingCount(rod: Rod, data: StromData, year: number, bounds: Map<string, number>): number {
    let n = 0;
    for (const id of rod.memberIds) {
        const p = data.persons[id];
        if (p && !p.isPlaceholder && isLivingPerson(p, year, bounds)) n++;
    }
    return n;
}
