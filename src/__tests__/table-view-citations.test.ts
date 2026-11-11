/**
 * Table view (spec 073 §14.3, §14.5): the citation columns and the
 * Godparents column of the People table without the DOM — the first cited
 * source's archive, reference and link, the pill "+N" of the others, the
 * marriage's citations per union (a sub-row's own), the death's for the
 * dead only, the CSV's "first (+N)", the godparents of the birth and the
 * baptism (a tree's person as a link) and a recurring godparent's lead on
 * that cell.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { PersonId, StromData } from '../types.js';
import { setLanguage, strings } from '../strings.js';
import { buildTableModel, type PersonRow, type TableModel } from '../ui/table-view/table-model.js';
import { cellOf, cellPlainText, columnById, columnLabel, columnsOf, DEFAULT_VIEWS } from '../ui/table-view/table-columns.js';
import { factCitations } from '../ui/table-view/table-sources.js';
import { personGodparents } from '../ui/table-view/table-events.js';
import { buildTableCsv } from '../ui/table-view/table-export.js';
import { buildCheckIndex } from '../ui/table-view/table-checks.js';
import { validateTreeData } from '../validation.js';
import { cellInner } from '../ui/table-view/table-grid.js';
import { citesHtml } from '../ui/table-view/table-bubble.js';

/**
 * An invented parish: a man with three birth citations (his own two and
 * his baptism's) and two marriages (the first cited twice, the second
 * once), his first wife without a source and dead, two children of two
 * families baptised with the same godparents (a tree's person and a written
 * name), a living grandson.
 */
function tree(): StromData {
    const person = (id: string, firstName: string, lastName: string, gender: 'male' | 'female', extra: Record<string, unknown> = {}) =>
        ({ id, firstName, lastName, gender, isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });
    const godparents = [
        { id: 'gp1', role: 'godparent', personId: 'g' },
        { id: 'gp2', role: 'godparent', name: 'Drahobud Vlčírek' },
        { id: 'gp3', role: 'officiant', name: 'P. Liboslav Drn' },
    ];
    const persons = {
        a: person('a', 'Radoslav', 'Pecháček', 'male', {
            birthDate: '1840-04-03', deathDate: '1901-02-11', partnerships: ['u1', 'u2'], childIds: ['c'],
            birthSourceIds: ['s1', 's2', 'zz'], deathSourceIds: ['s4'],
            events: [{ id: 'ab', type: 'baptism', date: '1840-04-04', sourceIds: ['s1', 's3'] }],
        }),
        b: person('b', 'Ludmila', 'Hruštičková', 'female', { birthDate: '1845', deathDate: '1870', partnerships: ['u1'], childIds: ['c'] }),
        w: person('w', 'Johana', 'Vrbatová', 'female', { birthDate: '1850', deathDate: '1910', partnerships: ['u2'] }),
        c: person('c', 'Kvirin', 'Pecháček', 'male', {
            birthDate: '1866-08-01', parentIds: ['a', 'b'], childIds: ['n'],
            events: [{ id: 'cb', type: 'baptism', date: '1866-08-02', participants: godparents }],
        }),
        e: person('e', 'Medard', 'Ořešník', 'male', { childIds: ['d'], partnerships: ['u3'] }),
        f: person('f', 'Apolena', 'Ořešníková', 'female', { childIds: ['d'], partnerships: ['u3'] }),
        d: person('d', 'Pankrác', 'Ořešník', 'male', {
            birthDate: '1868-05-12', parentIds: ['e', 'f'],
            events: [
                { id: 'db', type: 'birth', date: '1868-05-12', participants: [{ id: 'x1', role: 'godparent', name: 'Drahobud Vlčírek' }] },
                { id: 'dc', type: 'baptism', date: '1868-05-13', participants: godparents },
            ],
        }),
        g: person('g', 'Ostromír', 'Plíšťák', 'male', { birthDate: '1830', deathDate: '1899' }),
        n: person('n', 'Vratislav', 'Pecháček', 'male', { birthDate: '1990-06-01', parentIds: ['c'] }),
    };
    const partnerships = {
        u1: { id: 'u1', person1Id: 'a', person2Id: 'b', childIds: ['c'], status: 'married', startDate: '1865-01-20', sourceIds: ['s3', 's2'] },
        u2: { id: 'u2', person1Id: 'a', person2Id: 'w', childIds: [], status: 'married', startDate: '1872-02-03', sourceIds: ['s4'] },
        u3: { id: 'u3', person1Id: 'e', person2Id: 'f', childIds: ['d'], status: 'married' },
    };
    const sources = {
        s1: { id: 's1', title: 'Kniha narozených Lhota pod Skalkou', repository: 'Archiv Smyšlený', reference: 'fol. 7', url: 'https://example.org/lhota/7' },
        s2: { id: 's2', title: 'Výpis ze soupisu', reference: 'č. 41' },
        s3: { id: 's3', title: 'Oddací kniha Lhota pod Skalkou', repository: 'Farní úřad Lhota', reference: 'fol. 30', url: 'javascript:alert(1)' },
        s4: { id: 's4', title: 'Kniha zemřelých Lhota pod Skalkou', repository: 'Archiv Smyšlený', reference: 'fol. 99', url: 'http://example.org/z/99' },
    };
    return { persons, partnerships, sources } as unknown as StromData;
}

