/**
 * Table view (spec 073 §7): the Data quality findings on the cells, without
 * the DOM — which cells a finding marks (§7.2), the person's Findings,
 * Highest level and Unusual, a finding marked "Not an error" as unusual (☆),
 * a place written several ways matched by the cell's value.
 */

import { describe, it, expect } from 'vitest';
import type { PersonId, StromData } from '../types.js';
import { validateTreeData } from '../validation.js';
import { dismissalFor } from '../quality-dismiss.js';
import { buildTableModel, type TableModel, type TableRow } from '../ui/table-view/table-model.js';
import { cellOf, columnById } from '../ui/table-view/table-columns.js';
import { applyChecks, bandSeverity, buildCheckIndex, issueTargets, lineFindings, severityRank } from '../ui/table-view/table-checks.js';
import type { GridLine } from '../ui/table-view/table-subrows.js';

/*
 * An invented family. Orla had Fenwick at 15; Fenwick married Isaura at 15
 * (dated, the age recorded as 30); Garrick's death age is off by ten years.
 * Two places are one place written two ways.
 */
function tree(): StromData {
    const person = (id: string, firstName: string, gender: 'male' | 'female', extra: Record<string, unknown> = {}) =>
        ({ id, firstName, lastName: 'Wrenhallow', gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });
    return {
        persons: {
            o: person('o', 'Orla', 'female', { birthDate: '1880-03-01', childIds: ['f'], birthPlace: 'Saint Ambry' }),
            f: person('f', 'Fenwick', 'male', { birthDate: '1895-06-01', parentIds: ['o'], partnerships: ['u1'], birthPlace: 'saint ambry' }),
            i: person('i', 'Isaura', 'female', { birthDate: '1890-01-01', partnerships: ['u1'] }),
            g: person('g', 'Garrick', 'male', { birthDate: '1850-01-01', deathDate: '1920-02-01', deathAge: '60' }),
        },
        partnerships: {
            u1: { id: 'u1', person1Id: 'f', person2Id: 'i', childIds: [], status: 'married', startDate: '1910-07-01', ages: { f: '30' } },
        },
    } as unknown as StromData;
}

const build = (data: StromData): TableModel => buildTableModel(data, { rev: 1, homeId: 'f' as PersonId, lang: 'en', year: 2026 });
const prow = (m: TableModel, id: string): TableRow => m.persons.find(r => r.id === id)!;
const urow = (m: TableModel, id: string): TableRow => m.unions.find(r => r.id === id)!;

function checked(data = tree()) {
    const m = build(data);
    const issues = validateTreeData(data).issues;
    const index = buildCheckIndex(data, issues);
    applyChecks(m, index);
    return { m, issues, index, data };
}

