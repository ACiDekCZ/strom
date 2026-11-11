/**
 * Table view (spec 073 §14.2): the Sources rows without the DOM — one row
 * per source of the catalog, the people and the facts each documents
 * (counted once for the whole tree), the research's readers, the quick
 * chips, the record date's sort, the CSV, a saved Sources view, the empty
 * Sources table and the cells' link and readers markup.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { PersonId, StromData } from '../types.js';
import { setLanguage } from '../strings.js';
import { buildTableModel, rowCounts, rowKey, rowPersonId, sameRow, type SourceRow, type TableModel } from '../ui/table-view/table-model.js';
import { cellOf, cellPlainText, columnById, columnLabel, columnsOf, DEFAULT_VIEWS } from '../ui/table-view/table-columns.js';
import { sourceUsage } from '../ui/table-view/table-sources.js';
import {
    activeFilterCount, availableChips, chipLabel, filterRows, searchQuery, setChip, sortRows, type TableFilter,
} from '../ui/table-view/table-filter.js';
import { buildTableCsv } from '../ui/table-view/table-export.js';
import { defaultTableState, defaultTypeState, lockedColumn, shownColumns } from '../ui/table-view/table-state.js';
import {
    applyView, builtinView, defaultViewId, openViewOf, readTableWork, restoreTableState, tableWorkOf, viewChanged, viewFromState,
    workStorageKey, writeTableWork,
} from '../ui/table-view/table-views.js';
import { sanitizeTableView } from '../table-views-data.js';
import { tableEmptyState } from '../ui/table-view/table-empty.js';
import { cellInner } from '../ui/table-view/table-grid.js';
import { rowKeysFor } from '../ui/table-view/table-refresh.js';

/**
 * An invented parish: a couple, a child and a placeholder, five sources —
 * one cited twice in one list, one on a person's event and a death, one on
 * the wedding (and on the placeholder), one on a couple's event, one unused.
 */
function tree(): StromData {
    const person = (id: string, firstName: string, lastName: string, gender: 'male' | 'female', extra: Record<string, unknown> = {}) =>
        ({ id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });
    const persons = {
        a: person('a', 'Ignác', 'Šlapetný', 'male', {
            birthDate: '1850-03-02', partnerships: ['u1'], childIds: ['c'], sourceIds: ['s1'], birthSourceIds: ['s1', 's1'],
            events: [{ id: 'ra', type: 'residence', date: '1880', place: 'Horní Mlýnec', sourceIds: ['s2'] }],
        }),
        b: person('b', 'Žofie', 'Kvapilová', 'female', { deathDate: '1920', partnerships: ['u1'], childIds: ['c'], deathSourceIds: ['s2'] }),
        c: person('c', 'Čeněk', 'Šlapetný', 'male', { birthDate: '1877-01-05', parentIds: ['a', 'b'] }),
        z: person('z', '', '', 'male', { isPlaceholder: true, sourceIds: ['s3'], events: [{ id: 'pz', type: 'residence', date: '1880', sourceIds: ['s5'] }] }),
    };
    const partnerships = {
        u1: {
            id: 'u1', person1Id: 'a', person2Id: 'b', childIds: ['c'], status: 'married', startDate: '1876-05-14', sourceIds: ['s3'],
            events: [{ id: 'ce', type: 'residence', date: '1890', sourceIds: ['s4'] }],
        },
    };
    const sources = {
        s1: {
            id: 's1', title: 'Kniha narozených Mlýnecká Lhotka', repository: 'Archiv Fiktivní', reference: 'fol. 12',
            url: 'https://example.org/kniha/12', readBy: 'both', transcript: 'Ignatius filius legitimus', recordDate: '1850-03-02',
        },
        s2: { id: 's2', title: 'Soupis obyvatel Horní Mlýnec', url: 'javascript:alert(1)', readBy: 'research', recordDate: '1880' },
        s3: { id: 's3', title: 'Oddací kniha Mlýnecká Lhotka', transcript: '   ', recordDate: '1876-05-14' },
        s4: { id: 's4', title: 'Domovská kniha', url: 'http://example.org/domov', readBy: 'user' },
        s5: { id: 's5', title: 'Nepoužitý výpis' },
    };
    return { persons, partnerships, sources } as unknown as StromData;
}

