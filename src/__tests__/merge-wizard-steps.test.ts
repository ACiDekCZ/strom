/**
 * Which steps of the import and merge guide can be entered (spec 134 §1):
 * a new tree skips steps 2 and 4, scope a) without differing couples skips
 * step 4, a differing couple brings it back; an undecided pair locks the
 * steps after step 2. Step 4 is skipped while it is not built
 * (STEP_4_PENDING); the rules for when it is built are checked on a copy of
 * the module with the switch off. Step 3 is built: a new tree goes past it
 * unless people are picked.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MergePlan, PlanItem, WizardChoices } from '../merge/plan.js';
import type { PersonId } from '../types.js';
import * as live from '../merge/wizard-steps.js';

type Steps = typeof live;
type Choices = Pick<WizardChoices, 'mode' | 'scope' | 'pickPeople' | 'writtenAt'>;

function plan(o: { pending?: boolean; unions?: number; differences?: number; groupPending?: boolean } = {}): MergePlan {
    const items: PlanItem[] = [{ kind: 'person-join', id: 'i1' as PersonId, target: 't1' as PersonId, on: true }];
    if (o.pending) items.push({ kind: 'person-pending', id: 'i2' as PersonId, candidate: 't2' as PersonId, score: 60 });
    if (o.groupPending) items.push({ kind: 'group-pending', id: 'i3' as PersonId, group: 'singles' });
    return {
        id: 'mp-test', mode: 'add', scope: 'a',
        source: { kind: 'ged', label: 'rodokmen-Jilmovi.ged', persons: 2 },
        target: { treeId: null, name: 'Modřínovi', persons: 2, fingerprint: 'fp', research: false },
        items, notTaken: [], rules: { all: 'mine' }, createdAt: '2026-05-04T10:00:00.000Z',
        conflicts: { differences: o.differences ?? 0, unions: o.unions ?? 0 },
    };
}

/** The module with step 4 built (its switch off), loaded from a copy. */
async function withStepsBuilt(): Promise<Steps> {
    const file = fileURLToPath(new URL('../merge/wizard-steps.ts', import.meta.url));
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('export const STEP_4_PENDING = true;');
    const dir = mkdtempSync(join(tmpdir(), 'strom-wizard-steps-'));
    const copy = join(dir, 'wizard-steps-built.ts');
    writeFileSync(copy, text.replace('export const STEP_4_PENDING = true;', 'export const STEP_4_PENDING = false;'));
    try {
        return await import(/* @vite-ignore */ copy) as Steps;
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

/** What holds whether step 4 is built or not. */
function commonRules(steps: Steps): void {
    const { stepAvailability, stepInfo, nextStep, previousStep } = steps;
    const add: Choices = { mode: 'add', scope: 'c' };

    // Before the comparison: only step 1 (and the skipped ones).
    const before = stepAvailability(add, null);
    expect(before[1]).toBe('ok');
    expect(before[2]).toBe('locked');
    expect(before[5]).toBe('locked');
    expect(before[6]).toBe('locked');

    // A new tree: steps 2 and 4 skipped as "new tree".
    const info = stepInfo({ mode: 'new', scope: 'a' }, plan());
    expect(info[2]).toEqual({ state: 'skip', reason: 'newTree' });
    expect(info[4]).toEqual({ state: 'skip', reason: 'newTree' });
    expect(info[3]).toEqual({ state: 'skip', reason: 'allNew' });
    expect(info[5].state).toBe('ok');
    const newWay = stepAvailability({ mode: 'new', scope: 'a' }, plan());
    expect(nextStep(1, newWay)).toBe(5);
    expect(previousStep(5, newWay)).toBe(1);

    // An undecided pair: step 2 open, step 5 locked.
    const open = stepAvailability(add, plan({ pending: true }));
    expect(open[2]).toBe('ok');
    expect(open[5]).toBe('locked');

    // Step 6 only after the write; never in Only compare.
    expect(stepAvailability({ ...add, writtenAt: '2026-05-04T10:05:00.000Z' }, plan())[6]).toBe('ok');
    expect(stepInfo({ mode: 'compare', scope: 'c' }, plan())[6]).toEqual({ state: 'skip', reason: 'compare' });
    const compare = stepAvailability({ mode: 'compare', scope: 'c' }, plan());
    expect(nextStep(5, compare)).toBeNull();
    expect(previousStep(1, compare)).toBeNull();
}

describe('stepAvailability while step 4 is not built (STEP_4_PENDING)', () => {
    it('is on now', () => {
        expect(live.STEP_4_PENDING).toBe(true);
    });

    it('keeps the rules every way shares', () => {
        commonRules(live);
    });

    it('opens step 3 after step 2 and skips step 4 as "my tree applies" on every scope', () => {
        for (const scope of ['a', 'b', 'c', 'd'] as const) {
            for (const p of [plan(), plan({ unions: 2, differences: 3 })]) {
                const info = live.stepInfo({ mode: 'add', scope }, p);
                expect(info[3]).toEqual({ state: 'ok' });
                expect(info[4]).toEqual({ state: 'skip', reason: 'mineRule' });
            }
        }
        const way = live.stepAvailability({ mode: 'add', scope: 'c' }, plan());
        expect(live.nextStep(2, way)).toBe(3);
        expect(live.nextStep(3, way)).toBe(5);
        expect(live.previousStep(5, way)).toBe(3);
        expect(live.stepAvailability({ mode: 'add', scope: 'c' }, plan({ pending: true }))[3]).toBe('locked');
    });

    it('an unlinked group left to decide (§6) locks only what comes after step 3', () => {
        const way = live.stepAvailability({ mode: 'add', scope: 'a' }, plan({ groupPending: true }));
        expect(way[3]).toBe('ok');
        expect(way[5]).toBe('locked');
        expect(live.nextStep(3, way)).toBe(5);
    });

    it('a new tree goes past step 3 unless people are picked (step 5\'s "Choose people…")', () => {
        expect(live.stepInfo({ mode: 'new', scope: 'a' }, plan())[3]).toEqual({ state: 'skip', reason: 'allNew' });
        const picked = live.stepAvailability({ mode: 'new', scope: 'a', pickPeople: true }, plan());
        expect(picked[3]).toBe('ok');
        expect(live.nextStep(1, picked)).toBe(3);
        expect(live.nextStep(3, picked)).toBe(5);
    });
});

describe('stepAvailability with steps 3 and 4 built', () => {
    it('keeps the rules every way shares', async () => {
        const built = await withStepsBuilt();
        expect(built.STEP_4_PENDING).toBe(false);
        commonRules(built);
    });

    it('scope a) without differing couples skips step 4, with one it is open', async () => {
        const { stepInfo, stepAvailability, nextStep } = await withStepsBuilt();
        expect(stepInfo({ mode: 'add', scope: 'a' }, plan())[4]).toEqual({ state: 'skip', reason: 'scopeA' });
        // Differing details do not matter in a): nothing of a joined person is taken.
        expect(stepInfo({ mode: 'add', scope: 'a' }, plan({ differences: 4 }))[4]).toEqual({ state: 'skip', reason: 'scopeA' });
        expect(stepAvailability({ mode: 'add', scope: 'a' }, plan({ unions: 1 }))[4]).toBe('ok');
        expect(nextStep(3, stepAvailability({ mode: 'add', scope: 'a' }, plan()))).toBe(5);
        expect(nextStep(3, stepAvailability({ mode: 'add', scope: 'a' }, plan({ unions: 1 })))).toBe(4);
        // Other scopes always go through step 4.
        for (const scope of ['b', 'c', 'd'] as const) expect(stepAvailability({ mode: 'add', scope }, plan())[4]).toBe('ok');
    });

    it('steps 3 and 4 are locked while a pair is undecided; a new tree goes through 3 only when people are picked', async () => {
        const { stepAvailability, stepInfo } = await withStepsBuilt();
        const open = stepAvailability({ mode: 'add', scope: 'c' }, plan({ pending: true }));
        expect([open[3], open[4]]).toEqual(['locked', 'locked']);
        expect(stepInfo({ mode: 'new', scope: 'a' }, plan())[3]).toEqual({ state: 'skip', reason: 'allNew' });
        expect(stepAvailability({ mode: 'new', scope: 'a', pickPeople: true }, plan())[3]).toBe('ok');
    });
});
