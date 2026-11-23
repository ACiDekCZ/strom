/**
 * Step 5 of the import guide as data (spec 134 §8): what is unticked in the
 * list does not happen — a person left out "unticked (step 5)", a gap or a
 * note kept as the tree has it, a couple or a parent link left out — and
 * the list's groups agree with the plan's counts. Living people's details
 * stay out of the list (13e). Invented persons only.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMergeState } from '../merge/matching.js';
import { applyPlan, buildPlan, planCounts, MergePlan, PlanSource, WizardChoices } from '../merge/plan.js';
import { MergeState } from '../merge/types.js';
import { planList } from '../merge/steps/step5-plan.js';
import { StorageManager } from '../storage.js';
import { strings } from '../strings.js';
import { Partnership, PartnershipId, Person, PersonId, StromData } from '../types.js';

const SOURCE: PlanSource = { kind: 'ged', label: 'rodokmen-jilmovi.ged', persons: 0 };

function choices(over: Partial<WizardChoices> = {}): WizardChoices {
    return {
        mode: 'add', targetTreeId: 'tree-modřín' as WizardChoices['targetTreeId'], scope: 'c', swapped: false,
        source: SOURCE, targetName: 'Modřínovi', targetFingerprint: 'fp-target', planId: 'mp-step5', createdAt: '2026-05-04T10:00:00.000Z',
        ...over,
    };
}

function tree() {
    const data: StromData = { persons: {}, partnerships: {} };
    const person = (id: string, first: string, last: string, o: Partial<Person> = {}): Person => {
        const p: Person = {
            id: id as PersonId, firstName: first, lastName: last, gender: 'male', isPlaceholder: false,
            partnerships: [], parentIds: [], childIds: [], ...o,
        };
        data.persons[p.id] = p;
        return p;
    };
    const couple = (a: Person, b: Person, kids: Person[] = []): Partnership => {
        const u: Partnership = { id: `u-${a.id}-${b.id}` as PartnershipId, person1Id: a.id, person2Id: b.id, childIds: kids.map(k => k.id), status: 'married' };
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

/** Target: Velemír Modřín alone (no birth place, no note), a living cousin. Import: the same Velemír with more, a wife and a son. */
function fixture() {
    const t = tree();
    t.person('t1', 'Velemír', 'Modřín', { birthDate: '1850', deathDate: '1910' });
    t.person('t2', 'Ctibor', 'Modřín', { birthDate: '1990', birthPlace: 'Křemenná' });
    const s = tree();
    const v = s.person('s1', 'Velemír', 'Modřín', { birthDate: '1850', deathDate: '1910', birthPlace: 'Mechová', notes: 'Rolník v Mechové.' });
    const w = s.person('s2', 'Zbyslava', 'Jilmová', { gender: 'female', birthDate: '1855', deathDate: '1920' });
    const k = s.person('s5', 'Bořek', 'Modřín', { birthDate: '1880', deathDate: '1950' });
    s.couple(v, w, [k]);
    s.person('s9', 'Ctibor', 'Modřín', { birthDate: '1990', birthPlace: 'Mechová' });
    const state = (): MergeState => {
        const st = createMergeState(t.data, s.data);
        st.decisions.clear();
        for (const id of Object.keys(s.data.persons) as PersonId[]) {
            const to = id === 's1' ? 't1' : id === 's9' ? 't2' : null;
            st.decisions.set(id, to ? { type: 'manual_match', targetId: to as PersonId } : { type: 'reject' });
        }
        delete st.updateOnly;
        return st;
    };
    return { t: t.data, s: s.data, state };
}

async function written(plan: MergePlan, target: StromData, source: StromData): Promise<StromData> {
    const result = await applyPlan(plan, target, source);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    return result.data;
}

const byName = (data: StromData, first: string): Person | undefined => Object.values(data.persons).find(p => p.firstName === first);

beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-04T10:00:00Z'));
});
afterAll(() => { vi.useRealTimers(); });
beforeEach(() => {
    vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never);
});

