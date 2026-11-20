/**
 * Timeline view model: people as horizontal life-bars on a year axis, with life
 * events as dots. Pure computations over StromData (no DOM, no layout pipeline);
 * `todayYear` is injected for testability. The renderer turns the model into SVG.
 *
 * Only people with a known birth year are placed; the rest are counted as
 * omitted. A living person's bar runs to `todayYear`.
 */

import { StromData, Gender, LifeEventType, CoupleEventType, PartnershipId, Partnership } from './types.js';
import { yearOf, parseFlexDate, yearFraction } from './dates.js';
import { eventValueIsOnTag, isPosthumousEvent } from './events.js';
import { isLivingPerson } from './privacy.js';
import { shownNameOrEmpty, shownNameFull } from './person-name.js';
import { HISTORY_KINDS, type HistoryKind, type HistoryScope } from './history.js';
import type { DerivedParticipation } from './derived-participations.js';

export interface TimelineEvent {
    year: number;
    /** Life-event type, or 'wedding' synthesized from a partnership. */
    type: LifeEventType | 'wedding';
    customLabel?: string;
    /** The share of an event of several persons (spec 085): drawn as one mark when two or more rows have it. */
    shareId?: string;
}

/**
 * One shared event across the rows of its persons (spec 085 §2e): one
 * vertical mark instead of a dot in each row, its label once above it. Only
 * for an event at least two rows have; a person without a row (not
 * selected, living under privacy) is not in it.
 */
export interface TimelineSharedMark {
    shareId: string;
    year: number;
    type: LifeEventType;
    customLabel?: string;
    /** The indices of the rows in it, top to bottom. */
    rows: number[];
}

export interface TimelineRow {
    personId: string;
    name: string;
    /** The name with the birth-surname note ("Marie Nováková (roz. Dvořáková)") for the tooltip; absent when it is `name`. */
    fullName?: string;
    gender: Gender;
    startYear: number;
    endYear: number;
    isLiving: boolean;
    /** False for a deceased person without a recorded death date. */
    endKnown: boolean;
    events: TimelineEvent[];
    /** Local history on the line (spec 121 §6), only with the option on; sorted by year. */
    local?: TimelineLocalItem[];
}

export interface TimelineAxis { minYear: number; maxYear: number; }

/**
 * One regional history event on the timeline's history row (spec 121 §0):
 * an event of a place where at least one person with a row lived in its year
 * (a period: in one of its years), not hidden for that person.
 */
export interface TimelineHistoryItem {
    /** The event's id (the card opens on its row). */
    id: string;
    /** First year (a period's start). */
    year: number;
    /** A period's last year, when it ends after `year`. */
    year2?: number;
    kind: HistoryKind;
    /** Origin: the symbol's colour. */
    scope: HistoryScope;
    /** The event's text in the UI language (the tooltip, the phone's sheet). */
    text: string;
    /** The region's name in the UI language, only when the row's events come from two regions or more. */
    region?: string;
    /** The region's id (the region filter). */
    regionId?: string;
    /** The ids of the rows it concerns, in the rows' order. */
    persons: string[];
}

/**
 * A local history event on a person's life line (spec 121 §6): the history of
 * a place or a finding from the research's records, in the place where the
 * person lived in its year. Drawn only with the option "on the life lines".
 */
export interface TimelineLocalItem {
    id: string;
    /** The year of the symbol: the start, or the first year of a period the person lived there. */
    year: number;
    /** A period's last year, when it ends after `year`. */
    year2?: number;
    kind: HistoryKind;
    scope: 'place' | 'local';
    /** The tree's spelling of the place. */
    place: string;
    text: string;
    /** A finding's citation (scope local). */
    source?: string;
    /** The person moved there during the period: the symbol is later than its start. */
    moved?: boolean;
}

/** The kinds and the region the history row is filtered by (absent: all). */
export interface TimelineHistoryFilter {
    kinds?: readonly HistoryKind[];
    region?: string;
    /** The region's name in the UI language (the row's label). */
    regionName?: string;
}

