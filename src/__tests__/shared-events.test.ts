/**
 * One event of several persons (spec 085, data version 20): a copy at each
 * person with a common share id, written to every copy in one undo step;
 * the index of copies and of linked participants; copies that went apart;
 * the cleaning on load and the update of a stored tree (nothing joined, a
 * backup first). Invented data.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('../snapshots.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../snapshots.js')>()),
    createSnapshot: vi.fn(async () => undefined),
}));
const kept = new Map<string, unknown>();
vi.mock('../share-baselines.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../share-baselines.js')>()),
    saveBaseline: vi.fn(async (_t: string, id: string, data: unknown) => { kept.set(id, JSON.parse(JSON.stringify(data))); return true; }),
    loadBaseline: vi.fn(async (id: string) => kept.has(id) ? structuredClone(kept.get(id)) : null),
}));

import { DataManager, migrateData } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { createSnapshot } from '../snapshots.js';
import { cloneTreeData } from '../clone.js';
import { saveResearchCopy, loadResearchCopy } from '../research-copy.js';
import { validateJsonImport } from '../merge/validation.js';
import { eventIsShareable, SELECTABLE_EVENT_TYPES } from '../events.js';
import {
    buildSharedEventIndex, cleanEventShares, findDivergentShares, isValidShareId, newShareIdFor,
    personSharedEvents, sharedWith, MARRIAGE_EVENT_ID,
} from '../shared-events.js';
import {
    StromData, Person, PersonId, PartnershipId, TreeId, LifeEvent, EmbeddedDataEnvelope, STROM_DATA_VERSION,
    toPersonId, toPartnershipId,
} from '../types.js';
import { strings, getStringsForLang } from '../strings.js';

const TREE = 'shared-events' as TreeId;
const KVIDO = toPersonId('p_kvido');
const RADEGUNDA = toPersonId('p_radegunda');
const BOHUCHVAL = toPersonId('p_bohuchval');
const ZBYHNEV = toPersonId('p_zbyhnev');
const MLCOCH = toPersonId('p_mlcoch');
const UNION = toPartnershipId('u_kvido_radegunda');

function person(id: PersonId, firstName: string, lastName: string, gender: 'male' | 'female', extra: Partial<Person> = {}): Person {
    return { id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra };
}

/** A household of four and a neighbour; Kvido has the census of 1921 alone, with its source and the age. */
function household(): StromData {
    return {
        version: STROM_DATA_VERSION,
        persons: {
            [KVIDO]: person(KVIDO, 'Kvido', 'Hurdálek', 'male', { birthDate: '1879', partnerships: [UNION], childIds: [BOHUCHVAL, ZBYHNEV],
                events: [{ id: 'ev_1', type: 'census', date: '1921-02-15', place: 'Dolní Smyšlenice', address: 'č. 14', age: '42',
                    sourceIds: ['s1'], citationQuay: { sourceIds: { s1: 3 } }, status: 'proven' }] }),
            [RADEGUNDA]: person(RADEGUNDA, 'Radegunda', 'Hurdálková', 'female', { birthDate: '1883', partnerships: [UNION], childIds: [BOHUCHVAL, ZBYHNEV] }),
            [BOHUCHVAL]: person(BOHUCHVAL, 'Bohuchval', 'Hurdálek', 'male', { birthDate: '1906', parentIds: [KVIDO, RADEGUNDA],
                events: [{ id: 'ev_bapt_b', type: 'baptism', date: '1906-05-02', participants: [{ id: 'pt1', role: 'godparent', personId: MLCOCH }] }] }),
            [ZBYHNEV]: person(ZBYHNEV, 'Zbyhněv', 'Hurdálek', 'male', { birthDate: '1910', parentIds: [KVIDO, RADEGUNDA] }),
            [MLCOCH]: person(MLCOCH, 'Bohuchval', 'Mlčoch', 'male', { birthDate: '1870' }),
        },
        partnerships: {
            [UNION]: { id: UNION, person1Id: KVIDO, person2Id: RADEGUNDA, childIds: [BOHUCHVAL, ZBYHNEV], status: 'married',
                participants: [{ id: 'pt2', role: 'witness', personId: MLCOCH }] },
        },
        sources: { s1: { id: 's1', title: 'Census 1921, Dolní Smyšlenice', quality: 2 } },
    };
}