const build = (data = tree()): TableModel =>
    buildTableModel(data, { rev: 1, homeId: 'c' as PersonId, lang: 'en', year: 2026, reliability: { researchTree: false, originFeature: false } });

const col = (id: string) => columnById('sources', id)!;
const row = (m: TableModel, id: string): SourceRow => m.sources.find(r => r.id === id)!;
const cell = (m: TableModel, id: string, colId: string) => cellOf(m, row(m, id), col(colId));
const ids = (rows: readonly { id: string }[]) => rows.map(r => r.id);
const run = (m: TableModel, items: TableFilter['items'], search = '') =>
    filterRows(m, 'sources', m.sources, { op: 'and', items }, search ? { query: searchQuery(search), columns: columnsOf('sources') } : undefined);

beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T10:30:00Z'));
    setLanguage('en');
});
afterAll(() => { vi.useRealTimers(); });

describe('source rows (§14.2)', () => {
    it('one row per source of the catalog, counted in the Rows switch', () => {
        const m = build();
        expect(ids(m.sources)).toEqual(['s1', 's2', 's3', 's4', 's5']);
        expect(rowCounts(m).sources).toBe(5);
        expect(rowKey(m.sources[0])).toBe('s:s1');
        expect(rowPersonId(m.sources[0])).toBeNull();
        expect(sameRow(build(), m.sources[2])?.id).toBe('s3');
        expect(lockedColumn('sources')).toBe('srcTitle');
    });

    it('people and facts: a citation list is one fact, a union documents both partners, placeholders do not count', () => {
        const m = build();
        const use = (id: string) => [row(m, id).persons, row(m, id).facts];
        // The person's own list and the birth's (cited twice in it): two facts of one person.
        expect(use('s1')).toEqual([1, 2]);
        // A person's event and another person's death.
        expect(use('s2')).toEqual([2, 2]);
        // The wedding: both partners, one fact; the placeholder's citation not counted.
        expect(use('s3')).toEqual([2, 1]);
        // A couple's event.
        expect(use('s4')).toEqual([2, 1]);
        // Only a placeholder's event: no person.
        expect(use('s5')).toEqual([0, 0]);
        expect(cell(m, 's2', 'srcPersons').text).toBe('2');
        expect(cell(m, 's3', 'srcFacts').text).toBe('1');
        expect(col('srcPersons').computed).toBe(true);
        expect(sourceUsage(tree()).get('s5')).toBeUndefined();
    });

    it('the source\'s own cells: title, archive, reference, the web address as a link, transcript, record date', () => {
        const m = build();
        expect(cell(m, 's1', 'srcTitle').text).toBe('Kniha narozených Mlýnecká Lhotka');
        expect(cell(m, 's1', 'srcRepo').text).toBe('Archiv Fiktivní');
        expect(cell(m, 's1', 'srcRef').text).toBe('fol. 12');
        expect(cell(m, 's1', 'srcUrl').link).toEqual({ href: 'https://example.org/kniha/12', label: 'example.org/kniha/12' });
        // Not a web address: its text, no link.
        expect(cell(m, 's2', 'srcUrl').link).toBeUndefined();
        expect(cell(m, 's2', 'srcUrl').text).toBe('javascript:alert(1)');
        expect(cell(m, 's5', 'srcUrl').empty).toBe(true);
        expect(cell(m, 's1', 'srcTranscript').text).toBe('yes');
        expect(cell(m, 's3', 'srcTranscript').text).toBe('no');
        expect(cell(m, 's1', 'srcRecDate').text).toBe('2 Mar 1850');
    });

    it('read by the research: one dot per reader, "no" without one', () => {
        const m = build();
        expect(cell(m, 's1', 'srcRead')).toMatchObject({ text: '2 readers', dots: [true, true] });
        expect(cell(m, 's2', 'srcRead')).toMatchObject({ text: '1 reader', dots: [true, false] });
        expect(cell(m, 's4', 'srcRead')).toMatchObject({ text: '1 reader', dots: [true, false] });
        expect(cell(m, 's3', 'srcRead')).toMatchObject({ text: 'no', empty: true });
        expect(cell(m, 's3', 'srcRead').dots).toBeUndefined();
    });

    it('the cells\' markup: the link into a new window with ↗, the readers as the reliability pill', () => {
        const m = build();
        const link = cellInner(cell(m, 's1', 'srcUrl'), col('srcUrl'));
        expect(link).toContain('<a class="tv-link" href="https://example.org/kniha/12" target="_blank" rel="noopener noreferrer"');
        expect(link).toContain('↗');
        expect(cellInner(cell(m, 's2', 'srcUrl'), col('srcUrl'))).not.toContain('<a');
        const pill = cellInner(cell(m, 's2', 'srcRead'), col('srcRead'));
        expect(pill).toContain('class="fact-status tv-readers"');
        expect(pill).toContain('<span class="fs-dots" aria-hidden="true"><i class="on"></i><i></i></span>');
        expect(pill).toContain('1 reader');
    });
});

