/**
 * Step 3's list over the data (spec 134 §5): the rows, the search and the
 * filters, the grouping by family and by the tree's person a group links
 * through (above 12 families the small ones under "Others"), the group's
 * tri-state box, and "a of n new selected" from the plan with the plan's
 * sum kept whole for each choice of the step. Invented trees.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { buildPlan, planCounts, type WizardChoices } from '../merge/plan.js';
import { connectedNew, dependentsVia, livingNew, newPersons, selectionOf } from '../merge/plan-select.js';
import {
    MAX_RODS, NO_FILTERS, OTHERS_KEY, groupPeople, hasFilters, linkingPeople, listRows, matchesFilters,
    rodsOf, selectionCounts, step3People, triState, yearsText, type S3Filters, type S3Person,
} from '../merge/steps/step3-model.js';
import { strings } from '../strings.js';
import { StorageManager } from '../storage.js';
import type { Person, PersonId, StromData } from '../types.js';
import { Family, addChoices, stateOf } from './helpers/merge-select-trees.js';

beforeAll(() => {
    vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-04T10:00:00Z'));
});
afterAll(() => { vi.useRealTimers(); });

/**
 * The tree: a Jilm couple. The import: the same couple (joined), the
 * husband's parents and grandfather, a son with a source and his wife, their
 * daughter born 1990 (living), and a lone Jilm with no way to the tree.
 */
function setup() {
    const t = new Family('t');
    const t1 = t.person('male', 'Jilm', 1850, { birthPlace: 'Křemenná' });
    const t2 = t.person('female', 'Modřín', 1852);
    t.couple(t1, t2);

    const s = new Family('s');
    const s1 = s.person('male', 'Jilm', 1850, { birthPlace: 'Křemenná', firstName: t1.firstName });
    const s2 = s.person('female', 'Modřín', 1852, { firstName: t2.firstName });
    const su = s.couple(s1, s2);
    const s4 = s.person('male', 'Jilm', 1820, { birthPlace: 'Mechová' });
    const s5 = s.person('female', 'Jilm', 1822);
    s.child(s.couple(s4, s5), s1);
    const s6 = s.person('male', 'Jilm', 1790, { deathDate: '1851' });
    s.child(s6, s4);
    const s7 = s.child(su, s.person('male', 'Jilm', 1880, { sourceIds: ['src1'] as Person['sourceIds'] }));
    const wife = s.person('female', 'Modřín', 1882);
    const wu = s.couple(s7, wife);
    const s10 = s.child(wu, s.person('female', 'Jilm', 1990));
    const s9 = s.person('male', 'Jilm', 1900);
    const state = stateOf(t.data, s.data, [[s1.id, t1.id], [s2.id, t2.id]]);
    return { state, s1, s4, s5, s6, s7, wife, s10, s9, t1 };
}

function rows(f: ReturnType<typeof setup>, w: WizardChoices = addChoices()): S3Person[] {
    const conns = connectedNew(f.state, w);
    return step3People(f.state.incomingData, newPersons(f.state, w), new Set(livingNew(f.state, w)), conns, linkingPeople(conns));
}

const idsOf = (list: readonly S3Person[]): PersonId[] => list.map(p => p.id);
const filter = (list: readonly S3Person[], f: Partial<S3Filters>): PersonId[] => idsOf(list.filter(p => matchesFilters(p, { ...NO_FILTERS, ...f })));

