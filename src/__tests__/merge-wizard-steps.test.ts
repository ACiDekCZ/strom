/**
 * Which steps of the import and merge guide can be entered (spec 134 §1):
 * a new tree skips steps 2 and 4; scopes a) and b) skip step 4 unless the
 * plan has a conflict of relations (then step 4 shows only those, §7 7e);
 * scopes c) and d) always go through it; an undecided pair locks the steps
 * after step 2. A new tree goes past step 3 unless people are picked.
 */

import { describe, it, expect } from 'vitest';
import type { MergePlan, PlanItem, PlanScope, WizardChoices } from '../merge/plan.js';
import type { PersonId } from '../types.js';
import * as steps from '../merge/wizard-steps.js';

type Choices = Pick<WizardChoices, 'mode' | 'scope' | 'pickPeople' | 'writtenAt'>;

function plan(o: { pending?: boolean; relation?: boolean; differences?: number; groupPending?: boolean; scope?: PlanScope; mode?: MergePlan['mode'] } = {}): MergePlan {
    const items: PlanItem[] = [{ kind: 'person-join', id: 'i1' as PersonId, target: 't1' as PersonId, on: true }];
    if (o.pending) items.push({ kind: 'person-pending', id: 'i2' as PersonId, candidate: 't2' as PersonId, score: 60 });
    if (o.groupPending) items.push({ kind: 'group-pending', id: 'i3' as PersonId, group: 'singles' });
    if (o.relation) items.push({ kind: 'relation', key: 'parents:t1', rel: 'parents', choice: 'mine' });
    return {
        id: 'mp-test', mode: o.mode ?? 'add', scope: o.scope ?? 'a',
        source: { kind: 'ged', label: 'rodokmen-Jilmovi.ged', persons: 2 },
        target: { treeId: null, name: 'Modřínovi', persons: 2, fingerprint: 'fp', research: false },
        items, notTaken: [], rules: { all: 'mine' }, createdAt: '2026-05-04T10:00:00.000Z',
        conflicts: { differences: o.differences ?? 0, unions: o.relation ? 1 : 0 },
    };
}

describe('stepAvailability', () => {
    const { stepAvailability, stepInfo, nextStep, previousStep } = steps;

    it('keeps the rules every way shares', () => {
        const add: Choices = { mode: 'add', scope: 'c' };

        // Before the comparison: only step 1 (and the skipped ones).
        const before = stepAvailability(add, null);
        expect(before[1]).toBe('ok');
        expect(before[2]).toBe('locked');
        expect(before[5]).toBe('locked');
        expect(before[6]).toBe('locked');

        // A new tree: steps 2 and 4 skipped as "new tree".
        const info = stepInfo({ mode: 'new', scope: 'a' }, plan({ mode: 'new' }));
        expect(info[2]).toEqual({ state: 'skip', reason: 'newTree' });
        expect(info[4]).toEqual({ state: 'skip', reason: 'newTree' });
        expect(info[3]).toEqual({ state: 'skip', reason: 'allNew' });
        expect(info[5].state).toBe('ok');
        const newWay = stepAvailability({ mode: 'new', scope: 'a' }, plan({ mode: 'new' }));
        expect(nextStep(1, newWay)).toBe(5);
        expect(previousStep(5, newWay)).toBe(1);

        // An undecided pair: step 2 open, steps 3–5 locked.
        const open = stepAvailability(add, plan({ pending: true, scope: 'c' }));
        expect(open[2]).toBe('ok');
        expect([open[3], open[4], open[5]]).toEqual(['locked', 'locked', 'locked']);

        // Step 6 only after the write; never in Only compare.
        expect(stepAvailability({ ...add, writtenAt: '2026-05-04T10:05:00.000Z' }, plan({ scope: 'c' }))[6]).toBe('ok');
        expect(stepInfo({ mode: 'compare', scope: 'c' }, plan({ scope: 'c', mode: 'compare' }))[6]).toEqual({ state: 'skip', reason: 'compare' });
        const compare = stepAvailability({ mode: 'compare', scope: 'c' }, plan({ scope: 'c', mode: 'compare' }));
        expect(nextStep(5, compare)).toBeNull();
        expect(previousStep(1, compare)).toBeNull();
    });

    it('scopes a) and b) skip step 4 by the scope; a conflict of relations brings it back', () => {
        for (const scope of ['a', 'b'] as const) {
            // Differing details do not matter in a) and b): the tree's values stay.
            expect(stepInfo({ mode: 'add', scope }, plan({ scope }))[4]).toEqual({ state: 'skip', reason: 'scope' });
            expect(stepInfo({ mode: 'add', scope }, plan({ scope, differences: 4 }))[4]).toEqual({ state: 'skip', reason: 'scope' });
            expect(stepAvailability({ mode: 'add', scope }, plan({ scope, relation: true }))[4]).toBe('ok');
            expect(nextStep(3, stepAvailability({ mode: 'add', scope }, plan({ scope })))).toBe(5);
            expect(previousStep(5, stepAvailability({ mode: 'add', scope }, plan({ scope })))).toBe(3);
            expect(nextStep(3, stepAvailability({ mode: 'add', scope }, plan({ scope, relation: true })))).toBe(4);
        }
        // Scopes c) and d) always go through step 4, Only compare too.
        for (const scope of ['c', 'd'] as const) expect(stepAvailability({ mode: 'add', scope }, plan({ scope }))[4]).toBe('ok');
        expect(stepAvailability({ mode: 'compare', scope: 'c' }, plan({ scope: 'c', mode: 'compare' }))[4]).toBe('ok');
        expect(steps.step4Need(plan({ scope: 'c', mode: 'compare' }))).toBe('full');
        expect(steps.step4Need(plan({ scope: 'b', relation: true }))).toBe('relations-only');
    });

    it('an unlinked group left to decide (§6) locks only what comes after step 3', () => {
        const way = stepAvailability({ mode: 'add', scope: 'a' }, plan({ groupPending: true }));
        expect(way[3]).toBe('ok');
        expect(way[5]).toBe('locked');
        expect(nextStep(3, way)).toBe(5);
    });

    it('a new tree goes past step 3 unless people are picked (step 5\'s "Choose people…")', () => {
        expect(stepInfo({ mode: 'new', scope: 'a' }, plan({ mode: 'new' }))[3]).toEqual({ state: 'skip', reason: 'allNew' });
        const picked = stepAvailability({ mode: 'new', scope: 'a', pickPeople: true }, plan({ mode: 'new' }));
        expect(picked[3]).toBe('ok');
        expect(nextStep(1, picked)).toBe(3);
        expect(nextStep(3, picked)).toBe(5);
    });
});
