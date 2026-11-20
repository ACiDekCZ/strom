/**
 * Timeline view model (pure). Fixed injected `todayYear`.
 */

import { describe, it, expect } from 'vitest';
import {
    computeTimelineModel, yearToFraction, axisTicks, axisLabelStep, clusterTimelineHistory, timelineHistoryYears, TimelineHistoryItem,
    filterTimelineHistory, timelineClusterKind, timelineClusterKinds, timelinePeriodTracks,
    timelineConcernPersons, timelineClusterPersons, placeTimelinePop,
} from '../timeline.js';
import { setLanguage, strings } from '../strings.js';
import { HISTORY_KINDS } from '../history.js';
import { historyKindSvg } from '../history-symbols.js';
import { buildTimelineSvg, buildTimelinePosterSvg, historyRowHeight, historyClusterGap, historyClusterClearance, placeSharedLabels } from '../timeline-chart.js';
import { StromData, PersonId, PartnershipId, Person, Partnership, Gender, LifeEvent } from '../types.js';

interface POpts {
    birthDate?: string; deathDate?: string; events?: LifeEvent[]; partnerships?: string[]; isPlaceholder?: boolean;
}
function person(id: string, first: string, gender: Gender, o: POpts = {}): Person {
    return {
        id: id as PersonId, firstName: first, lastName: 'X', gender, isPlaceholder: o.isPlaceholder ?? false,
        parentIds: [], childIds: [], partnerships: (o.partnerships ?? []) as PartnershipId[],
        ...(o.birthDate ? { birthDate: o.birthDate } : {}),
        ...(o.deathDate ? { deathDate: o.deathDate } : {}),
        ...(o.events ? { events: o.events } : {}),
    };
}
function data(persons: Person[], partnerships: Partnership[] = []): StromData {
    return {
        persons: Object.fromEntries(persons.map(p => [p.id, p])) as StromData['persons'],
        partnerships: Object.fromEntries(partnerships.map(u => [u.id, u])) as StromData['partnerships'],
    };
}
const ids = (d: StromData) => Object.keys(d.persons);

const TODAY_YEAR = 2026;

describe('computeTimelineModel', () => {
    it('orders rows by birth year and rounds the axis to decades', () => {
        const a = person('a', 'Old', 'male', { birthDate: '1883', deathDate: '1947' });
        const b = person('b', 'Young', 'female', { birthDate: '1902', deathDate: '1975' });
        const d = data([b, a]);
        const model = computeTimelineModel(d, ids(d), TODAY_YEAR);
        expect(model.rows.map(r => r.personId)).toEqual(['a', 'b']);
        expect(model.axis).toEqual({ minYear: 1880, maxYear: 1980 });
    });

    it('omits persons without a birth year and counts them', () => {
        const a = person('a', 'Has', 'male', { birthDate: '1900', deathDate: '1960' });
        const b = person('b', 'None', 'male', {});
        const c = person('c', 'YearOnlyMissing', 'male', { birthDate: 'about' }); // unparseable
        const d = data([a, b, c]);
        const model = computeTimelineModel(d, ids(d), TODAY_YEAR);
        expect(model.rows).toHaveLength(1);
        expect(model.omittedCount).toBe(2);
    });

    it('runs a living person\'s bar to today', () => {
        const a = person('a', 'Alive', 'female', { birthDate: '1990' });
        const d = data([a]);
        const model = computeTimelineModel(d, ids(d), TODAY_YEAR);
        expect(model.rows[0]).toMatchObject({ startYear: 1990, endYear: TODAY_YEAR, isLiving: true });
    });

    it('collects life events and wedding dots, sorted by year', () => {
        const ev: LifeEvent = { id: 'e1', type: 'occupation', date: '1925' };
        const a = person('a', 'A', 'male', { birthDate: '1900', deathDate: '1970', events: [ev], partnerships: ['u1'] });
        const b = person('b', 'B', 'female', { birthDate: '1905', deathDate: '1980', partnerships: ['u1'] });
        const u1: Partnership = {
            id: 'u1' as PartnershipId, person1Id: 'a' as PersonId, person2Id: 'b' as PersonId,
            childIds: [], status: 'married', startDate: '1923',
        };
        const d = data([a, b], [u1]);
        const model = computeTimelineModel(d, ids(d), TODAY_YEAR);
        const rowA = model.rows.find(r => r.personId === 'a')!;
        expect(rowA.events.map(e => `${e.type}:${e.year}`)).toEqual(['wedding:1923', 'occupation:1925']);
    });

    it('ignores placeholders', () => {
        const a = person('a', 'Real', 'male', { birthDate: '1900' });
        const ph = person('ph', 'Ghost', 'male', { birthDate: '1900', isPlaceholder: true });
        const d = data([a, ph]);
        expect(computeTimelineModel(d, ids(d), TODAY_YEAR).rows).toHaveLength(1);
    });
});

describe('yearToFraction / axisTicks', () => {
    const axis = { minYear: 1900, maxYear: 2000 };
    it('maps years to a 0..1 fraction, clamped', () => {
        expect(yearToFraction(1900, axis)).toBe(0);
        expect(yearToFraction(1950, axis)).toBeCloseTo(0.5, 6);
        expect(yearToFraction(2000, axis)).toBe(1);
        expect(yearToFraction(1850, axis)).toBe(0);   // clamped low
        expect(yearToFraction(2100, axis)).toBe(1);   // clamped high
    });
    it('returns 0 for a zero-span axis', () => {
        expect(yearToFraction(1900, { minYear: 1900, maxYear: 1900 })).toBe(0);
    });
    it('lists decade ticks inclusive of both ends', () => {
        expect(axisTicks(axis)).toEqual([1900, 1910, 1920, 1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000]);
    });
});

it('a deceased person without a death date gets a stub, not a bar to today', () => {
    const d = data([person('p1', 'Biagota', 'female', { birthDate: '920' })]);
    const model = computeTimelineModel(d, ['p1'], TODAY_YEAR);
    expect(model.rows).toHaveLength(1);
    expect(model.rows[0].isLiving).toBe(false);
    expect(model.rows[0].endKnown).toBe(false);
    expect(model.rows[0].endYear).toBe(920); // stub at birth year, no invented span
});

it('an unknown-death bar extends to the last known event (wedding)', () => {
    const a = person('a', 'Boleslav', 'male', { birthDate: '915', partnerships: ['u1'] });
    const b = person('b', 'Biagota', 'female', { birthDate: '920', partnerships: ['u1'] });
    const u1: Partnership = {
        id: 'u1' as PartnershipId, person1Id: 'a' as PersonId, person2Id: 'b' as PersonId,
        childIds: [], status: 'married', startDate: '945',
    };
    const d = data([a, b], [u1]);
    const model = computeTimelineModel(d, ids(d), TODAY_YEAR);
    const rowB = model.rows.find(r => r.personId === 'b')!;
    expect(rowB.endKnown).toBe(false);
    expect(rowB.endYear).toBe(945); // wedding is the last trace of her life
});