function reset(data: StromData = household()): void {
    vi.restoreAllMocks();
    vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
    vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
    const dm = DataManager as unknown as {
        data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null;
    };
    dm.data = data;
    dm.currentTreeId = TREE;
    dm.viewMode = false;
    dm.pendingBefore = null;
    UndoManager.setActiveTree(null);
    UndoManager.setActiveTree(TREE);
}

const data = (): StromData => DataManager.getData();
const eventsOf = (pid: PersonId): LifeEvent[] => data().persons[pid]?.events ?? [];
const censusOf = (pid: PersonId): LifeEvent | undefined => eventsOf(pid).find(e => e.type === 'census');

/** Kvido's census shared with Radegunda and both sons, an age each. */
function shareCensus(): string {
    const res = DataManager.saveSharedEvent(KVIDO, 'ev_1', {
        common: {},
        own: new Map([[RADEGUNDA, { age: '38' }], [BOHUCHVAL, { age: '15' }], [ZBYHNEV, { age: '11', shareRole: 'son' }]]),
        add: [RADEGUNDA, BOHUCHVAL, ZBYHNEV],
    });
    expect(res).not.toBeNull();
    return res!.shareId!;
}

// ==================== types ====================

describe('event types (spec 085)', () => {
    it('only events that happened to everyone can be shared', () => {
        for (const t of ['census', 'residence', 'emigration', 'immigration', 'military', 'naturalization', 'custom']) {
            expect(eventIsShareable(t)).toBe(true);
        }
        for (const t of ['birth', 'death', 'baptism', 'burial', 'occupation', 'godparent', 'weddingWitness', 'marriage', undefined]) {
            expect(eventIsShareable(t)).toBe(false);
        }
    });

    it('godparent and wedding witness are types of their own, named in every language', () => {
        expect(SELECTABLE_EVENT_TYPES).toContain('godparent');
        expect(SELECTABLE_EVENT_TYPES).toContain('weddingWitness');
        expect(strings.events.types.godparent).toBe('Godparent');
        expect(getStringsForLang('cs').events.types.godparent).toBe('Kmotrovství');
        expect(getStringsForLang('de').events.types.weddingWitness).toBe('Trauzeuge');
        expect(getStringsForLang('pl').events.types.weddingWitness).toBe('Świadek ślubu');
    });

    it('a new share id is 8 letters or digits, none the tree has', () => {
        const d = household();
        const ids = new Set<string>();
        for (let i = 0; i < 200; i++) {
            const id = newShareIdFor(d);
            expect(id).toMatch(/^[A-Za-z0-9]{8}$/);
            ids.add(id);
        }
        expect(ids.size).toBe(200);
        expect(isValidShareId('SH7K2QX')).toBe(true);
        expect(isValidShareId('SH-7')).toBe(false);
        expect(isValidShareId('x'.repeat(65))).toBe(false);
    });
});

// ==================== DataManager ====================