/**
 * The history row of the whole timeline (spec 121 §1): drawn while it has an
 * event of a region, or a person's line has a local one (or a filter leaves
 * nothing: the row says so).
 */
export interface TimelineHistory {
    /** Sorted by year (a period by its start); same-year order as given. The filter applied. */
    events: TimelineHistoryItem[];
    /** The focused person's life on the row (its line); absent: the focused person has no row. */
    focus?: { personId: string; startYear: number; endYear: number };
    /** How many regions the row's events come from (before the filter). */
    regions: number;
    /** How many events the row has before the filter. */
    total: number;
    /** The row's events before the filter (trimmed to the rows, sorted): the options' counts. */
    all: TimelineHistoryItem[];
    /** The local events on the lines per kind before the kind filter; only with the option on. */
    localKinds?: Partial<Record<HistoryKind, number>>;
    /** The filter in effect (nothing when it filters nothing). */
    filtered: { kinds?: HistoryKind[]; region?: string; regionName?: string };
}

export interface TimelineModel {
    axis: TimelineAxis;
    rows: TimelineRow[];
    omittedCount: number;
    /** The history row; absent: no row at all (no research, the layer off, no events). */
    history?: TimelineHistory;
    /** Shared events of two rows or more, by their first row and year. */
    shared: TimelineSharedMark[];
}

/** What the UI computed for the history row (src/ui/timeline-history-ui.ts): the model sorts it and trims it to the rows. */
export interface TimelineHistoryInput {
    /** The row's events before the filter. */
    events: readonly TimelineHistoryItem[];
    /** Local events per person id; only with the option "on the life lines" on. */
    local?: ReadonlyMap<string, readonly TimelineLocalItem[]>;
    /** The filter (an unknown region already dropped). */
    filter?: TimelineHistoryFilter;
    /** The focused person (only the line of the life on the row). */
    focusId?: string | null;
}

export interface TimelineModelOptions {
    history?: TimelineHistoryInput;
}

/** Round down / up to the enclosing decade so the axis has tidy gridlines. */
function floorDecade(year: number): number { return Math.floor(year / 10) * 10; }
function ceilDecade(year: number): number { return Math.ceil(year / 10) * 10; }

/**
 * Build the timeline model for the given (already-selected) person ids. Rows are
 * ordered by birth year, then name, then id for determinism.
 */
export function computeTimelineModel(
    data: StromData, personIds: string[], todayYear: number, opts: TimelineModelOptions = {},
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
            events.push({
                year: y, type: ev.type,
                ...(ev.customLabel ? { customLabel: ev.customLabel } : {}),
                ...(ev.shareId ? { shareId: ev.shareId } : {}),
            });
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
            ...(shownNameFull(p) !== shownNameOrEmpty(p) && shownNameOrEmpty(p) ? { fullName: shownNameFull(p) } : {}),
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

    const shared = sharedTimelineMarks(rows);

    let minYear = Infinity, maxYear = -Infinity;
    for (const r of rows) {
        minYear = Math.min(minYear, r.startYear);
        maxYear = Math.max(maxYear, r.endYear);
    }
    if (!isFinite(minYear)) { minYear = todayYear; maxYear = todayYear; }

    const history = opts.history ? timelineHistoryRow(opts.history, rows) : undefined;

    return {
        axis: { minYear: floorDecade(minYear), maxYear: ceilDecade(maxYear) },
        rows,
        omittedCount,
        ...(history ? { history } : {}),
        shared,
    };
}

/**
 * The history row from what the UI computed (spec 121 §0): only the rows that
 * are drawn count (a person without a row — no birth year, living under
 * privacy — concerns nothing), the persons in the rows' order, the region
 * named only while two regions or more are on the row, the local events put
 * on their rows (the kind filter applies to them too), then the filter.
 * Undefined when there is nothing: no event of a region and no local one.
 */