// ==================== computePersonLifeline (R2) ====================

import { computePersonLifeline } from '../timeline.js';

/** Full person builder covering the fields the lifeline reads. */
function lp(id: string, first: string, gender: Gender, o: {
    birthDate?: string; birthPlace?: string; deathDate?: string; deathPlace?: string;
    events?: LifeEvent[]; partnerships?: string[]; childIds?: string[]; photo?: string; isPlaceholder?: boolean;
} = {}): Person {
    return {
        id: id as PersonId, firstName: first, lastName: 'Novák', gender, isPlaceholder: o.isPlaceholder ?? false,
        parentIds: [], childIds: (o.childIds ?? []) as PersonId[], partnerships: (o.partnerships ?? []) as PartnershipId[],
        ...(o.birthDate ? { birthDate: o.birthDate } : {}),
        ...(o.birthPlace ? { birthPlace: o.birthPlace } : {}),
        ...(o.deathDate ? { deathDate: o.deathDate } : {}),
        ...(o.deathPlace ? { deathPlace: o.deathPlace } : {}),
        ...(o.events ? { events: o.events } : {}),
        ...(o.photo ? { photo: o.photo } : {}),
    };
}

describe('computePersonLifeline', () => {
    it('orders birth first, death last, events chronologically between', () => {
        const child = lp('c', 'Josef', 'male', { birthDate: '1905' });
        const p = lp('p', 'Jan', 'male', {
            birthDate: '1880', birthPlace: 'Děčín', deathDate: '1950',
            partnerships: ['u1'], childIds: ['c'],
            events: [{ id: 'e1', type: 'baptism', date: '1880-03-05' } as LifeEvent],
        });
        const spouse = lp('s', 'Marie', 'female', { birthDate: '1884' });
        const u1: Partnership = {
            id: 'u1' as PartnershipId, person1Id: 'p' as PersonId, person2Id: 's' as PersonId,
            childIds: ['c'] as PersonId[], status: 'married', startDate: '1903',
        };
        const d = data([p, spouse, child], [u1]);
        const pts = computePersonLifeline(d, 'p');
        expect(pts.map(x => x.kind)).toEqual(['birth', 'event', 'marriage', 'child', 'death']);
        expect(pts[0].year).toBe(1880);
        expect(pts[pts.length - 1].year).toBe(1950);
        // Marriage names the other partner; child names the child.
        expect(pts.find(x => x.kind === 'marriage')!.relatedName).toBe('Marie Novák');
        expect(pts.find(x => x.kind === 'child')!.relatedName).toBe('Josef Novák');
    });

    it('carries the trade of an occupation, which lives in its note', () => {
        // The note IS the occupation — it goes out as the GEDCOM OCCU value —
        // so a row without it says "Occupation" and omits the one thing the
        // entry was recorded for.
        const p = lp('p', 'Frantisek', 'male', {
            birthDate: '1863', deathDate: '1932',
            events: [
                { id: 'e1', type: 'occupation', date: '1890', note: 'mistr obuvnický', place: 'Lučice' } as LifeEvent,
                { id: 'e2', type: 'residence', date: '1895', note: 'a plain note' } as LifeEvent,
            ],
        });
        const pts = computePersonLifeline(data([p]), 'p');
        const trade = pts.find(x => x.eventType === 'occupation')!;
        expect(trade.detail).toBe('mistr obuvnický');
        expect(trade.place).toBe('Lučice');
        // Other events keep their note as a note — it describes them, it is not
        // what they are.
        expect(pts.find(x => x.eventType === 'residence')!.detail).toBeUndefined();
    });

    it('prefers the LIVE linked participant name over the stored snapshot', () => {
        // Godparent is linked (personId 'g') AND renamed in the tree; the event
        // still carries an out-of-date snapshot name. The lifeline must show the
        // live person's current name, not the stale snapshot.
        const godmother = lp('g', 'Eva', 'female');
        const p = lp('p', 'Anna', 'female', {
            birthDate: '1870', deathDate: '1930',
            events: [{ id: 'e1', type: 'baptism', date: '1870',
                participants: [{ id: 'x', role: 'godparent', personId: 'g' as PersonId, name: 'Old Snapshot' }] } as LifeEvent],
        });
        const pts = computePersonLifeline(data([p, godmother]), 'p');
        expect(pts.find(x => x.kind === 'event')!.participants).toEqual(['Eva Novák']);
    });

    it('falls back to the snapshot name when the linked participant is gone', () => {
        // personId points at a person no longer in the tree → use the snapshot.
        const p = lp('p', 'Anna', 'female', {
            birthDate: '1870', deathDate: '1930',
            events: [{ id: 'e1', type: 'baptism', date: '1870',
                participants: [{ id: 'x', role: 'godparent', personId: 'gone' as PersonId, name: 'Eva Kmotra' }] } as LifeEvent],
        });
        const pts = computePersonLifeline(data([p]), 'p');
        expect(pts.find(x => x.kind === 'event')!.participants).toEqual(['Eva Kmotra']);
    });

    it('carries event participants and places', () => {
        const p = lp('p', 'Anna', 'female', {
            birthDate: '1870', deathDate: '1930',
            events: [{ id: 'e1', type: 'baptism', date: '1870', place: 'Praha',
                participants: [{ id: 'g1', role: 'godparent', name: 'Eva Kmotra' }] } as LifeEvent],
        });
        const d = data([p]);
        const pts = computePersonLifeline(d, 'p');
        const ev = pts.find(x => x.kind === 'event')!;
        expect(ev.participants).toEqual(['Eva Kmotra']);
        expect(ev.place).toBe('Praha');
    });

    // T16: a burial in the year of death sorted ahead of the death, whose key
    // was pinned to the end of the year whatever its day.
    it('puts burial, cremation and probate after the death, also in the same year', () => {
        const p = lp('p', 'Antonín', 'male', {
            birthDate: '1868', deathDate: '1941-03-10',
            events: [
                { id: 'b', type: 'burial', date: '1941-03-13', place: 'Kozmice' } as LifeEvent,
                { id: 'c', type: 'cremation', date: '1941-03-12' } as LifeEvent,
                { id: 'r', type: 'residence', date: '1941-06' } as LifeEvent,
            ],
        });
        const pts = computePersonLifeline(data([p]), 'p');
        // The death sorts by its day: a residence later that year follows it.
        expect(pts.map(x => x.eventType ?? x.kind)).toEqual(['birth', 'death', 'cremation', 'burial', 'residence']);
    });

    it('keeps posthumous events after a death with an equal or missing day', () => {
        const yearOnly = lp('p', 'Jan', 'male', {
            birthDate: '1868', deathDate: '1941',
            events: [
                { id: 'pr', type: 'probate', date: '1941' } as LifeEvent,
                { id: 'b', type: 'burial', date: '1941-02-01' } as LifeEvent,
                { id: 'o', type: 'occupation', date: '1941-05' } as LifeEvent,
            ],
        });
        expect(computePersonLifeline(data([yearOnly]), 'p').map(x => x.eventType ?? x.kind))
            .toEqual(['birth', 'occupation', 'death', 'burial', 'probate']);
        // Same day, and a burial recorded a day early: still after the death.
        const sameDay = lp('p', 'Jan', 'male', {
            birthDate: '1868', deathDate: '1941-03-10',
            events: [
                { id: 'b', type: 'burial', date: '1941-03-10' } as LifeEvent,
                { id: 'pr', type: 'probate', date: '1941-03-09' } as LifeEvent,
            ],
        });
        expect(computePersonLifeline(data([sameDay]), 'p').map(x => x.eventType ?? x.kind))
            .toEqual(['birth', 'death', 'burial', 'probate']);
    });

    it('puts baptism after birth, also with an equal or missing day', () => {
        const p = lp('p', 'Anna', 'female', {
            birthDate: '1868-05-04', deathDate: '1930',
            events: [
                { id: 'bp', type: 'baptism', date: '1867' } as LifeEvent,
                { id: 'r', type: 'residence', date: '1868' } as LifeEvent,
            ],
        });
        expect(computePersonLifeline(data([p]), 'p').map(x => x.eventType ?? x.kind))
            .toEqual(['birth', 'baptism', 'residence', 'death']);
        const same = lp('q', 'Eva', 'female', {
            birthDate: '1868', deathDate: '1930',
            events: [{ id: 'bp', type: 'baptism', date: '1868' } as LifeEvent],
        });
        expect(computePersonLifeline(data([same]), 'q').map(x => x.eventType ?? x.kind))
            .toEqual(['birth', 'baptism', 'death']);
    });

    // T15: a divorce (the end of a partnership) was missing from the timeline.
    it('shows a divorce and the end of an unmarried relationship as own points', () => {
        const p = lp('p', 'Jan', 'male', { birthDate: '1841', deathDate: '1922', partnerships: ['u1', 'u2'] });
        const anna = lp('a', 'Anna', 'female');
        const eva = lp('e', 'Eva', 'female');
        const u1: Partnership = {
            id: 'u1' as PartnershipId, person1Id: 'p' as PersonId, person2Id: 'a' as PersonId,
            childIds: [], status: 'divorced', startDate: '1866', endDate: '1898-04-02', endPlace: 'Brno',
        };
        const u2: Partnership = {
            id: 'u2' as PartnershipId, person1Id: 'p' as PersonId, person2Id: 'e' as PersonId,
            childIds: [], status: 'separated', startDate: '1900', endDate: '1905',
        };
        const pts = computePersonLifeline(data([p, anna, eva], [u1, u2]), 'p');
        expect(pts.map(x => x.kind)).toEqual(['birth', 'marriage', 'divorce', 'marriage', 'divorce', 'death']);
        const [divorce, ended] = pts.filter(x => x.kind === 'divorce');
        expect(divorce).toMatchObject({ year: 1898, relatedName: 'Anna Novák', place: 'Brno' });
        expect(divorce.unmarried).toBeUndefined();
        expect(ended).toMatchObject({ year: 1905, relatedName: 'Eva Novák', unmarried: true });
    });

    // T15: the children's deaths, burials, marriages and divorces, on request.
    it("lists the children's events only when asked, the child named", () => {
        const marie = lp('m', 'Marie', 'female', { birthDate: '1867', partnerships: ['um'] });
        const vaclav = lp('v', 'Václav', 'male', {
            birthDate: '1870', deathDate: '1894', deathPlace: 'Bystřice',
            events: [{ id: 'b', type: 'burial', date: '1894-02-01', place: 'Bystřice' } as LifeEvent],
        });
        const groom = lp('g', 'Karel', 'male');
        const um: Partnership = {
            id: 'um' as PartnershipId, person1Id: 'g' as PersonId, person2Id: 'm' as PersonId,
            childIds: [], status: 'divorced', startDate: '1889', startPlace: 'Praha', endDate: '1912',
        };
        const p = lp('p', 'Jan', 'male', { birthDate: '1841', deathDate: '1922', childIds: ['m', 'v'] });
        const d = data([p, marie, vaclav, groom], [um]);

        expect(computePersonLifeline(d, 'p').some(x => x.kind === 'childEvent')).toBe(false);
        const pts = computePersonLifeline(d, 'p', { childEvents: true });
        const child = pts.filter(x => x.kind === 'childEvent')
            .map(x => [x.year, x.relatedName, x.childEvent, x.place ?? '']);
        expect(child).toEqual([
            [1889, 'Marie Novák', 'marriage', 'Praha'],
            [1894, 'Václav Novák', 'death', 'Bystřice'],
            [1894, 'Václav Novák', 'burial', 'Bystřice'],
            [1912, 'Marie Novák', 'divorce', ''],
        ]);
        // A child's birth stays the parent's own point, not repeated.
        expect(pts.filter(x => x.kind === 'child')).toHaveLength(2);
        expect(pts[pts.length - 1].kind).toBe('death');
    });

    // T17: the names in the timeline open the person's card, so a point
    // carries the id of whom it names — only while they are in the tree.
    it('carries the ids of the people it names', () => {
        const child = lp('c', 'Josef', 'male', { birthDate: '1905', deathDate: '1960' });
        const godmother = lp('g', 'Eva', 'female');
        const p = lp('p', 'Jan', 'male', {
            birthDate: '1880', deathDate: '1950', partnerships: ['u1'], childIds: ['c'],
            events: [{ id: 'e1', type: 'baptism', date: '1880', participants: [
                { id: 'x', role: 'godparent', name: 'Karel Kmotr' },
                { id: 'y', role: 'godparent', personId: 'g' as PersonId },
            ] } as LifeEvent],
        });
        const spouse = lp('s', 'Marie', 'female');
        const u1: Partnership = {
            id: 'u1' as PartnershipId, person1Id: 'p' as PersonId, person2Id: 's' as PersonId,
            childIds: ['c'] as PersonId[], status: 'divorced', startDate: '1903', endDate: '1920',
        };
        const pts = computePersonLifeline(data([p, spouse, child, godmother], [u1]), 'p', { childEvents: true });
        expect(pts.find(x => x.kind === 'marriage')!.relatedId).toBe('s');
        expect(pts.find(x => x.kind === 'divorce')!.relatedId).toBe('s');
        expect(pts.find(x => x.kind === 'child')!.relatedId).toBe('c');
        expect(pts.find(x => x.kind === 'childEvent')!.relatedId).toBe('c');
        const baptism = pts.find(x => x.eventType === 'baptism')!;
        expect(baptism.participants).toEqual(['Karel Kmotr', 'Eva Novák']);
        expect(baptism.participantIds).toEqual([undefined, 'g']);
    });

    it('returns empty for placeholders and skips undated points', () => {
        const p = lp('p', 'Ghost', 'male', { isPlaceholder: true });
        expect(computePersonLifeline(data([p]), 'p')).toEqual([]);
        // Only a birth date → a single point (caller hides the section under 2).
        const solo = lp('q', 'Solo', 'male', { birthDate: '1900' });
        expect(computePersonLifeline(data([solo]), 'q')).toHaveLength(1);
    });
});