describe('DataManager: a shared event is written to every copy in one step', () => {
    beforeEach(() => reset());

    it('three persons added to a census: four copies of one share, sources and citations at all, each its own age', () => {
        const shareId = shareCensus();
        expect(shareId).toMatch(/^[A-Za-z0-9]{4,16}$/);
        for (const pid of [KVIDO, RADEGUNDA, BOHUCHVAL, ZBYHNEV]) {
            const ev = censusOf(pid)!;
            expect(ev.shareId).toBe(shareId);
            expect(ev.date).toBe('1921-02-15');
            expect(ev.place).toBe('Dolní Smyšlenice');
            expect(ev.address).toBe('č. 14');
            expect(ev.sourceIds).toEqual(['s1']);
            expect(ev.citationQuay).toEqual({ sourceIds: { s1: 3 } });
        }
        expect(eventsOf(KVIDO).map(e => e.age)).toEqual(['42']);
        expect(censusOf(RADEGUNDA)!.age).toBe('38');
        expect(censusOf(ZBYHNEV)!.age).toBe('11');
        expect(censusOf(ZBYHNEV)!.shareRole).toBe('son');
        // A new copy: a new id, entered by hand (no status of the research).
        expect(censusOf(RADEGUNDA)!.id).not.toBe('ev_1');
        expect(censusOf(RADEGUNDA)!.status).toBeUndefined();
        expect(censusOf(KVIDO)!.status).toBe('proven');
        // One undo step takes all of it back.
        DataManager.undo();
        expect(censusOf(KVIDO)!.shareId).toBeUndefined();
        expect(censusOf(RADEGUNDA)).toBeUndefined();
        expect(censusOf(ZBYHNEV)).toBeUndefined();
    });

    it('a changed date goes to every copy; one undo brings every copy back', () => {
        shareCensus();
        const res = DataManager.saveSharedEvent(RADEGUNDA, censusOf(RADEGUNDA)!.id, { common: { date: '1921-02-16' } });
        expect(res?.personIds).toEqual([KVIDO, RADEGUNDA, BOHUCHVAL, ZBYHNEV]);
        for (const pid of [KVIDO, RADEGUNDA, BOHUCHVAL, ZBYHNEV]) expect(censusOf(pid)!.date).toBe('1921-02-16');
        // The ages stay each copy's own.
        expect(censusOf(KVIDO)!.age).toBe('42');
        DataManager.undo();
        for (const pid of [KVIDO, RADEGUNDA, BOHUCHVAL, ZBYHNEV]) expect(censusOf(pid)!.date).toBe('1921-02-15');
    });

    it('a field left out is not written: a copy that differs keeps its value', () => {
        shareCensus();
        censusOf(BOHUCHVAL)!.note = 'listed as a pupil';
        DataManager.saveSharedEvent(KVIDO, 'ev_1', { common: { place: 'Horní Smyšlenice' } });
        expect(censusOf(BOHUCHVAL)!.note).toBe('listed as a pupil');
        expect(censusOf(BOHUCHVAL)!.place).toBe('Horní Smyšlenice');
    });

    it('removed: that copy goes, the others stay as they were', () => {
        const shareId = shareCensus();
        const before = structuredClone([censusOf(KVIDO), censusOf(RADEGUNDA), censusOf(ZBYHNEV)]);
        DataManager.saveSharedEvent(KVIDO, 'ev_1', { common: {}, remove: [BOHUCHVAL] });
        expect(censusOf(BOHUCHVAL)).toBeUndefined();
        expect([censusOf(KVIDO), censusOf(RADEGUNDA), censusOf(ZBYHNEV)]).toEqual(before);
        expect(censusOf(KVIDO)!.shareId).toBe(shareId);
        // The baptism of Bohuchval is untouched.
        expect(eventsOf(BOHUCHVAL).map(e => e.type)).toEqual(['baptism']);
    });

    it('separated: the copy loses the share and keeps its values from before the edit', () => {
        shareCensus();
        DataManager.saveSharedEvent(KVIDO, 'ev_1', { common: { date: '1921-03-01' }, separate: [ZBYHNEV] });
        const z = censusOf(ZBYHNEV)!;
        expect(z.shareId).toBeUndefined();
        expect(z.shareRole).toBeUndefined();
        expect(z.date).toBe('1921-02-15');
        expect(z.age).toBe('11');
        expect(censusOf(RADEGUNDA)!.date).toBe('1921-03-01');
    });

    it('one copy left: the share is gone, an ordinary event', () => {
        DataManager.saveSharedEvent(KVIDO, 'ev_1', { common: {}, add: [RADEGUNDA] });
        expect(censusOf(KVIDO)!.shareId).toBeDefined();
        const res = DataManager.saveSharedEvent(KVIDO, 'ev_1', { common: {}, remove: [RADEGUNDA] });
        expect(res).toEqual({ shareId: null, personIds: [KVIDO] });
        expect(censusOf(KVIDO)!.shareId).toBeUndefined();
        expect(censusOf(RADEGUNDA)).toBeUndefined();
    });

    it('a type that cannot be shared is refused for two copies; birth and a locked person too', () => {
        shareCensus();
        expect(DataManager.saveSharedEvent(KVIDO, 'ev_1', { common: { type: 'baptism' } })).toBeNull();
        expect(DataManager.updateSharedCommonField(KVIDO, 'ev_1', 'type', 'baptism')).toBe(0);
        data().persons[RADEGUNDA].isLocked = true;
        expect(DataManager.saveSharedEvent(KVIDO, 'ev_1', { common: { date: '1921' } })).toBeNull();
        expect(censusOf(KVIDO)!.date).toBe('1921-02-15');
    });

    it('separateFromShared: own edits go to that copy alone; the rest keep the share', () => {
        const shareId = shareCensus();
        expect(DataManager.separateFromShared(RADEGUNDA, censusOf(RADEGUNDA)!.id, { note: 'away at the time' })).toBe(true);
        expect(censusOf(RADEGUNDA)!.shareId).toBeUndefined();
        expect(censusOf(RADEGUNDA)!.note).toBe('away at the time');
        expect(censusOf(KVIDO)!.note).toBeUndefined();
        expect(censusOf(KVIDO)!.shareId).toBe(shareId);
    });

    it('removeFromShared, then the last but one: the share goes with it', () => {
        DataManager.saveSharedEvent(KVIDO, 'ev_1', { common: {}, add: [RADEGUNDA] });
        expect(DataManager.removeFromShared(RADEGUNDA, censusOf(RADEGUNDA)!.id)).toBe(true);
        expect(censusOf(RADEGUNDA)).toBeUndefined();
        expect(censusOf(KVIDO)!.shareId).toBeUndefined();
        DataManager.undo();
        expect(censusOf(RADEGUNDA)!.shareId).toBe(censusOf(KVIDO)!.shareId);
    });

    it('deleteSharedForAll: every copy goes in one step', () => {
        const shareId = shareCensus();
        expect(DataManager.deleteSharedForAll(shareId)).toBe(4);
        for (const pid of [KVIDO, RADEGUNDA, BOHUCHVAL, ZBYHNEV]) expect(censusOf(pid)).toBeUndefined();
        DataManager.undo();
        for (const pid of [KVIDO, RADEGUNDA, BOHUCHVAL, ZBYHNEV]) expect(censusOf(pid)!.shareId).toBe(shareId);
    });

    it('unify and separate copies', () => {
        const shareId = shareCensus();
        censusOf(ZBYHNEV)!.place = 'Horní Smyšlenice';
        expect(findDivergentShares(data())).toHaveLength(1);
        expect(DataManager.unifySharedCopies(shareId, { place: 'Dolní Smyšlenice' })).toBe(4);
        expect(findDivergentShares(data())).toHaveLength(0);
        expect(DataManager.separateCopies(shareId, [BOHUCHVAL, ZBYHNEV])).toBe(2);
        expect(censusOf(BOHUCHVAL)!.shareId).toBeUndefined();
        expect(censusOf(KVIDO)!.shareId).toBe(shareId);
        expect(DataManager.separateCopies(shareId, [RADEGUNDA])).toBe(1);
        // Kvido alone: no share left.
        expect(censusOf(KVIDO)!.shareId).toBeUndefined();
    });

    it('updateSharedCommonField writes every copy of a shared event, one of an event alone', () => {
        shareCensus();
        expect(DataManager.updateSharedCommonField(BOHUCHVAL, censusOf(BOHUCHVAL)!.id, 'address', 'č. 15')).toBe(4);
        for (const pid of [KVIDO, RADEGUNDA, BOHUCHVAL, ZBYHNEV]) expect(censusOf(pid)!.address).toBe('č. 15');
        expect(DataManager.updateSharedCommonField(BOHUCHVAL, censusOf(BOHUCHVAL)!.id, 'sourceIds', [])).toBe(4);
        expect(censusOf(KVIDO)!.sourceIds).toBeUndefined();
        DataManager.undo();
        expect(censusOf(KVIDO)!.sourceIds).toEqual(['s1']);
        expect(DataManager.updateSharedCommonField(BOHUCHVAL, 'ev_bapt_b', 'date', '1906-05-03')).toBe(1);
        expect(eventsOf(BOHUCHVAL).find(e => e.id === 'ev_bapt_b')!.date).toBe('1906-05-03');
    });

    it('deleting a person takes its copies; a share left with one copy goes; the list for the confirmation', () => {
        DataManager.saveSharedEvent(KVIDO, 'ev_1', { common: {}, add: [ZBYHNEV] });
        const shared = DataManager.personSharedEvents(ZBYHNEV);
        expect(shared).toEqual([expect.objectContaining({ type: 'census', year: 1921, otherPersonIds: [KVIDO] })]);
        expect(DataManager.personSharedEvents(RADEGUNDA)).toEqual([]);
        DataManager.deletePerson(ZBYHNEV);
        expect(censusOf(KVIDO)!.shareId).toBeUndefined();
        expect(censusOf(KVIDO)!.date).toBe('1921-02-15');
    });

    it('deleting one of four keeps the share of the other three', () => {
        const shareId = shareCensus();
        DataManager.deletePerson(ZBYHNEV);
        for (const pid of [KVIDO, RADEGUNDA, BOHUCHVAL]) expect(censusOf(pid)!.shareId).toBe(shareId);
    });

    it('newShareId is unique in the open tree', () => {
        const shareId = shareCensus();
        expect(DataManager.newShareId()).not.toBe(shareId);
    });
});