function timelineHistoryRow(h: TimelineHistoryInput, rows: TimelineRow[]): TimelineHistory | undefined {
    const index = new Map(rows.map((r, i) => [r.personId, i]));
    const trimmed: TimelineHistoryItem[] = [];
    h.events.forEach(e => {
        const persons = e.persons.filter(id => index.has(id)).sort((a, b) => index.get(a)! - index.get(b)!);
        if (persons.length) trimmed.push({ ...e, persons });
    });
    const sorted = trimmed.map((e, i) => ({ e, i })).sort((a, b) => a.e.year - b.e.year || a.i - b.i).map(x => x.e);
    const regions = new Set(sorted.map(e => e.regionId).filter((id): id is string => !!id)).size;
    if (regions < 2) for (const e of sorted) delete e.region;
    const kinds = h.filter?.kinds ? new Set(h.filter.kinds) : null;
    const kindsOn = kinds && HISTORY_KINDS.some(k => !kinds.has(k)) ? kinds : null;
    // A line's local events before the kind filter keep the row (5d): a filter leaving none says so on it.
    let anyLocal = false;
    const localKinds: Partial<Record<HistoryKind, number>> = {};
    if (h.local) {
        for (const r of rows) {
            const own = h.local.get(r.personId) ?? [];
            for (const e of own) localKinds[e.kind] = (localKinds[e.kind] ?? 0) + 1;
            if (own.length) anyLocal = true;
            const items = own.filter(e => !kindsOn || kindsOn.has(e.kind));
            if (items.length) r.local = [...items].sort((a, b) => a.year - b.year);
        }
    }
    if (!sorted.length && !anyLocal) return undefined;
    const region = h.filter?.region || undefined;
    const filter: TimelineHistoryFilter = { ...(kindsOn ? { kinds: [...kindsOn] } : {}), ...(region ? { region } : {}) };
    const focusRow = h.focusId ? rows.find(r => r.personId === h.focusId) : undefined;
    return {
        events: filterTimelineHistory(sorted, filter),
        ...(focusRow ? { focus: { personId: focusRow.personId, startYear: focusRow.startYear, endYear: focusRow.endYear } } : {}),
        regions,
        total: sorted.length,
        all: sorted,
        ...(h.local ? { localKinds } : {}),
        filtered: {
            ...(kindsOn ? { kinds: HISTORY_KINDS.filter(k => kindsOn.has(k)) } : {}),
            ...(region ? { region, ...(h.filter?.regionName ? { regionName: h.filter.regionName } : {}) } : {}),
        },
    };
}

/**
 * The history row's events with the filter applied (spec 121 §5): the kinds
 * chosen, and of a region only its events (the history of a place and a
 * finding have no region: a region filter leaves them out of the row). Pure,
 * on the finished list: no new reading of the research's events.
 */
export function filterTimelineHistory(events: readonly TimelineHistoryItem[], filter: TimelineHistoryFilter = {}): TimelineHistoryItem[] {
    const kinds = filter.kinds ? new Set(filter.kinds) : null;
    const region = filter.region;
    if (!kinds && !region) return [...events];
    return events.filter(e => (!kinds || kinds.has(e.kind)) && (!region || e.regionId === region));
}

/**
 * What the history row shows (spec 121 §5, §10): its events; a thin row with
 * the label alone (no event of a region, or the filter leaves none while a
 * line shows a local one: the option stays reachable); or the empty filter's
 * sentence with "Clear filter" (a filter leaves nothing on the row or the lines).
 */
export function timelineHistoryRowState(h: TimelineHistory, rows: readonly TimelineRow[] = []): 'events' | 'thin' | 'emptyFilter' {
    if (h.events.length) return 'events';
    const filtered = !!(h.filtered.kinds || h.filtered.region);
    const localShown = rows.some(r => (r.local?.length ?? 0) > 0);
    return filtered && !localShown ? 'emptyFilter' : 'thin';
}

/** The options' chips (spec 121 §5): a count per kind, per region. */
export interface TimelineHistoryFacets {
    /** The nine kinds in HISTORY_KINDS order: the row's events (of the region chosen) and the lines' local ones. */
    kinds: { kind: HistoryKind; count: number }[];
    /** The regions of the row's events of the kinds chosen, the most first (same count: as met). */
    regions: { id: string; count: number }[];
}

