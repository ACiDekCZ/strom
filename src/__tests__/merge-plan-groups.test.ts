/**
 * Unlinked groups (spec 134 §6): the new people with no way to the tree, in
 * groups (a family, "{name} and children", the individuals), a decision per
 * group (link to a person, add unlinked, separate tree, do not add), the
 * sums staying whole, and a link really written. Invented families.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { applyPlan, buildPlan, planCounts, planFates, verifyResult, GroupDecision, PlanCounts } from '../merge/plan.js';
import { unlinkedGroups, selectionOf } from '../merge/plan-select.js';
import { StorageManager } from '../storage.js';
import { Person, PersonId, StromData } from '../types.js';
import { Family, addChoices, stateOf } from './helpers/merge-select-trees.js';

beforeAll(() => {
    vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never);
});

const whole = (c: PlanCounts): void => expect(c.joined + c.added + c.skipped + c.pending).toBe(c.total);

/**
 * The tree "Modřínovi": a couple and their son. The import: the same three
 * (joined), a second son (linked), the Jilm family from Mechová (8: a
 * couple, three children, two of them married, a grandchild), a mother
 * with two children (3) and two individuals.
 */
function example() {
    const t = new Family('t');
    const t1 = t.person('male', 'Modřín', 1850, { birthPlace: 'Křemenná' });
    const t2 = t.person('female', 'Jilm', 1852);
    const tu = t.couple(t1, t2);
    const t3 = t.child(tu, t.person('male', 'Modřín', 1878));

    const s = new Family('s');
    const s1 = s.person('male', 'Modřín', 1850, { birthPlace: 'Křemenná', firstName: t1.firstName });
    const s2 = s.person('female', 'Jilm', 1852, { firstName: t2.firstName });
    const su = s.couple(s1, s2);
    const s3 = s.child(su, s.person('male', 'Modřín', 1878, { firstName: t3.firstName }));
    const linked = s.child(su, s.person('male', 'Modřín', 1881));

    const head = s.person('male', 'Jilm', 1820, { birthPlace: 'Mechová', deathPlace: 'Mechová', deathDate: '1880' });
    const headWife = s.person('female', 'Jilm', 1824, { birthPlace: 'Mechová, okres Lesní' });
    const hu = s.couple(head, headWife);
    const family: Person[] = [head, headWife];
    for (let i = 0; i < 3; i++) {
        const c = s.child(hu, s.person(i === 1 ? 'female' : 'male', 'Jilm', 1846 + i * 2, { birthPlace: 'Mechová' }));
        family.push(c);
        if (i < 2) {
            const sp = s.person(i === 1 ? 'male' : 'female', 'Modřín', 1848 + i * 2);
            family.push(sp);
            if (i === 0) family.push(s.child(s.couple(c, sp), s.person('male', 'Jilm', 1872)));
            else s.couple(sp, c);
        }
    }
    const mother = s.person('female', 'Jilm', 1860, { birthPlace: 'Křemenná' });
    const kids = [s.person('male', 'Jilm', 1885), s.person('female', 'Jilm', 1888)];
    for (const k of kids) s.child(mother, k);
    const singles = [s.person('male', 'Jilm', 1801), s.person('female', 'Modřín', 1803)];

    const pairs: Array<[PersonId, PersonId]> = [[s1.id, t1.id], [s2.id, t2.id], [s3.id, t3.id]];
    return {
        target: t.data, source: s.data, state: stateOf(t.data, s.data, pairs),
        t2, linked, head, family, mother, kids, singles,
    };
}

const idsOf = (list: readonly Person[]): PersonId[] => list.map(p => p.id);

