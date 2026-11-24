/**
 * Step 4 of the import guide as data (spec 134 §7, K5.1–K5.5): the rules
 * for differences (the narrower rule wins, protected values stay under a
 * bulk rule, "Keep both" keeps the import's value alongside, "More precise"
 * takes only a refinement), their counts, and the conflicts of relations
 * with their choices as the write does them. Invented persons only.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMergeState } from '../merge/matching.js';
import {
    applyPlan, buildPlan, planCounts, planNeedsStep4, resolveField, ruleCounts, relationConflicts,
    MergePlan, PlanRules, PlanSource, RelChoice, WizardChoices,
} from '../merge/plan.js';
import { MergeState } from '../merge/types.js';
import { relationRows, samePersonOf } from '../merge/plan-rules.js';
import { StorageManager } from '../storage.js';
import { strings } from '../strings.js';
import { Partnership, PartnershipId, Person, PersonId, StromData } from '../types.js';
import { mulberry32, randomDecisions, sourceTree, targetTree } from './helpers/merge-trees.js';

const SOURCE: PlanSource = { kind: 'ged', label: 'rodokmen-Jilmovi.ged', persons: 0 };

function choices(over: Partial<WizardChoices> = {}): WizardChoices {
    return {
        mode: 'add', targetTreeId: 'tree-modřín' as WizardChoices['targetTreeId'], scope: 'c', swapped: false,
        source: SOURCE, targetName: 'Modřínovi', targetFingerprint: 'fp-target', planId: 'mp-rules', createdAt: '2026-05-04T10:00:00.000Z',
        ...over,
    };
}

type Builder = {
    data: StromData;
    person: (id: string, first: string, last: string, o?: Partial<Person>) => Person;
    couple: (a: Person, b: Person, kids?: Person[], o?: Partial<Partnership>) => Partnership;
};

function tree(): Builder {
    const data: StromData = { persons: {}, partnerships: {} };
    const person = (id: string, first: string, last: string, o: Partial<Person> = {}): Person => {
        const p: Person = {
            id: id as PersonId, firstName: first, lastName: last, gender: 'male', isPlaceholder: false,
            partnerships: [], parentIds: [], childIds: [], ...o,
        };
        data.persons[p.id] = p;
        return p;
    };
    const couple = (a: Person, b: Person, kids: Person[] = [], o: Partial<Partnership> = {}): Partnership => {
        const u: Partnership = { id: `u-${a.id}-${b.id}` as PartnershipId, person1Id: a.id, person2Id: b.id, childIds: kids.map(k => k.id), status: 'married', ...o };
        data.partnerships[u.id] = u;
        a.partnerships.push(u.id);
        b.partnerships.push(u.id);
        for (const k of kids) {
            k.parentIds.push(a.id, b.id);
            a.childIds.push(k.id);
            b.childIds.push(k.id);
        }
        return u;
    };
    return { data, person, couple };
}

/** The comparison's result, set by hand: these pairs joined, every other person of the import new. */
function stateOf(target: StromData, source: StromData, pairs: Record<string, string>): MergeState {
    const state = createMergeState(target, source);
    state.decisions.clear();
    for (const id of Object.keys(source.persons) as PersonId[]) {
        state.decisions.set(id, pairs[id] ? { type: 'manual_match', targetId: pairs[id] as PersonId } : { type: 'reject' });
    }
    delete state.updateOnly;
    return state;
}

async function written(plan: MergePlan, target: StromData, source: StromData): Promise<StromData> {
    const result = await applyPlan(plan, target, source);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    return result.data;
}

const id = (s: string): PersonId => s as PersonId;

beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-04T10:00:00Z'));
});
afterAll(() => { vi.useRealTimers(); });
beforeEach(() => {
    vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never);
});