export function timelineHistoryFacets(h: TimelineHistory): TimelineHistoryFacets {
    const region = h.filtered.region;
    const kinds = h.filtered.kinds ? new Set(h.filtered.kinds) : null;
    const byKind = new Map<HistoryKind, number>();
    const byRegion = new Map<string, number>();
    for (const e of h.all) {
        if (!region || e.regionId === region) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
        if (e.regionId && (!kinds || kinds.has(e.kind))) byRegion.set(e.regionId, (byRegion.get(e.regionId) ?? 0) + 1);
    }
    return {
        kinds: HISTORY_KINDS.map(kind => ({ kind, count: (byKind.get(kind) ?? 0) + (h.localKinds?.[kind] ?? 0) })),
        regions: [...byRegion].map(([id, count], at) => ({ id, count, at }))
            .sort((a, b) => b.count - a.count || a.at - b.at).map(({ id, count }) => ({ id, count })),
    };
}

/**
 * How many of the kinds chosen the timeline has (the label "History · 3 kinds";
 * spec 121 §10: a filter of kinds the timeline does not have says "0 kinds").
 */
export function timelineFilterKindCount(h: TimelineHistory): number {
    if (!h.filtered.kinds) return 0;
    const on = new Set(timelineHistoryFacets(h).kinds.filter(k => k.count > 0).map(k => k.kind));
    return h.filtered.kinds.filter(k => on.has(k)).length;
}

/** The Timeline's history options of a tree as the options change them (settings.ts TimelineHistoryOptions). */
export interface TimelineHistoryChoice {
    kinds?: HistoryKind[];
    region?: string;
    local: boolean;
}

/**
 * A kind's chip clicked (spec 121 §5, like the history detail's facets):
 * "All" (null) drops the filter; a kind is added or removed; none left or all
 * nine chosen is no filter.
 */
export function toggleTimelineKind(kinds: readonly HistoryKind[] | undefined, kind: HistoryKind | null): HistoryKind[] | undefined {
    if (!kind) return undefined;
    const now = kinds ?? [];
    const next = now.includes(kind) ? now.filter(k => k !== kind) : [...now, kind];
    const ordered = HISTORY_KINDS.filter(k => next.includes(k));
    return ordered.length && ordered.length < HISTORY_KINDS.length ? ordered : undefined;
}

/** "Clear filter" (spec 121 §5, §10): the kinds and the region in one step; the local option stays. */
export function clearTimelineFilter(o: TimelineHistoryChoice): TimelineHistoryChoice {
    return { local: o.local };
}

/**
 * The option "Local history on the life lines" (spec 121 §5): unavailable
 * ('off') while Settings switch off both the history of places and the
 * findings; 'none' when the timeline has no local event; else 'ok'.
 */
export function timelineLocalOptionState(origins: { place: boolean; local: boolean }, anyLocal: boolean): 'off' | 'none' | 'ok' {
    if (!origins.place && !origins.local) return 'off';
    return anyLocal ? 'ok' : 'none';
}

/**
 * The shared events of the rows (only their own events, never a scan of the
 * tree): each share two rows or more have, in the year of its first row's copy.
 */
export function sharedTimelineMarks(rows: readonly TimelineRow[]): TimelineSharedMark[] {
    const byShare = new Map<string, TimelineSharedMark>();
    rows.forEach((r, i) => {
        for (const ev of r.events) {
            if (!ev.shareId || ev.type === 'wedding') continue;
            const mark = byShare.get(ev.shareId);
            if (!mark) {
                byShare.set(ev.shareId, {
                    shareId: ev.shareId, year: ev.year, type: ev.type,
                    ...(ev.customLabel ? { customLabel: ev.customLabel } : {}), rows: [i],
                });
            } else if (mark.rows[mark.rows.length - 1] !== i) {
                mark.rows.push(i);
            }
        }
    });
    return [...byShare.values()].filter(m => m.rows.length > 1)
        .sort((a, b) => a.rows[0] - b.rows[0] || a.year - b.year || a.shareId.localeCompare(b.shareId));
}