describe('unticking in step 5', () => {
    it('a gap and a note unticked stay as the tree has them; ticked they are written', async () => {
        const { t, s, state } = fixture();
        const all = buildPlan(state(), choices());
        expect(all.items.find(i => i.kind === 'field' && i.person === 't1' && i.field === 'birthPlace')).toMatchObject({ on: true, before: '' });
        let after = await written(all, t, s);
        expect(after.persons['t1' as PersonId].birthPlace).toBe('Mechová');
        expect(after.persons['t1' as PersonId].notes).toContain('Rolník');

        const off = buildPlan(state(), choices({ rules: { all: 'mine', value: { 't1|birthPlace': 'mine', 't1|notes': 'mine' } } }));
        expect(off.items.find(i => i.kind === 'field' && i.person === 't1' && i.field === 'birthPlace')).toMatchObject({ on: false });
        expect(off.items.find(i => i.kind === 'field' && i.person === 't1' && i.field === 'notes')).toMatchObject({ on: false });
        expect(planCounts(off).fieldChanges).toBe(planCounts(all).fieldChanges - 2);
        after = await written(off, t, s);
        expect(after.persons['t1' as PersonId].birthPlace).toBeUndefined();
        expect(after.persons['t1' as PersonId].notes).toBeUndefined();
        expect(after.persons['t1' as PersonId].birthDate).toBe('1850');
    });

    it('a couple and a parent link unticked are not written; the people are', async () => {
        const { t, s, state } = fixture();
        const plan = buildPlan(state(), choices({ offLinks: ['u-s1-s2', 's5<s1'] }));
        expect(plan.items.find(i => i.kind === 'partnership-add' && i.id === 'u-s1-s2')).toMatchObject({ on: false });
        expect(plan.items.find(i => i.kind === 'link-add' && i.id === 's5<s1')).toMatchObject({ on: false });
        expect(plan.items.find(i => i.kind === 'link-add' && i.id === 's5<s2')).toMatchObject({ on: true });
        const after = await written(plan, t, s);
        const wife = byName(after, 'Zbyslava')!;
        const son = byName(after, 'Bořek')!;
        expect(after.persons['t1' as PersonId].partnerships).toEqual([]);
        expect(son.parentIds).toEqual([wife.id]);
        expect(after.persons['t1' as PersonId].childIds).not.toContain(son.id);
    });

    it('a person unticked is not added, "unticked (step 5)"; the totals still add up', () => {
        const { state } = fixture();
        const plan = buildPlan(state(), choices({ leftOut: ['s5' as PersonId], leftOutReason: { s5: 'step5' } }));
        expect(plan.items.find(i => i.kind === 'skip' && i.id === 's5')).toMatchObject({ reason: 'step5' });
        const n = planCounts(plan);
        expect(n.joined + n.added + n.skipped + n.pending).toBe(n.total);
        expect(n.added).toBe(1);
        expect(n.skipped).toBe(1);
    });
});

describe('the list of step 5', () => {
    it('groups agree with the plan\'s counts; unticked lines can be ticked back', () => {
        const { state } = fixture();
        const st = state();
        const plan = buildPlan(st, choices({ leftOut: ['s5' as PersonId], leftOutReason: { s5: 'step5' }, offLinks: ['u-s1-s2'] }));
        const n = planCounts(plan);
        const groups = planList(plan, st, ['u-s1-s2']);
        const g = Object.fromEntries(groups.map(x => [x.key, x]));
        expect(groups.map(x => x.key)).toEqual(['new', 'joined', 'fields', 'links', 'sources', 'places', 'skipped']);
        expect(g.new.count).toBe(n.added);
        expect(g.new.lines.map(l => l.name)).toEqual(['Zbyslava Jilmová']);
        expect(g.joined.count).toBe(n.joined);
        expect(g.skipped.lines).toEqual([expect.objectContaining({ key: 's:s5', on: false, can: true, text: strings.mergeWizard.skipWhy.step5 })]);
        expect(g.links.lines.find(l => l.key === 'l:u-s1-s2')).toMatchObject({ on: false, can: true });
        expect(g.fields.lines.length).toBe(n.fieldChanges + n.alongside);
    });

    it('a living person\'s details are not in the list (13e), only that a detail changes', () => {
        const { state } = fixture();
        const st = state();
        const plan = buildPlan(st, choices({ rules: { all: 'import' } }));
        const fields = planList(plan, st).find(x => x.key === 'fields')!;
        const living = fields.lines.find(l => l.key === 'f:t2|birthPlace')!;
        expect(living.living).toBe(true);
        expect(living.text).not.toContain('Mechová');
        expect(living.text).not.toContain('Křemenná');
        const dead = fields.lines.find(l => l.key === 'f:t1|birthPlace')!;
        expect(dead.text).toContain('Mechová');
    });
});
