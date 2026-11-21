/**
 * The window's selection in a tree of thousands (spec 098 §12): after a
 * change of the data (a new lineage index) the people of a family line, of
 * all ancestors, of all descendants and of a list of everyone are counted
 * again, and the map's places gathered for them, within a budget measured
 * against this machine's speed (helpers/perf-budget.ts).
 */
import { describe, it, expect } from 'vitest';
import { syntheticTree } from './helpers/synthetic-tree.js';
import { budgetReport, measureAgainstBudget } from './helpers/perf-budget.js';
import { buildLineages } from '../lineage.js';
import { selectionPersonIds } from '../view-selection.js';
import type { SelectionRef } from '../view-selection-ref.js';
import { collectPlaces } from '../places.js';
import type { PersonId, StromData } from '../types.js';

describe('the selection in a tree of 5 000 people', () => {
    it('recounts the line, ancestors, descendants and a list of everyone and gathers their places within the budget', () => {
        const { data: base, rootId } = syntheticTree({ persons: 5000 });
        const everyone = Object.keys(base.persons) as PersonId[];
        const data: StromData = { ...base, personLists: [{ id: 'all', name: 'Everyone', dynamic: false, personIds: everyone, sort: 'manual', updated: '2026-11-21T10:00:00.000Z' }] };
        const founder = everyone.find(id => !Object.values(data.partnerships).some(u => u.childIds.includes(id))
            && Object.values(data.partnerships).some(u => (u.person1Id === id || u.person2Id === id) && u.childIds.length > 0))!;

        const run = (): number => {
            // A new index, as after every change of the data: nothing comes from the cache.
            const index = buildLineages(data);
            const rod = [...index.rods.keys()][0];
            const refs: SelectionRef[] = [
                { kind: 'rod', rodId: rod },
                { kind: 'ancestors', personId: rootId },
                { kind: 'descendants', personId: founder },
                { kind: 'list', listId: 'all' },
            ];
            let n = 0;
            for (const ref of refs) {
                const ids = selectionPersonIds(data, index, ref);
                expect(ids).not.toBeNull();
                n += ids!.size + collectPlaces(data, ids!).size;
            }
            return n;
        };
        expect(run()).toBeGreaterThan(5000);
        const BUDGET_MS = 200;
        const m = measureAgainstBudget(run, { budgetMs: BUDGET_MS, calibrationRounds: 4, referenceMs: 22, minPairs: 2, maxPairs: 5, maxWallMs: 30_000 });
        console.log(budgetReport('selection recount + places, 5000 people', m, BUDGET_MS));
        if (m.judged) expect(m.ms).toBeLessThan(BUDGET_MS);
    }, 120_000);
});