describe('unlinkedGroups', () => {
    it('the example: the Jilm family from Mechová (8), the mother and children (3), the individuals (2), largest first', () => {
        const { state, family, mother, kids, singles, linked } = example();
        const groups = unlinkedGroups(state, addChoices());
        expect(groups.map(g => [g.kind, g.persons.length])).toEqual([['family', 8], ['family', 3], ['singles', 2]]);
        const [a, b, c] = groups;
        expect(new Set(a.persons)).toEqual(new Set(idsOf(family)));
        expect(a.title).toBe('Jilm (Mechová)');
        expect(a.places[0]).toBe('Mechová');
        expect(a.years).toEqual({ from: 1820, to: 1880 });
        expect(new Set(b.persons)).toEqual(new Set([mother.id, ...idsOf(kids)]));
        expect(b.title).toBe(`${mother.firstName} ${mother.lastName} and children`);
        expect(c).toMatchObject({ key: 'singles', title: 'Individuals', persons: idsOf(singles) });
        // The linked son is in no group.
        expect(groups.some(g => g.persons.includes(linked.id))).toBe(false);
    });

    it('30 people without relatives are one group of individuals', () => {
        const t = new Family('t');
        const t1 = t.person('male', 'Modřín', 1850);
        const s = new Family('s');
        const s1 = s.person('male', 'Modřín', 1850, { firstName: t1.firstName });
        for (let i = 0; i < 30; i++) s.person(i % 2 ? 'female' : 'male', 'Jilm', 1800 + i);
        const groups = unlinkedGroups(stateOf(t.data, s.data, [[s1.id, t1.id]]), addChoices());
        expect(groups.length).toBe(1);
        expect(groups[0]).toMatchObject({ key: 'singles', kind: 'singles' });
        expect(groups[0].persons.length).toBe(30);
    });

    it('nothing joined: the whole import is one group, which can be split by family', () => {
        const { target, source } = example();
        const state = stateOf(target, source, []);
        const all = unlinkedGroups(state, addChoices());
        expect(all.length).toBe(1);
        expect(all[0]).toMatchObject({ key: 'all', kind: 'all', title: 'The whole import' });
        expect(all[0].persons.length).toBe(Object.keys(source.persons).length);
        const split = unlinkedGroups(state, addChoices({ splitGroups: ['all'] }));
        expect(split.map(g => g.key)).toEqual(['all/jilm', 'all/modrin']);
        expect(split.every(g => g.kind === 'rod')).toBe(true);
        expect(split[0].persons.length + split[1].persons.length).toBe(all[0].persons.length);
    });

    it('none unlinked when every new person has a way; none in a new tree or an update', () => {
        const { state, family, mother, kids, singles } = example();
        const leftOut = idsOf([...family, mother, ...kids, ...singles]);
        expect(unlinkedGroups(state, addChoices({ leftOut }))).toEqual([]);
        expect(unlinkedGroups(state, addChoices({ mode: 'new' }))).toEqual([]);
        expect(unlinkedGroups(state, addChoices({ scope: 'd' }))).toEqual([]);
    });
});

