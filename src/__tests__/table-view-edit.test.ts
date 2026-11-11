/**
 * Table view (T54 F8): a cell edited in place — which cells stand for one
 * fact of the tree, the text the editor opens with, and what a save changes
 * (the date read as the person dialog reads it, an empty field clearing only
 * that fact, the baptism's other fields kept, an unreadable date or a person
 * left without a name saving nothing). T54 G3: the sex and a union's type
 * chosen, the cause and the age at death, the REFN, a union's recorded ages
 * and divorce; T54 G5: a union without a wedding has no wedding cells.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { PersonId, StromData } from '../types.js';
import { setLanguage } from '../strings.js';
import { formatDateForInput, normalizeDateInput } from '../dates.js';
import { buildTableModel, type TableModel, type TableRow, type PersonRow } from '../ui/table-view/table-model.js';
import { cellOf, columnById } from '../ui/table-view/table-columns.js';
import { cellText } from '../ui/table-view/table-grid.js';
import { columnCoverage } from '../ui/table-view/table-coverage.js';
import { editChangeOf, editOptionsOf, editTargetOf, editValueOf, type EditTarget } from '../ui/table-view/table-edit.js';
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

describe('more cells edited in place (T54 G3)', () => {
    /** The tree with a few more facts: his cause of death, a recorded age, a REFN; the wedding's ages. */
    function tree3(): StromData {
        const data = tree();
        Object.assign(data.persons['v' as PersonId], { deathDate: '1910', deathCause: 'fever', deathAge: '60', refn: 'B-12' });
        Object.assign(data.partnerships['u1' as never], { ages: { v: '24' } });
        return data;
    }
    const ucol = (id: string) => columnById('unions', id)!;
    const unionLine = (m: TableModel, id: string) => lineOf(m.unionRows.get(id as never)!);

    it('the sex and a union\'s type are chosen; the cause and the age at death, the REFN typed', () => {
        const m = build(tree3());
        expect(targetAt(m, 'v', 'gender')).toEqual({ field: 'gender', input: 'select', personId: 'v', unionId: null });
        expect(targetAt(m, 'v', 'refn')).toMatchObject({ field: 'refn', input: 'text' });
        expect(targetAt(m, 'v', 'dCause')).toMatchObject({ field: 'deathCause', input: 'text' });
        expect(targetAt(m, 'v', 'dAgeRec')).toMatchObject({ field: 'deathAge', input: 'text' });
        expect(targetAt(m, 'v', 'uStatus')).toEqual({ field: 'unionStatus', input: 'select', personId: null, unionId: 'u1' });
        expect(editTargetOf('unions', unionLine(m, 'u1'), ucol('uStatus'))).toMatchObject({ field: 'unionStatus', unionId: 'u1' });
        // The choices: the person dialog's sexes, the union form's types.
        expect(editOptionsOf(targetAt(m, 'v', 'gender')!)!.map(o => o.value)).toEqual(['male', 'female', 'unknown']);
        expect(editOptionsOf(targetAt(m, 'v', 'gender')!)!.map(o => o.label)).toEqual(['Male', 'Female', 'Unknown']);
        expect(editOptionsOf(targetAt(m, 'v', 'uStatus')!)!.map(o => o.value)).toEqual(['married', 'partners', 'divorced', 'separated']);
        // Computed or counted cells stay out.
        for (const id of ['dAgeDiff', 'wAgeDiff', 'div', 'living', 'researchId']) expect(targetAt(m, 'v', id), id).toBeNull();
    });

    it('the wedding\'s recorded ages and the divorce: on a union\'s row, a sub-row, the row of a person with one union', () => {
        const m = build(tree3());
        expect(targetAt(m, 'v', 'wAgeRec')).toEqual({ field: 'marriageAge', input: 'text', personId: null, unionId: 'u1', agePersonId: 'v' });
        expect(targetAt(m, 'v', 'pAgeRec')).toMatchObject({ field: 'marriageAge', unionId: 'u1', agePersonId: 'k' });
        expect(targetAt(m, 'v', 'divDate')).toMatchObject({ field: 'divorceDate', input: 'date', unionId: 'u1' });
        expect(targetAt(m, 'v', 'divPlace')).toMatchObject({ field: 'divorcePlace', input: 'place', unionId: 'u1' });
        // Two unions on one row: which one is not said (F8's rule).
        for (const id of ['wAgeRec', 'pAgeRec', 'divDate', 'divPlace', 'uStatus']) expect(targetAt(m, 'k', id), id).toBeNull();
        const k = rowOf(m, 'k');
        expect(editTargetOf('persons', subOf(k, 1), col('pAgeRec'))).toMatchObject({ unionId: 'u2', agePersonId: 't' });
        expect(editTargetOf('persons', subOf(k, 1), col('divDate'))).toMatchObject({ field: 'divorceDate', unionId: 'u2' });
        // The Unions table: Partner 1 and Partner 2 as its columns show them (the home person's blood relative first).
        expect(editTargetOf('unions', unionLine(m, 'u1'), ucol('rec1'), m.ctx)).toMatchObject({ field: 'marriageAge', agePersonId: 'v' });
        expect(editTargetOf('unions', unionLine(m, 'u1'), ucol('rec2'), m.ctx)).toMatchObject({ field: 'marriageAge', agePersonId: 'k' });
        expect(editTargetOf('unions', unionLine(m, 'u2'), ucol('divPlace'))).toMatchObject({ field: 'divorcePlace', unionId: 'u2' });
        for (const id of ['age1', 'age2', 'div', 'uLen', 'uComp']) expect(editTargetOf('unions', unionLine(m, 'u1'), ucol(id)), id).toBeNull();
    });

    it('the editor opens with the stored value; a choice with its value', () => {
        const data = tree3();
        const m = build(data);
        expect(editValueOf(data, targetAt(m, 'v', 'gender')!)).toBe('male');
        expect(editValueOf(data, targetAt(m, 'v', 'uStatus')!)).toBe('married');
        expect(editValueOf(data, targetAt(m, 'v', 'dCause')!)).toBe('fever');
        expect(editValueOf(data, targetAt(m, 'v', 'refn')!)).toBe('B-12');
        expect(editValueOf(data, targetAt(m, 'v', 'wAgeRec')!)).toBe('24');
        expect(editValueOf(data, targetAt(m, 'v', 'pAgeRec')!)).toBe('');
        expect(editValueOf(data, targetAt(m, 'v', 'divDate')!)).toBe('');
    });

    it('a person\'s new fact goes as the person dialog writes it', () => {
        const data = tree3();
        const m = build(data);
        const save = (id: string, text: string) => editChangeOf(data, targetAt(m, 'v', id)!, text, 'en');
        expect(save('gender', 'unknown')).toEqual({ ok: true, change: { kind: 'person', personId: 'v', updates: { gender: 'unknown' } } });
        expect(save('gender', 'male')).toEqual({ ok: true, change: null });
        // A value the choice does not offer changes nothing.
        expect(save('gender', 'other')).toEqual({ ok: true, change: null });
        expect(save('refn', ' B-13 ')).toEqual({ ok: true, change: { kind: 'person', personId: 'v', updates: { refn: 'B-13' } } });
        expect(save('dCause', 'typhus')).toEqual({ ok: true, change: { kind: 'person', personId: 'v', updates: { deathCause: 'typhus' } } });
        expect(save('dAgeRec', '')).toEqual({ ok: true, change: { kind: 'person', personId: 'v', updates: { deathAge: '' } } });
    });

    it('a union\'s empty cell adds its fact as the union form does; an emptied one clears that fact alone', () => {
        const data = tree3();
        const m = build(data);
        const k = rowOf(m, 'k');
        const u2 = (id: string) => editTargetOf('persons', subOf(k, 1), col(id), m.ctx)!;
        // u2 has no wedding yet: its date, place and both ages each add that fact.
        expect(editChangeOf(data, editTargetOf('unions', unionLine(m, 'u2'), ucol('wDate'))!, '3.5.1880', 'cs'))
            .toEqual({ ok: true, change: { kind: 'union', unionId: 'u2', updates: { startDate: '1880-05-03' } } });
        expect(editChangeOf(data, u2('wAgeRec'), '28')).toEqual({ ok: true, change: { kind: 'union', unionId: 'u2', updates: { ages: { k: '28' } } } });
        expect(editChangeOf(data, u2('pAgeRec'), '31')).toEqual({ ok: true, change: { kind: 'union', unionId: 'u2', updates: { ages: { t: '31' } } } });
        // The divorce: its date read as the form reads it, its place as typed.
        expect(editChangeOf(data, u2('divDate'), 'abt 1890', 'en')).toEqual({ ok: true, change: { kind: 'union', unionId: 'u2', updates: { endDate: normalizeDateInput('abt 1890', 'en') } } });
        expect(editChangeOf(data, u2('divDate'), 'the year of the flood', 'en')).toEqual({ ok: false, error: 'date' });
        expect(editChangeOf(data, u2('divPlace'), 'Klenovice')).toEqual({ ok: true, change: { kind: 'union', unionId: 'u2', updates: { endPlace: 'Klenovice' } } });
        expect(editChangeOf(data, u2('divPlace'), '')).toEqual({ ok: true, change: null });
        expect(editChangeOf(data, u2('uStatus'), 'partners')).toEqual({ ok: true, change: { kind: 'union', unionId: 'u2', updates: { status: 'partners' } } });
        // An emptied age clears his alone (the store keeps hers).
        expect(editChangeOf(data, targetAt(m, 'v', 'wAgeRec')!, ' ')).toEqual({ ok: true, change: { kind: 'union', unionId: 'u1', updates: { ages: { v: '' } } } });
    });
});