/** A cluster of history events on the timeline's history row. */
export interface TimelineHistoryCluster {
    /** Centre: the mean x of the members. */
    x: number;
    /** Members in year order; the first one's symbol stands for the cluster. */
    items: TimelineHistoryItem[];
}

/**
 * The kind that stands for a cluster (spec 121 §3): the most frequent one,
 * on a tie the one that comes first in the cluster's order. Its colour is the
 * origin of the first event of that kind.
 */
export function timelineClusterKind(items: readonly TimelineHistoryItem[]): { kind: HistoryKind; scope: HistoryScope } {
    const counts = new Map<HistoryKind, { n: number; scope: HistoryScope; at: number }>();
    items.forEach((e, at) => {
        const c = counts.get(e.kind);
        if (c) c.n++;
        else counts.set(e.kind, { n: 1, scope: e.scope, at });
    });
    let best: { kind: HistoryKind; n: number; scope: HistoryScope; at: number } | null = null;
    for (const [kind, c] of counts) {
        if (!best || c.n > best.n || (c.n === best.n && c.at < best.at)) best = { kind, ...c };
    }
    return best ? { kind: best.kind, scope: best.scope } : { kind: 'other', scope: 'region' };
}

/**
 * The kinds of a cluster in the events' order, at most three, and how many
 * more there are (the cluster's name; like the card's historyClusterKinds).
 */
export function timelineClusterKinds(items: readonly TimelineHistoryItem[], max = 3): { kinds: HistoryKind[]; more: number } {
    const all: HistoryKind[] = [];
    for (const e of items) if (!all.includes(e.kind)) all.push(e.kind);
    return { kinds: all.slice(0, max), more: Math.max(0, all.length - max) };
}

/**
 * The tracks of the history row's periods (spec 121 §4): in the order given,
 * a period goes to track 0 when the last period there ended more than 1 px
 * before it starts, else to track 1 (a third overlap goes to track 1 too).
 */
export function timelinePeriodTracks(periods: readonly { x1: number; x2: number }[]): (0 | 1)[] {
    let end0 = -Infinity;
    return periods.map(p => {
        if (end0 < p.x1 - 1) { end0 = p.x2; return 0; }
        return 1;
    });
}

/** Below this many px per year a life line shows its local history as one symbol with the count of all (spec 121 §8). */
export const LOCAL_DENSE_PX_PER_YEAR = 1.5;
/** A local symbol closer than this (px) to a dot or a shared mark on its line steps aside (spec 121 §6). */
export const LOCAL_CLEAR_PX = 10;
/** How far (px) from that dot or mark the symbol's centre goes. */
export const LOCAL_STEP_PX = 11;

/** One symbol of local history on a life line: its centre and the events it stands for (the first one's kind). */
export interface TimelineLocalMark {
    x: number;
    items: TimelineLocalItem[];
}

/** Where a line's local history goes (spec 121 §4, §6, §8). */
export interface TimelineLocalLayout {
    marks: TimelineLocalMark[];
    /** A period's stripe under the bar: from its symbol's year to its end or the bar's end. */
    periods: { item: TimelineLocalItem; x1: number; x2: number }[];
}

/**
 * The centre of a local symbol at `x` on a bar from `barX1` to `barX2`
 * (spec 121 §6): kept on the bar (never over the living's arrow or the
 * fading end); closer than 10 px to a dot or a shared mark it goes to
 * 11 px right of it, or 11 px left when the right would leave the bar (or
 * meet another dot while the left is free).
 */
