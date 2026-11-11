/**
 * Table view (spec 073 §8, §3.3): quick chips, column filters, search with
 * its highlight, and sorting — the parts without the DOM.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { PersonId, StromData } from '../types.js';
import { setLanguage } from '../strings.js';
import { buildTableModel, type TableModel, type TableRow, type PersonRow } from '../ui/table-view/table-model.js';
import { columnById } from '../ui/table-view/table-columns.js';
import {
    activeFilterCount, availableChips, cellPasses, chipLabel, columnItemLabel, columnValues, emptyFilter, filterKindOf, filterRows,
    filterSummary, foldText, generationSpan, highlightHtml, rodChoices, searchQuery, setChip, setColumnFilter, setEmptyFilter, sortRows,
    type ChipFilter, type ColumnFilter, type TableFilter,
} from '../ui/table-view/table-filter.js';
import { buildLines, sortUnionOf } from '../ui/table-view/table-subrows.js';
import { defaultTypeState, sortClick, sortShiftClick } from '../ui/table-view/table-state.js';
import type { CheckIndex } from '../ui/table-view/table-checks.js';

/** An invented family over three generations; dates of every kind. */
function tree(): StromData {
    const person = (id: string, firstName: string, lastName: string, gender: 'male' | 'female', extra: Record<string, unknown> = {}) =>
        ({ id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });
    const persons: Record<string, Record<string, unknown>> = {
        g: person('g', 'Ondřich', 'Šlapetný', 'male', { birthDate: '~1820', deathDate: '1880', partnerships: ['u0'], childIds: ['a'], sourceIds: ['s1'] }),
        h: person('h', 'Rozálie', 'Bezděková', 'female', { birthDate: '1825', deathDate: '1890', partnerships: ['u0'], childIds: ['a'] }),
        a: person('a', 'Ignác', 'Šlapetný', 'male', { birthDate: '1850..1852', deathDate: '1920', parentIds: ['g', 'h'], partnerships: ['u1', 'u2'], childIds: ['c'] }),
        b: person('b', 'Žofie', 'Kvapilová', 'female', { birthDate: '1856', deathDate: '1900', partnerships: ['u1'], childIds: ['c'] }),
        e: person('e', 'Leontýna', 'Hrubcová', 'female', { birthDate: '1862', deathDate: '1931', partnerships: ['u2'] }),
        c: person('c', 'Čeněk', 'Šlapetný', 'male', { parentIds: ['a', 'b'], events: [{ id: 'ev1', type: 'baptism', date: '1880' }] }),
        y: person('y', 'Alžběta', 'Novotná', 'female', { birthDate: '1990' }),
    };
    const partnerships = {
        u0: { id: 'u0', person1Id: 'g', person2Id: 'h', childIds: ['a'], status: 'married', startDate: '1848' },
        u1: { id: 'u1', person1Id: 'a', person2Id: 'b', childIds: ['c'], status: 'married', startDate: '1876', startPlace: 'Dolní Lhota' },
        u2: { id: 'u2', person1Id: 'a', person2Id: 'e', childIds: [], status: 'divorced', startDate: '1902', startPlace: 'Horní Újezd' },
    };
    return { persons, partnerships } as unknown as StromData;
}

const build = (data = tree(), research = false): TableModel =>
    buildTableModel(data, { rev: 1, homeId: 'c' as PersonId, lang: 'en', year: 2026, reliability: { researchTree: research, originFeature: research } });

const ids = (rows: readonly TableRow[]) => rows.map(r => r.id).sort();
const col = (id: string, type: 'persons' | 'unions' = 'persons') => columnById(type, id)!;
const run = (m: TableModel, items: TableFilter['items'], search = '') =>
    filterRows(m, 'persons', m.persons, { op: 'and', items }, search ? { query: searchQuery(search), columns: [col('name'), col('wPlace')] } : undefined);

beforeAll(() => setLanguage('en'));

