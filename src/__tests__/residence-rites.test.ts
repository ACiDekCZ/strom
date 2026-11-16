/**
 * Where a person lived (K043): a baptism, a confirmation, a burial, a will and
 * the like name the place of the rite or the act, not of the person's home —
 * the band of places lived on the person's chart, the history of the places
 * lived in, the count of places on the person page and the moves of a line's
 * timeline leave them out. A baptism with a place stands in for a birth
 * without one, up to the first real point. A birth with a full date sorts by
 * that date. Fictional data.
 */

import { describe, it, expect } from 'vitest';
import { computePersonLifeline } from '../timeline.js';
import {
    residencePoints, computePersonHistory, historyFindRegions, historyMainPlace, parseHistoryPayload, HistoryPayload,
} from '../history.js';
import { NOT_RESIDENCE_EVENT_TYPES, isResidenceEventType, orderLifeList } from '../events.js';
import { lifeChartInput } from '../person-page-chart.js';
import { buildPageSet } from '../family-pages.js';
import { buildRodTimeline } from '../rod-timeline.js';
import { placeKey } from '../places.js';
import { yearFraction } from '../dates.js';
import { LifeEvent, Partnership, PartnershipId, Person, PersonId, StromData } from '../types.js';
import { timelineFixture, TP_NOW } from './helpers/tree-pages-fixture.js';

const AT = '2026-11-16T10:00:00Z';
const ONDREJ = 'ondrej' as PersonId;

function person(id: string, o: Partial<Person> = {}): Person {
    return {
        id: id as PersonId, firstName: id, lastName: 'Kmínek', gender: 'male', isPlaceholder: false,
        parentIds: [], childIds: [], partnerships: [], ...o,
    } as Person;
}
const ev = (id: string, type: LifeEvent['type'], date: string, place: string): LifeEvent => ({ id, type, date, place });

/** Born in Rodnice, baptised in Farnov a few days later, lived in Rodnice, married there, died there, buried in Hřbitovice. */
function tree(o: Partial<Person> = {}): StromData {
    const ondrej = person('ondrej', {
        birthDate: '1879-03-02', birthPlace: 'Rodnice', deathDate: '1940-05-07', deathPlace: 'Rodnice',
        partnerships: ['u1' as PartnershipId],
        events: [
            ev('e1', 'baptism', '1879-03-05', 'Farnov'),
            ev('e2', 'residence', '1905', 'Rodnice'),
            ev('e3', 'burial', '1940-05-10', 'Hřbitovice'),
        ],
        ...o,
    });
    const kristyna = person('kristyna', { gender: 'female', birthDate: '1882', partnerships: ['u1' as PartnershipId], lastName: 'Kmínková' });
    const u1 = {
        id: 'u1' as PartnershipId, person1Id: ONDREJ, person2Id: 'kristyna' as PersonId, childIds: [],
        status: 'married', startDate: '1906-02-10', startPlace: 'Rodnice',
    } as Partnership;
    return {
        persons: { ondrej, kristyna } as StromData['persons'],
        partnerships: { u1 } as StromData['partnerships'],
    };
}

function payload(raw: Record<string, unknown>): HistoryPayload {
    const p = parseHistoryPayload({ state: { on: true, search: 'done', at: AT }, lang: 'cs', events: [], places: {}, hidden: [], ...raw }, AT);
    if (!p) throw new Error('payload');
    return p;
}