const build = (data = tree()): TableModel =>
    buildTableModel(data, { rev: 1, homeId: 'c' as PersonId, lang: 'en', year: 2026, reliability: { researchTree: false, originFeature: false } });

const col = (id: string) => columnById('persons', id)!;
const row = (m: TableModel, id: string): PersonRow => m.persons.find(r => r.id === id)!;
const cell = (m: TableModel, id: string, colId: string, union?: number) => cellOf(m, row(m, id), col(colId), union);

beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T10:30:00Z'));
    setLanguage('en');
});
afterAll(() => { vi.useRealTimers(); });

describe('citation columns (§14.3)', () => {
    it('in the Sources group, not in the default set; the marriage\'s union-scoped', () => {
        const ids = [
            'bArch', 'bSig', 'bFolio', 'bImage', 'bRef', 'bUrl', 'wArch', 'wSig', 'wFolio', 'wImage', 'wRef', 'wUrl',
            'dArch', 'dSig', 'dFolio', 'dImage', 'dRef', 'dUrl',
        ];
        for (const id of ids) {
            expect(col(id).group).toBe('sources');
            expect(col(id).phase).toBe(1);
            expect(DEFAULT_VIEWS.persons.columns).not.toContain(id);
        }
        expect(ids.filter(id => col(id).unionScoped)).toEqual(['wArch', 'wSig', 'wFolio', 'wImage', 'wRef', 'wUrl']);
        // The group's order (spec 075 U3 §3): archive, call number, folio, image, other location, URL.
        const group = columnsOf('persons').filter(c => c.group === 'sources' && c.id.startsWith('b')).map(c => c.id);
        expect(group).toEqual(['bArch', 'bSig', 'bFolio', 'bImage', 'bRef', 'bUrl']);
        expect(['bSig', 'bFolio', 'bImage', 'bRef'].map(id => col(id).width)).toEqual([160, 180, 130, 230]);
        expect(col('bUrl').kind).toBe('link');
        expect(columnLabel(col('wRef'))).toBe('Marriage: other location');
        expect(['bSig', 'bFolio', 'bImage'].map(id => columnLabel(col(id)))).toEqual(['Birth: call number', 'Birth: folio/page', 'Birth: image']);
    });

    it('factCitations: the birth\'s own and its baptism\'s, each once, unknown ids left out', () => {
        const data = tree();
        expect(factCitations(data, 'birth', data.persons['a' as PersonId]).map(c => c.id)).toEqual(['s1', 's2', 's3']);
        expect(factCitations(data, 'death', data.persons['a' as PersonId]).map(c => c.id)).toEqual(['s4']);
        expect(factCitations(data, 'marriage', data.partnerships['u1' as never]).map(c => c.id)).toEqual(['s3', 's2']);
        expect(factCitations(data, 'birth', data.persons['b' as PersonId])).toEqual([]);
    });

    it('three citations: the first one\'s archive, reference and link and "+2"; sorted by the first', () => {
        const m = build();
        const arch = cell(m, 'a', 'bArch');
        expect(arch.text).toBe('Archiv Smyšlený');
        expect(arch.sortKey).toBe('archiv smyšlený');
        expect(arch.moreSources).toEqual(['s2', 's3']);
        expect(cell(m, 'a', 'bRef').text).toBe('fol. 7');
        const url = cell(m, 'a', 'bUrl');
        expect(url.link).toEqual({ href: 'https://example.org/lhota/7', label: 'example.org/lhota/7' });
        expect(url.moreSources).toHaveLength(2);
        // The CSV and the search: the value as the table shows it, the pill as "(+2)".
        expect(cellPlainText(arch)).toBe('Archiv Smyšlený (+2)');
        const html = cellInner(arch, col('bArch'));
        expect(html).toContain('class="tv-cites-more"');
        expect(html).toContain('>+2</button>');
        expect(html).toContain(`aria-label="${strings.table.moreCites(2)}"`);
        expect(strings.table.moreCites(2)).toBe('2 more citations');
    });

    it('one citation: no pill; none: empty; the death\'s only for the dead', () => {
        const m = build();
        const d = cell(m, 'a', 'dArch');
        expect(d.text).toBe('Archiv Smyšlený');
        expect(d.moreSources).toBeUndefined();
        expect(cellPlainText(d)).toBe('Archiv Smyšlený');
        expect(cellInner(d, col('dArch'))).not.toContain('tv-cites-more');
        expect(cell(m, 'a', 'dUrl').link?.href).toBe('http://example.org/z/99');
        // Without a source.
        expect(cell(m, 'b', 'bArch').empty).toBe(true);
        expect(cell(m, 'b', 'dRef').empty).toBe(true);
        // The living grandson: the death's citation does not apply.
        expect(cell(m, 'n', 'dArch').na).toBe(true);
        expect(cellPlainText(cell(m, 'n', 'dArch'))).toBe('–');
    });

    it('a first source without the field: an empty cell with the pill', () => {
        const m = build();
        // The first wedding cites s3 (not a web address) then s2.
        const url = cell(m, 'a', 'wUrl', 0);
        expect(url.link).toBeUndefined();
        expect(url.text).toBe('javascript:alert(1)');
        const data = tree();
        data.partnerships['u1' as never] = { ...data.partnerships['u1' as never], sourceIds: ['s2', 's3'] };
        const m2 = build(data);
        const arch = cell(m2, 'a', 'wArch', 0);
        expect(arch.empty).toBe(true);
        expect(arch.moreSources).toEqual(['s3']);
        expect(cellInner(arch, col('wArch'))).toContain('>+1</button>');
        expect(cellPlainText(arch)).toBe('(+1)');
    });

    it('the marriage: each union its own citations (the sub-rows), without a union "does not apply"', () => {
        const m = build();
        expect(row(m, 'a').unions.map(u => u.id)).toEqual(['u1', 'u2']);
        const first = cell(m, 'a', 'wRef', 0);
        expect(first.text).toBe('fol. 30');
        expect(first.moreSources).toEqual(['s2']);
        const second = cell(m, 'a', 'wRef', 1);
        expect(second.text).toBe('fol. 99');
        expect(second.moreSources).toBeUndefined();
        expect(cell(m, 'w', 'wArch').text).toBe('Archiv Smyšlený');
        expect(cell(m, 'g', 'wArch').na).toBe(true);
    });

    it('the place fields of the first citation; an older source leaves call number, folio and image empty (spec 075 U3 §3)', () => {
        const data = tree();
        const placed = { ...data.sources!.s1!, callNumber: 'N 7', folio: 'fol. 12v', image: '34', reference: 'č. 5' };
        const m = build({ ...data, sources: { ...data.sources, s1: placed } } as StromData);
        expect(['bArch', 'bSig', 'bFolio', 'bImage', 'bRef'].map(id => cell(m, 'a', id).text)).toEqual(['Archiv Smyšlený', 'N 7', 'fol. 12v', '34', 'č. 5']);
        expect(cell(m, 'a', 'bImage').moreSources).toEqual(['s2', 's3']);
        const old = build();
        expect(['bSig', 'bFolio', 'bImage'].map(id => cell(old, 'a', id).empty)).toEqual([true, true, true]);
        expect(cell(old, 'a', 'bRef').text).toBe('fol. 7');
        // Death of a living person: does not apply, as the other death columns.
        expect(cell(old, 'n', 'dFolio').na).toBe(cell(old, 'n', 'dRef').na);
    });

    it('the CSV: the first value and "(+N)"; a second union on its continuation row', () => {
        const m = build();
        const columns = ['name', 'bRef', 'wRef'].map(col);
        const out = buildTableCsv({ model: m, type: 'persons', rows: [row(m, 'a'), row(m, 'b')], columns });
        const lines = out.csv.replace(/^﻿/, '').split('\r\n');
        expect(lines[0]).toBe('Full name;Union;Birth: other location;Marriage: other location');
        expect(lines[1]).toBe('Radoslav Pecháček;1 of 2;fol. 7 (+2);fol. 30 (+1)');
        expect(lines[2]).toBe(';2 of 2;;fol. 99');
        expect(lines[3]).toBe('Ludmila Hruštičková;;;fol. 30 (+1)');
    });

    it('the bubble lists the other sources as buttons that open them', () => {
        const html = citesHtml([{ title: 'Výpis ze soupisu', meta: 'č. 41' }, { title: 'A <b>', meta: '' }]);
        expect(html).toContain(strings.table.citesTitle);
        expect(html.match(/data-act="source"/g)).toHaveLength(2);
        expect(html).toContain('data-i="1"');
        expect(html).toContain('A &lt;b&gt;');
        expect(html).not.toContain('tv-bub-cite-meta"></span>');
    });
});