describe('quick chips (§8.1)', () => {
    it('living and deceased, blood relatives, several unions, no birth date', () => {
        const m = build();
        expect(ids(run(m, [{ chip: 'living' }]).rows)).toEqual(['y']);
        expect(ids(run(m, [{ chip: 'deceased' }]).rows)).toEqual(['a', 'b', 'c', 'e', 'g', 'h']);
        expect(ids(run(m, [{ chip: 'blood' }]).rows)).toEqual(['a', 'b', 'c', 'g', 'h']);
        expect(ids(run(m, [{ chip: 'multiU' }]).rows)).toEqual(['a']);
        // A baptism standing in for the birth counts as no birth date.
        expect(ids(run(m, [{ chip: 'noBirth' }]).rows)).toEqual(['c']);
    });

    it('uncertain dates: a qualifier or a range at birth or death', () => {
        expect(ids(run(build(), [{ chip: 'uncertain' }]).rows)).toEqual(['a', 'g']);
    });

    it('no source: nothing cited on the person, the events or the unions', () => {
        expect(ids(run(build(), [{ chip: 'noSource' }]).rows)).toEqual(['a', 'b', 'c', 'e', 'h', 'y']);
    });

    it('generation range and family lines', () => {
        const m = build();
        const span = generationSpan(m)!;
        expect(span.max).toBeGreaterThan(span.min);
        const gens = m.ctx.generations();
        const top = run(m, [{ chip: 'gen', from: span.min, to: span.min }]).rows;
        expect(top.length).toBeGreaterThan(0);
        for (const r of top) expect(gens.get(r.id)! + 1).toBe(span.min);
        const rods = rodChoices(m);
        expect(rods.length).toBeGreaterThan(0);
        const one = run(m, [{ chip: 'rod', values: [rods[0].id] }]).rows;
        expect(one.length).toBe(rods[0].n);
        expect(chipLabel(m, { chip: 'rod', values: [rods[0].id] }, 'rod')).toBe(`Family line: ${rods[0].label}`);
        expect(chipLabel(m, { chip: 'gen', from: 1, to: 3 }, 'gen')).toBe('Generation 1–3');
    });

    it('findings and unusual read the checks; while they run, everyone passes', () => {
        const m = build();
        expect(run(m, [{ chip: 'finding' }]).rows).toHaveLength(m.persons.length);
        m.ctx.checks = {
            person: (id: string) => ({ n: id === 'a' || id === 'b' ? 1 : 0, top: id === 'a' ? 'warning' : id === 'b' ? 'info' : null, unusual: id === 'e' ? 1 : 0 }),
            version: 1,
        } as unknown as CheckIndex;
        // A lead (info) alone is not a finding to check.
        expect(ids(run(m, [{ chip: 'finding' }]).rows)).toEqual(['a']);
        expect(ids(run(m, [{ chip: 'unusual' }]).rows)).toEqual(['e']);
    });

    it('the research chip only in a research tree; living and deceased exclude each other', () => {
        expect(availableChips(build(), 'persons')).not.toContain('unconfirmed');
        expect(availableChips(build(tree(), true), 'persons')).toContain('unconfirmed');
        expect(availableChips(build(), 'unions')).toEqual([]);
        const f = emptyFilter();
        setChip(f, 'living', true);
        setChip(f, 'deceased', true);
        expect(f.items).toEqual([{ chip: 'deceased' }]);
        expect(setChip(f, 'deceased', true)).toBe(false);
        expect(setChip(f, 'deceased', false)).toBe(true);
        expect(f.items).toEqual([]);
    });

    it('chips join with "and"', () => {
        expect(ids(run(build(), [{ chip: 'deceased' }, { chip: 'blood' }, { chip: 'uncertain' }]).rows)).toEqual(['a', 'g']);
    });
});