describe('rites and acts are not places lived (K043)', () => {
    it('the shared set: rites, the body and the estate, a part at another\'s rite; a residence, a census or a move abroad stays', () => {
        for (const t of ['baptism', 'confirmation', 'firstCommunion', 'barMitzvah', 'batMitzvah', 'ordination',
            'burial', 'cremation', 'probate', 'will', 'godparent', 'weddingWitness'] as const) {
            expect(NOT_RESIDENCE_EVENT_TYPES.has(t)).toBe(true);
            expect(isResidenceEventType(t)).toBe(false);
        }
        for (const t of ['residence', 'census', 'occupation', 'military', 'education', 'emigration', 'immigration', 'naturalization', 'custom'] as const) {
            expect(isResidenceEventType(t)).toBe(true);
        }
    });

    it('residencePoints: the birthplace from the birth on, no baptism, no burial place last', () => {
        const pts = residencePoints(computePersonLifeline(tree(), ONDREJ));
        expect(pts.map(p => p.place)).not.toContain('Farnov');
        expect(pts.map(p => p.place)).not.toContain('Hřbitovice');
        expect(new Set(pts.map(p => p.place))).toEqual(new Set(['Rodnice']));
        expect(pts[pts.length - 1].place).toBe('Rodnice');
    });

    it('the chart\'s band of places lived: one run of the birthplace from the birth to the end', () => {
        const input = lifeChartInput(tree(), ONDREJ, { now: 2026.8 })!;
        expect(input.residence.map(r => r.place)).toEqual(['Rodnice']);
        expect(input.residence[0].to).toBe(input.barEnd);
    });

    it('the history of the places lived: none of the place of the baptism or the burial', () => {
        const p = payload({
            events: [
                { id: 'far-1879', from: 1879, kind: 'other', scope: 'place', place: { key: 'Farnov' }, text: { cs: 'Farnov 1879' }, source: { title: 'Kronika', url: 'https://example.org/k' } },
                { id: 'hrb-1940', from: 1940, kind: 'other', scope: 'place', place: { key: 'Hřbitovice' }, text: { cs: 'Hřbitovice 1940' }, source: { title: 'Kronika', url: 'https://example.org/k' } },
                { id: 'lop-1890', from: 1890, kind: 'other', scope: 'place', place: { key: 'Rodnice' }, text: { cs: 'Rodnice 1890' }, source: { title: 'Kronika', url: 'https://example.org/k' } },
            ],
            places: {
                Farnov: { events: ['far-1879'] },
                Hřbitovice: { events: ['hrb-1940'] },
                Rodnice: { events: ['lop-1890'] },
            },
        });
        const r = computePersonHistory(tree(), ONDREJ, p, 'cs');
        expect(r.items.map(i => i.ev.id)).toEqual(['lop-1890']);
    });

    it('the regions to search and the place lived longest leave the place of the baptism out', () => {
        const regions = payload({
            state: { on: true, search: 'running', at: AT },
            places: {
                Rodnice: { events: [], regions: [{ id: 'cz-a' }] },
                Farnov: { events: [], regions: [{ id: 'cz-b' }] },
            },
            regions: { 'cz-a': { state: 'queued', order: 1 }, 'cz-b': { state: 'queued', order: 2 } },
        });
        expect(historyFindRegions(tree(), ONDREJ, regions).map(r => r.id)).toEqual(['cz-a']);
        const onlyFarnov = payload({ places: { Farnov: { events: [] } }, regions: { 'cz-b': { state: 'done' } } });
        expect(historyMainPlace(tree(), ONDREJ, onlyFarnov)).toBeNull();
    });

    it('the places of the person page\'s summary count the birthplace once and neither rite', () => {
        const pts = residencePoints(computePersonLifeline(tree(), ONDREJ, { childEvents: false }));
        expect(new Set(pts.map(p => placeKey(p.place))).size).toBe(1);
    });

    it('a baptism with a place stands in for a birth without one, up to the first real point', () => {
        const d = tree({ birthPlace: undefined });
        const pts = residencePoints(computePersonLifeline(d, ONDREJ));
        expect(pts.map(p => [p.year, p.place])).toEqual([
            [1879, 'Farnov'], [1905, 'Rodnice'], [1906, 'Rodnice'], [1940, 'Rodnice'],
        ]);
        const input = lifeChartInput(d, ONDREJ, { now: 2026.8 })!;
        expect(input.residence.map(r => r.place)).toEqual(['Farnov', 'Rodnice']);
        expect(Math.floor(input.residence[0].to)).toBe(1905);
        // The birthplace known: the baptism is no point at all.
        expect(residencePoints(computePersonLifeline(tree(), ONDREJ)).some(p => p.place === 'Farnov')).toBe(false);
    });

    it('a baptism after the first real point stands in for nothing', () => {
        const d = tree({
            birthPlace: undefined,
            events: [ev('e2', 'residence', '1879-01-10', 'Rodnice'), ev('e1', 'baptism', '1879-03-05', 'Farnov')],
        });
        expect(residencePoints(computePersonLifeline(d, ONDREJ)).some(p => p.place === 'Farnov')).toBe(false);
    });
});