describe('axis labels fit the width', () => {
    const axis = { minYear: 860, maxYear: 1340 };
    it('a phone gets a coarser label step than a desktop', () => {
        expect(axisLabelStep(axis, 5000)).toBe(10);
        expect(axisLabelStep(axis, 700)).toBe(50);
        expect(axisLabelStep(axis, 250)).toBe(100);
    });

    it('labels sit on round years and never closer than 40 px', () => {
        const model = { axis, rows: [] } as unknown as Parameters<typeof buildTimelineSvg>[0];
        const svg = buildTimelineSvg(model, { width: 460, rowH: 30, labelW: 190, mode: 'screen' } as Parameters<typeof buildTimelineSvg>[1]);
        const labels = [...svg.matchAll(/<text x="([\d.]+)"[^>]*class="tl-tick">(\d+)</g)].map(m => ({ x: +m[1], year: +m[2] }));
        expect(labels.length).toBeGreaterThan(2);
        expect(labels.every(l => l.year % 50 === 0 || l.year % 100 === 0)).toBe(true);
        for (let i = 1; i < labels.length; i++) expect(labels[i].x - labels[i - 1].x).toBeGreaterThanOrEqual(40);
    });
});

// ==================== HISTORY ROW (spec 121, after DEV symboly-dejin §9) ====================

