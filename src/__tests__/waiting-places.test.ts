/**
 * The research's place questions in "Awaiting action" without the DOM:
 * choices and what they send, the facts a question is about, who gave a
 * conflict's location and what the bulk steps take. Fictional places only.
 */

import { describe, it, expect } from 'vitest';
import type { LiveWaiting } from '../research-link.js';
import type { StromData } from '../types.js';
import { groupWaiting } from '../research-waiting.js';
import {
    PLACES_GROUP, bulkAcceptable, bulkHandConflicts, bulkKeepable, candidateLetter, conflictOrigin,
    isPlaceQuestion, pickableCandidates, placeAreas, placeQuestionChoices, placeQuestionFacts,
    type PlaceQuestion,
} from '../waiting-places.js';

const cand = (id: 'c1' | 'c2' | 'c3', name: string, district?: string, country?: string) =>
    ({ id, name, lat: 49.6, lon: 15.2, ...(district ? { district } : {}), ...(country ? { country } : {}) });

const q = (id: string, extra: Partial<LiveWaiting>): PlaceQuestion =>
    ({ id, place: id, kind: 'place', what: `? ${id}`, on: '', at: '', ...extra }) as PlaceQuestion;

const propose = q('L0012', { question: 'propose', forms: ['H. Lhota'], candidates: [cand('c1', 'Horní Lhota', 'okres Lhotov'), cand('c2', 'Horní Lhota', 'okres Jinov')] });
const lhotinek = q('L0013', { question: 'propose', forms: ['Lhotínek'], candidates: [cand('c1', 'Lhotínek', 'okres Jinov')] });
const handConflict = q('L0020', { question: 'conflict', forms: ['Lhotov'], by: 'person', current: { lat: 49.57, lon: 15.36 }, candidates: [cand('c1', 'Lhotov', 'okres Jinov')] });
const researchConflict = q('L0021', { question: 'conflict', forms: ['Jinov'], by: 'research', current: { lat: 49.1, lon: 15.1 }, candidates: [cand('c1', 'Jinov', undefined, 'CZ')] });
const form = q('L0030', { question: 'form', forms: ['Lhota 16'], change: { from: { place: 'Lhota 16' }, to: { place: 'Lhota', house: '16' }, facts: 1 } as never });
const all = [propose, lhotinek, handConflict, researchConflict, form];

describe('a place question', () => {
    it('is a place item with its record and question', () => {
        expect(isPlaceQuestion(propose)).toBe(true);
        expect(isPlaceQuestion({ id: 'T0001', what: 'x', on: '', at: '' })).toBe(false);
        expect(isPlaceQuestion({ id: 'L0001', kind: 'place', what: 'x', on: '', at: '' })).toBe(false);
    });

    it('offers by its question what it sends', () => {
        expect(placeQuestionChoices(propose)).toEqual([{ choice: 'none', take: 'none' }, { choice: 'unknown', take: 'unknown' }]);
        expect(placeQuestionChoices(propose, { chat: true }).map(c => c.choice)).toEqual(['none', 'unknown', 'chat']);
        expect(placeQuestionChoices(researchConflict)).toEqual([
            { choice: 'fix', take: 'c1' }, { choice: 'keep', take: 'keep' }, { choice: 'unknown', take: 'unknown' },
        ]);
        expect(placeQuestionChoices(q('L0022', { question: 'conflict' })).map(c => c.choice)).toEqual(['keep', 'unknown']);
        expect(placeQuestionChoices(form).map(c => c.take)).toEqual(['yes', 'no', 'unknown']);
        expect(pickableCandidates(propose).map(c => candidateLetter(c.id))).toEqual(['A', 'B']);
        expect(pickableCandidates(researchConflict)).toEqual([]);
    });

    it('counts the people, facts and years of its forms', () => {
        const data = {
            persons: {
                a: { id: 'a', birthPlace: 'H. Lhota', birthDate: '1860', deathPlace: 'Lhotínek', deathDate: '1878' },
                b: { id: 'b', birthPlace: 'h. lhota', birthDate: '1871-03-12', deathPlace: 'Jinov' },
            },
            partnerships: { u: { id: 'u', person1Id: 'a', person2Id: 'b', startPlace: 'H. Lhota', startDate: '1866' } },
        } as unknown as StromData;
        expect(placeQuestionFacts(data, ['H. Lhota'])).toEqual({ persons: ['a', 'b'], facts: 3, from: 1860, to: 1871 });
        expect(placeQuestionFacts(data, ['Jinov'])).toEqual({ persons: ['b'], facts: 1 });
        expect(placeQuestionFacts(data, [])).toEqual({ persons: [], facts: 0 });
    });

    it('says who gave a conflict\'s location: the tree\'s own location at the spot first', () => {
        expect(conflictOrigin(handConflict, undefined)).toEqual({ origin: 'hand' });
        expect(conflictOrigin(researchConflict, undefined)).toEqual({ origin: 'research' });
        const geos = { jinov: { lat: 49.1, lon: 15.1, at: '2026-10-30' } };
        expect(conflictOrigin(researchConflict, geos)).toEqual({ origin: 'map', at: '2026-10-30' });
        expect(conflictOrigin(researchConflict, { jinov: { lat: 40, lon: 10, origin: 'hand' as const } })).toEqual({ origin: 'research' });
    });
});

describe('the bulk steps of the group', () => {
    it('accepts suggestions and conflicts, never one placed by hand; keeps every conflict', () => {
        expect(bulkAcceptable(all, undefined).map(w => w.id)).toEqual(['L0012', 'L0013', 'L0021']);
        expect(bulkHandConflicts(all, undefined).map(w => w.id)).toEqual(['L0020']);
        expect(bulkKeepable(all).map(w => w.id)).toEqual(['L0020', 'L0021']);
    });

    it('splits the acceptable by candidate A\'s district, its country without one', () => {
        const two = q('L0014', { question: 'propose', forms: ['Lhoták'], candidates: [cand('c1', 'Lhoták', 'okres Jinov')] });
        expect(placeAreas(bulkAcceptable([...all, two], undefined))).toEqual([
            { name: 'okres Jinov', places: ['L0013', 'L0014'] },
            { name: 'CZ', places: ['L0021'] },
            { name: 'okres Lhotov', places: ['L0012'] },
        ]);
        expect(placeAreas([propose])).toEqual([]);
    });

    it('puts every place question under one group, not the research\'s', () => {
        const groups = groupWaiting([propose, { ...form, group: { key: 'family', name: 'Rodina' } as never }]);
        expect(groups.map(g => g.key)).toEqual([PLACES_GROUP]);
        expect(groups[0].items.map(w => w.id)).toEqual(['L0012', 'L0030']);
    });
});
