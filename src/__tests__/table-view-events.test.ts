/**
 * Table view (spec 073 §14.1): the Events rows without the DOM — one row per
 * event (a shared event of several people is one row, a wedding one row for
 * the couple), the participants by role, the quick chips and the participant
 * filter, the date sort, the CSV, a saved Events view and the findings on
 * event cells.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { PersonId, StromData } from '../types.js';
import { setLanguage } from '../strings.js';
import { buildTableModel, rowCounts, rowKey, rowPersonId, sameRow, type EventRow, type TableModel } from '../ui/table-view/table-model.js';
import { cellOf, cellPlainText, columnById, columnsOf, DEFAULT_VIEWS, eventTypeLabel } from '../ui/table-view/table-columns.js';
import { eventEditTarget } from '../ui/table-view/table-events.js';
import {
    activeFilterCount, availableChips, chipLabel, emptyFilter, filterRows, filterSummary, participantChip, searchQuery, setChip,
    setParticipantFilter, sortRows, type ChipFilter, type TableFilter,
} from '../ui/table-view/table-filter.js';
import { buildTableCsv } from '../ui/table-view/table-export.js';
import { defaultTableState, defaultTypeState, lockedColumn, shownColumns } from '../ui/table-view/table-state.js';
import {
    applyView, builtinView, defaultViewId, openViewOf, readTableWork, restoreTableState, tableWorkOf, viewChanged, viewFromState,
    workStorageKey, writeTableWork,
} from '../ui/table-view/table-views.js';
import { sanitizeTableView } from '../table-views-data.js';
import { buildCheckIndex } from '../ui/table-view/table-checks.js';
import { validateTreeData, type ValidationIssue } from '../validation.js';

/**
 * An invented village: a couple with two children, a third household, a
 * shared census-like residence, baptisms with godparents (one of them a
 * person of the tree), a wedding with witnesses, a divorce and a placeholder.
 */
function tree(): StromData {
    const person = (id: string, firstName: string, lastName: string, gender: 'male' | 'female', extra: Record<string, unknown> = {}) =>
        ({ id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });
    const home = { type: 'residence', date: '1880', place: 'Horní Mlýnec', sourceIds: ['s1'] };
    const persons: Record<string, Record<string, unknown>> = {
        a: person('a', 'Ignác', 'Šlapetný', 'male', {
            birthDate: '1850-03-02', birthPlace: 'Dolní Lhota', deathDate: '1920', partnerships: ['u1', 'u2'], childIds: ['c', 'd'],
            events: [{ id: 'ra', ...home, participants: [{ id: 'x1', role: 'other', name: 'Eufrozína Mlhavá' }] }],
        }),
        b: person('b', 'Žofie', 'Kvapilová', 'female', {
            birthDate: '1856-07-20', partnerships: ['u1'], childIds: ['c', 'd'],
            events: [{ id: 'rb', ...home, participants: [{ id: 'x2', role: 'other', name: 'Eufrozína Mlhavá' }] }],
        }),
        c: person('c', 'Čeněk', 'Šlapetný', 'male', {
            birthDate: '1877-01-05', parentIds: ['a', 'b'],
            events: [
                { id: 'bc', type: 'baptism', date: '1877-01-15', place: 'Dolní Lhota', sourceIds: ['s2'], participants: [
                    { id: 'g1', role: 'godparent', personId: 'k' },
                    { id: 'g2', role: 'godparent', name: 'Kryšpín Hrbolatý' },
                    { id: 'o1', role: 'officiant', name: 'Bonifác Zvonař' },
                ] },
                { id: 'rc', ...home },
            ],
        }),
        d: person('d', 'Ludmila', 'Šlapetná', 'female', {
            birthDate: '1879', parentIds: ['a', 'b'],
            events: [
                { id: 'bd', type: 'baptism', date: '1879', participants: [{ id: 'g3', role: 'godparent', name: 'kryspin  HRBOLATY' }] },
                // Before her birth: a finding on the event's date cell.
                { id: 'od', type: 'occupation', date: '1870', note: 'švadlena' },
            ],
        }),
        e: person('e', 'Leontýna', 'Hrubcová', 'female', { birthDate: '1862', deathDate: '1931', deathPlace: 'Brodek', partnerships: ['u2'] }),
        k: person('k', 'Vendelín', 'Pospíchal', 'male', {
            events: [{ id: 'mk', type: 'custom', customLabel: 'Pouť', date: '1890', place: 'Svatý Kopeček' }],
        }),
        z: person('z', '', '', 'male', { isPlaceholder: true, birthDate: '1800', partnerships: ['u3'], events: [{ id: 'pz', type: 'residence', date: '1880', place: 'Horní Mlýnec', sourceIds: ['s1'] }] }),
        w: person('w', 'Apolena', 'Kubištová', 'female', { partnerships: ['u3', 'u4'] }),
        v: person('v', 'Florián', 'Vodička', 'male', { partnerships: ['u4'] }),
    };
    const partnerships = {
        u1: {
            id: 'u1', person1Id: 'a', person2Id: 'b', childIds: ['c', 'd'], status: 'married', startDate: '1876-05-14', startPlace: 'Dolní Lhota',
            participants: [{ id: 'w1', role: 'witness', personId: 'k' }, { id: 'w2', role: 'witness', name: 'Kryšpín Hrbolatý' }],
            events: [{ id: 'cb', type: 'banns', date: '1876-04' }],
        },
        u2: { id: 'u2', person1Id: 'a', person2Id: 'e', childIds: [], status: 'divorced', startDate: '1902', endDate: '1910', endPlace: 'Brodek' },
        u3: { id: 'u3', person1Id: 'z', person2Id: 'w', childIds: [], status: 'married', startDate: '1890' },
        // Partners without anything written: no row; a married couple the file wrote no wedding for: none either.
        u4: { id: 'u4', person1Id: 'v', person2Id: 'w', childIds: [], status: 'partners' },
    };
    const sources = {
        s1: { id: 's1', title: 'Soupis obyvatel 1880', reference: 'fol. 12' },
        s2: { id: 's2', title: 'Matrika N 1870–1890', reference: 'str. 4' },
    };
    return { persons, partnerships, sources } as unknown as StromData;
}