describe('step3People', () => {
    it('lists every new person once, the oldest first, with years, places, a source, living and the way to the tree', () => {
        const f = setup();
        const list = rows(f);
        expect(idsOf(list)).toEqual([f.s6.id, f.s4.id, f.s5.id, f.s7.id, f.wife.id, f.s9.id, f.s10.id]);
        const by = new Map(list.map(p => [p.id, p]));
        expect(yearsText(by.get(f.s6.id)!)).toBe('1790–1851');
        expect(yearsText(by.get(f.s4.id)!)).toBe('* 1820');
        expect(by.get(f.s4.id)!.places).toEqual(['Mechová']);
        expect(by.get(f.s7.id)!.hasSource).toBe(true);
        expect(by.get(f.s4.id)!.hasSource).toBe(false);
        expect(by.get(f.s10.id)!.living).toBe(true);
        expect(by.get(f.s4.id)!.living).toBe(false);
        // The people others link through: the grandfather goes through s4, the wife and the daughter through s7.
        expect(list.filter(p => p.linking).map(p => p.id).sort()).toEqual([f.s4.id, f.s7.id].sort());
        expect(by.get(f.s6.id)!.conn).toMatchObject({ via: f.t1.id, steps: 2 });
        expect(by.get(f.s9.id)!.conn).toBeUndefined();
    });
});

describe('matchesFilters', () => {
    it('search by words of the name, a year or a place, without accents', () => {
        const f = setup();
        const list = rows(f);
        expect(filter(list, { query: '1820' })).toEqual([f.s4.id]);
        expect(filter(list, { query: 'mechova' })).toEqual([f.s4.id]);
        expect(filter(list, { query: `${f.s4.firstName.toLowerCase()} 1820` })).toEqual([f.s4.id]);
        expect(filter(list, { query: 'nobody-of-that-name' })).toEqual([]);
    });

    it('surname, years (birth or death in the range), place, with a source, linking, living', () => {
        const f = setup();
        const list = rows(f);
        const jilm = list.find(p => p.id === f.s4.id)!.rod;
        expect(filter(list, { surname: jilm })).not.toContain(f.wife.id);
        expect(filter(list, { surname: jilm })).toContain(f.s9.id);
        expect(filter(list, { yearFrom: 1815, yearTo: 1825 })).toEqual([f.s4.id, f.s5.id]);
        expect(filter(list, { yearFrom: 1851, yearTo: 1851 })).toEqual([f.s6.id]);
        expect(filter(list, { yearFrom: 1950 })).toEqual([f.s10.id]);
        expect(filter(list, { place: 'MECH' })).toEqual([f.s4.id]);
        expect(filter(list, { withSource: true })).toEqual([f.s7.id]);
        expect(filter(list, { linking: true }).sort()).toEqual([f.s4.id, f.s7.id].sort());
        expect(filter(list, { living: true })).toEqual([f.s10.id]);
        expect(filter(list, { living: true, withSource: true })).toEqual([]);
        expect(hasFilters(NO_FILTERS)).toBe(false);
        expect(hasFilters({ ...NO_FILTERS, query: '  ' })).toBe(false);
        expect(hasFilters({ ...NO_FILTERS, yearFrom: 1800 })).toBe(true);
    });
});

describe('groupPeople', () => {
    it('by family: each person in one group, the largest family first', () => {
        const f = setup();
        const list = rows(f);
        const groups = groupPeople(list, 'rod', f.state.existingData, f.state.incomingData);
        expect(groups.flatMap(g => g.ids).sort()).toEqual(idsOf(list).sort());
        for (let i = 1; i < groups.length; i++) expect(groups[i - 1].ids.length).toBeGreaterThanOrEqual(groups[i].ids.length);
        expect(rodsOf(list)[0].count).toBe(groups[0].ids.length);
        // The group says whom its nearest person links through.
        const jilm = groups.find(g => g.ids.includes(f.s4.id))!;
        expect(jilm.via).toBe(f.t1.id);
    });

    it('by the person they link through: one group for the husband, one for the wife, one for nobody', () => {
        const f = setup();
        const list = rows(f);
        const groups = groupPeople(list, 'via', f.state.existingData, f.state.incomingData);
        expect(groups.flatMap(g => g.ids).sort()).toEqual(idsOf(list).sort());
        const none = groups.find(g => g.key === 'v:-')!;
        expect(none.ids).toEqual([f.s9.id]);
        expect(none.title).toBe(strings.mergeWizard.s3NoLink);
        for (const g of groups) if (g !== none) expect(g.via).toBeDefined();
    });

    it(`above ${MAX_RODS} families the ones with fewer than 3 people go under "Others (n surnames)"`, () => {
        const people: S3Person[] = [];
        const add = (family: string, n: number): void => {
            for (let i = 0; i < n; i++) {
                people.push({
                    id: `p${people.length}` as PersonId, name: `${family} ${i}`, family, rod: family.toLowerCase(),
                    born: 1800 + people.length, died: null, places: [], living: false, hasSource: false, linking: false,
                });
            }
        };
        for (let i = 0; i < 10; i++) add(`Big${i}`, 5);
        for (let i = 0; i < 8; i++) add(`Small${i}`, 2);
        const empty: StromData = { persons: {}, partnerships: {} } as unknown as StromData;
        const groups = groupPeople(people, 'rod', empty, empty);
        expect(groups.length).toBe(11);
        const others = groups[groups.length - 1];
        expect(others.key).toBe(OTHERS_KEY);
        expect(others.surnames).toBe(8);
        expect(others.ids.length).toBe(16);
        expect(others.title).toBe(strings.mergeWizard.s3Others(8));
        expect(groups.flatMap(g => g.ids).length).toBe(people.length);
        // Up to 12 families stay apart.
        expect(groupPeople(people.slice(0, 50 + 2 * 2), 'rod', empty, empty).some(g => g.key === OTHERS_KEY)).toBe(false);
    });
});