describe('resolveField: the narrower rule wins (K5.1)', () => {
    const diff = { person: id('t1'), field: 'birthPlace', before: 'Křemenná', after: 'Mechová', protection: null };

    it('value > person > kind > whole merge', () => {
        const rules: PlanRules = { all: 'import', kind: { places: 'both' }, person: { t1: 'mine' }, value: { 't1|birthPlace': 'import' } };
        expect(resolveField(diff, rules)).toEqual({ result: 'import', source: { level: 'value', choice: 'import' } });
        const noValue: PlanRules = { ...rules, value: {} };
        expect(resolveField(diff, noValue)).toEqual({ result: 'mine', source: { level: 'person', choice: 'mine' } });
        const noPerson: PlanRules = { ...noValue, person: {} };
        expect(resolveField(diff, noPerson)).toEqual({ result: 'both', source: { level: 'kind', choice: 'both' } });
        expect(resolveField(diff, { all: 'import' })).toEqual({ result: 'import', source: { level: 'all', choice: 'import' } });
        expect(resolveField(diff, { all: 'each' }).result).toBe('walk');
        expect(resolveField(diff, { all: 'mine', value: { 't1|birthPlace': 'each' } }).result).toBe('mine');
    });

    it('a protected value stays under every bulk rule, a choice of the value itself changes it (K5.4)', () => {
        const prot = { ...diff, protection: 'proven' as const };
        expect(resolveField(prot, { all: 'import' })).toMatchObject({ result: 'mine', held: true });
        expect(resolveField(prot, { all: 'mine', kind: { places: 'import' } })).toMatchObject({ result: 'mine', held: true });
        expect(resolveField(prot, { all: 'mine', person: { t1: 'import' } })).toMatchObject({ result: 'mine', held: true });
        expect(resolveField(prot, { all: 'mine', value: { 't1|birthPlace': 'import' } })).toEqual({ result: 'import', source: { level: 'value', choice: 'import' } });
        expect(resolveField(prot, { all: 'both' }).result).toBe('both');
    });

    it('"More precise" takes only a refinement that does not contradict', () => {
        const rules: PlanRules = { all: 'precise' };
        expect(resolveField({ ...diff, field: 'birthDate', before: '1850', after: '1850-03-12' }, rules).result).toBe('import');
        expect(resolveField({ ...diff, field: 'birthDate', before: '1850', after: '1851-03-12' }, rules).result).toBe('mine');
        expect(resolveField({ ...diff, field: 'birthDate', before: '1850-03-12', after: '1850' }, rules).result).toBe('mine');
        expect(resolveField({ ...diff, field: 'gender', before: 'male', after: 'female' }, rules).result).toBe('mine');
    });
});

/** A person both files know, with differing details; the tree's birth is proven. */
function differing(): { t: Builder; s: Builder; state: () => MergeState } {
    const t = tree();
    t.person('t1', 'Velemír', 'Modřín', { birthDate: '1850', birthPlace: 'Křemenná', birthStatus: 'proven', deathDate: '1910', deathPlace: 'Křemenná' });
    t.person('t2', 'Kojata', 'Modřín', { birthDate: '1878', birthPlace: 'Křemenná' });
    const s = tree();
    s.person('s1', 'Velemil', 'Modřín', { birthDate: '1850-03-12', birthPlace: 'Mechová', deathDate: '1911', deathPlace: 'Mechová' });
    s.person('s2', 'Kojata', 'Modřín', { birthDate: '1878-01-01', birthPlace: 'Mechová', gender: 'female' });
    return { t, s, state: () => stateOf(t.data, s.data, { s1: 't1', s2: 't2' }) };
}

