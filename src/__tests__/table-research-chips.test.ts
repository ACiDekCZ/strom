/**
 * The research's chips and views in the Table view (spec 073 §16.5, §16.9,
 * §16.10): what a tree offers, filtering by a research chip, the chips'
 * words, the research's views after the built-in ones and their empty
 * states. A tree without research keeps its chips and views as before.
 * Invented data only (e2e/fixtures/research-table.ged).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { setLanguage } from '../strings.js';
import type { StromData } from '../types.js';
import {
    applyResearch, isResearchChipId, researchChipActive, researchChipCounts, researchChipOffer, researchOffer, researchTableEnv,
    type ResearchTableInput,
} from '../ui/table-view/table-research.js';
import { setResearchOffer } from '../ui/table-view/table-columns.js';
import { buildTableModel, type TableModel } from '../ui/table-view/table-model.js';
import {
    activeFilterCount, availableChips, chipLabel, filterRows, filterSummary, setChip, type TableFilter,
} from '../ui/table-view/table-filter.js';
import {
    builtinViews, dropMissingViews, findView, isBuiltinId, isResearchViewId, researchViewId, researchViews, setResearchViews,
    switchView, takenViewNames, viewChanged, viewList,
} from '../ui/table-view/table-views.js';
import { defaultTableState } from '../ui/table-view/table-state.js';
import { tableEmptyState, type TableEmptyInput } from '../ui/table-view/table-empty.js';

const GED = readFileSync(join(__dirname, '../../e2e/fixtures/research-table.ged'), 'utf8');
const NOW = Date.parse('2026-11-10T12:00:00Z');
const load = (ged = GED): StromData => convertToStrom(parseGedcom(ged)).data;

const data = load();
const base: ResearchTableInput = { kind: 'research', live: false, now: NOW, lastOpened: Date.parse('2026-11-09T00:00:00Z') };
const envOf = (more: Partial<ResearchTableInput> = {}) => researchTableEnv(data, { ...base, ...more });

function modelWith(more: Partial<ResearchTableInput> | null): TableModel {
    const m = buildTableModel(data, { rev: 1, homeId: null, lang: 'cs', year: 2026 });
    const env = more ? envOf(more) : null;
    applyResearch(m, env);
    setResearchOffer(env ? researchOffer(env) : {});
    return m;
}

const filter = (...chips: string[]): TableFilter => {
    const f: TableFilter = { op: 'and', items: [] };
    for (const c of chips) setChip(f, c as never, true);
    return f;
};
const refns = (m: TableModel, f: TableFilter) =>
    filterRows(m, 'persons', m.persons, f).rows.map(r => (r as { person: { refn?: string } }).person.refn).sort();

const offerOf = (env: ReturnType<typeof envOf>) => {
    setResearchViews({ overview: true, lines: env.lines.lines.map(l => ({ id: l.id, name: l.name })), exchange: env.input.kind === 'research' && !env.input.readOnly });
};

beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    setLanguage('cs');
});
afterAll(() => {
    vi.useRealTimers();
    setLanguage('en');
});
afterEach(() => {
    setResearchOffer({});
    setResearchViews(null);
});

describe('research chips: what a tree offers (§16.5)', () => {
    it('a research tree: signals, a chip per line, Off the lines, then the chips of More', () => {
        const offer = researchChipOffer(envOf());
        expect(offer.filter(o => o.place === 'block').map(o => o.id)).toEqual(['rWait', 'rConf', 'rQ', 'rAgent', 'line:G0001', 'line:G0002', 'offLine']);
        expect(offer.filter(o => o.place === 'more').map(o => o.id)).toEqual([
            'xUnsent', 'xChanged', 'xDecideHere', 'xExternal', 'xNew', 'xReadingRoom', 'xPlaceOpen', 'xAgentDecided', 'xPaused', 'rEdge',
        ]);
        expect(offer.find(o => o.id === 'rAgent')?.live).toBe(true);
        expect(offer.find(o => o.id === 'line:G0001')?.line?.name).toBe('Předci Karla Pivoňkovského');
    });

    it('an archive or a read-only copy: no waiting, agent, not sent or deciding here; none without research', () => {
        for (const env of [envOf({ kind: 'archive' }), envOf({ readOnly: true })]) {
            const ids = researchChipOffer(env).map(o => o.id);
            for (const id of ['rWait', 'rAgent', 'xUnsent', 'xDecideHere']) expect(ids).not.toContain(id);
            expect(ids).toContain('rConf');
        }
        expect(researchChipOffer(envOf({ kind: 'none' }))).toEqual([]);
        const noLines = researchTableEnv(load(GED.replace(/1 _STROM_DIRECTIONS Y\n/, '').replace(/1 _STROM_DIRECTION G000[12]\n(2 .*\n)+/g, '')), base);
        const ids = researchChipOffer(noLines).map(o => o.id);
        expect(ids.some(id => id.startsWith('line:') || id === 'offLine')).toBe(false);
    });

    it('the agent chip filters only while following', () => {
        expect(researchChipActive(envOf(), 'rAgent')).toBe(false);
        expect(researchChipActive(envOf({ live: true }), 'rAgent')).toBe(true);
        expect(researchChipActive(envOf(), 'line:G0009')).toBe(false);
        expect(isResearchChipId('line:G0001')).toBe(true);
        expect(isResearchChipId('living')).toBe(false);
    });

    it('counts per chip for the menus', () => {
        const env = envOf();
        const counts = researchChipCounts(env, Object.values(data.persons));
        expect(counts.get('line:G0001')).toBe(5);
        expect(counts.get('line:G0002')).toBe(3);
        expect(counts.get('offLine')).toBe(5);
        expect(counts.get('rConf')).toBeGreaterThan(0);
    });
});

describe('research chips in the filter', () => {
    it('the quick chips stay as they were, with research or without', () => {
        const plain = availableChips(modelWith(null), 'persons');
        expect(availableChips(modelWith({}), 'persons')).toEqual(plain);
        expect(plain.some(c => isResearchChipId(c))).toBe(false);
    });

    it('filters by a research chip; a line; Off the lines; New from research by its window', () => {
        const m = modelWith({});
        expect(refns(m, filter('offLine'))).toContain('P0006');
        expect(refns(m, filter('offLine'))).not.toContain('P0001');
        expect(refns(m, filter('line:G0001'))).toContain('P0001');
        expect(refns(m, filter('rConf'))).toContain('P0006');
        const week: TableFilter = { op: 'and', items: [{ chip: 'xNew', values: ['week'] }] };
        const day: TableFilter = { op: 'and', items: [{ chip: 'xNew', values: ['day'] }] };
        expect(refns(m, week)).toEqual(expect.arrayContaining(['P0001', 'P0011']));
        expect(refns(m, day)).toContain('P0001');
        expect(refns(m, day)).not.toContain('P0011');
        expect(activeFilterCount(m, 'persons', filter('rConf', 'living'))).toBe(2);
    });

    it('the agent chip while not following and a chip of another tree filter nothing and are not counted', () => {
        const m = modelWith({});
        const all = m.persons.length;
        expect(filterRows(m, 'persons', m.persons, filter('rAgent')).rows.length).toBe(all);
        expect(activeFilterCount(m, 'persons', filter('rAgent'))).toBe(0);
        const plain = modelWith(null);
        expect(filterRows(plain, 'persons', plain.persons, filter('rConf', 'line:G0001')).rows.length).toBe(plain.persons.length);
        expect(activeFilterCount(plain, 'persons', filter('rConf', 'line:G0001'))).toBe(0);
        expect(filterSummary(plain, 'persons', filter('rConf'), '')).toEqual(filterSummary(plain, 'persons', filter(), ''));
    });

    it('the chips\' words: a line by its id and name, New from research with its window', () => {
        const m = modelWith({});
        expect(chipLabel(m, null, 'line:G0001')).toBe('G0001 Předci Karla Pivoňkovského');
        expect(chipLabel(m, null, 'rConf')).toBe('S rozporem');
        expect(chipLabel(m, { chip: 'xNew', values: ['day'] }, 'xNew')).toBe('Nové od výzkumu: za 24 h');
    });
});

describe('the research\'s views (§16.5, §16.9, §16.10)', () => {
    it('none without research: the list and the names are as before', () => {
        setResearchViews(null);
        expect(researchViews()).toEqual([]);
        const list = viewList(defaultTableState(), [], false);
        expect(list.research).toEqual([]);
        expect(takenViewNames([])).toEqual(builtinViews().map(v => v.name));
        expect(findView(researchViewId('research'), [])).toBeNull();
    });

    it('a research tree: Research, a view per line, Off the lines and Exchange, after the built-in ones', () => {
        offerOf(envOf());
        expect(researchViews().map(v => v.name)).toEqual([
            'Výzkum', 'Linie: G0001 Předci Karla Pivoňkovského', 'Linie: G0002 Klikvové z Rebarborova', 'Mimo linie', 'Výměna s výzkumem',
        ]);
        const list = viewList(defaultTableState(), [], false);
        expect(list.research.map(e => e.id)).toEqual(['r:research', 'r:line:G0001', 'r:line:G0002', 'r:offLine', 'r:exchange']);
        expect(isBuiltinId('r:research')).toBe(true);
        expect(isResearchViewId('r:offLine')).toBe(true);
        // An archive: no Exchange.
        offerOf(envOf({ kind: 'archive' }));
        expect(researchViews().map(v => v.id)).not.toContain('r:exchange');
    });

    it('the views\' columns, filters and sorts; unions collapsed', () => {
        offerOf(envOf());
        const r = findView('r:research', [])!;
        expect(r.columns.map(c => c.id)).toEqual(['name', 'rSum', 'rWait', 'rConf', 'rHyp', 'rAgent', 'rTasks', 'bDate', 'dDate']);
        expect(r.filter.items).toEqual([{ col: 'rSum', kind: expect.any(String), filled: true }]);
        expect(r.sort).toEqual([{ col: 'rSum', dir: -1 }, { col: 'name', dir: 1 }]);
        expect(r.unions).toEqual({ collapsed: true, except: [] });
        const line = findView('r:line:G0001', [])!;
        expect(line.columns.map(c => c.id)).toEqual(['name', 'rLine', 'gen', 'rSum', 'bDate', 'dDate', 'rConf', 'rAgent']);
        expect(line.filter.items).toEqual([{ chip: 'line:G0001' }]);
        expect(line.sort).toEqual([{ col: 'rLine', dir: 1 }]);
        expect(findView('r:offLine', [])!.filter.items).toEqual([{ chip: 'offLine' }]);
        const x = findView('r:exchange', [])!;
        expect(x.columns.map(c => c.id)).toEqual(['name', 'rSync', 'rOrig', 'rNew', 'rConf', 'bDate']);
        expect(x.sort).toEqual([]);
    });

    it('opened, a research view is not changed; a line gone from the research takes its view away', () => {
        offerOf(envOf());
        const state = defaultTableState();
        expect(switchView(state, 'r:line:G0002', [])).toBe(true);
        expect(viewChanged(findView('r:line:G0002', [])!, state.types.persons)).toBe(false);
        setResearchViews({ overview: true, lines: [{ id: 'G0001', name: 'Předci Karla Pivoňkovského' }], exchange: true });
        expect(dropMissingViews(state, [])).toBe(true);
        expect(state.open.persons).toBe('b:overview');
        expect(viewChanged(findView('b:overview', [])!, state.types.persons)).toBe(false);
    });
});

describe('the research views\' empty states (16q)', () => {
    const input: TableEmptyInput = {
        persons: 12, unions: 4, type: 'persons', viewId: 'r:research', viewChanged: false, search: '', shown: 0,
        checksDone: true, leads: 0, allComplete: () => false, readOnly: false,
    };

    it('Research with nothing: the sentence, and following offered only when it can start', () => {
        const s = tableEmptyState({ ...input, canFollow: true });
        expect(s).toMatchObject({ kind: 'researchEmpty', title: 'Výzkum teď nic nepotřebuje', action: { id: 'follow', label: 'Sledovat výzkum ›' } });
        expect(tableEmptyState(input)?.action).toBeNull();
        expect(tableEmptyState({ ...input, viewChanged: true })).toBeNull();
        expect(tableEmptyState({ ...input, search: 'Kli' })).toBeNull();
        expect(tableEmptyState({ ...input, shown: 3 })).toBeNull();
    });

    it('Exchange with nothing: in sync', () => {
        expect(tableEmptyState({ ...input, viewId: 'r:exchange' })).toMatchObject({ kind: 'exchangeEmpty', title: 'Strom a výzkum jsou srovnané' });
    });
});