describe('quick chips, search and sorting (§14.2)', () => {
    it('No person · Unread · With transcript · Online', () => {
        const m = build();
        expect(availableChips(m, 'sources')).toEqual(['srcNoPerson', 'srcUnread', 'srcTranscript', 'srcOnline']);
        expect(chipLabel(m, null, 'srcUnread')).toBe('Unread');
        expect(ids(run(m, [{ chip: 'srcNoPerson' }]).rows)).toEqual(['s5']);
        expect(ids(run(m, [{ chip: 'srcUnread' }]).rows)).toEqual(['s3', 's5']);
        expect(ids(run(m, [{ chip: 'srcTranscript' }]).rows)).toEqual(['s1']);
        expect(ids(run(m, [{ chip: 'srcOnline' }]).rows)).toEqual(['s1', 's4']);
        expect(ids(run(m, [{ chip: 'srcOnline' }, { chip: 'srcUnread' }]).rows)).toEqual([]);
        // A person chip does not apply to sources.
        expect(ids(run(m, [{ chip: 'living' }]).rows)).toHaveLength(5);
        expect(activeFilterCount(m, 'sources', { op: 'and', items: [{ chip: 'srcOnline' }, { chip: 'living' }] })).toBe(1);
        expect(ids(run(m, [], 'mlynecka').rows)).toEqual(['s1', 's3']);
    });

    it('default sort by title; the record date sorts as a date with undated sources last', () => {
        const m = build();
        expect(DEFAULT_VIEWS.sources.sort).toEqual([{ col: 'srcTitle', dir: 'asc' }]);
        expect(ids(sortRows(m, 'sources', m.sources, DEFAULT_VIEWS.sources.sort))).toEqual(['s4', 's1', 's5', 's3', 's2']);
        expect(ids(sortRows(m, 'sources', m.sources, [{ col: 'srcRecDate', dir: 'asc' }]))).toEqual(['s1', 's3', 's2', 's4', 's5']);
        expect(ids(sortRows(m, 'sources', m.sources, [{ col: 'srcRecDate', dir: 'desc' }])).slice(0, 3)).toEqual(['s2', 's3', 's1']);
        expect(ids(sortRows(m, 'sources', m.sources, [{ col: 'srcPersons', dir: 'asc' }]))[0]).toBe('s5');
        expect(ids(sortRows(m, 'sources', m.sources, [{ col: 'srcRead', dir: 'desc' }]))[0]).toBe('s1');
    });

    it('the default columns and the phone\'s pinned title', () => {
        const st = defaultTypeState('sources');
        expect(st.columns).toEqual(['srcTitle', 'srcRepo', 'srcSig', 'srcFolio', 'srcImageNo', 'srcRef', 'srcUrl', 'srcPersons', 'srcFacts']);
        // Read by the research and the transcript only in the Columns panel.
        expect(columnsOf('sources').map(c => c.id)).toEqual(expect.arrayContaining(['srcRead', 'srcTranscript']));
        expect(st.pinned).toBe(1);
        expect(shownColumns('sources', st, true).widths[0]).toBe(156);
        expect(columnsOf('sources').map(c => c.id)).toContain('srcRecDate');
    });
});