describe('rules in the plan and the write', () => {
    it('a bulk "From the import" does not overwrite a protected value; a choice of the value does', async () => {
        const { t, s, state } = differing();
        const bulk = buildPlan(state(), choices({ rules: { all: 'import' } }));
        const birth = bulk.items.find(i => i.kind === 'field' && i.person === 't1' && i.field === 'birthPlace');
        expect(birth).toMatchObject({ on: false, protected: true });
        expect(bulk.items.find(i => i.kind === 'field' && i.person === 't2' && i.field === 'birthPlace')).toMatchObject({ on: true, protected: false });
        let after = await written(bulk, t.data, s.data);
        expect(after.persons[id('t1')].birthPlace).toBe('Křemenná');
        expect(after.persons[id('t1')].birthDate).toBe('1850');
        expect(after.persons[id('t2')].birthPlace).toBe('Mechová');

        const one = buildPlan(state(), choices({ rules: { all: 'import', value: { 't1|birthPlace': 'import' } } }));
        after = await written(one, t.data, s.data);
        expect(after.persons[id('t1')].birthPlace).toBe('Mechová');
        expect(after.persons[id('t1')].birthDate).toBe('1850');
    });

    it('"Keep both": the import\'s value alongside (name variant, other birth and death record, note), nothing overwritten', async () => {
        const { t, s, state } = differing();
        const plan = buildPlan(state(), choices({ rules: { all: 'both' } }));
        const both = plan.items.filter(i => i.kind === 'field-both');
        expect(both.map(i => i.kind === 'field-both' && `${i.person}.${i.field}`).sort()).toEqual(
            ['t1.birthDate', 't1.birthPlace', 't1.deathDate', 't1.deathPlace', 't1.firstName', 't2.birthDate', 't2.birthPlace', 't2.gender']);
        expect(plan.items.some(i => i.kind === 'field' && i.on && i.before !== '' && i.field !== 'notes')).toBe(false);
        expect(planCounts(plan).alongside).toBe(8);
        const after = await written(plan, t.data, s.data);
        const v = after.persons[id('t1')];
        expect([v.firstName, v.birthDate, v.birthPlace, v.deathDate, v.deathPlace]).toEqual(['Velemír', '1850', 'Křemenná', '1910', 'Křemenná']);
        expect(v.nameVariants).toContain('Velemil');
        const alt = (v.events ?? []).filter(e => e.type === 'custom');
        expect(alt).toEqual(expect.arrayContaining([
            expect.objectContaining({ customLabel: strings.gedcomNotes.altBirth, date: '1850-03-12', place: 'Mechová' }),
            expect.objectContaining({ customLabel: strings.gedcomNotes.altDeath, date: '1911', place: 'Mechová' }),
        ]));
        expect(after.persons[id('t2')].notes).toContain(strings.mergeWizard.importSays(`${strings.mergeWizard.fieldNames.gender} ${strings.gender.female}`));
        expect(after.persons[id('t2')].gender).toBe('male');
    });

    it('"More precise" writes the refinement, not the contradiction', async () => {
        const { t, s, state } = differing();
        const plan = buildPlan(state(), choices({ rules: { all: 'precise' } }));
        const after = await written(plan, t.data, s.data);
        expect(after.persons[id('t2')].birthDate).toBe('1878-01-01');
        expect(after.persons[id('t2')].birthPlace).toBe('Křemenná');
        expect(after.persons[id('t1')].birthDate).toBe('1850');
        expect(after.persons[id('t1')].deathDate).toBe('1910');
    });

    it('ruleCounts: each tile counts what the plan of that rule does, with an example', () => {
        const { state } = differing();
        const st = state();
        for (const all of ['mine', 'import', 'both', 'precise', 'each'] as const) {
            const rules: PlanRules = { all, kind: { sex: 'mine' } };
            const rc = ruleCounts(st, rules);
            const plan = buildPlan(st, choices({ rules }));
            const diffs = plan.items.filter(i => i.kind === 'field' && i.before !== '' && i.after !== i.before && i.field !== 'notes');
            const side = plan.items.filter(i => i.kind === 'field-both');
            expect(rc.current).toBe(rc.tiles[all]);
            expect(rc.differences).toBe(diffs.length + side.length);
            expect(rc.current.changes).toBe(diffs.filter(i => i.kind === 'field' && i.on).length);
            expect(rc.current.side).toBe(side.length);
            expect(rc.current.stays + rc.current.changes + rc.current.side).toBe(rc.differences);
            expect(rc.current.example).not.toBeNull();
        }
        const rc = ruleCounts(st, { all: 'import', person: { t2: 'mine' } });
        expect(rc.protected).toBe(2);
        expect(rc.tiles.import.protected).toBe(2);
        expect(rc.byPerson.find(r => r.person === 't2')).toMatchObject({ exceptions: rc.byPerson.find(r => r.person === 't2')!.differences });
        expect(rc.byKind.places.differences).toBe(3);
    });

    it('ruleCounts agree with the plan on random pairs of invented trees', () => {
        const pick = <T>(rnd: () => number, list: readonly T[]): T => list[Math.floor(rnd() * list.length)];
        for (let seed = 1; seed <= 60; seed++) {
            const rnd = mulberry32(seed);
            const target = targetTree(rnd);
            const source = sourceTree(target, rnd);
            const st = createMergeState(target, source);
            randomDecisions(st, rnd);
            delete st.updateOnly;
            const rules: PlanRules = { all: pick(rnd, ['mine', 'import', 'both', 'precise', 'each'] as const), kind: { birth: pick(rnd, ['mine', 'import', 'both'] as const) } };
            const rc = ruleCounts(st, rules);
            const plan = buildPlan(st, choices({ rules }));
            // Couples' details count as 'marriage' differences, decided as relations, not as items of persons.
            const m = rc.byKind.marriage.differences;
            const changes = plan.items.filter(i => i.kind === 'field' && i.on && i.before !== '' && i.after !== i.before && i.field !== 'notes').length;
            const side = plan.items.filter(i => i.kind === 'field-both').length;
            if (!m) expect({ seed, changes: rc.current.changes, side: rc.current.side }).toEqual({ seed, changes, side });
            else expect(rc.current.changes + rc.current.side).toBeGreaterThanOrEqual(changes + side);
            const c = planCounts(plan);
            expect(c.joined + c.added + c.skipped + c.pending).toBe(c.total);
        }
    });
});