describe('timeline history row', () => {
    const ev = (id: string, year: number, o: Partial<TimelineHistoryItem> = {}): TimelineHistoryItem =>
        ({ id, year, kind: 'war', scope: 'region', text: `Event ${id}.`, persons: ['jan'], ...o });
    const fam = () => data([
        person('jan', 'Jan', 'male', { birthDate: '1860', deathDate: '1910' }),
        person('anna', 'Anna', 'female', { birthDate: '1862', deathDate: '1930' }),
        person('nob', 'Nobirth', 'male'),
    ]);
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const svgOf = (model: ReturnType<typeof computeTimelineModel>, narrow = false) =>
        buildTimelineSvg(model, { esc, width: 1440, rowH: 30, labelW: 160, mode: 'screen', narrow });

    it('carries the events of the whole timeline sorted by year, the persons in the rows\' order, the focus only as its life', () => {
        const d = fam();
        const m = computeTimelineModel(d, ids(d), TODAY_YEAR, {
            history: { events: [ev('b', 1880, { persons: ['anna', 'jan'] }), ev('a', 1866), ev('c', 1866, { kind: 'epidemic', persons: ['anna'] })], focusId: 'anna' },
        });
        // By year; the same year keeps the given order.
        expect(m.history?.events.map(e => e.id)).toEqual(['a', 'c', 'b']);
        // Jan (1860) has the first row, Anna the second.
        expect(m.history?.events[2].persons).toEqual(['jan', 'anna']);
        expect(m.history?.focus).toEqual({ personId: 'anna', startYear: 1862, endYear: 1930 });
        expect(m.history?.total).toBe(3);
        expect(m.history?.filtered).toEqual({});
        // Another focus: the same events, only the line moves.
        const m2 = computeTimelineModel(d, ids(d), TODAY_YEAR, {
            history: { events: [ev('b', 1880, { persons: ['anna', 'jan'] }), ev('a', 1866), ev('c', 1866, { kind: 'epidemic', persons: ['anna'] })], focusId: 'jan' },
        });
        expect(m2.history?.events).toEqual(m.history?.events);
        expect(m2.history?.focus?.personId).toBe('jan');
    });

    it('is absent without events or when no person of the events has a row (privacy: no row, nothing)', () => {
        const d = fam();
        expect(computeTimelineModel(d, ids(d), TODAY_YEAR).history).toBeUndefined();
        expect(computeTimelineModel(d, ids(d), TODAY_YEAR, { history: { events: [] } }).history).toBeUndefined();
        expect(computeTimelineModel(d, ids(d), TODAY_YEAR, { history: { events: [ev('a', 1866, { persons: ['nob'] })] } }).history).toBeUndefined();
        const onlyAnna = computeTimelineModel(d, ['anna'], TODAY_YEAR, { history: { events: [ev('a', 1866), ev('b', 1870, { persons: ['jan', 'anna'] })] } });
        expect(onlyAnna.history?.events.map(e => [e.id, e.persons])).toEqual([['b', ['anna']]]);
        // A focus without a row: no line.
        expect(computeTimelineModel(d, ids(d), TODAY_YEAR, { history: { events: [ev('a', 1866)], focusId: 'nob' } }).history?.focus).toBeUndefined();
    });

    it('names the region only while the row has two regions or more', () => {
        const d = fam();
        const one = computeTimelineModel(d, ids(d), TODAY_YEAR, { history: { events: [
            ev('a', 1866, { regionId: 'r1', region: 'Valdorie' }), ev('b', 1870, { regionId: 'r1', region: 'Valdorie' }),
        ] } });
        expect(one.history?.regions).toBe(1);
        expect(one.history?.events.every(e => e.region === undefined)).toBe(true);
        const two = computeTimelineModel(d, ids(d), TODAY_YEAR, { history: { events: [
            ev('a', 1866, { regionId: 'r1', region: 'Valdorie' }), ev('b', 1870, { regionId: 'r2', region: 'Quellnitz' }),
        ] } });
        expect(two.history?.regions).toBe(2);
        expect(two.history?.events.map(e => e.region)).toEqual(['Valdorie', 'Quellnitz']);
        expect(svgOf(two)).toContain('<title>1866 · war · Valdorie – Event a.</title>');
        expect(svgOf(one)).toContain('<title>1866 · war – Event a.</title>');
        // Trimmed to one region by the rows: no name.
        const trimmed = computeTimelineModel(d, ['anna'], TODAY_YEAR, { history: { events: [
            ev('a', 1866, { regionId: 'r1', region: 'Valdorie', persons: ['anna'] }), ev('b', 1870, { regionId: 'r2', region: 'Quellnitz' }),
        ] } });
        expect(trimmed.history?.events.map(e => e.region)).toEqual([undefined]);
    });

    it('filters by kinds and region on the finished list; a filter of nothing keeps the row', () => {
        const d = fam();
        const events = [
            ev('a', 1866, { regionId: 'r1' }), ev('b', 1870, { kind: 'census', regionId: 'r2' }), ev('c', 1880, { kind: 'epidemic', regionId: 'r1' }),
        ];
        expect(filterTimelineHistory(events, { kinds: ['war', 'epidemic'] }).map(e => e.id)).toEqual(['a', 'c']);
        expect(filterTimelineHistory(events, { region: 'r2' }).map(e => e.id)).toEqual(['b']);
        expect(filterTimelineHistory(events, { kinds: ['war'], region: 'r1' }).map(e => e.id)).toEqual(['a']);
        expect(filterTimelineHistory(events).map(e => e.id)).toEqual(['a', 'b', 'c']);
        const m = computeTimelineModel(d, ids(d), TODAY_YEAR, { history: { events, filter: { kinds: ['census', 'war', 'law'] } } });
        expect(m.history?.events.map(e => e.id)).toEqual(['a', 'b']);
        expect(m.history?.filtered).toEqual({ kinds: ['war', 'census', 'law'] });
        expect(svgOf(m)).toContain('class="tl-hist-btn is-filtered"');
        // The label counts the kinds chosen the timeline has (law has no event here: §10's "0 kinds" when none).
        expect(svgOf(m)).toContain('<span class="tl-hist-meta">· 2 kinds</span>');
        // All nine kinds: no filter.
        const all = computeTimelineModel(d, ids(d), TODAY_YEAR, { history: { events, filter: { kinds: [...HISTORY_KINDS] } } });
        expect(all.history?.filtered).toEqual({});
        expect(svgOf(all)).not.toContain('is-filtered');
        // A region: its name in the label; both: "2 filters".
        const reg = computeTimelineModel(d, ids(d), TODAY_YEAR, { history: { events, filter: { region: 'r2', regionName: 'Valdorie' } } });
        expect(svgOf(reg)).toContain('<span class="tl-hist-meta">· Valdorie</span>');
        const both = computeTimelineModel(d, ids(d), TODAY_YEAR, { history: { events, filter: { region: 'r2', regionName: 'Valdorie', kinds: ['law'] } } });
        expect(both.history?.events).toEqual([]);
        expect(both.history?.total).toBe(3);
        expect(svgOf(both)).toContain('<span class="tl-hist-meta">· 2 filters</span>');
        expect(svgOf(both)).toContain('class="tl-hist-row"');
    });

    it('puts the local events on their rows only with the option, filtered by kind too', () => {
        const d = fam();
        const local = new Map([['anna', [
            { id: 'L2', year: 1891, kind: 'disaster' as const, scope: 'local' as const, place: 'Quellnitz', text: 'Fire.' },
            { id: 'L1', year: 1880, kind: 'epidemic' as const, scope: 'place' as const, place: 'Quellnitz', text: 'Cholera.' },
        ]], ['nob', [{ id: 'L3', year: 1880, kind: 'war' as const, scope: 'place' as const, place: 'X', text: 'War.' }]]]);
        const m = computeTimelineModel(d, ids(d), TODAY_YEAR, { history: { events: [], local } });
        // Only local: the row stays (its label), the line has them by year.
        expect(m.history?.events).toEqual([]);
        expect(m.rows.find(r => r.personId === 'anna')?.local?.map(e => e.id)).toEqual(['L1', 'L2']);
        expect(m.rows.find(r => r.personId === 'jan')?.local).toBeUndefined();
        const f = computeTimelineModel(d, ids(d), TODAY_YEAR, { history: { events: [], local, filter: { kinds: ['disaster'] } } });
        expect(f.rows.find(r => r.personId === 'anna')?.local?.map(e => e.id)).toEqual(['L2']);
        // A kind no line has: the row stays (§10, its filter can be cleared there), no line keeps one.
        const none = computeTimelineModel(d, ids(d), TODAY_YEAR, { history: { events: [], local, filter: { kinds: ['law'] } } });
        expect(none.history?.events).toEqual([]);
        expect(none.rows.every(r => !r.local)).toBe(true);
        expect(svgOf(none)).toContain('class="link-button tl-hist-clear"');
    });

    it('a cluster stands for the kind most of its events have (a tie: the earlier); its name has up to three kinds and +n', () => {
        expect(timelineClusterKind([ev('a', 1880, { kind: 'census' }), ev('b', 1881, { kind: 'emigration', scope: 'place' }), ev('c', 1882, { kind: 'emigration' })]))
            .toEqual({ kind: 'emigration', scope: 'place' });
        expect(timelineClusterKind([ev('a', 1880, { kind: 'census' }), ev('b', 1881, { kind: 'emigration' })])).toEqual({ kind: 'census', scope: 'region' });
        expect(timelineClusterKinds([ev('a', 1, { kind: 'census' }), ev('b', 1, { kind: 'war' }), ev('c', 1, { kind: 'law' }), ev('d', 1, { kind: 'state' }), ev('e', 1, { kind: 'war' })]))
            .toEqual({ kinds: ['census', 'war', 'law'], more: 1 });
        const d = fam();
        const svg = svgOf(computeTimelineModel(d, ids(d), TODAY_YEAR, { history: { events: [
            ev('a', 1880, { kind: 'census', persons: ['jan'] }), ev('b', 1880, { kind: 'emigration', persons: ['anna'] }),
            ev('c', 1880, { kind: 'emigration', persons: ['jan', 'anna'] }),
        ] } }));
        expect(svg).toContain('aria-label="1880: census, emigration; concerns 2 people"');
        // The symbol is emigration's (the majority), one symbol per cluster.
        expect((svg.match(/class="hist-kind-svg"/g) ?? []).length).toBe(1);
        const pathOf = (k: 'emigration' | 'census') => /<path d="([^"]+)"/.exec(historyKindSvg(k, 12))![1];
        expect(svg).toContain(pathOf('emigration'));
        expect(svg).not.toContain(pathOf('census'));
    });

    it('periods in two tracks: the second when the first one has not ended 1 px before it starts', () => {
        expect(timelinePeriodTracks([{ x1: 0, x2: 50 }, { x1: 40, x2: 60 }, { x1: 55, x2: 70 }, { x1: 80, x2: 90 }])).toEqual([0, 1, 0, 0]);
        expect(timelinePeriodTracks([{ x1: 0, x2: 50 }, { x1: 40, x2: 60 }, { x1: 45, x2: 70 }])).toEqual([0, 1, 1]);
        expect(timelinePeriodTracks([{ x1: 0, x2: 50 }, { x1: 51.5, x2: 60 }])).toEqual([0, 0]);
        expect(timelinePeriodTracks([{ x1: 0, x2: 50 }, { x1: 50.5, x2: 60 }])).toEqual([0, 1]);
        const d = fam();
        const svg = svgOf(computeTimelineModel(d, ids(d), TODAY_YEAR, { history: { events: [
            ev('a', 1866, { year2: 1880 }), ev('b', 1870, { year2: 1875, scope: 'place' }), ev('c', 1890, { year2: 1895 }),
        ] } }));
        const ys = [...svg.matchAll(/class="tl-hist-period[^"]*" x="[\d.]+" y="([\d.]+)"[^>]*height="2.5" rx="1.25"/g)].map(m => Number(m[1]));
        // cy = 40 + 28 / 2 = 54: track 0 at 61, track 1 at 64.5.
        expect(ys).toEqual([61, 64.5, 61]);
    });

    it("clusters by pixels: closer than the gap to the cluster's FIRST event (16 px; a phone 22 px)", () => {
        expect(historyClusterGap(false)).toBe(16);
        expect(historyClusterGap(true)).toBe(22);
        const xOf = (y: number) => (y - 1860) * 9; // 9 px a year (a computer, 140 years)
        const evs = [ev('a', 1866), ev('b', 1866), ev('c', 1867), ev('d', 1869), ev('e', 1873)];
        // 1866, 1866, 1867 (9 px) together; 1869 is 27 px from 1866: its own; 1873 its own.
        const c16 = clusterTimelineHistory(evs, xOf, 16);
        expect(c16.map(c => c.items.map(e => e.id))).toEqual([['a', 'b', 'c'], ['d'], ['e']]);
        // The cluster sits at the mean x of its members.
        expect(c16[0].x).toBeCloseTo((54 + 54 + 63) / 3);
        // 2 px a year (a phone): 22 px ≈ 11 years.
        const phone = (y: number) => (y - 1860) * 2;
        const c22 = clusterTimelineHistory([ev('a', 1866), ev('b', 1873), ev('c', 1876), ev('d', 1877), ev('e', 1887)], phone, 22);
        expect(c22.map(c => c.items.map(e => e.id))).toEqual([['a', 'b', 'c'], ['d', 'e']]);
        // The same years with the computer's gap: more clusters.
        expect(clusterTimelineHistory([ev('a', 1866), ev('b', 1873), ev('c', 1876)], phone, 16).length).toBe(2);
    });

    it('a dense row (the whole timeline): a cluster pulled towards its neighbour merges with it, no badge over the next symbol', () => {
        // An event a year at 6 px a year (1440 px, ~210 years): with the gap alone the means come 12–18 px apart
        // and a badge (3 px right of the centre, 13 px wide) covers the next 12 px symbol.
        const xOf = (y: number) => (y - 1830) * 6;
        const evs = Array.from({ length: 80 }, (_, i) => ev(`e${i}`, 1832 + i));
        const plain = clusterTimelineHistory(evs, xOf, 16);
        const tight = (cs: { x: number; items: unknown[] }[]) => cs.slice(1).some((c, i) => c.x - cs[i].x < historyClusterClearance(cs[i].items.length));
        expect(tight(plain)).toBe(true);
        for (const gap of [16, 22]) {
            const cs = clusterTimelineHistory(evs, xOf, gap, historyClusterClearance);
            expect(tight(cs)).toBe(false);
            // Every event stays, in order; the drawn boxes (symbol x ± 6, badge x + 3 … x + 3 + width) do not touch.
            expect(cs.flatMap(c => c.items.map(e => e.id))).toEqual(evs.map(e => e.id));
            for (let i = 1; i < cs.length; i++) {
                const badgeRight = cs[i - 1].items.length > 1 ? cs[i - 1].x + historyClusterClearance(cs[i - 1].items.length) - 7 : cs[i - 1].x + 6;
                expect(badgeRight).toBeLessThan(cs[i].x - 6);
            }
        }
        // 1 digit: 13 px badge → 23 px; 2 digits: 17 px → 27 px; a single symbol 13 px.
        expect([historyClusterClearance(1), historyClusterClearance(9), historyClusterClearance(10)]).toEqual([13, 23, 27]);
    });

    it("says a cluster's years, a period's end included", () => {
        expect(timelineHistoryYears([ev('a', 1866), ev('b', 1866)])).toBe('1866');
        expect(timelineHistoryYears([ev('a', 1886), ev('b', 1892)])).toBe('1886–1892');
        expect(timelineHistoryYears([ev('a', 1897, { year2: 1901 })])).toBe('1897–1901');
    });

    it('draws no row and no extra height without history', () => {
        const d = fam();
        const plain = svgOf(computeTimelineModel(d, ids(d), TODAY_YEAR));
        expect(plain).not.toContain('tl-hist');
        expect(plain).not.toContain('tl-rows');
        const withEmpty = svgOf(computeTimelineModel(d, ids(d), TODAY_YEAR, { history: { events: [] } }));
        expect(withEmpty).toBe(plain);
    });

    it('draws the row under the axis band: the options button, a tint over the whole axis, the focused life, clusters', () => {
        const d = fam();
        const model = computeTimelineModel(d, ids(d), TODAY_YEAR, {
            history: { events: [
                ev('E1', 1866), ev('E6', 1866, { kind: 'epidemic', text: 'Cholera.', persons: ['jan', 'anna'] }),
                ev('E9', 1897, { kind: 'economy', scope: 'place', year2: 1901 }),
            ], focusId: 'anna' },
        });
        const plain = svgOf(computeTimelineModel(d, ids(d), TODAY_YEAR));
        const svg = svgOf(model);
        const h = (s: string) => Number(/height="(\d+)"/.exec(s)![1]);
        expect(h(svg) - h(plain)).toBe(historyRowHeight(false));
        expect(svg).toContain('<g class="tl-hist-row">');
        expect(svg).not.toContain('data-hist-person');
        // The label: a button "History ▾", its options a dialog (§5), no name.
        expect(svg).toContain('<button type="button" class="tl-hist-btn" aria-haspopup="dialog" aria-expanded="false" title="History options on the timeline">'
            + '<b>History</b><span class="tl-hist-caret" aria-hidden="true">▾</span></button>');
        // The tint over the whole axis: from the plot's start − 4 to the width − 2.
        expect(svg).toContain('<rect class="tl-hist-band" x="156.0" y="43" width="1282.0" height="22" rx="6"/>');
        // Anna's life (1862–1930) as the 2 px line at the bottom of the tint.
        const xOf = (y: number) => 160 + (y - model.axis.minYear) / (model.axis.maxYear - model.axis.minYear) * (1440 - 160 - 16);
        expect(svg).toContain(`<rect class="tl-hist-life" x="${xOf(1862).toFixed(1)}" y="63" width="${(xOf(1930) - xOf(1862)).toFixed(1)}" height="2" rx="1"/>`);
        expect(svg).toContain('<g class="tl-rows" transform="translate(0 28)">');
        // 1866: war + epidemic in one cluster (a tie: the first), a badge "2", two persons.
        expect(svg).toContain('aria-label="1866: war, epidemic; concerns 2 people"');
        expect(svg).toContain('data-hist-ids="E1 E6"');
        expect(svg).toMatch(/class="tl-hist-n-txt"[^>]*>2<\/text>/);
        expect(svg).toContain('<title>1866 · war – Event E1.\n1866 · epidemic – Cholera.</title>');
        // A period: its years in the name, a stripe in its origin's colour.
        expect(svg).toContain('aria-label="1897–1901: economy; concerns 1 person"');
        expect(svg).toContain('class="tl-hist is-place"');
        expect(svg).toContain('class="tl-hist-period is-place"');
        expect((svg.match(/class="hist-kind-svg"/g) ?? []).length).toBe(2);
        expect((svg.match(/role="button" tabindex="0"/g) ?? []).length).toBe(2);
        // 44 × 44 touch target.
        expect(svg).toContain('width="44" height="44"');
        // No focused person: no line.
        expect(svgOf(computeTimelineModel(d, ids(d), TODAY_YEAR, { history: { events: [ev('E1', 1866)] } }))).not.toContain('tl-hist-life');
    });

    it('a phone: 26 px, the same label; the poster never has the row', () => {
        const d = fam();
        const model = computeTimelineModel(d, ids(d), TODAY_YEAR, { history: { events: [ev('E1', 1866)], focusId: 'jan' } });
        const phone = buildTimelineSvg(model, { esc, width: 390, rowH: 28, labelW: 96, mode: 'screen', narrow: true });
        expect(phone).toContain('translate(0 26)');
        expect(phone).toContain('<b>History</b><span class="tl-hist-caret"');
        const poster = buildTimelineSvg(model, { esc, width: 1440, rowH: 30, labelW: 190, mode: 'poster' });
        expect(poster).not.toContain('tl-hist');
        // Kolo 4 point 2: the row's label is a <foreignObject> on screen only; the export builder never inserts one.
        expect(buildTimelineSvg(model, { esc, width: 1440, rowH: 30, labelW: 190, mode: 'screen' })).toContain('class="tl-hist-label"');
        expect(poster).not.toContain('<foreignObject');
        const full = buildTimelinePosterSvg(model, { esc }, { treeName: 'T' });
        expect(full).not.toContain('<foreignObject');
        expect(full).not.toContain('tl-hist');
    });
});

