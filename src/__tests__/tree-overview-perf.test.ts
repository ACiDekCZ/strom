/**
 * The tree overview opens within 1 s on a 5 000-person tree (spec 005 K1.5):
 * what it computes at open — the header, the ancestors (generations, the four
 * lines, line ends), the rememberers and the focus cards with the validation
 * error count — stays inside the 1 s budget on a synthetic tree. The best of
 * three measured runs is taken, so a GC pause or a busy CI runner does not
 * decide the result.
 */

import { describe, it, expect } from 'vitest';
import { syntheticTree } from './helpers/synthetic-tree.js';
import {
    overviewHeader, ancestorGenerations, grandparentLines, lineEndIds, rememberers, remembererGaps, selectFocusCards,
    relativeGenerations, deathAgeSummary,
} from '../tree-overview.js';
import { validateTreeData } from '../validation.js';

/** Budget for everything the dialog computes at open (K1.5: the overview opens within 1 s). */
const BUDGET_MS = 1000;
const MEASURED_RUNS = 3;

describe('tree overview performance', () => {
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

        open(); // warm-up (JIT), then the measured runs; the fastest one counts
        let total = Infinity;
        let best: Record<string, number> = {};
        let cards: ReturnType<typeof open> = [];
        for (let run = 0; run < MEASURED_RUNS; run++) {
            for (const k of Object.keys(timings)) delete timings[k];
            const start = performance.now();
            cards = open();
            const ms = performance.now() - start;
            if (ms < total) { total = ms; best = { ...timings }; }
        }

        // Sections opened later, measured for the report.
        const later = performance.now();
        const gens = relativeGenerations(data, rootId);
        deathAgeSummary(data);
        const laterMs = performance.now() - later;

        const ancestors = ancestorGenerations(data, rootId);
        console.log(`[tree-overview perf] 5000 persons: ${total.toFixed(1)} ms at open, best of ${MEASURED_RUNS} (${
            Object.entries(best).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')
        }); relativeGenerations + deathAgeSummary ${laterMs.toFixed(1)} ms; ${ancestors.generations.length} ancestor generations, ${
            ancestors.pedigreeCollapse.length} collapsed, ${gens.size} connected, ${cards.length} cards`);

        expect(ancestors.generations.length).toBeGreaterThanOrEqual(8);
        expect(ancestors.pedigreeCollapse.length).toBeGreaterThan(0);
        expect(total).toBeLessThan(BUDGET_MS);
    });
});