describe('group decisions in the plan', () => {
    function decided(over: Record<number, GroupDecision> = {}) {
        const ex = example();
        const groups = unlinkedGroups(ex.state, addChoices());
        const defaults: GroupDecision[] = [
            { kind: 'connect', person: ex.head.id, rel: 'parent', to: ex.t2.id, in: 'tree' },
            { kind: 'loose' },
            { kind: 'skip' },
        ];
        const decisions = Object.fromEntries(groups.map((g, i) => [g.key, over[i] ?? defaults[i]]));
        return { ...ex, groups, w: addChoices({ groups: decisions }) };
    }

    it('undecided groups are pending: they hold the guide; nothing is decided before a choice', () => {
        const { state, groups } = decided();
        const plan = buildPlan(state, addChoices({ groups: {} }));
        const c = planCounts(plan);
        whole(c);
        expect(c.pending).toBe(13);
        expect(plan.groups?.map(g => g.decision)).toEqual([null, null, null]);
        for (const g of groups) for (const id of g.persons) expect(planFates(plan).get(id)).toBe('pending');
        // Without `groups` (a guide that does not ask yet) the unlinked are added as before.
        expect(planCounts(buildPlan(state, addChoices())).pending).toBe(0);
    });

    it('the example\'s path: link the family, add the mother and children, leave out the individuals', async () => {
        const { state, w, target, source, head, t2, singles } = decided();
        const plan = buildPlan(state, w);
        const c = planCounts(plan);
        whole(c);
        expect(c).toMatchObject({ joined: 3, added: 12, skipped: 2, pending: 0, total: 17 });
        expect(plan.items.filter(i => i.kind === 'connect')).toEqual([{ kind: 'connect', group: plan.groups![0].key, person: head.id, rel: 'parent', to: t2.id, in: 'tree' }]);
        for (const id of idsOf(singles)) expect(plan.items).toContainEqual({ kind: 'skip', id, reason: 'group' });

        const result = await applyPlan(plan, target, source);
        expect(result.issues).toEqual([]);
        expect(result.ok).toBe(true);
        expect(result.ownTrees).toEqual([]);
        const h = result.trace!.persons.get(head.id)!;
        const t2After = result.data.persons[t2.id];
        expect(t2After.parentIds).toContain(h);
        expect(result.data.persons[h].childIds).toContain(t2.id);
        // The group is linked now: the tree person's new father leads to it.
        expect(verifyResult(plan, target, source, result.data)).toEqual([]);
        // Nothing of the tree is lost.
        for (const id of Object.keys(target.persons)) expect(result.data.persons[id]).toBeTruthy();
    });

    it('a link to a person of the import links through them', async () => {
        const { target, source, linked, mother } = decided();
        const ex = decided({ 1: { kind: 'connect', person: mother.id, rel: 'partner', to: linked.id, in: 'import' } });
        const plan = buildPlan(ex.state, ex.w);
        whole(planCounts(plan));
        expect(planCounts(plan).partnerships).toBeGreaterThanOrEqual(1);
        const result = await applyPlan(plan, target, source);
        expect(result.ok).toBe(true);
        const m = result.data.persons[result.trace!.persons.get(mother.id)!];
        const l = result.trace!.persons.get(linked.id)!;
        expect(m.partnerships.some(uid => {
            const u = result.data.partnerships[uid];
            return u.person1Id === l || u.person2Id === l;
        })).toBe(true);
    });

    it('a link to a person of the same group, or to one not written, does not count as linked: the group stays pending', () => {
        const { state, family, singles } = decided();
        const groups = unlinkedGroups(state, addChoices());
        const own = buildPlan(state, addChoices({ groups: { [groups[0].key]: { kind: 'connect', person: family[0].id, rel: 'parent', to: family[2].id, in: 'import' } } }));
        expect(own.groups?.[0].decision).toBeNull();
        expect(planFates(own).get(family[0].id)).toBe('pending');
        const toSkipped = buildPlan(state, addChoices({
            groups: { [groups[0].key]: { kind: 'connect', person: family[0].id, rel: 'parent', to: singles[0].id, in: 'import' }, singles: { kind: 'skip' } },
        }));
        expect(planFates(toSkipped).get(family[0].id)).toBe('pending');
        whole(planCounts(toSkipped));
    });

    it('a separate tree: the group is not written into the tree but comes back as a tree of its own', async () => {
        const { target, source, mother, kids } = decided();
        const ex = decided({ 1: { kind: 'own-tree' } });
        const plan = buildPlan(ex.state, ex.w);
        const c = planCounts(plan);
        whole(c);
        expect(c.added).toBe(12);
        expect(plan.groups?.[1].ownTreeName).toBe(`Modřínovi – ${mother.firstName} ${mother.lastName} and children`);
        const result = await applyPlan(plan, target, source);
        expect(result.issues).toEqual([]);
        expect(result.ok).toBe(true);
        for (const id of [mother.id, ...idsOf(kids)]) {
            const to = result.trace!.persons.get(id);
            expect(to && result.data.persons[to]).toBeFalsy();
        }
        expect(result.ownTrees.length).toBe(1);
        const own = result.ownTrees[0];
        expect(own.name).toBe(plan.groups?.[1].ownTreeName);
        expect(new Set(own.persons)).toEqual(new Set([mother.id, ...idsOf(kids)]));
        const named = Object.values(own.data.persons).filter(p => !p.isPlaceholder);
        expect(named.length).toBe(3);
        expect(own.data.persons[own.trace.persons.get(kids[0].id)!].parentIds).toContain(own.trace.persons.get(mother.id));
    });

    it('do not add: the group is skipped with its reason; a decision for every group lets the guide on', () => {
        const ex = decided({ 0: { kind: 'skip' }, 1: { kind: 'skip' } });
        const plan = buildPlan(ex.state, ex.w);
        const c = planCounts(plan);
        whole(c);
        expect(c).toMatchObject({ added: 1, skipped: 13, pending: 0 });
    });
});

/** The ids the data refers to that are not in it. */
function danglingIds(data: StromData): string[] {
    const out: string[] = [];
    for (const p of Object.values(data.persons)) {
        for (const id of [...p.parentIds, ...p.childIds]) if (!data.persons[id]) out.push(`${p.id}→${id}`);
        for (const uid of p.partnerships) if (!data.partnerships[uid]) out.push(`${p.id}→${uid}`);
    }
    return out;
}

describe('selection and groups together', () => {
    it('unticking the mother leaves her children as individuals with the others', () => {
        const { state, mother, kids, singles } = example();
        const w = addChoices({ leftOut: [mother.id] });
        const groups = unlinkedGroups(state, w, selectionOf(state, w));
        const ind = groups.find(g => g.key === 'singles')!;
        expect(new Set(ind.persons)).toEqual(new Set([...idsOf(kids), ...idsOf(singles)]));
    });

    it('nothing written refers to a person or union that is not there', async () => {
        const ex = example();
        const groups = unlinkedGroups(ex.state, addChoices());
        const w = addChoices({ groups: Object.fromEntries(groups.map(g => [g.key, { kind: 'loose' } as GroupDecision])) });
        const result = await applyPlan(buildPlan(ex.state, w), ex.target, ex.source);
        expect(result.ok).toBe(true);
        expect(danglingIds(result.data)).toEqual([]);
    });
});