describe('a shared event on the family timeline (spec 085 §2e)', () => {
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const census = (id: string): LifeEvent => ({ id: `c_${id}`, type: 'census', date: '1921-02-15', shareId: 'sh_c1921' });
    function household(): StromData {
        return data([
            person('sudivoj', 'Sudivoj', 'male', { birthDate: '1879', deathDate: '1950', events: [census('sudivoj')] }),
            person('radegunda', 'Radegunda', 'female', { birthDate: '1883', deathDate: '1955', events: [census('radegunda')] }),
            person('soused', 'Ctimír', 'male', { birthDate: '1890', deathDate: '1960' }),
            person('bohuchval', 'Bohuchval', 'male', { birthDate: '1906', deathDate: '1980', events: [census('bohuchval'), { id: 'e1', type: 'military', date: '1925' }] }),
        ]);
    }

    it('merges the rows of the persons on the timeline into one mark, the rows between left out of it', () => {
        const model = computeTimelineModel(household(), ['sudivoj', 'radegunda', 'soused', 'bohuchval'], TODAY_YEAR);
        expect(model.shared).toEqual([{ shareId: 'sh_c1921', year: 1921, type: 'census', rows: [0, 1, 3] }]);
        const svg = buildTimelineSvg(model, { esc, width: 1440, rowH: 30, labelW: 160, mode: 'screen' });
        // One mark of two runs (rows 0–1 and 3) joined by a line past the neighbour, the label once.
        expect(svg.match(/class="tl-shared-mark"/g)).toHaveLength(2);
        expect(svg.match(/class="tl-shared-link"/g)).toHaveLength(1);
        expect(svg.match(/class="tl-shared-label"/g)).toHaveLength(1);
        expect(svg).toContain('<title>Census 1921: Sudivoj X, Radegunda X, Bohuchval X</title>');
        expect(svg).toMatch(/class="tl-shared-label"[^>]*>Census 1921<\/text>/);
        // No dot of the census left in the rows; the military service keeps its dot.
        expect(svg).not.toContain('<title>Census (1921)</title>');
        expect(svg.match(/class="tl-dot"/g)).toHaveLength(1);
        expect(svg).toMatch(/class="tl-shared-mark" x="[\d.]+" y="[\d.]+" width="14"/);
    });

    it('only the persons with a row count: one of them alone keeps the dot', () => {
        const model = computeTimelineModel(household(), ['sudivoj', 'soused'], TODAY_YEAR);
        expect(model.shared).toEqual([]);
        const svg = buildTimelineSvg(model, { esc, width: 1440, rowH: 30, labelW: 160, mode: 'screen' });
        expect(svg).not.toContain('tl-shared');
        expect(svg).toContain('<title>Census (1921)</title>');
    });

    it('with the history row (spec 121): a mark from the first row keeps its label below that row, never in the history row', () => {
        const hist: TimelineHistoryItem = { id: 'E1', year: 1890, kind: 'war', scope: 'region', text: 'War.', persons: ['sudivoj'] };
        const model = computeTimelineModel(household(), ['sudivoj', 'radegunda', 'bohuchval'], TODAY_YEAR, { history: { events: [hist] } });
        expect(model.shared[0].rows).toEqual([0, 1, 2]);
        expect(model.history).toBeDefined();
        const baselines = (svg: string) => [...svg.matchAll(/class="tl-shared-label" x="[\d.]+" y="([\d.]+)"/g)].map(m => Number(m[1]));
        // Without the history row: centred above the first row, in the free gap under the axis.
        const plain = buildTimelineSvg(computeTimelineModel(household(), ['sudivoj', 'radegunda', 'bohuchval'], TODAY_YEAR),
            { esc, width: 1440, rowH: 30, labelW: 160, mode: 'screen' });
        expect(baselines(plain)).toHaveLength(1);
        expect(baselines(plain)[0]).toBeLessThan(40 + (30 - 14) / 2);
        // With it: the rows move down under the row and the label's top stays below the first row's top (rows' own coordinates).
        for (const narrow of [false, true]) {
            const svg = buildTimelineSvg(model, { esc, width: 1440, rowH: 30, labelW: 160, mode: 'screen', narrow });
            expect(svg).toContain('class="tl-hist-row"');
            const [baseline] = baselines(svg);
            expect(baseline).toBeGreaterThanOrEqual(40 + 30 + (30 - 14) / 2 - 6.5 - 0.01);
        }
    });

    it('labels of marks close together: none over a mark or another label, beside its own mark; "…" only without room (A-N3)', () => {
        // Census 1921 over rows 1–4 and 6–7, residence 1930 over rows 4, 5 and 8, emigration 1925 over rows 6–7 (the reported family).
        const rowH = 28, TOP = 40;
        const barTop = (i: number) => TOP + i * rowH + (rowH - 14) / 2;
        const mark = (x: number, runs: [number, number][], label: string) => ({
            x, label, rows: runs.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, k) => a + k)),
            bars: runs.map(([a, b]) => ({ x1: x - 7, y1: barTop(a) - 3, x2: x + 7, y2: barTop(b) + 17 })),
            links: runs.slice(1).map(([a], k) => ({ x1: x - 1, y1: barTop(runs[k][1]) + 17, x2: x + 1, y2: barTop(a) - 3 })),
        });
        const measure = (t: string) => t.length * 7;
        const at = (pxPerYear: number, plotX1: number) => {
            const x = (y: number) => 96 + (y - 1840) * pxPerYear;
            const marks = [mark(x(1921), [[1, 4], [6, 7]], 'Census 1921'), mark(x(1930), [[4, 5], [8, 8]], 'Residence 1930'), mark(x(1925), [[6, 7]], 'Emigration 1925')];
            const spots = placeSharedLabels(marks, { rowH, rowCount: 9, plotX0: 96, plotX1, measure });
            const boxes = spots.map(s => s && { x1: s.x1, y1: s.baseline - 11.5, x2: s.x1 + measure(s.text), y2: s.baseline + 3.5 });
            const hit = (a: { x1: number; y1: number; x2: number; y2: number }, b: typeof a) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
            boxes.forEach((b, i) => {
                expect(b, marks[i].label).toBeTruthy();
                for (const m of marks) for (const r of [...m.bars, ...m.links]) expect(hit(b!, r), `${marks[i].label} over ${m.label}`).toBe(false);
                boxes.forEach((o, j) => { if (j !== i) expect(hit(b!, o!)).toBe(false); });
                expect(b!.x1).toBeGreaterThanOrEqual(96);
                expect(b!.x2).toBeLessThanOrEqual(plotX1);
                expect(Math.max(0, b!.x1 - (marks[i].x + 7), marks[i].x - 7 - b!.x2)).toBeLessThanOrEqual(30);
            });
            return spots;
        };
        // Wide: the census centred above its top row, all whole.
        const wide = at(4.4, 1008);
        expect(wide.map(s => s!.text)).toEqual(['Census 1921', 'Residence 1930', 'Emigration 1925']);
        expect(wide[0]!.x1 + measure('Census 1921') / 2).toBeCloseTo(96 + 81 * 4.4, 5);
        // A phone: still none over another, whole where there is room.
        at(1.45, 374);
        // No room for the whole label anywhere near its mark: cut with "…".
        const tight = placeSharedLabels([mark(110, [[0, 1]], 'Emigration 1925'), mark(130, [[0, 1]], 'Census 1921')], { rowH, rowCount: 2, plotX0: 96, plotX1: 200, measure });
        expect(tight[0]!.text).toMatch(/^Em.*…$/);
    });

    it('a living person under privacy has no events, so is not in the mark (the poster)', () => {
        const d = household();
        delete d.persons['radegunda' as PersonId].events;
        const model = computeTimelineModel(d, ['sudivoj', 'radegunda', 'bohuchval'], TODAY_YEAR);
        expect(model.shared[0].rows).toEqual([0, 2]);
        const poster = buildTimelinePosterSvg(model, { esc }, { treeName: 'T' });
        expect(poster).toContain('.tl-shared-mark{fill:#3f6b4f');
        expect(poster.match(/class="tl-shared-mark"/g)).toHaveLength(2);
    });
});

