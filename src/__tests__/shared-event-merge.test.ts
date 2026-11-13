/**
 * Merging two records of one person and merging trees with shared events
 * (spec 085 §7): the merged person is in a shared event once, an own record
 * of the same event can join it, and a tree merged with itself or the same
 * file twice doubles nothing. Invented data.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

vi.mock('../snapshots.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../snapshots.js')>()),
    createSnapshot: vi.fn(async () => undefined),
}));

import { DataManager, migrateData } from '../data.js';
import { StorageManager } from '../storage.js';
import { createMergeState } from '../merge/index.js';
import { executeMerge } from '../merge/executor.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { setLanguage } from '../strings.js';
import { MARRIAGE_EVENT_ID, joinSameShareCopies, personMergeShares, shareCopiesOf } from '../shared-events.js';
import { STROM_DATA_VERSION, toPersonId, type LifeEvent, type PartnershipId, type Person, type PersonId, type StromData, type TreeId } from '../types.js';

const TREE = 'shared-merge' as TreeId;
const DOBROMIL = toPersonId('p_dobromil');
const DUPLICATE = toPersonId('p_dobromil2');
const ZDESLAVA = toPersonId('p_zdeslava');
const MSTIBOJ = toPersonId('p_mstiboj');

function person(id: PersonId, firstName: string, lastName: string, gender: 'male' | 'female', events: LifeEvent[]): Person {
    return { id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], events };
}

const census = (id: string, extra: Partial<LifeEvent> = {}): LifeEvent =>
    ({ id, type: 'census', date: '1921-02-15', place: 'Kozinec', sourceIds: ['s1'], ...extra });

function tree(dobromil: LifeEvent[], duplicate: LifeEvent[], withSon = true): StromData {
    const persons: Record<string, Person> = {
        [DOBROMIL]: person(DOBROMIL, 'Dobromil', 'Křepelák', 'male', dobromil),
        [DUPLICATE]: person(DUPLICATE, 'Dobromil', 'Křepelák', 'male', duplicate),
        [ZDESLAVA]: person(ZDESLAVA, 'Zdeslava', 'Křepeláková', 'female', [census('c_z', { shareId: 'SHC1921', age: '36' })]),
    };
    if (withSon) persons[MSTIBOJ] = person(MSTIBOJ, 'Mstiboj', 'Křepelák', 'male', [census('c_m', { shareId: 'SHC1921', age: '11', shareRole: 'son' })]);
    return {
        version: STROM_DATA_VERSION,
        persons,
        partnerships: {},
        sources: {
            s1: { id: 's1', title: 'Sčítání lidu 1921' },
            s2: { id: 's2', title: 'Domovská matrika Kozinec' },
        },
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

const eventsOf = (id: PersonId) => DataManager.getData().persons[id].events ?? [];
const censuses = (id: PersonId) => eventsOf(id).filter(e => e.type === 'census');
const holders = (shareId: string) => shareCopiesOf(DataManager.getData(), shareId).map(c => c.personId).sort();

beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T10:30:00Z'));
    setLanguage('en');
});
afterAll(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('person merge: both records in one shared event', () => {
    it('the merged person is in it once, with the kept record\'s age unless another was chosen', () => {
        const data = tree([census('c_d', { shareId: 'SHC1921', age: '40' })], [census('c_d2', { shareId: 'SHC1921', age: '41', note: '' })]);
        const rows = personMergeShares(data, DOBROMIL, DUPLICATE);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ kind: 'once', shareId: 'SHC1921', persons: 4, ageDiffers: true });
        reset(data);
        expect(DataManager.mergePersons(DOBROMIL, DUPLICATE, {}, new Map())).toBe(true);
        expect(censuses(DOBROMIL)).toEqual([expect.objectContaining({ id: 'c_d', shareId: 'SHC1921', age: '40' })]);
        expect(holders('SHC1921')).toEqual([DOBROMIL, MSTIBOJ, ZDESLAVA].sort());
    });

    it('the age chosen in the merge is the copy\'s; the other record\'s own fields fill what the kept one lacks', () => {
        const data = tree(
            [census('c_d', { shareId: 'SHC1921', age: '40' })],
            [census('c_d2', { shareId: 'SHC1921', age: '41', shareRole: 'head', participants: [{ id: 'pt1', role: 'witness', name: 'Bořislav Hlubinář' }] })],
        );
        reset(data);
        DataManager.mergePersons(DOBROMIL, DUPLICATE, {}, new Map(), { ages: new Map([['SHC1921', '41']]) });
        const [only] = censuses(DOBROMIL);
        expect(censuses(DOBROMIL)).toHaveLength(1);
        expect(only).toMatchObject({ id: 'c_d', age: '41', shareRole: 'head', participants: [{ role: 'witness', name: 'Bořislav Hlubinář' }] });
    });

    it('a share of just the two records becomes an ordinary event of the merged person', () => {
        const data = tree([census('c_d', { shareId: 'SHX', age: '40' })], [census('c_d2', { shareId: 'SHX', age: '40' })]);
        reset(data);
        DataManager.mergePersons(DOBROMIL, DUPLICATE, {}, new Map());
        const list = censuses(DOBROMIL).filter(e => e.id === 'c_d' || e.id === 'c_d2');
        expect(list).toHaveLength(1);
        expect(list[0].shareId).toBeUndefined();
    });

    it('copies of one share that differ in a common field both stay (the data check tells them)', () => {
        const data = tree([census('c_d', { shareId: 'SHC1921' })], [census('c_d2', { shareId: 'SHC1921', place: 'Kozinec, čp. 12' })]);
        expect(personMergeShares(data, DOBROMIL, DUPLICATE)).toEqual([]);
        reset(data);
        DataManager.mergePersons(DOBROMIL, DUPLICATE, {}, new Map());
        expect(censuses(DOBROMIL).map(e => e.id)).toEqual(['c_d', 'c_d2']);
    });
});

describe('person merge: a shared event and the same event of the other record\'s own', () => {
    const own = () => census('c_own', { sourceIds: ['s2'], citationQuay: { sourceIds: { s2: 3 } }, age: '41', note: 'Přednosta domácnosti' });

    it('is offered once per share, with the persons in it', () => {
        const rows = personMergeShares(tree([census('c_d', { shareId: 'SHC1921' })], [own()]), DOBROMIL, DUPLICATE);
        expect(rows).toEqual([expect.objectContaining({ kind: 'attach', shareId: 'SHC1921', persons: 3, otherOf: DUPLICATE })]);
        expect(rows[0].other.id).toBe('c_own');
    });

    it('joined by default: the own record goes, its source, quality and note reach every copy, its age the merged copy', () => {
        reset(tree([census('c_d', { shareId: 'SHC1921' })], [own()]));
        DataManager.mergePersons(DOBROMIL, DUPLICATE, {}, new Map());
        expect(censuses(DOBROMIL)).toEqual([expect.objectContaining({ id: 'c_d', shareId: 'SHC1921', age: '41' })]);
        for (const c of shareCopiesOf(DataManager.getData(), 'SHC1921')) {
            expect(c.event.sourceIds).toEqual(['s1', 's2']);
            expect(c.event.citationQuay?.sourceIds?.s2).toBe(3);
            expect(c.event.note).toBe('Přednosta domácnosti');
        }
        expect(holders('SHC1921')).toEqual([DOBROMIL, MSTIBOJ, ZDESLAVA].sort());
    });

    it('the shared event at the removed record and the own one at the kept record join as well', () => {
        reset(tree([own()], [census('c_d2', { shareId: 'SHC1921' })]));
        DataManager.mergePersons(DOBROMIL, DUPLICATE, {}, new Map());
        expect(censuses(DOBROMIL)).toEqual([expect.objectContaining({ id: 'c_d2', shareId: 'SHC1921', age: '41' })]);
    });

    it('kept apart when unticked: the own record stays an own event and the share is untouched', () => {
        reset(tree([census('c_d', { shareId: 'SHC1921' })], [own()]));
        DataManager.mergePersons(DOBROMIL, DUPLICATE, {}, new Map(), { detach: new Set(['SHC1921']) });
        const list = censuses(DOBROMIL);
        expect(list.map(e => [e.id, e.shareId])).toEqual([['c_d', 'SHC1921'], ['c_own', undefined]]);
        expect(shareCopiesOf(DataManager.getData(), 'SHC1921').every(c => !c.event.sourceIds?.includes('s2'))).toBe(true);
    });

    it('no offer when two own events match, or when the date and place are both empty', () => {
        expect(personMergeShares(tree([census('c_d', { shareId: 'SHC1921' })], [own(), census('c_own2')]), DOBROMIL, DUPLICATE)).toEqual([]);
        const bare = { id: 'b', type: 'census' as const };
        expect(personMergeShares(tree([{ ...bare, shareId: 'SHC1921' }], [{ ...bare, id: 'b2' }]), DOBROMIL, DUPLICATE)).toEqual([]);
    });
});

describe('one person holding two copies of a share', () => {
    it('copies alike become one; copies that differ stay', () => {
        const p = person(DOBROMIL, 'Dobromil', 'Křepelák', 'male', [
            census('a', { shareId: 'S1', age: '40' }), census('b', { shareId: 'S1', shareRole: 'head' }),
            census('c', { shareId: 'S2' }), census('d', { shareId: 'S2', date: '1922' }),
        ]);
        expect(joinSameShareCopies(p).map(e => e.id)).toEqual(['b']);
        expect(p.events!.map(e => e.id)).toEqual(['a', 'c', 'd']);
        expect(p.events![0]).toMatchObject({ age: '40', shareRole: 'head' });
    });
});

describe('tree merge with shared events', () => {
    beforeEach(() => { vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never); });

    /** The census of the three as one share, each person born on a day of their own. */
    function household(shareId = 'SHC1921'): StromData {
        const data = tree([census('c_d', { shareId, age: '40' })], [], true);
        delete (data.persons as Record<string, Person>)[DUPLICATE];
        for (const ev of Object.values(data.persons).flatMap(p => p.events ?? [])) ev.shareId = shareId;
        data.persons[DOBROMIL].birthDate = '1881-03-02';
        data.persons[ZDESLAVA].birthDate = '1885-07-19';
        data.persons[MSTIBOJ].birthDate = '1910-01-27';
        return data;
    }

    async function merge(existing: StromData, incoming: StromData, decide: 'confirm' | 'reject' = 'confirm') {
        const state = createMergeState(existing, incoming);
        for (const m of state.matches) state.decisions.set(m.incomingId, { type: decide } as never);
        const result = await executeMerge(state);
        expect(result.success).toBe(true);
        return result;
    }

    const censusesIn = (data: StromData) => Object.values(data.persons)
        .map(p => ({ name: p.firstName, events: (p.events ?? []).filter(e => e.type === 'census') }));

    it('a tree merged with itself: one copy per person, the same share, counted as joined', async () => {
        const data = household();
        const result = await merge(data, structuredClone(data));
        expect(result.stats.merged).toBe(3);
        for (const p of censusesIn(result.mergedData)) {
            expect(p.events, p.name).toHaveLength(1);
            expect(p.events[0].shareId).toBe('SHC1921');
        }
        expect(result.stats.sharedJoined).toBe(1);
    });

    it('the same GEDCOM merged twice: nothing doubles and the share stays one', async () => {
        const ged = exportToGedcom(household(), 'Kozinec').content;
        const first = migrateData(convertToStrom(parseGedcom(ged)).data);
        const second = convertToStrom(parseGedcom(ged)).data;
        const result = await merge(first, second);
        const all = censusesIn(result.mergedData);
        expect(all).toHaveLength(3);
        const ids = new Set(all.map(p => { expect(p.events, p.name).toHaveLength(1); return p.events[0].shareId; }));
        expect(ids.size).toBe(1);
        expect([...ids][0]).toBe('SHC1921');
        expect(result.stats.sharedJoined).toBe(1);
    });

    it('older copies of the tree without the share join it: the tree\'s own events take the share and its roles', async () => {
        const old = household();
        for (const ev of Object.values(old.persons).flatMap(p => p.events ?? [])) { delete ev.shareId; delete ev.shareRole; }
        const result = await merge(old, household());
        for (const p of censusesIn(result.mergedData)) {
            expect(p.events, p.name).toHaveLength(1);
            expect(p.events[0].shareId).toBe('SHC1921');
        }
        expect(result.mergedData.persons[MSTIBOJ].events![0].shareRole).toBe('son');
        expect(result.stats.sharedJoined).toBe(1);
    });

    it('a foreign tree using the same share id for another event gets a new id; nothing is counted as joined', async () => {
        const foreign: StromData = {
            version: STROM_DATA_VERSION,
            persons: {
                [toPersonId('f1')]: person(toPersonId('f1'), 'Mstivoj', 'Pšeničák', 'male',
                    [{ id: 'fb1', type: 'residence', date: '1930', place: 'Zálesí u Kozince', shareId: 'SHC1921' }]),
                [toPersonId('f2')]: person(toPersonId('f2'), 'Ctimíra', 'Pšeničáková', 'female',
                    [{ id: 'fb2', type: 'residence', date: '1930', place: 'Zálesí u Kozince', shareId: 'SHC1921' }]),
            },
            partnerships: {},
        } as unknown as StromData;
        const result = await merge(household(), foreign, 'reject');
        const byName = (n: string) => Object.values(result.mergedData.persons).find(p => p.firstName === n)!;
        const newId = byName('Mstivoj').events![0].shareId!;
        expect(newId).toBeTruthy();
        expect(newId).not.toBe('SHC1921');
        expect(byName('Ctimíra').events![0].shareId).toBe(newId);
        expect(shareCopiesOf(result.mergedData, 'SHC1921')).toHaveLength(3);
        expect(result.stats.sharedJoined).toBe(0);
    });

    it('an incoming own godparent or witness event points at the merged couple and its events; what is gone is left out', async () => {
        const U_EX = 'u_ex' as PartnershipId;
        const U_IN = 'u_in' as PartnershipId;
        const couple = (ids: [PersonId, PersonId, PersonId], unionId: PartnershipId, baptismId: string, bannsId: string): StromData => {
            const [husband, wife, child] = ids;
            const h = person(husband, 'Ctiboh', 'Vlčinský', 'male', []);
            const w = person(wife, 'Lidoslava', 'Vlčinská', 'female', []);
            const c = person(child, 'Lubomíra', 'Vlčinská', 'female', [{ id: baptismId, type: 'baptism', date: '1912-05-04', place: 'Kozinec' }]);
            h.birthDate = '1885-02-11'; w.birthDate = '1889-09-30'; c.birthDate = '1912-05-01';
            h.partnerships = [unionId]; w.partnerships = [unionId];
            h.childIds = [child]; w.childIds = [child]; c.parentIds = [husband, wife];
            return {
                version: STROM_DATA_VERSION,
                persons: { [husband]: h, [wife]: w, [child]: c },
                partnerships: {
                    [unionId]: {
                        id: unionId, person1Id: husband, person2Id: wife, childIds: [child], status: 'married',
                        startDate: '1910-10-15', startPlace: 'Kozinec',
                        events: [{ id: bannsId, type: 'banns', date: '1910-09-25', place: 'Kozinec' }],
                    },
                },
            } as unknown as StromData;
        };
        const existing = couple([toPersonId('h'), toPersonId('w'), toPersonId('c')], U_EX, 'b_ex', 'n_ex');
        const incoming = couple([toPersonId('ih'), toPersonId('iw'), toPersonId('ic')], U_IN, 'b_in', 'n_in');
        const godfather = person(toPersonId('ig'), 'Svatoboj', 'Ostrožný', 'male', [
            { id: 'g1', type: 'godparent', date: '1912-05-04', roleAt: { role: 'godparent', personId: toPersonId('ic'), eventType: 'baptism', eventId: 'b_in' } },
            { id: 'g2', type: 'weddingWitness', date: '1910-10-15', roleAt: { role: 'witness', partnershipId: U_IN, eventType: 'marriage', eventId: MARRIAGE_EVENT_ID } },
            { id: 'g3', type: 'custom', customLabel: 'Svědek ohlášek', date: '1910-09-25', roleAt: { role: 'witness', partnershipId: U_IN, eventType: 'banns', eventId: 'n_in' } },
            { id: 'g4', type: 'godparent', date: '1913', roleAt: { role: 'godparent', personId: toPersonId('ic'), eventType: 'baptism', eventId: 'gone' } },
        ]);
        godfather.birthDate = '1880-01-20';
        incoming.persons[godfather.id] = godfather;

        const result = await merge(existing, incoming);
        const merged = result.mergedData;
        const kazimir = Object.values(merged.persons).find(p => p.firstName === 'Svatoboj')!;
        const at = (id: string) => kazimir.events!.find(e => e.id === id)!.roleAt;
        expect(Object.keys(merged.partnerships)).toEqual([U_EX]);
        expect(at('g1')).toEqual({ role: 'godparent', personId: toPersonId('c'), eventType: 'baptism', eventId: 'b_ex' });
        expect(at('g2')).toEqual({ role: 'witness', partnershipId: U_EX, eventType: 'marriage', eventId: MARRIAGE_EVENT_ID });
        expect(at('g3')).toEqual({ role: 'witness', partnershipId: U_EX, eventType: 'banns', eventId: 'n_ex' });
        expect(at('g4')).toEqual({ role: 'godparent', personId: toPersonId('c'), eventType: 'baptism' });
    });

    it('an incoming own witness event of a couple that did not come along loses the couple and the event', async () => {
        const data = household();
        const lone = person(toPersonId('ig2'), 'Svatoboj', 'Ostrožný', 'male', [
            { id: 'g1', type: 'weddingWitness', roleAt: { role: 'witness', partnershipId: 'u_nowhere' as PartnershipId, eventType: 'marriage', eventId: MARRIAGE_EVENT_ID } },
        ]);
        const incoming = { version: STROM_DATA_VERSION, persons: { [lone.id]: lone }, partnerships: {} } as unknown as StromData;
        const result = await merge(data, incoming, 'reject');
        const kazimir = Object.values(result.mergedData.persons).find(p => p.firstName === 'Svatoboj')!;
        expect(kazimir.events![0].roleAt).toEqual({ role: 'witness', eventType: 'marriage' });
    });
});