describe('a union without a wedding (T54 G5)', () => {
    /** u1 a union of partners, u2 separated partners; a third union married with nothing filled. */
    function treeP(): StromData {
        const data = tree();
        Object.assign(data.partnerships['u1' as never], { status: 'partners', startDate: undefined, startPlace: undefined });
        Object.assign(data.partnerships['u2' as never], { status: 'separated' });
        return data;
    }
    const WEDDING = ['wDate', 'wPlace', 'wAge', 'wAgeRec', 'wAgeDiff', 'pAge', 'pAgeRec', 'pAgeDiff', 'witnesses', 'relW'];

    it('the wedding\'s cells say "does not apply", with why in the bubble', () => {
        const m = build(treeP());
        const v = rowOf(m, 'v');
        for (const id of WEDDING) {
            const c = cellOf(m, v, col(id));
            expect(c.na, id).toBe(true);
            expect(c.title, id).toBe('Does not apply: a union without a wedding');
        }
        // The partner, the type and the divorce still apply.
        for (const id of ['partner', 'uStatus', 'divDate']) expect(cellOf(m, v, col(id)).na, id).toBe(false);
        const u = m.unionRows.get('u1' as never)!;
        for (const id of ['wDate', 'wPlace', 'age1', 'rec1', 'age2', 'rec2', 'witnesses', 'relW']) {
            expect(cellOf(m, u, columnById('unions', id)!).na, id).toBe(true);
        }
        setLanguage('cs');
        const m2 = build(treeP());
        expect(cellOf(m2, rowOf(m2, 'v'), col('wDate')).title).toBe('Nevztahuje se: svazek bez sňatku');
        expect(cellText(cellOf(m2, rowOf(m2, 'v'), col('wDate')))).toBe('–');
        // A married union's empty wedding still counts as missing.
        const married = build(tree());
        expect(cellOf(married, rowOf(married, 't'), col('wDate')).na).toBe(false);
    });

    it('nor do they count in the completeness or in the coverage row', () => {
        const m = build(treeP());
        // Partners with a partner: complete; married with nothing but the partner: a quarter.
        const u1 = m.unionRows.get('u1' as never)!;
        expect(cellOf(m, u1, columnById('unions', 'uComp')!).percent).toBe(100);
        expect(cellOf(m, rowOf(m, 'v'), col('uComp')).percent).toBe(100);
        expect(cellOf(m, rowOf(m, 'v'), col('uComp')).title).toContain('partner (a union without a wedding)');
        const married = build(tree());
        expect(cellOf(married, rowOf(married, 't'), col('uComp')).percent).toBe(25);
        // The person's completeness: the same union married would miss its wedding's date, place and source.
        const asMarried = treeP();
        Object.assign(asMarried.partnerships['u1' as never], { status: 'married' });
        const mm = build(asMarried);
        const before = cellOf(mm, rowOf(mm, 'v'), col('comp'));
        const after = cellOf(m, rowOf(m, 'v'), col('comp'));
        expect(before.title).toContain('wedding date');
        expect(after.title).not.toContain('wedding date');
        expect(after.percent!).toBeGreaterThan(before.percent!);
        // The coverage row: the union of partners is left out, the other unions counted.
        const cov = columnCoverage(m, m.persons, col('wDate'));
        expect(cov.total).toBe(0);
        const covMarried = columnCoverage(married, married.persons, col('wDate'));
        expect(covMarried).toMatchObject({ filled: 2, total: 4 });
    });

    it('a stored value (the relationship\'s start written in the union form) is shown as it is', () => {
        const data = treeP();
        Object.assign(data.partnerships['u1' as never], { startDate: '1874' });
        const m = build(data);
        const c = cellOf(m, rowOf(m, 'v'), col('wDate'));
        expect(c.na).toBe(false);
        expect(c.text).toBe('1874');
    });

    it('they are not edited in the cell nor added from an empty one', () => {
        const data = treeP();
        Object.assign(data.partnerships['u1' as never], { startDate: '1874' });
        const m = build(data);
        for (const id of ['wDate', 'wPlace', 'wAgeRec', 'pAgeRec']) expect(targetAt(m, 'v', id), id).toBeNull();
        const k = rowOf(m, 'k');
        expect(editTargetOf('persons', subOf(k, 1), col('wDate'))).toBeNull();
        const u = lineOf(m.unionRows.get('u1' as never)!);
        for (const id of ['wDate', 'wPlace', 'rec1', 'rec2']) expect(editTargetOf('unions', u, columnById('unions', id)!, m.ctx), id).toBeNull();
        // The union's type and its end still are.
        expect(targetAt(m, 'v', 'uStatus')).toMatchObject({ field: 'unionStatus' });
        expect(targetAt(m, 'v', 'divDate')).toMatchObject({ field: 'divorceDate' });
    });
});
