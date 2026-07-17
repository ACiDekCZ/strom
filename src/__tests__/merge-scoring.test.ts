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

describe('mergePersonData carries fields the audit found dropped', () => {
    it('fills photo (+ original name), notes, question, refn, isDeceased when missing', () => {
        const existing = person('e1', 'Jan', 'Novák');
        const incoming = person('i1', 'Jan', 'Novák', {
            photo: 'data:image/jpeg;base64,AAA', photoOriginalName: 'jan.jpg',
            notes: 'Farmer', question: 'When born?', refn: 'box 12', isDeceased: true,
        });
        mergePersonData(existing, incoming, []);
        expect(existing.photo).toBe('data:image/jpeg;base64,AAA');
        expect(existing.photoOriginalName).toBe('jan.jpg');
        expect(existing.notes).toBe('Farmer');
        expect(existing.question).toBe('When born?');
        expect(existing.refn).toBe('box 12');
        expect(existing.isDeceased).toBe(true);
    });

    it('concatenates notes when both sides wrote a different one', () => {
        const existing = person('e1', 'Jan', 'Novák', { notes: 'Existing note' });
        const incoming = person('i1', 'Jan', 'Novák', { notes: 'Incoming note' });
        mergePersonData(existing, incoming, []);
        expect(existing.notes).toContain('Existing note');
        expect(existing.notes).toContain('Incoming note');
    });

    it('detects a photo conflict when both have a different photo (no auto-pick)', () => {
        const conflicts = detectConflicts(
            person('e1', 'Jan', 'Novák', { photo: 'data:image/jpeg;base64,AAA' }),
            person('i1', 'Jan', 'Novák', { photo: 'data:image/jpeg;base64,BBB' }),
        );
        const pc = conflicts.find(c => c.field === 'photo');
        expect(pc).toBeDefined();
        expect(pc!.resolution).toBe('keep_existing');
    });

    it('resolving a photo conflict to the import pulls the photo AND its original name', () => {
        const existing = person('e1', 'Jan', 'Novák', { photo: 'data:image/jpeg;base64,AAA', photoOriginalName: 'old.jpg' });
        const incoming = person('i1', 'Jan', 'Novák', { photo: 'data:image/jpeg;base64,BBB', photoOriginalName: 'new.jpg' });
        const conflicts = detectConflicts(existing, incoming);
        conflicts.find(c => c.field === 'photo')!.resolution = 'use_incoming';
        mergePersonData(existing, incoming, conflicts);
        expect(existing.photo).toBe('data:image/jpeg;base64,BBB');
        expect(existing.photoOriginalName).toBe('new.jpg');
    });
});

describe('name conflict keeps the losing spelling as a variant (Fix 2)', () => {
    it('appends the losing surname spelling (Víšek/Vyšek) on keep_existing', () => {
        const existing = person('e1', 'Josef', 'Víšek');
        const incoming = person('i1', 'Josef', 'Vyšek');
        const conflicts = detectConflicts(existing, incoming);
        // Default is keep_existing (the two spellings do not contain one another).
        mergePersonData(existing, incoming, conflicts);
        expect(existing.lastName).toBe('Víšek');
        expect(existing.nameVariants).toContain('Vyšek');
    });

    it('appends the losing surname (Víšek/Vyšek) on use_incoming too', () => {
        const existing = person('e1', 'Josef', 'Vyšek');
        const incoming = person('i1', 'Josef', 'Víšek');
        const conflicts = detectConflicts(existing, incoming);
        conflicts.find(c => c.field === 'lastName')!.resolution = 'use_incoming';
        mergePersonData(existing, incoming, conflicts);
        expect(existing.lastName).toBe('Víšek');
        expect(existing.nameVariants).toContain('Vyšek');
    });

    it('keeps both spellings for Elsa Charlotta Voigtová / Elsa Voigt', () => {
        const existing = person('e1', 'Elsa Charlotta', 'Voigtová', { gender: 'female' });
        const incoming = person('i1', 'Elsa', 'Voigt', { gender: 'female' });
        const conflicts = detectConflicts(existing, incoming);
        mergePersonData(existing, incoming, conflicts);
        // The more complete spellings win; the shorter ones survive as variants,
        // so the next import of "Elsa Voigt" matches this person again.
        expect(existing.firstName).toBe('Elsa Charlotta');
        expect(existing.lastName).toBe('Voigtová');
        expect(existing.nameVariants).toContain('Elsa');
        expect(existing.nameVariants).toContain('Voigt');
    });

    it('adds nothing when the two spellings differ only in case/diacritics', () => {
        const existing = person('e1', 'Jan', 'Novák');
        const incoming = person('i1', 'Jan', 'Novak');
        const conflicts = detectConflicts(existing, incoming);
        mergePersonData(existing, incoming, conflicts);
        expect(existing.nameVariants ?? []).not.toContain('Novak');
    });
});
