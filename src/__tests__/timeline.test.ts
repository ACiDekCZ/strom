/**
 * Timeline view model (pure). Fixed injected `todayYear`.
 */

import { describe, it, expect } from 'vitest';
import { computeTimelineModel, yearToFraction, axisTicks, axisLabelStep, clusterTimelineHistory, timelineHistoryYears, TimelineHistoryItem } from '../timeline.js';
import { buildTimelineSvg, buildTimelinePosterSvg, historyRowHeight, historyClusterGap } from '../timeline-chart.js';
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

// ==================== HISTORY ROW (DEV symboly-dejin §9) ====================

describe('timeline history row', () => {
    const ev = (id: string, year: number, o: Partial<TimelineHistoryItem> = {}): TimelineHistoryItem =>
        ({ id, year, kind: 'war', scope: 'region', text: `Event ${id}.`, ...o });
    const fam = () => data([
        person('jan', 'Jan', 'male', { birthDate: '1860', deathDate: '1910' }),
        person('anna', 'Anna', 'female', { birthDate: '1862', deathDate: '1930' }),
        person('nob', 'Nobirth', 'male'),
    ]);
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const svgOf = (model: ReturnType<typeof computeTimelineModel>, narrow = false) =>
        buildTimelineSvg(model, { esc, width: 1440, rowH: 30, labelW: 160, mode: 'screen', narrow });

    it("carries only the focused person's events, sorted by year, with that person's life span", () => {
        const d = fam();
        const m = computeTimelineModel(d, ids(d), TODAY_YEAR, {
            history: { personId: 'jan', events: [ev('b', 1880), ev('a', 1866), ev('c', 1866, { kind: 'epidemic' })] },
        });
        expect(m.history?.personId).toBe('jan');
        expect(m.history?.name).toBe('Jan X');
        expect([m.history?.startYear, m.history?.endYear]).toEqual([1860, 1910]);
        // By year; the same year keeps the given order (the card's: region before local).
        expect(m.history?.events.map(e => e.id)).toEqual(['a', 'c', 'b']);
    });

    it('is absent without events, without the option, or for a person with no row', () => {
        const d = fam();
        expect(computeTimelineModel(d, ids(d), TODAY_YEAR).history).toBeUndefined();
        expect(computeTimelineModel(d, ids(d), TODAY_YEAR, { history: { personId: 'jan', events: [] } }).history).toBeUndefined();
        expect(computeTimelineModel(d, ids(d), TODAY_YEAR, { history: { personId: 'nob', events: [ev('a', 1866)] } }).history).toBeUndefined();
        expect(computeTimelineModel(d, ['anna'], TODAY_YEAR, { history: { personId: 'jan', events: [ev('a', 1866)] } }).history).toBeUndefined();
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
        const withEmpty = svgOf(computeTimelineModel(d, ids(d), TODAY_YEAR, { history: { personId: 'jan', events: [] } }));
        expect(withEmpty).toBe(plain);
    });

    it('draws the row under the axis band: label, life tint, a symbol per cluster with its count, aria and tooltip', () => {
        const d = fam();
        const model = computeTimelineModel(d, ids(d), TODAY_YEAR, {
            history: { personId: 'jan', events: [
                ev('E1', 1866), ev('E6', 1866, { kind: 'epidemic', text: 'Cholera.' }),
                ev('E9', 1897, { kind: 'economy', scope: 'place', year2: 1901 }),
            ] },
        });
        const plain = svgOf(computeTimelineModel(d, ids(d), TODAY_YEAR));
        const svg = svgOf(model);
        const h = (s: string) => Number(/height="(\d+)"/.exec(s)![1]);
        expect(h(svg) - h(plain)).toBe(historyRowHeight(false));
        expect(svg).toContain('class="tl-hist-row" data-hist-person="jan"');
        expect(svg).toContain('<b>History</b> · Jan X');
        expect(svg).toContain('class="tl-hist-band"');
        expect(svg).toContain('<g class="tl-rows" transform="translate(0 28)">');
        // 1866: war + epidemic in one cluster, the first event's symbol, a badge "2".
        expect(svg).toContain('aria-label="1866: war, epidemic"');
        expect(svg).toContain('data-hist-ids="E1 E6"');
        expect(svg).toMatch(/class="tl-hist-n-txt"[^>]*>2<\/text>/);
        expect(svg).toContain('<title>1866 war – Event E1.\n1866 epidemic – Cholera.</title>');
        // A period: its years in the name, a stripe in its origin's colour.
        expect(svg).toContain('aria-label="1897–1901: economy"');
        expect(svg).toContain('class="tl-hist is-place"');
        expect(svg).toContain('class="tl-hist-period is-place"');
        expect((svg.match(/class="hist-kind-svg"/g) ?? []).length).toBe(2);
        expect((svg.match(/role="button" tabindex="0"/g) ?? []).length).toBe(2);
        // 44 × 44 touch target.
        expect(svg).toContain('width="44" height="44"');
    });

    it('a phone: 26 px, the label without the name; the poster never has the row', () => {
        const d = fam();
        const model = computeTimelineModel(d, ids(d), TODAY_YEAR, { history: { personId: 'jan', events: [ev('E1', 1866)] } });
        const phone = buildTimelineSvg(model, { esc, width: 390, rowH: 28, labelW: 96, mode: 'screen', narrow: true });
        expect(phone).toContain('translate(0 26)');
        expect(phone).toContain('<b>History</b></span>');
        expect(phone).not.toContain(' · Jan X</span>');
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
