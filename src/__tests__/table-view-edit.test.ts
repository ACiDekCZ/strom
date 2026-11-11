/**
 * Table view (T54 F8): a cell edited in place — which cells stand for one
 * fact of the tree, the text the editor opens with, and what a save changes
 * (the date read as the person dialog reads it, an empty field clearing only
 * that fact, the baptism's other fields kept, an unreadable date or a person
 * left without a name saving nothing).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { PersonId, StromData } from '../types.js';
import { setLanguage } from '../strings.js';
import { formatDateForInput, normalizeDateInput } from '../dates.js';
import { buildTableModel, type TableModel, type TableRow, type PersonRow } from '../ui/table-view/table-model.js';
import { columnById } from '../ui/table-view/table-columns.js';
import { editChangeOf, editTargetOf, editValueOf, type EditTarget } from '../ui/table-view/table-edit.js';
import type { GridLine } from '../ui/table-view/table-subrows.js';

/** An invented couple: he with one union, one occupation and a cited baptism; she with two unions and two occupations. */
function tree(): StromData {
    const person = (id: string, firstName: string, lastName: string, gender: 'male' | 'female', extra: Record<string, unknown> = {}) =>
        ({ id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });
    const persons: Record<string, Record<string, unknown>> = {
        v: person('v', 'Bořivoj', 'Vrtišek', 'male', {
            birthDate: '1850-03-01', birthPlace: 'Lopuchov', partnerships: ['u1'],
            events: [
                { id: 'e1', type: 'baptism', date: '1850-03-02', place: 'Lopuchov', note: 'godfather a miller', citations: [{ sourceId: 's1', page: 'fol. 12' }] },
                { id: 'e2', type: 'occupation', note: 'smith' },
            ],
        }),
        k: person('k', 'Kunhuta', 'Hrnčíříková', 'female', {
            marriedSurname: 'Vrtišková', birthDate: '1852', partnerships: ['u1', 'u2'],
            events: [{ id: 'e3', type: 'occupation', note: 'maid' }, { id: 'e4', type: 'occupation', note: 'cook' }],
        }),
        t: person('t', '', 'Truhlíř', 'male', { partnerships: ['u2'] }),
    };
    const partnerships = {
        u1: { id: 'u1', person1Id: 'v', person2Id: 'k', childIds: [], status: 'married', startDate: '1874', startPlace: 'Klenovice' },
        u2: { id: 'u2', person1Id: 't', person2Id: 'k', childIds: [], status: 'married' },
    };
    return { persons, partnerships, sources: { s1: { id: 's1', title: 'Parish register' } } } as unknown as StromData;
}

const build = (data: StromData): TableModel =>
    buildTableModel(data, { rev: 1, homeId: 'v' as PersonId, lang: 'en', year: 2026, reliability: { researchTree: false, originFeature: false } });

const col = (id: string) => columnById('persons', id)!;
const rowOf = (m: TableModel, id: string): PersonRow => m.persons.find(r => r.id === id)!;
const lineOf = (row: TableRow): GridLine => ({ kind: 'row', row, union: row.kind === 'person' ? 0 : null, n: row.kind === 'person' ? row.unions.length : 0, expanded: null });
const subOf = (row: PersonRow, union: number): GridLine => ({ kind: 'sub', row, union, k: union + 1, n: row.unions.length, dimmed: false });
const targetAt = (m: TableModel, id: string, colId: string): EditTarget | null => editTargetOf('persons', lineOf(rowOf(m, id)), col(colId));

beforeEach(() => setLanguage('en'));