// ==================== index ====================

describe('the index of copies and participants', () => {
    beforeEach(() => reset());

    it('lists the copies in the order persons were added and the participants of every kind of event', () => {
        const shareId = shareCensus();
        const index = DataManager.getSharedEventIndex();
        expect(index.shares.get(shareId)!.map(c => c.personId)).toEqual([KVIDO, RADEGUNDA, BOHUCHVAL, ZBYHNEV]);
        expect(sharedWith(index, BOHUCHVAL, censusOf(BOHUCHVAL)!.id)).toEqual([KVIDO, RADEGUNDA, ZBYHNEV]);
        expect(sharedWith(index, BOHUCHVAL, 'ev_bapt_b')).toEqual([]);
        expect(index.participations.get(MLCOCH)).toEqual([
            { ownerPersonId: BOHUCHVAL, eventId: 'ev_bapt_b', eventType: 'baptism', role: 'godparent', participantId: 'pt1' },
            { partnershipId: UNION, eventId: MARRIAGE_EVENT_ID, eventType: 'marriage', role: 'witness', participantId: 'pt2' },
        ]);
        // Built once per state of the data.
        expect(DataManager.getSharedEventIndex()).toBe(index);
        DataManager.updateSharedCommonField(KVIDO, 'ev_1', 'note', 'x');
        expect(DataManager.getSharedEventIndex()).not.toBe(index);
    });

    it('without an order of addition (an imported file), the persons\' order in the data', () => {
        const d = household();
        d.persons[ZBYHNEV].events = [{ id: 'I5-e1', type: 'residence', place: 'Dolní Smyšlenice', shareId: 'AB12' }];
        d.persons[KVIDO].events = [{ id: 'I1-e1', type: 'residence', place: 'Dolní Smyšlenice', shareId: 'AB12' }];
        expect(buildSharedEventIndex(d).shares.get('AB12')!.map(c => c.personId)).toEqual([KVIDO, ZBYHNEV]);
    });

    it('two same copies at one person are one entry; a share of one person alone is none', () => {
        const d = household();
        const copy: LifeEvent = { id: 'e1', type: 'census', date: '1921', place: 'Dolní Smyšlenice', shareId: 'AB12' };
        d.persons[KVIDO].events = [copy, { ...copy, id: 'e2', age: '41' }];
        const index = buildSharedEventIndex(d);
        expect(index.shares.has('AB12')).toBe(false);
        expect(findDivergentShares(d)).toEqual([]);
        d.persons[RADEGUNDA].events = [{ ...copy, id: 'e3' }];
        expect(buildSharedEventIndex(d).shares.get('AB12')).toEqual([{ personId: KVIDO, eventId: 'e1' }, { personId: RADEGUNDA, eventId: 'e3' }]);
        expect(personSharedEvents(d, buildSharedEventIndex(d), KVIDO)).toHaveLength(1);
    });
});