const build = (data = tree()): TableModel =>
    buildTableModel(data, { rev: 1, homeId: 'c' as PersonId, lang: 'en', year: 2026, reliability: { researchTree: false, originFeature: false } });

const col = (id: string) => columnById('events', id)!;
const cell = (m: TableModel, id: string, colId: string) => cellOf(m, m.eventRows.get(id)!, col(colId));
const ids = (rows: readonly { id: string }[]) => rows.map(r => r.id).sort();
const run = (m: TableModel, items: TableFilter['items'], search = '') =>
    filterRows(m, 'events', m.events, { op: 'and', items }, search ? { query: searchQuery(search), columns: columnsOf('events') } : undefined);

beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T10:30:00Z'));
    setLanguage('en');
});
afterAll(() => { vi.useRealTimers(); });

describe('event rows (§14.1)', () => {
    it('one row per event; the same event of several people is one row', () => {
        const m = build();
        const shared = m.events.filter(r => r.type === 'residence');
        expect(shared).toHaveLength(1);
        expect(shared[0].persons.map(p => p.id)).toEqual(['a', 'b', 'c']);
        expect(shared[0].refs).toEqual([{ personId: 'a', eventId: 'ra' }, { personId: 'b', eventId: 'rb' }, { personId: 'c', eventId: 'rc' }]);
        // Found by the id of each copy; the participants of the copies once.
        expect(m.eventRows.get('l:b:rb')).toBe(shared[0]);
        expect(shared[0].participants).toHaveLength(1);
        expect(cellOf(m, shared[0], col('evWho')).text).toBe('Ignác Šlapetný, Žofie Kvapilová, Čeněk Šlapetný');
        // Two baptisms are two events, however alike.
        expect(m.events.filter(r => r.type === 'baptism')).toHaveLength(2);
        expect(rowCounts(m)).toEqual({ persons: 8, unions: 4, events: m.events.length });
    });

    it('a wedding is one row for the couple; a divorce its own; nothing for a couple with nothing written', () => {
        const m = build();
        const w = m.eventRows.get('w:u1')!;
        expect(w.persons.map(p => p.id)).toEqual(['a', 'b']);
        expect(m.events.filter(r => r.union?.id === 'u1').map(r => r.id)).toEqual(['w:u1', 'c:u1:cb']);
        expect(eventTypeLabel(w)).toBe('Marriage');
        expect(cell(m, 'w:u1', 'evWho').names?.map(n => n.personId)).toEqual(['a', 'b']);
        expect(eventTypeLabel(m.eventRows.get('v:u2')!)).toBe('Divorce');
        expect(cell(m, 'v:u2', 'evPlace').text).toBe('Brodek');
        expect(m.events.some(r => r.union?.id === 'u4')).toBe(false);
        // A placeholder partner is not named; the placeholder's own events are no rows.
        expect(m.eventRows.get('w:u3')!.persons.map(p => p.id)).toEqual(['w']);
        expect(m.events.some(r => r.persons.some(p => p.id === 'z'))).toBe(false);
        // Birth and death only when something of them is written.
        expect(m.eventRows.has('b:k')).toBe(false);
        expect(m.eventRows.has('d:e')).toBe(true);
        expect(eventTypeLabel(m.eventRows.get('l:k:mk')!)).toBe('Pouť');
    });

    it('participants by role, the tree\'s people with their ids', () => {
        const m = build();
        const god = cell(m, 'l:c:bc', 'godparents');
        expect(god.text).toBe('Vendelín Pospíchal, Kryšpín Hrbolatý');
        expect(god.names).toEqual([
            { text: 'Vendelín Pospíchal', personId: 'k', role: 'godparent' },
            { text: 'Kryšpín Hrbolatý', role: 'godparent' },
        ]);
        expect(cell(m, 'l:c:bc', 'officiants').text).toBe('Bonifác Zvonař');
        expect(cell(m, 'l:c:bc', 'witnesses').empty).toBe(true);
        expect(cell(m, 'w:u1', 'witnesses').names?.map(n => n.personId ?? n.text)).toEqual(['k', 'Kryšpín Hrbolatý']);
        expect(cell(m, 'l:a:ra', 'others').text).toBe('Eufrozína Mlhavá');
        expect(cell(m, 'l:c:bc', 'evSource').text).toBe('Matrika N 1870–1890, str. 4');
    });

    it('age at the event: days under a year, each partner at a wedding, none at a birth', () => {
        const m = build();
        expect(cell(m, 'l:c:bc', 'evAge').text).toBe('10 d');
        expect(cell(m, 'w:u1', 'evAge').text).toBe('26, 19');
        expect(cell(m, 'b:a', 'evAge').na).toBe(true);
        expect(cell(m, 'l:d:bd', 'evAge').text).toBe('0');
    });

    it('the row helpers: keys, the same row in a new model, the person, what Edit opens', () => {
        const m = build();
        const r = m.eventRows.get('l:a:ra')!;
        expect(rowKey(r)).toBe('e:l:a:ra');
        expect(sameRow(build(), r)?.id).toBe('l:a:ra');
        expect(rowPersonId(r)).toBe('a');
        expect(eventEditTarget(r)).toEqual({ kind: 'personEvent', personId: 'a', eventId: 'ra' });
        expect(eventEditTarget(m.eventRows.get('c:u1:cb')!)).toEqual({ kind: 'coupleEvent', partnershipId: 'u1', eventId: 'cb' });
        expect(eventEditTarget(m.eventRows.get('w:u1')!)).toEqual({ kind: 'union', partnershipId: 'u1', personId: 'a' });
        expect(eventEditTarget(m.eventRows.get('b:a')!)).toEqual({ kind: 'person', personId: 'a' });
    });

    it('the default view: type and person pinned, sorted by date; the type always shown', () => {
        const st = defaultTypeState('events');
        expect(st.columns.slice(0, 2)).toEqual(['evType', 'evWho']);
        expect(st.pinned).toBe(2);
        expect(st.sort).toEqual([{ col: 'evDate', dir: 'asc' }]);
        expect(lockedColumn('events')).toBe('evType');
        expect(shownColumns('events', st, false).columns.map(c => c.id)).toEqual(DEFAULT_VIEWS.events.columns);
        expect(defaultViewId('events')).toBe('b:events');
    });
});

