/**
 * One number of each kind across the merge (134 N4, S-N2, S-N1): the couples,
 * the detail changes and the filled-in details step 5 says (planCounts) are
 * what the write records (record.partnerships, record.fields, the filled
 * details of the record's groups) and what the undo dialog then counts —
 * with "?" stand-ins, scope d) and two of the import joined with one person.
 * Invented persons only.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMergeState } from '../merge/matching.js';
import { applyPlan, buildPlan, planCounts, MergePlan, PlanScope, PlanSource, WizardChoices } from '../merge/plan.js';
import { sanitizeMergeRecords } from '../merge/record.js';
import { planList } from '../merge/steps/step5-plan.js';
import { MergeState } from '../merge/types.js';
import { recordGroups, undoModel, undoShown } from '../merge/undo-view.js';
import { StorageManager } from '../storage.js';
import { strings } from '../strings.js';
import { MergeRecord, Partnership, PartnershipId, Person, PersonId, StromData } from '../types.js';
import { mulberry32, randomDecisions, sourceTree, targetTree } from './helpers/merge-trees.js';

const SOURCE: PlanSource = { kind: 'ged', label: 'rodokmen-jilmovi.ged', persons: 0 };
const SCOPES: readonly PlanScope[] = ['a', 'b', 'c', 'd'];

function choices(over: Partial<WizardChoices> = {}): WizardChoices {
    return {
        mode: 'add', targetTreeId: 'tree-modřín' as WizardChoices['targetTreeId'], scope: 'c', swapped: false,
        source: SOURCE, targetName: 'Modřínovi', targetFingerprint: 'fp-target', planId: 'mp-counts', createdAt: '2026-05-04T10:00:00.000Z',
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
    const standIn = (id: string, gender: Person['gender']): Person => person(id, '?', '', { gender, isPlaceholder: true });
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
    return { data, person, standIn, couple };
}

/** The state of a merge where the import's persons in `joins` are joined with the tree's, the others not. */
function stateOf(target: StromData, source: StromData, joins: Record<string, string>): MergeState {
    const st = createMergeState(target, source);
    st.decisions.clear();
    for (const id of Object.keys(source.persons) as PersonId[]) {
        const to = joins[id];
        st.decisions.set(id, to ? { type: 'manual_match', targetId: to as PersonId } : { type: 'reject' });
    }
    delete st.updateOnly;
    return st;
}

interface Told {
    plan: ReturnType<typeof planCounts>;
    record: MergeRecord;
    data: StromData;
    /** What the undo dialog counts over the merged tree. */
    undo: { couples: number; restored: number };
    /** The filled-in details of step 6 / the merge history (`person|detail`). */
    filled: string[];
}

async function told(plan: MergePlan, target: StromData, source: StromData): Promise<Told> {
    const r = await applyPlan(plan, target, source);
    expect(r.ok).toBe(true);
    const data = r.data;
    data.merges = [r.record];
    const shown = undoShown(undoModel(r.record, data), r.record, data, new Set());
    const filled = recordGroups(r.record, data).find(g => g.key === 'fills')?.lines.map(l => l.key.slice(2)).sort() ?? [];
    return { plan: planCounts(plan), record: r.record, data, undo: { couples: shown.couples, restored: shown.restored }, filled };
}

function expectOneNumber(t: Told): void {
    expect(t.record.partnerships.length).toBe(t.plan.partnerships);
    expect(t.undo.couples).toBe(t.plan.partnerships);
    expect(t.record.fields.length).toBe(t.plan.fieldChanges);
    expect(t.undo.restored).toBe(t.plan.fieldChanges);
    expect(t.filled.length).toBe(t.plan.fieldFills);
    expect(t.record.counts).toEqual(t.plan);
}

beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-04T10:00:00Z'));
});
afterAll(() => { vi.useRealTimers(); });
beforeEach(() => {
    vi.spyOn(StorageManager, 'set').mockResolvedValue(undefined as never);
});