// ==================== copies that went apart ====================

describe('findDivergentShares', () => {
    function threeCopies(): StromData {
        const d = household();
        const base: LifeEvent = { id: 'x', type: 'residence', date: '1925', place: 'Dolní Smyšlenice', sourceIds: ['s1', 's2'], shareId: 'RES1' };
        d.persons[KVIDO].events = [{ ...base, id: 'k', age: '46', status: 'proven' }];
        d.persons[RADEGUNDA].events = [{ ...base, id: 'r', sourceIds: ['s2', 's1'], shareRole: 'wife', age: '42' }];
        d.persons[BOHUCHVAL].events = [{ ...base, id: 'b' }];
        return d;
    }

    it('the same common fields: nothing (age, role, status and the order of sources are not compared)', () => {
        expect(findDivergentShares(threeCopies())).toEqual([]);
    });

    it('one copy differs in one field: that field, each value with its copies, the most copies first', () => {
        const d = threeCopies();
        d.persons[BOHUCHVAL].events![0].place = 'Horní Smyšlenice';
        expect(findDivergentShares(d)).toEqual([{
            shareId: 'RES1',
            copies: [{ personId: KVIDO, eventId: 'k' }, { personId: RADEGUNDA, eventId: 'r' }, { personId: BOHUCHVAL, eventId: 'b' }],
            fields: [{ field: 'place', values: [
                { value: 'Dolní Smyšlenice', copies: [{ personId: KVIDO, eventId: 'k' }, { personId: RADEGUNDA, eventId: 'r' }] },
                { value: 'Horní Smyšlenice', copies: [{ personId: BOHUCHVAL, eventId: 'b' }] },
            ] }],
        }]);
    });

    it('more fields differ: each of them (date, note, sources, citation QUAY)', () => {
        const d = threeCopies();
        d.persons[KVIDO].events![0].date = '1926';
        d.persons[RADEGUNDA].events![0].note = 'by the mill';
        d.persons[BOHUCHVAL].events![0].sourceIds = ['s1'];
        d.persons[RADEGUNDA].events![0].citationQuay = { sourceIds: { s1: 1 } };
        const [found] = findDivergentShares(d);
        expect(found.fields.map(f => f.field)).toEqual(['date', 'note', 'sourceIds', 'citationQuay']);
    });

    it('two copies at one person that differ are told like any other', () => {
        const d = household();
        const copy: LifeEvent = { id: 'e1', type: 'census', date: '1921', shareId: 'AB12' };
        d.persons[KVIDO].events = [copy, { ...copy, id: 'e2', date: '1920' }];
        const [found] = findDivergentShares(d);
        expect(found.fields).toEqual([{ field: 'date', values: [
            { value: '1921', copies: [{ personId: KVIDO, eventId: 'e1' }] },
            { value: '1920', copies: [{ personId: KVIDO, eventId: 'e2' }] },
        ] }]);
    });
});