describe('findings mapped to cells (§7.2)', () => {
    it('a parent age goes on the child\'s Mother\'s age', () => {
        const { m, index } = checked();
        const f = index.cell(prow(m, 'f'), 'mAge', null);
        expect(f?.issue.type).toBe('motherTooYoung16');
        expect(f?.severity).toBe('warning');
        expect(index.cell(prow(m, 'f'), 'fAge', null)).toBeNull();
    });

    it('a wedding age goes on the union columns of the People and Unions tables', () => {
        const { m, index, data } = checked();
        const u1 = data.partnerships['u1' as keyof typeof data.partnerships];
        expect(index.cell(prow(m, 'f'), 'wAge', u1)?.issue.type).toBe('marriageUnder16');
        expect(index.cell(prow(m, 'i'), 'pAge', u1)?.issue.type).toBe('marriageUnder16');
        // Another union of the row's person is not marked.
        expect(index.cell(prow(m, 'f'), 'wAge', null)).toBeNull();
        // Unions table: Fenwick is Partner 1.
        expect(index.cell(urow(m, 'u1'), 'age1', null)?.issue.type).toBe('marriageUnder16');
        expect(index.cell(urow(m, 'u1'), 'age2', null)).toBeNull();
    });

    it('a recorded age goes on the recorded and the difference cells of its fact', () => {
        const { m, index, data } = checked();
        expect(index.cell(prow(m, 'g'), 'dAgeRec', null)?.issue.type).toBe('recordedAgeMismatch');
        expect(index.cell(prow(m, 'g'), 'dAgeDiff', null)?.issue.type).toBe('recordedAgeMismatch');
        const u1 = data.partnerships['u1' as keyof typeof data.partnerships];
        expect(index.cell(prow(m, 'f'), 'wAgeRec', u1)?.issue.type).toBe('recordedAgeMismatch');
        expect(index.cell(urow(m, 'u1'), 'rec1', null)?.issue.type).toBe('recordedAgeMismatch');
    });

    it('a place written several ways marks every place cell with that value', () => {
        const { m, index, issues } = checked();
        expect(issues.some(i => i.type === 'placeSpelling')).toBe(true);
        expect(index.cell(prow(m, 'o'), 'bPlace', null, 'Saint Ambry')?.issue.type).toBe('placeSpelling');
        expect(index.cell(prow(m, 'f'), 'bPlace', null, 'saint ambry')?.issue.type).toBe('placeSpelling');
        expect(index.cell(prow(m, 'g'), 'bPlace', null, '')).toBeNull();
    });

    it('a type with no cell of its own has no targets, only the person counts', () => {
        const issue = { id: 'x', severity: 'error' as const, type: 'circularReference', message: '', personIds: ['g' as PersonId] };
        expect(issueTargets(issue, tree())).toEqual([]);
    });

    it('a cell with several findings shows the highest', () => {
        expect(severityRank('error')).toBeGreaterThan(severityRank('warning'));
        expect(severityRank('info')).toBeGreaterThan(severityRank('unusual'));
    });
});

describe('the person\'s findings', () => {
    it('Findings counts reported findings with the mark of the highest; none is a faint 0', () => {
        const { m } = checked();
        const n = cellOf(m, prow(m, 'f'), columnById('persons', 'nFind')!);
        expect(Number(n.text)).toBeGreaterThanOrEqual(2);
        expect(n.mark).toBe('warning');
        const top = cellOf(m, prow(m, 'f'), columnById('persons', 'topSev')!);
        expect(top.text).toBe('to check');
        expect(top.mark).toBe('warning');
        const none = cellOf(m, prow(m, 'i'), columnById('persons', 'nFind')!);
        // Isaura is in the wedding of Fenwick, not in its finding.
        expect(none.text).toBe('0');
        expect(none.ghost).toBe(true);
    });

    it('while the checks run the cells show a faint "…"', () => {
        const m = build(tree());
        const c = cellOf(m, prow(m, 'f'), columnById('persons', 'nFind')!);
        expect(c.text).toBe('…');
        expect(c.ghost).toBe(true);
        expect(c.sortKey).toBeNull();
    });

    it('a finding marked "Not an error" is unusual: ☆ on the cell, out of Findings, into Unusual', () => {
        const data = tree();
        const issue = validateTreeData(data).issues.find(i => i.type === 'motherTooYoung16')!;
        data.qualityDismissed = [dismissalFor(issue, '2026-11-10T10:00:00Z')];
        const { m, index } = checked(data);
        const f = index.cell(prow(m, 'f'), 'mAge', null)!;
        expect(f.dismissed).toBe(true);
        expect(f.severity).toBe('unusual');
        expect(cellOf(m, prow(m, 'o'), columnById('persons', 'nFind')!).text).toBe('0');
        const unusual = cellOf(m, prow(m, 'o'), columnById('persons', 'unusual')!);
        expect(unusual.text).toBe('1');
        expect(unusual.mark).toBe('unusual');
        expect(cellOf(m, prow(m, 'o'), columnById('persons', 'topSev')!).text).toBe('unusual');
    });

    it('new findings drop the cached cells of the check columns', () => {
        const data = tree();
        const m = build(data);
        expect(cellOf(m, prow(m, 'f'), columnById('persons', 'nFind')!).text).toBe('…');
        applyChecks(m, buildCheckIndex(data, validateTreeData(data).issues));
        expect(cellOf(m, prow(m, 'f'), columnById('persons', 'nFind')!).text).not.toBe('…');
        expect(applyChecks(m, m.ctx.checks)).toBe(false);
    });
});