describe('plan, write and undo say one number (134 N4, S-N2)', () => {
    it('on invented trees with stand-ins, in every scope', async () => {
        let couples = 0;
        let fills = 0;
        for (let seed = 1; seed <= 60; seed++) {
            for (const scope of SCOPES) {
                const rnd = mulberry32(seed);
                const target = targetTree(rnd);
                const source = sourceTree(target, rnd);
                const state = createMergeState(target, source);
                randomDecisions(state, rnd);
                delete state.updateOnly;
                const t = await told(buildPlan(state, choices({ scope })), target, source);
                expectOneNumber(t);
                couples += t.plan.partnerships;
                fills += t.plan.fieldFills;
            }
        }
        // The trees bring couples and fill details at all.
        expect(couples).toBeGreaterThan(0);
        expect(fills).toBeGreaterThan(0);
    }, 60000);

    it('a childless "?" spouse of a joined person brings no couple', async () => {
        const t = tree();
        t.person('t1', 'Velemír', 'Modřín', { birthDate: '1850' });
        const s = tree();
        s.couple(s.person('s1', 'Velemír', 'Modřín', { birthDate: '1850' }), s.standIn('s2', 'female'));
        const plan = buildPlan(stateOf(t.data, s.data, { s1: 't1' }), choices());
        const out = await told(plan, t.data, s.data);
        expect(out.plan.partnerships).toBe(0);
        expectOneNumber(out);
    });

    it('scope d) writes no new couple and says none, "?" or not', async () => {
        const t = tree();
        t.person('t1', 'Velemír', 'Modřín', { birthDate: '1850' });
        const s = tree();
        const v = s.person('s1', 'Velemír', 'Modřín', { birthDate: '1850' });
        s.couple(v, s.person('s2', 'Zbyslava', 'Jilmová', { gender: 'female' }), [s.person('s5', 'Bořek', 'Modřín', { birthDate: '1880' })]);
        s.couple(v, s.standIn('s3', 'female'), [s.person('s6', 'Drahoš', 'Modřín', { birthDate: '1885' })]);
        const plan = buildPlan(stateOf(t.data, s.data, { s1: 't1' }), choices({ scope: 'd' }));
        const out = await told(plan, t.data, s.data);
        expect(out.plan.partnerships).toBe(0);
        expectOneNumber(out);
    });

    it('"?" and "?" parents of an added child are one couple, said and written', async () => {
        const t = tree();
        t.person('t1', 'Velemír', 'Modřín', { birthDate: '1850' });
        const s = tree();
        s.person('s1', 'Velemír', 'Modřín', { birthDate: '1850' });
        s.couple(s.standIn('s2', 'male'), s.standIn('s3', 'female'), [s.person('s5', 'Bořek', 'Modřín', { birthDate: '1880' })]);
        const plan = buildPlan(stateOf(t.data, s.data, { s1: 't1' }), choices());
        const out = await told(plan, t.data, s.data);
        expect(out.plan.partnerships).toBe(1);
        expectOneNumber(out);
    });

    it('an empty first name is a detail change the write makes', async () => {
        const t = tree();
        t.person('t1', '', 'Modřín', { birthDate: '1850' });
        const s = tree();
        s.person('s1', 'Velemír', 'Modřín', { birthDate: '1850' });
        const plan = buildPlan(stateOf(t.data, s.data, { s1: 't1' }), choices());
        expect(plan.items.some(i => i.kind === 'field' && i.field === 'firstName' && i.on)).toBe(true);
        const out = await told(plan, t.data, s.data);
        expect(out.data.persons['t1' as PersonId].firstName).toBe('Velemír');
        expectOneNumber(out);
    });

    it('two of the import joined with one person change its detail once', async () => {
        const t = tree();
        t.person('t1', 'Velemír', 'Modřín', { birthDate: '1850' });
        const s = tree();
        s.person('s1', 'Velemír', 'Modřín', { birthDate: '1850', birthPlace: 'Mechová' });
        s.person('s9', 'Velemír', 'Modřín', { birthDate: '1850', birthPlace: 'Mechová' });
        const plan = buildPlan(stateOf(t.data, s.data, { s1: 't1', s9: 't1' }), choices());
        const out = await told(plan, t.data, s.data);
        expect(out.plan.fieldChanges).toBe(1);
        expectOneNumber(out);
    });

    it('the undo counts the tree\'s other records apart from the changed details', async () => {
        const t = tree();
        const tv = t.person('t1', 'Velemír', 'Modřín', { birthDate: '1850' });
        t.couple(tv, t.person('t2', 'Zbyslava', 'Jilmová', { gender: 'female', birthDate: '1855' }));
        const s = tree();
        const v = s.person('s1', 'Velemír', 'Modřín', { birthDate: '1850' });
        s.couple(v, s.person('s2', 'Zbyslava', 'Jilmová', { gender: 'female', birthDate: '1855' }), [s.person('s5', 'Bořek', 'Modřín', { birthDate: '1880' })]);
        const plan = buildPlan(stateOf(t.data, s.data, { s1: 't1', s2: 't2' }), choices());
        const out = await told(plan, t.data, s.data);
        expect(out.plan.fieldChanges).toBe(0);
        expectOneNumber(out);
        // The tree's couple got the new son: back as before, but no detail.
        const model = undoModel(out.record, out.data);
        expect(model.tree).toBeGreaterThan(0);
        expect(model.lines.filter(l => l.group === 'tree').length).toBe(model.tree);
    });
});

