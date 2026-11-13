/**
 * Data quality's "recorded separately at N people → Join into one event"
 * (spec 085 K1.6 b): the groups over the whole tree come from the one match
 * of the same event (sameEventKey, sameEventAddress), the join keeps each
 * person's age and own fields in one undo step, a share there already takes
 * the others in, and nothing is ever joined by itself (the data update and
 * the check leave the records as they are). Invented data.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('../snapshots.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../snapshots.js')>()),
    createSnapshot: vi.fn(async () => undefined),
}));

import { DataManager, migrateData } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { setLanguage } from '../strings.js';
import { findSeparateSameEvents, shareCopiesOf, shareDivergence } from '../shared-events.js';
import { validateTreeData } from '../validation.js';
import { STROM_DATA_VERSION, toPersonId, type LifeEvent, type Person, type PersonId, type StromData, type TreeId } from '../types.js';

const TREE = 'shared-quality-join' as TreeId;
const DOBROSLAV = toPersonId('p_dobroslav');
const MSTISLAVA = toPersonId('p_mstislava');
const HOSTIVIT = toPersonId('p_hostivit');
const BOLESLAVA = toPersonId('p_boleslava');

const census = (id: string, extra: Partial<LifeEvent> = {}): LifeEvent =>
    ({ id, type: 'census', date: '1921-02-15', place: 'Horní Vymyšlenice', address: 'č. 7', sourceIds: ['s1'], ...extra });

function person(id: PersonId, firstName: string, gender: 'male' | 'female', events: LifeEvent[]): Person {
    return { id, firstName, lastName: 'Drahoňovský', gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], events };
}

/** Three persons with the census of 1921 written at each separately (their ages); Boleslava has none. */
function household(edit: (events: Record<string, LifeEvent>) => void = () => {}): StromData {
    const events: Record<string, LifeEvent> = {
        d: census('c_d', { age: '44' }),
        l: census('c_l', { age: '40', shareRole: undefined }),
        v: census('c_v', { age: '12', address: undefined }),
    };
    edit(events);
    return {
        version: STROM_DATA_VERSION,
        persons: {
            [DOBROSLAV]: person(DOBROSLAV, 'Dobroslav', 'male', [events.d]),
            [MSTISLAVA]: person(MSTISLAVA, 'Mstislava', 'female', [events.l]),
            [HOSTIVIT]: person(HOSTIVIT, 'Hostivít', 'male', [events.v]),
            [BOLESLAVA]: person(BOLESLAVA, 'Boleslava', 'female', []),
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

describe('the groups over the tree (K1.6 b)', () => {
    it('three persons with the same census are one group, and one lead of Data quality', () => {
        const data = household();
        const groups = findSeparateSameEvents(data);
        expect(groups).toHaveLength(1);
        expect(groups[0].shareId).toBeNull();
        expect(groups[0].persons).toEqual([DOBROSLAV, MSTISLAVA, HOSTIVIT]);
        // The record joined into is one with the house written.
        expect(groups[0].target.event.address).toBe('č. 7');
        const leads = validateTreeData(data).issues.filter(i => i.type === 'separateSameEvent');
        expect(leads).toHaveLength(1);
        expect(leads[0].severity).toBe('info');
        expect(leads[0].personIds).toEqual([DOBROSLAV, MSTISLAVA, HOSTIVIT]);
    });

    it('an incomplete date, another place or another house makes no group', () => {
        const only = (edit: (e: Record<string, LifeEvent>) => void): number => findSeparateSameEvents(household(edit)).length;
        // Hostivít left out: two records that differ.
        const pair = (change: Partial<LifeEvent>) => only(e => { e.v.date = '1930'; Object.assign(e.l, change); });
        expect(pair({})).toBe(1);
        expect(only(e => { e.d.date = '1921'; e.l.date = '1921'; e.v.date = '1921'; })).toBe(0);
        expect(only(e => { e.d.date = 'ABT 1921-02-15'; e.l.date = '~1921-02-15'; e.v.date = '1930'; })).toBe(0);
        expect(pair({ place: 'Dolní Vymyšlenice' })).toBe(0);
        expect(pair({ address: 'č. 8' })).toBe(0);
        // Another type of event, or one that cannot be shared.
        expect(pair({ type: 'residence' })).toBe(0);
        expect(only(e => { for (const ev of Object.values(e)) ev.type = 'baptism'; })).toBe(0);
    });

    it('two houses split the records; one without a house joins neither', () => {
        const data = household(e => { e.l.address = 'č. 8'; });
        expect(findSeparateSameEvents(data)).toEqual([]);
        const more = household(e => { e.l.address = 'č. 8'; });
        more.persons[BOLESLAVA].events = [census('c_b', { age: '41', address: 'č. 8' })];
        const groups = findSeparateSameEvents(more);
        expect(groups.map(g => g.persons)).toEqual([[MSTISLAVA, BOLESLAVA]]);
    });

    it('a share there already and one record of the same event: the record joins that share', () => {
        const data = household(e => { e.d.shareId = 'shKul1'; e.l.shareId = 'shKul1'; });
        const groups = findSeparateSameEvents(data);
        expect(groups).toHaveLength(1);
        expect(groups[0].shareId).toBe('shKul1');
        expect(groups[0].records.map(r => r.personId)).toEqual([HOSTIVIT]);
        expect(groups[0].persons).toEqual([DOBROSLAV, MSTISLAVA, HOSTIVIT]);
    });

    it('a share with every record in it is no group', () => {
        const data = household(e => { for (const ev of Object.values(e)) ev.shareId = 'shKul1'; });
        expect(findSeparateSameEvents(data)).toEqual([]);
        expect(validateTreeData(data).issues.some(i => i.type === 'separateSameEvent')).toBe(false);
    });
});

describe('Join into one event (K1.6 b)', () => {
    it('gives the records one share; each keeps its age and own fields; one house reaches the record without one', () => {
        const data = household(e => { e.l.shareRole = 'wife'; });
        reset(data);
        const key = findSeparateSameEvents(data)[0].key;
        const res = DataManager.joinSeparateSameEvent(key);
        expect(res?.shareId).toBeTruthy();
        expect(res?.personIds).toEqual([DOBROSLAV, MSTISLAVA, HOSTIVIT]);
        for (const [pid, age] of [[DOBROSLAV, '44'], [MSTISLAVA, '40'], [HOSTIVIT, '12']] as const) {
            const list = censuses(pid);
            expect(list).toHaveLength(1);
            expect(list[0].shareId).toBe(res!.shareId);
            expect(list[0].age).toBe(age);
            expect(list[0].address).toBe('č. 7');
        }
        expect(censuses(MSTISLAVA)[0].shareRole).toBe('wife');
        expect(censuses(MSTISLAVA)[0].id).toBe('c_l');
        expect(shareDivergence(DataManager.getData(), res!.shareId!)).toBeNull();
        expect(findSeparateSameEvents(DataManager.getData())).toEqual([]);
    });

    it('one undo takes the whole join back', () => {
        const data = household();
        const before = structuredClone(data);
        reset(data);
        DataManager.joinSeparateSameEvent(findSeparateSameEvents(data)[0].key);
        expect(censuses(DOBROSLAV)[0].shareId).toBeTruthy();
        expect(UndoManager.canUndo()).toBe(true);
        DataManager.undo();
        expect(DataManager.getData().persons).toEqual(before.persons);
        expect(UndoManager.canUndo()).toBe(false);
    });

    it('joins a share there already, no new share', () => {
        const data = household(e => { e.d.shareId = 'shKul1'; e.l.shareId = 'shKul1'; });
        reset(data);
        const res = DataManager.joinSeparateSameEvent(findSeparateSameEvents(data)[0].key);
        expect(res?.shareId).toBe('shKul1');
        expect(shareCopiesOf(DataManager.getData(), 'shKul1').map(c => c.personId)).toEqual([DOBROSLAV, MSTISLAVA, HOSTIVIT]);
        expect(censuses(HOSTIVIT)[0].age).toBe('12');
    });

    it('a differing source or note is not overwritten: the share differs (for Make copies match)', () => {
        const data = household(e => { e.v.sourceIds = ['s2']; e.l.note = 'manželka'; });
        reset(data);
        const res = DataManager.joinSeparateSameEvent(findSeparateSameEvents(data)[0].key);
        expect(censuses(HOSTIVIT)[0].sourceIds).toEqual(['s2']);
        expect(censuses(MSTISLAVA)[0].note).toBe('manželka');
        expect(censuses(DOBROSLAV)[0].note).toBeUndefined();
        const d = shareDivergence(DataManager.getData(), res!.shareId!);
        expect(d?.fields.map(f => f.field).sort()).toEqual(['note', 'sourceIds']);
    });

    it('a key no group has any more changes nothing', () => {
        const data = household();
        reset(data);
        const before = structuredClone(data);
        expect(DataManager.joinSeparateSameEvent('census\u0000\u00001921-02-15\u0000nowhere\u0000')).toBeNull();
        expect(DataManager.getData()).toEqual(before);
    });
});

describe('never joined by itself (K1.6 b)', () => {
    it('the data update of an older tree and the check leave the separate records as they are', () => {
        const older = household();
        (older as { version: number }).version = 19;
        const migrated = migrateData(structuredClone(older));
        for (const p of Object.values(migrated.persons)) for (const ev of p.events ?? []) expect(ev.shareId).toBeUndefined();
        const current = household();
        const before = JSON.stringify(current);
        const migratedNow = migrateData(current);
        for (const p of Object.values(migratedNow.persons)) for (const ev of p.events ?? []) expect(ev.shareId).toBeUndefined();
        const snapshot = JSON.stringify(migratedNow);
        validateTreeData(migratedNow);
        findSeparateSameEvents(migratedNow);
        expect(JSON.stringify(migratedNow)).toBe(snapshot);
        expect(JSON.parse(before).persons[DOBROSLAV].events).toHaveLength(1);
    });
});