export function timelineLocalX(x: number, obstacles: readonly number[], barX1: number, barX2: number): number {
    const cx = Math.min(Math.max(x, barX1), barX2);
    let near: number | null = null;
    for (const d of obstacles) {
        if (Math.abs(cx - d) < LOCAL_CLEAR_PX && (near === null || Math.abs(cx - d) < Math.abs(cx - near))) near = d;
    }
    if (near === null) return cx;
    const right = near + LOCAL_STEP_PX, left = near - LOCAL_STEP_PX;
    const free = (v: number): boolean => obstacles.every(d => Math.abs(v - d) >= LOCAL_CLEAR_PX);
    if (right <= barX2 && free(right)) return right;
    if (left >= barX1 && free(left)) return left;
    return right <= barX2 ? right : left;
}

/**
 * A life line's local history laid out (spec 121 §4, §6, §8): each symbol
 * stepped aside from the line's dots and shared marks, then grouped like the
 * history row (an event closer than `gap` px to a group's first one joins it;
 * the group's symbol is its first event's, where that one stands). Below
 * 1.5 px per year (a phone's long axis) one symbol at the first event with all
 * of them. A period also gets a stripe from its symbol's year to its end (at
 * most the bar's end). `items` sorted by year.
 */
export function layoutTimelineLocal(
    items: readonly TimelineLocalItem[],
    o: { xOf: (year: number) => number; barX1: number; barX2: number; obstacles: readonly number[]; gap: number; pxPerYear: number },
): TimelineLocalLayout {
    if (!items.length) return { marks: [], periods: [] };
    const clamp = (x: number): number => Math.min(Math.max(x, o.barX1), o.barX2);
    const periods = items.filter(e => e.year2 !== undefined).map(item => {
        const x1 = clamp(o.xOf(item.year));
        return { item, x1, x2: Math.max(x1, clamp(o.xOf(item.year2!))) };
    });
    if (o.pxPerYear < LOCAL_DENSE_PX_PER_YEAR) {
        return { marks: [{ x: timelineLocalX(o.xOf(items[0].year), o.obstacles, o.barX1, o.barX2), items: [...items] }], periods };
    }
    const placed = items.map((item, i) => ({ item, i, x: timelineLocalX(o.xOf(item.year), o.obstacles, o.barX1, o.barX2) }))
        .sort((a, b) => a.x - b.x || a.i - b.i);
    const marks: TimelineLocalMark[] = [];
    for (const p of placed) {
        const last = marks[marks.length - 1];
        if (last && p.x - last.x < o.gap) last.items.push(p.item);
        else marks.push({ x: p.x, items: [p.item] });
    }
    return { marks, periods };
}

/**
 * Whom an event of the history row names in the popover (spec 121 §2): the
 * persons in the rows' order with the focused person first, at most `max`
 * of them, and how many more there are ("and 2 more").
 */
export function timelineConcernPersons(
    persons: readonly string[], focusId?: string | null, max = 2,
): { shown: string[]; more: number } {
    const ordered = focusId && persons.includes(focusId) ? [focusId, ...persons.filter(id => id !== focusId)] : [...persons];
    return { shown: ordered.slice(0, max), more: Math.max(0, ordered.length - max) };
}

/**
 * The persons a cluster concerns (spec 121 §2, the phone's sheet): every
 * person one of its events concerns, in the rows' order (`rowOrder`; a person
 * not in it after the others, as met), the focused person first, each with
 * the first event of the cluster that concerns them (the card opens on it).
 */
export function timelineClusterPersons(
    items: readonly TimelineHistoryItem[], rowOrder: readonly string[], focusId?: string | null,
): { personId: string; eventId: string }[] {
    const first = new Map<string, string>();
    for (const e of items) for (const id of e.persons) if (!first.has(id)) first.set(id, e.id);
    const index = new Map(rowOrder.map((id, i) => [id, i]));
    const met = [...first.keys()];
    const at = (id: string): number => index.get(id) ?? rowOrder.length + met.indexOf(id);
    const ids = [...met].sort((a, b) => (a === focusId ? -1 : b === focusId ? 1 : at(a) - at(b)));
    return ids.map(personId => ({ personId, eventId: first.get(personId)! }));
}