// ==================== cleaning on load ====================

describe('data version 20: cleaning on load', () => {
    it('an invalid share id, one of a type that is not shared and one only one copy has go; valid ones stay', () => {
        const d = household();
        d.persons[KVIDO].events = [
            { id: 'a', type: 'census', date: '1921', shareId: 'bad id!' },
            { id: 'b', type: 'baptism', date: '1879', shareId: 'BAPT1' },
            { id: 'c', type: 'residence', date: '1930', shareId: 'LONE1', shareRole: 'head' },
            { id: 'd', type: 'residence', date: '1925', shareId: 'RES1', shareRole: '  ' },
        ];
        d.persons[RADEGUNDA].events = [
            { id: 'e', type: 'baptism', date: '1883', shareId: 'BAPT1' },
            { id: 'f', type: 'residence', date: '1925', shareId: 'RES1', shareRole: 'wife' },
        ];
        const loaded = migrateData(d);
        const k = loaded.persons[KVIDO].events!;
        expect(k.map(e => e.shareId)).toEqual([undefined, undefined, undefined, 'RES1']);
        expect(k[2].shareRole).toBeUndefined();
        expect(k[3].shareRole).toBeUndefined();
        expect(loaded.persons[RADEGUNDA].events!.map(e => [e.shareId, e.shareRole])).toEqual([[undefined, undefined], ['RES1', 'wife']]);
    });

    it('roleAt: an unknown role is "other", a link to someone not in the tree goes, the role stays', () => {
        const d = household();
        d.persons[MLCOCH].events = [
            { id: 'g1', type: 'godparent', roleAt: { role: 'midwife' as never, personId: BOHUCHVAL, eventType: 'baptism', eventId: 'ev_bapt_b' } },
            { id: 'g2', type: 'godparent', roleAt: { role: 'godparent', personId: toPersonId('p_gone'), partnershipId: 'u_gone' as PartnershipId, eventType: 'baptism' } },
            { id: 'g3', type: 'weddingWitness', roleAt: { role: 'witness', partnershipId: UNION, eventType: 'marriage', eventId: MARRIAGE_EVENT_ID } },
        ];
        d.persons[BOHUCHVAL].events![0].participants![0].linkRejected = [KVIDO, toPersonId('p_gone')];
        const loaded = migrateData(d);
        expect(loaded.persons[MLCOCH].events!.map(e => e.roleAt)).toEqual([
            { role: 'other', personId: BOHUCHVAL, eventType: 'baptism', eventId: 'ev_bapt_b' },
            { role: 'godparent', eventType: 'baptism' },
            { role: 'witness', partnershipId: UNION, eventType: 'marriage', eventId: MARRIAGE_EVENT_ID },
        ]);
        expect(loaded.persons[BOHUCHVAL].events![0].participants![0].linkRejected).toEqual([KVIDO]);
    });

    it('a tree of version 19 with the same residence at two persons and godparents by name is not changed', () => {
        const d = household();
        d.version = 19;
        d.persons[KVIDO].events!.push({ id: 'r1', type: 'residence', date: '1925', place: 'Dolní Smyšlenice', address: 'č. 14' });
        d.persons[RADEGUNDA].events = [{ id: 'r2', type: 'residence', date: '1925', place: 'Dolní Smyšlenice', address: 'č. 14' }];
        d.persons[ZBYHNEV].events = [{ id: 'bz', type: 'baptism', date: '1910', participants: [{ id: 'pt9', role: 'godparent', name: 'Bohuchval Mlčoch' }] }];
        const before = structuredClone(d);
        expect(cleanEventShares(d)).toBe(0);
        const { version: _v, ...loaded } = { ...migrateData(structuredClone(d)) } as StromData;
        const { version: _w, ...expected } = before;
        expect(loaded).toEqual(expected);
    });
});