describe('the Sources table around the rows', () => {
    it('CSV of the sources as shown', () => {
        const m = build();
        const rows = sortRows(m, 'sources', run(m, [{ chip: 'srcOnline' }]).rows, DEFAULT_VIEWS.sources.sort);
        const columns = ['srcTitle', 'srcUrl', 'srcPersons', 'srcFacts', 'srcRead'].map(col);
        const out = buildTableCsv({ model: m, type: 'sources', rows, columns });
        const lines = out.csv.replace(/^﻿/, '').trim().split('\r\n');
        expect(lines[0]).toBe('Title;Online;People;Facts;Read by the research');
        expect(lines[1]).toBe('Domovská kniha;http://example.org/domov;2;1;1 reader');
        expect(lines[2]).toBe('Kniha narozených Mlýnecká Lhotka;https://example.org/kniha/12;1;2;2 readers');
        expect(out.items).toBe(2);
        expect(out.columns).toBe(5);
    });

    it('an empty Sources table in a tree without sources', () => {
        const base = { persons: 3, unions: 1, type: 'sources' as const, viewId: defaultViewId('sources'), viewChanged: false, search: '', shown: 0, checksDone: true, leads: 0, allComplete: () => false, readOnly: false };
        expect(tableEmptyState({ ...base, sources: 0 })?.kind).toBe('noSources');
        expect(tableEmptyState({ ...base, sources: 0 })?.title).toBe('There is no source in the tree');
        expect(tableEmptyState({ ...base, sources: 2, shown: 2 })).toBeNull();
        const data = tree();
        delete (data as { sources?: unknown }).sources;
        expect(build(data).sources).toHaveLength(0);
    });

    it('a changed source lights its row', () => {
        expect([...rowKeysFor(tree(), 'sources', ['s:s1', 'p:a', 'u:u1'])]).toEqual(['s:s1']);
    });
});