/**
 * Where a popover of the history row goes (spec 121 §2, §5), in the window's
 * pixels: `left` = the anchor's x − 40 clipped into the window (8 px from its
 * edges), below the row (its bottom + 6 px), above the row (its top − 6 px)
 * where below has no room; where neither has room, the side with more and a
 * `maxHeight` (the popover scrolls).
 */
export function placeTimelinePop(
    anchor: { x: number; top: number; bottom: number },
    size: { width: number; height: number },
    view: { width: number; height: number; bottomInset?: number },
    margin = 8,
): { left: number; top: number; above: boolean; maxHeight: number | null } {
    const left = Math.max(margin, Math.min(anchor.x - 40, view.width - size.width - margin));
    const floor = view.height - (view.bottomInset ?? 0) - margin;
    const below = floor - (anchor.bottom + 6);
    const above = anchor.top - 6 - margin;
    if (size.height <= below) return { left, top: anchor.bottom + 6, above: false, maxHeight: null };
    if (size.height <= above) return { left, top: anchor.top - 6 - size.height, above: true, maxHeight: null };
    if (below >= above) return { left, top: anchor.bottom + 6, above: false, maxHeight: Math.max(0, below) };
    return { left, top: margin, above: true, maxHeight: Math.max(0, above) };
}

/**
 * A cluster's years: "1866", or the first year to the last (a period's end
 * counts) — "1886–1892".
 */
export function timelineHistoryYears(items: readonly { year: number; year2?: number }[]): string {
    if (!items.length) return '';
    const from = items[0].year;
    const to = Math.max(...items.map(e => e.year2 ?? e.year));
    return to > from ? `${from}–${to}` : String(from);
}

/**
 * Cluster the history row's events by pixels, not years (§9): in year order,
 * an event whose x is closer than `minGap` to the FIRST event of the current
 * cluster joins it; otherwise it starts a new one. The cluster sits at the
 * mean x of its members. 16 px on a computer, 22 px on a phone (the count
 * badges must not overlap).
 *
 * `clearance(n)`, when given, is how far the next cluster's x must be from a
 * cluster of `n` events for their marks not to touch (its count badge sticks
 * out to the right): a mean pulled towards its neighbour brings two clusters
 * closer than `minGap`, and on a dense row (the whole timeline, spec 121 §3)
 * a badge would cover the next symbol. Such neighbours merge, left to right,
 * until every pair has room.
 */
export function clusterTimelineHistory(
    events: readonly TimelineHistoryItem[], xOf: (year: number) => number, minGap: number,
    clearance?: (count: number) => number,
): TimelineHistoryCluster[] {
    const out: { x0: number; xs: number[]; items: TimelineHistoryItem[] }[] = [];
    for (const e of events) {
        const x = xOf(e.year);
        const last = out[out.length - 1];
        if (last && x - last.x0 < minGap) { last.items.push(e); last.xs.push(x); }
        else out.push({ x0: x, xs: [x], items: [e] });
    }
    const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    if (!clearance) return out.map(c => ({ x: mean(c.xs), items: c.items }));
    const merged: { xs: number[]; items: TimelineHistoryItem[]; x: number }[] = [];
    for (const c of out) {
        let cur = { xs: c.xs, items: c.items, x: mean(c.xs) };
        let prev = merged[merged.length - 1];
        while (prev && cur.x - prev.x < clearance(prev.items.length)) {
            merged.pop();
            const xs = [...prev.xs, ...cur.xs];
            cur = { xs, items: [...prev.items, ...cur.items], x: mean(xs) };
            prev = merged[merged.length - 1];
        }
        merged.push(cur);
    }
    return merged.map(c => ({ x: c.x, items: c.items }));
}

// ==================== PERSON LIFELINE (R2) ====================