describe('column filters (§8.2)', () => {
    it('the kind of filter follows the column', () => {
        expect(filterKindOf(col('name'))).toBe('text');
        expect(filterKindOf(col('bDate'))).toBe('range');
        expect(filterKindOf(col('wAge'))).toBe('range');
        expect(filterKindOf(col('relB'))).toBe('values');
        expect(filterKindOf(col('uStatus'))).toBe('values');
    });

    it('text: contains and starts with, without regard to case and diacritics', () => {
        const m = build();
        expect(ids(run(m, [{ col: 'name', kind: 'text', match: 'contains', text: 'slapet' }]).rows)).toEqual(['a', 'c', 'g']);
        expect(ids(run(m, [{ col: 'name', kind: 'text', match: 'starts', text: 'CEN' }]).rows)).toEqual(['c']);
        expect(ids(run(m, [{ col: 'name', kind: 'text', match: 'starts', text: 'slapet' }]).rows)).toEqual([]);
    });

    it('dates by years, bounds included; an estimate and a range by their start; a baptism counts', () => {
        const m = build();
        const f = (from?: number, to?: number): ColumnFilter => ({ col: 'bDate', kind: 'date', from, to });
        expect(ids(run(m, [f(1820, 1850)]).rows)).toEqual(['a', 'g', 'h']);
        expect(ids(run(m, [f(1851)]).rows)).toEqual(['b', 'c', 'e', 'y']);
        expect(ids(run(m, [f(undefined, 1820)]).rows)).toEqual(['g']);
        expect(ids(run(m, [f(1880, 1880)]).rows)).toEqual(['c']);
    });

    it('ages and numbers from–to; an age range by its lower end', () => {
        const m = build();
        // Ignác (1850..1852 – 1920) is 67–70 at death: judged by 67; Ondřich (~1820 – 1880) ≈ 60.
        expect(ids(run(m, [{ col: 'dAge', kind: 'age', from: 60, to: 68 }]).rows)).toEqual(['a', 'e', 'g', 'h']);
        expect(ids(run(m, [{ col: 'uCount', kind: 'number', from: 2 }]).rows)).toEqual(['a']);
    });

    it('only empty and only filled: a column that does not apply is neither; a substitute is empty', () => {
        const m = build();
        expect(ids(run(m, [{ col: 'dDate', kind: 'date', empty: true }]).rows)).toEqual(['c']);
        expect(ids(run(m, [{ col: 'dDate', kind: 'date', filled: true }]).rows)).toEqual(['a', 'b', 'e', 'g', 'h']);
        expect(ids(run(m, [{ col: 'bDate', kind: 'date', empty: true }]).rows)).toEqual(['c']);
        const f = emptyFilter();
        setEmptyFilter(f, col('bPlace'), 'filled');
        expect(f.items).toEqual([{ col: 'bPlace', kind: 'text', filled: true }]);
    });

    it('values of a pill or an enumeration', () => {
        const m = build();
        const st = columnValues(m, 'unions', col('uStatus', 'unions'));
        expect(st.length).toBe(2);
        const divorced = st.find(v => v.label.toLowerCase().startsWith('divorc'))!;
        const rows = filterRows(m, 'unions', m.unions, { op: 'and', items: [{ col: 'uStatus', kind: 'text', values: [divorced.value] }] }).rows;
        expect(ids(rows)).toEqual(['u2']);
    });

    it('an empty column filter is dropped; labels say what applies', () => {
        const f = emptyFilter();
        expect(setColumnFilter(f, { col: 'wAge', kind: 'age' })).toBe(false);
        expect(setColumnFilter(f, { col: 'wAge', kind: 'age', to: 15 })).toBe(true);
        expect(columnItemLabel('persons', f.items[0] as ColumnFilter)).toBe('Age at marriage ≤ 15');
        expect(setColumnFilter(f, { col: 'wAge', kind: 'age' })).toBe(true);
        expect(f.items).toEqual([]);
        const m = build();
        const g: TableFilter = { op: 'and', items: [{ chip: 'deceased' }, { col: 'name', kind: 'text', text: 'ign' }, { col: 'bDate', kind: 'date', from: 1800, to: 1850 }] };
        expect(filterSummary(m, 'persons', g)).toBe('Deceased · Full name contains “ign” · Birth date 1800–1850');
        expect(activeFilterCount(m, 'persons', g)).toBe(3);
        expect(activeFilterCount(m, 'unions', g)).toBe(0);
    });

    it('cellPasses keeps every condition of one item', () => {
        const m = build();
        const a = m.personRows.get('a' as PersonId)!;
        const v = col('bDate').get(m.ctx, a, null);
        expect(cellPasses(v, { col: 'bDate', kind: 'date', from: 1850, filled: true }, 'range')).toBe(true);
        expect(cellPasses(v, { col: 'bDate', kind: 'date', from: 1850, empty: true }, 'range')).toBe(false);
    });
});

describe('filter and sort by union (§3.3)', () => {
    it('a union column judges each union apart; the person shows when one passes', () => {
        const m = build();
        const res = run(m, [{ col: 'wDate', kind: 'date', from: 1900 }]);
        expect(ids(res.rows)).toEqual(['a', 'e']);
        const a = m.personRows.get('a' as PersonId)! as PersonRow;
        const lines = buildLines([a], { collapse: { collapsed: false, except: [] }, pass: res.pass });
        expect(lines.map(l => l.kind)).toEqual(['row', 'sub', 'more']);
        // Collapsed: the first passing union is in the person's row.
        const collapsed = buildLines([a], { collapse: { collapsed: true, except: [] }, pass: res.pass });
        expect(collapsed[0]).toMatchObject({ kind: 'row', union: 1 });
    });

    it('a union filter and a person filter join with "and"', () => {
        expect(ids(run(build(), [{ col: 'wPlace', kind: 'text', text: 'lhota' }, { chip: 'uncertain' }]).rows)).toEqual(['a']);
    });

    it('sorting by a union column takes the first passing union', () => {
        const m = build();
        const res = run(m, [{ col: 'wPlace', kind: 'text', text: 'ujezd' }]);
        const sorted = sortRows(m, 'persons', res.rows, [{ col: 'wDate', dir: 'asc' }], sortUnionOf(res.pass));
        // Ignác by 1902 (his passing union), Leontýna by 1902 too: the base order breaks the tie.
        expect(sorted.map(r => r.id)).toEqual(res.rows.map(r => r.id));
        const all = sortRows(m, 'persons', m.persons, [{ col: 'wDate', dir: 'asc' }], sortUnionOf(null));
        expect(all.slice(0, 3).map(r => r.id)).toEqual(['g', 'h', 'a']);
    });
});

