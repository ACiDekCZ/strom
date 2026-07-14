/**
 * Merge matching + execution safety. Locks the scoring thresholds that the
 * audit found untested, and the new rule that an UNDECIDED low-score match is
 * never silently merged (kept as a separate person instead).
 */

import { describe, it, expect } from 'vitest';
import { findMatches, detectConflicts, suggestResolution } from '../merge/matching.js';
import { buildIdMapping, isEffectivelyConfirmed, AUTO_CONFIRM_SCORE, mergePersonData } from '../merge/executor.js';
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

describe('smart matching (flex dates + transitive propagation)', () => {
    const uid = (s: string) => s as import('../types.js').PartnershipId;
    const withUnion = (d: StromData, id: string, p1: string, p2: string): StromData => {
        (d.partnerships as Record<string, unknown>)[id] = {
            id: uid(id), person1Id: p1 as PersonId, person2Id: p2 as PersonId,
            childIds: [], status: 'married',
        };
        d.persons[p1 as PersonId].partnerships.push(uid(id));
        d.persons[p2 as PersonId].partnerships.push(uid(id));
        return d;
    };

    it("an ABT-imported date ('~1880-05-15') matches the exact date", () => {
        const existing = data(person('e1', 'Jan', 'Novák', { birthDate: '1880-05-15' }));
        const incoming = data(person('i1', 'Jan', 'Novák', { birthDate: '~1880-05-15' }));
        const matches = findMatches(existing, incoming);
        expect(matches).toHaveLength(1);
        expect(matches[0].confidence).toBe('high');
    });

    it("year-only vs full date still counts as the same year ('~1880' vs '1880-05-15')", () => {
        const existing = data(person('e1', 'Jan', 'Novák', { birthDate: '1880-05-15' }));
        const incoming = data(person('i1', 'Jan', 'Novák', { birthDate: '~1880' }));
        const matches = findMatches(existing, incoming);
        expect(matches).toHaveLength(1);
        expect(matches[0].score).toBeGreaterThanOrEqual(AUTO_CONFIRM_SCORE);
    });

    it('propagation chains through generations (grandparent resolves via parent)', () => {
        // Chain: anchor (strong match) -> partner -> partner's second union? Use
        // parent chain: child matches strongly; parent has a weak name variant;
        // grandparent even weaker — resolvable only once the parent matched.
        const mkTree = (suffix: string, gpFirst: string): StromData => {
            const gp = person('gp' + suffix, gpFirst, 'Dvorak', { childIds: ['pa' + suffix as PersonId] });
            const pa = person('pa' + suffix, 'Karel', 'Dvorak', {
                parentIds: ['gp' + suffix as PersonId], childIds: ['ch' + suffix as PersonId], birthDate: '1900',
            });
            const ch = person('ch' + suffix, 'Jan', 'Dvorak', {
                parentIds: ['pa' + suffix as PersonId], birthDate: '1930-01-01',
            });
            return data(gp, pa, ch);
        };
        const existing = mkTree('E', 'Vaclav');
        const incoming = mkTree('I', 'Vaclav');
        // Fix ids inside relations to the incoming/existing variants
        const matches = findMatches(existing, incoming);
        const byIncoming = new Map(matches.map(m => [m.incomingId, m]));
        expect(byIncoming.get('chI' as PersonId)?.existingId).toBe('chE');
        expect(byIncoming.get('paI' as PersonId)?.existingId).toBe('paE');
        expect(byIncoming.get('gpI' as PersonId)?.existingId).toBe('gpE');
    });
});

describe('conflict suggestions (suggestResolution + detectConflicts)', () => {
    it('prefers the more precise date within the same year — either direction', () => {
        expect(suggestResolution('birthDate', '1880', '1880-05-15'))
            .toEqual({ resolution: 'use_incoming', reason: 'more_precise_date' });
        expect(suggestResolution('birthDate', '1880-05-15', '~1880'))
            .toEqual({ resolution: 'keep_existing', reason: 'more_precise_date' });
        // Same precision, one unqualified — prefer the certain one.
        expect(suggestResolution('birthDate', '~1880', '1880'))
            .toEqual({ resolution: 'use_incoming', reason: 'more_precise_date' });
    });

    it('leaves contradicting dates to a human (no suggestion)', () => {
        expect(suggestResolution('birthDate', '1880-05-15', '1880-06-01'))
            .toEqual({ resolution: 'keep_existing' });
        expect(suggestResolution('birthDate', '1880', '1881'))
            .toEqual({ resolution: 'keep_existing' });
    });

    it('prefers the more complete name/place (normalized containment)', () => {
        expect(suggestResolution('birthPlace', 'Praha', 'Praha, Žižkov'))
            .toEqual({ resolution: 'use_incoming', reason: 'more_complete' });
        expect(suggestResolution('firstName', 'Jan Nepomuk', 'Jan'))
            .toEqual({ resolution: 'keep_existing', reason: 'more_complete' });
        expect(suggestResolution('birthPlace', 'Brno', 'Ostrava'))
            .toEqual({ resolution: 'keep_existing' });
    });

    it('never auto-flips gender, but the conflict is now detected', () => {
        const conflicts = detectConflicts(
            person('e1', 'Alex', 'Novák'),
            person('i1', 'Alex', 'Novák', { gender: 'female' })
        );
        const g = conflicts.find(c => c.field === 'gender');
        expect(g).toBeDefined();
        expect(g!.resolution).toBe('keep_existing');
        expect(g!.suggestedReason).toBeUndefined();
    });

    it('a suggested resolution is what the merge applies by default', () => {
        const existing = person('e1', 'Jan', 'Novák', { birthDate: '1880' });
        const incoming = person('i1', 'Jan', 'Novák', { birthDate: '1880-05-15' });
        const conflicts = detectConflicts(existing, incoming);
        expect(conflicts[0].resolution).toBe('use_incoming');
        mergePersonData(existing, incoming, conflicts);
        expect(existing.birthDate).toBe('1880-05-15');
    });
});
