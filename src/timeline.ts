/**
 * Timeline view model: people as horizontal life-bars on a year axis, with life
 * events as dots. Pure computations over StromData (no DOM, no layout pipeline);
 * `todayYear` is injected for testability. The renderer turns the model into SVG.
 *
 * Only people with a known birth year are placed; the rest are counted as
 * omitted. A living person's bar runs to `todayYear`.
 */

import { StromData, Gender, LifeEventType, CoupleEventType, PartnershipId, Partnership } from './types.js';
import { yearOf, parseFlexDate } from './dates.js';
import { eventValueIsOnTag } from './events.js';
import { isLivingPerson } from './privacy.js';
import { shownNameOrEmpty } from './person-name.js';

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
            name: shownNameOrEmpty(p),
            gender: p.gender,
            startYear,
            endYear: Math.max(endYear, startYear),
            isLiving: living,
            endKnown: living || deathYear !== null,
            events,
        });
    }

    // Ordered by the bare name: a title says nothing about who comes first.
    const bare = (id: string): string => {
        const p = data.persons[id as keyof typeof data.persons];
        return p ? `${p.firstName} ${p.lastName}`.trim() : '';
    };
    rows.sort((a, b) => a.startYear - b.startYear || bare(a.personId).localeCompare(bare(b.personId)) || a.personId.localeCompare(b.personId));

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
export type LifelineKind = 'birth' | 'death' | 'marriage' | 'divorce' | 'child' | 'event' | 'coupleEvent' | 'childEvent';

/** What a child's point on a parent's timeline records (kind === 'childEvent'). */
export type ChildLifelineEvent = 'death' | 'burial' | 'marriage' | 'divorce';

/**
 * One dated point on a person's life timeline (R2). Structured, not localized —
 * the UI composes the row text from `kind` + the resolved names, so the model
 * stays pure and translatable. Only points with a known year are produced.
 */
export interface LifelinePoint {
    /** Display year. */
    year: number;
    /**
     * Numeric sort key: year plus the fraction of it the date gives. Birth opens
     * its year; a death known only by the year closes it. Baptism never sorts
     * before birth, burial / cremation / probate never before death.
     */
    sortKey: number;
    kind: LifelineKind;
    /** Underlying life-event type (kind === 'event'). */
    eventType?: LifeEventType;
    /** A couple's event (kind === 'coupleEvent'): its type and where it lives. */
    coupleType?: CoupleEventType;
    partnershipId?: PartnershipId;
    eventId?: string;
    /** The year column's text when it is not just `year` — a range ("1890–1900"). */
    yearLabel?: string;
    /** Custom event label (eventType === 'custom'). */
    customLabel?: string;
    /**
     * The event's own subject, when its note carries it rather than describing
     * it: the trade, the denomination, the title. Each goes out as the value of
     * its own GEDCOM tag, and without it the row reads "Occupation" and leaves
     * out the only thing it was recorded for.
     */
    detail?: string;
    /**
     * Ends a relationship (kind === 'divorce', or a child's 'divorce'): true for a
     * couple that never married — the row says the relationship ended, not divorce.
     */
    unmarried?: boolean;
    /** A child's event on the parent's timeline (kind === 'childEvent'). */
    childEvent?: ChildLifelineEvent;
    /**
     * Related person's name — the partner (marriage, divorce, couple event) or
     * the child (child, childEvent).
     */
    relatedName?: string;
    /** The related person's id, while they are in the tree (T17: the name opens their card). */
    relatedId?: string;
    /** Participant names for an event (godparents, witnesses, the officiant…). */
    participants?: string[];
    /** Per participant, the id of the person in the tree, if linked (same order as `participants`). */
    participantIds?: (string | undefined)[];
    /** Place recorded for the point, if any. */
    place?: string;
    /** What the record adds: cause, age as recorded, house (this person's age at a wedding). */
    details?: { cause?: string; age?: string; address?: string };
}

/** The details worth a line, or nothing when none is filled. */
function detailsOf(d: { cause?: string; age?: string; address?: string }): { details?: LifelinePoint['details'] } {
    const out: NonNullable<LifelinePoint['details']> = {};
    if (d.cause?.trim()) out.cause = d.cause.trim();
    if (d.age?.trim()) out.age = d.age.trim();
    if (d.address?.trim()) out.address = d.address.trim();
    return Object.keys(out).length ? { details: out } : {};
}

/** Intra-year fraction (0.02..0.98) from a flex date, so points order by month/day. */
function yearFraction(date: string | undefined): number {
    const d = parseFlexDate(date);
    if (!d) return 0.5;
    const month = d.month ?? 6;
    const day = d.day ?? 15;
    return 0.05 + ((month - 1) / 12) * 0.85 + (day / 31) * (0.85 / 12);
}

/** `relatedName` and `relatedId` of a point about another person in the tree. */
function related(data: StromData, id: string | undefined): { relatedName?: string; relatedId?: string } {
    const name = personName(data, id);
    return name ? { relatedName: name, relatedId: id } : {};
}

