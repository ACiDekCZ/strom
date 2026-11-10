/**
 * The Sources table on a 5 000-person tree with 2 000 sources (spec 073
 * §14.2, as K1.8 for people): the rows with their people and facts (counted
 * in one pass over the tree), a quick chip and a sort by two columns on a
 * fresh model, within the budget. Timed against a calibration run right
 * before each run (helpers/perf-budget.ts).
 */

import { describe, it, expect } from 'vitest';
import { syntheticTree } from './helpers/synthetic-tree.js';
import { budgetReport, measureAgainstBudget } from './helpers/perf-budget.js';
import { buildTableModel } from '../ui/table-view/table-model.js';
import { cellOf, DEFAULT_VIEWS } from '../ui/table-view/table-columns.js';
import { filterRows, sortRows } from '../ui/table-view/table-filter.js';
import { rowWindow } from '../ui/table-view/table-window.js';
import { defaultTableState, shownColumns } from '../ui/table-view/table-state.js';
import type { PersonId, Source } from '../types.js';

const BUDGET_MS = 300;
const CALIBRATION_ROUNDS = 4;
const CALIBRATION_REFERENCE_MS = 22;
const SOURCES = 2000;

describe('sources table performance', () => {
    const { data, rootId } = syntheticTree({ persons: 5000 });
    const sources: Record<string, Source> = {};
    for (let i = 0; i < SOURCES; i++) {
        const id = `ps${i}`;
        sources[id] = {
            id, title: `Fiktivní kniha ${i % 97} svazek ${i}`, repository: `Archiv ${i % 7}`, reference: `fol. ${i}`,
            ...(i % 3 === 0 ? { url: `https://example.org/kniha/${i}` } : {}),
            ...(i % 4 === 0 ? { readBy: i % 8 === 0 ? 'both' as const : 'research' as const } : {}),
            ...(i % 5 === 0 ? { transcript: 'Text zápisu' } : {}),
            ...(i % 2 === 0 ? { recordDate: `${1700 + (i % 200)}-0${1 + (i % 9)}-1${i % 10}` } : {}),
        };
    }
    data.sources = { ...data.sources, ...sources };
    // Every person cites a few: the birth, the person, an event; every union its wedding.
    let n = 0;
    for (const p of Object.values(data.persons)) {
        if (p.isPlaceholder) continue;
        const k = n++;
        p.birthSourceIds = [`ps${k % SOURCES}`];
        p.sourceIds = [`ps${(k * 7) % SOURCES}`, `ps${(k * 13) % SOURCES}`];
        const ev = p.events?.[0];
        if (ev) ev.sourceIds = [`ps${(k * 3) % SOURCES}`];
    }
    for (const u of Object.values(data.partnerships)) u.sourceIds = [`ps${(n++ * 11) % SOURCES}`];
    let rev = 0;
    const fresh = () => buildTableModel(data, { rev: ++rev, homeId: rootId as PersonId, lang: 'en', year: 2026 });

    it('opens the sources, filters by a chip and sorts by two columns within the budget', () => {
        const { columns } = shownColumns('sources', defaultTableState().types.sources, false);
        const run = () => {
            const m = fresh();
            const sorted = sortRows(m, 'sources', m.sources, DEFAULT_VIEWS.sources.sort);
            const f = filterRows(m, 'sources', sorted, { op: 'and', items: [{ chip: 'srcUnread' }] });
            const rows = sortRows(m, 'sources', f.rows, [{ col: 'srcFacts', dir: 'desc' }, { col: 'srcRecDate', dir: 'asc' }]);
            const w = rowWindow(0, 800, 32, rows.length);
            let len = 0;
            for (let r = w.start; r < w.end; r++) for (const col of columns) len += cellOf(m, rows[r], col).text.length;
            return rows.length + len;
        };
        const m0 = fresh();
        expect(m0.sources.length).toBeGreaterThanOrEqual(SOURCES);
        expect(m0.sources.filter(r => r.persons > 0).length).toBeGreaterThan(SOURCES / 2);
        expect(run()).toBeGreaterThan(0);
        const m = measureAgainstBudget(run, {
            budgetMs: BUDGET_MS, calibrationRounds: CALIBRATION_ROUNDS, referenceMs: CALIBRATION_REFERENCE_MS,
            minPairs: 2, maxPairs: 5, maxWallMs: 20_000,
        });
        console.log(budgetReport('sources open + chip + sort by 2 columns, 5000 people, 2000 sources', m, BUDGET_MS));
        if (m.judged) expect(m.ms).toBeLessThan(BUDGET_MS);
    }, 120_000);
});
