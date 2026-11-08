/**
 * Merging a tree never says the same note text twice: the incoming note adds
 * only the parts the existing one lacks (persons, couples, sources), so
 * merging the same file again does not grow a note.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mergeNoteText } from '../merge/notes.js';
import { executeMerge, mergePersonData, mergePartnershipData } from '../merge/executor.js';
import { StorageManager } from '../storage.js';
import { MergeState, PersonMatch } from '../merge/types.js';
import { StromData, Person, Partnership, PersonId, PartnershipId, Source } from '../types.js';

function person(id: string, first: string, last: string, o: Partial<Person> = {}): Person {
    return {
        id: id as PersonId, firstName: first, lastName: last, gender: 'male',
        isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...o,
    };
}
function union(id: string, p1: string, p2: string, o: Partial<Partnership> = {}): Partnership {
    return { id: id as PartnershipId, person1Id: p1 as PersonId, person2Id: p2 as PersonId, childIds: [], status: 'married', ...o };
}

describe('mergeNoteText', () => {
    it('takes the incoming note when there is none, keeps the existing one when nothing comes', () => {
        expect(mergeNoteText(undefined, 'Farmer in Lhota')).toBe('Farmer in Lhota');
        expect(mergeNoteText('   ', 'Farmer in Lhota')).toBe('Farmer in Lhota');
        expect(mergeNoteText('Farmer in Lhota', undefined)).toBe('Farmer in Lhota');
        expect(mergeNoteText('Farmer in Lhota', ' \n ')).toBe('Farmer in Lhota');
        expect(mergeNoteText(undefined, undefined)).toBeUndefined();
    });

    it('appends a different note once, after the separator', () => {
        expect(mergeNoteText('Farmer in Lhota', 'Served in the army 1866'))
            .toBe('Farmer in Lhota\n---\nServed in the army 1866');
    });

    it('ignores whitespace and line-ending differences', () => {
        const existing = 'Farmer in Lhota.\nMarried twice.';
        expect(mergeNoteText(existing, '  Farmer   in Lhota.\r\n\r\nMarried twice.  ')).toBe(existing);
    });

    it('merging A, then A again, does not grow the note', () => {
        const once = mergeNoteText('Existing text', 'Note A');
        expect(once).toBe('Existing text\n---\nNote A');
        expect(mergeNoteText(once, 'Note A')).toBe(once);
        expect(mergeNoteText(mergeNoteText(once, 'Note A'), 'Note A')).toBe(once);
    });

    it('A, then A+B, then A+B again: B is added once and nothing more', () => {
        const a = mergeNoteText(undefined, 'Note A');
        const ab = mergeNoteText(a, 'Note A\n---\nNote B');
        expect(ab).toBe('Note A\n---\nNote B');
        expect(mergeNoteText(ab, 'Note A\n---\nNote B')).toBe(ab);
        expect(mergeNoteText(ab, 'Note A')).toBe(ab);
        expect(mergeNoteText(ab, 'Note B')).toBe(ab);
    });

    it('a note an earlier merge glued is not re-glued by merging its parts in another order', () => {
        const glued = 'Note A\n---\nNote B';
        expect(mergeNoteText(glued, 'Note B\n---\nNote A')).toBe(glued);
    });

    it('an incoming note the existing one already contains adds nothing', () => {
        const existing = 'Born in Lhota. Farmer. Married twice.';
        expect(mergeNoteText(existing, 'Farmer.')).toBe(existing);
        // Only whole words count: "1" is not said by "1850".
        expect(mergeNoteText('Born 1850', '1')).toBe('Born 1850\n---\n1');
    });

    it('an incoming part containing a whole existing part replaces it, keeping both texts', () => {
        expect(mergeNoteText('Farmer', 'Farmer in Lhota, 1850')).toBe('Farmer in Lhota, 1850');
        expect(mergeNoteText('Soldier\n---\nFarmer', 'Farmer in Lhota'))
            .toBe('Soldier\n---\nFarmer in Lhota');
        // Merging the shorter text again changes nothing.
        expect(mergeNoteText('Farmer in Lhota, 1850', 'Farmer')).toBe('Farmer in Lhota, 1850');
    });

    it('adds only the missing part of an incoming note with several parts', () => {
        expect(mergeNoteText('Note A\n---\nNote C', 'Note A\n---\nNote B'))
            .toBe('Note A\n---\nNote C\n---\nNote B');
    });

    it('a repeated part inside the incoming note is added once', () => {
        expect(mergeNoteText('Note A', 'Note B\n---\nNote B')).toBe('Note A\n---\nNote B');
    });
});

describe('merging persons and couples repeatedly', () => {
    it("a person's note does not grow when the same file is merged again", () => {
        const existing = person('e1', 'Jan', 'Novák', { notes: 'Existing note' });
        const incoming = person('i1', 'Jan', 'Novák', { notes: 'Incoming note' });
        mergePersonData(existing, incoming, []);
        const after = existing.notes;
        expect(after).toBe('Existing note\n---\nIncoming note');
        mergePersonData(existing, incoming, []);
        mergePersonData(existing, person('i1', 'Jan', 'Novák', { notes: '  Incoming\nnote ' }), []);
        expect(existing.notes).toBe(after);
    });

    it('no note on either side leaves no notes field behind', () => {
        const existing = person('e1', 'Jan', 'Novák');
        mergePersonData(existing, person('i1', 'Jan', 'Novák'), []);
        expect('notes' in existing).toBe(false);
    });

    it("a couple's note keeps both texts, each once", () => {
        const existing = union('U1', 'a', 'b', { note: 'Married in Lhota' });
        mergePartnershipData(existing, union('iU1', 'ia', 'ib', { note: 'Banns read three times' }));
        expect(existing.note).toBe('Married in Lhota\n---\nBanns read three times');
        mergePartnershipData(existing, union('iU1', 'ia', 'ib', { note: 'Banns read three times' }));
        mergePartnershipData(existing, union('iU1', 'ia', 'ib', { note: 'Married in Lhota' }));
        expect(existing.note).toBe('Married in Lhota\n---\nBanns read three times');
    });

    it("a couple's note fills a gap, and nothing on either side writes no note field", () => {
        const empty = union('U1', 'a', 'b');
        mergePartnershipData(empty, union('iU1', 'ia', 'ib', { note: 'Banns read three times' }));
        expect(empty.note).toBe('Banns read three times');
        const none = union('U2', 'a', 'b');
        mergePartnershipData(none, union('iU2', 'ia', 'ib'));
        expect('note' in none).toBe(false);
    });

    it('identical events with the same note stay one event (no note glued)', () => {
        const existing = person('e1', 'Jan', 'Novák', {
            events: [{ id: 'ev1', type: 'occupation', note: 'Blacksmith' }],
        } as Partial<Person>);
        const incoming = person('i1', 'Jan', 'Novák', {
            events: [{ id: 'ev2', type: 'occupation', note: ' Blacksmith ' }],
        } as Partial<Person>);
        mergePersonData(existing, incoming, []);
        mergePersonData(existing, incoming, []);
        expect(existing.events).toHaveLength(1);
        expect(existing.events![0].note).toBe('Blacksmith');
    });
});

describe('a deduplicated source joins its note', () => {
    beforeEach(() => {
        vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never);
    });

    const source = (id: string, note?: string): Source => ({
        id, title: 'Parish register Lhota', repository: 'Regional archive', reference: 'Book 3',
        ...(note ? { note } : {}),
    } as Source);

    const mergeOnce = async (existingData: StromData, incomingNote: string): Promise<StromData> => {
        const e = existingData.persons['e1' as PersonId];
        const i = person('i1', 'Jan', 'Novák', { sourceIds: ['s9'] });
        const incomingData: StromData = {
            persons: { ['i1' as PersonId]: i } as StromData['persons'],
            partnerships: {},
            sources: { s9: source('s9', incomingNote) },
        };
        const match: PersonMatch = {
            existingId: e.id, incomingId: i.id, confidence: 'high', reasons: [], score: 95,
            existingPerson: e, incomingPerson: i, conflicts: [],
        };
        const state: MergeState = {
            existingData, incomingData, matches: [match],
            unmatchedExisting: [], unmatchedIncoming: [],
            decisions: new Map(), conflictResolutions: new Map(), phase: 'executing',
        };
        const result = await executeMerge(state);
        expect(result.success).toBe(true);
        return result.mergedData;
    };

    it('the incoming note is added once, and merging the file again changes nothing', async () => {
        const start: StromData = {
            persons: { ['e1' as PersonId]: person('e1', 'Jan', 'Novák', { sourceIds: ['s1'] }) } as StromData['persons'],
            partnerships: {},
            sources: { s1: source('s1', 'Pages 12-14') },
        };
        const first = await mergeOnce(start, 'Entry no. 37');
        expect(Object.keys(first.sources!)).toEqual(['s1']);
        expect(first.sources!.s1.note).toBe('Pages 12-14\n---\nEntry no. 37');
        const second = await mergeOnce(first, 'Entry no. 37');
        expect(second.sources!.s1.note).toBe('Pages 12-14\n---\nEntry no. 37');
    });
});
