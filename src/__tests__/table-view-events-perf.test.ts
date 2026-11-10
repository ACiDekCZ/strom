/**
 * The Events table on a 5 000-person tree (spec 073 §14.1, as K1.8 for
 * people): it opens within 1 s — the row model with its events, the default
 * sort (date) and the cells of the first window of rows — and a filter (a
 * family of events, the participant filter, a date range, the search) with
 * a sort by three columns on a fresh model under 300 ms. Timed against a
 * calibration run right before each run (helpers/perf-budget.ts).
 */

import { describe, it, expect } from 'vitest';
import { syntheticTree } from './helpers/synthetic-tree.js';
import { budgetReport, measureAgainstBudget } from './helpers/perf-budget.js';
import { buildTableModel } from '../ui/table-view/table-model.js';
import { cellOf, columnsOf, DEFAULT_VIEWS } from '../ui/table-view/table-columns.js';
import { filterRows, searchQuery, sortRows } from '../ui/table-view/table-filter.js';
import { rowWindow } from '../ui/table-view/table-window.js';
import { defaultTableState, shownColumns } from '../ui/table-view/table-state.js';
import type { PersonId } from '../types.js';

const OPEN_BUDGET_MS = 1000;
const SORT_BUDGET_MS = 300;
const CALIBRATION_ROUNDS = 4;
const CALIBRATION_REFERENCE_MS = 22;

describe('events table performance', () => {
    const { data, rootId } = syntheticTree({ persons: 5000 });
    // Godparents at the baptisms: every third one a person of the tree, the others written names.
    const people = Object.values(data.persons).filter(p => !p.isPlaceholder);
    let n = 0;
    for (const p of people) {
        for (const e of p.events ?? []) {
            if (e.type !== 'baptism') continue;
            const k = n++;
            e.participants = [k % 3 === 0
                ? { id: `g${k}`, role: 'godparent', personId: people[(k * 7) % people.length].id }
                : { id: `g${k}`, role: 'godparent', name: `Kmotr Fiktivní ${k % 40}` }];
        }
    }
    let rev = 0;
    const fresh = () => buildTableModel(data, { rev: ++rev, homeId: rootId as PersonId, lang: 'en', year: 2026 });

    it('opens the events of a 5 000-person tree within the budget (model, default sort, first window of cells)', () => {
        const st = defaultTableState().types.events;
        const { columns } = shownColumns('events', st, false);
        const open = () => {
            const m = fresh();
            const rows = sortRows(m, 'events', m.events, DEFAULT_VIEWS.events.sort);
            const w = rowWindow(0, 800, 32, rows.length);
            let len = 0;
            for (let r = w.start; r < w.end; r++) for (const col of columns) len += cellOf(m, rows[r], col).text.length;
            return len;
        };
        expect(fresh().events.length).toBeGreaterThan(5000);
        expect(open()).toBeGreaterThan(0);
        const m = measureAgainstBudget(open, {
            budgetMs: OPEN_BUDGET_MS, calibrationRounds: CALIBRATION_ROUNDS, referenceMs: CALIBRATION_REFERENCE_MS,
            minPairs: 2, maxPairs: 5, maxWallMs: 20_000,
        });
        console.log(budgetReport('events open, 5000 people', m, OPEN_BUDGET_MS));
        if (m.judged) expect(m.ms).toBeLessThan(OPEN_BUDGET_MS);
    }, 120_000);

    it('filters (a family, a participant, a date range, the search) and sorts by three columns within the budget', () => {
        const filter = {
            op: 'and' as const,
            items: [
                { chip: 'evBirth' as const },
                { chip: 'participant' as const, role: 'godparent' as const, name: 'kmotr fiktivni 7' },
                { col: 'evDate', kind: 'date' as const, from: 1600, to: 2100 },
            ],
        };
        const specs = [{ col: 'evPlace', dir: 'asc' }, { col: 'evDate', dir: 'desc' }, { col: 'evWho', dir: 'asc' }] as const;
        let model = fresh();
        const run = () => {
            const f = filterRows(model, 'events', model.events, filter, { query: searchQuery('fikt'), columns: columnsOf('events') });
            return sortRows(model, 'events', f.rows, specs);
        };
        expect(run().length).toBeGreaterThan(0);
        const m = measureAgainstBudget(() => { model = fresh(); return run(); }, {
            budgetMs: SORT_BUDGET_MS, calibrationRounds: CALIBRATION_ROUNDS, referenceMs: CALIBRATION_REFERENCE_MS,
            minPairs: 2, maxPairs: 5, maxWallMs: 20_000,
        });
        console.log(budgetReport('events filter + sort by 3 columns, 5000 people', m, SORT_BUDGET_MS));
        if (m.judged) expect(m.ms).toBeLessThan(SORT_BUDGET_MS);
    }, 120_000);
});