describe('chips, the participant filter, search and sort (§14.1)', () => {
    it('the families of events and No source; one family at a time', () => {
        const m = build();
        expect(availableChips(m, 'events')).toEqual(['evBirth', 'evMarriage', 'evDeath', 'evOther', 'noSource']);
        expect(ids(run(m, [{ chip: 'evBirth' }]).rows)).toEqual(['b:a', 'b:b', 'b:c', 'b:d', 'b:e', 'l:c:bc', 'l:d:bd']);
        expect(ids(run(m, [{ chip: 'evMarriage' }]).rows)).toEqual(['c:u1:cb', 'w:u1', 'w:u2', 'w:u3']);
        expect(ids(run(m, [{ chip: 'evDeath' }]).rows)).toEqual(['d:a', 'd:e']);
        expect(ids(run(m, [{ chip: 'evOther' }]).rows)).toEqual(['l:a:ra', 'l:d:od', 'l:k:mk', 'v:u2']);
        expect(run(m, [{ chip: 'noSource' }]).rows.some(r => r.id === 'l:c:bc' || r.id === 'l:a:ra')).toBe(false);
        const f = emptyFilter();
        setChip(f, 'evBirth', true);
        setChip(f, 'noSource', true);
        setChip(f, 'evDeath', true);
        expect(f.items).toEqual([{ chip: 'noSource' }, { chip: 'evDeath' }]);
        // People's chips do not apply to events.
        expect(activeFilterCount(m, 'events', { op: 'and', items: [{ chip: 'living' }] })).toBe(0);
    });

    it('a godparent of the tree by the person, one written by the name (case and diacritics aside)', () => {
        const m = build();
        const bc = m.eventRows.get('l:c:bc')!;
        const f = emptyFilter();
        setParticipantFilter(f, m, bc.participants[0]);
        expect(f.items).toEqual([{ chip: 'participant', role: 'godparent', personId: 'k', name: 'Vendelín Pospíchal' }]);
        expect(ids(filterRows(m, 'events', m.events, f).rows)).toEqual(['l:c:bc']);
        expect(chipLabel(m, f.items[0] as ChipFilter, 'participant')).toBe('Godparent: Vendelín Pospíchal');
        // The same person as a witness is another role.
        const byName = participantChip(m, bc.participants[1]);
        expect(byName).toEqual({ role: 'godparent', name: 'Kryšpín Hrbolatý' });
        setParticipantFilter(f, m, bc.participants[1]);
        expect(f.items).toHaveLength(1);
        expect(ids(filterRows(m, 'events', m.events, f).rows)).toEqual(['l:c:bc', 'l:d:bd']);
        expect(filterSummary(m, 'events', f)).toBe('Godparent: Kryšpín Hrbolatý');
        expect(ids(run(m, [{ chip: 'participant', role: 'witness', name: 'kryšpín hrbolatý' }]).rows)).toEqual(['w:u1']);
        expect(ids(run(m, [{ chip: 'participant', role: 'witness', personId: 'k', name: 'x' }]).rows)).toEqual(['w:u1']);
    });

    it('search and a column filter over the event columns', () => {
        const m = build();
        expect(ids(run(m, [], 'hrbolaty').rows)).toEqual(['l:c:bc', 'l:d:bd', 'w:u1']);
        expect(ids(run(m, [{ col: 'evPlace', kind: 'text', text: 'brod' }]).rows)).toEqual(['d:e', 'v:u2']);
        expect(ids(run(m, [{ col: 'evDate', kind: 'date', from: 1900, to: 1915 }]).rows)).toEqual(['v:u2', 'w:u2']);
    });

    it('sorted by date, rows without a date last both ways', () => {
        const data = tree();
        (data.persons['k' as PersonId].events ??= []).push({ id: 'nk', type: 'education', place: 'Brodek' });
        const m = build(data);
        const asc = sortRows(m, 'events', m.events, [{ col: 'evDate', dir: 'asc' }]);
        expect(asc[0].id).toBe('b:a');
        expect(asc.slice(0, 4).map(r => r.id)).toEqual(['b:a', 'b:b', 'b:e', 'l:d:od']);
        const desc = sortRows(m, 'events', m.events, [{ col: 'evDate', dir: 'desc' }]);
        expect(desc[0].id).toBe('d:e');
        const undated = m.events.filter(r => !r.date).map(r => r.id);
        expect(undated).toEqual(['l:k:nk']);
        expect(asc[asc.length - 1].id).toBe('l:k:nk');
        expect(desc.slice(-undated.length).map(r => r.id).sort()).toEqual(undated.sort());
    });

    it('CSV of the events as shown', () => {
        const m = build();
        const rows = sortRows(m, 'events', run(m, [{ chip: 'evMarriage' }]).rows, [{ col: 'evDate', dir: 'asc' }]);
        const columns = ['evType', 'evWho', 'evDate', 'witnesses'].map(col);
        const out = buildTableCsv({ model: m, type: 'events', rows, columns });
        const lines = out.csv.replace(/^﻿/, '').trim().split('\r\n');
        expect(lines[0]).toBe('Type;Person or couple;Date;Witnesses');
        expect(lines[1]).toBe('Banns;"Ignác Šlapetný, Žofie Kvapilová";Apr 1876;');
        expect(lines[2]).toBe('Marriage;"Ignác Šlapetný, Žofie Kvapilová";14 May 1876;"Vendelín Pospíchal, Kryšpín Hrbolatý"');
        expect(out.items).toBe(4);
        expect(out.columns).toBe(4);
    });
});

