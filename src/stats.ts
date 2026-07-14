/**
 * Family statistics: pure computations over StromData for the visual stats
 * section of the tree-stats dialog. No DOM, no mutation — every function takes
 * data and returns plain numbers/labels; the UI renders them as inline SVG.
 *
 * Persons/dates that lack the needed data are silently skipped; each result
 * carries an `n` (how many persons/couples it was computed from) so the UI can
 * show sample sizes and hide charts that would be misleading with too little data.
 */

import { StromData, Person } from './types.js';
import { parseFlexDate, ageBetween } from './dates.js';
import { assignGenerations } from './generations.js';

export interface NameCount { name: string; count: number; }
export interface GenLifespan { generation: number; avgYears: number; n: number; }
export interface GenChildren { generation: number; avgChildren: number; n: number; }
export interface MonthCount { month: number; count: number; }  // month 1..12

export interface FamilyStats {
    /** Most common first names, males and females separately (top 10 each). */
    topMaleNames: NameCount[];
    topFemaleNames: NameCount[];
    /** Average lifespan per generation (persons with both birth and death). */
    lifespanByGen: GenLifespan[];
    /** Average children per couple, per generation. */
    childrenByGen: GenChildren[];
    /** Birth counts per calendar month (persons with a known month). */
    birthsByMonth: MonthCount[];  // always 12 entries, month 1..12
    birthsByMonthN: number;
    /** Longest-lived documented person (birth+death). */
    oldest: { name: string; years: number } | null;
    /** Longest documented marriage (partnership start+end). */
    longestMarriage: { names: string; years: number } | null;
    /** Couple with the most children. */
    largestFamily: { names: string; count: number } | null;
    /** Number of generation rows the tree spans. */
    generations: number;
}

function fullName(p: Person): string {
    return `${p.firstName} ${p.lastName}`.trim();
}

/** Top-N first names for a gender, ties broken alphabetically for determinism. */
function topNames(persons: Person[], gender: 'male' | 'female', limit: number): NameCount[] {
    const counts = new Map<string, number>();
    for (const p of persons) {
        if (p.gender !== gender) continue;
        const name = p.firstName.trim();
        if (!name) continue;
        counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, limit);
}

export function computeFamilyStats(data: StromData): FamilyStats {
    const persons = Object.values(data.persons).filter(p => !p.isPlaceholder);
    const gen = assignGenerations(data);

    // ---- lifespan per generation ----
    const lifeSum = new Map<number, { sum: number; n: number }>();
    let oldest: { name: string; years: number } | null = null;
    for (const p of persons) {
        const age = ageBetween(p.birthDate, p.deathDate);
        if (!age || !p.birthDate || !p.deathDate) continue;  // need both endpoints
        const g = gen.get(p.id) ?? 0;
        const acc = lifeSum.get(g) ?? { sum: 0, n: 0 };
        acc.sum += age.years; acc.n += 1;
        lifeSum.set(g, acc);
        if (!oldest || age.years > oldest.years) oldest = { name: fullName(p), years: age.years };
    }
    const lifespanByGen: GenLifespan[] = [...lifeSum.entries()]
        .map(([generation, { sum, n }]) => ({ generation, avgYears: Math.round((sum / n) * 10) / 10, n }))
        .sort((a, b) => a.generation - b.generation);

    // ---- children per couple, per generation ----
    const childSum = new Map<number, { sum: number; n: number }>();
    for (const u of Object.values(data.partnerships)) {
        const p1 = data.persons[u.person1Id], p2 = data.persons[u.person2Id];
        if (!p1 || !p2) continue;
        const g = Math.max(gen.get(u.person1Id) ?? 0, gen.get(u.person2Id) ?? 0);
        const acc = childSum.get(g) ?? { sum: 0, n: 0 };
        acc.sum += u.childIds.length; acc.n += 1;
        childSum.set(g, acc);
    }
    const childrenByGen: GenChildren[] = [...childSum.entries()]
        .map(([generation, { sum, n }]) => ({ generation, avgChildren: Math.round((sum / n) * 10) / 10, n }))
        .sort((a, b) => a.generation - b.generation);

    // ---- births per month ----
    const monthCounts = new Array(12).fill(0) as number[];
    let birthsByMonthN = 0;
    for (const p of persons) {
        const d = parseFlexDate(p.birthDate);
        if (!d || d.month === undefined) continue;
        monthCounts[d.month - 1] += 1;
        birthsByMonthN += 1;
    }
    const birthsByMonth: MonthCount[] = monthCounts.map((count, i) => ({ month: i + 1, count }));

    // ---- largest family (couple with most children) ----
    let largestFamily: { names: string; count: number } | null = null;
    for (const u of Object.values(data.partnerships)) {
        if (u.childIds.length === 0) continue;
        if (!largestFamily || u.childIds.length > largestFamily.count) {
            const p1 = data.persons[u.person1Id], p2 = data.persons[u.person2Id];
            const names = [p1, p2].filter(Boolean).map(p => fullName(p!)).join(' & ');
            largestFamily = { names, count: u.childIds.length };
        }
    }

    // ---- generation span ----
    const genValues = new Set<number>();
    for (const p of persons) genValues.add(gen.get(p.id) ?? 0);
    const generations = genValues.size;

    // ---- longest marriage (both start and end documented) ----
    let longestMarriage: { names: string; years: number } | null = null;
    for (const u of Object.values(data.partnerships)) {
        const span = ageBetween(u.startDate, u.endDate);
        if (!span || !u.startDate || !u.endDate) continue;
        if (!longestMarriage || span.years > longestMarriage.years) {
            const p1 = data.persons[u.person1Id], p2 = data.persons[u.person2Id];
            const names = [p1, p2].filter(Boolean).map(p => fullName(p!)).join(' & ');
            longestMarriage = { names, years: span.years };
        }
    }

    return {
        topMaleNames: topNames(persons, 'male', 10),
        topFemaleNames: topNames(persons, 'female', 10),
        lifespanByGen,
        childrenByGen,
        birthsByMonth,
        birthsByMonthN,
        oldest,
        largestFamily,
        generations,
        longestMarriage,
    };
}
