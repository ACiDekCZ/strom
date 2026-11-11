/**
 * Table view, the tester's notes of 10 Nov 2026 (T54) without the DOM: the
 * Living column's and value's words (an adjective, not a verb), the REFN
 * column (from a GEDCOM file and back), the citations' URL columns (a web
 * address with or without its scheme a link, only http/https) and the
 * Sources table's Online chip by the Online column's rule.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { PersonId, StromData } from '../types.js';
import { setLanguage, strings } from '../strings.js';
import { buildTableModel, type PersonRow, type SourceRow, type TableModel } from '../ui/table-view/table-model.js';
import { cellOf, cellPlainText, columnById, columnLabel, columnOffered, DEFAULT_VIEWS } from '../ui/table-view/table-columns.js';
import { filterRows, sortRows } from '../ui/table-view/table-filter.js';
import { cellInner } from '../ui/table-view/table-grid.js';
import { sourceOnline } from '../ui/table-view/table-sources.js';
import { parseGedcom, convertToStrom } from '../ged-parser.js';
import { exportToGedcom } from '../ged-exporter.js';
import { safeWebUrl } from '../validation.js';

const person = (id: string, firstName: string, lastName: string, extra: Record<string, unknown> = {}) =>
    ({ id, firstName, lastName, gender: 'male', isPlaceholder: false, partnerships: [], parentIds: [], childIds: [], ...extra });

/**
 * An invented village: a dead grandfather with a reference number and his
 * birth cited by a source written without "https://", a living grandson
 * with another number; four sources as on the tester's screen (two web
 * addresses without the scheme), one online only by its excerpt's page and
 * one not online.
 */
function tree(): StromData {
    const persons = {
        a: person('a', 'Bonifác', 'Třešňák', { birthDate: '1850', deathDate: '1910', refn: 'K-17/b', birthSourceIds: ['s1'], deathSourceIds: ['s4'] }),
        n: person('n', 'Vendelín', 'Třešňák', { birthDate: '1990-02-01', refn: '204', birthSourceIds: ['s3'] }),
        z: person('z', 'Lukrecie', 'Hrabětová', { gender: 'female', birthDate: '1852', deathDate: '1915' }),
    };
    const sources = {
        s1: { id: 's1', title: 'Matrika Dolní Třešňovka', repository: 'Archiv Vymyšlený', reference: 'Kniha 98', url: 'www.example.org/tresnovka/98' },
        s2: { id: 's2', title: 'Matrika Horní Třešňovka', repository: 'Archiv Druhý', reference: '234567', url: 'www.example.net' },
        s3: {
            id: 's3', title: 'Soupis Třešňovka',
            excerpts: [{ id: 'x1', dataUrl: 'data:image/png;base64,AA==', width: 1, height: 1, sizeBytes: 1, pageUrl: 'example.com/viewer/12' }],
        },
        s4: { id: 's4', title: 'Kniha zemřelých Třešňovka', reference: 'fol. 4', url: 'javascript:alert(1)' },
        s5: { id: 's5', title: 'Výpis bez adresy', url: 'Kniha v archivu' },
    };
    return { persons, partnerships: {}, sources } as unknown as StromData;
}

const build = (data = tree()): TableModel =>
    buildTableModel(data, { rev: 1, homeId: 'n' as PersonId, lang: 'en', year: 2026, reliability: { researchTree: false, originFeature: false } });

const pcol = (id: string) => columnById('persons', id)!;
const scol = (id: string) => columnById('sources', id)!;
const prow = (m: TableModel, id: string): PersonRow => m.persons.find(r => r.id === id)!;
const srow = (m: TableModel, id: string): SourceRow => m.sources.find(r => r.id === id)!;

beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T10:30:00Z'));
});
afterEach(() => { setLanguage('en'); });
afterAll(() => { vi.useRealTimers(); });

describe('Living: an adjective in the head and in the cell (F2)', () => {
    it('cs "Žijící" / "žijící"; de and pl likewise; en stays "Living" / "living"', () => {
        const words: Record<string, [string, string]> = {
            cs: ['Žijící', 'žijící'], de: ['Lebend', 'lebend'], pl: ['Żyjący', 'żyjący'], en: ['Living', 'living'],
        };
        for (const [lang, [head, value]] of Object.entries(words)) {
            setLanguage(lang as 'cs');
            expect(columnLabel(pcol('living')), lang).toBe(head);
            // A death's cell of a living person says so.
            const m = build();
            expect(cellOf(m, prow(m, 'n'), pcol('dComp')).text, lang).toBe(value);
            expect(cellOf(m, prow(m, 'a'), pcol('dComp')).text, lang).not.toBe(value);
        }
    });
});