describe('listRows and triState', () => {
    it('a closed group draws its header alone, an open one its people below it', () => {
        const f = setup();
        const groups = groupPeople(rows(f), 'rod', f.state.existingData, f.state.incomingData);
        const closed = listRows(groups, () => false);
        expect(closed.length).toBe(groups.length);
        expect(closed.every(r => r.kind === 'group' && !r.open)).toBe(true);
        const first = groups[0].key;
        const open = listRows(groups, k => k === first);
        expect(open.length).toBe(groups.length + groups[0].ids.length);
        expect(open[1]).toEqual({ kind: 'person', id: groups[0].ids[0], group: first });
    });

    it('all, none, some', () => {
        const ids = ['a', 'b', 'c'] as PersonId[];
        expect(triState(ids, new Set(ids))).toBe('all');
        expect(triState(ids, new Set())).toBe('none');
        expect(triState(ids, new Set([ids[1]]))).toBe('some');
    });
});

describe('selectionCounts', () => {
    it('"a of n new": n is every new person, a the ones the plan adds; the plan\'s sum stays whole for each choice', () => {
        const f = setup();
        const base = addChoices();
        const all = newPersons(f.state, base).length;
        const deps = dependentsVia(f.state, base, f.s7.id, selectionOf(f.state, base));
        const choices: Array<[string, WizardChoices, number]> = [
            ['all new', base, all],
            ['one unticked', addChoices({ leftOut: [f.s9.id] }), all - 1],
            ['a branch left out', addChoices({ leftOut: [f.s7.id, ...deps], leftOutReason: Object.fromEntries(deps.map(id => [id, 'branch'])) }), all - 1 - deps.length],
            ['living left out', addChoices({ skipLiving: true }), all - 1],
            ['manual, nobody', addChoices({ leftOut: newPersons(f.state, base) }), 0],
        ];
        for (const [name, w, selected] of choices) {
            const plan = buildPlan(f.state, w);
            const c = planCounts(plan);
            const s = selectionCounts(plan);
            expect(s.of, name).toBe(all);
            expect(s.selected, name).toBe(selected);
            expect(c.joined + c.added + c.skipped + c.pending, name).toBe(c.total);
        }
    });

    it('with the unlinked groups on, a group still to decide counts as selected and the sum stays whole', () => {
        const f = setup();
        const w = addChoices({ groups: {} });
        const plan = buildPlan(f.state, w);
        const c = planCounts(plan);
        const s = selectionCounts(plan);
        expect(s.of).toBe(newPersons(f.state, w).length);
        expect(c.pending).toBeGreaterThan(0);
        expect(s.selected).toBe(c.added + plan.items.filter(i => i.kind === 'group-pending').length);
        expect(c.joined + c.added + c.skipped + c.pending).toBe(c.total);
    });
});