// ==================== A CLUSTER'S POPOVER AND SHEET (spec 121 §2) ====================

describe('timeline history: whom a cluster concerns', () => {
    const ev = (id: string, persons: string[]): TimelineHistoryItem =>
        ({ id, year: 1880, kind: 'census', scope: 'region', text: id, persons });

    it("an event names at most two persons in the rows' order, the focused person first, and how many more", () => {
        expect(timelineConcernPersons(['a', 'b', 'c', 'd'])).toEqual({ shown: ['a', 'b'], more: 2 });
        expect(timelineConcernPersons(['a', 'b', 'c', 'd'], 'c')).toEqual({ shown: ['c', 'a'], more: 2 });
        expect(timelineConcernPersons(['a', 'b'], 'z')).toEqual({ shown: ['a', 'b'], more: 0 });
        expect(timelineConcernPersons(['a'], 'a')).toEqual({ shown: ['a'], more: 0 });
        expect(timelineConcernPersons([], 'a')).toEqual({ shown: [], more: 0 });
    });

    it("the sheet's persons: everyone of the cluster in the rows' order, the focused first, each with the first event that concerns them", () => {
        const items = [ev('E1', ['c', 'a']), ev('E2', ['b', 'c']), ev('E3', ['x'])];
        const order = ['a', 'b', 'c'];
        expect(timelineClusterPersons(items, order)).toEqual([
            { personId: 'a', eventId: 'E1' }, { personId: 'b', eventId: 'E2' }, { personId: 'c', eventId: 'E1' },
            { personId: 'x', eventId: 'E3' },
        ]);
        expect(timelineClusterPersons(items, order, 'b').map(p => p.personId)).toEqual(['b', 'a', 'c', 'x']);
        expect(timelineClusterPersons([ev('E1', ['a'])], order, 'c')).toEqual([{ personId: 'a', eventId: 'E1' }]);
    });

    it('"Concerns: …" and "and N more" in all four languages', async () => {
        const said = (lang: 'en' | 'cs' | 'de' | 'pl', n: number) => { setLanguage(lang); return strings.history.timelineConcerns('A, B', n); };
        try {
            expect(said('en', 2)).toBe('Concerns: A, B and 2 more');
            expect(said('en', 0)).toBe('Concerns: A, B');
            expect(said('cs', 2)).toBe('Týká se: A, B a 2 další');
            expect(said('cs', 5)).toBe('Týká se: A, B a 5 dalších');
            expect(said('de', 1)).toBe('Betrifft: A, B und 1 weitere');
            expect(said('pl', 2)).toBe('Dotyczy: A, B i 2 innych');
            setLanguage('cs');
            expect(strings.history.timelineYearsTitle('1880–1891')).toBe('Dějiny 1880–1891');
            expect(strings.history.timelinePeopleMore(2)).toBe('a 2 další');
            setLanguage('de');
            expect(strings.history.timelinePeopleMore(1)).toBe('und 1 weitere');
        } finally {
            setLanguage('en');
        }
    });
});

