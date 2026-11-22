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
 *
 * The comparison in parts (findMatchesAsync, spec 134 K3.5): on a 10 000-person
 * tree it reports progress and stops when asked, leaving its inputs as they
 * were; on smaller trees it gives exactly what findMatches gives.
 */

import { describe, it, expect } from 'vitest';
import { syntheticTree } from './helpers/synthetic-tree.js';
import { budgetReport, measureAgainstBudget } from './helpers/perf-budget.js';
import { createMergeState, findMatches, findMatchesAsync } from '../merge/matching.js';
import { mulberry32, sourceTree, targetTree } from './helpers/merge-trees.js';

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

describe('merge matching in parts (findMatchesAsync)', () => {
    it('reports progress on a 10 000-person tree and stops on the signal, changing nothing', async () => {
        const { data } = syntheticTree({ persons: 10_000 });
        expect(Object.keys(data.persons)).toHaveLength(10_000);
        const existing = structuredClone(data);
        const incoming = structuredClone(data);
        // A comparison already made (of a part of the trees) stays as it was.
        const state = createMergeState(existing, { persons: {}, partnerships: {} });
        const stateBefore = JSON.stringify({ ...state, decisions: [...state.decisions] });
        const existingBefore = JSON.stringify(existing);
        const incomingBefore = JSON.stringify(incoming);
        const named = Object.values(incoming.persons).filter(p => !p.isPlaceholder).length;

        const controller = new AbortController();
        const progress: Array<[number, number]> = [];
        const run = findMatchesAsync(existing, incoming, {
            signal: controller.signal,
            chunk: 50,
            onProgress: (done, total) => {
                progress.push([done, total]);
                if (progress.length === 3) controller.abort();
            },
        });
        await expect(run).rejects.toMatchObject({ name: 'AbortError' });
        expect(progress).toHaveLength(3);
        for (const [done, total] of progress) {
            expect(total).toBe(2 * named);
            expect(done).toBeGreaterThan(0);
            expect(done).toBeLessThan(total);
        }
        expect(progress[1][0]).toBeGreaterThanOrEqual(progress[0][0]);
        expect(progress[2][0]).toBeGreaterThanOrEqual(progress[1][0]);
        expect(JSON.stringify(existing)).toBe(existingBefore);
        expect(JSON.stringify(incoming)).toBe(incomingBefore);
        expect(JSON.stringify({ ...state, decisions: [...state.decisions] })).toBe(stateBefore);
    }, 120_000);

    it('a signal already given stops it before any work', async () => {
        const existing = targetTree(mulberry32(5));
        const controller = new AbortController();
        controller.abort();
        const onProgress = (): void => { throw new Error('no progress expected'); };
        await expect(findMatchesAsync(existing, structuredClone(existing), { signal: controller.signal, onProgress }))
            .rejects.toMatchObject({ name: 'AbortError' });
    });

    it('gives what findMatches gives, in many small parts', async () => {
        const { data } = syntheticTree({ persons: 1500 });
        const copy = structuredClone(data);
        const progress: number[] = [];
        const parts = await findMatchesAsync(data, copy, { chunk: 7, onProgress: done => progress.push(done) });
        expect(parts).toEqual(findMatches(data, copy));
        expect(progress.length).toBeGreaterThan(2);
        expect(progress[progress.length - 1]).toBe(2 * Object.values(copy.persons).filter(p => !p.isPlaceholder).length);
        for (let seed = 1; seed <= 30; seed++) {
            const rnd = mulberry32(seed);
            const existing = targetTree(rnd);
            const incoming = sourceTree(existing, rnd);
            expect(await findMatchesAsync(existing, incoming, { chunk: 3 })).toEqual(findMatches(existing, incoming));
        }
    }, 120_000);
});