describe('the cells edited in place (T54 F8)', () => {
    it('a fact of the person is edited; the name, computed cells, checks and relations are not', () => {
        const m = build(tree());
        expect(targetAt(m, 'v', 'bDate')).toEqual({ field: 'birthDate', input: 'date', personId: 'v', unionId: null });
        expect(targetAt(m, 'v', 'bPlace')).toMatchObject({ field: 'birthPlace', input: 'place' });
        expect(targetAt(m, 'v', 'bapPlace')).toMatchObject({ field: 'baptismPlace', input: 'place' });
        expect(targetAt(m, 'v', 'dDate')).toMatchObject({ field: 'deathDate', input: 'date' });
        expect(targetAt(m, 'v', 'burDate')).toMatchObject({ field: 'burialDate', input: 'date' });
        expect(targetAt(m, 'v', 'occ')).toMatchObject({ field: 'occupation', input: 'text' });
        for (const id of ['name', 'dAge', 'partner', 'comp', 'nFind', 'uCount', 'father']) {
            expect(targetAt(m, 'v', id), id).toBeNull();
        }
    });

    it('"Surname" edits what it shows: the married surname when there is one, else the birth surname', () => {
        const m = build(tree());
        expect(targetAt(m, 'k', 'surname')?.field).toBe('marriedSurname');
        expect(targetAt(m, 'v', 'surname')?.field).toBe('lastName');
        expect(targetAt(m, 'k', 'birthSurname')?.field).toBe('lastName');
        expect(targetAt(m, 'k', 'marriedSurname')?.field).toBe('marriedSurname');
    });

    it('several occupations are a history: that cell is not edited in place', () => {
        const m = build(tree());
        expect(targetAt(m, 'k', 'occ')).toBeNull();
    });

    it('a wedding: on the row of a person with one union, on a sub-row, in the Unions table', () => {
        const m = build(tree());
        expect(targetAt(m, 'v', 'wDate')).toEqual({ field: 'marriageDate', input: 'date', personId: null, unionId: 'u1' });
        // Two unions on one row: which one is not said.
        expect(targetAt(m, 'k', 'wPlace')).toBeNull();
        const k = rowOf(m, 'k');
        expect(editTargetOf('persons', subOf(k, 1), col('wPlace'))).toMatchObject({ field: 'marriagePlace', unionId: 'u2' });
        // A sub-row carries only its union's cells.
        expect(editTargetOf('persons', subOf(k, 1), col('bDate'))).toBeNull();
        const u = m.unionRows.get('u1' as never)!;
        expect(editTargetOf('unions', lineOf(u), columnById('unions', 'wDate')!)).toMatchObject({ field: 'marriageDate', unionId: 'u1' });
        expect(editTargetOf('unions', lineOf(u), columnById('unions', 'wPlace')!)).toMatchObject({ field: 'marriagePlace', input: 'place' });
    });

    it('the editor opens with the stored value, a date as the person dialog shows it', () => {
        const data = tree();
        const m = build(data);
        expect(editValueOf(data, targetAt(m, 'v', 'bPlace')!)).toBe('Lopuchov');
        expect(editValueOf(data, targetAt(m, 'v', 'bapDate')!)).toBe(formatDateForInput('1850-03-02'));
        setLanguage('cs');
        expect(editValueOf(data, targetAt(m, 'v', 'bDate')!)).toBe('1.3.1850');
        expect(editValueOf(data, targetAt(m, 'v', 'occ')!)).toBe('smith');
        expect(editValueOf(data, targetAt(m, 'v', 'wPlace')!)).toBe('Klenovice');
        expect(editValueOf(data, targetAt(m, 'v', 'dDate')!)).toBe('');
    });
});