/** Participant names and, aligned with them, the ids of those in the tree. */
function participantsOf(data: StromData, list: readonly { personId?: string; name?: string }[] | undefined):
    { participants?: string[]; participantIds?: (string | undefined)[] } {
    const named = (list ?? [])
        .map(part => {
            // Prefer the LIVE person's current name (the link is the source of
            // truth); fall back to the stored snapshot only when the link is
            // gone — same contract as the participant display elsewhere.
            const live = personName(data, part.personId);
            return { name: live ?? part.name?.trim(), id: live ? part.personId : undefined };
        })
        .filter((n): n is { name: string; id: string | undefined } => !!n.name);
    if (!named.length) return {};
    return {
        participants: named.map(n => n.name),
        ...(named.some(n => n.id) ? { participantIds: named.map(n => n.id) } : {}),
    };
}

function personName(data: StromData, id: string | undefined): string | undefined {
    if (!id) return undefined;
    const p = data.persons[id as keyof typeof data.persons];
    if (!p) return undefined;
    return shownNameOrEmpty(p) || undefined;
}

/**
 * Build the chronological life timeline for one person from existing data:
 * birth, own life events (with participants), marriages and their ends
 * (partner named), each child's birth, and death; with `childEvents`, also the
 * children's deaths, burials, marriages and divorces. Points are sorted oldest-first by date; birth
 * opens its year, baptism follows birth, burial / cremation / probate follow
 * death (see `lifelineRank`). Pure — no DOM. The caller decides whether to
 * show the section (convention: hide when fewer than 2 points).
 */
export function computePersonLifeline(
    data: StromData, personId: string, opts: { childEvents?: boolean } = {},
): LifelinePoint[] {
    const person = data.persons[personId as keyof typeof data.persons];
    if (!person || person.isPlaceholder) return [];
    const points: LifelinePoint[] = [];

    const birthY = yearOf(person.birthDate);
    if (birthY !== null) {
        points.push({ year: birthY, sortKey: birthY + 0.001, kind: 'birth', place: person.birthPlace || undefined,
            ...detailsOf({ address: person.birthAddress }) });
    }

    for (const ev of person.events ?? []) {
        const y = yearOf(ev.date);
        if (y === null) continue;
        points.push({
            year: y,
            sortKey: y + yearFraction(ev.date),
            kind: 'event',
            eventType: ev.type,
            ...(ev.customLabel ? { customLabel: ev.customLabel } : {}),
            ...(eventValueIsOnTag(ev.type) && ev.note?.trim()
                ? { detail: ev.note.trim() } : {}),
            ...participantsOf(data, ev.participants),
            ...(ev.place ? { place: ev.place } : {}),
            ...detailsOf(ev),
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
            ...related(data, otherId),
            ...(u.startPlace ? { place: u.startPlace } : {}),
            ...detailsOf({ address: u.address, age: u.ages?.[personId] }),
        });
    }

    // The couple's own events (banns, a census…), the other partner named.
    for (const unionId of person.partnerships) {
        const u = data.partnerships[unionId];
        if (!u) continue;
        const otherId = u.person1Id === personId ? u.person2Id : u.person1Id;
        for (const ev of u.events ?? []) {
            const d = parseFlexDate(ev.date);
            if (!d) continue;
            const { participants } = participantsOf(data, ev.participants);
            points.push({
                year: d.year,
                sortKey: d.year + yearFraction(ev.date),
                kind: 'coupleEvent',
                coupleType: ev.type,
                partnershipId: u.id,
                eventId: ev.id,
                ...(d.end && d.end.year !== d.year ? { yearLabel: `${d.year}–${d.end.year}` } : {}),
                ...(ev.customLabel ? { customLabel: ev.customLabel } : {}),
                ...related(data, otherId),
                ...(participants ? { participants } : {}),
                ...(ev.place ? { place: ev.place } : {}),
                ...detailsOf({ address: ev.address, age: ev.ages?.[personId] }),
            });
        }
    }

    // The end of each dated partnership: a divorce, or the end of a
    // relationship that was never a marriage.
    for (const unionId of person.partnerships) {
        const u = data.partnerships[unionId];
        if (!u) continue;
        const y = yearOf(u.endDate);
        if (y === null) continue;
        const otherId = u.person1Id === personId ? u.person2Id : u.person1Id;
        points.push({
            year: y,
            sortKey: y + yearFraction(u.endDate),
            kind: 'divorce',
            ...(isUnmarried(u.status) ? { unmarried: true } : {}),
            ...related(data, otherId),
            ...(u.endPlace ? { place: u.endPlace } : {}),
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
            ...related(data, childId),
        });
    }

    const deathY = yearOf(person.deathDate);
    if (deathY !== null) {
        // A death with a month sorts by its date; one known only by the year
        // closes that year (the person's dated events of that year came first).
        const deathKey = parseFlexDate(person.deathDate)?.month !== undefined
            ? deathY + yearFraction(person.deathDate) : deathY + 0.999;
        points.push({ year: deathY, sortKey: deathKey, kind: 'death', place: person.deathPlace || undefined,
            ...detailsOf({ cause: person.deathCause, age: person.deathAge, address: person.deathAddress }) });
    }

    // Rites that follow birth or death keep their side of it whatever the
    // dates say: a baptism never sorts ahead of the birth, a burial, cremation
    // or probate never ahead of the death — with an equal or missing day
    // (a year-only date) as much as with a slip in the record.
    const birthKey = points.find(pt => pt.kind === 'birth')?.sortKey;
    const deathKey = points.find(pt => pt.kind === 'death')?.sortKey;
    for (const pt of points) {
        if (pt.kind !== 'event') continue;
        if (pt.eventType === 'baptism' && birthKey !== undefined) pt.sortKey = Math.max(pt.sortKey, birthKey);
        if (isPosthumous(pt.eventType) && deathKey !== undefined) pt.sortKey = Math.max(pt.sortKey, deathKey);
    }

    if (opts.childEvents) points.push(...childLifelinePoints(data, person.childIds));

    points.sort((a, b) => a.sortKey - b.sortKey || lifelineRank(a) - lifelineRank(b));
    return points;
}