describe('timeline history: where the popover goes', () => {
    const view = { width: 1440, height: 900 };
    const size = { width: 380, height: 300 };

    it('under the row, 6 px below it, at the cluster x − 40', () => {
        expect(placeTimelinePop({ x: 600, top: 100, bottom: 128 }, size, view)).toEqual({ left: 560, top: 134, above: false, maxHeight: null });
    });

    it('clipped into the window, 8 px from its edges', () => {
        expect(placeTimelinePop({ x: 20, top: 100, bottom: 128 }, size, view).left).toBe(8);
        expect(placeTimelinePop({ x: 1430, top: 100, bottom: 128 }, size, view).left).toBe(1440 - 380 - 8);
    });

    it('above the row where there is no room below (the bottom bar counts)', () => {
        expect(placeTimelinePop({ x: 600, top: 700, bottom: 728 }, size, view)).toEqual({ left: 560, top: 394, above: true, maxHeight: null });
        expect(placeTimelinePop({ x: 600, top: 500, bottom: 528 }, size, { ...view, bottomInset: 120 }).above).toBe(true);
    });

    it('no room on either side: the side with more, its height limited', () => {
        const tall = { width: 380, height: 800 };
        expect(placeTimelinePop({ x: 600, top: 300, bottom: 328 }, tall, view)).toEqual({ left: 560, top: 334, above: false, maxHeight: 900 - 8 - 334 });
        expect(placeTimelinePop({ x: 600, top: 600, bottom: 628 }, tall, view)).toEqual({ left: 560, top: 8, above: true, maxHeight: 600 - 6 - 8 });
    });
});