describe('filled-in details (134 S-N1)', () => {
    /** Velemír of the tree knows little; the import's knows his e-mail, other spellings, an event, an open question. */
    function fills() {
        const t = tree();
        t.person('t1', 'Velemír', 'Modřín', { birthDate: '1850' });
        const s = tree();
        s.person('s1', 'Velemír', 'Modřín', {
            birthDate: '1850', emails: ['velemir@example.org'], nameVariants: ['Modřínek'], question: 'Kde se oženil?',
            events: [{ id: 'e1', type: 'custom', customLabel: 'Mlynář', date: '1880', place: 'Mechová' }],
        });
        return { t: t.data, s: s.data };
    }
    const KEYS = ['t1|emails', 't1|events', 't1|nameVariants', 't1|question'];

    it('step 5, the write, step 6 and the record count them alike in b), c) and d)', async () => {
        for (const scope of ['b', 'c', 'd'] as const) {
            const { t, s } = fills();
            const plan = buildPlan(stateOf(t, s, { s1: 't1' }), choices({ scope }));
            const items = plan.items.flatMap(i => i.kind === 'fill' ? [`${i.person}|${i.field}`] : []).sort();
            expect(items).toEqual(KEYS);
            const out = await told(plan, t, s);
            expect(out.plan.fieldFills).toBe(4);
            expect(out.filled).toEqual(KEYS);
            expectOneNumber(out);
            expect(out.data.persons['t1' as PersonId].emails).toEqual(['velemir@example.org']);
        }
    });

    it('scope a) fills nothing and says nothing', () => {
        const { t, s } = fills();
        const plan = buildPlan(stateOf(t, s, { s1: 't1' }), choices({ scope: 'a' }));
        expect(planCounts(plan).fieldFills).toBe(0);
    });

    it('step 5 lists them (person – detail) and the write button says them', () => {
        const { t, s } = fills();
        const state = stateOf(t, s, { s1: 't1' });
        const plan = buildPlan(state, choices({ scope: 'b' }));
        const group = planList(plan, state, []).find(g => g.key === 'fills');
        expect(group?.count).toBe(4);
        expect(group?.lines.map(l => `${l.name}|${l.text}`)).toContain(`Velemír Modřín|${strings.mergeWizard.fieldNames.emails}`);
        expect(strings.mergeWizard.btnWrite(0, 0, 4)).toContain('4');
        expect(strings.mergeWizard.btnWrite(1, 2)).toBe(strings.mergeWizard.btnWrite(1, 2, 0));
    });

    it('the record keeps the count through a stored copy, an older record reads 0', async () => {
        const { t, s } = fills();
        const out = await told(buildPlan(stateOf(t, s, { s1: 't1' }), choices({ scope: 'b' })), t, s);
        const back = sanitizeMergeRecords(JSON.parse(JSON.stringify([out.record])));
        expect(back?.[0].counts.fieldFills).toBe(4);
        const older = JSON.parse(JSON.stringify(out.record)) as { counts: Record<string, unknown> };
        delete older.counts.fieldFills;
        expect(sanitizeMergeRecords([older])?.[0].counts.fieldFills).toBe(0);
    });
});