describe('a cell\'s save (T54 F8)', () => {
    it('a date is read as the person dialog reads it; one that cannot be read saves nothing', () => {
        const data = tree();
        const m = build(data);
        const t = targetAt(m, 'v', 'bDate')!;
        expect(editChangeOf(data, t, '15.5.1851', 'cs')).toEqual({ ok: true, change: { kind: 'person', personId: 'v', updates: { birthDate: '1851-05-15' } } });
        const about = editChangeOf(data, t, 'kolem 1851', 'cs');
        expect(about).toEqual({ ok: true, change: { kind: 'person', personId: 'v', updates: { birthDate: normalizeDateInput('kolem 1851', 'cs') } } });
        expect(editChangeOf(data, t, 'the spring after the flood', 'en')).toEqual({ ok: false, error: 'date' });
        // The same date written another way is no change.
        expect(editChangeOf(data, t, '1.3.1850', 'cs')).toEqual({ ok: true, change: null });
    });

    it('an empty field clears only that fact; a death date drops the explicit "deceased"', () => {
        const data = tree();
        const m = build(data);
        expect(editChangeOf(data, targetAt(m, 'v', 'bPlace')!, '  ')).toEqual({ ok: true, change: { kind: 'person', personId: 'v', updates: { birthPlace: '' } } });
        const death = editChangeOf(data, targetAt(m, 'v', 'dDate')!, '1910', 'en');
        expect(death.ok && death.change?.kind === 'person' && death.change.updates).toEqual({ deathDate: '1910', isDeceased: undefined });
        expect(death.ok && death.change?.kind === 'person' && 'isDeceased' in death.change.updates).toBe(true);
        expect(editChangeOf(data, targetAt(m, 'v', 'bPlace')!, ' Lopuchov ')).toEqual({ ok: true, change: null });
    });

    it('the baptism is updated in place (its note and citations kept); an emptied fact goes from it', () => {
        const data = tree();
        const m = build(data);
        expect(editChangeOf(data, targetAt(m, 'v', 'bapPlace')!, 'Klenovice')).toEqual({
            ok: true, change: { kind: 'event', personId: 'v', type: 'baptism', eventId: 'e1', updates: { place: 'Klenovice' } },
        });
        expect(editChangeOf(data, targetAt(m, 'v', 'bapDate')!, '', 'en')).toEqual({
            ok: true, change: { kind: 'event', personId: 'v', type: 'baptism', eventId: 'e1', updates: { date: undefined } },
        });
    });

    it('a burial the person does not have yet is added with that one fact; an empty field adds none', () => {
        const data = tree();
        const m = build(data);
        expect(editChangeOf(data, targetAt(m, 'v', 'burDate')!, '1910', 'en')).toEqual({
            ok: true, change: { kind: 'event', personId: 'v', type: 'burial', eventId: null, updates: { type: 'burial', date: '1910' } },
        });
        expect(editChangeOf(data, targetAt(m, 'v', 'burPlace')!, '')).toEqual({ ok: true, change: null });
    });

    it('a person keeps a first name or a surname', () => {
        const data = tree();
        const m = build(data);
        expect(editChangeOf(data, targetAt(m, 't', 'surname')!, ' ')).toEqual({ ok: false, error: 'name' });
        expect(editChangeOf(data, targetAt(m, 'v', 'surname')!, '')).toEqual({ ok: true, change: { kind: 'person', personId: 'v', updates: { lastName: '' } } });
        expect(editChangeOf(data, targetAt(m, 'k', 'surname')!, 'Truhlířová')).toEqual({
            ok: true, change: { kind: 'person', personId: 'k', updates: { marriedSurname: 'Truhlířová' } },
        });
    });

    it('the occupation goes as the dialog\'s quick field writes it; a wedding to its union', () => {
        const data = tree();
        const m = build(data);
        expect(editChangeOf(data, targetAt(m, 'v', 'occ')!, 'blacksmith')).toEqual({ ok: true, change: { kind: 'occupation', personId: 'v', value: 'blacksmith' } });
        expect(editChangeOf(data, targetAt(m, 'v', 'wDate')!, '12.2.1874', 'cs')).toEqual({ ok: true, change: { kind: 'union', unionId: 'u1', updates: { startDate: '1874-02-12' } } });
        const k = rowOf(m, 'k');
        const sub = editTargetOf('persons', subOf(k, 1), col('wPlace'))!;
        expect(editChangeOf(data, sub, 'Lopuchov')).toEqual({ ok: true, change: { kind: 'union', unionId: 'u2', updates: { startPlace: 'Lopuchov' } } });
    });
});
