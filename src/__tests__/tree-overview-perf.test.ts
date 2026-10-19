/**
 * The tree overview opens within 1 s on a 5 000-person tree (spec 005 K1.5):
 * what it computes at open — the header, the ancestors (generations, the four
 * lines, line ends), the rememberers and the focus cards with the validation
 * error count — stays inside the 1 s budget on a synthetic tree. The best of
 * five measured runs is taken, so a GC pause does not decide the result.
 *
 * The 1 s holds on an idle machine. The full suite's workers, an e2e run or
 * another checkout's tests on the same computer made every computation here
 * several times slower and the fixed budget failed with no change in the
 * code. So each run is scaled by the machine's speed at that moment, measured
 * with a fixed calibration workload run right before it
 * (helpers/perf-budget.ts): on an idle machine a run counts as it is, on a
 * loaded one divided by its slowdown (at most 5×). A slowdown of the overview
 * code itself does not slow the calibration, so it still fails.
 */

import { describe, it, expect } from 'vitest';
import { syntheticTree } from './helpers/synthetic-tree.js';
import { calibrationWorkload, machineFactor, normalizedMs } from './helpers/perf-budget.js';
import {
    overviewHeader, ancestorGenerations, grandparentLines, lineEndIds, rememberers, remembererGaps, selectFocusCards,
    relativeGenerations, deathAgeSummary,
} from '../tree-overview.js';
import { validateTreeData } from '../validation.js';

/** Budget for everything the dialog computes at open (K1.5: the overview opens within 1 s). */
const BUDGET_MS = 1000;
const MEASURED_RUNS = 5;
/** Calibration rounds: about as long as the measured work (~100 ms idle). */
const CALIBRATION_ROUNDS = 16;
/** Best calibration time on the reference machine at rest (Apple M-series laptop, a performance core, vitest). */
const CALIBRATION_REFERENCE_MS = 88;

describe('tree overview performance', () => {
    // The whole test takes about 1.5 s idle (the tree, five calibrated runs)
    // and up to ten times that on a loaded machine: 60 s, so only the budget
    // decides, not vitest's 5 s.
    it('computes the opening sections of a 5 000-person tree within the budget', () => {
        const { data, rootId, generations } = syntheticTree({ persons: 5000 });
        expect(Object.keys(data.persons)).toHaveLength(5000);
        expect(generations).toBeGreaterThanOrEqual(10);

        const timings: Record<string, number> = {};
        const time = <T>(label: string, fn: () => T): T => {
            const start = performance.now();
            const out = fn();
            timings[label] = (timings[label] ?? 0) + performance.now() - start;
            return out;
        };
        const open = () => {
            time('overviewHeader', () => overviewHeader(data));
            const ancestors = time('ancestorGenerations', () => ancestorGenerations(data, rootId));
            time('grandparentLines', () => grandparentLines(data, rootId));
            time('lineEndIds', () => lineEndIds(data, rootId));
            const errors = time('validateTreeData', () => validateTreeData(data).stats.errors);
            const list = time('rememberers', () => rememberers(data, rootId, 2026));
            return time('selectFocusCards', () => selectFocusCards({
                validationErrors: errors,
                generations: ancestors.generations,
                ancestorBirthsNoSource: ancestors.birthNoSource,
                rememberers: remembererGaps(list),
            }));
        };

        // Warm-up (JIT) of both, then the measured runs, each right after a
        // calibration run; the run with the lowest normalized time counts.
        open();
        calibrationWorkload(CALIBRATION_ROUNDS);
        let total = Infinity;
        let measured = 0;
        let calibration = 0;
        let best: Record<string, number> = {};
        let cards: ReturnType<typeof open> = [];
        for (let run = 0; run < MEASURED_RUNS; run++) {
            const calStart = performance.now();
            calibrationWorkload(CALIBRATION_ROUNDS);
            const calMs = performance.now() - calStart;
            for (const k of Object.keys(timings)) delete timings[k];
            const start = performance.now();
            cards = open();
            const ms = performance.now() - start;
            const normalized = normalizedMs(ms, calMs, CALIBRATION_REFERENCE_MS);
            if (normalized < total) { total = normalized; measured = ms; calibration = calMs; best = { ...timings }; }
        }

        // Sections opened later, measured for the report.
        const later = performance.now();
        const gens = relativeGenerations(data, rootId);
        deathAgeSummary(data);
        const laterMs = performance.now() - later;

        const ancestors = ancestorGenerations(data, rootId);
        console.log(`[tree-overview perf] 5000 persons: ${total.toFixed(1)} ms at open (normalized, best of ${MEASURED_RUNS}: ${
            measured.toFixed(1)} ms measured, calibration ${calibration.toFixed(1)} ms, machine ×${
            machineFactor(calibration, CALIBRATION_REFERENCE_MS).toFixed(2)}) (${
            Object.entries(best).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')
        }); relativeGenerations + deathAgeSummary ${laterMs.toFixed(1)} ms; ${ancestors.generations.length} ancestor generations, ${
            ancestors.pedigreeCollapse.length} collapsed, ${gens.size} connected, ${cards.length} cards`);

        expect(ancestors.generations.length).toBeGreaterThanOrEqual(8);
        expect(ancestors.pedigreeCollapse.length).toBeGreaterThan(0);
        expect(total).toBeLessThan(BUDGET_MS);
    }, 60_000);
});