describe('data version 20: a stored tree of an older version', () => {
    let saved: StromData[];
    beforeEach(() => {
        saved = [];
        vi.mocked(createSnapshot).mockClear();
        vi.spyOn(TreeManager, 'saveTreeData').mockImplementation((_id, d) => { saved.push(JSON.parse(JSON.stringify(d))); });
    });
    afterEach(() => { vi.restoreAllMocks(); });

    function readStored(d: StromData) {
        vi.spyOn(TreeManager as unknown as { readTreeRecord: () => Promise<unknown> }, 'readTreeRecord')
            .mockResolvedValue({ status: 'ok', data: d });
        return TreeManager.readTreeData('v19-tree' as TreeId);
    }

    it('is backed up first, saved once and unchanged but for its version', async () => {
        const d = household();
        d.version = 19;
        d.persons[KVIDO].events!.push({ id: 'r1', type: 'residence', date: '1925', place: 'Dolní Smyšlenice' });
        d.persons[RADEGUNDA].events = [{ id: 'r2', type: 'residence', date: '1925', place: 'Dolní Smyšlenice' }];
        d.persons[ZBYHNEV].events = [{ id: 'bz', type: 'baptism', participants: [{ id: 'pt9', role: 'godparent', name: 'Bohuchval Mlčoch' }] }];
        const before = structuredClone(d);
        const result = await readStored(d);
        if (result.status !== 'ok') throw new Error(result.status);
        expect(createSnapshot).toHaveBeenCalledTimes(1);
        expect(vi.mocked(createSnapshot).mock.calls[0][2]).toBe('pre-migration');
        expect(vi.mocked(createSnapshot).mock.calls[0][1]).toEqual(before);
        expect(saved).toHaveLength(1);
        const { version: _v, ...after } = saved[0];
        const { version: _w, ...expected } = before;
        expect(after).toEqual(expected);
    });

    it('a v20 tree and an empty older tree are neither backed up nor saved', async () => {
        await readStored(household());
        const empty: StromData = { version: 19, persons: {}, partnerships: {} };
        await readStored(empty);
        expect(createSnapshot).not.toHaveBeenCalled();
        expect(saved).toHaveLength(0);
    });
});

