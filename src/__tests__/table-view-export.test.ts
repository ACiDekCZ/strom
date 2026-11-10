/**
 * Table view (spec 073 §11): the CSV of what the table shows — the head and
 * the values as the table writes them, union continuation rows with the
 * "Union" column, escaping and formula neutralising, and a fuzz test that
 * splitting the file gives back every field's text (emoji, combining marks,
 * CJK, quotes, separators, line breaks).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { PersonId, StromData } from '../types.js';
import { setLanguage } from '../strings.js';
import { buildTableModel, type TableModel } from '../ui/table-view/table-model.js';
import { columnById, type ColumnDef } from '../ui/table-view/table-columns.js';
import { buildTableCsv, fileNamePart, tableCsvField, tableCsvFileName } from '../ui/table-view/table-export.js';
import { filterRows, sortRows } from '../ui/table-view/table-filter.js';
import { neutralizeFormula } from '../csv-export.js';

function tree(): StromData {
    const person = (id: string, firstName: string, lastName: string, gender: 'male' | 'female', extra: Record<string, unknown> = {}) =>
        ({ id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });
    const persons = {
        a: person('a', 'Bonifác', 'Zlatohlávek', 'male', { birthDate: '~1822', deathDate: '1890', partnerships: ['u1', 'u2', 'u3'] }),
        b: person('b', 'Apolónie', 'Pěnkavová', 'female', { birthDate: '1830', deathDate: '1855', partnerships: ['u1'] }),
        c: person('c', 'Marta; "Tichá"', 'Brumlová', 'female', { birthDate: '1835', deathDate: '1870', partnerships: ['u2'] }),
        d: person('d', '=Hana', 'Cvrčková', 'female', { birthDate: '1840', partnerships: ['u3'] }),
        e: person('e', 'Prokop', 'Zlatohlávek', 'male', { events: [{ id: 'x1', type: 'baptism', date: '1846-02-02' }] }),
    };
    const partnerships = {
        u1: { id: 'u1', person1Id: 'a', person2Id: 'b', childIds: [], status: 'married', startDate: '1850', startPlace: 'Horní Cvrčkov' },
        u2: { id: 'u2', person1Id: 'a', person2Id: 'c', childIds: [], status: 'married', startDate: '1857', startPlace: 'Dolní Cvrčkov, okres X' },
        u3: { id: 'u3', person1Id: 'a', person2Id: 'd', childIds: [], status: 'married', startDate: '1872' },
    };
    return { persons, partnerships } as unknown as StromData;
}

const build = (): TableModel =>
    buildTableModel(tree(), { rev: 1, homeId: 'a' as PersonId, lang: 'en', year: 2026, reliability: { researchTree: false, originFeature: false } });

const cols = (type: 'persons' | 'unions', ids: string[]): ColumnDef[] => ids.map(id => columnById(type, id)!);

/** Splits a `;` CSV (RFC 4180 quoting, CRLF) back into its fields. */
function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let i = 0;
    let quoted = false;
    while (i < text.length) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
            if (ch === '"') { quoted = false; i++; continue; }
            field += ch; i++; continue;
        }
        if (ch === '"') { quoted = true; i++; continue; }
        if (ch === ';') { row.push(field); field = ''; i++; continue; }
        if (ch === '\r' && text[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += 2; continue; }
        field += ch; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
}

beforeAll(() => setLanguage('en'));