describe('search (§8.3)', () => {
    it('from two characters, without regard to diacritics, also in the unions', () => {
        const m = build();
        expect(searchQuery('c')).toBe('');
        expect(searchQuery(' Če ')).toBe('ce');
        expect(ids(run(m, [], 'cenek').rows)).toEqual(['c']);
        expect(ids(run(m, [], 'ÚJEZD').rows)).toEqual(['a', 'e']);
        expect(ids(run(m, [{ chip: 'living' }], 'ujezd').rows)).toEqual([]);
    });

    it('highlights the matches with the original letters', () => {
        expect(foldText('Šlapetný')).toBe('slapetny');
        expect(highlightHtml('Šlapetný', 'slap')).toBe('<mark class="tv-hit">Šlap</mark>etný');
        expect(highlightHtml('Horní Újezd', 'ujezd')).toBe('Horní <mark class="tv-hit">Újezd</mark>');
        expect(highlightHtml('a<b> aa', 'a')).toBe('<mark class="tv-hit">a</mark>&lt;b&gt; <mark class="tv-hit">a</mark><mark class="tv-hit">a</mark>');
        expect(highlightHtml('Čeněk', '')).toBe('Čeněk');
    });
});

describe('sorting (§8.4)', () => {
    it('dates by their start, a baptism for the birth, the empty last in both directions', () => {
        const m = build();
        const asc = sortRows(m, 'persons', m.persons, [{ col: 'bDate', dir: 'asc' }]).map(r => r.id);
        expect(asc).toEqual(['g', 'h', 'a', 'b', 'e', 'c', 'y']);
        const desc = sortRows(m, 'persons', m.persons, [{ col: 'dDate', dir: 'desc' }]).map(r => r.id);
        // Living Alžběta (does not apply) and Čeněk (no death) last, in the base order.
        expect(desc).toEqual(['e', 'a', 'b', 'h', 'g', 'c', 'y']);
    });

    it('is stable: ties keep the base order', () => {
        const m = build();
        const bySurname = sortRows(m, 'persons', m.persons, [{ col: 'surname', dir: 'asc' }]).map(r => r.id);
        const slap = bySurname.filter(id => ['a', 'c', 'g'].includes(id));
        expect(slap).toEqual(m.persons.filter(r => ['a', 'c', 'g'].includes(r.id)).map(r => r.id));
        const two = sortRows(m, 'persons', m.persons, [{ col: 'surname', dir: 'asc' }, { col: 'bDate', dir: 'desc' }]).map(r => r.id);
        expect(two.slice(-3)).toEqual(['c', 'a', 'g']);
    });

    it('a click cycles ascending → descending → off; Shift adds, flips, removes', () => {
        const st = defaultTypeState('persons');
        st.sort = [];
        sortClick(st, 'name');
        expect(st.sort).toEqual([{ col: 'name', dir: 'asc' }]);
        sortClick(st, 'name');
        expect(st.sort).toEqual([{ col: 'name', dir: 'desc' }]);
        sortClick(st, 'name');
        expect(st.sort).toEqual([]);
        sortClick(st, 'bPlace');
        sortShiftClick(st, 'bDate');
        expect(st.sort).toEqual([{ col: 'bPlace', dir: 'asc' }, { col: 'bDate', dir: 'asc' }]);
        sortShiftClick(st, 'bDate');
        expect(st.sort[1]).toEqual({ col: 'bDate', dir: 'desc' });
        sortShiftClick(st, 'bDate');
        expect(st.sort).toEqual([{ col: 'bPlace', dir: 'asc' }]);
        sortClick(st, 'bDate');
        expect(st.sort).toEqual([{ col: 'bDate', dir: 'asc' }]);
    });

    it('the state starts with an empty "and" filter and no search', () => {
        const st = defaultTypeState('unions');
        expect(st.filter).toEqual({ op: 'and', items: [] });
        expect(st.search).toBe('');
        const chip: ChipFilter = { chip: 'living' };
        expect(chip.chip).toBe('living');
    });
});