describe('conflicts of relations (K5.5)', () => {
    /** Tree: Velemír + Dobroslava with Kojata. The import names Kojata's parents per case. */
    function family(): Builder {
        const t = tree();
        t.couple(t.person('t1', 'Velemír', 'Modřín', { birthDate: '1850' }), t.person('t2', 'Dobroslava', 'Modřínová', { gender: 'female', birthDate: '1852' }),
            [t.person('t3', 'Kojata', 'Modřín', { birthDate: '1878' })]);
        return t;
    }
    const parentsOf = (d: StromData, child: string): string[] => [...d.persons[id(child)].parentIds].sort();
    const relation = (plan: MergePlan, rel: string) => plan.items.find(i => i.kind === 'relation' && i.rel === rel);

    it('other parents: mine keeps the tree\'s, the import\'s replace them', async () => {
        const t = family();
        const s = tree();
        s.couple(s.person('s5', 'Radhost', 'Jilm', { birthDate: '1849' }), s.person('s6', 'Mstislava', 'Jilmová', { gender: 'female', birthDate: '1851' }),
            [s.person('s3', 'Kojata', 'Modřín', { birthDate: '1878' })]);
        const st = (): MergeState => stateOf(t.data, s.data, { s3: 't3' });
        const [c] = relationConflicts(st());
        expect(c).toMatchObject({ kind: 'parents', person: 't3', options: ['mine', 'import'] });

        let plan = buildPlan(st(), choices({ scope: 'b' }));
        expect(relation(plan, 'parents')).toMatchObject({ choice: 'mine' });
        expect(planNeedsStep4(plan)).toBe('relations-only');
        let after = await written(plan, t.data, s.data);
        expect(parentsOf(after, 't3')).toEqual(['t1', 't2']);
        expect(Object.values(after.persons).some(p => p.firstName === 'Radhost')).toBe(true);

        plan = buildPlan(st(), choices({ scope: 'b', relations: { [c.key]: 'import' } }));
        expect(plan.items.filter(i => i.kind === 'link-drop')).toHaveLength(2);
        after = await written(plan, t.data, s.data);
        const names = parentsOf(after, 't3').map(p => after.persons[id(p)].firstName).sort();
        expect(names).toEqual(['Mstislava', 'Radhost']);
        expect(after.persons[id('t1')].childIds).not.toContain('t3');
        expect(after.partnerships['u-t1-t2' as PartnershipId].childIds).not.toContain('t3');
        expect(after.persons[id('t1')].partnerships).toEqual(['u-t1-t2']);
    });

    it('a third parent: mine leaves it out, the import\'s replaces the tree\'s other parent', async () => {
        const t = family();
        const s = tree();
        s.couple(s.person('s1', 'Velemír', 'Modřín', { birthDate: '1850' }), s.person('s7', 'Hostislava', 'Jilmová', { gender: 'female', birthDate: '1853' }),
            [s.person('s3', 'Kojata', 'Modřín', { birthDate: '1878' })]);
        const st = (): MergeState => stateOf(t.data, s.data, { s1: 't1', s3: 't3' });
        const c = relationConflicts(st()).find(r => r.kind === 'third-parent')!;
        expect(c).toMatchObject({ person: 't3', options: ['mine', 'import'] });

        let after = await written(buildPlan(st(), choices({ scope: 'b' })), t.data, s.data);
        expect(parentsOf(after, 't3')).toEqual(['t1', 't2']);

        after = await written(buildPlan(st(), choices({ scope: 'b', relations: { [c.key]: 'import' } })), t.data, s.data);
        expect(parentsOf(after, 't3').map(p => after.persons[id(p)].firstName).sort()).toEqual(['Hostislava', 'Velemír']);
    });

    it('a second partner: mine leaves the import\'s couple out, the import\'s replaces the tree\'s, both keeps both', async () => {
        const t = family();
        const s = tree();
        s.couple(s.person('s1', 'Velemír', 'Modřín', { birthDate: '1850' }), s.person('s8', 'Zbyslava', 'Jilmová', { gender: 'female', birthDate: '1855' }));
        const st = (): MergeState => stateOf(t.data, s.data, { s1: 't1' });
        const [c] = relationConflicts(st());
        expect(c).toMatchObject({ kind: 'partner', person: 't1', mine: ['t2'], options: ['mine', 'import', 'both'] });
        const partners = (d: StromData): string[] => d.persons[id('t1')].partnerships.map(u => {
            const p = d.partnerships[u];
            return d.persons[p.person1Id === 't1' ? p.person2Id : p.person1Id].firstName;
        }).sort();

        let after = await written(buildPlan(st(), choices({ scope: 'b' })), t.data, s.data);
        expect(partners(after)).toEqual(['Dobroslava']);
        after = await written(buildPlan(st(), choices({ scope: 'b', relations: { [c.key]: 'import' } })), t.data, s.data);
        expect(partners(after)).toEqual(['Zbyslava']);
        expect(parentsOf(after, 't3')).toEqual(['t1', 't2']);
        after = await written(buildPlan(st(), choices({ scope: 'b', relations: { [c.key]: 'both' } })), t.data, s.data);
        expect(partners(after)).toEqual(['Dobroslava', 'Zbyslava']);
    });

    it('a different marriage: mine, the import\'s, or both with the import\'s in the couple\'s note; a protected one stays under a bulk rule', async () => {
        const t = family();
        t.data.partnerships['u-t1-t2' as PartnershipId].startDate = '1875';
        const s = tree();
        s.couple(s.person('s1', 'Velemír', 'Modřín', { birthDate: '1850' }), s.person('s2', 'Dobroslava', 'Modřínová', { gender: 'female', birthDate: '1852' }),
            [], { startDate: '1876', startPlace: 'Mechová' });
        const st = (): MergeState => stateOf(t.data, s.data, { s1: 't1', s2: 't2' });
        const c = relationConflicts(st()).find(r => r.kind === 'marriage')!;
        expect(c.options).toEqual(['mine', 'import', 'both']);
        const union = (d: StromData): Partnership => d.partnerships['u-t1-t2' as PartnershipId];

        // Only where joined persons' details change: scope a/b leave the couple as it is.
        expect(relation(buildPlan(st(), choices({ scope: 'b' })), 'marriage')).toBeUndefined();
        let after = await written(buildPlan(st(), choices({ relations: { [c.key]: 'mine' }, rules: { all: 'import' } })), t.data, s.data);
        expect(union(after).startDate).toBe('1875');
        after = await written(buildPlan(st(), choices({ rules: { all: 'mine', kind: { marriage: 'import' } } })), t.data, s.data);
        expect([union(after).startDate, union(after).startPlace]).toEqual(['1876', 'Mechová']);
        after = await written(buildPlan(st(), choices({ relations: { [c.key]: 'both' } })), t.data, s.data);
        expect(union(after).startDate).toBe('1875');
        expect(union(after).note).toContain(strings.mergeWizard.importSays('1876, Mechová'));

        t.data.partnerships['u-t1-t2' as PartnershipId].startStatus = 'proven';
        after = await written(buildPlan(st(), choices({ rules: { all: 'import' } })), t.data, s.data);
        expect(union(after).startDate).toBe('1875');
        after = await written(buildPlan(st(), choices({ rules: { all: 'mine' }, relations: { [c.key]: 'import' } })), t.data, s.data);
        expect(union(after).startDate).toBe('1876');
    });

    it('a link that would make a person its own ancestor is a conflict "mine" only and never in the plan', async () => {
        const t = family();
        const s = tree();
        // The import says Kojata is Velemír's father.
        s.couple(s.person('s3', 'Kojata', 'Modřín', { birthDate: '1878' }), s.person('s9', 'Ludmila', 'Jilmová', { gender: 'female', birthDate: '1880' }),
            [s.person('s1', 'Velemír', 'Modřín', { birthDate: '1850' })]);
        const st = (): MergeState => stateOf(t.data, s.data, { s1: 't1', s3: 't3' });
        const loop = relationConflicts(st()).find(r => r.kind === 'loop')!;
        expect(loop).toMatchObject({ person: 't1', options: ['mine'] });
        const relations: Record<string, RelChoice> = { [loop.key]: 'import' };
        const plan = buildPlan(st(), choices({ scope: 'b', relations }));
        expect(relation(plan, 'loop')).toMatchObject({ choice: 'mine' });
        expect(plan.items.some(i => i.kind === 'link-add' && i.id === 's1<s3')).toBe(false);
        const after = await written(plan, t.data, s.data);
        expect(after.persons[id('t1')].parentIds).not.toContain('t3');
        expect(after.persons[id('t3')].parentIds.sort()).toEqual(['t1', 't2']);
    });

    it('planNeedsStep4: skipped with nothing to decide, relations alone in scope a', () => {
        const t = family();
        const s = tree();
        s.person('s3', 'Kojata', 'Modřín', { birthDate: '1878' });
        const quiet = buildPlan(stateOf(t.data, s.data, { s3: 't3' }), choices({ scope: 'a' }));
        expect(planNeedsStep4(quiet)).toBe('skip');
        const s2 = tree();
        s2.couple(s2.person('s1', 'Velemír', 'Modřín', { birthDate: '1850' }), s2.person('s8', 'Zbyslava', 'Jilmová', { gender: 'female', birthDate: '1855' }));
        const rel = buildPlan(stateOf(t.data, s2.data, { s1: 't1' }), choices({ scope: 'a' }));
        expect(planNeedsStep4(rel)).toBe('relations-only');
        expect(planNeedsStep4({ ...rel, scope: 'c' })).toBe('full');
        expect(planNeedsStep4({ ...rel, mode: 'new' })).toBe('skip');
    });
});

