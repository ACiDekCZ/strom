/**
 * Timeline view model: people as horizontal life-bars on a year axis, with life
 * events as dots. Pure computations over StromData (no DOM, no layout pipeline);
 * `todayYear` is injected for testability. The renderer turns the model into SVG.
 *
 * Only people with a known birth year are placed; the rest are counted as
 * omitted. A living person's bar runs to `todayYear`.
 */

import { StromData, Gender, LifeEventType } from './types.js';
import { yearOf } from './dates.js';
import { isLivingPerson } from './privacy.js';

export interface TimelineEvent {
    year: number;
    /** Life-event type, or 'wedding' synthesized from a partnership. */
    type: LifeEventType | 'wedding';
    customLabel?: string;
}

export interface TimelineRow {
    personId: string;
    name: string;
    gender: Gender;
    startYear: number;
    endYear: number;
    isLiving: boolean;
    /** False for a deceased person without a recorded death date. */
    endKnown: boolean;
    events: TimelineEvent[];
}

export interface TimelineAxis { minYear: number; maxYear: number; }
export interface TimelineModel {
    axis: TimelineAxis;
    rows: TimelineRow[];
    omittedCount: number;
}

/** Round down / up to the enclosing decade so the axis has tidy gridlines. */
function floorDecade(year: number): number { return Math.floor(year / 10) * 10; }
function ceilDecade(year: number): number { return Math.ceil(year / 10) * 10; }

/**
 * Build the timeline model for the given (already-selected) person ids. Rows are
 * ordered by birth year, then name, then id for determinism.
 */
export function computeTimelineModel(
    data: StromData, personIds: string[], todayYear: number
): TimelineModel {
    const rows: TimelineRow[] = [];
    let omittedCount = 0;

    // Wedding years per person (from partnerships with a dated start).
    const weddingsByPerson = new Map<string, number[]>();
    for (const u of Object.values(data.partnerships)) {
        const wy = yearOf(u.startDate);
        if (wy === null) continue;
        for (const pid of [u.person1Id, u.person2Id]) {
            const arr = weddingsByPerson.get(pid) ?? [];
            arr.push(wy);
            weddingsByPerson.set(pid, arr);
        }
    }

    for (const id of personIds) {
        const p = data.persons[id as keyof typeof data.persons];
        if (!p || p.isPlaceholder) continue;
        const startYear = yearOf(p.birthDate);
        if (startYear === null) { omittedCount++; continue; }

        const deathYear = yearOf(p.deathDate);
        const living = isLivingPerson(p, todayYear);
        // A living person's bar runs to today. A deceased person without a
        // recorded death has an UNKNOWN end — draw a stub at the birth year
        // instead of inventing a bar to the present.
        const endYear = living ? todayYear : (deathYear ?? startYear);

        const events: TimelineEvent[] = [];
        for (const ev of p.events ?? []) {
            const y = yearOf(ev.date);
            if (y === null) continue;
            events.push({ year: y, type: ev.type, ...(ev.customLabel ? { customLabel: ev.customLabel } : {}) });
        }
        for (const wy of weddingsByPerson.get(id) ?? []) {
            events.push({ year: wy, type: 'wedding' });
        }
        events.sort((a, b) => a.year - b.year);

        rows.push({
            personId: id,
            name: `${p.firstName} ${p.lastName}`.trim(),
            gender: p.gender,
            startYear,
            endYear: Math.max(endYear, startYear),
            isLiving: living,
            endKnown: living || deathYear !== null,
            events,
        });
    }

    rows.sort((a, b) => a.startYear - b.startYear || a.name.localeCompare(b.name) || a.personId.localeCompare(b.personId));

    let minYear = Infinity, maxYear = -Infinity;
    for (const r of rows) {
        minYear = Math.min(minYear, r.startYear);
        maxYear = Math.max(maxYear, r.endYear);
    }
    if (!isFinite(minYear)) { minYear = todayYear; maxYear = todayYear; }

    return {
        axis: { minYear: floorDecade(minYear), maxYear: ceilDecade(maxYear) },
        rows,
        omittedCount,
    };
}

/** Fraction (0..1) of a year across the axis span; clamped to the axis. */
export function yearToFraction(year: number, axis: TimelineAxis): number {
    const span = axis.maxYear - axis.minYear;
    if (span <= 0) return 0;
    return Math.max(0, Math.min(1, (year - axis.minYear) / span));
}

/** Decade tick years across the axis (inclusive of both ends). */
export function axisTicks(axis: TimelineAxis, step = 10): number[] {
    const ticks: number[] = [];
    for (let y = axis.minYear; y <= axis.maxYear; y += step) ticks.push(y);
    return ticks;
}