describe('REFN (F3)', () => {
    it('in the Person group, offered, not shown by default; its label in every language', () => {
        const c = pcol('refn');
        expect(c.group).toBe('person');
        expect(c.kind).toBe('text');
        expect(columnOffered(c)).toBe(true);
        expect(DEFAULT_VIEWS.persons.columns).not.toContain('refn');
        const labels: Record<string, string> = { en: 'Ref. number (REFN)', cs: 'Ref. číslo (REFN)', de: 'Ref.-Nummer (REFN)', pl: 'Nr ref. (REFN)' };
        for (const [lang, label] of Object.entries(labels)) {
            setLanguage(lang as 'cs');
            expect(columnLabel(c), lang).toBe(label);
        }
    });

    it('the person\'s number as written, sorted and filtered as text', () => {
        const m = build();
        expect(cellOf(m, prow(m, 'a'), pcol('refn')).text).toBe('K-17/b');
        expect(cellOf(m, prow(m, 'z'), pcol('refn')).empty).toBe(true);
        const sorted = sortRows(m, 'persons', m.persons, [{ col: 'refn', dir: 'asc' }]).map(r => r.id);
        expect(sorted.slice(0, 2)).toEqual(['n', 'a']);
        const hits = filterRows(m, 'persons', m.persons, { op: 'and', items: [{ col: 'refn', kind: 'text', match: 'contains', text: 'k-17' }] });
        expect(hits.rows.map(r => r.id)).toEqual(['a']);
    });

    it('a GEDCOM file\'s REFN reaches the column, and the export writes it back', () => {
        const ged = [
            '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
            '0 @I1@ INDI', '1 NAME Bonifác /Třešňák/', '1 SEX M', '1 REFN K-17/b', '2 TYPE kartotéka', '0 TRLR',
        ].join('\n');
        const data = convertToStrom(parseGedcom(ged)).data;
        const m = build(data);
        expect(cellOf(m, m.persons[0], pcol('refn')).text).toBe('K-17/b');
        const out = exportToGedcom(data).content;
        expect(out).toContain('1 REFN K-17/b');
        expect(out).toContain('2 TYPE kartotéka');
    });
});

describe('the citations\' URL columns (F10)', () => {
    it('named "<Event>: URL" in every language', () => {
        const names: Record<string, [string, string, string]> = {
            en: ['Birth: URL', 'Marriage: URL', 'Death: URL'],
            cs: ['Narození: URL', 'Sňatek: URL', 'Úmrtí: URL'],
            de: ['Geburt: URL', 'Heirat: URL', 'Tod: URL'],
            pl: ['Urodzenie: URL', 'Ślub: URL', 'Zgon: URL'],
        };
        for (const [lang, labels] of Object.entries(names)) {
            setLanguage(lang as 'cs');
            expect(['bUrl', 'wUrl', 'dUrl'].map(id => columnLabel(pcol(id))), lang).toEqual(labels);
        }
    });

    it('an address without its scheme a https link into a new tab, without the opener and the referrer; another scheme text', () => {
        const m = build();
        const url = cellOf(m, prow(m, 'a'), pcol('bUrl'));
        expect(url.text).toBe('www.example.org/tresnovka/98');
        expect(url.link).toEqual({ href: 'https://www.example.org/tresnovka/98', label: 'example.org/tresnovka/98' });
        const html = cellInner(url, pcol('bUrl'));
        expect(html).toContain('href="https://www.example.org/tresnovka/98" target="_blank" rel="noopener noreferrer"');
        expect(cellPlainText(url)).toBe('www.example.org/tresnovka/98');
        // javascript: stays text.
        const death = cellOf(m, prow(m, 'a'), pcol('dUrl'));
        expect(death.link).toBeUndefined();
        expect(cellInner(death, pcol('dUrl'))).not.toContain('<a');
    });

    it('safeWebUrl: http and https, an address without the scheme as https; nothing else', () => {
        expect(safeWebUrl('https://example.org/a')).toBe('https://example.org/a');
        expect(safeWebUrl(' http://example.org ')).toBe('http://example.org/');
        expect(safeWebUrl('www.example.org')).toBe('https://www.example.org/');
        expect(safeWebUrl('example.org/kniha?p=2')).toBe('https://example.org/kniha?p=2');
        expect(safeWebUrl('matriky.example.cz:8080/x')).toBe('https://matriky.example.cz:8080/x');
        for (const bad of ['javascript:alert(1)', 'ftp://example.org', 'data:text/html,x', 'fol. 7', 'Kniha v archivu', 'kniha', 'str.4', '//example.org', '', undefined, null]) {
            expect(safeWebUrl(bad), String(bad)).toBeNull();
        }
    });
});

describe('the Sources table\'s Online chip by the Online column\'s rule (F11)', () => {
    it('a web address without "https://" or an excerpt\'s page passes, as the column shows a link', () => {
        const m = build();
        const online = filterRows(m, 'sources', m.sources, { op: 'and', items: [{ chip: 'srcOnline' }] }).rows.map(r => r.id);
        expect(online).toEqual(['s1', 's2', 's3']);
        for (const r of m.sources) {
            const linked = !!cellOf(m, r, scol('srcUrl')).link;
            expect(linked, r.id).toBe(online.includes(r.id));
        }
        // The excerpt's page in the Online column when the source has no address of its own.
        expect(cellOf(m, srow(m, 's3'), scol('srcUrl')).link).toEqual({ href: 'https://example.com/viewer/12', label: 'example.com/viewer/12' });
        expect(cellOf(m, srow(m, 's2'), scol('srcUrl')).link?.href).toBe('https://www.example.net/');
        // Not a web address: its text, no link, not online.
        expect(cellOf(m, srow(m, 's5'), scol('srcUrl')).text).toBe('Kniha v archivu');
        expect(sourceOnline(tree().sources!['s4'])).toBeNull();
        expect(strings.table.chip.srcOnline).toBe('Online');
    });
});
