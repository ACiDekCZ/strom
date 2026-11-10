/**
 * The Table view on a 5 000-person tree (spec 073 K1.8): it opens within 1 s
 * — the row model, the default sort (birth date) and the cells of the first
 * window of rows — and a sort by three columns on a fresh model (no cell
 * cached yet) takes under 300 ms; the tree's findings (§7.1: Data quality's
 * check and their mapping to the cells) are computed under 1 s; a filter
 * (chips, a column range, a union column, the search) with a sort by three
 * columns on a fresh model under 300 ms (K1.8). Timed against a calibration run right
 * before each run (helpers/perf-budget.ts), so a loaded machine does not
 * decide the result and a slower code still fails.
 */

import { describe, it, expect } from 'vitest';
import { syntheticTree } from './helpers/synthetic-tree.js';
import { budgetReport, measureAgainstBudget } from './helpers/perf-budget.js';
import { buildTableModel } from '../ui/table-view/table-model.js';
import { cellOf, columnById, DEFAULT_VIEWS } from '../ui/table-view/table-columns.js';
import { filterRows, searchQuery, sortRows } from '../ui/table-view/table-filter.js';
import { sortUnionOf } from '../ui/table-view/table-subrows.js';
import { rowWindow } from '../ui/table-view/table-window.js';
import { defaultTableState, shownColumns } from '../ui/table-view/table-state.js';
import type { PersonId } from '../types.js';
import { validateTreeData } from '../validation.js';
import { buildCheckIndex } from '../ui/table-view/table-checks.js';

const OPEN_BUDGET_MS = 1000;
const SORT_BUDGET_MS = 300;
const CHECKS_BUDGET_MS = 1000;
/** Calibration rounds: about as long as the measured work (5.5 ms a round, as in the other perf tests). */
const CALIBRATION_ROUNDS = 4;
const CALIBRATION_REFERENCE_MS = 22;

describe('table view performance', () => {
    const { data, rootId } = syntheticTree({ persons: 5000 });
    let rev = 0;
    const fresh = () => buildTableModel(data, { rev: ++rev, homeId: rootId as PersonId, lang: 'en', year: 2026 });

    it('opens a 5 000-person tree within the budget (model, default sort, first window of cells)', () => {
        const st = defaultTableState().types.persons;
        const { columns } = shownColumns('persons', st, false);
        const open = () => {
            const m = fresh();
            const rows = sortRows(m, 'persons', m.persons, DEFAULT_VIEWS.persons.sort);
            const w = rowWindow(0, 800, 32, rows.length);
            let n = 0;
            for (let r = w.start; r < w.end; r++) for (const col of columns) n += cellOf(m, rows[r], col).text.length;
            return n;
        };
        const m0 = fresh();
        expect(m0.persons.length).toBe(Object.values(data.persons).filter(p => !p.isPlaceholder).length);
        expect(open()).toBeGreaterThan(0);
        const m = measureAgainstBudget(open, {
            budgetMs: OPEN_BUDGET_MS, calibrationRounds: CALIBRATION_ROUNDS, referenceMs: CALIBRATION_REFERENCE_MS,
            minPairs: 2, maxPairs: 5, maxWallMs: 20_000,
        });
        console.log(budgetReport('table open, 5000 people', m, OPEN_BUDGET_MS));
        if (m.judged) expect(m.ms).toBeLessThan(OPEN_BUDGET_MS);
    }, 120_000);

    it('sorts 5 000 people by three columns, cells not cached yet, within the budget', () => {
        const specs = [{ col: 'surname', dir: 'asc' }, { col: 'dDate', dir: 'desc' }, { col: 'bPlace', dir: 'asc' }] as const;
        let model = fresh();
        const sort = () => sortRows(model, 'persons', model.persons, specs);
        const sorted = sort();
        expect(sorted).toHaveLength(model.persons.length);
        const m = measureAgainstBudget(() => { model = fresh(); return sort(); }, {
            budgetMs: SORT_BUDGET_MS, calibrationRounds: CALIBRATION_ROUNDS, referenceMs: CALIBRATION_REFERENCE_MS,
            minPairs: 2, maxPairs: 5, maxWallMs: 20_000,
        });
        console.log(budgetReport('table sort by 3 columns, 5000 people', m, SORT_BUDGET_MS));
        if (m.judged) expect(m.ms).toBeLessThan(SORT_BUDGET_MS);
    }, 120_000);

    it('filters (chips, columns, a union column, search) and sorts 5 000 people by three columns within the budget', () => {
        const filter = {
            op: 'and' as const,
            items: [
                { chip: 'deceased' as const },
                { col: 'bDate', kind: 'date' as const, from: 1700, to: 2000 },
                { col: 'wDate', kind: 'date' as const, filled: true as const },
            ],
        };
        const columns = ['name', 'bPlace', 'partner', 'wPlace'].map(id => columnById('persons', id)!);
        const specs = [{ col: 'bPlace', dir: 'asc' }, { col: 'bDate', dir: 'desc' }, { col: 'wDate', dir: 'asc' }] as const;
        let model = fresh();
        const work = () => {
            const res = filterRows(model, 'persons', model.persons, filter, { query: searchQuery('an'), columns });
            return sortRows(model, 'persons', res.rows, specs, sortUnionOf(res.pass)).length;
        };
        expect(work()).toBeGreaterThan(0);
        const m = measureAgainstBudget(() => { model = fresh(); return work(); }, {
            budgetMs: SORT_BUDGET_MS, calibrationRounds: CALIBRATION_ROUNDS, referenceMs: CALIBRATION_REFERENCE_MS,
            minPairs: 2, maxPairs: 5, maxWallMs: 20_000,
        });
        console.log(budgetReport('table filter + sort by 3 columns, 5000 people', m, SORT_BUDGET_MS));
        if (m.judged) expect(m.ms).toBeLessThan(SORT_BUDGET_MS);
    }, 120_000);

    it('computes the findings of 5 000 people and maps them to the cells within the budget', () => {
        const run = () => buildCheckIndex(data, validateTreeData(data).issues).issues.length;
        expect(run()).toBeGreaterThanOrEqual(0);
        const m = measureAgainstBudget(run, {
            budgetMs: CHECKS_BUDGET_MS, calibrationRounds: CALIBRATION_ROUNDS, referenceMs: CALIBRATION_REFERENCE_MS,
            minPairs: 2, maxPairs: 5, maxWallMs: 20_000,
        });
        console.log(budgetReport('table checks, 5000 people', m, CHECKS_BUDGET_MS));
        if (m.judged) expect(m.ms).toBeLessThan(CHECKS_BUDGET_MS);
    }, 120_000);
});