/** The kinds of dated point on a single person's life timeline. */
export type LifelineKind = 'birth' | 'death' | 'marriage' | 'divorce' | 'child' | 'event' | 'coupleEvent' | 'childEvent'
    // A part at another's event (spec 085 §5): a derived row, not the person's own event.
    | 'participation';

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
    /** The couple (marriage, divorce, coupleEvent). */
    partnershipId?: PartnershipId;
    /** The event's id (a person's event, a couple's event). */
    eventId?: string;
    /** The year column's text when it is not just `year` — a range ("1890–1900"). */
    yearLabel?: string;
    /** The last year of a period (FROM … TO …) that ends after `year`. */
    endYear?: number;
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
    /** The part at another's event (kind === 'participation'). */
    participation?: DerivedParticipation;
}

/** The details worth a line, or nothing when none is filled. */
function detailsOf(d: { cause?: string; age?: string; address?: string }): { details?: LifelinePoint['details'] } {
    const out: NonNullable<LifelinePoint['details']> = {};
    if (d.cause?.trim()) out.cause = d.cause.trim();
    if (d.age?.trim()) out.age = d.age.trim();
    if (d.address?.trim()) out.address = d.address.trim();
    return Object.keys(out).length ? { details: out } : {};
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
 * children's deaths, burials, marriages and divorces. Points are sorted oldest-first by date; a birth
 * known by the year alone opens its year, baptism follows birth, burial / cremation / probate follow
 * death (see `lifelineRank`). Pure — no DOM. The caller decides whether to
 * show the section (convention: hide when fewer than 2 points).
 */
export function computePersonLifeline(
    data: StromData, personId: string,
    opts: { childEvents?: boolean; participations?: readonly DerivedParticipation[] } = {},
): LifelinePoint[] {
    const person = data.persons[personId as keyof typeof data.persons];
    if (!person || person.isPlaceholder) return [];
    const points: LifelinePoint[] = [];

    const birthY = yearOf(person.birthDate);
    if (birthY !== null) {
        // A birth with a month sorts by its date like every point (K043: a place
        // of that year before it is no longer taken as where the life began);
        // one known only by the year opens that year.
        const birthKey = parseFlexDate(person.birthDate)?.month !== undefined
            ? birthY + yearFraction(person.birthDate) : birthY + 0.001;
        points.push({ year: birthY, sortKey: birthKey, kind: 'birth', place: person.birthPlace || undefined,
            ...detailsOf({ address: person.birthAddress }) });
    }

    for (const ev of person.events ?? []) {
        const y = yearOf(ev.date);
        if (y === null) continue;
        const period = parseFlexDate(ev.date);
        const end = period?.period ? period.end?.year : undefined;
        points.push({
            year: y,
            sortKey: y + yearFraction(ev.date),
            kind: 'event',
            eventType: ev.type,
            ...(ev.id ? { eventId: ev.id } : {}),
            ...(end !== undefined && end > y ? { endYear: end } : {}),
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
            partnershipId: u.id,
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
                ...(d.period && d.end && d.end.year > d.year ? { endYear: d.end.year } : {}),
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
            partnershipId: u.id,
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
        if (isPosthumousEvent(pt.eventType) && deathKey !== undefined) pt.sortKey = Math.max(pt.sortKey, deathKey);
    }

    if (opts.childEvents) points.push(...childLifelinePoints(data, person.childIds));
    // The parts at others' events (derivedParticipations), dated ones only like every point.
    for (const part of opts.participations ?? []) {
        const y = yearOf(part.date);
        if (y === null) continue;
        points.push({
            year: y, sortKey: part.sortKey, kind: 'participation', eventId: part.eventId,
            ...(part.partnershipId ? { partnershipId: part.partnershipId } : {}),
            ...(part.place ? { place: part.place } : {}),
            participation: part,
        });
    }

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

/**
 * Order of points that share a sort key: birth, then baptism, then the rest,
 * then death, then the burial or cremation, then the probate.
 */
function lifelineRank(pt: LifelinePoint): number {
    if (pt.kind === 'birth') return 0;
    if (pt.kind === 'death') return 8;
    if (pt.kind === 'event' && pt.eventType === 'baptism') return 1;
    if (pt.kind === 'event' && pt.eventType === 'probate') return 10;
    if (pt.kind === 'event' && isPosthumousEvent(pt.eventType)) return 9;
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