// ==================== the new fields everywhere ====================

describe('the new fields survive every way a tree travels', () => {
    function sharedTree(): StromData {
        const d = household();
        d.persons[KVIDO].events![0].shareId = 'SH7K2QX';
        d.persons[RADEGUNDA].events = [{ id: 'ev_2', type: 'census', date: '1921-02-15', place: 'Dolní Smyšlenice', shareId: 'SH7K2QX', shareRole: 'wife' }];
        d.persons[MLCOCH].events = [{ id: 'g', type: 'godparent', roleAt: { role: 'godparent', personId: BOHUCHVAL, eventType: 'baptism', eventId: 'ev_bapt_b' } }];
        d.persons[ZBYHNEV].events = [{ id: 'bz', type: 'baptism', participants: [{ id: 'pt9', role: 'godparent', name: 'Bohuchval Mlčoch', linkRejected: [MLCOCH] }] }];
        return d;
    }
    const persons = (d: StromData | null | undefined) => d?.persons;

    it('a load, an import of the JSON file and a save', () => {
        const d = sharedTree();
        expect(persons(migrateData(structuredClone(d)))).toEqual(d.persons);
        const imported = validateJsonImport(JSON.stringify(d));
        expect(imported.valid).toBe(true);
        expect(persons(imported.data)).toEqual(d.persons);
        expect(persons(migrateData(JSON.parse(JSON.stringify(migrateData(structuredClone(d))))))).toEqual(d.persons);
    });

    it('a snapshot (undo, backups) and the envelope of an exported file', () => {
        const d = sharedTree();
        expect(persons(cloneTreeData(d))).toEqual(d.persons);
        const envelope: EmbeddedDataEnvelope = { exportId: 'x', appVersion: '3.28.0', exportedAt: '2026-11-13T10:00:00Z', data: d } as EmbeddedDataEnvelope;
        expect(persons(migrateData(JSON.parse(JSON.stringify(envelope)).data))).toEqual(d.persons);
    });

    it('undo restores them', () => {
        reset(sharedTree());
        const before = structuredClone(DataManager.getData().persons);
        DataManager.updateSharedCommonField(KVIDO, 'ev_1', 'place', 'Horní Smyšlenice');
        DataManager.undo();
        expect(DataManager.getData().persons).toEqual(before);
    });

    it('the kept copy of the research\'s version', async () => {
        const d = sharedTree();
        await saveResearchCopy('t1', d, 'fp1');
        expect(persons(await loadResearchCopy('t1', 'fp1'))).toEqual(d.persons);
    });
});
