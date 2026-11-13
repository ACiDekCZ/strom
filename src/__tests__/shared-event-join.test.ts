/**
 * The same event recorded separately at several persons (spec 085 K1.6):
 * one match (sameEventKey / isSameEvent) for "Shared with → Add a person",
 * the person merge and Data quality; adding a person who has the event of
 * their own already joins that record (their age and own fields stay)
 * instead of a second copy, in one undo step. Invented data.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('../snapshots.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../snapshots.js')>()),
    createSnapshot: vi.fn(async () => undefined),
}));

import { DataManager } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { setLanguage } from '../strings.js';
import {
    findSeparateCopies, isSameEvent, ownSameEvent, personMergeShares, sameEventAddress, sameEventKey, shareCopiesOf, shareDivergence,
} from '../shared-events.js';
import { addToDraft, sharedDraftFor } from '../shared-event-editor.js';
import { STROM_DATA_VERSION, toPersonId, type LifeEvent, type Person, type PersonId, type StromData, type TreeId } from '../types.js';

const TREE = 'shared-join' as TreeId;
const SUDIVOJ = toPersonId('p_sudivoj');
const RADEGUNDA = toPersonId('p_radegunda');
const BOHUCHVAL = toPersonId('p_bohuchval');
const ZBYHNEV = toPersonId('p_zbyhnev');
const SPYTIHNEV = toPersonId('p_spytihnev');

const census = (id: string, extra: Partial<LifeEvent> = {}): LifeEvent =>
    ({ id, type: 'census', date: '1921-02-15', place: 'Dolní Smyšlenice', address: 'č. 14', sourceIds: ['s1'], ...extra });

function person(id: PersonId, firstName: string, gender: 'male' | 'female', events: LifeEvent[]): Person {
    return { id, firstName, lastName: 'Vrbiňák', gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], events };
}

/** A household whose census of 1921 is written at each person separately (with their age); Spytihněv's has another date. */
function household(): StromData {
    return {
        version: STROM_DATA_VERSION,
        persons: {
            [SUDIVOJ]: person(SUDIVOJ, 'Sudivoj', 'male', [census('c_o', { age: '42' })]),
            [RADEGUNDA]: person(RADEGUNDA, 'Radegunda', 'female', [census('c_l', { age: '38', note: 'manželka' })]),
            [BOHUCHVAL]: person(BOHUCHVAL, 'Bohuchval', 'male', [census('c_v', { age: '15', address: undefined })]),
            [ZBYHNEV]: person(ZBYHNEV, 'Zbyhněv', 'male', [census('c_b', { age: '11', place: ' dolní smyšlenice ' }), census('c_b2', { age: '12' })]),
            [SPYTIHNEV]: person(SPYTIHNEV, 'Spytihněv', 'male', [census('c_s', { age: '9', date: '1921-02-16' })]),
        },
        partnerships: {},
        sources: { s1: { id: 's1', title: 'Sčítání lidu 1921' }, s2: { id: 's2', title: 'Domovská matrika' } },
    } as unknown as StromData;
}

function reset(data: StromData): void {
    vi.restoreAllMocks();
    vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
    vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
    const dm = DataManager as unknown as { data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null };
    dm.data = data;
    dm.currentTreeId = TREE;
    dm.viewMode = false;
    dm.pendingBefore = null;
    UndoManager.setActiveTree(null);
    UndoManager.setActiveTree(TREE);
}

const censuses = (id: PersonId) => (DataManager.getData().persons[id].events ?? []).filter(e => e.type === 'census');

beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T10:30:00Z'));
    setLanguage('en');
});
afterAll(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('the same event: one match (K1.6)', () => {
    const a = census('a');
    it('the same shareable type, complete date and place (trimmed, one case) match', () => {
        expect(sameEventKey(a)).not.toBeNull();
        expect(isSameEvent(a, census('b', { place: '  DOLNÍ Smyšlenice ' }))).toBe(true);
        expect(isSameEvent(a, census('b', { note: 'other', sourceIds: ['s2'], age: '3' }))).toBe(true);
    });
    it('an incomplete or uncertain date never matches', () => {
        for (const date of ['1921', '1921-02', '~1921-02-15', '<1921-02-15', '1921-02-15..1921-02-20', '1921-02-15/1921-03-01', '']) {
            expect(sameEventKey(census('x', { date })), date).toBeNull();
            expect(isSameEvent(census('x', { date }), census('y', { date })), date).toBe(false);
        }
    });
    it('another type, date, place or custom label does not match; no place does not', () => {
        expect(isSameEvent(a, census('b', { type: 'residence' }))).toBe(false);
        expect(isSameEvent(a, census('b', { date: '1921-02-16' }))).toBe(false);
        expect(isSameEvent(a, census('b', { place: 'Horní Smyšlenice' }))).toBe(false);
        expect(sameEventKey(census('b', { place: '' }))).toBeNull();
        const custom = (label: string) => census('c', { type: 'custom', customLabel: label });
        expect(isSameEvent(custom('Pouť'), custom(' pouť '))).toBe(true);
        expect(isSameEvent(custom('Pouť'), custom('Posvícení'))).toBe(false);
        expect(sameEventKey(custom(''))).toBeNull();
    });
    it('a type that cannot be shared never matches', () => {
        expect(sameEventKey(census('b', { type: 'baptism' }))).toBeNull();
        expect(isSameEvent(census('b', { type: 'baptism' }), census('c', { type: 'baptism' }))).toBe(false);
    });
    it('the house: the same or written at one only matches, two different never', () => {
        expect(sameEventAddress({ address: 'č. 14' }, { address: ' Č. 14' })).toBe(true);
        expect(isSameEvent(a, census('b', { address: undefined }))).toBe(true);
        expect(isSameEvent(census('b', { address: '' }), census('c', { address: undefined }))).toBe(true);
        expect(isSameEvent(a, census('b', { address: 'č. 15' }))).toBe(false);
    });
    it('partial (a person merge): a date or a place is enough', () => {
        expect(sameEventKey(census('b', { date: '1921' }), { partial: true })).not.toBeNull();
        expect(isSameEvent(census('b', { date: '1921', place: '' }), census('c', { date: '1921', place: '' }), { partial: true })).toBe(true);
        expect(sameEventKey(census('b', { date: '', place: '' }), { partial: true })).toBeNull();
    });
    it('ownSameEvent: the first own record, never a shared copy; findSeparateCopies over the tree', () => {
        const data = household();
        expect(ownSameEvent(data.persons[ZBYHNEV], a)?.id).toBe('c_b');
        data.persons[ZBYHNEV].events![0].shareId = 'SHX';
        expect(ownSameEvent(data.persons[ZBYHNEV], a)?.id).toBe('c_b2');
        expect(ownSameEvent(data.persons[SPYTIHNEV], a)).toBeNull();
        expect(findSeparateCopies(data, a, [SUDIVOJ]).map(c => [c.personId, c.event.id]))
            .toEqual([[RADEGUNDA, 'c_l'], [BOHUCHVAL, 'c_v'], [ZBYHNEV, 'c_b2']]);
    });
    it('a person merge keeps a different house apart (both records stay)', () => {
        const keep = person(SUDIVOJ, 'Sudivoj', 'male', [census('c_o', { shareId: 'SH1', address: 'č. 14' })]);
        const dup = person(toPersonId('p_dup'), 'Sudivoj', 'male', [census('c_d', { address: 'č. 15' })]);
        const other = person(RADEGUNDA, 'Radegunda', 'female', [census('c_l', { shareId: 'SH1' })]);
        const data = { version: STROM_DATA_VERSION, persons: { [keep.id]: keep, [dup.id]: dup, [other.id]: other }, partnerships: {} } as unknown as StromData;
        expect(personMergeShares(data, keep.id, dup.id)).toEqual([]);
        dup.events![0].address = undefined;
        expect(personMergeShares(data, keep.id, dup.id)).toEqual([expect.objectContaining({ kind: 'attach', shareId: 'SH1' })]);
    });
});

describe('Shared with → Add a person: an own record of the same event joins (K1.6 a)', () => {
    it('each joined person has one census with the share and their own age; another date gets a new copy', () => {
        reset(household());
        const res = DataManager.saveSharedEvent(SUDIVOJ, 'c_o', {
            common: {}, own: new Map([[SPYTIHNEV, { age: '9' }]]),
            add: [RADEGUNDA, BOHUCHVAL, ZBYHNEV, SPYTIHNEV],
        });
        expect(res?.attached).toEqual([RADEGUNDA, BOHUCHVAL, ZBYHNEV]);
        const shareId = res!.shareId!;
        expect(censuses(RADEGUNDA)).toEqual([expect.objectContaining({ id: 'c_l', shareId, age: '38', note: 'manželka' })]);
        expect(censuses(BOHUCHVAL)).toEqual([expect.objectContaining({ id: 'c_v', shareId, age: '15' })]);
        // The first of two matching records joins, the other stays as it was.
        expect(censuses(ZBYHNEV).map(e => [e.id, e.shareId, e.age])).toEqual([['c_b', shareId, '11'], ['c_b2', undefined, '12']]);
        // Another date is another event: a new copy beside the own record.
        expect(censuses(SPYTIHNEV).map(e => [e.id === 'c_s', e.shareId ?? null, e.date])).toEqual([[true, null, '1921-02-16'], [false, shareId, '1921-02-15']]);
        expect(shareCopiesOf(DataManager.getData(), shareId)).toHaveLength(5);
    });

    it('differing common fields stay (offered to Unify), an empty own value keeps the record\'s', () => {
        reset(household());
        const res = DataManager.saveSharedEvent(SUDIVOJ, 'c_o', {
            common: {}, own: new Map([[RADEGUNDA, { age: undefined, shareRole: undefined }]]), add: [RADEGUNDA, BOHUCHVAL],
        });
        expect(censuses(RADEGUNDA)[0]).toMatchObject({ age: '38', note: 'manželka', address: 'č. 14' });
        // Radegunda's note differs from Sudivoj's: nothing overwritten, the divergence is there.
        const d = shareDivergence(DataManager.getData(), res!.shareId!);
        expect(d?.fields.map(f => f.field)).toEqual(['note']);
        // Bohuchval's record had no house: it takes the one the others have (as a person merge does).
        expect(censuses(BOHUCHVAL)[0].address).toBe('č. 14');
    });

    it('a house written only at the joined record reaches every copy; two different ones stay', () => {
        const data = household();
        delete data.persons[SUDIVOJ].events![0].address;
        reset(data);
        const res = DataManager.saveSharedEvent(SUDIVOJ, 'c_o', { common: {}, add: [ZBYHNEV, SPYTIHNEV] });
        expect(shareCopiesOf(DataManager.getData(), res!.shareId!).map(c => c.event.address)).toEqual(['č. 14', 'č. 14', 'č. 14']);
        const data2 = household();
        delete data2.persons[SUDIVOJ].events![0].address;
        data2.persons[RADEGUNDA].events![0].address = 'č. 15';
        reset(data2);
        const res2 = DataManager.saveSharedEvent(SUDIVOJ, 'c_o', { common: {}, add: [RADEGUNDA, ZBYHNEV] });
        expect(shareCopiesOf(DataManager.getData(), res2!.shareId!).map(c => c.event.address)).toEqual([undefined, 'č. 15', 'č. 14']);
    });

    it('the same source everywhere: no divergence', () => {
        const data = household();
        delete data.persons[RADEGUNDA].events![0].note;
        reset(data);
        const res = DataManager.saveSharedEvent(SUDIVOJ, 'c_o', { common: {}, add: [RADEGUNDA] });
        expect(res?.attached).toEqual([RADEGUNDA]);
        expect(shareDivergence(DataManager.getData(), res!.shareId!)).toBeNull();
    });

    it('a different source is a divergence to unify', () => {
        const data = household();
        delete data.persons[RADEGUNDA].events![0].note;
        data.persons[RADEGUNDA].events![0].sourceIds = ['s2'];
        reset(data);
        const res = DataManager.saveSharedEvent(SUDIVOJ, 'c_o', { common: {}, add: [RADEGUNDA] });
        expect(shareDivergence(DataManager.getData(), res!.shareId!)?.fields.map(f => f.field)).toEqual(['sourceIds']);
        expect(censuses(RADEGUNDA)[0].sourceIds).toEqual(['s2']);
    });

    it('one undo takes the joins and the new copy back', () => {
        const before = household();
        reset(structuredClone(before));
        DataManager.saveSharedEvent(SUDIVOJ, 'c_o', { common: {}, add: [RADEGUNDA, BOHUCHVAL, ZBYHNEV, SPYTIHNEV] });
        DataManager.undo();
        expect(DataManager.getData().persons).toEqual(before.persons);
    });

    it('a new event of the editor (addSharedEvent) joins the others\' records too', () => {
        const data = household();
        data.persons[SUDIVOJ].events = [];
        reset(data);
        const res = DataManager.addSharedEvent(SUDIVOJ, census('x', { age: '42' }), { common: {}, add: [RADEGUNDA, BOHUCHVAL] });
        expect(res?.result.attached).toEqual([RADEGUNDA, BOHUCHVAL]);
        expect(censuses(RADEGUNDA)).toHaveLength(1);
        expect(censuses(BOHUCHVAL)).toHaveLength(1);
    });

    it('the editor\'s row of a joining person starts with the record\'s age and role', () => {
        const data = household();
        data.persons[RADEGUNDA].events![0].shareRole = 'manželka';
        const draft = sharedDraftFor(data, SUDIVOJ, data.persons[SUDIVOJ].events![0]);
        addToDraft(draft, [RADEGUNDA, SPYTIHNEV], new Map([[RADEGUNDA, data.persons[RADEGUNDA].events![0]]]));
        expect(draft.rows).toEqual([
            { personId: RADEGUNDA, role: 'manželka', age: '38', added: true },
            { personId: SPYTIHNEV, role: '', age: '', added: true },
        ]);
    });
});
