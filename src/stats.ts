/**
 * Family statistics: pure computations over StromData for the visual stats
 * section of the tree-stats dialog. No DOM, no mutation — every function takes
 * data and returns plain numbers/labels; the UI renders them as inline SVG.
 *
 * Persons/dates that lack the needed data are silently skipped; each result
 * carries an `n` (how many persons/couples it was computed from) so the UI can
 * show sample sizes and hide charts that would be misleading with too little data.
 */

import { StromData, Person, PersonId } from './types.js';
import { parseFlexDate, ageBetween } from './dates.js';
import { assignGenerations } from './generations.js';
import { personEvidence, unionsByPerson } from './evidence-level.js';

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

/** Share of real persons carrying each key fact (R4 tree-health completeness). */
export interface Completeness {
    /** Real persons (placeholders excluded) — the denominator for every share. */
    total: number;
    withBirthDate: number;
    withBirthPlace: number;
    withDeathDate: number;
    withPhoto: number;
}

/**
 * Count how many real persons carry each key fact. Pure; the UI turns the
 * counts into progress bars. Placeholders never count (they are stand-ins, not
 * documented people).
 */
export function computeCompleteness(data: StromData): Completeness {
    const persons = Object.values(data.persons).filter(p => !p.isPlaceholder);
    let withBirthDate = 0, withBirthPlace = 0, withDeathDate = 0, withPhoto = 0;
    for (const p of persons) {
        if (p.birthDate) withBirthDate++;
        if (p.birthPlace?.trim()) withBirthPlace++;
        if (p.deathDate) withDeathDate++;
        if (p.photo) withPhoto++;
    }
    return { total: persons.length, withBirthDate, withBirthPlace, withDeathDate, withPhoto };
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

    // ---- longest marriage ----
    // Ends at the first of: the recorded end (divorce), either partner's
    // death. A marriage with neither documented has no known length.
    let longestMarriage: { names: string; years: number } | null = null;
    for (const u of Object.values(data.partnerships)) {
        if (!u.startDate) continue;
        const ends = [u.endDate, data.persons[u.person1Id]?.deathDate, data.persons[u.person2Id]?.deathDate];
        let span: { years: number } | null = null;
        for (const end of ends) {
            if (!end) continue;
            const s = ageBetween(u.startDate, end);
            if (s && (!span || s.years < span.years)) span = s;
        }
        if (!span) continue;
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

/** People whose evidence is missing ("Where evidence is missing" in tree health). */
export interface EvidenceGaps {
    /** Real persons (placeholders excluded). */
    total: number;
    /** No source on the person, their events or their unions. */
    noSource: PersonId[];
    /** A birth (date, place, or a baptism) with no source for it. */
    birthNoSource: PersonId[];
    /** Where a line stops: no parents, and not someone who married in. */
    lineEnds: PersonId[];
}

export type EvidenceKind = 'noSource' | 'birthNoSource' | 'lineEnds';

/**
 * Where the tree's evidence runs out. Pure. A person counts as cited when a
 * source is on them, on one of their events or on one of their unions (the
 * same as the person's sources). A birth counts as cited by a source on the
 * person or on a birth or baptism event (src/evidence-level.ts). A line end is a person without (real) parents who
 * is an ancestor of the focus, or who has children and did not marry in (no
 * partner of theirs has parents in the tree).
 */
export function computeEvidenceGaps(data: StromData, focusId?: PersonId | null): EvidenceGaps {
    const persons = data.persons;
    const real = (id: string): boolean => !!persons[id as PersonId] && !persons[id as PersonId].isPlaceholder;
    const realParents = (p: Person): PersonId[] => p.parentIds.filter(real);
    const unionsOf = unionsByPerson(data);
    // Everyone above the focus (not the focus itself: alone, it ends no line).
    const ancestors = new Set<string>();
    if (focusId && persons[focusId]) {
        const stack: PersonId[] = [...persons[focusId].parentIds];
        while (stack.length > 0) {
            const id = stack.pop()!;
            if (ancestors.has(id)) continue;
            ancestors.add(id);
            for (const pid of persons[id]?.parentIds ?? []) if (persons[pid]) stack.push(pid);
        }
    }
    const out: EvidenceGaps = { total: 0, noSource: [], birthNoSource: [], lineEnds: [] };
    for (const p of Object.values(persons)) {
        const ev = personEvidence(p, data, unionsOf);
        if (!ev) continue;
        out.total++;
        if (ev.sources === 0) out.noSource.push(p.id);
        if (ev.hasBirth && !ev.birthCited) out.birthNoSource.push(p.id);

        if (realParents(p).length === 0) {
            const partners = (unionsOf.get(p.id) ?? [])
                .map(u => (u.person1Id === p.id ? u.person2Id : u.person1Id))
                .filter(real);
            const marriedIn = partners.some(pid => realParents(persons[pid]).length > 0);
            const hasChildren = p.childIds.some(real);
            if (ancestors.has(p.id) || (hasChildren && !marriedIn)) out.lineEnds.push(p.id);
        }
    }
    return out;
}
