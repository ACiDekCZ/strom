/**
 * The tree overview opens within 1 s on a 5 000-person tree (spec 005 K1.5):
 * what it computes at open — the header, the ancestors (generations, the four
 * lines, line ends), the rememberers and the focus cards with the validation
 * error count — stays well inside a generous Node budget on a synthetic tree.
 */

import { describe, it, expect } from 'vitest';
import { syntheticTree } from './helpers/synthetic-tree.js';
import {
    overviewHeader, ancestorGenerations, grandparentLines, lineEndIds, rememberers, remembererGaps, selectFocusCards,
    relativeGenerations, deathAgeSummary,
} from '../tree-overview.js';
import { validateTreeData } from '../validation.js';

/** Node budget for everything the dialog computes at open (the dialog's own budget is 1 s with the DOM). */
const BUDGET_MS = 400;

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

        open(); // warm-up (JIT), then the measured run
        for (const k of Object.keys(timings)) delete timings[k];
        const start = performance.now();
        const cards = open();
        const total = performance.now() - start;

        // Sections opened later, measured for the report.
        const later = performance.now();
        const gens = relativeGenerations(data, rootId);
        deathAgeSummary(data);
        const laterMs = performance.now() - later;

        const ancestors = ancestorGenerations(data, rootId);
        console.log(`[tree-overview perf] 5000 persons: ${total.toFixed(1)} ms at open (${
            Object.entries(timings).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')
        }); relativeGenerations + deathAgeSummary ${laterMs.toFixed(1)} ms; ${ancestors.generations.length} ancestor generations, ${
            ancestors.pedigreeCollapse.length} collapsed, ${gens.size} connected, ${cards.length} cards`);

        expect(ancestors.generations.length).toBeGreaterThanOrEqual(8);
        expect(ancestors.pedigreeCollapse.length).toBeGreaterThan(0);
        expect(total).toBeLessThan(BUDGET_MS);
    });
});
