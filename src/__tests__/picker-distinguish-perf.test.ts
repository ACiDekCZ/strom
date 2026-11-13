/**
 * Same names in the person search stay cheap on a large tree (1113, §1):
 * what the list adds per keystroke — grouping the whole result by its rows'
 * text and working out the lines of the 50 drawn rows — stays under one
 * frame (16 ms) for typing five letters into the toolbar search of a
 * 3 000-person tree. The synthetic tree has ten given names per gender and
 * eight surnames, so nearly every row repeats.
 *
 * The time is judged against a calibration run right before it
 * (helpers/perf-budget.ts), so a busy machine does not fail it. The budget is
 * for all five keystrokes together, stricter than 16 ms each, measured as
 * the first search on the tree (no folded name kept from before).
 */

import { describe, it, expect } from 'vitest';
import { syntheticTree } from './helpers/synthetic-tree.js';
import { budgetReport, measureAgainstBudget } from './helpers/perf-budget.js';
import { filterAndSort, hiddenSurnameMatchHtml } from '../person-picker.js';
import { detailMatch } from '../search-filter.js';
import { PickerDistinguisher, clearFoldedNames } from '../picker-distinguish.js';
import { Person } from '../types.js';

const BUDGET_MS = 16;
/** Rows drawn at once (the picker's batch). */
const DRAWN = 50;
const CALIBRATION_ROUNDS = 2;
/** The calibration's best time on the reference machine at rest (5.5 ms a round, as in the other perf tests). */
const CALIBRATION_REFERENCE_MS = 11;

describe('person search same-name lines performance', () => {
    it('adds less than a frame for five keystrokes on a 3 000-person tree', () => {
        const { data } = syntheticTree({ persons: 3000 });
        const persons = Object.values(data.persons).filter(p => !p.isPlaceholder);
        expect(persons.length).toBeGreaterThan(2500);
        const query = 'alena';
        // The search itself is not measured: only what the lines add to it.
        const results: { q: string; rows: Person[] }[] = [];
        for (let n = 1; n <= query.length; n++) {
            const q = query.slice(0, n);
            results.push({ q, rows: filterAndSort(q, persons, data, true) });
        }
        expect(results[0].rows.length).toBeGreaterThan(500);

        let lines = 0;
        const typeFive = (): void => {
            // As the first search on the tree: no name folded yet.
            clearFoldedNames();
            for (const { q, rows } of results) {
                const d = new PickerDistinguisher(rows, data, true, p =>
                    hiddenSurnameMatchHtml(p, q, data) + (detailMatch(p, q, data)?.value ?? ''));
                for (const p of rows.slice(0, DRAWN)) if (d.line(p) !== null) lines++;
            }
        };
        typeFive();
        // Same names do occur, so the lines are really worked out.
        expect(lines).toBeGreaterThan(0);

        const m = measureAgainstBudget(typeFive, {
            budgetMs: BUDGET_MS, calibrationRounds: CALIBRATION_ROUNDS, referenceMs: CALIBRATION_REFERENCE_MS,
            minPairs: 3, maxPairs: 15, maxWallMs: 20_000,
        });
        console.log(budgetReport('same-name lines, 5 keystrokes, 3000 people', m, BUDGET_MS));
        if (m.judged) expect(m.ms).toBeLessThan(BUDGET_MS);
    }, 120_000);
});
