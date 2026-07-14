/**
 * Anniversaries and the "on this day" window — pure computations over StromData.
 *
 * `today` is always injected (never `new Date()` inside) so the logic is fully
 * testable and deterministic. Only full dates (month AND day) are considered;
 * flex dates with just a year are skipped. All returned dates are real
 * occurrences (this year's or next year's) within the given horizon.
 */

import { StromData } from './types.js';
import { parseFlexDate } from './dates.js';
import { isLivingPerson, inferBirthUpperBounds } from './privacy.js';

export type AnniversaryType = 'birthday' | 'wedding' | 'birth-milestone' | 'death-milestone';

export interface Anniversary {
    /** The occurrence date within the horizon (midnight, local). */
    date: Date;
    type: AnniversaryType;
    /** People involved (one for birth/death, two for a wedding). */
    personIds: string[];
    partnershipId?: string;
    /** Age turned / marriage years / milestone number at this occurrence. */
    years: number;
    daysUntil: number;
}

export interface OnThisDayEvent {
    type: 'birth' | 'death' | 'wedding';
    personIds: string[];
    partnershipId?: string;
    years: number;   // years since the original event
}

/** Milestones counted for deceased births / deaths (round anniversaries). */
const BIRTH_MILESTONES = new Set([100, 150, 200, 250, 300]);
const DEATH_MILESTONES = new Set([50, 100, 150, 200, 250, 300]);

/** Month (1..12) and day (1..31) if the value is a full flex date, else null. */
function monthDay(value?: string): { month: number; day: number } | null {
    const d = parseFlexDate(value);
    if (!d || d.month === undefined || d.day === undefined) return null;
    return { month: d.month, day: d.day };
}

function midnight(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Next occurrence of month/day on or after `today`, with whole-day distance. */
function nextOccurrence(today: Date, month: number, day: number): { date: Date; daysUntil: number } {
    const t0 = midnight(today);
    let occ = new Date(t0.getFullYear(), month - 1, day);
    if (occ < t0) occ = new Date(t0.getFullYear() + 1, month - 1, day);
    const daysUntil = Math.round((occ.getTime() - t0.getTime()) / 86_400_000);
    return { date: occ, daysUntil };
}

function fullYear(value?: string): number | null {
    const d = parseFlexDate(value);
    return d ? d.year : null;
}

/**
 * Upcoming anniversaries within `horizonDays`: birthdays of living people,
 * wedding anniversaries of living couples, and round birth/death milestones of
 * the deceased. Sorted by soonest, then by type for stability.
 */
export function upcomingAnniversaries(
    data: StromData, today: Date, horizonDays = 30
): Anniversary[] {
    const out: Anniversary[] = [];
    const currentYear = today.getFullYear();

    const add = (
        type: AnniversaryType, personIds: string[], years: number,
        occ: { date: Date; daysUntil: number }, partnershipId?: string
    ) => {
        if (occ.daysUntil <= horizonDays) out.push({ ...occ, type, personIds, years, partnershipId });
    };

    // Smart liveness shared with the privacy filter (indirect evidence).
    const bounds = inferBirthUpperBounds(data);

    for (const p of Object.values(data.persons)) {
        if (p.isPlaceholder) continue;
        const md = monthDay(p.birthDate);
        const birthYear = fullYear(p.birthDate);
        const living = isLivingPerson(p, currentYear, bounds);

        if (md && birthYear !== null) {
            const occ = nextOccurrence(today, md.month, md.day);
            const years = occ.date.getFullYear() - birthYear;
            if (living) {
                add('birthday', [p.id], years, occ);
            } else if (BIRTH_MILESTONES.has(years)) {
                add('birth-milestone', [p.id], years, occ);
            }
        }

        // Death milestones (deceased only, by definition a death date exists).
        const dmd = monthDay(p.deathDate);
        const deathYear = fullYear(p.deathDate);
        if (dmd && deathYear !== null) {
            const occ = nextOccurrence(today, dmd.month, dmd.day);
            const years = occ.date.getFullYear() - deathYear;
            if (DEATH_MILESTONES.has(years)) add('death-milestone', [p.id], years, occ);
        }
    }

    for (const u of Object.values(data.partnerships)) {
        const md = monthDay(u.startDate);
        const weddingYear = fullYear(u.startDate);
        if (!md || weddingYear === null) continue;
        const p1 = data.persons[u.person1Id], p2 = data.persons[u.person2Id];
        if (!p1 || !p2) continue;
        // Living couples only (both partners presumed living).
        if (!isLivingPerson(p1, currentYear, bounds) || !isLivingPerson(p2, currentYear, bounds)) continue;
        const occ = nextOccurrence(today, md.month, md.day);
        const years = occ.date.getFullYear() - weddingYear;
        if (years > 0) add('wedding', [u.person1Id, u.person2Id], years, occ, u.id);
    }

    return out.sort((a, b) =>
        a.daysUntil - b.daysUntil || a.type.localeCompare(b.type) || a.years - b.years);
}

/** How many upcoming anniversaries fall within `days` (badge count). */
export function countWithin(data: StromData, today: Date, days: number): number {
    return upcomingAnniversaries(data, today, days).length;
}

/**
 * Events that happened on exactly today's month+day in any year — births,
 * deaths and weddings, historical included. Newest-first by years-since.
 */
export function onThisDay(data: StromData, today: Date): OnThisDayEvent[] {
    const out: OnThisDayEvent[] = [];
    const tm = today.getMonth() + 1, td = today.getDate(), ty = today.getFullYear();

    const matches = (value?: string): number | null => {
        const md = monthDay(value);
        const y = fullYear(value);
        if (!md || y === null || md.month !== tm || md.day !== td) return null;
        return ty - y;
    };

    for (const p of Object.values(data.persons)) {
        if (p.isPlaceholder) continue;
        const bAgo = matches(p.birthDate);
        if (bAgo !== null && bAgo > 0) out.push({ type: 'birth', personIds: [p.id], years: bAgo });
        const dAgo = matches(p.deathDate);
        if (dAgo !== null && dAgo > 0) out.push({ type: 'death', personIds: [p.id], years: dAgo });
    }
    for (const u of Object.values(data.partnerships)) {
        const wAgo = matches(u.startDate);
        if (wAgo !== null && wAgo > 0) {
            out.push({ type: 'wedding', personIds: [u.person1Id, u.person2Id], years: wAgo, partnershipId: u.id });
        }
    }

    return out.sort((a, b) => b.years - a.years);
}
