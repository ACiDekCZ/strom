/**
 * The Houses window's list without the DOM (spec 030 §1, K1.2): the search,
 * the chip "With history only", the sort, the towns with their counts; what
 * "Merge with another house…" and "It is a different house…" write (one undo
 * step); and the houses of a tree merged in.
 *
 * A fictional pair of villages: Bělokamen with čp. 16 "U Prouzalů" (numbered
 * 9 before a renumbering) where Dobromil Kvitelka married in, čp. 7 of the
 * Trnovec family and čp. 40 below the threshold; Hvozdnice with čp. 3, čp. 5
 * and a street with a number, Kopřivná 12.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { collectHouses, mergeIncomingHouses, type TreeHouse } from '../houses.js';
import {
    houseFormerNumbers, houseGroupIds, houseMatches, houseSearchText, houseTownGroups, mergeHouseChanges, sortHouses,
    splitHouseChanges,
} from '../houses-view.js';
import { DataManager, migrateData } from '../data.js';
import { TreeManager } from '../tree-manager.js';
import { AuditLogManager } from '../audit-log.js';
import { UndoManager } from '../undo.js';
import { setLanguage, strings } from '../strings.js';
import { createMergeState } from '../merge/matching.js';
import { executeMerge } from '../merge/executor.js';
import { StorageManager } from '../storage.js';
import type { HouseUserData, Partnership, PartnershipId, Person, PersonId, StromData, TreeId } from '../types.js';
import { STROM_DATA_VERSION } from '../version.js';

function person(id: string, first: string, last: string, gender: Person['gender'], o: Partial<Person> = {}): Person {
    return {
        id: id as PersonId, firstName: first, lastName: last, gender,
        isPlaceholder: false, parentIds: [], childIds: [], partnerships: [], ...o,
    };
}

function union(id: string, a: string, b: string, o: Partial<Partnership> = {}): Partnership {
    return { id: id as PartnershipId, person1Id: a as PersonId, person2Id: b as PersonId, childIds: [], status: 'married', ...o };
}

function villages(houses?: Record<string, HouseUserData>): StromData {
    const persons = [
        person('svatobor', 'Svatobor', 'Prouzal', 'male', {
            birthPlace: 'Bělokamen', birthAddress: 'čp. 9', birthDate: '1820',
            partnerships: ['u1' as PartnershipId], childIds: ['hostivit', 'dobroslava'] as PersonId[],
        }),
        person('radegunda', 'Radegunda', 'Prouzalová', 'female', {
            birthPlace: 'Mlýnkovice', birthDate: '1824', deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1890',
            partnerships: ['u1' as PartnershipId], childIds: ['hostivit', 'dobroslava'] as PersonId[],
        }),
        person('hostivit', 'Hostivít', 'Prouzal', 'male', {
            birthPlace: 'Bělokamen', birthAddress: 'čp. 9', birthDate: '1848', deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1910',
            parentIds: ['svatobor', 'radegunda'] as PersonId[],
        }),
        person('dobroslava', 'Dobroslava', 'Prouzalová', 'female', {
            birthPlace: 'Bělokamen', birthAddress: 'čp. 9', birthDate: '1850',
            parentIds: ['svatobor', 'radegunda'] as PersonId[], partnerships: ['u2' as PartnershipId], childIds: ['radhost'] as PersonId[],
        }),
        person('dobromil', 'Dobromil', 'Kvitelka', 'male', {
            birthPlace: 'Mlýnkovice', birthDate: '1847', deathPlace: 'Bělokamen', deathAddress: 'čp. 16', deathDate: '1915',
            partnerships: ['u2' as PartnershipId], childIds: ['radhost'] as PersonId[],
        }),
        person('radhost', 'Radhost', 'Kvitelka', 'male', {
            birthPlace: 'Bělokamen', birthAddress: 'čp. 16', birthDate: '1875', parentIds: ['dobroslava', 'dobromil'] as PersonId[],
            events: [{ id: 'e-radhost-res', type: 'residence', place: 'Hvozdnice', address: 'čp. 5', date: '1900' }],
        }),
        person('lubomir', 'Lubomír', 'Trnovec', 'male', {
            birthPlace: 'Bělokamen', birthAddress: 'čp. 7', birthDate: '1830', childIds: ['kresomysl'] as PersonId[],
        }),
        person('kresomysl', 'Křesomysl', 'Trnovec', 'male', {
            birthPlace: 'Bělokamen', birthAddress: 'čp. 7', birthDate: '1862', parentIds: ['lubomir'] as PersonId[],
        }),
        person('hroznata', 'Hroznata', 'Trnovec', 'male', {
            birthPlace: 'Bělokamen', birthAddress: 'čp. 40', birthDate: '1900',
        }),
        person('kapradin', 'Kapradin', 'Kvitelka', 'male', {
            birthPlace: 'Hvozdnice', birthAddress: 'čp. 3', birthDate: '1840', childIds: ['lubomira'] as PersonId[],
            events: [{ id: 'e-kapradin-res', type: 'residence', place: 'Hvozdnice', address: 'Kopřivná 12', date: '1880' }],
        }),
        person('lubomira', 'Lubomíra', 'Kvitelková', 'female', {
            birthPlace: 'Hvozdnice', birthAddress: 'čp. 3', birthDate: '1871', parentIds: ['kapradin'] as PersonId[],
        }),
    ];
    return {
        version: STROM_DATA_VERSION,
        persons: Object.fromEntries(persons.map(p => [p.id, p])) as StromData['persons'],
        partnerships: {
            u1: union('u1', 'svatobor', 'radegunda', { startDate: '1845', startPlace: 'Mlýnkovice', childIds: ['hostivit', 'dobroslava'] as PersonId[] }),
            u2: union('u2', 'dobromil', 'dobroslava', { startDate: '1872', startPlace: 'Bělokamen', address: 'čp. 16', childIds: ['radhost'] as PersonId[] }),
        } as StromData['partnerships'],
        ...(houses ? { houses } : {}),
    };
}

const RENUMBERED: Record<string, HouseUserData> = { 'belokamen|16': { name: 'U Prouzalů', merged: ['belokamen|9'] } };

const byId = (list: readonly TreeHouse[]): Map<string, TreeHouse> => new Map(list.map(h => [h.id, h]));

beforeAll(() => setLanguage('en'));

describe('the list of the window', () => {
    const data = villages(RENUMBERED);
    const houses = collectHouses(data);
    const texts = new Map(houses.map(h => [h.id, houseSearchText(h, data)]));

    it('groups the houses by town, most houses first, those with history above the others', () => {
        const r = houseTownGroups(houses, { query: '', onlyHistory: false }, 'number', texts, 'en');
        expect(r.groups.map(g => g.town)).toEqual(['Bělokamen', 'Hvozdnice']);
        expect(r).toMatchObject({ shown: 6, total: 6, towns: 2 });
        const [bel, hvo] = r.groups;
        expect(bel.houses.map(h => h.id)).toEqual(['belokamen|7', 'belokamen|16']);
        expect(bel.more.map(h => h.id)).toEqual(['belokamen|40']);
        expect(hvo.houses.map(h => h.id)).toEqual(['hvozdnice|3']);
        expect(hvo.more.map(h => h.id)).toEqual(['hvozdnice|5', 'hvozdnice|koprivna 12']);
        // The counts of the town: houses with history, every number (9 too), people.
        expect(bel).toMatchObject({ total: 3, withHistory: 2, numbers: 4, persons: 9 });
        expect(strings.houses.townMeta(bel.withHistory, bel.numbers, bel.persons)).toBe('2 houses with history · 4 house numbers · 9 people');
    });

    it('searches by town, number (written any way) and surname, without diacritics', () => {
        const ids = (query: string): string[] =>
            houseTownGroups(houses, { query, onlyHistory: false }, 'number', texts).groups.flatMap(g => [...g.houses, ...g.more]).map(h => h.id);
        expect(ids('hvozdnice')).toEqual(['hvozdnice|3', 'hvozdnice|5', 'hvozdnice|koprivna 12']);
        // The former number finds the house it went into.
        expect(ids('čp. 9')).toEqual(['belokamen|16']);
        expect(ids('16')).toEqual(['belokamen|16']);
        // A surname of a person who married in, typed without its accents.
        expect(ids('kvitelka')).toEqual(expect.arrayContaining(['belokamen|16', 'hvozdnice|3']));
        expect(ids('prouzalova')).toEqual(['belokamen|16']);
        expect(ids('belokamen trnovec')).toEqual(['belokamen|7', 'belokamen|40']);
        expect(ids('kopřivná')).toEqual(['hvozdnice|koprivna 12']);
        expect(ids('nothing like it')).toEqual([]);
        expect(houseMatches(byId(houses).get('belokamen|16')!, '')).toBe(true);
    });

    it('the chip keeps the houses with history only, the town filter one town', () => {
        const only = houseTownGroups(houses, { query: '', onlyHistory: true }, 'number', texts);
        expect(only.groups.flatMap(g => g.more)).toEqual([]);
        expect(only).toMatchObject({ shown: 3, total: 6 });
        const town = houseTownGroups(houses, { query: '', onlyHistory: false, town: 'HVOZDNICE' }, 'number', texts);
        expect(town.groups.map(g => g.townKey)).toEqual(['hvozdnice']);
        expect(town).toMatchObject({ shown: 3, total: 3, towns: 1 });
        const none = houseTownGroups(houses, { query: 'kvitelka', onlyHistory: true, town: 'Bělokamen' }, 'number', texts);
        expect(none.groups.flatMap(g => g.houses).map(h => h.id)).toEqual(['belokamen|16']);
    });

    it('sorts by number, by the oldest record, by the most people', () => {
        const bel = houses.filter(h => h.townKey === 'belokamen');
        expect(sortHouses(bel, 'number').map(h => h.id)).toEqual(['belokamen|7', 'belokamen|16', 'belokamen|40']);
        expect(sortHouses(bel, 'oldest').map(h => h.id)).toEqual(['belokamen|16', 'belokamen|7', 'belokamen|40']);
        expect(sortHouses(bel, 'people').map(h => h.id)).toEqual(['belokamen|16', 'belokamen|7', 'belokamen|40']);
        expect(strings.houses.count(6, 2)).toBe('6 houses in 2 towns');
    });

    // The research's word (Milan 27 Nov 2026): čp. 7 done on 26 Nov, čp. 40 (below the threshold) on 27 Nov, čp. 3 done
    // without a day; the others not done.
    const DONE: Record<string, string> = { 'belokamen|7': '2026-11-26T08:00:00Z', 'belokamen|40': '2026-11-27T05:00:00Z', 'hvozdnice|3': '' };
    const doneOf = (h: TreeHouse): string | null => DONE[h.id] ?? null;

    it('"Researched" keeps the houses done, "Recently researched" sorts the latest first', () => {
        const r = houseTownGroups(houses, { query: '', onlyHistory: false, researched: true }, 'number', texts, 'en', doneOf);
        expect(r.groups.flatMap(g => [...g.houses, ...g.more]).map(h => h.id)).toEqual(['belokamen|7', 'belokamen|40', 'hvozdnice|3']);
        expect(r).toMatchObject({ shown: 3, total: 6 });
        // With "With history only" and the search too.
        const both = houseTownGroups(houses, { query: 'bělokamen', onlyHistory: true, researched: true }, 'number', texts, 'en', doneOf);
        expect(both.groups.flatMap(g => [...g.houses, ...g.more]).map(h => h.id)).toEqual(['belokamen|7']);
        // Without the research's word the chip does nothing.
        expect(houseTownGroups(houses, { query: '', onlyHistory: false, researched: true }, 'number', texts, 'en')).toMatchObject({ shown: 6 });

        const bel = houses.filter(h => h.townKey === 'belokamen');
        expect(sortHouses(bel, 'researched', doneOf).map(h => h.id)).toEqual(['belokamen|40', 'belokamen|7', 'belokamen|16']);
        // A done house without its day after the dated ones, the not done ones last by number.
        expect(sortHouses(houses, 'researched', doneOf).map(h => h.id).slice(0, 3)).toEqual(['belokamen|40', 'belokamen|7', 'hvozdnice|3']);
        // In the window: the houses with history and "More houses" each in that order.
        const sorted = houseTownGroups(houses, { query: '', onlyHistory: false }, 'researched', texts, 'en', doneOf);
        expect(sorted.groups[0].houses.map(h => h.id)).toEqual(['belokamen|7', 'belokamen|16']);
        expect(sorted.groups[1].more.map(h => h.id)).toEqual(['hvozdnice|5', 'hvozdnice|koprivna 12']);
        // Without it: by number.
        expect(sortHouses(bel, 'researched').map(h => h.id)).toEqual(['belokamen|7', 'belokamen|16', 'belokamen|40']);
    });

    it('a renumbered house shows its former number, a street keeps its name', () => {
        const h16 = byId(houses).get('belokamen|16')!;
        expect(h16.text).toBe('čp. 16');
        expect(houseFormerNumbers(h16, h16.numbers)).toEqual(['9']);
        expect(houseGroupIds(h16).sort()).toEqual(['belokamen|16', 'belokamen|9']);
        expect(houseFormerNumbers({ text: 'čp. 3' }, [{ house: 'Kopřivná 12', source: 'tree' }, { house: 'čp. 3', source: 'tree' }]))
            .toEqual(['Kopřivná 12']);
    });
});

describe('merge and split as written into StromData.houses', () => {
    it('Merge with another house joins the other one and drops a word that told them apart', () => {
        expect(mergeHouseChanges(undefined, 'belokamen|16', 'belokamen|9')).toEqual({ 'belokamen|16': { merged: ['belokamen|9'] } });
        expect(mergeHouseChanges({
            'belokamen|16': { name: 'U Prouzalů', split: ['belokamen|9', 'belokamen|40'] },
            'belokamen|9': { split: ['belokamen|16'] },
        }, 'belokamen|16', 'belokamen|9')).toEqual({
            'belokamen|16': { name: 'U Prouzalů', merged: ['belokamen|9'], split: ['belokamen|40'] },
            'belokamen|9': undefined,
        });
        expect(mergeHouseChanges(undefined, 'belokamen|16', 'belokamen|16')).toEqual({});
    });

    it('It is a different house takes the number out of the house and keeps the word', () => {
        expect(splitHouseChanges(RENUMBERED, 'belokamen|16', 'belokamen|9', ['belokamen|16', 'belokamen|9'])).toEqual({
            'belokamen|16': { name: 'U Prouzalů', split: ['belokamen|9'] },
        });
        // A number joined into a number of the house: out of there too, and it joins none of them.
        expect(splitHouseChanges({
            'belokamen|16': { merged: ['belokamen|9'] },
            'belokamen|9': { merged: ['belokamen|12'] },
            'belokamen|12': { merged: ['belokamen|16'] },
        }, 'belokamen|16', 'belokamen|12', ['belokamen|16', 'belokamen|9', 'belokamen|12'])).toEqual({
            'belokamen|9': undefined,
            'belokamen|12': undefined,
            'belokamen|16': { merged: ['belokamen|9'], split: ['belokamen|12'] },
        });
        // A number only the research proposes: just the word.
        expect(splitHouseChanges(undefined, 'belokamen|16', 'belokamen|21')).toEqual({ 'belokamen|16': { split: ['belokamen|21'] } });
    });

    it('after a split the house goes back to its own number; after a merge again they are one', () => {
        const apart = { ...RENUMBERED };
        for (const [id, v] of Object.entries(splitHouseChanges(RENUMBERED, 'belokamen|16', 'belokamen|9', ['belokamen|16', 'belokamen|9']))) {
            if (v) apart[id] = v; else delete apart[id];
        }
        expect(collectHouses(villages(apart)).map(h => h.id)).toContain('belokamen|9');
        const again = { ...apart };
        for (const [id, v] of Object.entries(mergeHouseChanges(apart, 'belokamen|16', 'belokamen|9'))) {
            if (v) again[id] = v; else delete again[id];
        }
        expect(collectHouses(villages(again)).map(h => h.id)).not.toContain('belokamen|9');
    });
});

describe('DataManager.setHousesUserData', () => {
    const TREE = 'tree-houses-window' as TreeId;
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.spyOn(TreeManager, 'saveTreeData').mockImplementation(() => {});
        vi.spyOn(AuditLogManager, 'log').mockImplementation(() => {});
        const dm = DataManager as unknown as { data: StromData; currentTreeId: TreeId | null; viewMode: boolean; pendingBefore: StromData | null };
        dm.data = migrateData(villages(RENUMBERED));
        dm.currentTreeId = TREE;
        dm.viewMode = false;
        dm.pendingBefore = null;
        UndoManager.setActiveTree(null);
        UndoManager.setActiveTree(TREE);
    });

    it('writes both sides as one undo step and one change-log entry', () => {
        const changes = { 'belokamen|16': { name: 'U Prouzalů', split: ['belokamen|9'] }, 'belokamen|9': { split: ['belokamen|16'] } };
        expect(DataManager.setHousesUserData(changes, 'Bělokamen čp. 16')).toBe(true);
        expect(DataManager.getData().houses).toEqual(changes);
        expect(AuditLogManager.log).toHaveBeenCalledTimes(1);
        expect(DataManager.setHousesUserData(changes, 'Bělokamen čp. 16')).toBe(false);
        DataManager.undo();
        expect(DataManager.getData().houses).toEqual(RENUMBERED);
    });

    it('forgets a house with nothing left, skips a bad id, and does nothing while read-only', () => {
        expect(DataManager.setHousesUserData({ 'belokamen|16': undefined, 'no bar': { name: 'x' } }, 'x')).toBe(true);
        expect(DataManager.getData().houses).toBeUndefined();
        (DataManager as unknown as { viewMode: boolean }).viewMode = true;
        expect(DataManager.setHousesUserData({ 'belokamen|16': { name: 'x' } }, 'x')).toBe(false);
    });
});

describe('a merged-in tree brings what was said about its houses', () => {
    it('takes joins and splits ours does not speak against; ours keeps its name', () => {
        expect(mergeIncomingHouses(
            { 'belokamen|16': { name: 'U Prouzalů', split: ['belokamen|9'] } },
            {
                'belokamen|16': { name: 'Na návsi', merged: ['belokamen|9', 'belokamen|12'], split: ['belokamen|40'] },
                'hvozdnice|3': { merged: ['hvozdnice|4'] },
                'bad': { name: 'x' },
            },
        )).toEqual({
            'belokamen|16': { name: 'U Prouzalů', merged: ['belokamen|12'], split: ['belokamen|9', 'belokamen|40'] },
            'hvozdnice|3': { merged: ['hvozdnice|4'] },
        });
        expect(mergeIncomingHouses(undefined, undefined)).toBeUndefined();
        expect(mergeIncomingHouses(RENUMBERED, undefined)).toEqual(RENUMBERED);
    });

    it('executeMerge carries them', async () => {
        vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never);
        const existing = villages();
        const incoming = villages(RENUMBERED);
        const result = await executeMerge(createMergeState(existing, incoming));
        expect(result.errors).toBeUndefined();
        expect(result.mergedData.houses).toEqual(RENUMBERED);
    });
});