describe('a third parent and a second partner: one row per couple, Same person (K10.7, K10.8)', () => {
    /** The tree: Velemír and Dobroslava with three children. */
    function family(): Builder {
        const t = tree();
        t.couple(t.person('t1', 'Velemír', 'Modřín', { birthDate: '1850' }), t.person('t2', 'Dobroslava', 'Modřínová', { gender: 'female', birthDate: '1852' }),
            ['t3', 't4', 't5'].map((k, i) => t.person(k, ['Kojata', 'Bohumil', 'Ludmila'][i], 'Modřín', { birthDate: String(1878 + i) })));
        return t;
    }
    /** The import: Velemír and Dobroslava under her birth surname, with the same three children. */
    function source(wife: Partial<Person> = {}): Builder {
        const s = tree();
        s.couple(s.person('s1', 'Velemír', 'Modřín', { birthDate: '1850' }), s.person('s2', 'Dobroslava', 'Jilmová', { gender: 'female', birthDate: '1852', ...wife }),
            ['s3', 's4', 's5'].map((k, i) => s.person(k, ['Kojata', 'Bohumil', 'Ludmila'][i], 'Modřín', { birthDate: String(1878 + i) })));
        return s;
    }
    const joined = { s1: 't1', s3: 't3', s4: 't4', s5: 't5' };
    const parentsOf = (d: StromData, child: string): string[] => [...d.persons[id(child)].parentIds].sort();

    it('the children of one couple share one row; the second partner is a row of its own', () => {
        const state = stateOf(family().data, source().data, joined);
        const rels = relationConflicts(state).map(c => ({ c }));
        expect(rels.map(r => r.c.kind).sort()).toEqual(['partner', 'third-parent', 'third-parent', 'third-parent']);
        const rows = relationRows(rels);
        expect(rows.map(r => r.length).sort()).toEqual([1, 3]);
        expect(rows.find(r => r.length === 3)!.map(r => r.c.person).sort()).toEqual(['t3', 't4', 't5']);
    });

    it('Same person joins the wife: the conflicts go, the children keep two parents and him one wife', async () => {
        const t = family();
        const s = source();
        const state = stateOf(t.data, s.data, joined);
        for (const c of relationConflicts(state)) expect(samePersonOf(state, c)).toEqual({ source: 's2', tree: 't2' });
        const before = planCounts(buildPlan(state, choices({ scope: 'b' })));

        // The choice is step 2's decision: the wife picked by hand as the tree's Dobroslava.
        state.decisions.set(id('s2'), { type: 'manual_match', targetId: id('t2'), via: 'step4', prev: { type: 'reject' } });
        expect(relationConflicts(state)).toEqual([]);
        const plan = buildPlan(state, choices({ scope: 'b' }));
        const after = planCounts(plan);
        expect(after.joined).toBe(before.joined + 1);
        expect(after.added).toBe(before.added - 1);
        expect(plan.items.some(i => i.kind === 'relation')).toBe(false);
        const data = await written(plan, t.data, s.data);
        for (const k of ['t3', 't4', 't5']) expect(parentsOf(data, k)).toEqual(['t1', 't2']);
        expect(data.persons[id('t1')].partnerships).toHaveLength(1);
        expect(Object.keys(data.persons)).toHaveLength(5);
    });

    it('is not offered where the join cannot be: another sex, a person of the tree taken, a loop', () => {
        const third = (state: MergeState) => relationConflicts(state).find(c => c.kind === 'third-parent')!;
        let state = stateOf(family().data, source({ gender: 'male' }).data, joined);
        expect(samePersonOf(state, third(state))).toBeNull();

        const taken = source();
        taken.person('s9', 'Dobroslava', 'Modřínová', { gender: 'female', birthDate: '1852' });
        state = stateOf(family().data, taken.data, { ...joined, s9: 't2' });
        expect(relationConflicts(state).filter(c => c.kind === 'third-parent').every(c => samePersonOf(state, c) === null)).toBe(true);

        // The import's wife is a daughter of the tree's Dobroslava's son: joined, she would be her own descendant.
        const loop = source();
        loop.couple(loop.person('s6', 'Kojata', 'Modřín', { birthDate: '1878' }), loop.person('s8', 'Bohdana', 'Jilmová', { gender: 'female' }), []);
        loop.data.persons[id('s2')].parentIds.push(id('s6'));
        loop.data.persons[id('s6')].childIds.push(id('s2'));
        state = stateOf(family().data, loop.data, { ...joined, s6: 't3' });
        const c = relationConflicts(state).find(x => x.kind === 'third-parent' && x.person === 't4')!;
        expect(c).toBeDefined();
        expect(samePersonOf(state, c)).toBeNull();
    });

    it('a saved merge keeps the decision as it was', () => {
        const state = stateOf(family().data, source().data, joined);
        state.decisions.set(id('s2'), { type: 'manual_match', targetId: id('t2'), via: 'step4', prev: { type: 'reject' } });
        const again = new Map(JSON.parse(JSON.stringify([...state.decisions])) as Array<[PersonId, unknown]>);
        expect(again.get(id('s2'))).toEqual({ type: 'manual_match', targetId: 't2', via: 'step4', prev: { type: 'reject' } });
    });
});