describe('Godparents in People (§14.5)', () => {
    it('the birth\'s and the baptism\'s godparents, each once; a tree\'s person a link, a written name text', () => {
        const m = build();
        expect(col('godparents').group).toBe('birth');
        expect(DEFAULT_VIEWS.persons.columns).not.toContain('godparents');
        const c = cell(m, 'd', 'godparents');
        expect(c.text).toBe('Drahobud Vlčírek, Ostromír Plíšťák');
        expect(c.names).toEqual([{ text: 'Drahobud Vlčírek' }, { text: 'Ostromír Plíšťák', personId: 'g' }]);
        // No role: in People a name never offers the participant filter.
        expect(c.names!.every(n => !('role' in n))).toBe(true);
        expect(personGodparents(tree().persons['d' as PersonId]).map(x => x.id)).toEqual(['x1', 'gp1']);
        const html = cellInner(c, col('godparents'));
        expect(html).toContain('<span>Drahobud Vlčírek</span>');
        expect(html).toContain('class="tv-nm tv-nm--person"');
        expect(html).not.toContain('aria-haspopup');
        // The officiant is not a godparent; nobody at the father's baptism.
        expect(cell(m, 'c', 'godparents').text).toBe('Ostromír Plíšťák, Drahobud Vlčírek');
        expect(cell(m, 'a', 'godparents').empty).toBe(true);
        expect(cellPlainText(cell(m, 'c', 'godparents'))).toBe('Ostromír Plíšťák, Drahobud Vlčírek');
    });

    it('a recurring godparent is a lead on the Godparents cell of the people whose godparent it is', () => {
        const data = tree();
        const issues = validateTreeData(data).issues.filter(i => i.type === 'recurringGodparent');
        expect(issues.map(i => i.subject).sort()).toEqual(['Drahobud Vlčírek', 'Ostromír Plíšťák']);
        const index = buildCheckIndex(data, issues);
        const m = build(data);
        const f = index.cell(row(m, 'c'), 'godparents', null);
        expect(f?.severity).toBe('info');
        expect(f?.issue.type).toBe('recurringGodparent');
        expect(index.cellAll(row(m, 'd'), 'godparents', null).map(x => x.issue.subject).sort())
            .toEqual(['Drahobud Vlčírek', 'Ostromír Plíšťák']);
        // Not on other cells, nor on someone with no godparents.
        expect(index.cell(row(m, 'c'), 'bDate', null)).toBeNull();
        expect(index.cell(row(m, 'a'), 'godparents', null)).toBeNull();
    });
});