describe('a collapsed group\'s band (§4.3)', () => {
    it('shows the highest mark among its cells', () => {
        const { m, index } = checked();
        expect(bandSeverity(index, prow(m, 'f'), ['bDate', 'mAge', 'fAge'], () => null, () => '')).toBe('warning');
        expect(bandSeverity(index, prow(m, 'f'), ['bDate'], () => null, () => '')).toBeNull();
        expect(bandSeverity(null, prow(m, 'f'), ['mAge'], () => null, () => '')).toBeNull();
    });
});

/** Fenwick with a second union (to Quijany), so his unions are sub-rows. */
function twoUnions(): StromData {
    const data = tree();
    const persons = data.persons as unknown as Record<string, Record<string, unknown>>;
    persons.q = { ...persons.i, id: 'q', firstName: 'Quijany', birthDate: '1896-01-01', partnerships: ['u2'] };
    (persons.f.partnerships as string[]).push('u2');
    (data.partnerships as unknown as Record<string, unknown>).u2 = { id: 'u2', person1Id: 'f', person2Id: 'q', childIds: [], status: 'married', startDate: '1920-05-01' };
    return data;
}

describe('the findings of a union\'s sub-row (T54)', () => {
    it('a sub-row carries only its union\'s findings, the person\'s stay on the person\'s row', () => {
        const { m, index } = checked(twoUnions());
        const f = prow(m, 'f');
        if (f.kind !== 'person') throw new Error('person row');
        expect(f.unions.map(u => u.id)).toEqual(['u1', 'u2']);
        const col = (id: string) => columnById('persons', id)!;
        const main: GridLine = { kind: 'row', row: f, union: null, n: 2, expanded: true };
        const sub1: GridLine = { kind: 'sub', row: f, union: 0, k: 1, n: 2, dimmed: false };
        const sub2: GridLine = { kind: 'sub', row: f, union: 1, k: 2, n: 2, dimmed: false };
        // Mother's age at birth is the person's: on the row, not on "Union 1 of 2".
        expect(lineFindings(index, m, main, col('mAge')).map(x => x.issue.type)).toEqual(['motherTooYoung16']);
        expect(lineFindings(index, m, sub1, col('mAge'))).toEqual([]);
        expect(lineFindings(index, m, sub2, col('mAge'))).toEqual([]);
        expect(lineFindings(index, m, sub1, col('nFind'))).toEqual([]);
        // The wedding age is the union's: on its own sub-row only.
        expect(lineFindings(index, m, sub1, col('wAge')).map(x => x.issue.type)).toContain('marriageUnder16');
        expect(lineFindings(index, m, sub2, col('wAge'))).toEqual([]);
    });
});

describe('the list behind Findings and Highest level (T54)', () => {
    it('the person\'s findings, the reported ones by level, those marked "Not an error" last', () => {
        const data = tree();
        const issue = validateTreeData(data).issues.find(i => i.type === 'motherTooYoung16')!;
        data.qualityDismissed = [dismissalFor(issue, '2026-11-10T10:00:00Z')];
        const { index } = checked(data);
        const list = index.personAll('f');
        expect(list.length).toBeGreaterThanOrEqual(3);
        const ranks = list.map(x => severityRank(x.severity));
        expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
        expect(list[list.length - 1].issue.type).toBe('motherTooYoung16');
        expect(list[list.length - 1].dismissed).toBe(true);
        expect(new Set(list).size).toBe(list.length);
        expect(index.personAll('i')).toEqual([]);
    });
});
