/**
 * The check before a merge is saved (spec 134 K0.2): the incoming records
 * each end merged, added or left out by a rule, the tree keeps everything,
 * and no new reference points at nothing. A failed check saves nothing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeMerge } from '../merge/executor.js';
import { checkMergeResult, danglingReferences, mergeCheckMessage } from '../merge/merge-check.js';
import { createMergeState } from '../merge/matching.js';
import { StorageManager } from '../storage.js';
import { setLanguage } from '../strings.js';
import { MergeState } from '../merge/types.js';
import { StromData, Person, Partnership, PersonId, PartnershipId, Gender } from '../types.js';

type Overrides = Partial<Omit<Person, 'parentIds' | 'childIds' | 'partnerships'>> & { parentIds?: string[]; childIds?: string[]; partnerships?: string[] };
function P(id: string, first: string, last: string, o: Overrides = {}): Person {
    return {
        id: id as PersonId, firstName: first, lastName: last, gender: (o.gender as Gender) ?? 'male', isPlaceholder: false,
        ...o,
        partnerships: (o.partnerships ?? []) as PartnershipId[],
        parentIds: (o.parentIds ?? []) as PersonId[],
        childIds: (o.childIds ?? []) as PersonId[],
    };
}
function U(id: string, p1: string, p2: string, childIds: string[]): Partnership {
    return { id: id as PartnershipId, person1Id: p1 as PersonId, person2Id: p2 as PersonId, childIds: childIds as PersonId[], status: 'married' };
}
function tree(persons: Person[], partnerships: Partnership[] = [], extra: Partial<StromData> = {}): StromData {
    return {
        persons: Object.fromEntries(persons.map(p => [p.id, p])) as StromData['persons'],
        partnerships: Object.fromEntries(partnerships.map(u => [u.id, u])) as StromData['partnerships'],
        ...extra,
    };
}

/** Existing: Oldřich and his son. Incoming: Oldřich (matches), his wife Hedvika and their daughter, with a source and a file. */
function fixture(): MergeState {
    const eO = P('eO', 'Oldřich', 'Pospíchal', { birthDate: '1850-03-01', deathDate: '1920', childIds: ['eS'] });
    const eS = P('eS', 'Šimon', 'Pospíchal', { birthDate: '1880', parentIds: ['eO'] });
    const existing = tree([eO, eS], [], { sources: { s1: { id: 's1', title: 'Matrika Lhotka 1850' } as never } });
    const iO = P('iO', 'Oldřich', 'Pospíchal', { birthDate: '1850-03-01', deathDate: '1920', partnerships: ['iU'], childIds: ['iD'] });
    const iH = P('iH', 'Hedvika', 'Pospíchalová', { gender: 'female', birthDate: '1855', partnerships: ['iU'], childIds: ['iD'], sourceIds: ['is1'] });
    const iD = P('iD', 'Dobromila', 'Pospíchalová', { gender: 'female', birthDate: '1885', parentIds: ['iO', 'iH'] });
    const incoming = tree([iO, iH, iD], [U('iU', 'iO', 'iH', ['iD'])], {
        sources: { is1: { id: 'is1', title: 'Oddací kniha Lhotka' } as never },
        media: { m1: { id: 'm1', name: 'hedvika.jpg', mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,AAAA', sizeBytes: 3, places: [{ personId: 'iH' as PersonId }] } },
    });
    return createMergeState(existing, incoming);
}

beforeEach(() => {
    vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never);
});
afterEach(() => setLanguage('en'));

describe('checkMergeResult', () => {
    it('a merge that keeps everything passes, and its tallies add up', async () => {
        const state = fixture();
        const result = await executeMerge(state);
        expect(result.success).toBe(true);
        const check = checkMergeResult(state, result);
        expect(check.ok).toBe(true);
        expect(check.tallies.persons).toEqual({ source: 3, merged: 1, added: 2, left: 0, lost: 0 });
        expect(check.tallies.unions).toEqual({ source: 1, merged: 0, added: 1, left: 0, lost: 0 });
        expect(check.tallies.links).toEqual({ source: 2, merged: 0, added: 2, left: 0, lost: 0 });
        expect(check.tallies.sources).toEqual({ source: 1, merged: 0, added: 1, left: 0, lost: 0 });
        expect(check.tallies.files).toEqual({ source: 1, merged: 0, added: 1, left: 0, lost: 0 });
    });

    it('a skipped person is left out, not lost; the couple and links through her are left out too', async () => {
        const state = fixture();
        state.decisions.set('iH' as PersonId, { type: 'skip' });
        const result = await executeMerge(state);
        const check = checkMergeResult(state, result);
        expect(check.ok).toBe(true);
        expect(check.tallies.persons).toEqual({ source: 3, merged: 1, added: 1, left: 1, lost: 0 });
        expect(check.tallies.unions.left).toBe(1);
        expect(check.tallies.links).toEqual({ source: 2, merged: 0, added: 1, left: 1, lost: 0 });
        expect(check.tallies.files.left).toBe(1);
    });

    it('finds what a broken result lost or broke', async () => {
        const state = fixture();
        const result = await executeMerge(state);
        const broken = structuredClone(result.mergedData);
        const dobromila = Object.values(broken.persons).find(p => p.firstName === 'Dobromila')!;
        delete broken.persons[dobromila.id];                       // an added person gone
        delete broken.persons['eS' as PersonId];                   // a person of the tree gone
        broken.persons['eO' as PersonId].childIds = [];            // …and the link to him
        delete broken.sources!['is1'];                             // a source gone (Hedvika's citation now dangles)
        const check = checkMergeResult(state, { mergedData: broken, trace: result.trace });
        expect(check.ok).toBe(false);
        const kinds = Object.fromEntries(check.problems.map(p => [p.kind, p.count]));
        expect(kinds.personLost).toBe(1);
        expect(kinds.targetPersonLost).toBe(1);
        expect(kinds.sourceLost).toBe(1);
        expect(kinds.danglingRef).toBeGreaterThanOrEqual(1);
        expect(check.problems.find(p => p.kind === 'personLost')!.examples).toEqual(['Dobromila Pospíchalová']);
        expect(check.problems.find(p => p.kind === 'targetPersonLost')!.examples).toEqual(['Šimon Pospíchal']);
    });

    it('dangling references the trees already had are not new', () => {
        const data = tree([P('a', 'A', 'B', { parentIds: ['ghost'], partnerships: ['nowhere'] })]);
        const refs = danglingReferences(data);
        expect(refs.get('parent')).toHaveLength(1);
        expect(refs.get('couple')).toHaveLength(1);
        const state: MergeState = {
            existingData: data, incomingData: tree([]), matches: [], unmatchedExisting: [], unmatchedIncoming: [],
            decisions: new Map(), conflictResolutions: new Map(), phase: 'executing',
        };
        expect(checkMergeResult(state, { mergedData: structuredClone(data), trace: { persons: new Map(), partnerships: new Map(), sources: new Map() } }).ok).toBe(true);
    });
});

describe('executeMerge saves nothing when the check fails', () => {
    it('a person neither matched nor listed as unmatched would be lost: no data, the problems say why', async () => {
        const state = fixture();
        // A state that forgot one incoming person (in no list, no decision).
        state.unmatchedIncoming = state.unmatchedIncoming.filter(id => id !== 'iD');
        const result = await executeMerge(state);
        expect(result.success).toBe(false);
        expect(result.mergedData).toBe(state.existingData);
        expect(result.check?.problems.map(p => p.kind)).toContain('personLost');
        expect(mergeCheckMessage(result.check!.problems))
            .toBe('The merge was not saved: 1 person from the import would be lost. The tree stays unchanged.');
    });
});

describe('mergeCheckMessage', () => {
    it('says every problem with its count, impersonally, in the UI language', () => {
        const problems = [{ kind: 'personLost' as const, count: 3 }, { kind: 'danglingRef' as const, count: 1 }];
        expect(mergeCheckMessage(problems))
            .toBe('The merge was not saved: 3 people from the import would be lost, 1 reference would point to nothing. The tree stays unchanged.');
        setLanguage('cs');
        expect(mergeCheckMessage(problems))
            .toBe('Sloučení se neuložilo: 3 osoby z importu by se ztratily, 1 odkaz by vedl do prázdna. Strom zůstal beze změny.');
        setLanguage('de');
        expect(mergeCheckMessage([{ kind: 'targetUnionLost', count: 2 }]))
            .toBe('Die Zusammenführung wurde nicht gespeichert: 2 Paare des Stammbaums würden verschwinden. Der Stammbaum bleibt unverändert.');
    });
});
