/**
 * Timeline view model: people as horizontal life-bars on a year axis, with life
 * events as dots. Pure computations over StromData (no DOM, no layout pipeline);
 * `todayYear` is injected for testability. The renderer turns the model into SVG.
 *
 * Only people with a known birth year are placed; the rest are counted as
 * omitted. A living person's bar runs to `todayYear`.
 */

import { StromData, Gender, LifeEventType } from './types.js';
import { yearOf, parseFlexDate } from './dates.js';
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

        // A living person's bar runs to today. A deceased person without a
        // recorded death has an UNKNOWN end — the bar runs to the last known
        // event (wedding, …) instead of inventing a span to the present; the
        // renderer marks the open end with a fade-out.
        const lastEventYear = events.length > 0 ? events[events.length - 1].year : startYear;
        const endYear = living ? todayYear : (deathYear ?? Math.max(startYear, lastEventYear));

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

// ==================== PERSON LIFELINE (R2) ====================

/** The kinds of dated point on a single person's life timeline. */
export type LifelineKind = 'birth' | 'death' | 'marriage' | 'child' | 'event';

/**
 * One dated point on a person's life timeline (R2). Structured, not localized —
 * the UI composes the row text from `kind` + the resolved names, so the model
 * stays pure and translatable. Only points with a known year are produced.
 */
export interface LifelinePoint {
    /** Display year. */
    year: number;
    /** Numeric sort key: birth sorts first, death last within the same year. */
    sortKey: number;
    kind: LifelineKind;
    /** Underlying life-event type (kind === 'event'). */
    eventType?: LifeEventType;
    /** Custom event label (eventType === 'custom'). */
    customLabel?: string;
    /** Related person's name — the partner (marriage) or the child (child). */
    relatedName?: string;
    /** Participant names for an event (godparents, witnesses, the officiant…). */
    participants?: string[];
    /** Place recorded for the point, if any. */
    place?: string;
}

/** Intra-year fraction (0.02..0.98) from a flex date, so points order by month/day. */
function yearFraction(date: string | undefined): number {
    const d = parseFlexDate(date);
    if (!d) return 0.5;
    const month = d.month ?? 6;
    const day = d.day ?? 15;
    return 0.05 + ((month - 1) / 12) * 0.85 + (day / 31) * (0.85 / 12);
}

function personName(data: StromData, id: string | undefined): string | undefined {
    if (!id) return undefined;
    const p = data.persons[id as keyof typeof data.persons];
    if (!p) return undefined;
    return `${p.firstName} ${p.lastName}`.trim() || undefined;
}

/**
 * Build the chronological life timeline for one person from existing data:
 * birth, own life events (with participants), marriages (partner named), each
 * child's birth, and death. Points are sorted oldest-first, birth ahead of and
 * death behind same-year events. Pure — no DOM. The caller decides whether to
 * show the section (convention: hide when fewer than 2 points).
 */
export function computePersonLifeline(data: StromData, personId: string): LifelinePoint[] {
    const person = data.persons[personId as keyof typeof data.persons];
    if (!person || person.isPlaceholder) return [];
    const points: LifelinePoint[] = [];

    const birthY = yearOf(person.birthDate);
    if (birthY !== null) {
        points.push({ year: birthY, sortKey: birthY + 0.001, kind: 'birth', place: person.birthPlace || undefined });
    }

    for (const ev of person.events ?? []) {
        const y = yearOf(ev.date);
        if (y === null) continue;
        // Prefer the LIVE person's current name (the link is the source of
        // truth); fall back to the stored snapshot only when the link is gone
        // — same contract as the participant display elsewhere.
        const participants = (ev.participants ?? [])
            .map(part => personName(data, part.personId) ?? part.name?.trim())
            .filter((n): n is string => !!n);
        points.push({
            year: y,
            sortKey: y + yearFraction(ev.date),
            kind: 'event',
            eventType: ev.type,
            ...(ev.customLabel ? { customLabel: ev.customLabel } : {}),
            ...(participants.length ? { participants } : {}),
            ...(ev.place ? { place: ev.place } : {}),
        });
    }

    // Marriages: each partnership this person is in that has a dated start.
    for (const unionId of person.partnerships) {
        const u = data.partnerships[unionId];
        if (!u) continue;
        const y = yearOf(u.startDate);
        if (y === null) continue;
        const otherId = u.person1Id === personId ? u.person2Id : u.person1Id;
        points.push({
            year: y,
            sortKey: y + yearFraction(u.startDate),
            kind: 'marriage',
            ...(personName(data, otherId) ? { relatedName: personName(data, otherId) } : {}),
        });
    }

    // Each child's birth.
    for (const childId of person.childIds) {
        const child = data.persons[childId];
        if (!child || child.isPlaceholder) continue;
        const y = yearOf(child.birthDate);
        if (y === null) continue;
        points.push({
            year: y,
            sortKey: y + yearFraction(child.birthDate),
            kind: 'child',
            ...(personName(data, childId) ? { relatedName: personName(data, childId) } : {}),
        });
    }

    const deathY = yearOf(person.deathDate);
    if (deathY !== null) {
        points.push({ year: deathY, sortKey: deathY + 0.999, kind: 'death', place: person.deathPlace || undefined });
    }

    points.sort((a, b) => a.sortKey - b.sortKey);
    return points;
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
