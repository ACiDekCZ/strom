/**
 * Merge matching + execution safety. Locks the scoring thresholds that the
 * audit found untested, and the new rule that an UNDECIDED low-score match is
 * never silently merged (kept as a separate person instead).
 */

import { describe, it, expect } from 'vitest';
import { findMatches } from '../merge/matching.js';
import { buildIdMapping, isEffectivelyConfirmed, AUTO_CONFIRM_SCORE } from '../merge/executor.js';
import { MergeState } from '../merge/types.js';
import { StromData, Person, PersonId, Gender } from '../types.js';

function person(id: string, first: string, last: string, o: Partial<Person> = {}): Person {
    return {
        id: id as PersonId, firstName: first, lastName: last,
        gender: (o.gender as Gender) ?? 'male', isPlaceholder: false,
        partnerships: [], parentIds: [], childIds: [], ...o,
    };
}
function data(...ps: Person[]): StromData {
    return { persons: Object.fromEntries(ps.map(p => [p.id, p])) as StromData['persons'], partnerships: {} };
}

describe('findMatches scoring (behaviour lock)', () => {
    it('same name + same birth year is a high-confidence match', () => {
        const existing = data(person('e1', 'Jan', 'Novák', { birthDate: '1880-05-15' }));
        const incoming = data(person('i1', 'Jan', 'Novák', { birthDate: '1880-05-15' }));
        const matches = findMatches(existing, incoming);
        expect(matches).toHaveLength(1);
        expect(matches[0].confidence).toBe('high');
        expect(matches[0].score).toBeGreaterThanOrEqual(AUTO_CONFIRM_SCORE);
    });

    it('diacritics and case differences do not break the match', () => {
        const existing = data(person('e1', 'Jan', 'Novák', { birthDate: '1880' }));
        const incoming = data(person('i1', 'JAN', 'Novak', { birthDate: '1880' }));
        const matches = findMatches(existing, incoming);
        expect(matches).toHaveLength(1);
        expect(matches[0].score).toBeGreaterThanOrEqual(AUTO_CONFIRM_SCORE);
    });

    it('a gender mismatch is a hard gate (no match at any name similarity)', () => {
        const existing = data(person('e1', 'Jan', 'Novák', { birthDate: '1880' }));
        const incoming = data(person('i1', 'Jan', 'Novák', { birthDate: '1880', gender: 'female' }));
        const matches = findMatches(existing, incoming);
        expect(matches).toHaveLength(0);
    });

    it('same surname only (different first name, no dates) does not match', () => {
        const existing = data(person('e1', 'Jan', 'Novák'));
        const incoming = data(person('i1', 'Petr', 'Novák'));
        const matches = findMatches(existing, incoming);
        expect(matches).toHaveLength(0);
    });
});

describe('undecided matches at execution', () => {
    const mkState = (score: number): MergeState => {
        const existingPerson = person('e1', 'Jan', 'Novák');
        const incomingPerson = person('i1', 'Jan', 'Novák');
        return {
            existingData: data(existingPerson),
            incomingData: data(incomingPerson),
            matches: [{
                existingId: 'e1' as PersonId, incomingId: 'i1' as PersonId,
                confidence: score >= 85 ? 'high' : score >= 55 ? 'medium' : 'low',
                reasons: [], score, existingPerson, incomingPerson, conflicts: [],
            }],
            unmatchedExisting: [], unmatchedIncoming: [],
            decisions: new Map(), conflictResolutions: new Map(),
            phase: 'reviewing',
        } as unknown as MergeState;
    };

    it('a strong undecided match auto-confirms (score >= threshold)', () => {
        const state = mkState(80);
        expect(isEffectivelyConfirmed(state, state.matches[0])).toBe(true);
        const mapping = buildIdMapping(state);
        expect(mapping.persons.get('i1' as PersonId)).toBe('e1');
    });

    it('a weak undecided match is NOT merged — the person stays separate', () => {
        const state = mkState(30);
        expect(isEffectivelyConfirmed(state, state.matches[0])).toBe(false);
        const mapping = buildIdMapping(state);
        expect(mapping.persons.get('i1' as PersonId)).not.toBe('e1');
    });

    it('an explicit confirm merges even a weak match; explicit reject never merges', () => {
        const confirmed = mkState(30);
        confirmed.decisions.set('i1' as PersonId, { type: 'confirm' });
        expect(buildIdMapping(confirmed).persons.get('i1' as PersonId)).toBe('e1');

        const rejected = mkState(95);
        rejected.decisions.set('i1' as PersonId, { type: 'reject' });
        expect(buildIdMapping(rejected).persons.get('i1' as PersonId)).not.toBe('e1');
    });
});