describe('buildTableCsv (§11.2)', () => {
    it('the head, the values as shown, BOM, CRLF and the counts', () => {
        const m = build();
        const rows = sortRows(m, 'persons', m.persons, [{ col: 'name', dir: 'asc' }]);
        const out = buildTableCsv({ model: m, type: 'persons', rows, columns: cols('persons', ['name', 'bDate', 'dAge']) });
        expect(out.csv.startsWith('﻿')).toBe(true);
        expect(out.csv.endsWith('\r\n')).toBe(true);
        const lines = parseCsv(out.csv.slice(1));
        expect(lines[0]).toEqual(['Name', 'Union', 'Birth date', 'Age at death']);
        // Bonifác: three unions → his row and two continuation rows.
        const k = lines.findIndex(l => l[0].startsWith('Bonifác'));
        expect(lines[k][1]).toBe('1 of 3');
        expect(lines[k][2]).toBe('abt. 1822');
        expect(lines[k + 1]).toEqual(['', '2 of 3', '', '']);
        expect(lines[k + 2]).toEqual(['', '3 of 3', '', '']);
        // A baptism standing in for the birth is written with its mark.
        const p = lines.find(l => l[0].startsWith('Prokop'))!;
        expect(p[2]).toMatch(/^bap\. /);
        expect(out.items).toBe(5);
        expect(out.lines).toBe(7);
        expect(out.columns).toBe(4);
    });

    it('continuation rows carry only the union columns; a union filter writes only passing unions', () => {
        const m = build();
        const columns = cols('persons', ['name', 'wPlace', 'bDate']);
        const all = buildTableCsv({ model: m, type: 'persons', rows: m.persons.filter(r => r.id === 'a'), columns });
        expect(parseCsv(all.csv.slice(1))).toEqual([
            ['Name', 'Union', 'Marriage place', 'Birth date'],
            ['Bonifác Zlatohlávek', '1 of 3', 'Horní Cvrčkov', 'abt. 1822'],
            ['', '2 of 3', 'Dolní Cvrčkov, okres X', ''],
            ['', '3 of 3', '', ''],
        ]);
        // The comma is quoted, so a program reading commas keeps the place whole.
        expect(all.csv).toContain('"Dolní Cvrčkov, okres X"');
        const f = filterRows(m, 'persons', m.persons, { op: 'and', items: [{ col: 'wPlace', kind: 'text', match: 'contains', text: 'Cvrčkov' }] });
        const some = buildTableCsv({ model: m, type: 'persons', rows: f.rows.filter(r => r.id === 'a'), columns, pass: f.pass });
        expect(parseCsv(some.csv.slice(1)).slice(1)).toEqual([
            ['Bonifác Zlatohlávek', '1 of 3', 'Horní Cvrčkov', 'abt. 1822'],
            ['', '2 of 3', 'Dolní Cvrčkov, okres X', ''],
        ]);
    });

    it('without a person of several unions there is no Union column; the Unions table has none', () => {
        const m = build();
        const one = buildTableCsv({ model: m, type: 'persons', rows: m.persons.filter(r => r.id === 'b'), columns: cols('persons', ['name', 'partner']) });
        expect(parseCsv(one.csv.slice(1))[0]).toEqual(['Name', 'Partner']);
        const u = buildTableCsv({ model: m, type: 'unions', rows: m.unions, columns: cols('unions', ['p1', 'p2', 'wDate']) });
        expect(u.lines).toBe(3);
        expect(parseCsv(u.csv.slice(1))[0]).toEqual(['Partner 1', 'Partner 2', 'Marriage date']);
    });

    it('quotes, separators and formulas', () => {
        const m = build();
        const out = buildTableCsv({ model: m, type: 'persons', rows: m.persons.filter(r => r.id === 'c' || r.id === 'd'), columns: cols('persons', ['name']) });
        expect(out.csv).toContain('"Marta; ""Tichá"" Brumlová"');
        expect(out.csv).toContain("'=Hana Cvrčková");
        expect(tableCsvField('-5')).toBe('-5');
        expect(tableCsvField('@SUM(A1)')).toBe("'@SUM(A1)");
        expect(tableCsvField('a\nb')).toBe('"a\nb"');
        expect(tableCsvField('')).toBe('');
    });
});

describe('CSV fields: splitting gives the text back (fuzz)', () => {
    const PIECES = [
        'a', 'Ž', 'ř', 'é', 'ṇ̃', '👨‍👩‍👧', '🇨🇿', '👍🏽', '漢字', 'ひらがな', '한국어', 'ﬁ', '‍', ' ',
        ';', ',', '"', '""', '\n', '\r\n', '\t', "'", '=', '+', '-', '@', '1', '–', '≈', '…',
    ];
    // A fixed seed: the same strings on every run.
    let seed = 0x5eed1110;
    const rnd = (n: number): number => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed % n;
    };
    const sample = (): string => Array.from({ length: 1 + rnd(9) }, () => PIECES[rnd(PIECES.length)]).join('');

    it('every field of 300 random rows comes back as written (formulas with their apostrophe)', () => {
        const rows = Array.from({ length: 300 }, () => Array.from({ length: 1 + rnd(5) }, sample));
        const csv = rows.map(r => r.map(tableCsvField).join(';')).join('\r\n') + '\r\n';
        // Through bytes and back, as the downloaded file goes.
        const bytes = new TextEncoder().encode('﻿' + csv);
        const text = new TextDecoder('utf-8', { ignoreBOM: false }).decode(bytes);
        const back = parseCsv(text);
        expect(back.length).toBe(rows.length);
        rows.forEach((r, i) => expect(back[i]).toEqual(r.map(neutralizeFormula)));
    });
});

describe('the file name (§11.1)', () => {
    it('ASCII without diacritics, case kept, spaces as hyphens, the local date', () => {
        expect(fileNamePart('Příliš žluťoučký kůň')).toBe('Prilis-zlutoucky-kun');
        expect(fileNamePart('Łukasz & Søren')).toBe('Lukasz-Soren');
        expect(tableCsvFileName('Příliš žluťoučký kůň', 'Přehled', new Date(2026, 10, 10, 14, 30))).toBe('Prilis-zlutoucky-kun_Prehled_2026-11-10.csv');
        expect(tableCsvFileName('家谱', '', new Date(2026, 0, 5, 9))).toBe('family-tree_table_2026-01-05.csv');
    });
});
