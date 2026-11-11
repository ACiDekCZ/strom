/**
 * The call number, folio and image of a source (spec 075) in the places that
 * compare or search sources: a merge keeps one entry for the same place,
 * "what will be sent" names a moved place as the page, a reading's hash
 * holds for an older source, the research is sent the fields only when it
 * says it reads them, and the sources' search finds them. Invented data.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeMerge } from '../merge/executor.js';
import { StorageManager } from '../storage.js';
import { MergeState, PersonMatch } from '../merge/types.js';
import { baseCopy, diffOther } from '../research-changes.js';
import { sourceReadingHash } from '../research-sync.js';
import { researchSendsSourceFields, SOURCES_FIELDS_FEATURE } from '../research-link.js';
import { sourcesMethods } from '../ui/sources.js';
import { composePage } from '../source-location.js';
import { StromData, Person, PersonId, Source } from '../types.js';

function person(id: string, o: Partial<Person> = {}): Person {
    return {
        id: id as PersonId, firstName: 'Ludmila', lastName: 'Vzorová', gender: 'female',
        isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...o,
    };
}

const fielded = (id: string, o: Partial<Source> = {}): Source => ({
    id, title: 'Křty Vzorov', repository: 'Zemský archiv Vzorov', callNumber: 'N 7', folio: '12v', image: '34', ...o,
});

describe('a merge keeps one entry for the same place', () => {
    beforeEach(() => {
        vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never);
    });

    const merge = async (kept: Source, incoming: Source): Promise<StromData> => {
        const e = person('e1', { sourceIds: [kept.id] });
        const i = person('i1', { sourceIds: [incoming.id] });
        const existingData: StromData = { persons: { [e.id]: e } as StromData['persons'], partnerships: {}, sources: { [kept.id]: kept } };
        const incomingData: StromData = { persons: { [i.id]: i } as StromData['persons'], partnerships: {}, sources: { [incoming.id]: incoming } };
        const match: PersonMatch = {
            existingId: e.id, incomingId: i.id, confidence: 'high', reasons: [], score: 95,
            existingPerson: e, incomingPerson: i, conflicts: [],
        };
        const state: MergeState = {
            existingData, incomingData, matches: [match], unmatchedExisting: [], unmatchedIncoming: [],
            decisions: new Map(), conflictResolutions: new Map(), phase: 'executing',
        };
        const result = await executeMerge(state);
        expect(result.success).toBe(true);
        return result.mergedData;
    };

    it('the same fields are one entry', async () => {
        const out = await merge(fielded('s1'), fielded('s9'));
        expect(Object.keys(out.sources!)).toEqual(['s1']);
    });

    it('the folio and image as words of the location match the same fields', async () => {
        const kept = fielded('s1');
        const out = await merge(kept, fielded('s9', { folio: undefined, image: undefined, reference: composePage(kept) }));
        expect(Object.keys(out.sources!)).toEqual(['s1']);
    });

    it('another folio or another call number is another entry', async () => {
        expect(Object.keys((await merge(fielded('s1'), fielded('s9', { folio: '13r' }))).sources!).sort()).toEqual(['s1', 's9']);
        expect(Object.keys((await merge(fielded('s1'), fielded('s9', { callNumber: 'N 8' }))).sources!).sort()).toEqual(['s1', 's9']);
    });
});

describe('what will be sent: the place of an entry is its page', () => {
    const data = (s: Source): StromData => ({
        persons: { p1: person('p1', { sourceIds: ['s1'] }) } as unknown as StromData['persons'],
        partnerships: {}, sources: { s1: s },
    });

    it('a changed folio, image or call number is the page, not "other"', () => {
        for (const change of [{ folio: '13r' }, { image: '35' }, { callNumber: 'N 8' }]) {
            const o = diffOther(baseCopy(data(fielded('s1'))), data(fielded('s1', change)))!;
            expect(o.sources.find(s => s.sourceId === 's1')!.kinds).toEqual(['page']);
        }
    });

    it('the same fields are no change', () => {
        expect(diffOther(baseCopy(data(fielded('s1'))), data(fielded('s1')))!.sources).toEqual([]);
    });
});

describe("a reading's hash", () => {
    it('an older source (no folio or image) hashes as before: wording and location only', () => {
        const old: Source = { id: 's1', title: 'Křty Vzorov', reference: 'fol. 12v', transcript: 'Ludmila' };
        expect(sourceReadingHash({ ...old, callNumber: 'N 7' })).toBe(sourceReadingHash(old));
        expect(sourceReadingHash({ ...old, reference: 'fol. 13r' })).not.toBe(sourceReadingHash(old));
    });

    it('a source with fields counts its folio and image', () => {
        const s = fielded('s1', { transcript: 'Ludmila' });
        expect(sourceReadingHash({ ...s, folio: '13r' })).not.toBe(sourceReadingHash(s));
        expect(sourceReadingHash({ ...s, image: '35' })).not.toBe(sourceReadingHash(s));
    });
});

describe('the research is sent the fields when it reads them', () => {
    it('only a status naming sources.fields', () => {
        expect(SOURCES_FIELDS_FEATURE).toBe('sources.fields');
        expect(researchSendsSourceFields({ features: ['sync.ids', 'sources.fields'] })).toBe(true);
        for (const status of [null, undefined, { features: null }, { features: [] }, { features: ['sync.ids', 'sources.split'] }]) {
            expect(researchSendsSourceFields(status)).toBe(false);
        }
    });
});

describe("the sources' search", () => {
    it('finds the call number, folio and image', () => {
        const s = fielded('s1');
        for (const q of ['n 7', '12v', '34', 'vzorov']) expect(sourcesMethods.sourceMatches(s, q)).toBe(true);
        expect(sourcesMethods.sourceMatches(s, '99x')).toBe(false);
    });
});
