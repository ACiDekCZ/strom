/**
 * Merging the same file again (findMatches) stays fast on a large tree.
 *
 * Every incoming person is scored against every person of the tree, and each
 * score asked the surname rules, which counted the tree's people on every
 * call: a 2 400-person file merged into the tree loaded from it took over
 * three minutes. A matching pass now works out the tree's surname rules once
 * and remembers the answers about names, surnames and surname pairs.
 *
 * A synthetic tree (invented names, deterministic) of 2 000 people merged
 * with a copy of itself. The time is judged against a calibration run right
 * before it (helpers/perf-budget.ts), so a busy machine does not fail it.
 */

import { describe, it, expect } from 'vitest';
import { syntheticTree } from './helpers/synthetic-tree.js';
import { budgetReport, measureAgainstBudget } from './helpers/perf-budget.js';
import { findMatches } from '../merge/matching.js';

/** The pass took about 0.6 s on the reference machine; before the fix about a minute. */
const BUDGET_MS = 3000;
/** Calibration rounds: about as long as the measured work. */
const CALIBRATION_ROUNDS = 64;
/** The calibration's best time on the reference machine at rest (5.5 ms a round, as in the other perf tests). */
const CALIBRATION_REFERENCE_MS = 352;

describe('merge matching performance', () => {
    it('matches a 2 000-person tree with a copy of itself within the budget', () => {
        const { data } = syntheticTree({ persons: 2000 });
        expect(Object.keys(data.persons)).toHaveLength(2000);
        const existing = structuredClone(data);
        const incoming = structuredClone(data);

        const matches = findMatches(existing, incoming);
        // The same tree: every person with a name pairs with themselves.
        const named = Object.values(data.persons).filter(p => !p.isPlaceholder);
        expect(matches).toHaveLength(named.length);
        expect(matches.every(m => m.existingId === m.incomingId)).toBe(true);

        const m = measureAgainstBudget(() => findMatches(existing, incoming), {
            budgetMs: BUDGET_MS, calibrationRounds: CALIBRATION_ROUNDS, referenceMs: CALIBRATION_REFERENCE_MS,
            minPairs: 2, maxPairs: 5, maxWallMs: 20_000,
        });
        console.log(budgetReport('findMatches 2000 people, same tree', m, BUDGET_MS));
        if (m.judged) expect(m.ms).toBeLessThan(BUDGET_MS);
    }, 600_000);
});