describe('the birth\'s place on the life timeline (K043)', () => {
    it('a birth with a full date sorts by that date; the baptism of the same day still follows it', () => {
        const pts = computePersonLifeline(tree(), ONDREJ);
        const birth = pts.find(p => p.kind === 'birth')!;
        expect(birth.sortKey).toBeCloseTo(1879 + yearFraction('1879-03-02'), 6);
        const same = computePersonLifeline(tree({ events: [ev('e1', 'baptism', '1879-03-02', 'Farnov')] }), ONDREJ);
        expect(same.findIndex(p => p.kind === 'birth')).toBeLessThan(same.findIndex(p => p.eventType === 'baptism'));
    });

    it('the person\'s life list orders the birth by the same rule', () => {
        const events = [ev('e2', 'residence', '1879-01-10', 'Rodnice'), ev('e1', 'baptism', '1879-03-02', 'Farnov')];
        const order = orderLifeList({ date: '1879-03-02' }, null, events)
            .map(e => e.kind === 'event' ? e.event.id : e.kind);
        expect(order).toEqual(['e2', 'birth', 'e1']);
        const line = computePersonLifeline(tree({ events }), ONDREJ).filter(p => p.kind === 'birth' || p.kind === 'event')
            .map(p => p.kind === 'event' ? p.eventId : p.kind);
        expect(line).toEqual(order);
    });

    it('a birth known by the year alone still opens its year', () => {
        const pts = computePersonLifeline(tree({ birthDate: '1879' }), ONDREJ);
        expect(pts[0].kind).toBe('birth');
        expect(pts[0].sortKey).toBeCloseTo(1879.001, 6);
    });
});

describe('a line\'s timeline (K043)', () => {
    const F = timelineFixture();
    const timeline = (data: StromData) => {
        const set = buildPageSet(data, { kind: 'tree' }, { lang: 'cs', now: TP_NOW, timelines: true, privacy: 'full' }, { treeName: 'Rodokmen' });
        const rodId = set.protectedTree.lineages.rodByPerson.get(F.ids.vaclav)!;
        return buildRodTimeline({ prot: set.protectedTree, rodId, lang: 'cs', now: TP_NOW })!;
    };
    const withVaclav = (o: Partial<Person>): StromData => {
        const data = structuredClone(F.data);
        const v = data.persons[F.ids.vaclav];
        data.persons[F.ids.vaclav] = { ...v, ...o, events: [...(v.events ?? []), ...(o.events ?? [])] };
        return data;
    };

    it('no move to the place of a baptism or a burial', () => {
        const tl = timeline(withVaclav({
            birthDate: '1845-03-02',
            events: [ev('k1', 'baptism', '1845-03-05', 'Farnov'), ev('k2', 'burial', '1910-12-30', 'Hřbitovice')],
        }));
        const moves = tl.events.filter(e => e.kind === 'move' && e.personId === F.ids.vaclav);
        expect(moves.map(e => e.place)).not.toContain('Farnov');
        expect(moves.map(e => e.from)).not.toContain('Farnov');
        expect(moves.map(e => e.place)).not.toContain('Hřbitovice');
    });

    it('a baptism with a place stands in for a birth without one', () => {
        const tl = timeline(withVaclav({
            birthDate: '1845-03-02', birthPlace: undefined,
            events: [ev('k1', 'baptism', '1845-03-05', 'Farnov')],
        }));
        const moves = tl.events.filter(e => e.kind === 'move' && e.personId === F.ids.vaclav);
        expect(moves.map(e => [e.year, e.from, e.place])).toEqual([[1879, 'Farnov', 'Smrkov čp. 7']]);
    });
});