function isUnmarried(status: Partnership['status']): boolean {
    return status === 'partners' || status === 'separated';
}

/**
 * The children's own milestones for a parent's timeline (T15): each child's
 * death, burial, marriages and divorces. A child's birth is the parent's own
 * point ('child') and is not repeated here.
 */
function childLifelinePoints(data: StromData, childIds: readonly string[]): LifelinePoint[] {
    const out: LifelinePoint[] = [];
    for (const childId of childIds) {
        const child = data.persons[childId as keyof typeof data.persons];
        if (!child || child.isPlaceholder) continue;
        const base = (year: number, sortKey: number, childEvent: ChildLifelineEvent, place?: string): LifelinePoint => ({
            year, sortKey, kind: 'childEvent', childEvent,
            ...related(data, childId),
            ...(place ? { place } : {}),
        });
        const deathY = yearOf(child.deathDate);
        let deathKey: number | undefined;
        if (deathY !== null) {
            deathKey = parseFlexDate(child.deathDate)?.month !== undefined
                ? deathY + yearFraction(child.deathDate) : deathY + 0.999;
            out.push(base(deathY, deathKey, 'death', child.deathPlace || undefined));
        }
        for (const ev of child.events ?? []) {
            if (ev.type !== 'burial') continue;
            const y = yearOf(ev.date);
            if (y === null) continue;
            const key = y + yearFraction(ev.date);
            out.push(base(y, deathKey !== undefined ? Math.max(key, deathKey) : key, 'burial', ev.place));
        }
        for (const unionId of child.partnerships) {
            const u = data.partnerships[unionId];
            if (!u) continue;
            const wy = yearOf(u.startDate);
            if (wy !== null) out.push(base(wy, wy + yearFraction(u.startDate), 'marriage', u.startPlace));
            const dy = yearOf(u.endDate);
            if (dy !== null) {
                out.push({ ...base(dy, dy + yearFraction(u.endDate), 'divorce', u.endPlace),
                    ...(isUnmarried(u.status) ? { unmarried: true } : {}) });
            }
        }
    }
    return out;
}

/** Events recorded after a death: what happened to the body and the estate. */
function isPosthumous(type: LifeEventType | undefined): boolean {
    return type === 'burial' || type === 'cremation' || type === 'probate';
}

/**
 * Order of points that share a sort key: birth, then baptism, then the rest,
 * then death, then the burial or cremation, then the probate.
 */
function lifelineRank(pt: LifelinePoint): number {
    if (pt.kind === 'birth') return 0;
    if (pt.kind === 'death') return 8;
    if (pt.kind === 'event' && pt.eventType === 'baptism') return 1;
    if (pt.kind === 'event' && pt.eventType === 'probate') return 10;
    if (pt.kind === 'event' && isPosthumous(pt.eventType)) return 9;
    if (pt.kind === 'childEvent') return pt.childEvent === 'burial' ? 7 : 6;
    return 5;
}

/** Fraction (0..1) of a year across the axis span; clamped to the axis. */
export function yearToFraction(year: number, axis: TimelineAxis): number {
    const span = axis.maxYear - axis.minYear;
    if (span <= 0) return 0;
    return Math.max(0, Math.min(1, (year - axis.minYear) / span));
}

/** Decade tick years across the axis (inclusive of both ends). */
/** Year steps for axis labels, finest first (all multiples of the decade grid). */
const LABEL_STEPS = [10, 20, 50, 100, 200, 500, 1000];

/**
 * The finest label step whose labels stay `minPx` apart on a plot `plotW`
 * pixels wide — a narrow phone fits one label per 50 or 100 years, not per
 * decade (four-digit years ran into each other).
 */
export function axisLabelStep(axis: TimelineAxis, plotW: number, minPx = 40): number {
    const span = Math.max(1, axis.maxYear - axis.minYear);
    const pxPerYear = plotW / span;
    return LABEL_STEPS.find(step => step * pxPerYear >= minPx) ?? LABEL_STEPS[LABEL_STEPS.length - 1];
}

export function axisTicks(axis: TimelineAxis, step = 10): number[] {
    const ticks: number[] = [];
    for (let y = axis.minYear; y <= axis.maxYear; y += step) ticks.push(y);
    return ticks;
}