describe('a saved Events view (§9.1)', () => {
    it('saves and opens the row type with its participant filter', () => {
        const m = build();
        const st = defaultTypeState('events');
        setParticipantFilter(st.filter, m, m.eventRows.get('l:c:bc')!.participants[1]);
        setChip(st.filter, 'evBirth', true);
        st.sort = [{ col: 'evPlace', dir: 'desc' }];
        const view = viewFromState('events', st, 'tv-ev', 'Kmotři', '2026-11-10T10:30:00Z');
        expect(view.rowType).toBe('events');
        expect(view.unions).toBeUndefined();
        const back = sanitizeTableView(JSON.parse(JSON.stringify(view)))!;
        const st2 = defaultTypeState('events');
        applyView(back, st2);
        expect(st2.filter.items).toEqual(st.filter.items);
        expect(st2.sort).toEqual(st.sort);
        expect(viewChanged(back, st2)).toBe(false);
        expect(cellPlainText(cellOf(m, m.eventRows.get('l:c:bc')!, col('evType')))).toBe('Baptism');

        // Kept as the open view of the Events table between visits.
        const store = new Map<string, string>();
        vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
        try {
            const state = defaultTableState();
            restoreTableState(state, null, [back]);
            state.open.events = back.id;
            applyView(back, state.types.events);
            state.rowType = 'events';
            writeTableWork('t1', tableWorkOf(state, [back]));
            expect(store.has(workStorageKey('t1'))).toBe(true);
            const again = defaultTableState();
            restoreTableState(again, readTableWork('t1'), [back]);
            expect(again.rowType).toBe('events');
            expect(openViewOf(again, 'events', [back]).id).toBe('tv-ev');
            expect(again.types.events.filter.items).toEqual(st.filter.items);
            expect(builtinView('events').rowType).toBe('events');
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe('findings on event cells (§7.2, §14.1)', () => {
    it('an event before the birth on its date, the wedding\'s and the death\'s from their own cells, a recurring godparent on the name', () => {
        const data = tree();
        const issues = validateTreeData(data).issues;
        const before = issues.find(i => i.type === 'eventBeforeBirth');
        expect(before?.personIds).toEqual(['d']);
        // The written godparent at two baptisms and a wedding of two families: Data quality's own finding.
        const godparent = issues.find(i => i.type === 'recurringGodparent' && i.subject === 'Kryšpín Hrbolatý')!;
        expect(godparent).toBeDefined();
        // The godparent of the tree at a baptism and as a witness at a wedding: matched by the person's name.
        expect(issues.some(i => i.type === 'recurringGodparent' && i.subject === 'Vendelín Pospíchal')).toBe(true);
        const index = buildCheckIndex(data, issues);
        const m = build(data);
        const row = (id: string): EventRow => m.eventRows.get(id)!;
        expect(index.cell(row('l:d:od'), 'evDate', null)?.issue.type).toBe('eventBeforeBirth');
        expect(index.cell(row('l:d:bd'), 'evDate', null)).toBeNull();
        expect(index.cell(row('l:d:bd'), 'godparents', null)?.issue).toBe(godparent);
        expect(index.cellAll(row('l:c:bc'), 'godparents', null).map(f => f.issue.subject).sort()).toEqual(['Kryšpín Hrbolatý', 'Vendelín Pospíchal']);
        expect(index.cell(row('w:u1'), 'witnesses', null)).not.toBeNull();
        expect(index.cell(row('l:c:bc'), 'officiants', null)).toBeNull();
        // A place cell of an event is matched by its value like the other place columns.
        const spelled: ValidationIssue = { id: 'z', severity: 'info', type: 'placeSpelling', message: '', subject: 'Brodek' };
        const index2 = buildCheckIndex(data, [spelled]);
        expect(index2.cell(row('d:e'), 'evPlace', null, 'Brodek')?.issue).toBe(spelled);
        // A death before the birth shows on the death row's date.
        const bad = tree();
        (bad.persons['e' as PersonId]).deathDate = '1850';
        const m3 = build(bad);
        const index3 = buildCheckIndex(bad, validateTreeData(bad).issues);
        expect(index3.cell(m3.eventRows.get('d:e')!, 'evDate', null)?.issue.type).toBe('deathBeforeBirth');
    });
});