describe('a saved Sources view (§9.1)', () => {
    it('saves and opens the row type with its chips and sort', () => {
        const st = defaultTypeState('sources');
        setChip(st.filter, 'srcUnread', true);
        st.sort = [{ col: 'srcRecDate', dir: 'desc' }];
        const view = viewFromState('sources', st, 'tv-src', 'Nepřečtené', '2026-11-10T10:30:00Z');
        expect(view.rowType).toBe('sources');
        expect(view.unions).toBeUndefined();
        const back = sanitizeTableView(JSON.parse(JSON.stringify(view)))!;
        const st2 = defaultTypeState('sources');
        applyView(back, st2);
        expect(st2.filter.items).toEqual(st.filter.items);
        expect(st2.sort).toEqual(st.sort);
        expect(viewChanged(back, st2)).toBe(false);
        expect(builtinView('allSources').rowType).toBe('sources');
        expect(builtinView('allSources').name).toBe('All sources');

        const store = new Map<string, string>();
        vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
        try {
            const state = defaultTableState();
            restoreTableState(state, null, [back]);
            expect(openViewOf(state, 'sources', [back]).id).toBe(defaultViewId('sources'));
            state.open.sources = back.id;
            applyView(back, state.types.sources);
            state.rowType = 'sources';
            writeTableWork('t1', tableWorkOf(state, [back]));
            expect(store.has(workStorageKey('t1'))).toBe(true);
            const again = defaultTableState();
            restoreTableState(again, readTableWork('t1'), [back]);
            expect(again.rowType).toBe('sources');
            expect(openViewOf(again, 'sources', [back]).id).toBe('tv-src');
            expect(again.types.sources.filter.items).toEqual(st.filter.items);
            const m = build();
            expect(cellPlainText(cellOf(m, row(m, 's3'), col('srcTitle')))).toBe('Oddací kniha Mlýnecká Lhotka');
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

/**
 * Where the entry stands (spec 075 U3 §3): call number, folio and image in
 * columns of their own, the other location after them; an older source keeps
 * its whole location there with the three empty. Invented archive and books.
 */
describe('the place columns of the Sources table (spec 075 U3 §3)', () => {
    const placed = (): StromData => {
        const src = (id: string, extra: Record<string, unknown>) => ({ id, title: `Křest ${id}`, repository: 'Zemský archiv Vzorov', ...extra });
        const sources = {
            p1: src('p1', { callNumber: 'N 7', folio: 'fol. 2', image: '9', reference: 'č. 8, sloupec 2' }),
            p2: src('p2', { callNumber: 'N 7', folio: 'fol. 3r', image: '10', reference: 'č. 3' }),
            p3: src('p3', { callNumber: 'N 7', folio: 'fol. 12v', image: '34', reference: 'č. 5' }),
            p4: src('p4', { folio: 'S. 15', image: '57–58' }),
            p5: src('p5', { reference: 'N 9, fol. 44v, sn. 102' }),
            p6: src('p6', { callNumber: 'N 12', folio: 'pag. 112', reference: 'č. 14' }),
        };
        return { persons: {}, partnerships: {}, sources } as unknown as StromData;
    };

    it('call number, folio, image and other location; an older source only its whole location', () => {
        const m = build(placed());
        expect(['srcSig', 'srcFolio', 'srcImageNo', 'srcRef'].map(c => cell(m, 'p3', c).text)).toEqual(['N 7', 'fol. 12v', '34', 'č. 5']);
        expect(['srcSig', 'srcFolio', 'srcImageNo'].map(c => cell(m, 'p5', c).empty)).toEqual([true, true, true]);
        expect(cell(m, 'p5', 'srcRef').text).toBe('N 9, fol. 44v, sn. 102');
        expect(cell(m, 'p4', 'srcRef').empty).toBe(true);
        expect(['srcSig', 'srcFolio', 'srcImageNo', 'srcRef'].map(c => col(c).width)).toEqual([120, 120, 80, 170]);
        // The research's column of where the scan is keeps its id (saved views) and gets a name of its own.
        expect(col('srcImage').group).toBe('research');
        expect(columnLabel(col('srcImageNo'))).toBe('Image');
        expect(columnLabel(col('srcImage'))).not.toBe(columnLabel(col('srcImageNo')));
        expect(columnLabel(col('srcRef'))).toBe('Other location');
    });

    it('sorts naturally (9 before 10, 57–58 after 34), the empty ones last both ways', () => {
        const m = build(placed());
        const by = (c: string, dir: 'asc' | 'desc') => ids(sortRows(m, 'sources', m.sources, [{ col: c, dir }]));
        expect(by('srcImageNo', 'asc')).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
        expect(by('srcImageNo', 'desc')).toEqual(['p4', 'p3', 'p2', 'p1', 'p5', 'p6']);
        expect(by('srcFolio', 'asc')).toEqual(['p1', 'p2', 'p3', 'p6', 'p4', 'p5']);
        expect(by('srcSig', 'asc')).toEqual(['p1', 'p2', 'p3', 'p6', 'p4', 'p5']);
        expect(by('srcSig', 'desc')).toEqual(['p6', 'p1', 'p2', 'p3', 'p4', 'p5']);
    });

    it('filters and searches the fields as text', () => {
        const m = build(placed());
        const search = (q: string) => ids(filterRows(m, 'sources', m.sources, { op: 'and', items: [] }, { query: searchQuery(q), columns: [col('srcFolio')] }).rows);
        expect(search('12v')).toEqual(['p3']);
        expect(col('srcImageNo').kind ?? 'text').toBe('text');
    });

    it('a saved view keeps its columns: the new ones are not added to it', () => {
        const old = ['srcTitle', 'srcRepo', 'srcRef', 'srcUrl', 'srcPersons', 'srcFacts', 'srcRead', 'srcTranscript'];
        const st = defaultTypeState('sources');
        st.columns = [...old];
        const view = viewFromState('sources', st, 'tv-old', 'Older view', '2026-11-10T10:30:00Z');
        const back = sanitizeTableView(JSON.parse(JSON.stringify(view)))!;
        const st2 = defaultTypeState('sources');
        applyView(back, st2);
        expect(st2.columns).toEqual(old);
        expect(st2.columns).not.toContain('srcSig');
    });
});
